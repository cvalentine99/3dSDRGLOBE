import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { anomalyAlerts, tdoaTargets } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const anomaliesRouter = router({
  /** List anomaly alerts */
  list: publicProcedure
    .input(z.object({
      acknowledged: z.boolean().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input?.acknowledged !== undefined) {
        conditions.push(eq(anomalyAlerts.acknowledged, input.acknowledged));
      }

      const alerts = conditions.length > 0
        ? await db.select().from(anomalyAlerts)
            .where(and(...conditions))
            .orderBy(desc(anomalyAlerts.createdAt))
            .limit(input?.limit ?? 50)
        : await db.select().from(anomalyAlerts)
            .orderBy(desc(anomalyAlerts.createdAt))
            .limit(input?.limit ?? 50);

      // Enrich with target labels
      const enriched = await Promise.all(alerts.map(async (alert) => {
        const target = await db.select({ label: tdoaTargets.label, category: tdoaTargets.category })
          .from(tdoaTargets).where(eq(tdoaTargets.id, alert.targetId)).limit(1);
        return {
          ...alert,
          targetLabel: target[0]?.label ?? "Unknown",
          targetCategory: target[0]?.category ?? "unknown",
        };
      }));

      return enriched;
    }),

  /** Acknowledge an anomaly alert */
  acknowledge: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(anomalyAlerts)
        .set({ acknowledged: true })
        .where(eq(anomalyAlerts.id, input.id));
      return { success: true };
    }),

  /** Dismiss (delete) an anomaly alert */
  dismiss: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(anomalyAlerts).where(eq(anomalyAlerts.id, input.id));
      return { success: true };
    }),

  /** Get unacknowledged alert count */
  unacknowledgedCount: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { count: 0 };
    const alerts = await db.select().from(anomalyAlerts)
      .where(eq(anomalyAlerts.acknowledged, false));
    return { count: alerts.length };
  }),
});
