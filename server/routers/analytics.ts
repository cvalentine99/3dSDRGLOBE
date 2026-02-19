import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import {
  tdoaTargets,
  tdoaTargetHistory,
  tdoaJobs,
  tdoaRecordings,
  signalFingerprints,
  anomalyAlerts,
  sharedTargetLists,
  sharedListMembers,
  receivers,
} from "../../drizzle/schema";
import { count, eq, desc, asc, gte } from "drizzle-orm";

export const analyticsRouter = router({
  /** Summary statistics for the dashboard */
  summary: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {
      totalTargets: 0, totalJobs: 0, completedJobs: 0,
      totalRecordings: 0, totalFingerprints: 0,
      activeAnomalies: 0, totalAnomalies: 0,
      sharedLists: 0, totalMembers: 0,
      receiversOnline: 0, receiversTotal: 0,
    };

    const [targetCount] = await db.select({ c: count() }).from(tdoaTargets);
    const [jobCount] = await db.select({ c: count() }).from(tdoaJobs);
    const [completedJobCount] = await db.select({ c: count() }).from(tdoaJobs).where(eq(tdoaJobs.status, "complete"));
    const [recordingCount] = await db.select({ c: count() }).from(tdoaRecordings);
    const [fingerprintCount] = await db.select({ c: count() }).from(signalFingerprints);
    const [activeAnomalyCount] = await db.select({ c: count() }).from(anomalyAlerts).where(eq(anomalyAlerts.acknowledged, false));
    const [totalAnomalyCount] = await db.select({ c: count() }).from(anomalyAlerts);
    const [sharedListCount] = await db.select({ c: count() }).from(sharedTargetLists);
    const [memberCount] = await db.select({ c: count() }).from(sharedListMembers);
    const [onlineReceiverCount] = await db.select({ c: count() }).from(receivers).where(eq(receivers.lastOnline, true));
    const [totalReceiverCount] = await db.select({ c: count() }).from(receivers);

    return {
      totalTargets: targetCount.c,
      totalJobs: jobCount.c,
      completedJobs: completedJobCount.c,
      totalRecordings: recordingCount.c,
      totalFingerprints: fingerprintCount.c,
      activeAnomalies: activeAnomalyCount.c,
      totalAnomalies: totalAnomalyCount.c,
      sharedLists: sharedListCount.c,
      totalMembers: memberCount.c,
      receiversOnline: onlineReceiverCount.c,
      receiversTotal: totalReceiverCount.c,
    };
  }),

  /** Target count by category */
  targetsByCategory: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const results = await db
      .select({ category: tdoaTargets.category, count: count() })
      .from(tdoaTargets)
      .groupBy(tdoaTargets.category);
    return results.map(r => ({ category: r.category, count: r.count }));
  }),

  /** Anomaly frequency over time (grouped by day) */
  anomalyTrend: publicProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const days = input?.days ?? 30;
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

      const alerts = await db.select({ severity: anomalyAlerts.severity, createdAt: anomalyAlerts.createdAt })
        .from(anomalyAlerts).where(gte(anomalyAlerts.createdAt, startTime)).orderBy(asc(anomalyAlerts.createdAt));

      const dayMap = new Map<string, { low: number; medium: number; high: number; total: number }>();
      for (const alert of alerts) {
        const date = new Date(alert.createdAt).toISOString().split("T")[0];
        const entry = dayMap.get(date) ?? { low: 0, medium: 0, high: 0, total: 0 };
        entry[alert.severity]++;
        entry.total++;
        dayMap.set(date, entry);
      }

      const result: Array<{ date: string; low: number; medium: number; high: number; total: number }> = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        result.push({ date: dateStr, ...(dayMap.get(dateStr) ?? { low: 0, medium: 0, high: 0, total: 0 }) });
      }
      return result;
    }),

  /** TDoA job activity over time (grouped by day) */
  jobTrend: publicProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const days = input?.days ?? 30;
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

      const jobs = await db.select({ status: tdoaJobs.status, createdAt: tdoaJobs.createdAt })
        .from(tdoaJobs).where(gte(tdoaJobs.createdAt, startTime)).orderBy(asc(tdoaJobs.createdAt));

      const dayMap = new Map<string, { complete: number; error: number; pending: number; total: number }>();
      for (const job of jobs) {
        const date = new Date(job.createdAt).toISOString().split("T")[0];
        const entry = dayMap.get(date) ?? { complete: 0, error: 0, pending: 0, total: 0 };
        if (job.status === "complete") entry.complete++;
        else if (job.status === "error") entry.error++;
        else entry.pending++;
        entry.total++;
        dayMap.set(date, entry);
      }

      const result: Array<{ date: string; complete: number; error: number; pending: number; total: number }> = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        result.push({ date: dateStr, ...(dayMap.get(dateStr) ?? { complete: 0, error: 0, pending: 0, total: 0 }) });
      }
      return result;
    }),

  /** Top fingerprint matches — most frequently fingerprinted targets */
  topFingerprints: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 10;

      const results = await db
        .select({ targetId: signalFingerprints.targetId, count: count() })
        .from(signalFingerprints)
        .groupBy(signalFingerprints.targetId)
        .orderBy(desc(count()))
        .limit(limit);

      const enriched = await Promise.all(
        results.map(async (r) => {
          const target = await db
            .select({ label: tdoaTargets.label, category: tdoaTargets.category, frequencyKhz: tdoaTargets.frequencyKhz })
            .from(tdoaTargets).where(eq(tdoaTargets.id, r.targetId)).limit(1);
          return {
            targetId: r.targetId,
            fingerprintCount: r.count,
            label: target[0]?.label ?? "Unknown",
            category: target[0]?.category ?? "unknown",
            frequencyKhz: target[0]?.frequencyKhz ?? null,
          };
        })
      );
      return enriched;
    }),

  /** Recent activity feed — latest events across all subsystems */
  recentActivity: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 20;

      const activities: Array<{
        type: "job" | "anomaly" | "target" | "recording" | "fingerprint";
        id: number; label: string; detail: string; timestamp: number;
      }> = [];

      const recentJobs = await db.select().from(tdoaJobs).orderBy(desc(tdoaJobs.createdAt)).limit(limit);
      for (const job of recentJobs) {
        activities.push({
          type: "job", id: job.id,
          label: `TDoA Job #${job.id}`,
          detail: `${job.frequencyKhz} kHz — ${job.status}${job.likelyLat ? ` → ${parseFloat(job.likelyLat).toFixed(2)}°, ${parseFloat(job.likelyLon!).toFixed(2)}°` : ""}`,
          timestamp: job.createdAt,
        });
      }

      const recentAnomalies = await db.select().from(anomalyAlerts).orderBy(desc(anomalyAlerts.createdAt)).limit(limit);
      for (const alert of recentAnomalies) {
        const target = await db.select({ label: tdoaTargets.label }).from(tdoaTargets).where(eq(tdoaTargets.id, alert.targetId)).limit(1);
        activities.push({
          type: "anomaly", id: alert.id,
          label: `Anomaly: ${target[0]?.label ?? "Unknown"}`,
          detail: `${alert.severity.toUpperCase()} — ${alert.deviationKm.toFixed(1)} km (${alert.deviationSigma.toFixed(1)}σ)`,
          timestamp: alert.createdAt,
        });
      }

      const recentTargets = await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt)).limit(limit);
      for (const target of recentTargets) {
        activities.push({
          type: "target", id: target.id,
          label: `Target: ${target.label}`,
          detail: `${target.category} — ${parseFloat(target.lat).toFixed(2)}°, ${parseFloat(target.lon).toFixed(2)}°`,
          timestamp: target.createdAt,
        });
      }

      const recentFingerprints = await db.select().from(signalFingerprints).orderBy(desc(signalFingerprints.createdAt)).limit(limit);
      for (const fp of recentFingerprints) {
        const target = await db.select({ label: tdoaTargets.label }).from(tdoaTargets).where(eq(tdoaTargets.id, fp.targetId)).limit(1);
        activities.push({
          type: "fingerprint", id: fp.id,
          label: `Fingerprint: ${target[0]?.label ?? "Unknown"}`,
          detail: `${fp.frequencyKhz ?? "?"} kHz${fp.mode ? ` ${fp.mode}` : ""}`,
          timestamp: fp.createdAt,
        });
      }

      activities.sort((a, b) => b.timestamp - a.timestamp);
      return activities.slice(0, limit);
    }),

  /** Receiver status breakdown */
  receiverStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { byType: [], byStatus: { online: 0, offline: 0 } };

    const byType = await db
      .select({ receiverType: receivers.receiverType, count: count() })
      .from(receivers).groupBy(receivers.receiverType);

    const [onlineCount] = await db.select({ c: count() }).from(receivers).where(eq(receivers.lastOnline, true));
    const [offlineCount] = await db.select({ c: count() }).from(receivers).where(eq(receivers.lastOnline, false));

    return {
      byType: byType.map(r => ({ type: r.receiverType, count: r.count })),
      byStatus: { online: onlineCount.c, offline: offlineCount.c },
    };
  }),

  /** Position history heatmap data */
  positionHeatmap: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const positions = await db
      .select({ lat: tdoaTargetHistory.lat, lon: tdoaTargetHistory.lon, targetId: tdoaTargetHistory.targetId })
      .from(tdoaTargetHistory).orderBy(desc(tdoaTargetHistory.observedAt)).limit(500);
    return positions.map(p => ({ lat: parseFloat(p.lat), lon: parseFloat(p.lon), targetId: p.targetId }));
  }),
});
