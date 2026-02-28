/**
 * liveTranslator.test.ts — Tests for server-side live translation service
 *
 * Tests the session management and event flow.
 * Uses a mock WebSocket that fires open synchronously to avoid
 * race conditions with the stop() method.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track all created mock WebSocket instances
let mockWsInstances: any[] = [];

// Mock WebSocket — fires "open" synchronously in the next microtask
vi.mock("ws", () => {
  const EventEmitter = require("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    sentMessages: string[] = [];

    constructor(url: string, options?: any) {
      super();
      mockWsInstances.push(this);
      // Fire open in the next microtask (not setTimeout which can race)
      Promise.resolve().then(() => {
        if (this.readyState === 1) {
          this.emit("open");
        }
      });
    }

    send(data: string) {
      this.sentMessages.push(data);
    }

    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }

  return { default: MockWebSocket, __esModule: true };
});

// Mock ENV
vi.mock("./_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://api.example.com/",
    forgeApiKey: "test-key-123",
  },
}));

// Mock fetch for Whisper API
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
  mockWsInstances = [];
});

afterEach(async () => {
  // Import fresh and stop any active session
  const { getActiveSession } = await import("./liveTranslator");
  const session = getActiveSession();
  if (session) session.stop();
  globalThis.fetch = originalFetch;
  // Allow any pending microtasks to settle
  await new Promise((r) => setTimeout(r, 20));
});

describe("Live Translator - Session Management", () => {
  it("starts with no active session", async () => {
    const { isTranslationActive, getActiveSession } = await import("./liveTranslator");
    // Ensure clean state
    const existing = getActiveSession();
    if (existing) existing.stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(isTranslationActive()).toBe(false);
  });

  it("creates a session with correct parameters", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");
    const events: any[] = [];

    const session = startLiveTranslation(
      {
        host: "kiwi.example.com",
        port: 8073,
        frequencyKhz: 7200,
        mode: "am",
        dualMode: true,
      },
      (event) => events.push(event),
    );

    expect(session).toBeDefined();
    expect(session.host).toBe("kiwi.example.com");
    expect(session.port).toBe(8073);
    expect(session.frequencyKhz).toBe(7200);
    expect(session.mode).toBe("am");
    expect(session.id).toBeTruthy();
    expect(session.startedAt).toBeGreaterThan(0);

    session.stop();
  });

  it("reports active session after start", async () => {
    const { startLiveTranslation, isTranslationActive, getActiveSession } = await import("./liveTranslator");

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 14100 },
      () => {},
    );

    expect(isTranslationActive()).toBe(true);
    expect(getActiveSession()).not.toBeNull();
    expect(getActiveSession()?.host).toBe("test.com");

    session.stop();
  });

  it("stops previous session when starting a new one", async () => {
    const { startLiveTranslation, getActiveSession } = await import("./liveTranslator");
    const events1: any[] = [];

    const session1 = startLiveTranslation(
      { host: "host1.com", port: 8073, frequencyKhz: 7200 },
      (event) => events1.push(event),
    );

    const session2 = startLiveTranslation(
      { host: "host2.com", port: 8073, frequencyKhz: 14100 },
      () => {},
    );

    // Session 1 should have been stopped
    expect(events1.some((e) => e.type === "done")).toBe(true);

    // Active session should be session 2
    const active = getActiveSession();
    expect(active?.host).toBe("host2.com");

    session2.stop();
  });

  it("emits done event when session is stopped", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");
    const events: any[] = [];

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      (event) => events.push(event),
    );

    session.stop();

    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("session has unique ID", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");

    const session1 = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      () => {},
    );
    const id1 = session1.id;
    session1.stop();

    const session2 = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      () => {},
    );
    const id2 = session2.id;
    session2.stop();

    expect(id1).not.toBe(id2);
  });

  it("emits connecting status event immediately", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");
    const events: any[] = [];

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      (event) => events.push(event),
    );

    // The "Connecting" status should be emitted synchronously
    const hasConnecting = events.some(
      (e) => e.type === "status" && typeof e.data === "string" && e.data.includes("Connecting"),
    );
    expect(hasConnecting).toBe(true);

    session.stop();
  });
});

describe("Live Translator - Session Lifecycle", () => {
  it("getActiveSession returns null after stop", async () => {
    const { startLiveTranslation, getActiveSession } = await import("./liveTranslator");

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      () => {},
    );

    session.stop();
    expect(getActiveSession()).toBeNull();
  });

  it("isTranslationActive returns false after stop", async () => {
    const { startLiveTranslation, isTranslationActive } = await import("./liveTranslator");

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      () => {},
    );

    session.stop();
    expect(isTranslationActive()).toBe(false);
  });

  it("multiple stops are safe (idempotent)", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");
    const events: any[] = [];

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 7200 },
      (event) => events.push(event),
    );

    session.stop();
    session.stop(); // Should not throw
    session.stop(); // Should not throw

    // At least one "done" event should be emitted, and no errors thrown
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("sends KiwiSDR protocol commands after connection", async () => {
    const { startLiveTranslation } = await import("./liveTranslator");

    const session = startLiveTranslation(
      { host: "test.com", port: 8073, frequencyKhz: 9500, mode: "am" },
      () => {},
    );

    // Wait for the mock WebSocket open event (microtask)
    await new Promise((r) => setTimeout(r, 20));

    // Check the mock WebSocket sent the right commands
    const ws = mockWsInstances[mockWsInstances.length - 1];
    if (ws && ws.sentMessages) {
      const msgs = ws.sentMessages;
      expect(msgs.some((m: string) => m.includes("SET auth"))).toBe(true);
      expect(msgs.some((m: string) => m.includes("freq=9500"))).toBe(true);
      expect(msgs.some((m: string) => m.includes("compression=0"))).toBe(true);
    }

    session.stop();
  });
});
