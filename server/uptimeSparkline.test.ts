/**
 * uptimeSparkline.test.ts — Tests for the UptimeSparkline bucketize logic
 * and the uptime tRPC endpoints (receiverHistory, recentScans, aggregateStats).
 *
 * Since the sparkline is a React component, we test the pure bucketize function
 * separately and verify the tRPC endpoints return the correct shapes.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/* ── Bucketize function (extracted from component for testing) ── */

function bucketize(
  history: { online: boolean; checkedAt: number }[],
  hoursBack: number,
  bucketCount: number
): (boolean | null)[] {
  if (history.length === 0) return new Array(bucketCount).fill(null);

  const now = Date.now();
  const start = now - hoursBack * 60 * 60 * 1000;
  const bucketWidth = (hoursBack * 60 * 60 * 1000) / bucketCount;

  const buckets: (boolean | null)[] = new Array(bucketCount).fill(null);

  for (const entry of history) {
    const idx = Math.floor((entry.checkedAt - start) / bucketWidth);
    if (idx >= 0 && idx < bucketCount) {
      if (buckets[idx] === null) {
        buckets[idx] = entry.online;
      } else if (entry.online) {
        buckets[idx] = true;
      }
    }
  }

  return buckets;
}

/* ── Helper to create a tRPC caller ── */

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

/* ── Tests ── */

describe("bucketize", () => {
  it("returns all nulls for empty history", () => {
    const result = bucketize([], 24, 48);
    expect(result).toHaveLength(48);
    expect(result.every((v) => v === null)).toBe(true);
  });

  it("places a recent online entry in the last bucket", () => {
    const now = Date.now();
    const result = bucketize(
      [{ online: true, checkedAt: now - 1000 }],
      24,
      48
    );
    expect(result).toHaveLength(48);
    // The last bucket should be true
    expect(result[47]).toBe(true);
    // Earlier buckets should be null
    expect(result[0]).toBe(null);
  });

  it("places an old entry in an early bucket", () => {
    const now = Date.now();
    const checkedAt = now - 23 * 60 * 60 * 1000; // 23 hours ago
    const result = bucketize(
      [{ online: false, checkedAt }],
      24,
      48
    );
    expect(result).toHaveLength(48);
    // Should be in bucket 2 (23h ago in a 24h window with 48 buckets = bucket index ~2)
    const expectedIdx = Math.floor(((checkedAt - (now - 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000)) * 48);
    expect(result[expectedIdx]).toBe(false);
  });

  it("online overrides offline in the same bucket", () => {
    const now = Date.now();
    const result = bucketize(
      [
        { online: false, checkedAt: now - 500 },
        { online: true, checkedAt: now - 200 },
      ],
      24,
      48
    );
    // Both entries are in the last bucket — online should win
    expect(result[47]).toBe(true);
  });

  it("offline does NOT override online in the same bucket", () => {
    const now = Date.now();
    const result = bucketize(
      [
        { online: true, checkedAt: now - 500 },
        { online: false, checkedAt: now - 200 },
      ],
      24,
      48
    );
    // online was first, offline should not override it
    expect(result[47]).toBe(true);
  });

  it("ignores entries outside the time window", () => {
    const now = Date.now();
    const result = bucketize(
      [{ online: true, checkedAt: now - 25 * 60 * 60 * 1000 }], // 25h ago, outside 24h window
      24,
      48
    );
    expect(result.every((v) => v === null)).toBe(true);
  });

  it("handles compact mode (24 buckets)", () => {
    const now = Date.now();
    const result = bucketize(
      [{ online: true, checkedAt: now - 1000 }],
      24,
      24
    );
    expect(result).toHaveLength(24);
    expect(result[23]).toBe(true);
  });
});

describe("uptime tRPC endpoints", () => {
  it("receiverHistory returns an array (possibly empty)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.uptime.receiverHistory({
      receiverUrl: "http://nonexistent-test-receiver.example.com:8073",
      hoursBack: 24,
    });

    expect(Array.isArray(result)).toBe(true);
    // For a non-existent receiver, should be empty
    expect(result).toHaveLength(0);
  });

  it("recentScans returns an array", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.uptime.recentScans({ limit: 10 });

    expect(Array.isArray(result)).toBe(true);
    // Each scan cycle should have the expected shape
    for (const scan of result) {
      expect(scan).toHaveProperty("cycleId");
      expect(scan).toHaveProperty("cycleNumber");
      expect(scan).toHaveProperty("totalReceivers");
      expect(scan).toHaveProperty("onlineCount");
      expect(scan).toHaveProperty("offlineCount");
      expect(scan).toHaveProperty("startedAt");
    }
  });

  it("aggregateStats returns the expected shape", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.uptime.aggregateStats();

    expect(result).toHaveProperty("totalReceivers");
    expect(result).toHaveProperty("onlineNow");
    expect(result).toHaveProperty("offlineNow");
    expect(result).toHaveProperty("avgUptime24h");
    expect(result).toHaveProperty("avgUptime7d");
    expect(result).toHaveProperty("totalScans");
    expect(result).toHaveProperty("byType");
    expect(Array.isArray(result.byType)).toBe(true);
    expect(typeof result.totalReceivers).toBe("number");
    expect(typeof result.onlineNow).toBe("number");
  });

  it("allReceivers returns an array with expected shape", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.uptime.allReceivers();

    expect(Array.isArray(result)).toBe(true);
    // If there are any receivers (from previous scan cycles), verify shape
    for (const r of result) {
      expect(r).toHaveProperty("normalizedUrl");
      expect(r).toHaveProperty("receiverType");
      expect(r).toHaveProperty("lastOnline");
      expect(r).toHaveProperty("totalChecks");
      expect(r).toHaveProperty("onlineChecks");
    }
  });
});
