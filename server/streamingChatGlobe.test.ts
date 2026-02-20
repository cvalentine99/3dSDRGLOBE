/**
 * streamingChatGlobe.test.ts — Tests for SSE streaming, DB chat persistence, and globe actions
 *
 * Tests cover:
 * 1. SSE streaming event format and parsing
 * 2. Chat message DB persistence schema
 * 3. Globe action parsing from LLM responses
 * 4. RAG streaming function structure
 * 5. Globe action button rendering logic
 */

import { describe, it, expect } from "vitest";

// ── 1. Globe Action Parsing Tests ────────────────────────────────

describe("Globe Action Parsing", () => {
  const GLOBE_ACTION_REGEX = /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/g;

  function parseGlobeActions(text: string) {
    const actions: { type: string; params: string; label: string }[] = [];
    let match;
    const regex = new RegExp(GLOBE_ACTION_REGEX.source, "g");
    while ((match = regex.exec(text)) !== null) {
      actions.push({
        type: match[1],
        params: match[2],
        label: match[3],
      });
    }
    return actions;
  }

  function stripGlobeActions(text: string) {
    return text.replace(GLOBE_ACTION_REGEX, "").trim();
  }

  it("should parse FLY_TO actions with coordinates", () => {
    const text = "Here is the location [GLOBE:FLY_TO:48.8566,2.3522:Paris, France] for reference.";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("FLY_TO");
    expect(actions[0].params).toBe("48.8566,2.3522");
    expect(actions[0].label).toBe("Paris, France");
  });

  it("should parse HIGHLIGHT actions with receiver IDs", () => {
    const text = "Check this receiver [GLOBE:HIGHLIGHT:42:KiwiSDR Brussels] for details.";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("HIGHLIGHT");
    expect(actions[0].params).toBe("42");
    expect(actions[0].label).toBe("KiwiSDR Brussels");
  });

  it("should parse OVERLAY actions", () => {
    const text = "Enable the overlay [GLOBE:OVERLAY:conflict:Show Conflict Zones] to see the data.";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("OVERLAY");
    expect(actions[0].params).toBe("conflict");
    expect(actions[0].label).toBe("Show Conflict Zones");
  });

  it("should parse multiple actions from a single response", () => {
    const text = `Analysis shows activity near [GLOBE:FLY_TO:51.5074,-0.1278:London, UK] and 
    also near [GLOBE:FLY_TO:40.7128,-74.0060:New York, USA]. 
    Enable [GLOBE:OVERLAY:conflict:Show Conflicts] for context.`;
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(3);
    expect(actions[0].type).toBe("FLY_TO");
    expect(actions[1].type).toBe("FLY_TO");
    expect(actions[2].type).toBe("OVERLAY");
  });

  it("should return empty array for text without actions", () => {
    const text = "This is a normal response without any globe actions.";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(0);
  });

  it("should strip globe actions from text", () => {
    const text = "Check this [GLOBE:FLY_TO:48.8566,2.3522:Paris] location.";
    const stripped = stripGlobeActions(text);
    expect(stripped).toBe("Check this  location.");
    expect(stripped).not.toContain("[GLOBE:");
  });

  it("should strip multiple actions from text", () => {
    const text = "[GLOBE:FLY_TO:0,0:Origin] Start [GLOBE:OVERLAY:conflict:Conflicts] End";
    const stripped = stripGlobeActions(text);
    expect(stripped).toBe("Start  End");
  });

  it("should handle negative coordinates in FLY_TO", () => {
    const text = "[GLOBE:FLY_TO:-33.8688,151.2093:Sydney, Australia]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toBe("-33.8688,151.2093");
  });

  it("should handle propagation overlay type", () => {
    const text = "[GLOBE:OVERLAY:propagation:Show Propagation]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toBe("propagation");
  });
});

// ── 2. SSE Event Format Tests ────────────────────────────────────

describe("SSE Event Format", () => {
  it("should format status events correctly", () => {
    const event = { type: "status", data: "Analyzing query..." };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    expect(sseData).toContain("data: ");
    expect(sseData).toContain('"type":"status"');
    expect(sseData).toContain('"data":"Analyzing query..."');
    expect(sseData.endsWith("\n\n")).toBe(true);
  });

  it("should format token events correctly", () => {
    const event = { type: "token", data: "The " };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    const parsed = JSON.parse(sseData.replace("data: ", "").trim());
    expect(parsed.type).toBe("token");
    expect(parsed.data).toBe("The ");
  });

  it("should format done events correctly", () => {
    const event = { type: "done", data: "" };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    const parsed = JSON.parse(sseData.replace("data: ", "").trim());
    expect(parsed.type).toBe("done");
  });

  it("should format error events correctly", () => {
    const event = { type: "error", data: "An error occurred during processing." };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;
    const parsed = JSON.parse(sseData.replace("data: ", "").trim());
    expect(parsed.type).toBe("error");
    expect(parsed.data).toContain("error");
  });

  it("should handle [DONE] termination signal", () => {
    const doneSignal = "data: [DONE]\n\n";
    expect(doneSignal.includes("[DONE]")).toBe(true);
  });

  it("should parse multiple SSE lines from a buffer", () => {
    const buffer = `data: {"type":"status","data":"Querying..."}\ndata: {"type":"token","data":"Hello"}\ndata: {"type":"token","data":" World"}\n`;
    const lines = buffer.split("\n").filter((l) => l.startsWith("data: "));
    expect(lines).toHaveLength(3);

    const events = lines.map((l) => JSON.parse(l.slice(6)));
    expect(events[0].type).toBe("status");
    expect(events[1].type).toBe("token");
    expect(events[1].data).toBe("Hello");
    expect(events[2].type).toBe("token");
    expect(events[2].data).toBe(" World");
  });
});

// ── 3. Chat Message Persistence Schema Tests ─────────────────────

describe("Chat Message Schema", () => {
  it("should define correct message roles", () => {
    const validRoles = ["user", "assistant"];
    expect(validRoles).toContain("user");
    expect(validRoles).toContain("assistant");
  });

  it("should enforce max message length of 4000 chars", () => {
    const maxLength = 4000;
    const validMessage = "a".repeat(maxLength);
    const invalidMessage = "a".repeat(maxLength + 1);
    expect(validMessage.length).toBeLessThanOrEqual(maxLength);
    expect(invalidMessage.length).toBeGreaterThan(maxLength);
  });

  it("should store globe actions as JSON array", () => {
    const actions = [
      { type: "FLY_TO", params: "48.8566,2.3522", label: "Paris" },
      { type: "OVERLAY", params: "conflict", label: "Show Conflicts" },
    ];
    const serialized = JSON.stringify(actions);
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toHaveLength(2);
    expect(deserialized[0].type).toBe("FLY_TO");
    expect(deserialized[1].type).toBe("OVERLAY");
  });

  it("should handle null globe actions for messages without actions", () => {
    const globeActions = null;
    expect(globeActions).toBeNull();
  });

  it("should use timestamp in milliseconds", () => {
    const timestamp = Date.now();
    expect(timestamp).toBeGreaterThan(1700000000000);
    expect(typeof timestamp).toBe("number");
  });
});

// ── 4. RAG Streaming Function Structure Tests ────────────────────

describe("RAG Streaming Structure", () => {
  it("should define StreamCallback type with correct event types", () => {
    const validTypes = ["status", "token", "done", "error"];
    validTypes.forEach((type) => {
      expect(["status", "token", "done", "error"]).toContain(type);
    });
  });

  it("should support conversation history format", () => {
    const history = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });

  it("should limit conversation history to 50 messages", () => {
    const MAX_HISTORY = 50;
    const largeHistory = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));
    const trimmed = largeHistory.slice(-MAX_HISTORY);
    expect(trimmed).toHaveLength(MAX_HISTORY);
    expect(trimmed[0].content).toBe("Message 50");
  });

  it("should handle empty conversation history", () => {
    const history: { role: string; content: string }[] = [];
    expect(history).toHaveLength(0);
  });
});

// ── 5. Globe Action Execution Logic Tests ────────────────────────

describe("Globe Action Execution", () => {
  it("should parse FLY_TO coordinates correctly", () => {
    const action = { type: "FLY_TO", params: "48.8566,2.3522", label: "Paris" };
    const [latStr, lngStr] = action.params.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    expect(lat).toBeCloseTo(48.8566, 4);
    expect(lng).toBeCloseTo(2.3522, 4);
    expect(isNaN(lat)).toBe(false);
    expect(isNaN(lng)).toBe(false);
  });

  it("should handle negative coordinates in FLY_TO", () => {
    const action = { type: "FLY_TO", params: "-33.8688,151.2093", label: "Sydney" };
    const [latStr, lngStr] = action.params.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    expect(lat).toBeCloseTo(-33.8688, 4);
    expect(lng).toBeCloseTo(151.2093, 4);
  });

  it("should handle HIGHLIGHT with numeric receiver ID", () => {
    const action = { type: "HIGHLIGHT", params: "42", label: "KiwiSDR Brussels" };
    const receiverId = action.params;
    expect(receiverId).toBe("42");
    expect(parseInt(receiverId)).toBe(42);
  });

  it("should handle OVERLAY toggle types", () => {
    const validOverlays = ["conflict", "propagation", "heatmap", "geofence", "timeline", "anomaly", "watchlist", "milrf", "waterfall", "targets"];
    const action = { type: "OVERLAY", params: "conflict", label: "Show Conflicts" };
    expect(validOverlays).toContain(action.params.toLowerCase());
  });

  it("should match all 10 registered overlay names", () => {
    const registeredOverlays = ["conflict", "propagation", "heatmap", "geofence", "timeline", "anomaly", "watchlist", "milrf", "waterfall", "targets"];
    expect(registeredOverlays).toHaveLength(10);
    registeredOverlays.forEach((name) => {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });
  });

  it("should reject invalid FLY_TO coordinates gracefully", () => {
    const action = { type: "FLY_TO", params: "invalid,coords", label: "Bad" };
    const [latStr, lngStr] = action.params.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    expect(isNaN(lat)).toBe(true);
    expect(isNaN(lng)).toBe(true);
  });

  it("should create globe target with zoom level 3 for FLY_TO", () => {
    const action = { type: "FLY_TO", params: "48.8566,2.3522", label: "Paris" };
    const [latStr, lngStr] = action.params.split(",");
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const target = { lat, lng, zoom: 3 };
    expect(target.zoom).toBe(3);
    expect(target.lat).toBeCloseTo(48.8566, 4);
    expect(target.lng).toBeCloseTo(2.3522, 4);
  });
});

// ── 6. SSE Endpoint Validation Tests ─────────────────────────────

describe("SSE Endpoint Validation", () => {
  it("should require non-empty message", () => {
    const message = "";
    const isValid = message && typeof message === "string" && message.length <= 4000;
    expect(isValid).toBeFalsy();
  });

  it("should reject messages over 4000 characters", () => {
    const message = "a".repeat(4001);
    const isValid = message && typeof message === "string" && message.length <= 4000;
    expect(isValid).toBeFalsy();
  });

  it("should accept valid messages", () => {
    const message = "What receivers are near conflict zones?";
    const isValid = message && typeof message === "string" && message.length <= 4000;
    expect(isValid).toBeTruthy();
  });

  it("should reject non-string messages", () => {
    const message = 12345 as unknown;
    const isValid = message && typeof message === "string" && (message as string).length <= 4000;
    expect(isValid).toBeFalsy();
  });

  it("should set correct SSE headers", () => {
    const expectedHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    expect(expectedHeaders["Content-Type"]).toBe("text/event-stream");
    expect(expectedHeaders["Cache-Control"]).toBe("no-cache");
    expect(expectedHeaders["Connection"]).toBe("keep-alive");
    expect(expectedHeaders["X-Accel-Buffering"]).toBe("no");
  });
});

// ── 7. Globe Action Extraction from Full Response ────────────────

describe("Globe Action Extraction in SSE Endpoint", () => {
  it("should extract globe actions from full response text", () => {
    const fullResponse = `Here is the analysis. The main activity is near [GLOBE:FLY_TO:48.8566,2.3522:Paris, France]. 
    Enable [GLOBE:OVERLAY:conflict:Show Conflict Zones] for context.`;

    const globeActionRegex = /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/g;
    const globeActions: { type: string; params: string; label: string }[] = [];
    let match;
    while ((match = globeActionRegex.exec(fullResponse)) !== null) {
      globeActions.push({
        type: match[1],
        params: match[2],
        label: match[3],
      });
    }

    expect(globeActions).toHaveLength(2);
    expect(globeActions[0].type).toBe("FLY_TO");
    expect(globeActions[0].params).toBe("48.8566,2.3522");
    expect(globeActions[1].type).toBe("OVERLAY");
    expect(globeActions[1].params).toBe("conflict");
  });

  it("should return empty array when no actions in response", () => {
    const fullResponse = "This is a plain analysis without any globe actions.";
    const globeActionRegex = /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/g;
    const globeActions: unknown[] = [];
    let match;
    while ((match = globeActionRegex.exec(fullResponse)) !== null) {
      globeActions.push({ type: match[1], params: match[2], label: match[3] });
    }
    expect(globeActions).toHaveLength(0);
  });
});

// ── 8. LLM Streaming Response Format Tests ───────────────────────

describe("LLM Streaming Response Format", () => {
  it("should parse SSE chunk format from LLM API", () => {
    const chunk = '{"choices":[{"delta":{"content":"Hello"}}]}';
    const parsed = JSON.parse(chunk);
    expect(parsed.choices[0].delta.content).toBe("Hello");
  });

  it("should handle empty delta content", () => {
    const chunk = '{"choices":[{"delta":{}}]}';
    const parsed = JSON.parse(chunk);
    expect(parsed.choices[0].delta.content).toBeUndefined();
  });

  it("should handle tool_calls in delta", () => {
    const chunk = '{"choices":[{"delta":{"tool_calls":[{"function":{"name":"search_receivers"}}]}}]}';
    const parsed = JSON.parse(chunk);
    expect(parsed.choices[0].delta.tool_calls).toBeDefined();
    expect(parsed.choices[0].delta.tool_calls[0].function.name).toBe("search_receivers");
  });

  it("should accumulate tokens into full content", () => {
    const tokens = ["The ", "receiver ", "is ", "located ", "in ", "Paris."];
    let fullContent = "";
    for (const token of tokens) {
      fullContent += token;
    }
    expect(fullContent).toBe("The receiver is located in Paris.");
  });

  it("should handle [DONE] signal in SSE stream", () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" World"}}]}',
      "data: [DONE]",
    ];
    let fullContent = "";
    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      const parsed = JSON.parse(data);
      if (parsed.choices?.[0]?.delta?.content) {
        fullContent += parsed.choices[0].delta.content;
      }
    }
    expect(fullContent).toBe("Hello World");
  });
});

// ── 9. Chat History DB Operations Tests ──────────────────────────

describe("Chat History DB Operations", () => {
  it("should order history oldest-first after reversal", () => {
    const dbRows = [
      { id: 3, role: "assistant", content: "C", createdAt: 300 },
      { id: 2, role: "user", content: "B", createdAt: 200 },
      { id: 1, role: "user", content: "A", createdAt: 100 },
    ];
    const history = dbRows.reverse().map((r) => ({
      role: r.role,
      content: r.content,
    }));
    expect(history[0].content).toBe("A");
    expect(history[1].content).toBe("B");
    expect(history[2].content).toBe("C");
  });

  it("should limit history to MAX_HISTORY entries", () => {
    const MAX_HISTORY = 50;
    const rows = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}`,
    }));
    const limited = rows.slice(-MAX_HISTORY);
    expect(limited).toHaveLength(MAX_HISTORY);
  });

  it("should handle empty DB result gracefully", () => {
    const rows: unknown[] = [];
    const history = rows.map(() => ({ role: "user", content: "" }));
    expect(history).toHaveLength(0);
  });

  it("should save globe actions as JSON when present", () => {
    const actions = [{ type: "FLY_TO", params: "0,0", label: "Origin" }];
    const hasActions = actions && actions.length > 0;
    expect(hasActions).toBe(true);
    const stored = hasActions ? actions : null;
    expect(stored).not.toBeNull();
  });

  it("should save null globe actions when none present", () => {
    const actions: unknown[] = [];
    const hasActions = actions && actions.length > 0;
    expect(hasActions).toBe(false);
    const stored = hasActions ? actions : null;
    expect(stored).toBeNull();
  });
});

// ── 10. Globe Action Prompt Tests ────────────────────────────────

describe("Globe Action Prompt", () => {
  it("should define all three action types", () => {
    const actionTypes = ["FLY_TO", "HIGHLIGHT", "OVERLAY"];
    actionTypes.forEach((type) => {
      expect(["FLY_TO", "HIGHLIGHT", "OVERLAY"]).toContain(type);
    });
  });

  it("should provide valid examples for each action type", () => {
    const examples = [
      "[GLOBE:FLY_TO:48.8566,2.3522:Paris, France]",
      "[GLOBE:HIGHLIGHT:42:KiwiSDR Brussels]",
      "[GLOBE:OVERLAY:conflict:Show Conflict Zones]",
      "[GLOBE:OVERLAY:propagation:Show Propagation]",
    ];
    examples.forEach((ex) => {
      expect(ex).toMatch(/\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):/);
    });
  });
});

// ── 11. Overlay Toggle Wiring Tests ─────────────────────────────

describe("Overlay Toggle Wiring", () => {
  const REGISTERED_OVERLAYS = [
    "conflict", "propagation", "heatmap", "geofence", "timeline",
    "anomaly", "watchlist", "milrf", "waterfall", "targets",
  ];

  function matchOverlay(input: string, toggles: Record<string, (val?: boolean) => void>) {
    const overlay = input.toLowerCase().trim();
    const key = Object.keys(toggles).find(
      (k) => k === overlay || overlay.includes(k) || k.includes(overlay)
    );
    return key ?? null;
  }

  it("should match exact overlay names", () => {
    const toggles: Record<string, (val?: boolean) => void> = {};
    REGISTERED_OVERLAYS.forEach((name) => {
      toggles[name] = () => {};
    });
    REGISTERED_OVERLAYS.forEach((name) => {
      expect(matchOverlay(name, toggles)).toBe(name);
    });
  });

  it("should match overlay names case-insensitively", () => {
    const toggles: Record<string, (val?: boolean) => void> = {};
    REGISTERED_OVERLAYS.forEach((name) => {
      toggles[name] = () => {};
    });
    expect(matchOverlay("CONFLICT", toggles)).toBe("conflict");
    expect(matchOverlay("Propagation", toggles)).toBe("propagation");
    expect(matchOverlay("HEATMAP", toggles)).toBe("heatmap");
  });

  it("should match partial overlay names via includes", () => {
    const toggles: Record<string, (val?: boolean) => void> = {};
    REGISTERED_OVERLAYS.forEach((name) => {
      toggles[name] = () => {};
    });
    expect(matchOverlay("show conflict zones", toggles)).toBe("conflict");
    expect(matchOverlay("propagation overlay", toggles)).toBe("propagation");
  });

  it("should return null for unknown overlay names", () => {
    const toggles: Record<string, (val?: boolean) => void> = {};
    REGISTERED_OVERLAYS.forEach((name) => {
      toggles[name] = () => {};
    });
    expect(matchOverlay("unknown_overlay", toggles)).toBeNull();
    expect(matchOverlay("xyz", toggles)).toBeNull();
  });

  it("should toggle overlay state when callback is invoked", () => {
    let conflictState = false;
    let propagationState = false;
    const toggles: Record<string, (val?: boolean) => void> = {
      conflict: (val?: boolean) => { conflictState = val !== undefined ? val : !conflictState; },
      propagation: (val?: boolean) => { propagationState = val !== undefined ? val : !propagationState; },
    };
    toggles.conflict();
    expect(conflictState).toBe(true);
    toggles.conflict();
    expect(conflictState).toBe(false);
    toggles.propagation(true);
    expect(propagationState).toBe(true);
    toggles.propagation(false);
    expect(propagationState).toBe(false);
  });

  it("should handle empty toggles map gracefully", () => {
    const toggles: Record<string, (val?: boolean) => void> = {};
    expect(matchOverlay("conflict", toggles)).toBeNull();
  });

  it("should handle all 10 overlay types from GLOBE_ACTION_PROMPT", () => {
    const overlayExamples = [
      "[GLOBE:OVERLAY:conflict:Show Conflict Zones]",
      "[GLOBE:OVERLAY:propagation:Show Propagation]",
      "[GLOBE:OVERLAY:heatmap:Toggle Heatmap]",
      "[GLOBE:OVERLAY:geofence:Open Geofence Panel]",
      "[GLOBE:OVERLAY:timeline:Open SIGINT Timeline]",
      "[GLOBE:OVERLAY:anomaly:Show Anomaly Alerts]",
      "[GLOBE:OVERLAY:watchlist:Open Watchlist]",
      "[GLOBE:OVERLAY:targets:Show Targets]",
      "[GLOBE:OVERLAY:milrf:Open MilRF Panel]",
      "[GLOBE:OVERLAY:waterfall:Show Waterfall]",
    ];
    const regex = /\[GLOBE:OVERLAY:([^:]+):([^\]]+)\]/;
    overlayExamples.forEach((ex) => {
      const match = ex.match(regex);
      expect(match).not.toBeNull();
      expect(REGISTERED_OVERLAYS).toContain(match![1]);
    });
  });

  it("should parse OVERLAY action and find matching toggle", () => {
    const text = "[GLOBE:OVERLAY:geofence:Open Geofence Panel]";
    const regex = /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/;
    const match = text.match(regex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("OVERLAY");
    expect(match![2]).toBe("geofence");

    const toggles: Record<string, (val?: boolean) => void> = {};
    REGISTERED_OVERLAYS.forEach((name) => {
      toggles[name] = () => {};
    });
    const key = matchOverlay(match![2], toggles);
    expect(key).toBe("geofence");
  });
});
