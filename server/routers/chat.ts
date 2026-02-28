/**
 * chat.ts — tRPC router for the HybridRAG chat assistant
 *
 * PUBLIC ACCESS — no authentication required.
 * Uses a session-based identity: authenticated users get their openId,
 * anonymous users get a generated session ID stored in a cookie.
 *
 * CONCURRENCY LIMIT: Only 1 active chat request at a time across all users.
 * Additional requests receive a "busy" response.
 *
 * Messages are persisted in the chat_messages table.
 * SSE streaming is handled by a separate Express endpoint.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { processChat, type ChatMessage } from "../ragEngine";
import { getDb } from "../db";
import { chatMessages } from "../../drizzle/schema";
import { eq, desc, asc } from "drizzle-orm";

const MAX_HISTORY = 50;

// ── Rate Limiter ─────────────────────────────────────────────────
// Sliding window: max 20 messages per 5 minutes, burst limit of 5 per 30 seconds
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_MAX_MESSAGES = 20;
const BURST_WINDOW_MS = 30 * 1000; // 30 seconds
const BURST_MAX_MESSAGES = 5;

interface RateBucket {
  timestamps: number[];
}

const rateBuckets = new Map<string, RateBucket>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  rateBuckets.forEach((bucket: RateBucket, key: string) => {
    bucket.timestamps = bucket.timestamps.filter((t: number) => t > cutoff);
    if (bucket.timestamps.length === 0) rateBuckets.delete(key);
  });
}, 10 * 60 * 1000);

export function checkRateLimit(sessionId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(sessionId);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateBuckets.set(sessionId, bucket);
  }

  // Prune old timestamps
  bucket.timestamps = bucket.timestamps.filter((t) => t > now - RATE_WINDOW_MS);

  // Check burst limit (5 per 30s)
  const burstCount = bucket.timestamps.filter((t) => t > now - BURST_WINDOW_MS).length;
  if (burstCount >= BURST_MAX_MESSAGES) {
    const oldestBurst = bucket.timestamps.filter((t) => t > now - BURST_WINDOW_MS)[0];
    const retryAfterSec = Math.ceil((oldestBurst + BURST_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  // Check window limit (20 per 5min)
  if (bucket.timestamps.length >= RATE_MAX_MESSAGES) {
    const oldestInWindow = bucket.timestamps[0];
    const retryAfterSec = Math.ceil((oldestInWindow + RATE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  // Record this message
  bucket.timestamps.push(now);
  return { allowed: true };
}

// ── Concurrency Lock ──────────────────────────────────────────────
// Only 1 active chat request at a time (across all users)
let activeChatLock: { sessionId: string; startedAt: number } | null = null;
const LOCK_TIMEOUT_MS = 120_000; // 2 minutes max per request

export function isLocked(): boolean {
  if (!activeChatLock) return false;
  // Auto-release stale locks
  if (Date.now() - activeChatLock.startedAt > LOCK_TIMEOUT_MS) {
    activeChatLock = null;
    return false;
  }
  return true;
}

export function acquireLock(sessionId: string): boolean {
  if (isLocked() && activeChatLock!.sessionId !== sessionId) return false;
  activeChatLock = { sessionId, startedAt: Date.now() };
  return true;
}

export function releaseLock(sessionId: string): void {
  if (activeChatLock?.sessionId === sessionId) {
    activeChatLock = null;
  }
}

export function getLockStatus() {
  if (!activeChatLock) return { locked: false };
  if (Date.now() - activeChatLock.startedAt > LOCK_TIMEOUT_MS) {
    activeChatLock = null;
    return { locked: false };
  }
  return { locked: true, sessionId: activeChatLock.sessionId };
}

// ── Session ID Helper ─────────────────────────────────────────────
// Returns the user's openId if authenticated, otherwise "anon"
function getSessionId(ctx: { user?: { openId: string } | null }): string {
  return ctx.user?.openId || "anon";
}

/** Load conversation history from DB for a session */
export async function loadHistory(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userOpenId, sessionId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(MAX_HISTORY);

  // Reverse so oldest first
  return rows.reverse().map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

/** Save a message to the DB */
export async function saveMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  globeActions?: unknown[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(chatMessages).values({
    userOpenId: sessionId,
    role,
    content,
    globeActions: globeActions && globeActions.length > 0 ? globeActions : null,
    createdAt: Date.now(),
  });
}

// ── Router ─────────────────────────────────────────────────────────

export const chatRouter = router({
  /**
   * Send a message and get an AI response (non-streaming fallback).
   * For streaming, use the /api/chat/stream SSE endpoint instead.
   * PUBLIC — no auth required. 1 concurrent user limit.
   */
  sendMessage: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sessionId = getSessionId(ctx);

      // Check rate limit
      const rateCheck = checkRateLimit(sessionId);
      if (!rateCheck.allowed) {
        return {
          response: `You've sent too many messages. Please wait ${rateCheck.retryAfterSec} seconds before trying again.`,
          timestamp: Date.now(),
          busy: false,
          rateLimited: true,
          retryAfterSec: rateCheck.retryAfterSec,
        };
      }

      // Check concurrency lock
      if (!acquireLock(sessionId)) {
        return {
          response:
            "The Intelligence Analyst is currently assisting another user. Please wait a moment and try again.",
          timestamp: Date.now(),
          busy: true,
        };
      }

      try {
        // Save user message to DB
        await saveMessage(sessionId, "user", input.message);

        // Load conversation history from DB
        const history = await loadHistory(sessionId);

        // Process through RAG engine
        const response = await processChat(
          history.slice(0, -1), // Exclude the just-added user message
          input.message
        );

        // Save assistant response to DB
        await saveMessage(sessionId, "assistant", response);

        return {
          response,
          timestamp: Date.now(),
          busy: false,
        };
      } catch (error) {
        console.error("[Chat] RAG processing error:", error);

        const errorMsg =
          "I encountered an error while processing your request. Please try again or rephrase your question.";
        await saveMessage(sessionId, "assistant", errorMsg);

        return {
          response: errorMsg,
          timestamp: Date.now(),
          busy: false,
        };
      } finally {
        releaseLock(sessionId);
      }
    }),

  /**
   * Get the current conversation history.
   * PUBLIC — returns history for the session (authenticated user or "anon").
   */
  getHistory: publicProcedure.query(async ({ ctx }) => {
    const sessionId = getSessionId(ctx);
    const db = await getDb();
    if (!db) return { messages: [] };

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userOpenId, sessionId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(MAX_HISTORY);

    return {
      messages: rows.map((r: typeof chatMessages.$inferSelect) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        globeActions: r.globeActions as unknown[] | null,
        createdAt: r.createdAt,
      })),
    };
  }),

  /**
   * Clear the conversation history.
   * PUBLIC — clears history for the session.
   */
  clearHistory: publicProcedure.mutation(async ({ ctx }) => {
    const sessionId = getSessionId(ctx);
    const db = await getDb();
    if (!db) return { success: false };

    await db
      .delete(chatMessages)
      .where(eq(chatMessages.userOpenId, sessionId));

    return { success: true };
  }),

  /**
   * Check if the chat is currently busy (another user is being served).
   * PUBLIC — used by frontend to show busy indicator.
   */
  checkAvailability: publicProcedure.query(() => {
    const status = getLockStatus();
    return {
      available: !status.locked,
      message: status.locked
        ? "The Intelligence Analyst is currently assisting another user."
        : "Ready",
    };
  }),
});
