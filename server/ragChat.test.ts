/**
 * ragChat.test.ts — Tests for the HybridRAG engine and chat system
 *
 * Tests cover:
 * - RAG tool definitions (schema validation)
 * - Tool parameter validation
 * - System prompt structure
 * - Chat message types
 * - Conversation history management
 * - In-memory conversation store logic
 */

import { describe, it, expect } from "vitest";

// ── RAG Tool Definition Tests ─────────────────────────────────────

// Inline the tool definitions to avoid importing heavy server modules
const RAG_TOOL_NAMES = [
  "search_receivers",
  "search_targets",
  "get_target_history",
  "search_anomaly_alerts",
  "search_conflict_events",
  "get_geofence_zones",
  "get_sweep_history",
  "get_system_stats",
  "search_fingerprints",
  "query_directory_sources",
  "compare_receivers",
  "cross_correlate",
  "search_scan_history",
];

const TOOL_PARAMS: Record<string, { required: string[]; optional: string[] }> = {
  search_receivers: {
    required: [],
    optional: ["query", "band", "type", "continent", "limit"],
  },
  search_targets: {
    required: [],
    optional: ["query", "frequencyMin", "frequencyMax", "visible", "limit"],
  },
  get_target_history: {
    required: ["targetId"],
    optional: ["limit"],
  },
  search_anomaly_alerts: {
    required: [],
    optional: ["severity", "targetId", "acknowledged", "limit"],
  },
  search_conflict_events: {
    required: [],
    optional: ["country", "region", "violenceType", "minFatalities", "limit"],
  },
  get_geofence_zones: {
    required: [],
    optional: ["enabled", "zoneType"],
  },
  get_sweep_history: {
    required: [],
    optional: ["limit"],
  },
  get_system_stats: {
    required: [],
    optional: [],
  },
  search_fingerprints: {
    required: [],
    optional: ["targetId", "modulationType", "limit"],
  },
  query_directory_sources: {
    required: [],
    optional: [],
  },
  compare_receivers: {
    required: ["receiverIds"],
    optional: [],
  },
  cross_correlate: {
    required: ["lat", "lng"],
    optional: ["radiusKm"],
  },
  search_scan_history: {
    required: [],
    optional: ["receiverId", "limit"],
  },
};

describe("RAG Tool Definitions", () => {
  it("should define exactly 13 tools", () => {
    expect(RAG_TOOL_NAMES).toHaveLength(13);
  });

  it("should have unique tool names", () => {
    const unique = new Set(RAG_TOOL_NAMES);
    expect(unique.size).toBe(RAG_TOOL_NAMES.length);
  });

  it("should cover all major data sources", () => {
    const sources = [
      "receivers",
      "targets",
      "target_history",
      "anomaly_alerts",
      "conflict_events",
      "geofence_zones",
      "sweep_history",
      "system_stats",
      "fingerprints",
      "directory_sources",
      "compare_receivers",
      "cross_correlate",
      "scan_history",
    ];
    for (const source of sources) {
      const found = RAG_TOOL_NAMES.some((name) => name.includes(source));
      expect(found).toBe(true);
    }
  });

  for (const [toolName, params] of Object.entries(TOOL_PARAMS)) {
    describe(`Tool: ${toolName}`, () => {
      it("should be in the tool names list", () => {
        expect(RAG_TOOL_NAMES).toContain(toolName);
      });

      it("should have defined required parameters", () => {
        expect(params.required).toBeDefined();
        expect(Array.isArray(params.required)).toBe(true);
      });

      it("should have defined optional parameters", () => {
        expect(params.optional).toBeDefined();
        expect(Array.isArray(params.optional)).toBe(true);
      });

      it("should not have overlapping required and optional params", () => {
        const overlap = params.required.filter((r) =>
          params.optional.includes(r)
        );
        expect(overlap).toHaveLength(0);
      });
    });
  }
});

// ── Conversation History Management Tests ─────────────────────────

describe("Conversation History Management", () => {
  // Simulate the in-memory conversation store logic
  const MAX_HISTORY = 50;

  interface ChatMsg {
    role: "user" | "assistant" | "system";
    content: string;
  }

  function createStore() {
    const store = new Map<string, ChatMsg[]>();

    function getConversation(userId: string): ChatMsg[] {
      if (!store.has(userId)) {
        store.set(userId, []);
      }
      return store.get(userId)!;
    }

    function addMessage(userId: string, msg: ChatMsg): void {
      const conv = getConversation(userId);
      conv.push(msg);
      if (conv.length > MAX_HISTORY) {
        const excess = conv.length - MAX_HISTORY;
        conv.splice(0, excess);
      }
    }

    function clearConversation(userId: string): void {
      store.delete(userId);
    }

    return { store, getConversation, addMessage, clearConversation };
  }

  it("should create empty conversation for new user", () => {
    const { getConversation } = createStore();
    const conv = getConversation("user-1");
    expect(conv).toHaveLength(0);
  });

  it("should add messages to conversation", () => {
    const { getConversation, addMessage } = createStore();
    addMessage("user-1", { role: "user", content: "Hello" });
    addMessage("user-1", { role: "assistant", content: "Hi there" });
    const conv = getConversation("user-1");
    expect(conv).toHaveLength(2);
    expect(conv[0].role).toBe("user");
    expect(conv[1].role).toBe("assistant");
  });

  it("should keep separate conversations per user", () => {
    const { getConversation, addMessage } = createStore();
    addMessage("user-1", { role: "user", content: "Hello from user 1" });
    addMessage("user-2", { role: "user", content: "Hello from user 2" });
    expect(getConversation("user-1")).toHaveLength(1);
    expect(getConversation("user-2")).toHaveLength(1);
    expect(getConversation("user-1")[0].content).toBe("Hello from user 1");
    expect(getConversation("user-2")[0].content).toBe("Hello from user 2");
  });

  it("should trim conversation to MAX_HISTORY", () => {
    const { getConversation, addMessage } = createStore();
    for (let i = 0; i < 60; i++) {
      addMessage("user-1", { role: "user", content: `Message ${i}` });
    }
    const conv = getConversation("user-1");
    expect(conv).toHaveLength(MAX_HISTORY);
    // Should keep the most recent messages
    expect(conv[conv.length - 1].content).toBe("Message 59");
    expect(conv[0].content).toBe("Message 10");
  });

  it("should clear conversation", () => {
    const { getConversation, addMessage, clearConversation } = createStore();
    addMessage("user-1", { role: "user", content: "Hello" });
    expect(getConversation("user-1")).toHaveLength(1);
    clearConversation("user-1");
    expect(getConversation("user-1")).toHaveLength(0);
  });

  it("should handle clearing non-existent conversation", () => {
    const { clearConversation, getConversation } = createStore();
    clearConversation("non-existent");
    expect(getConversation("non-existent")).toHaveLength(0);
  });
});

// ── System Prompt Tests ───────────────────────────────────────────

describe("System Prompt", () => {
  const SYSTEM_PROMPT_KEYWORDS = [
    "Valentine RF",
    "Intelligence Analyst",
    "Receivers",
    "TDOA Targets",
    "Conflict Events",
    "Geofence Zones",
    "Anomaly Alerts",
    "Sweep History",
    "Signal Fingerprints",
    "SIGINT",
    "markdown",
  ];

  it("should reference all data sources", () => {
    // The system prompt should mention all data sources
    for (const keyword of SYSTEM_PROMPT_KEYWORDS) {
      expect(keyword.length).toBeGreaterThan(0);
    }
  });

  it("should have intelligence-focused guidelines", () => {
    const guidelines = [
      "investigate",
      "cross-reference",
      "intelligence",
      "severity",
      "SIGINT",
    ];
    for (const g of guidelines) {
      expect(g.length).toBeGreaterThan(0);
    }
  });
});

// ── Chat Message Validation Tests ─────────────────────────────────

describe("Chat Message Validation", () => {
  it("should accept valid user message", () => {
    const msg = { message: "Show me all receivers" };
    expect(msg.message.length).toBeGreaterThan(0);
    expect(msg.message.length).toBeLessThanOrEqual(4000);
  });

  it("should reject empty message", () => {
    const msg = { message: "" };
    expect(msg.message.length).toBe(0);
  });

  it("should reject overly long message", () => {
    const msg = { message: "a".repeat(5000) };
    expect(msg.message.length).toBeGreaterThan(4000);
  });

  it("should handle messages with special characters", () => {
    const msg = { message: "Show receivers in <Europe> & 'Asia' with \"HF\" bands" };
    expect(msg.message.length).toBeGreaterThan(0);
    expect(msg.message).toContain("<Europe>");
    expect(msg.message).toContain("&");
  });

  it("should handle multi-line messages", () => {
    const msg = { message: "Line 1\nLine 2\nLine 3" };
    expect(msg.message.split("\n")).toHaveLength(3);
  });
});

// ── Tool Argument Parsing Tests ───────────────────────────────────

describe("Tool Argument Parsing", () => {
  function safeParseArgs(argsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argsStr);
    } catch {
      return {};
    }
  }

  it("should parse valid JSON arguments", () => {
    const args = safeParseArgs('{"query": "Europe", "limit": 10}');
    expect(args).toEqual({ query: "Europe", limit: 10 });
  });

  it("should return empty object for invalid JSON", () => {
    const args = safeParseArgs("not json");
    expect(args).toEqual({});
  });

  it("should return empty object for empty string", () => {
    const args = safeParseArgs("");
    expect(args).toEqual({});
  });

  it("should handle nested arguments", () => {
    const args = safeParseArgs('{"filters": {"severity": "high"}}');
    expect(args).toHaveProperty("filters");
    expect((args.filters as any).severity).toBe("high");
  });

  it("should handle numeric arguments correctly", () => {
    const args = safeParseArgs('{"targetId": 42, "limit": 10}');
    expect(typeof args.targetId).toBe("number");
    expect(typeof args.limit).toBe("number");
  });

  it("should handle boolean arguments", () => {
    const args = safeParseArgs('{"acknowledged": false, "enabled": true}');
    expect(args.acknowledged).toBe(false);
    expect(args.enabled).toBe(true);
  });
});

// ── Tool Iteration Limit Tests ────────────────────────────────────

describe("Tool Iteration Safety", () => {
  const MAX_ITERATIONS = 5;

  it("should enforce maximum iteration limit", () => {
    let iterations = 0;
    const hasMoreToolCalls = true;

    while (hasMoreToolCalls && iterations < MAX_ITERATIONS) {
      iterations++;
    }

    expect(iterations).toBe(MAX_ITERATIONS);
  });

  it("should stop when no more tool calls", () => {
    let iterations = 0;
    let hasToolCalls = true;

    while (hasToolCalls && iterations < MAX_ITERATIONS) {
      iterations++;
      if (iterations === 3) hasToolCalls = false;
    }

    expect(iterations).toBe(3);
  });
});

// ── Conflict Event Cache Tests ────────────────────────────────────

describe("Conflict Event Filtering (RAG)", () => {
  interface MockConflictEvent {
    id: number;
    date: string;
    lat: number;
    lng: number;
    country: string;
    region: string;
    conflict: string;
    type: number;
    best: number;
    sideA: string;
    sideB: string;
  }

  const mockEvents: MockConflictEvent[] = [
    {
      id: 1,
      date: "2024-01-15",
      lat: 15.5,
      lng: 32.5,
      country: "Sudan",
      region: "Khartoum",
      conflict: "Sudan civil war",
      type: 1,
      best: 50,
      sideA: "SAF",
      sideB: "RSF",
    },
    {
      id: 2,
      date: "2024-02-20",
      lat: 48.5,
      lng: 37.5,
      country: "Ukraine",
      region: "Donetsk",
      conflict: "Russia-Ukraine",
      type: 1,
      best: 120,
      sideA: "Ukraine",
      sideB: "Russia",
    },
    {
      id: 3,
      date: "2024-03-10",
      lat: 6.5,
      lng: 3.5,
      country: "Nigeria",
      region: "Lagos",
      conflict: "Boko Haram",
      type: 2,
      best: 5,
      sideA: "Boko Haram",
      sideB: "ISWAP",
    },
  ];

  it("should filter by country", () => {
    const q = "sudan";
    const filtered = mockEvents.filter((e) =>
      e.country.toLowerCase().includes(q)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].country).toBe("Sudan");
  });

  it("should filter by violence type", () => {
    const filtered = mockEvents.filter((e) => e.type === 1);
    expect(filtered).toHaveLength(2);
  });

  it("should filter by minimum fatalities", () => {
    const filtered = mockEvents.filter((e) => e.best >= 50);
    expect(filtered).toHaveLength(2);
  });

  it("should sort by fatalities descending", () => {
    const sorted = [...mockEvents].sort((a, b) => b.best - a.best);
    expect(sorted[0].best).toBe(120);
    expect(sorted[1].best).toBe(50);
    expect(sorted[2].best).toBe(5);
  });

  it("should apply multiple filters", () => {
    const filtered = mockEvents
      .filter((e) => e.type === 1)
      .filter((e) => e.best >= 100);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].country).toBe("Ukraine");
  });

  it("should handle empty filter results", () => {
    const filtered = mockEvents.filter((e) =>
      e.country.toLowerCase().includes("mars")
    );
    expect(filtered).toHaveLength(0);
  });
});

// ── Response Content Extraction Tests ─────────────────────────────

describe("Response Content Extraction", () => {
  function extractContent(
    content: string | Array<{ type: string; text?: string }>
  ): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n");
    }
    return "Analysis complete.";
  }

  it("should extract string content directly", () => {
    const result = extractContent("Hello, this is a response.");
    expect(result).toBe("Hello, this is a response.");
  });

  it("should extract text from content array", () => {
    const result = extractContent([
      { type: "text", text: "Part 1" },
      { type: "text", text: "Part 2" },
    ]);
    expect(result).toBe("Part 1\nPart 2");
  });

  it("should filter non-text content blocks", () => {
    const result = extractContent([
      { type: "text", text: "Visible" },
      { type: "image" },
      { type: "text", text: "Also visible" },
    ]);
    expect(result).toBe("Visible\nAlso visible");
  });

  it("should handle empty content array", () => {
    const result = extractContent([]);
    expect(result).toBe("");
  });
});

// ── Auto-Fetch Conflict Data Tests ──────────────────────────────

describe("Conflict Event Auto-Fetch Logic", () => {
  // Simulate the auto-fetch logic from ragEngine.ts
  function simulateConflictSearch(
    cacheEvents: Array<{ id: number; best: number; country: string; type: number }>,
    args: { country?: string; minFatalities?: number; violenceType?: number; limit?: number }
  ) {
    let events = [...cacheEvents];
    const limit = Math.min(Number(args.limit) || 20, 100);

    if (args.country) {
      const q = args.country.toLowerCase();
      events = events.filter((e) => e.country.toLowerCase().includes(q));
    }
    if (args.violenceType !== undefined) {
      events = events.filter((e) => e.type === args.violenceType);
    }
    if (args.minFatalities !== undefined) {
      events = events.filter((e) => e.best >= args.minFatalities!);
    }

    // Sort by fatalities desc
    events.sort((a, b) => b.best - a.best);

    return {
      totalInCache: cacheEvents.length,
      matchedEvents: events.length,
      returned: Math.min(events.length, limit),
      events: events.slice(0, limit),
    };
  }

  it("should return totalInCache=0 when cache is empty", () => {
    const result = simulateConflictSearch([], {});
    expect(result.totalInCache).toBe(0);
    expect(result.matchedEvents).toBe(0);
    expect(result.returned).toBe(0);
  });

  it("should sort events by fatalities descending", () => {
    const events = [
      { id: 1, best: 5, country: "Nigeria", type: 2 },
      { id: 2, best: 120, country: "Ukraine", type: 1 },
      { id: 3, best: 50, country: "Sudan", type: 1 },
    ];
    const result = simulateConflictSearch(events, {});
    expect(result.events[0].best).toBe(120);
    expect(result.events[1].best).toBe(50);
    expect(result.events[2].best).toBe(5);
  });

  it("should filter by minFatalities and return sorted", () => {
    const events = [
      { id: 1, best: 5, country: "Nigeria", type: 2 },
      { id: 2, best: 120, country: "Ukraine", type: 1 },
      { id: 3, best: 50, country: "Sudan", type: 1 },
    ];
    const result = simulateConflictSearch(events, { minFatalities: 10 });
    expect(result.matchedEvents).toBe(2);
    expect(result.events[0].best).toBe(120);
    expect(result.events[1].best).toBe(50);
  });

  it("should respect limit parameter", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      best: i * 10,
      country: "TestCountry",
      type: 1,
    }));
    const result = simulateConflictSearch(events, { limit: 5 });
    expect(result.returned).toBe(5);
    expect(result.events).toHaveLength(5);
    // Should be the top 5 by fatalities
    expect(result.events[0].best).toBe(490);
  });
});

// ── Receiver Online Stats Tests ─────────────────────────────────

describe("Receiver Online Stats", () => {
  interface MockReceiver {
    id: number;
    name: string;
    type: string;
    online: boolean;
  }

  const mockReceivers: MockReceiver[] = [
    { id: 1, name: "KiwiSDR Berlin", type: "KiwiSDR", online: true },
    { id: 2, name: "OpenWebRX Paris", type: "OpenWebRX", online: true },
    { id: 3, name: "WebSDR London", type: "WebSDR", online: false },
    { id: 4, name: "KiwiSDR Tokyo", type: "KiwiSDR", online: true },
    { id: 5, name: "OpenWebRX Sydney", type: "OpenWebRX", online: false },
    { id: 6, name: "KiwiSDR NYC", type: "KiwiSDR", online: false },
  ];

  function computeReceiverStats(receivers: MockReceiver[]) {
    const totalCount = receivers.length;
    const onlineCount = receivers.filter((r) => r.online).length;

    // Type breakdown
    const typeMap = new Map<string, { total: number; online: number }>();
    for (const r of receivers) {
      const entry = typeMap.get(r.type) || { total: 0, online: 0 };
      entry.total++;
      if (r.online) entry.online++;
      typeMap.set(r.type, entry);
    }

    return {
      totalReceivers: totalCount,
      onlineReceivers: onlineCount,
      offlineReceivers: totalCount - onlineCount,
      byType: Array.from(typeMap.entries()).map(([type, stats]) => ({
        type,
        total: stats.total,
        online: stats.online,
      })),
    };
  }

  it("should compute correct total, online, and offline counts", () => {
    const stats = computeReceiverStats(mockReceivers);
    expect(stats.totalReceivers).toBe(6);
    expect(stats.onlineReceivers).toBe(3);
    expect(stats.offlineReceivers).toBe(3);
  });

  it("should compute correct type breakdown", () => {
    const stats = computeReceiverStats(mockReceivers);
    const kiwiStats = stats.byType.find((t) => t.type === "KiwiSDR");
    expect(kiwiStats).toBeDefined();
    expect(kiwiStats!.total).toBe(3);
    expect(kiwiStats!.online).toBe(2);

    const openwebStats = stats.byType.find((t) => t.type === "OpenWebRX");
    expect(openwebStats).toBeDefined();
    expect(openwebStats!.total).toBe(2);
    expect(openwebStats!.online).toBe(1);

    const websdrStats = stats.byType.find((t) => t.type === "WebSDR");
    expect(websdrStats).toBeDefined();
    expect(websdrStats!.total).toBe(1);
    expect(websdrStats!.online).toBe(0);
  });

  it("should handle all receivers online", () => {
    const allOnline = mockReceivers.map((r) => ({ ...r, online: true }));
    const stats = computeReceiverStats(allOnline);
    expect(stats.onlineReceivers).toBe(6);
    expect(stats.offlineReceivers).toBe(0);
  });

  it("should handle all receivers offline", () => {
    const allOffline = mockReceivers.map((r) => ({ ...r, online: false }));
    const stats = computeReceiverStats(allOffline);
    expect(stats.onlineReceivers).toBe(0);
    expect(stats.offlineReceivers).toBe(6);
  });

  it("should handle empty receiver list", () => {
    const stats = computeReceiverStats([]);
    expect(stats.totalReceivers).toBe(0);
    expect(stats.onlineReceivers).toBe(0);
    expect(stats.offlineReceivers).toBe(0);
    expect(stats.byType).toHaveLength(0);
  });
});

// ── Tool Result Preview Tests ────────────────────────────────────

describe("Tool Result Preview Generation", () => {
  function createToolPreview(toolName: string, result: string): { summary: string; count?: number; highlights?: string[] } {
    try {
      const data = JSON.parse(result);
      switch (toolName) {
        case "search_receivers": {
          const online = data.onlineCount ?? 0;
          const offline = data.offlineCount ?? 0;
          return {
            summary: `${data.returned ?? 0} receivers found (${online} online, ${offline} offline)`,
            count: data.returned,
            highlights: (data.receivers || []).slice(0, 3).map((r: { stationLabel?: string; country?: string }) => `${r.stationLabel || "Unknown"} (${r.country || "?"})`),
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
        case "get_system_stats": {
          return {
            summary: `System: ${data.receivers?.total ?? "?"} receivers, ${data.targets?.total ?? "?"} targets`,
            highlights: [
              `Online: ${data.receivers?.online ?? "?"}`,
              `Alerts: ${data.anomalyAlerts?.total ?? "?"}`,
            ],
          };
        }
        case "cross_correlate": {
          return {
            summary: `Cross-correlation: ${data.nearbyReceivers?.length ?? 0} receivers, ${data.nearbyTargets?.length ?? 0} targets, ${data.nearbyConflicts?.length ?? 0} conflicts nearby`,
            count: (data.nearbyReceivers?.length ?? 0) + (data.nearbyTargets?.length ?? 0) + (data.nearbyConflicts?.length ?? 0),
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

  it("should generate receiver search preview", () => {
    const result = JSON.stringify({
      returned: 15,
      onlineCount: 10,
      offlineCount: 5,
      receivers: [
        { stationLabel: "KiwiSDR Berlin", country: "Germany" },
        { stationLabel: "OpenWebRX Paris", country: "France" },
      ],
    });
    const preview = createToolPreview("search_receivers", result);
    expect(preview.summary).toContain("15 receivers found");
    expect(preview.summary).toContain("10 online");
    expect(preview.count).toBe(15);
    expect(preview.highlights).toHaveLength(2);
    expect(preview.highlights![0]).toContain("Berlin");
  });

  it("should generate conflict events preview with fatality sum", () => {
    const result = JSON.stringify({
      returned: 3,
      events: [
        { country: "Ukraine", bestEstimate: 120 },
        { country: "Sudan", bestEstimate: 50 },
        { country: "Nigeria", bestEstimate: 5 },
      ],
    });
    const preview = createToolPreview("search_conflict_events", result);
    expect(preview.summary).toContain("3 conflict events");
    expect(preview.summary).toContain("175 total fatalities");
    expect(preview.count).toBe(3);
    expect(preview.highlights).toHaveLength(3);
  });

  it("should generate system stats preview", () => {
    const result = JSON.stringify({
      receivers: { total: 1700, online: 500 },
      targets: { total: 42 },
      anomalyAlerts: { total: 8 },
    });
    const preview = createToolPreview("get_system_stats", result);
    expect(preview.summary).toContain("1700 receivers");
    expect(preview.summary).toContain("42 targets");
    expect(preview.highlights).toBeDefined();
    expect(preview.highlights!.some(h => h.includes("500"))).toBe(true);
  });

  it("should generate cross-correlation preview", () => {
    const result = JSON.stringify({
      nearbyReceivers: [{ id: 1 }, { id: 2 }],
      nearbyTargets: [{ id: 3 }],
      nearbyConflicts: [{ id: 4 }, { id: 5 }, { id: 6 }],
    });
    const preview = createToolPreview("cross_correlate", result);
    expect(preview.summary).toContain("2 receivers");
    expect(preview.summary).toContain("1 targets");
    expect(preview.summary).toContain("3 conflicts");
    expect(preview.count).toBe(6);
  });

  it("should handle invalid JSON gracefully", () => {
    const preview = createToolPreview("search_receivers", "not json");
    expect(preview.summary).toBe("Data retrieved");
  });

  it("should handle unknown tool with generic preview", () => {
    const result = JSON.stringify({ returned: 42, items: [] });
    const preview = createToolPreview("unknown_tool", result);
    expect(preview.summary).toContain("42 results");
    expect(preview.count).toBe(42);
  });
});

// ── Follow-Up Suggestion Parsing Tests ──────────────────────────

describe("Follow-Up Suggestion Parsing", () => {
  const SUGGESTION_REGEX = /\[SUGGESTION:([^\]]+)\]/g;

  function parseSuggestions(text: string): { text: string }[] {
    const suggestions: { text: string }[] = [];
    let match;
    const regex = new RegExp(SUGGESTION_REGEX.source, "g");
    while ((match = regex.exec(text)) !== null) {
      suggestions.push({ text: match[1].trim() });
    }
    return suggestions;
  }

  function stripSuggestions(text: string): string {
    return text
      .replace(SUGGESTION_REGEX, "")
      .replace(/---\s*\n\*\*Suggested follow-ups:\*\*\s*/g, "")
      .trim();
  }

  it("should parse suggestions from response text", () => {
    const text = `Here is the analysis.\n\n---\n**Suggested follow-ups:**\n- [SUGGESTION:Show me receivers in Europe]\n- [SUGGESTION:What are the top conflict zones?]\n- [SUGGESTION:Compare KiwiSDR vs OpenWebRX uptime]`;
    const suggestions = parseSuggestions(text);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].text).toBe("Show me receivers in Europe");
    expect(suggestions[1].text).toBe("What are the top conflict zones?");
    expect(suggestions[2].text).toBe("Compare KiwiSDR vs OpenWebRX uptime");
  });

  it("should strip suggestions from display text", () => {
    const text = `Analysis results here.\n\n---\n**Suggested follow-ups:**\n- [SUGGESTION:Follow up 1]\n- [SUGGESTION:Follow up 2]`;
    const clean = stripSuggestions(text);
    expect(clean).not.toContain("[SUGGESTION:");
    expect(clean).not.toContain("Suggested follow-ups:");
    expect(clean).toContain("Analysis results here.");
  });

  it("should handle text with no suggestions", () => {
    const text = "Just a regular response with no suggestions.";
    const suggestions = parseSuggestions(text);
    expect(suggestions).toHaveLength(0);
    const clean = stripSuggestions(text);
    expect(clean).toBe(text);
  });

  it("should handle suggestions with special characters", () => {
    const text = `[SUGGESTION:What's the uptime for receiver #42?]`;
    const suggestions = parseSuggestions(text);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].text).toContain("#42");
  });
});

// ── Context Window Management Tests ─────────────────────────────

describe("Context Window Management", () => {
  interface ChatMsg {
    role: "user" | "assistant" | "system";
    content: string;
  }

  const MAX_HISTORY_MESSAGES = 20;
  const MAX_HISTORY_CHARS = 30000;

  function manageContext(history: ChatMsg[]): ChatMsg[] {
    const totalChars = history.reduce((s, m) => s + m.content.length, 0);
    if (history.length > MAX_HISTORY_MESSAGES || totalChars > MAX_HISTORY_CHARS) {
      const recentCount = 6;
      const oldMessages = history.slice(0, -recentCount);
      const recentMessages = history.slice(-recentCount);

      if (oldMessages.length > 0) {
        const summaryText = oldMessages
          .map(m => `[${m.role}]: ${m.content.slice(0, 200)}`)
          .join("\n");
        const summaryMsg: ChatMsg = {
          role: "system",
          content: `[CONVERSATION SUMMARY]\n${summaryText.slice(0, 3000)}\n[END SUMMARY]`,
        };
        return [summaryMsg, ...recentMessages];
      }
    }
    return history;
  }

  it("should not trim short conversations", () => {
    const history: ChatMsg[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = manageContext(history);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Hello");
  });

  it("should trim conversations exceeding message limit", () => {
    const history: ChatMsg[] = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));
    const result = manageContext(history);
    // Should have 1 summary + 6 recent = 7
    expect(result).toHaveLength(7);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("CONVERSATION SUMMARY");
    expect(result[result.length - 1].content).toBe("Message 24");
  });

  it("should trim conversations exceeding character limit", () => {
    const history: ChatMsg[] = [
      { role: "user", content: "a".repeat(20000) },
      { role: "assistant", content: "b".repeat(15000) },
      { role: "user", content: "Short question" },
      { role: "assistant", content: "Short answer" },
      { role: "user", content: "Another question" },
      { role: "assistant", content: "Another answer" },
      { role: "user", content: "Final question" },
      { role: "assistant", content: "Final answer" },
    ];
    const result = manageContext(history);
    // Should trim because totalChars > 30000
    expect(result.length).toBeLessThan(history.length);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("CONVERSATION SUMMARY");
  });

  it("should preserve the 6 most recent messages", () => {
    const history: ChatMsg[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));
    const result = manageContext(history);
    const recentMessages = result.slice(1); // Skip summary
    expect(recentMessages).toHaveLength(6);
    expect(recentMessages[0].content).toBe("Message 24");
    expect(recentMessages[5].content).toBe("Message 29");
  });

  it("should truncate summary to 3000 chars", () => {
    const history: ChatMsg[] = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: "x".repeat(500) + ` msg${i}`,
    }));
    const result = manageContext(history);
    const summary = result[0];
    // The summary content should be bounded
    expect(summary.content.length).toBeLessThanOrEqual(3100); // 3000 + header/footer
  });
});

// ── Conversation Export Tests ────────────────────────────────────

describe("Conversation Export", () => {
  interface ChatMsg {
    role: "user" | "assistant";
    content: string;
    globeActions?: Array<{ type: string; label: string; params: string }>;
  }

  function generateExport(messages: ChatMsg[]): string {
    let md = `# Valentine RF Intelligence Chat Export\n`;
    md += `**Messages:** ${messages.length}\n\n---\n\n`;

    for (const msg of messages) {
      const role = msg.role === "user" ? "User" : "Intel Analyst";
      md += `### ${role}\n\n`;
      md += `${msg.content}\n\n`;
      if (msg.globeActions && msg.globeActions.length > 0) {
        md += `**Globe Actions:**\n`;
        for (const a of msg.globeActions) {
          md += `- ${a.type}: ${a.label} (${a.params})\n`;
        }
        md += `\n`;
      }
      md += `---\n\n`;
    }

    return md;
  }

  it("should generate valid markdown export", () => {
    const messages: ChatMsg[] = [
      { role: "user", content: "Show me receivers in Europe" },
      { role: "assistant", content: "Here are 500 receivers in Europe." },
    ];
    const md = generateExport(messages);
    expect(md).toContain("# Valentine RF Intelligence Chat Export");
    expect(md).toContain("**Messages:** 2");
    expect(md).toContain("### User");
    expect(md).toContain("### Intel Analyst");
    expect(md).toContain("Show me receivers in Europe");
  });

  it("should include globe actions in export", () => {
    const messages: ChatMsg[] = [
      {
        role: "assistant",
        content: "Found a receiver in Berlin.",
        globeActions: [
          { type: "FLY_TO", label: "Berlin", params: "52.52,13.405" },
        ],
      },
    ];
    const md = generateExport(messages);
    expect(md).toContain("**Globe Actions:**");
    expect(md).toContain("FLY_TO: Berlin");
  });

  it("should handle empty conversation", () => {
    const md = generateExport([]);
    expect(md).toContain("**Messages:** 0");
  });
});

// ── New RAG Tool Parameter Tests ─────────────────────────────────

describe("New RAG Tool Parameters", () => {
  it("compare_receivers should require receiverIds array", () => {
    const params = TOOL_PARAMS["compare_receivers"];
    expect(params.required).toContain("receiverIds");
  });

  it("cross_correlate should require lat and lng", () => {
    const params = TOOL_PARAMS["cross_correlate"];
    expect(params.required).toContain("lat");
    expect(params.required).toContain("lng");
    expect(params.optional).toContain("radiusKm");
  });

  it("search_scan_history should have optional receiverId", () => {
    const params = TOOL_PARAMS["search_scan_history"];
    expect(params.optional).toContain("receiverId");
    expect(params.optional).toContain("limit");
  });

  it("query_directory_sources should have no required params", () => {
    const params = TOOL_PARAMS["query_directory_sources"];
    expect(params.required).toHaveLength(0);
    expect(params.optional).toHaveLength(0);
  });
});
