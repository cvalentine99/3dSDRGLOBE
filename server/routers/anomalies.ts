import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { anomalyAlerts, tdoaTargets } from "../../drizzle/schema";
import { eq, desc, and, like } from "drizzle-orm";
import {
  checkConflictZoneProximity,
  checkAllTargetsConflictZones,
  analyzeConflictProximity,
  getCachedConflictEvents,
  hasValidConflictCache,
  type ConflictEvent,
} from "../conflictZoneChecker";

export const anomaliesRouter = router({
  /** List anomaly alerts (optionally filter by type: all, position, conflict) */
  list: publicProcedure
    .input(z.object({
      acknowledged: z.boolean().optional(),
      alertType: z.enum(["all", "position", "conflict"]).optional(),
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

      // Enrich with target labels and determine alert type
      const enriched = await Promise.all(alerts.map(async (alert) => {
        const target = await db.select({ label: tdoaTargets.label, category: tdoaTargets.category })
          .from(tdoaTargets).where(eq(tdoaTargets.id, alert.targetId)).limit(1);

        // Determine if this is a conflict zone alert based on description prefix
        const isConflictAlert = alert.description?.startsWith("[CONFLICT ZONE]") ?? false;

        return {
          ...alert,
          targetLabel: target[0]?.label ?? "Unknown",
          targetCategory: target[0]?.category ?? "unknown",
          alertType: isConflictAlert ? "conflict" as const : "position" as const,
        };
      }));

      // Filter by alert type if specified
      if (input?.alertType && input.alertType !== "all") {
        return enriched.filter((a) => a.alertType === input.alertType);
      }

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

  /** Get unacknowledged alert count (optionally by type) */
  unacknowledgedCount: publicProcedure
    .input(z.object({
      alertType: z.enum(["all", "position", "conflict"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, positionCount: 0, conflictCount: 0 };
      const alerts = await db.select().from(anomalyAlerts)
        .where(eq(anomalyAlerts.acknowledged, false));

      let positionCount = 0;
      let conflictCount = 0;
      for (const a of alerts) {
        if (a.description?.startsWith("[CONFLICT ZONE]")) {
          conflictCount++;
        } else {
          positionCount++;
        }
      }

      return {
        count: alerts.length,
        positionCount,
        conflictCount,
      };
    }),

  /** Check a specific target for conflict zone proximity */
  checkConflictZone: publicProcedure
    .input(z.object({
      targetId: z.number(),
      lat: z.number(),
      lon: z.number(),
      historyEntryId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return await checkConflictZoneProximity(
        input.targetId,
        input.lat,
        input.lon,
        input.historyEntryId
      );
    }),

  /** Check ALL visible targets against active conflict zones */
  checkAllConflictZones: publicProcedure.query(async () => {
    return await checkAllTargetsConflictZones();
  }),

  /** Analyze conflict proximity for a position (no alert creation) */
  analyzePosition: publicProcedure
    .input(z.object({
      lat: z.number(),
      lon: z.number(),
    }))
    .query(({ input }) => {
      const events = getCachedConflictEvents();
      const analysis = analyzeConflictProximity(input.lat, input.lon, events);
      return {
        ...analysis,
        nearbyEvents: analysis.nearbyEvents.slice(0, 20), // Limit for payload size
        cacheAvailable: hasValidConflictCache(),
        totalCachedEvents: events.length,
      };
    }),
});
