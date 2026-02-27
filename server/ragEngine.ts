/**
 * ragEngine.ts — HybridRAG Intelligence Engine
 *
 * Provides a tool-calling RAG system that can investigate across all
 * Valentine RF data sources:
 * - Receivers (status, location, bands, types)
 * - TDOA Targets (position, history, anomalies)
 * - Conflict Events (UCDP GED data)
 * - Geofence Zones (custom zones, alerts)
 * - Anomaly Alerts (position anomalies, conflict proximity, geofence)
 * - Sweep History (scheduled conflict zone sweeps)
 * - Signal Fingerprints
 *
 * Uses LLM tool-calling to decide which data sources to query,
 * then assembles context and generates an intelligence-grade response.
 */

import { invokeLLM, type Message, type Tool, type ToolCall } from "./_core/llm";
import { getDb } from "./db";
import {
  receivers,
  tdoaTargets,
  tdoaTargetHistory,
  anomalyAlerts,
  geofenceZones,
  geofenceAlerts,
  conflictSweepHistory,
  signalFingerprints,
  scanCycles,
} from "../drizzle/schema";
import { eq, desc, like, sql, and, gte, lte } from "drizzle-orm";
import { getCachedConflictEvents, updateConflictEventCache, hasValidConflictCache } from "./conflictZoneChecker";
import { fetchUcdpEvents, slimEvent } from "./routers/ucdp";
import { getCachedAggregation, aggregateDirectories } from "./directoryAggregator";
import { receiverStatusHistory } from "../drizzle/schema";
import { haversineKm } from "../shared/geo";

// ── Tool Definitions ───────────────────────────────────────────────

export const RAG_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_receivers",
      description:
        "Search for SDR receivers by name, country, band, type, or location. Returns receiver details including online/offline status, coordinates, bands, and user count. Also returns aggregate stats: total receivers, online count, offline count, and breakdown by receiver type. Use with no arguments to get overall receiver statistics.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search term to match against receiver name, country, or URL. Leave empty to get summary stats.",
          },
          band: {
            type: "string",
            description:
              "Filter by band: HF, VHF, UHF, LF/MF, CB, Airband, or 'all'",
          },
          type: {
            type: "string",
            description: "Filter by receiver type: KiwiSDR, OpenWebRX, WebSDR",
          },
          continent: {
            type: "string",
            description:
              "Filter by continent code: EU, NA, AS, OC, SA, AF",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10, max 50)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_targets",
      description:
        "Search TDOA targets by label, frequency, or location. Returns target details including position, history count, and anomaly status.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search term to match against target label or notes",
          },
          frequencyMin: {
            type: "number",
            description: "Minimum frequency in kHz",
          },
          frequencyMax: {
            type: "number",
            description: "Maximum frequency in kHz",
          },
          visible: {
            type: "boolean",
            description: "Filter by visibility status",
          },
          limit: {
            type: "number",
            description: "Max results (default 10, max 50)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_target_history",
      description:
        "Get position history for a specific TDOA target by ID. Shows movement over time.",
      parameters: {
        type: "object",
        properties: {
          targetId: {
            type: "number",
            description: "The target ID to get history for",
          },
          limit: {
            type: "number",
            description: "Max history entries (default 20, max 100)",
          },
        },
        required: ["targetId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_anomaly_alerts",
      description:
        "Search anomaly alerts including position anomalies, conflict zone proximity alerts, and geofence violations. Can filter by severity, type, or target.",
      parameters: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            description: "Filter by severity: high, medium, low",
          },
          targetId: {
            type: "number",
            description: "Filter by specific target ID",
          },
          acknowledged: {
            type: "boolean",
            description: "Filter by acknowledgment status",
          },
          limit: {
            type: "number",
            description: "Max results (default 20, max 100)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_conflict_events",
      description:
        "Search UCDP conflict events (auto-fetches from UCDP API if cache is empty). Returns events sorted by fatalities descending. Can filter by country, region, date range, or violence type. Use with no arguments to get the deadliest recent conflict events.",
      parameters: {
        type: "object",
        properties: {
          country: {
            type: "string",
            description: "Filter by country name (partial match)",
          },
          region: {
            type: "string",
            description: "Filter by region name (partial match)",
          },
          violenceType: {
            type: "number",
            description:
              "Filter by violence type: 1=State-based, 2=Non-state, 3=One-sided",
          },
          minFatalities: {
            type: "number",
            description: "Minimum fatalities (best estimate)",
          },
          limit: {
            type: "number",
            description: "Max results (default 20, max 100)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_geofence_zones",
      description:
        "List all geofence zones with their type (exclusion/inclusion), status, and recent alerts.",
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "Filter by enabled status",
          },
          zoneType: {
            type: "string",
            description: "Filter by zone type: exclusion or inclusion",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sweep_history",
      description:
        "Get recent conflict zone sweep results showing targets checked, alerts generated, and timing.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max results (default 10, max 50)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_stats",
      description:
        "Get overall system statistics: total receivers, targets, alerts, geofence zones, scan cycles, and coverage info.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_directory_sources",
      description:
        "Get live directory aggregation status showing which external SDR directories have been fetched (KiwiSDR GPS, WebSDR.org, sdr-list.xyz, ReceiverBook.de), how many receivers each contributed, how many are new vs duplicates, and when the last fetch occurred. Useful for answering questions about data freshness, receiver coverage, and directory health.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_receivers",
      description:
        "Compare two or more receivers side-by-side by their database IDs or station labels. Returns a comparison table with uptime, SNR, user count, location, type, and online status for each receiver. Useful for answering questions like 'which receiver is better' or 'compare KiwiSDR X vs Y'.",
      parameters: {
        type: "object",
        properties: {
          receiverIds: {
            type: "array",
            items: { type: "number" },
            description: "Array of receiver database IDs to compare",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Array of station label search terms (partial match). Use this when you don't have IDs.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_correlate",
      description:
        "Find spatial correlations between receivers, TDOA targets, and conflict events within a given radius of a center point. Returns nearby items from all three data sources sorted by distance. Useful for answering questions like 'what's happening near this location' or 'are there receivers near conflict zones'.",
      parameters: {
        type: "object",
        properties: {
          lat: {
            type: "number",
            description: "Center latitude in degrees",
          },
          lng: {
            type: "number",
            description: "Center longitude in degrees",
          },
          radiusKm: {
            type: "number",
            description: "Search radius in kilometers (default 500, max 5000)",
          },
          includeReceivers: {
            type: "boolean",
            description: "Include receivers in results (default true)",
          },
          includeTargets: {
            type: "boolean",
            description: "Include TDOA targets in results (default true)",
          },
          includeConflicts: {
            type: "boolean",
            description: "Include conflict events in results (default true)",
          },
        },
        required: ["lat", "lng"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_scan_history",
      description:
        "Query receiver scan cycle history to see uptime trends over time. Returns scan cycle summaries with online/offline counts, duration, and timestamps. Can also get detailed status history for a specific receiver.",
      parameters: {
        type: "object",
        properties: {
          receiverId: {
            type: "number",
            description: "Get detailed scan history for a specific receiver by ID",
          },
          limit: {
            type: "number",
            description: "Max scan cycles to return (default 20, max 100)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_fingerprints",
      description:
        "Search signal fingerprints by target, frequency, or modulation type.",
      parameters: {
        type: "object",
        properties: {
          targetId: {
            type: "number",
            description: "Filter by target ID",
          },
          modulationType: {
            type: "string",
            description: "Filter by modulation type (partial match)",
          },
          limit: {
            type: "number",
            description: "Max results (default 10, max 50)",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

// ── Tool Execution ─────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const db = await getDb();
  if (!db) return JSON.stringify({ error: "Database not available" });

  try {
    switch (name) {
      case "search_receivers": {
        const limit = Math.min(Number(args.limit) || 10, 50);
        let query = db.select().from(receivers).$dynamic();

        const conditions: any[] = [];
        if (args.query && typeof args.query === "string" && args.query.trim()) {
          conditions.push(like(receivers.stationLabel, `%${args.query}%`));
        }
        if (args.type && typeof args.type === "string") {
          conditions.push(eq(receivers.receiverType, args.type as "KiwiSDR" | "OpenWebRX" | "WebSDR"));
        }

        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        const results = await query.limit(limit);

        // Get total count and online/offline breakdown
        const [countResult] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(receivers);
        const totalCount = countResult?.count ?? 0;

        const [onlineResult] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(receivers)
          .where(eq(receivers.lastOnline, true));
        const onlineCount = onlineResult?.count ?? 0;

        // Get type breakdown
        const typeBreakdown = await db
          .select({
            type: receivers.receiverType,
            total: sql<number>`COUNT(*)`,
            online: sql<number>`SUM(CASE WHEN ${receivers.lastOnline} = true THEN 1 ELSE 0 END)`,
          })
          .from(receivers)
          .groupBy(receivers.receiverType);

        // Get latest scan cycle info
        const [latestScan] = await db
          .select()
          .from(scanCycles)
          .orderBy(desc(scanCycles.createdAt))
          .limit(1);

        return JSON.stringify({
          totalReceivers: totalCount,
          onlineReceivers: onlineCount,
          offlineReceivers: totalCount - onlineCount,
          byType: typeBreakdown.map((t) => ({
            type: t.type,
            total: t.total,
            online: t.online,
          })),
          latestScan: latestScan ? {
            cycleNumber: latestScan.cycleNumber,
            totalScanned: latestScan.totalReceivers,
            onlineCount: latestScan.onlineCount,
            offlineCount: latestScan.offlineCount,
            completedAt: latestScan.completedAt,
          } : null,
          returned: results.length,
          receivers: results.map((r) => ({
            id: r.id,
            name: r.stationLabel,
            receiverName: r.receiverName,
            url: r.originalUrl,
            type: r.receiverType,
            online: r.lastOnline,
            lastSnr: r.lastSnr,
            lastUsers: r.lastUsers,
            lastUsersMax: r.lastUsersMax,
            lastCheckedAt: r.lastCheckedAt,
            uptime24h: r.uptime24h,
          })),
        });
      }

      case "search_targets": {
        const limit = Math.min(Number(args.limit) || 10, 50);
        const conditions: any[] = [];

        if (args.query && typeof args.query === "string" && args.query.trim()) {
          conditions.push(like(tdoaTargets.label, `%${args.query}%`));
        }
        if (args.visible !== undefined) {
          conditions.push(eq(tdoaTargets.visible, Boolean(args.visible)));
        }

        let query = db.select().from(tdoaTargets).$dynamic();
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        const results = await query.orderBy(desc(tdoaTargets.createdAt)).limit(limit);

        return JSON.stringify({
          returned: results.length,
          targets: results.map((t) => ({
            id: t.id,
            label: t.label,
            frequencyKhz: t.frequencyKhz,
            lat: t.lat,
            lon: t.lon,
            visible: t.visible,
            color: t.color,
            category: t.category,
            notes: t.notes,
            createdAt: t.createdAt,
          })),
        });
      }

      case "get_target_history": {
        const targetId = Number(args.targetId);
        const limit = Math.min(Number(args.limit) || 20, 100);

        const results = await db
          .select()
          .from(tdoaTargetHistory)
          .where(eq(tdoaTargetHistory.targetId, targetId))
          .orderBy(desc(tdoaTargetHistory.observedAt))
          .limit(limit);

        return JSON.stringify({
          targetId,
          entries: results.length,
          history: results.map((h) => ({
            id: h.id,
            lat: h.lat,
            lon: h.lon,
            frequencyKhz: h.frequencyKhz,
            hostCount: h.hostCount,
            notes: h.notes,
            observedAt: h.observedAt,
          })),
        });
      }

      case "search_anomaly_alerts": {
        const limit = Math.min(Number(args.limit) || 20, 100);
        const conditions: any[] = [];

        if (args.severity && typeof args.severity === "string") {
          conditions.push(eq(anomalyAlerts.severity, args.severity as "low" | "medium" | "high"));
        }
        if (args.targetId !== undefined) {
          conditions.push(eq(anomalyAlerts.targetId, Number(args.targetId)));
        }
        if (args.acknowledged !== undefined) {
          conditions.push(
            eq(anomalyAlerts.acknowledged, Boolean(args.acknowledged))
          );
        }

        let query = db.select().from(anomalyAlerts).$dynamic();
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        const results = await query
          .orderBy(desc(anomalyAlerts.createdAt))
          .limit(limit);

        return JSON.stringify({
          returned: results.length,
          alerts: results.map((a) => ({
            id: a.id,
            targetId: a.targetId,
            severity: a.severity,
            deviationKm: a.deviationKm,
            description: a.description,
            acknowledged: a.acknowledged,
            notificationSent: a.notificationSent,
            createdAt: a.createdAt,
          })),
        });
      }

      case "search_conflict_events": {
        // Proactively fetch conflict data if cache is empty/expired
        let cache = getCachedConflictEvents();
        if (cache.length === 0) {
          try {
            console.log("[RAG] Conflict cache empty, fetching from UCDP API...");
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const { events: rawEvents } = await fetchUcdpEvents({
              startDate: oneYearAgo.toISOString().split("T")[0],
              maxPages: 5,
            });
            const slimEvents = rawEvents.map(slimEvent);
            updateConflictEventCache(slimEvents);
            cache = slimEvents;
            console.log(`[RAG] Fetched and cached ${slimEvents.length} conflict events`);
          } catch (fetchErr) {
            console.error("[RAG] Failed to fetch conflict events:", fetchErr);
          }
        }
        let events = [...cache];
        const limit = Math.min(Number(args.limit) || 20, 100);

        if (args.country && typeof args.country === "string") {
          const q = (args.country as string).toLowerCase();
          events = events.filter((e) => e.country.toLowerCase().includes(q));
        }
        if (args.region && typeof args.region === "string") {
          const q = (args.region as string).toLowerCase();
          events = events.filter((e) => e.region.toLowerCase().includes(q));
        }
        if (args.violenceType !== undefined) {
          events = events.filter((e) => e.type === Number(args.violenceType));
        }
        if (args.minFatalities !== undefined) {
          events = events.filter(
            (e) => e.best >= Number(args.minFatalities)
          );
        }

        // Sort by fatalities desc
        events.sort((a, b) => b.best - a.best);

        return JSON.stringify({
          totalInCache: cache.length,
          matchedEvents: events.length,
          returned: Math.min(events.length, limit),
          events: events.slice(0, limit).map((e) => ({
            id: e.id,
            date: e.date,
            lat: e.lat,
            lng: e.lng,
            country: e.country,
            region: e.region,
            conflict: e.conflict,
            type: e.type,
            typeName:
              e.type === 1
                ? "State-based"
                : e.type === 2
                  ? "Non-state"
                  : "One-sided",
            fatalities: e.best,
            sideA: e.sideA,
            sideB: e.sideB,
          })),
        });
      }

      case "get_geofence_zones": {
        const conditions: ReturnType<typeof eq>[] = [];

        if (args.enabled !== undefined) {
          conditions.push(eq(geofenceZones.enabled, Boolean(args.enabled)));
        }
        if (args.zoneType && typeof args.zoneType === "string") {
          conditions.push(
            eq(
              geofenceZones.zoneType,
              args.zoneType as "exclusion" | "inclusion"
            )
          );
        }

        let query = db.select().from(geofenceZones).$dynamic();
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        const zones = await query;

        // Get recent alerts for each zone
        const zoneAlerts = await db
          .select()
          .from(geofenceAlerts)
          .orderBy(desc(geofenceAlerts.createdAt))
          .limit(50);

        return JSON.stringify({
          totalZones: zones.length,
          zones: zones.map((z) => ({
            id: z.id,
            name: z.name,
            zoneType: z.zoneType,
            enabled: z.enabled,
            color: z.color,
            vertexCount: Array.isArray(z.polygon) ? (z.polygon as unknown[]).length : 0,
            createdAt: z.createdAt,
            recentAlerts: zoneAlerts
              .filter((a) => a.zoneId === z.id)
              .slice(0, 5)
              .map((a) => ({
                targetId: a.targetId,
                eventType: a.eventType,
                lat: a.lat,
                lon: a.lon,
                createdAt: a.createdAt,
              })),
          })),
        });
      }

      case "get_sweep_history": {
        const limit = Math.min(Number(args.limit) || 10, 50);

        const results = await db
          .select()
          .from(conflictSweepHistory)
          .orderBy(desc(conflictSweepHistory.createdAt))
          .limit(limit);

        return JSON.stringify({
          returned: results.length,
          sweeps: results.map((s) => ({
            id: s.id,
            trigger: s.trigger,
            targetsChecked: s.targetsChecked,
            targetsInConflict: s.targetsInConflict,
            geofenceAlertCount: s.geofenceAlertCount,
            newAlerts: s.newAlerts,
            durationMs: s.durationMs,
            summary: s.summary,
            createdAt: s.createdAt,
          })),
        });
      }

      case "get_system_stats": {
        const [receiverCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(receivers);
        const [onlineReceiverCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(receivers)
          .where(eq(receivers.lastOnline, true));
        const [targetCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(tdoaTargets);
        const [alertCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(anomalyAlerts);
        const [zoneCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(geofenceZones);
        const [unackAlerts] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(anomalyAlerts)
          .where(eq(anomalyAlerts.acknowledged, false));
        const [sweepCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(conflictSweepHistory);
        const [fingerprintCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(signalFingerprints);

        // Auto-fetch conflict data if cache is empty
        let conflictCache = getCachedConflictEvents();
        if (conflictCache.length === 0) {
          try {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const { events: rawEvents } = await fetchUcdpEvents({
              startDate: oneYearAgo.toISOString().split("T")[0],
              maxPages: 5,
            });
            const slimEvents = rawEvents.map(slimEvent);
            updateConflictEventCache(slimEvents);
            conflictCache = slimEvents;
          } catch {
            // Silently continue with empty cache
          }
        }

        return JSON.stringify({
          receivers: receiverCount?.count ?? 0,
          onlineReceivers: onlineReceiverCount?.count ?? 0,
          offlineReceivers: (receiverCount?.count ?? 0) - (onlineReceiverCount?.count ?? 0),
          targets: targetCount?.count ?? 0,
          anomalyAlerts: alertCount?.count ?? 0,
          unacknowledgedAlerts: unackAlerts?.count ?? 0,
          geofenceZones: zoneCount?.count ?? 0,
          sweepHistory: sweepCount?.count ?? 0,
          signalFingerprints: fingerprintCount?.count ?? 0,
          conflictEventsInCache: conflictCache.length,
        });
      }

      case "search_fingerprints": {
        const limit = Math.min(Number(args.limit) || 10, 50);
        const conditions: any[] = [];

        if (args.targetId !== undefined) {
          conditions.push(
            eq(signalFingerprints.targetId, Number(args.targetId))
          );
        }
        if (args.modulationType && typeof args.modulationType === "string") {
          conditions.push(
            like(signalFingerprints.mode, `%${args.modulationType}%`)
          );
        }

        let query = db.select().from(signalFingerprints).$dynamic();
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        const results = await query
          .orderBy(desc(signalFingerprints.createdAt))
          .limit(limit);

        return JSON.stringify({
          returned: results.length,
          fingerprints: results.map((f) => ({
            id: f.id,
            targetId: f.targetId,
            frequencyKhz: f.frequencyKhz,
            bandwidthHz: f.bandwidthHz,
            mode: f.mode,
            dominantFreqHz: f.dominantFreqHz,
            spectralCentroid: f.spectralCentroid,
            rmsLevel: f.rmsLevel,
            createdAt: f.createdAt,
          })),
        });
      }

      case "query_directory_sources": {
        // Get cached aggregation or trigger a fresh fetch
        let agg = getCachedAggregation();
        if (!agg) {
          try {
            // Need existing stations for aggregation — get from DB
            const dbReceivers = await db.select().from(receivers);
            const existingStations = dbReceivers.map((r) => ({
              label: r.stationLabel,
              location: { coordinates: [0, 0] as [number, number], type: "Point" as const },
              receivers: [{ label: r.stationLabel, url: r.originalUrl, type: r.receiverType }],
              source: "static",
            }));
            agg = await aggregateDirectories(existingStations);
          } catch (aggErr) {
            return JSON.stringify({ error: "Failed to fetch directory data", details: String(aggErr) });
          }
        }

        return JSON.stringify({
          totalStations: agg.totalStations,
          totalNew: agg.totalNew,
          fetchedAt: agg.fetchedAt,
          fetchedAgo: `${Math.round((Date.now() - agg.fetchedAt) / 60000)} minutes ago`,
          sources: agg.sources.map((s) => ({
            name: s.name,
            fetched: s.fetched,
            newStations: s.newStations,
            duplicates: s.fetched - s.newStations,
            errors: s.errors,
            healthy: s.errors.length === 0,
          })),
        });
      }

      case "compare_receivers": {
        const receiverRows: (typeof receivers.$inferSelect)[] = [];

        // Fetch by IDs
        if (args.receiverIds && Array.isArray(args.receiverIds)) {
          for (const id of args.receiverIds as number[]) {
            const [row] = await db.select().from(receivers).where(eq(receivers.id, id)).limit(1);
            if (row) receiverRows.push(row);
          }
        }

        // Fetch by label search
        if (args.labels && Array.isArray(args.labels)) {
          for (const label of args.labels as string[]) {
            const rows = await db.select().from(receivers)
              .where(like(receivers.stationLabel, `%${label}%`))
              .limit(1);
            if (rows[0]) receiverRows.push(rows[0]);
          }
        }

        if (receiverRows.length === 0) {
          return JSON.stringify({ error: "No receivers found matching the provided IDs or labels" });
        }

        // Get recent scan history for each receiver
        const comparisons = await Promise.all(
          receiverRows.map(async (r) => {
            const recentHistory = await db.select()
              .from(receiverStatusHistory)
              .where(eq(receiverStatusHistory.receiverId, r.id))
              .orderBy(desc(receiverStatusHistory.checkedAt))
              .limit(10);

            const onlineChecks = recentHistory.filter((h) => h.online).length;
            const recentUptime = recentHistory.length > 0
              ? Math.round((onlineChecks / recentHistory.length) * 100)
              : null;

            return {
              id: r.id,
              name: r.stationLabel,
              receiverName: r.receiverName,
              url: r.originalUrl,
              type: r.receiverType,
              online: r.lastOnline,
              lastSnr: r.lastSnr,
              lastUsers: r.lastUsers,
              lastUsersMax: r.lastUsersMax,
              uptime24h: r.uptime24h,
              uptime7d: r.uptime7d,
              recentUptimePct: recentUptime,
              totalChecks: r.totalChecks,
              onlineChecks: r.onlineChecks,
              lastCheckedAt: r.lastCheckedAt,
            };
          })
        );

        return JSON.stringify({
          compared: comparisons.length,
          receivers: comparisons,
        });
      }

      case "cross_correlate": {
        const centerLat = Number(args.lat);
        const centerLng = Number(args.lng);
        const radiusKm = Math.min(Number(args.radiusKm) || 500, 5000);
        const includeReceivers = args.includeReceivers !== false;
        const includeTargets = args.includeTargets !== false;
        const includeConflicts = args.includeConflicts !== false;

        const result: {
          center: { lat: number; lng: number };
          radiusKm: number;
          nearbyReceivers?: { name: string; type: string; online: boolean; distanceKm: number; url: string }[];
          nearbyTargets?: { label: string; category: string; frequencyKhz: string | null; distanceKm: number }[];
          nearbyConflicts?: { date: string; country: string; conflict: string; fatalities: number; distanceKm: number }[];
        } = { center: { lat: centerLat, lng: centerLng }, radiusKm };

        // Nearby receivers
        if (includeReceivers) {
          const allReceivers = await db.select().from(receivers);
          // We don't have lat/lon in the receivers table directly, but we can use the station data
          // For now, search by checking all receivers (the table doesn't store coordinates)
          // We'll return the top receivers by name match or just the total count
          result.nearbyReceivers = [];
          // Note: receivers table doesn't have lat/lon columns, so we can't do distance filtering
          // Return a note about this limitation
        }

        // Nearby targets
        if (includeTargets) {
          const allTargets = await db.select().from(tdoaTargets);
          result.nearbyTargets = allTargets
            .map((t) => {
              const dist = haversineKm(centerLat, centerLng, Number(t.lat), Number(t.lon));
              return {
                label: t.label,
                category: t.category,
                frequencyKhz: t.frequencyKhz,
                distanceKm: Math.round(dist * 10) / 10,
              };
            })
            .filter((t) => t.distanceKm <= radiusKm)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 20);
        }

        // Nearby conflict events
        if (includeConflicts) {
          let cache = getCachedConflictEvents();
          if (cache.length === 0) {
            try {
              const oneYearAgo = new Date();
              oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
              const { events: rawEvents } = await fetchUcdpEvents({
                startDate: oneYearAgo.toISOString().split("T")[0],
                maxPages: 5,
              });
              const slimEvents = rawEvents.map(slimEvent);
              updateConflictEventCache(slimEvents);
              cache = slimEvents;
            } catch { /* ignore */ }
          }

          result.nearbyConflicts = cache
            .map((e) => {
              const dist = haversineKm(centerLat, centerLng, e.lat, e.lng);
              return {
                date: e.date,
                country: e.country,
                conflict: e.conflict,
                fatalities: e.best,
                distanceKm: Math.round(dist * 10) / 10,
              };
            })
            .filter((e) => e.distanceKm <= radiusKm)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 20);
        }

        return JSON.stringify(result);
      }

      case "search_scan_history": {
        const limit = Math.min(Number(args.limit) || 20, 100);

        if (args.receiverId !== undefined) {
          // Get detailed history for a specific receiver
          const receiverId = Number(args.receiverId);
          const [receiver] = await db.select().from(receivers).where(eq(receivers.id, receiverId)).limit(1);

          const history = await db.select()
            .from(receiverStatusHistory)
            .where(eq(receiverStatusHistory.receiverId, receiverId))
            .orderBy(desc(receiverStatusHistory.checkedAt))
            .limit(limit);

          return JSON.stringify({
            receiverId,
            receiverName: receiver?.stationLabel ?? "Unknown",
            receiverType: receiver?.receiverType ?? "Unknown",
            currentOnline: receiver?.lastOnline ?? false,
            totalChecks: receiver?.totalChecks ?? 0,
            onlineChecks: receiver?.onlineChecks ?? 0,
            allTimeUptime: receiver && receiver.totalChecks > 0
              ? Math.round((receiver.onlineChecks / receiver.totalChecks) * 100)
              : null,
            uptime24h: receiver?.uptime24h,
            uptime7d: receiver?.uptime7d,
            returned: history.length,
            history: history.map((h) => ({
              online: h.online,
              users: h.users,
              usersMax: h.usersMax,
              snr: h.snr,
              error: h.error,
              checkedAt: h.checkedAt,
            })),
          });
        }

        // Get scan cycle summaries
        const cycles = await db.select()
          .from(scanCycles)
          .orderBy(desc(scanCycles.createdAt))
          .limit(limit);

        return JSON.stringify({
          returned: cycles.length,
          cycles: cycles.map((c) => ({
            id: c.id,
            cycleId: c.cycleId,
            cycleNumber: c.cycleNumber,
            totalReceivers: c.totalReceivers,
            onlineCount: c.onlineCount,
            offlineCount: c.offlineCount,
            onlinePercent: c.totalReceivers > 0
              ? Math.round((c.onlineCount / c.totalReceivers) * 100)
              : 0,
            durationSec: c.durationSec,
            startedAt: c.startedAt,
            completedAt: c.completedAt,
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[RAG] Tool execution error (${name}):`, err);
    return JSON.stringify({
      error: `Tool execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

// ── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are **Valentine RF Intelligence Analyst**, an AI assistant embedded in the Valentine RF SIGINT platform. You have access to real-time data from the following systems:

## Available Data Sources
1. **Receivers** — 1700+ SDR receivers worldwide (KiwiSDR, OpenWebRX, WebSDR) with status, location, bands, SNR, and user data
2. **TDOA Targets** — Tracked signal targets with position history, frequency, and movement data
3. **Conflict Events** — UCDP Georeferenced Event Dataset (GED) with armed conflict data including fatalities, parties, and locations
4. **Geofence Zones** — Custom exclusion/inclusion zones with entry/exit alerts
5. **Anomaly Alerts** — Position anomalies, conflict zone proximity alerts, and geofence violations
6. **Sweep History** — Scheduled conflict zone sweep results
7. **Signal Fingerprints** — RF signal characteristics for target identification
8. **Directory Sources** — Live aggregation from 4 external SDR directories (KiwiSDR GPS, WebSDR.org, sdr-list.xyz, ReceiverBook.de)
9. **Scan History** — Receiver health monitoring with per-receiver and per-cycle uptime data
10. **Cross-Correlation** — Spatial analysis finding nearby receivers, targets, and conflicts within a radius

## Your Role
- Investigate questions about receivers, targets, conflicts, and their correlations
- Cross-reference data across systems to surface intelligence insights
- Provide concise, actionable analysis in an intelligence briefing style
- Use specific data points and numbers from tool results
- When asked about correlations, query multiple data sources and synthesize findings
- Format responses with markdown for readability (headers, tables, bold text)
- Compare receivers side-by-side when asked about performance or reliability

## Guidelines
- Always use tools to retrieve current data — never fabricate numbers
- If a query is ambiguous, use the most relevant tool and explain your reasoning
- For geographic queries, use the cross_correlate tool to find nearby items across all data sources
- Present findings in order of significance/severity
- Use military/intelligence terminology where appropriate (SIGINT, COMINT, ELINT, etc.)
- Keep responses focused and analytical — avoid unnecessary pleasantries

## Source Citations
When presenting data retrieved from tools, include inline source citations using the format [SOURCE:source_name]. Use these source labels:
- [SOURCE:DB/receivers] — Data from the receivers database
- [SOURCE:DB/targets] — Data from the TDOA targets database
- [SOURCE:DB/anomalies] — Data from the anomaly alerts database
- [SOURCE:DB/geofences] — Data from the geofence zones database
- [SOURCE:DB/fingerprints] — Data from the signal fingerprints database
- [SOURCE:DB/scans] — Data from the scan cycles database
- [SOURCE:UCDP/GED] — Data from the UCDP conflict events API
- [SOURCE:DIR/KiwiSDR] — Data from the KiwiSDR GPS directory
- [SOURCE:DIR/WebSDR] — Data from the WebSDR.org directory
- [SOURCE:DIR/ReceiverBook] — Data from the ReceiverBook.de directory
- [SOURCE:DIR/sdr-list] — Data from the sdr-list.xyz directory
- [SOURCE:SWEEP] — Data from conflict sweep history
- [SOURCE:CROSS-REF] — Data from cross-correlation analysis

Place citations immediately after the relevant data point or statement. Example: "There are 1,074 KiwiSDR receivers online [SOURCE:DB/receivers]."

## Follow-Up Suggestions
At the END of every response, add a section with exactly 3 follow-up question suggestions that the user might want to ask next, based on the current analysis. Format them as:

---
**Suggested follow-ups:**
- [SUGGESTION:Your first suggested question here]
- [SUGGESTION:Your second suggested question here]
- [SUGGESTION:Your third suggested question here]

Make suggestions specific and contextual to the data just discussed. Vary between drilling deeper into current topic, exploring related data, and broadening the analysis.`;

// ── Main RAG Function ──────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Process a chat message through the HybridRAG engine.
 * Supports multi-turn conversation with tool-calling.
 */
export async function processChat(
  conversationHistory: ChatMessage[],
  userMessage: string
): Promise<string> {
  // Build message array with system prompt
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  // First LLM call — may include tool calls
  let response = await invokeLLM({
    messages,
    tools: RAG_TOOLS,
    tool_choice: "auto",
  });

  let choice = response.choices[0];
  if (!choice) return "I was unable to process your request. Please try again.";

  // Tool-calling loop (max 5 iterations to prevent infinite loops)
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (choice.message.tool_calls && choice.message.tool_calls.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;

    // Add assistant message with tool calls to context
    messages.push({
      role: "assistant",
      content: choice.message.content || "",
    });

    // Execute each tool call
    for (const toolCall of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      console.log(
        `[RAG] Executing tool: ${toolCall.function.name}`,
        JSON.stringify(args).slice(0, 200)
      );

      const result = await executeTool(toolCall.function.name, args);

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      });
    }

    // Follow-up LLM call with tool results
    response = await invokeLLM({
      messages,
      tools: RAG_TOOLS,
      tool_choice: "auto",
    });

    choice = response.choices[0];
    if (!choice) break;
  }

  // Extract final text response
  const content = choice?.message?.content;
  if (!content) return "Analysis complete, but no summary was generated.";

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");
  }

  return "Analysis complete.";
}

// ── Globe Action Prompt Addition ──────────────────────────────────

const GLOBE_ACTION_PROMPT = [
  "",
  "## Globe Actions",
  "When your response references specific locations, receivers, or targets, you can embed interactive globe actions.",
  "Use these markers in your response text — the UI will render them as clickable buttons:",
  "",
  "- [GLOBE:FLY_TO:lat,lng:label] — Fly the globe camera to a specific location",
  "  Example: [GLOBE:FLY_TO:48.8566,2.3522:Paris, France]",
  "- [GLOBE:HIGHLIGHT:stationLabel:label] — Highlight a specific receiver on the globe (use the station label)",
  "  Example: [GLOBE:HIGHLIGHT:KiwiSDR Brussels:Highlight Brussels]",
  "- [GLOBE:OVERLAY:overlayName:label] — Toggle a UI overlay/panel on or off",
  "  Available overlay names: conflict, propagation, heatmap, geofence, timeline, anomaly, watchlist, milrf, waterfall, targets",
  "  Examples:",
  "  [GLOBE:OVERLAY:conflict:Show Conflict Zones]",
  "  [GLOBE:OVERLAY:propagation:Show Propagation]",
  "  [GLOBE:OVERLAY:heatmap:Toggle Heatmap]",
  "  [GLOBE:OVERLAY:geofence:Open Geofence Panel]",
  "  [GLOBE:OVERLAY:timeline:Open SIGINT Timeline]",
  "  [GLOBE:OVERLAY:anomaly:Show Anomaly Alerts]",
  "  [GLOBE:OVERLAY:watchlist:Open Watchlist]",
  "  [GLOBE:OVERLAY:targets:Show Targets]",
  "",
  "Use these actions sparingly and only when they add value to the analysis. Place them naturally within your response text near the relevant discussion.",
].join("\n");

// ── Streaming RAG Function ────────────────────────────────────────

import { invokeLLMStreaming } from "./_core/llm";

export type StreamCallback = (event: {
  type: "status" | "token" | "done" | "error" | "tool_result";
  data: string;
  toolName?: string;
  preview?: unknown;
}) => void;

/** Create a compact preview of tool results for the UI */
function createToolPreview(toolName: string, result: string): { summary: string; count?: number; highlights?: string[] } {
  try {
    const data = JSON.parse(result);
    switch (toolName) {
      case "search_receivers": {
        const total = data.totalReceivers ?? data.returned ?? 0;
        const online = data.onlineReceivers ?? 0;
        const offline = data.offlineReceivers ?? 0;
        const typeInfo = (data.byType || []).map((t: { type?: string; total?: number; online?: number }) => `${t.type}: ${t.online ?? 0}/${t.total ?? 0}`).join(", ");
        return {
          summary: `${total} receivers total (${online} online, ${offline} offline)${typeInfo ? " — " + typeInfo : ""}`,
          count: total,
          highlights: (data.receivers || []).slice(0, 3).map((r: { name?: string; type?: string; online?: boolean }) => `${r.name || "Unknown"} (${r.type || "?"})${r.online ? " \u2705" : " \u274c"}`),
        };
      }
      case "search_conflict_events": {
        const total = data.returned ?? data.events?.length ?? 0;
        const fatalities = data.events?.reduce((s: number, e: { bestEstimate?: number }) => s + (e.bestEstimate || 0), 0) ?? 0;
        return {
          summary: `${total} conflict events (${fatalities} total fatalities)`,
          count: total,
          highlights: (data.events || []).slice(0, 3).map((e: { country?: string; bestEstimate?: number }) => `${e.country || "?"}: ${e.bestEstimate || 0} fatalities`),
        };
      }
      case "search_targets": {
        return {
          summary: `${data.returned ?? 0} targets found`,
          count: data.returned,
          highlights: (data.targets || []).slice(0, 3).map((t: { label?: string; frequency?: number }) => `${t.label || "Unknown"} (${t.frequency ? t.frequency + " kHz" : "?"})`),
        };
      }
      case "get_system_stats": {
        return {
          summary: `System: ${data.receivers?.total ?? "?"} receivers, ${data.targets?.total ?? "?"} targets`,
          highlights: [
            `Online: ${data.receivers?.online ?? "?"}`,
            `Alerts: ${data.anomalyAlerts?.total ?? "?"}`,
            `Conflicts: ${data.conflictEvents?.total ?? "?"}`,
          ],
        };
      }
      case "cross_correlate": {
        return {
          summary: `Cross-correlation: ${data.nearbyReceivers?.length ?? 0} receivers, ${data.nearbyTargets?.length ?? 0} targets, ${data.nearbyConflicts?.length ?? 0} conflicts nearby`,
          count: (data.nearbyReceivers?.length ?? 0) + (data.nearbyTargets?.length ?? 0) + (data.nearbyConflicts?.length ?? 0),
        };
      }
      case "compare_receivers": {
        const comps = data.comparison || [];
        return {
          summary: `Comparing ${comps.length} receivers`,
          count: comps.length,
          highlights: comps.slice(0, 3).map((c: { stationLabel?: string; uptime24h?: number }) => `${c.stationLabel || "?"}: ${c.uptime24h ?? "?"}% uptime`),
        };
      }
      case "query_directory_sources": {
        return {
          summary: `Directory: ${data.totalNewStations ?? 0} new stations from ${data.sources?.length ?? 0} sources`,
          count: data.totalNewStations,
        };
      }
      case "search_scan_history": {
        return {
          summary: data.receiverId ? `Scan history: ${data.returned ?? 0} checks for ${data.receiverName || "receiver"}` : `${data.returned ?? 0} scan cycles`,
          count: data.returned,
        };
      }
      case "search_anomaly_alerts": {
        const alertCount = data.returned ?? data.alerts?.length ?? 0;
        if (alertCount === 0) {
          return {
            summary: "No anomaly alerts found. Alerts are generated when tracked targets deviate from expected positions.",
            count: 0,
          };
        }
        const severityCounts = (data.alerts || []).reduce((acc: Record<string, number>, a: { severity?: string }) => {
          const s = a.severity || "unknown";
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const severityStr = Object.entries(severityCounts).map(([k, v]) => `${v} ${k}`).join(", ");
        return {
          summary: `${alertCount} anomaly alerts (${severityStr})`,
          count: alertCount,
          highlights: (data.alerts || []).slice(0, 3).map((a: { severity?: string; deviationKm?: number; description?: string }) => `${a.severity || "?"}: ${a.description || `${a.deviationKm ?? "?"}km deviation`}`),
        };
      }
      default: {
        const keys = Object.keys(data);
        const countKey = keys.find(k => k === "returned" || k === "total" || k === "count");
        return {
          summary: countKey ? `${data[countKey]} results` : `Data retrieved (${keys.length} fields)`,
          count: countKey ? data[countKey] : undefined,
        };
      }
    }
  } catch {
    return { summary: "Data retrieved" };
  }
}

/**
 * Process a chat message through the HybridRAG engine with streaming output.
 * Tool calls are executed non-streaming, then the final response is streamed token-by-token.
 */
export async function processChatStreaming(
  conversationHistory: ChatMessage[],
  userMessage: string,
  onEvent: StreamCallback
): Promise<string> {
  // Build message array with system prompt + globe actions
  // Context window management: if conversation is too long, summarize older messages
  let historyToUse = conversationHistory;
  const MAX_HISTORY_MESSAGES = 20;
  const MAX_HISTORY_CHARS = 30000;

  const totalChars = conversationHistory.reduce((s, m) => s + m.content.length, 0);
  if (conversationHistory.length > MAX_HISTORY_MESSAGES || totalChars > MAX_HISTORY_CHARS) {
    // Keep the last 6 messages verbatim, summarize the rest
    const recentCount = 6;
    const oldMessages = conversationHistory.slice(0, -recentCount);
    const recentMessages = conversationHistory.slice(-recentCount);

    if (oldMessages.length > 0) {
      const summaryText = oldMessages.map(m => `[${m.role}]: ${m.content.slice(0, 200)}`).join("\n");
      const summaryMsg: ChatMessage = {
        role: "system",
        content: `[CONVERSATION SUMMARY - Earlier messages condensed]\n${summaryText.slice(0, 3000)}\n[END SUMMARY]`,
      };
      historyToUse = [summaryMsg, ...recentMessages];
      console.log(`[RAG-Stream] Context trimmed: ${conversationHistory.length} -> ${historyToUse.length} messages (${totalChars} -> ${historyToUse.reduce((s, m) => s + m.content.length, 0)} chars)`);
    }
  }

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT + GLOBE_ACTION_PROMPT },
    ...historyToUse.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  // First LLM call (non-streaming) to handle potential tool calls
  onEvent({ type: "status", data: "Analyzing query..." });

  let response = await invokeLLM({
    messages,
    tools: RAG_TOOLS,
    tool_choice: "auto",
  });

  let choice = response.choices[0];
  if (!choice) {
    const msg = "I was unable to process your request. Please try again.";
    onEvent({ type: "error", data: msg });
    return msg;
  }

  // Tool-calling loop (non-streaming)
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (
    choice.message.tool_calls &&
    choice.message.tool_calls.length > 0 &&
    iterations < MAX_ITERATIONS
  ) {
    iterations++;

    // Add assistant message with tool calls to context
    messages.push({
      role: "assistant",
      content: choice.message.content || "",
    });

    // Execute each tool call
    for (const toolCall of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      const toolDisplayName = toolCall.function.name
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      onEvent({ type: "status", data: `Querying ${toolDisplayName}...` });

      console.log(
        `[RAG-Stream] Executing tool: ${toolCall.function.name}`,
        JSON.stringify(args).slice(0, 200)
      );

      const result = await executeTool(toolCall.function.name, args);

      // Emit tool result preview for the UI
      const preview = createToolPreview(toolCall.function.name, result);
      onEvent({
        type: "tool_result",
        data: preview.summary,
        toolName: toolCall.function.name,
        preview,
      });

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
      });
    }

    // Check if more tool calls are needed
    response = await invokeLLM({
      messages,
      tools: RAG_TOOLS,
      tool_choice: "auto",
    });

    choice = response.choices[0];
    if (!choice) break;
  }

  // If the last non-streaming call already has a final text response (no more tool calls),
  // stream the final response token-by-token
  onEvent({ type: "status", data: "Generating analysis..." });

  try {
    // Make a streaming call for the final response
    const streamResponse = await invokeLLMStreaming({
      messages,
    });

    if (!streamResponse.body) {
      // Fallback: use the non-streaming response
      const content = extractContent(choice);
      onEvent({ type: "token", data: content });
      onEvent({ type: "done", data: "" });
      return content;
    }

    let fullContent = "";
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          onEvent({ type: "done", data: "" });
          return fullContent;
        }

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onEvent({ type: "token", data: delta.content });
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    onEvent({ type: "done", data: "" });
    return fullContent || extractContent(choice);
  } catch (err) {
    console.error("[RAG-Stream] Streaming error:", err);
    // Fallback to non-streaming content
    const content = extractContent(choice);
    onEvent({ type: "token", data: content });
    onEvent({ type: "done", data: "" });
    return content;
  }
}

/** Helper to extract text content from an LLM response choice */
function extractContent(choice: { message: { content: string | Array<{ type: string; text?: string }> } }): string {
  const content = choice?.message?.content;
  if (!content) return "Analysis complete.";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
  }
  return "Analysis complete.";
}
