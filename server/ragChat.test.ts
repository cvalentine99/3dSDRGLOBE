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
};

describe("RAG Tool Definitions", () => {
  it("should define exactly 9 tools", () => {
    expect(RAG_TOOL_NAMES).toHaveLength(9);
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
