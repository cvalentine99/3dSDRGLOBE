import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import {
  sharedTargetLists,
  sharedListMembers,
  sharedListTargets,
  tdoaTargets,
  users,
} from "../../drizzle/schema";
import { eq, desc, and, inArray } from "drizzle-orm";

export const sharingRouter = router({
  /** Create a new shared target list */
  createList: publicProcedure
    .input(z.object({
      name: z.string().min(1).max(256),
      description: z.string().max(1000).optional(),
      defaultPermission: z.enum(["view", "edit"]).default("view"),
      isPublic: z.boolean().default(false),
      targetIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const userId = ctx.user?.id;
      if (!userId) throw new Error("Authentication required");

      const token = Array.from({ length: 32 }, () =>
        "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
      ).join("");

      const now = Date.now();
      const [result] = await db.insert(sharedTargetLists).values({
        name: input.name,
        description: input.description || null,
        ownerId: userId,
        inviteToken: token,
        defaultPermission: input.defaultPermission,
        isPublic: input.isPublic,
        createdAt: now,
        updatedAt: now,
      });

      const listId = result.insertId;

      if (input.targetIds?.length && listId) {
        for (const targetId of input.targetIds) {
          await db.insert(sharedListTargets).values({
            listId,
            targetId,
            addedAt: now,
          });
        }
      }

      return { id: listId, inviteToken: token };
    }),

  /** Get all lists owned by or shared with the current user */
  myLists: publicProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const userId = ctx.user?.id;
    if (!userId) return [];

    const owned = await db.select().from(sharedTargetLists)
      .where(eq(sharedTargetLists.ownerId, userId))
      .orderBy(desc(sharedTargetLists.updatedAt));

    const memberships = await db.select().from(sharedListMembers)
      .where(eq(sharedListMembers.userId, userId));

    const memberListIds = memberships.map(m => m.listId);
    let memberLists: typeof owned = [];
    if (memberListIds.length > 0) {
      memberLists = await db.select().from(sharedTargetLists)
        .where(inArray(sharedTargetLists.id, memberListIds));
    }

    const allLists = [...owned];
    for (const ml of memberLists) {
      if (!allLists.some(l => l.id === ml.id)) {
        allLists.push(ml);
      }
    }

    const enriched = await Promise.all(allLists.map(async (list) => {
      const members = await db.select().from(sharedListMembers)
        .where(eq(sharedListMembers.listId, list.id));
      const targets = await db.select().from(sharedListTargets)
        .where(eq(sharedListTargets.listId, list.id));
      return {
        ...list,
        memberCount: members.length + 1,
        targetCount: targets.length,
        isOwner: list.ownerId === userId,
        permission: list.ownerId === userId ? "owner" as const :
          memberships.find(m => m.listId === list.id)?.permission ?? "view" as const,
      };
    }));

    return enriched;
  }),

  /** Get a shared list by invite token (for joining) */
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const lists = await db.select().from(sharedTargetLists)
        .where(eq(sharedTargetLists.inviteToken, input.token))
        .limit(1);
      if (!lists.length) return null;

      const list = lists[0];
      const owner = await db.select({ name: users.name }).from(users)
        .where(eq(users.id, list.ownerId)).limit(1);
      const targets = await db.select().from(sharedListTargets)
        .where(eq(sharedListTargets.listId, list.id));
      const members = await db.select().from(sharedListMembers)
        .where(eq(sharedListMembers.listId, list.id));

      return {
        id: list.id,
        name: list.name,
        description: list.description,
        ownerName: owner[0]?.name ?? "Unknown",
        defaultPermission: list.defaultPermission,
        isPublic: list.isPublic,
        memberCount: members.length + 1,
        targetCount: targets.length,
      };
    }),

  /** Join a shared list via invite token */
  joinByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const userId = ctx.user?.id;
      if (!userId) throw new Error("Authentication required");

      const lists = await db.select().from(sharedTargetLists)
        .where(eq(sharedTargetLists.inviteToken, input.token))
        .limit(1);
      if (!lists.length) throw new Error("Invalid invite link");

      const list = lists[0];

      if (list.ownerId === userId) {
        return { success: true, listId: list.id, message: "You own this list" };
      }

      const existing = await db.select().from(sharedListMembers)
        .where(and(
          eq(sharedListMembers.listId, list.id),
          eq(sharedListMembers.userId, userId)
        ))
        .limit(1);

      if (existing.length) {
        return { success: true, listId: list.id, message: "Already a member" };
      }

      await db.insert(sharedListMembers).values({
        listId: list.id,
        userId,
        permission: list.defaultPermission,
        joinedAt: Date.now(),
      });

      return { success: true, listId: list.id, message: "Joined successfully" };
    }),

  /** Get targets in a shared list */
  getListTargets: publicProcedure
    .input(z.object({ listId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const listTargetRows = await db.select().from(sharedListTargets)
        .where(eq(sharedListTargets.listId, input.listId));

      if (!listTargetRows.length) return [];

      const targetIds = listTargetRows.map(lt => lt.targetId);
      const targets = await db.select().from(tdoaTargets)
        .where(inArray(tdoaTargets.id, targetIds));

      return targets;
    }),

  /** Add targets to a shared list */
  addTargets: publicProcedure
    .input(z.object({
      listId: z.number(),
      targetIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const existing = await db.select().from(sharedListTargets)
        .where(eq(sharedListTargets.listId, input.listId));
      const existingIds = new Set(existing.map(e => e.targetId));

      const now = Date.now();
      let added = 0;
      for (const targetId of input.targetIds) {
        if (!existingIds.has(targetId)) {
          await db.insert(sharedListTargets).values({
            listId: input.listId,
            targetId,
            addedAt: now,
          });
          added++;
        }
      }

      await db.update(sharedTargetLists)
        .set({ updatedAt: now })
        .where(eq(sharedTargetLists.id, input.listId));

      return { added };
    }),

  /** Remove a target from a shared list */
  removeTarget: publicProcedure
    .input(z.object({
      listId: z.number(),
      targetId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(sharedListTargets)
        .where(and(
          eq(sharedListTargets.listId, input.listId),
          eq(sharedListTargets.targetId, input.targetId)
        ));
      return { success: true };
    }),

  /** Remove a member from a shared list */
  removeMember: publicProcedure
    .input(z.object({
      listId: z.number(),
      userId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(sharedListMembers)
        .where(and(
          eq(sharedListMembers.listId, input.listId),
          eq(sharedListMembers.userId, input.userId)
        ));
      return { success: true };
    }),

  /** Delete a shared list (owner only) */
  deleteList: publicProcedure
    .input(z.object({ listId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const userId = ctx.user?.id;
      if (!userId) throw new Error("Authentication required");

      const lists = await db.select().from(sharedTargetLists)
        .where(eq(sharedTargetLists.id, input.listId))
        .limit(1);
      if (!lists.length) throw new Error("List not found");
      if (lists[0].ownerId !== userId) throw new Error("Only the owner can delete this list");

      await db.delete(sharedListMembers).where(eq(sharedListMembers.listId, input.listId));
      await db.delete(sharedListTargets).where(eq(sharedListTargets.listId, input.listId));
      await db.delete(sharedTargetLists).where(eq(sharedTargetLists.id, input.listId));

      return { success: true };
    }),

  /** Get list members */
  getMembers: publicProcedure
    .input(z.object({ listId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const members = await db.select().from(sharedListMembers)
        .where(eq(sharedListMembers.listId, input.listId));

      const enriched = await Promise.all(members.map(async (m) => {
        const user = await db.select({ name: users.name }).from(users)
          .where(eq(users.id, m.userId)).limit(1);
        return {
          ...m,
          userName: user[0]?.name ?? "Unknown",
        };
      }));

      return enriched;
    }),
});
