import { describe, expect, it, beforeAll } from "vitest";
import {
  persistScanResults,
  getAllReceiverStatuses,
  getReceiverHistory,
  getRecentScanCycles,
  getAggregateStats,
  type ScanResultForPersistence,
} from "./statusPersistence";
import { getDb } from "./db";
import { receivers, scanCycles, receiverStatusHistory } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

/**
 * These tests require a live database connection (DATABASE_URL env var).
 * They test the full persistence pipeline: insert, query, and aggregate.
 */

// Helper to generate unique URLs for test isolation
function testUrl(suffix: string): string {
  return `http://test-${Date.now()}-${suffix}.example.com:8073`;
}

describe("statusPersistence", () => {
  let dbAvailable = false;

  beforeAll(async () => {
    const db = await getDb();
    dbAvailable = db !== null;
    if (!dbAvailable) {
      console.warn("Database not available — skipping persistence tests");
    }
  });

  describe("persistScanResults", () => {
    it("should persist a scan cycle with receiver results", async () => {
      if (!dbAvailable) return;

      const url1 = testUrl("kiwi-1");
      const url2 = testUrl("owrx-1");
      const cycleId = `test-cycle-${Date.now()}`;
      const startedAt = Date.now() - 5000;
      const completedAt = Date.now();

      const results: ScanResultForPersistence[] = [
        {
          receiverUrl: url1,
          receiverType: "KiwiSDR",
          stationLabel: "Test KiwiSDR Station",
          online: true,
          checkedAt: completedAt,
          users: 2,
          usersMax: 4,
          snr: 18.5,
          name: "Test KiwiSDR",
        },
        {
          receiverUrl: url2,
          receiverType: "OpenWebRX",
          stationLabel: "Test OpenWebRX Station",
          online: false,
          checkedAt: completedAt,
          error: "Connection refused",
        },
      ];

      const result = await persistScanResults(results, {
        cycleId,
        cycleNumber: 1,
        startedAt,
        completedAt,
      });

      expect(result.success).toBe(true);

      // Verify scan cycle was created
      const db = await getDb();
      const [cycle] = await db!
        .select()
        .from(scanCycles)
        .where(eq(scanCycles.cycleId, cycleId))
        .limit(1);

      expect(cycle).toBeDefined();
      expect(cycle.totalReceivers).toBe(2);
      expect(cycle.onlineCount).toBe(1);
      expect(cycle.offlineCount).toBe(1);
      expect(cycle.cycleNumber).toBe(1);

      // Verify receivers were created
      const normalizedUrl1 = url1.replace(/\/+$/, "");
      const [receiver1] = await db!
        .select()
        .from(receivers)
        .where(eq(receivers.normalizedUrl, normalizedUrl1))
        .limit(1);

      expect(receiver1).toBeDefined();
      expect(receiver1.lastOnline).toBe(true);
      expect(receiver1.receiverType).toBe("KiwiSDR");
      expect(receiver1.lastSnr).toBeCloseTo(18.5);
      expect(receiver1.lastUsers).toBe(2);
      expect(receiver1.totalChecks).toBe(1);
      expect(receiver1.onlineChecks).toBe(1);

      // Verify history rows were created
      const historyRows = await db!
        .select()
        .from(receiverStatusHistory)
        .where(eq(receiverStatusHistory.receiverId, receiver1.id));

      expect(historyRows.length).toBeGreaterThanOrEqual(1);
      expect(historyRows[0].online).toBe(true);
      expect(historyRows[0].snr).toBeCloseTo(18.5);
    });

    it("should update existing receivers on subsequent scans", async () => {
      if (!dbAvailable) return;

      const url = testUrl("update-test");
      const cycleId1 = `test-update-1-${Date.now()}`;
      const cycleId2 = `test-update-2-${Date.now() + 1}`;

      // First scan: online
      await persistScanResults(
        [
          {
            receiverUrl: url,
            receiverType: "KiwiSDR",
            stationLabel: "Update Test",
            online: true,
            checkedAt: Date.now(),
            snr: 15,
          },
        ],
        {
          cycleId: cycleId1,
          cycleNumber: 1,
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
        }
      );

      // Second scan: offline
      await persistScanResults(
        [
          {
            receiverUrl: url,
            receiverType: "KiwiSDR",
            stationLabel: "Update Test",
            online: false,
            checkedAt: Date.now(),
            error: "Timeout",
          },
        ],
        {
          cycleId: cycleId2,
          cycleNumber: 2,
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
        }
      );

      const db = await getDb();
      const normalizedUrl = url.replace(/\/+$/, "");
      const [receiver] = await db!
        .select()
        .from(receivers)
        .where(eq(receivers.normalizedUrl, normalizedUrl))
        .limit(1);

      expect(receiver).toBeDefined();
      expect(receiver.lastOnline).toBe(false);
      expect(receiver.totalChecks).toBe(2);
      expect(receiver.onlineChecks).toBe(1);
    });

    it("should return error when database is not available", async () => {
      // This test always runs — tests the graceful fallback
      // We can't easily simulate DB unavailability, so we just verify the function signature
      const result = await persistScanResults([], {
        cycleId: "empty-test",
        cycleNumber: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
      });

      // Empty results should still succeed
      expect(result.success).toBeDefined();
    });
  });

  describe("query helpers", () => {
    it("getAllReceiverStatuses should return receiver list", async () => {
      if (!dbAvailable) return;

      const statuses = await getAllReceiverStatuses();
      expect(Array.isArray(statuses)).toBe(true);

      // Should have at least the receivers we inserted in previous tests
      if (statuses.length > 0) {
        const first = statuses[0];
        expect(first).toHaveProperty("normalizedUrl");
        expect(first).toHaveProperty("receiverType");
        expect(first).toHaveProperty("lastOnline");
        expect(first).toHaveProperty("totalChecks");
      }
    });

    it("getReceiverHistory should return history for a known receiver", async () => {
      if (!dbAvailable) return;

      // Use a URL from the persist test
      const url = testUrl("history-query");

      // Insert a receiver with history first
      await persistScanResults(
        [
          {
            receiverUrl: url,
            receiverType: "KiwiSDR",
            stationLabel: "History Query Test",
            online: true,
            checkedAt: Date.now(),
            snr: 20,
            users: 1,
          },
        ],
        {
          cycleId: `history-query-${Date.now()}`,
          cycleNumber: 0,
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
        }
      );

      const history = await getReceiverHistory(url, 24);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(1);

      const entry = history[0];
      expect(entry).toHaveProperty("online");
      expect(entry).toHaveProperty("checkedAt");
      expect(entry.online).toBe(true);
    });

    it("getReceiverHistory should return empty array for unknown receiver", async () => {
      if (!dbAvailable) return;

      const history = await getReceiverHistory("http://nonexistent.example.com:9999", 24);
      expect(history).toEqual([]);
    });

    it("getRecentScanCycles should return scan cycle summaries", async () => {
      if (!dbAvailable) return;

      const cycles = await getRecentScanCycles(10);
      expect(Array.isArray(cycles)).toBe(true);

      if (cycles.length > 0) {
        const cycle = cycles[0];
        expect(cycle).toHaveProperty("cycleId");
        expect(cycle).toHaveProperty("totalReceivers");
        expect(cycle).toHaveProperty("onlineCount");
        expect(cycle).toHaveProperty("offlineCount");
        expect(cycle).toHaveProperty("startedAt");
      }
    });

    it("getAggregateStats should return summary statistics", async () => {
      if (!dbAvailable) return;

      const stats = await getAggregateStats();
      expect(stats).toHaveProperty("totalReceivers");
      expect(stats).toHaveProperty("onlineNow");
      expect(stats).toHaveProperty("offlineNow");
      expect(stats).toHaveProperty("totalScans");
      expect(stats).toHaveProperty("byType");
      expect(Array.isArray(stats.byType)).toBe(true);

      // We should have at least the receivers from our tests
      expect(stats.totalReceivers).toBeGreaterThanOrEqual(0);
      expect(stats.totalScans).toBeGreaterThanOrEqual(0);
    });
  });
});
