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
import { getCachedConflictEvents } from "./conflictZoneChecker";

// ── Tool Definitions ───────────────────────────────────────────────

export const RAG_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_receivers",
      description:
        "Search for SDR receivers by name, country, band, type, or location. Returns receiver details including status, coordinates, bands, and user count.",
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
        "Search UCDP conflict events from the in-memory cache. Can filter by country, region, date range, or violence type.",
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

        // Get total count
        const [countResult] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(receivers);
        const totalCount = countResult?.count ?? 0;

        return JSON.stringify({
          totalReceivers: totalCount,
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
        const cache = getCachedConflictEvents();
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

        const conflictCache = getCachedConflictEvents();

        return JSON.stringify({
          receivers: receiverCount?.count ?? 0,
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
1. **Receivers** — 1500+ SDR receivers worldwide (KiwiSDR, OpenWebRX, WebSDR) with status, location, bands, SNR, and user data
2. **TDOA Targets** — Tracked signal targets with position history, frequency, and movement data
3. **Conflict Events** — UCDP Georeferenced Event Dataset (GED) with armed conflict data including fatalities, parties, and locations
4. **Geofence Zones** — Custom exclusion/inclusion zones with entry/exit alerts
5. **Anomaly Alerts** — Position anomalies, conflict zone proximity alerts, and geofence violations
6. **Sweep History** — Scheduled conflict zone sweep results
7. **Signal Fingerprints** — RF signal characteristics for target identification

## Your Role
- Investigate questions about receivers, targets, conflicts, and their correlations
- Cross-reference data across systems to surface intelligence insights
- Provide concise, actionable analysis in an intelligence briefing style
- Use specific data points and numbers from tool results
- When asked about correlations, query multiple data sources and synthesize findings
- Format responses with markdown for readability (headers, tables, bold text)

## Guidelines
- Always use tools to retrieve current data — never fabricate numbers
- If a query is ambiguous, use the most relevant tool and explain your reasoning
- For geographic queries, consider proximity between receivers, targets, and conflict zones
- Present findings in order of significance/severity
- Use military/intelligence terminology where appropriate (SIGINT, COMINT, ELINT, etc.)
- Keep responses focused and analytical — avoid unnecessary pleasantries`;

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
  type: "status" | "token" | "done" | "error";
  data: string;
}) => void;

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
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT + GLOBE_ACTION_PROMPT },
    ...conversationHistory.map((m) => ({
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

      const toolName = toolCall.function.name
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      onEvent({ type: "status", data: `Querying ${toolName}...` });

      console.log(
        `[RAG-Stream] Executing tool: ${toolCall.function.name}`,
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
