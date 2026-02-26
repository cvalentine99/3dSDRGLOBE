/**
 * briefings.ts — tRPC router for intelligence briefings
 *
 * Provides endpoints for:
 * - Generating on-demand briefings from live data
 * - Listing past briefings
 * - Getting the latest briefing
 * - Marking briefings as read
 *
 * Briefings combine receiver health, conflict events, anomaly alerts,
 * and system stats into a single intelligence digest.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  briefings,
  receivers,
  anomalyAlerts,
  scanCycles,
  conflictSweepHistory,
} from "../../drizzle/schema";
import { eq, desc, and, gte, sql, count } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { getCachedConflictEvents, hasValidConflictCache, type ConflictEvent } from "../conflictZoneChecker";
import { fetchUcdpEvents, slimEvent } from "./ucdp";

// ── Briefing Data Collector ─────────────────────────────────────

interface BriefingData {
  receiverHealth: {
    total: number;
    online: number;
    offline: number;
    onlinePercent: number;
    byType: Record<string, { total: number; online: number }>;
  };
  recentAlerts: {
    total: number;
    bySeverity: Record<string, number>;
    recent: Array<{
      type: string;
      severity: string;
      message: string;
      createdAt: number;
    }>;
  };
  conflictEvents: {
    total: number;
    totalFatalities: number;
    topByFatalities: Array<{
      country: string;
      region: string;
      fatalities: number;
      type: string;
    }>;
  };
  latestScan: {
    cycleNumber: number;
    totalReceivers: number;
    onlineCount: number;
    durationSec: number | null;
    completedAt: number | null;
  } | null;
  latestSweep: {
    targetsChecked: number;
    targetsInConflict: number;
    newAlerts: number;
    createdAt: number;
  } | null;
}

async function collectBriefingData(): Promise<BriefingData> {
  const db = await getDb();

  // Receiver health
  let receiverHealth: BriefingData["receiverHealth"] = {
    total: 0,
    online: 0,
    offline: 0,
    onlinePercent: 0,
    byType: {},
  };

  if (db) {
    const allReceivers = await db
      .select({
        receiverType: receivers.receiverType,
        lastOnline: receivers.lastOnline,
      })
      .from(receivers);

    receiverHealth.total = allReceivers.length;
    receiverHealth.online = allReceivers.filter((r) => r.lastOnline).length;
    receiverHealth.offline = receiverHealth.total - receiverHealth.online;
    receiverHealth.onlinePercent =
      receiverHealth.total > 0
        ? Math.round((receiverHealth.online / receiverHealth.total) * 100)
        : 0;

    for (const r of allReceivers) {
      if (!receiverHealth.byType[r.receiverType]) {
        receiverHealth.byType[r.receiverType] = { total: 0, online: 0 };
      }
      receiverHealth.byType[r.receiverType].total++;
      if (r.lastOnline) receiverHealth.byType[r.receiverType].online++;
    }
  }

  // Recent alerts (last 24h)
  let recentAlerts: BriefingData["recentAlerts"] = {
    total: 0,
    bySeverity: {},
    recent: [],
  };

  if (db) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const alerts = await db
      .select()
      .from(anomalyAlerts)
      .where(gte(anomalyAlerts.createdAt, oneDayAgo))
      .orderBy(desc(anomalyAlerts.createdAt))
      .limit(20);

    recentAlerts.total = alerts.length;
    for (const a of alerts) {
      const sev = a.severity || "info";
      recentAlerts.bySeverity[sev] = (recentAlerts.bySeverity[sev] || 0) + 1;
    }
    recentAlerts.recent = alerts.slice(0, 5).map((a) => ({
      type: "position_anomaly",
      severity: a.severity || "info",
      message: a.description || `Deviation: ${a.deviationKm.toFixed(1)}km (${a.deviationSigma.toFixed(1)}σ)`,
      createdAt: a.createdAt,
    }));
  }

  // Conflict events
  let conflictEvents: BriefingData["conflictEvents"] = {
    total: 0,
    totalFatalities: 0,
    topByFatalities: [],
  };

  let events = getCachedConflictEvents();
  if (events.length === 0 && !hasValidConflictCache()) {
    try {
      const result = await fetchUcdpEvents({ maxPages: 5 });
      if (result.events.length > 0) {
        const slimEvents = result.events.map(slimEvent);
        events = slimEvents;
      }
    } catch { /* ignore */ }
  }

  if (events.length > 0) {
    conflictEvents.total = events.length;
    conflictEvents.totalFatalities = events.reduce(
      (sum, e) => sum + (Number(e.best) || 0),
      0
    );
    const sorted = [...events].sort(
      (a, b) => (Number(b.best) || 0) - (Number(a.best) || 0)
    );
    conflictEvents.topByFatalities = sorted.slice(0, 5).map((e) => ({
      country: e.country || "Unknown",
      region: e.region || "",
      fatalities: Number(e.best) || 0,
      type: String(e.type) || "",
    }));
  }

  // Latest scan cycle
  let latestScan: BriefingData["latestScan"] = null;
  if (db) {
    const scans = await db
      .select()
      .from(scanCycles)
      .orderBy(desc(scanCycles.id))
      .limit(1);

    if (scans.length > 0) {
      const s = scans[0];
      latestScan = {
        cycleNumber: s.cycleNumber,
        totalReceivers: s.totalReceivers,
        onlineCount: s.onlineCount,
        durationSec: s.durationSec,
        completedAt: s.completedAt,
      };
    }
  }

  // Latest sweep
  let latestSweep: BriefingData["latestSweep"] = null;
  if (db) {
    const sweeps = await db
      .select()
      .from(conflictSweepHistory)
      .orderBy(desc(conflictSweepHistory.id))
      .limit(1);

    if (sweeps.length > 0) {
      const sw = sweeps[0];
      latestSweep = {
        targetsChecked: sw.targetsChecked,
        targetsInConflict: sw.targetsInConflict,
        newAlerts: sw.newAlerts,
        createdAt: sw.createdAt,
      };
    }
  }

  return {
    receiverHealth,
    recentAlerts,
    conflictEvents,
    latestScan,
    latestSweep,
  };
}

// ── Briefing Generator ──────────────────────────────────────────

async function generateBriefingContent(
  data: BriefingData,
  briefingType: "daily" | "weekly" | "on_demand"
): Promise<{ title: string; content: string }> {
  const typeLabel =
    briefingType === "daily"
      ? "Daily"
      : briefingType === "weekly"
      ? "Weekly"
      : "On-Demand";

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const prompt = `Generate a concise intelligence briefing for the Valentine RF SIGINT platform. This is a ${typeLabel} briefing for ${dateStr}.

## Data Summary

### Receiver Network Health
- Total receivers: ${data.receiverHealth.total}
- Online: ${data.receiverHealth.online} (${data.receiverHealth.onlinePercent}%)
- Offline: ${data.receiverHealth.offline}
- By type: ${JSON.stringify(data.receiverHealth.byType)}

### Recent Alerts (Last 24h)
- Total: ${data.recentAlerts.total}
- By severity: ${JSON.stringify(data.recentAlerts.bySeverity)}
- Recent alerts: ${JSON.stringify(data.recentAlerts.recent.slice(0, 3))}

### Conflict Events
- Total events: ${data.conflictEvents.total}
- Total fatalities: ${data.conflictEvents.totalFatalities}
- Top by fatalities: ${JSON.stringify(data.conflictEvents.topByFatalities)}

### Latest Scan Cycle
${data.latestScan ? JSON.stringify(data.latestScan) : "No scan data available"}

### Latest Conflict Sweep
${data.latestSweep ? JSON.stringify(data.latestSweep) : "No sweep data available"}

## Instructions
Write a professional intelligence briefing in markdown format. Include:
1. **Executive Summary** — 2-3 sentence overview of the current situation
2. **Network Status** — Receiver health with notable changes or concerns
3. **Threat Assessment** — Conflict events and anomaly alerts summary
4. **Key Findings** — 3-5 bullet points of the most important observations
5. **Recommended Actions** — 2-3 actionable recommendations

Use military/intelligence terminology. Be concise and data-driven. Do NOT include any [SUGGESTION:...] or [GLOBE:...] markers.`;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a senior intelligence analyst producing briefings for the Valentine RF SIGINT platform. Write in a professional, concise military intelligence style.",
        },
        { role: "user", content: prompt },
      ],
    });

    const content =
      response.choices?.[0]?.message?.content || "Briefing generation failed.";

    return {
      title: `${typeLabel} Intelligence Briefing — ${dateStr}`,
      content: typeof content === "string" ? content : "Briefing generation failed.",
    };
  } catch (err) {
    console.error("[Briefings] LLM generation error:", err);
    return {
      title: `${typeLabel} Intelligence Briefing — ${dateStr}`,
      content: `## Briefing Generation Error\n\nUnable to generate LLM summary. Raw data follows:\n\n### Receiver Health\n- Online: ${data.receiverHealth.online}/${data.receiverHealth.total} (${data.receiverHealth.onlinePercent}%)\n\n### Alerts (24h)\n- Total: ${data.recentAlerts.total}\n\n### Conflict Events\n- Total: ${data.conflictEvents.total}, Fatalities: ${data.conflictEvents.totalFatalities}`,
    };
  }
}

// ── Router ──────────────────────────────────────────────────────

export const briefingsRouter = router({
  /**
   * Generate a new briefing on demand.
   */
  generate: protectedProcedure
    .input(
      z
        .object({
          type: z.enum(["daily", "weekly", "on_demand"]).default("on_demand"),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const briefingType = input?.type || "on_demand";
      const db = await getDb();

      // Collect data from all sources
      const data = await collectBriefingData();

      // Generate briefing content via LLM
      const { title, content } = await generateBriefingContent(
        data,
        briefingType
      );

      const dataSources = [
        "receivers",
        "anomaly_alerts",
        "conflict_events",
        "scan_cycles",
        "conflict_sweeps",
      ];

      // Persist to DB
      if (db) {
        const result = await db.insert(briefings).values({
          userOpenId: ctx.user.openId,
          title,
          content,
          briefingType,
          stats: {
            receiversOnline: data.receiverHealth.online,
            receiversTotal: data.receiverHealth.total,
            alertCount: data.recentAlerts.total,
            conflictEvents: data.conflictEvents.total,
          },
          dataSources,
          isRead: false,
          generatedAt: Date.now(),
        });

        return {
          id: result[0].insertId,
          title,
          content,
          briefingType,
          generatedAt: Date.now(),
        };
      }

      return {
        id: null,
        title,
        content,
        briefingType,
        generatedAt: Date.now(),
      };
    }),

  /**
   * List past briefings for the authenticated user.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(10),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { briefings: [] };

      const rows = await db
        .select()
        .from(briefings)
        .where(eq(briefings.userOpenId, ctx.user.openId))
        .orderBy(desc(briefings.generatedAt))
        .limit(input?.limit || 10);

      return {
        briefings: rows.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          briefingType: r.briefingType,
          stats: r.stats as Record<string, number> | null,
          dataSources: r.dataSources as string[] | null,
          isRead: r.isRead,
          generatedAt: r.generatedAt,
        })),
      };
    }),

  /**
   * Get the latest briefing for the authenticated user.
   */
  getLatest: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { briefing: null };

    const rows = await db
      .select()
      .from(briefings)
      .where(eq(briefings.userOpenId, ctx.user.openId))
      .orderBy(desc(briefings.generatedAt))
      .limit(1);

    if (rows.length === 0) return { briefing: null };

    const r = rows[0];
    return {
      briefing: {
        id: r.id,
        title: r.title,
        content: r.content,
        briefingType: r.briefingType,
        stats: r.stats as Record<string, number> | null,
        dataSources: r.dataSources as string[] | null,
        isRead: r.isRead,
        generatedAt: r.generatedAt,
      },
    };
  }),

  /**
   * Mark a briefing as read.
   */
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await db
        .update(briefings)
        .set({ isRead: true })
        .where(
          and(
            eq(briefings.id, input.id),
            eq(briefings.userOpenId, ctx.user.openId)
          )
        );

      return { success: true };
    }),

  /**
   * Get unread briefing count for badge display.
   */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { count: 0 };

    const result = await db
      .select({ count: count() })
      .from(briefings)
      .where(
        and(
          eq(briefings.userOpenId, ctx.user.openId),
          eq(briefings.isRead, false)
        )
      );

    return { count: result[0]?.count || 0 };
  }),
});

// ── Export for scheduled generation ─────────────────────────────

export { collectBriefingData, generateBriefingContent };
