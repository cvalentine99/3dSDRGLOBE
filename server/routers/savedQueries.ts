/**
 * savedQueries.ts — tRPC router for saved/bookmarked chat prompts
 *
 * Provides CRUD endpoints for managing saved queries with:
 * - Category-based organization
 * - Pin/unpin for favorites
 * - Usage tracking (count + last used timestamp)
 * - One-click re-run support
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { savedQueries } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const CATEGORY_VALUES = [
  "general",
  "receivers",
  "targets",
  "conflicts",
  "anomalies",
  "geofence",
  "system",
] as const;

export const savedQueriesRouter = router({
  /**
   * List all saved queries for the authenticated user.
   * Pinned queries come first, then sorted by last used / created.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { queries: [] };

    const rows = await db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.userOpenId, ctx.user.openId))
      .orderBy(desc(savedQueries.pinned), desc(savedQueries.lastUsedAt));

    return {
      queries: rows.map((r) => ({
        id: r.id,
        name: r.name,
        prompt: r.prompt,
        category: r.category,
        pinned: r.pinned,
        usageCount: r.usageCount,
        lastUsedAt: r.lastUsedAt,
        createdAt: r.createdAt,
      })),
    };
  }),

  /**
   * Create a new saved query.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        prompt: z.string().min(1).max(4000),
        category: z.enum(CATEGORY_VALUES).default("general"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false, id: null };

      const now = Date.now();
      const result = await db.insert(savedQueries).values({
        userOpenId: ctx.user.openId,
        name: input.name,
        prompt: input.prompt,
        category: input.category,
        pinned: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { success: true, id: result[0].insertId };
    }),

  /**
   * Update a saved query (name, prompt, category).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        prompt: z.string().min(1).max(4000).optional(),
        category: z.enum(CATEGORY_VALUES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.prompt !== undefined) updates.prompt = input.prompt;
      if (input.category !== undefined) updates.category = input.category;

      await db
        .update(savedQueries)
        .set(updates)
        .where(
          and(
            eq(savedQueries.id, input.id),
            eq(savedQueries.userOpenId, ctx.user.openId)
          )
        );

      return { success: true };
    }),

  /**
   * Delete a saved query.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await db
        .delete(savedQueries)
        .where(
          and(
            eq(savedQueries.id, input.id),
            eq(savedQueries.userOpenId, ctx.user.openId)
          )
        );

      return { success: true };
    }),

  /**
   * Toggle pin status for a saved query.
   */
  togglePin: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      // Get current pin status
      const existing = await db
        .select({ pinned: savedQueries.pinned })
        .from(savedQueries)
        .where(
          and(
            eq(savedQueries.id, input.id),
            eq(savedQueries.userOpenId, ctx.user.openId)
          )
        )
        .limit(1);

      if (existing.length === 0) return { success: false };

      await db
        .update(savedQueries)
        .set({
          pinned: !existing[0].pinned,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(savedQueries.id, input.id),
            eq(savedQueries.userOpenId, ctx.user.openId)
          )
        );

      return { success: true, pinned: !existing[0].pinned };
    }),

  /**
   * Record usage of a saved query (increment count + update lastUsedAt).
   */
  recordUsage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await db
        .update(savedQueries)
        .set({
          usageCount: sql`${savedQueries.usageCount} + 1`,
          lastUsedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(savedQueries.id, input.id),
            eq(savedQueries.userOpenId, ctx.user.openId)
          )
        );

      return { success: true };
    }),
});
