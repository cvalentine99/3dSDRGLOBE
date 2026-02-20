/**
 * chat.ts — tRPC router for the HybridRAG chat assistant
 *
 * Provides endpoints for:
 * - Sending messages and getting AI responses (non-streaming fallback)
 * - Retrieving conversation history from database
 * - Clearing conversation history from database
 *
 * Messages are persisted in the chat_messages table.
 * SSE streaming is handled by a separate Express endpoint.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { processChat, type ChatMessage } from "../ragEngine";
import { getDb } from "../db";
import { chatMessages } from "../../drizzle/schema";
import { eq, desc, asc } from "drizzle-orm";

const MAX_HISTORY = 50;

/** Load conversation history from DB for a user */
export async function loadHistory(userOpenId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userOpenId, userOpenId))
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
  userOpenId: string,
  role: "user" | "assistant",
  content: string,
  globeActions?: unknown[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(chatMessages).values({
    userOpenId,
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
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.openId;

      // Save user message to DB
      await saveMessage(userId, "user", input.message);

      // Load conversation history from DB
      const history = await loadHistory(userId);

      try {
        // Process through RAG engine
        const response = await processChat(
          history.slice(0, -1), // Exclude the just-added user message
          input.message
        );

        // Save assistant response to DB
        await saveMessage(userId, "assistant", response);

        return {
          response,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error("[Chat] RAG processing error:", error);

        const errorMsg =
          "I encountered an error while processing your request. Please try again or rephrase your question.";
        await saveMessage(userId, "assistant", errorMsg);

        return {
          response: errorMsg,
          timestamp: Date.now(),
        };
      }
    }),

  /**
   * Get the current conversation history for the authenticated user.
   */
  getHistory: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.openId;
    const db = await getDb();
    if (!db) return { messages: [] };

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userOpenId, userId))
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
   * Clear the conversation history for the authenticated user.
   */
  clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.openId;
    const db = await getDb();
    if (!db) return { success: false };

    await db
      .delete(chatMessages)
      .where(eq(chatMessages.userOpenId, userId));

    return { success: true };
  }),
});
