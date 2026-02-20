/**
 * chat.ts — tRPC router for the HybridRAG chat assistant
 *
 * Provides endpoints for:
 * - Sending messages and getting AI responses
 * - Retrieving conversation history
 * - Clearing conversation history
 *
 * Messages are stored in-memory per session (no DB table needed).
 * The RAG engine handles tool-calling and data retrieval.
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { processChat, type ChatMessage } from "../ragEngine";

// ── In-Memory Conversation Store ───────────────────────────────────
// Keyed by user openId. Each user gets their own conversation history.
// Conversations are cleared on server restart (ephemeral by design).

const MAX_HISTORY_PER_USER = 50; // Keep last 50 messages per user
const conversations = new Map<string, ChatMessage[]>();

function getConversation(userId: string): ChatMessage[] {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  return conversations.get(userId)!;
}

function addMessage(userId: string, msg: ChatMessage): void {
  const conv = getConversation(userId);
  conv.push(msg);
  // Trim to max history (keep recent messages)
  if (conv.length > MAX_HISTORY_PER_USER) {
    const excess = conv.length - MAX_HISTORY_PER_USER;
    conv.splice(0, excess);
  }
}

// ── Router ─────────────────────────────────────────────────────────

export const chatRouter = router({
  /**
   * Send a message and get an AI response.
   * The RAG engine will query relevant data sources and synthesize a response.
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.openId;
      const history = getConversation(userId);

      // Add user message to history
      addMessage(userId, { role: "user", content: input.message });

      try {
        // Process through RAG engine (passes conversation history for context)
        const response = await processChat(history.slice(0, -1), input.message);

        // Add assistant response to history
        addMessage(userId, { role: "assistant", content: response });

        return {
          response,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error("[Chat] RAG processing error:", error);

        const errorMsg =
          "I encountered an error while processing your request. Please try again or rephrase your question.";
        addMessage(userId, { role: "assistant", content: errorMsg });

        return {
          response: errorMsg,
          timestamp: Date.now(),
        };
      }
    }),

  /**
   * Get the current conversation history for the authenticated user.
   */
  getHistory: protectedProcedure.query(({ ctx }) => {
    const userId = ctx.user.openId;
    const history = getConversation(userId);
    return {
      messages: history.map((m, i) => ({
        id: i,
        role: m.role,
        content: m.content,
      })),
    };
  }),

  /**
   * Clear the conversation history for the authenticated user.
   */
  clearHistory: protectedProcedure.mutation(({ ctx }) => {
    const userId = ctx.user.openId;
    conversations.delete(userId);
    return { success: true };
  }),
});
