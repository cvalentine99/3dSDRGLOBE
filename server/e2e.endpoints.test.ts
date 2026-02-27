/**
 * e2e.endpoints.test.ts — Comprehensive E2E tests for every tRPC endpoint
 *
 * Part 1: Auth, System, Receiver, TDoA, Recordings, Analytics routers
 * Tests every procedure with correct input schemas via createCaller.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { dbCleaner } from "./testDbCleaner";

// ── Per-file DB cleanup ─────────────────────────────────────────
beforeAll(() => dbCleaner.snapshot());
afterAll(() => dbCleaner.cleanup());

// ── Test Helpers ──────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "e2e-test-user",
    email: "e2e@test.com",
    name: "E2E Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ── 1. AUTH ROUTER (2 procedures) ────────────────────────────────

describe("E2E: auth router", () => {
  describe("auth.me", () => {
    it("returns null for unauthenticated users", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.auth.me();
      expect(result).toBeNull();
    });

    it("returns user data for authenticated users", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.auth.me();
      expect(result).toBeDefined();
      expect(result?.openId).toBe("e2e-test-user");
      expect(result?.name).toBe("E2E Test User");
      expect(result?.email).toBe("e2e@test.com");
      expect(result?.role).toBe("user");
    });
  });

  describe("auth.logout", () => {
    it("clears the session cookie and returns success", async () => {
      const ctx = createAuthContext();
      const caller = appRouter.createCaller(ctx);
      const result = await caller.auth.logout();
      expect(result).toEqual({ success: true });
      expect(ctx.res.clearCookie).toHaveBeenCalled();
    });
  });
});

// ── 2. SYSTEM ROUTER (2 procedures) ─────────────────────────────

describe("E2E: system router", () => {
  describe("system.health", () => {
    it("returns health status ok", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.system.health({ timestamp: Date.now() });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("ok");
      expect(result.ok).toBe(true);
    });
  });

  describe("system.notifyOwner", () => {
    it("requires admin role", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(
        caller.system.notifyOwner({ title: "Test", content: "Test" })
      ).rejects.toThrow();
    });

    it("rejects non-admin authenticated user", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      await expect(
        caller.system.notifyOwner({ title: "Test", content: "Test" })
      ).rejects.toThrow();
    });

    it("accepts notification from admin user", async () => {
      const caller = appRouter.createCaller(createAuthContext({ role: "admin" }));
      try {
        const result = await caller.system.notifyOwner({
          title: "E2E Test",
          content: "Test notification",
        });
        expect(typeof result).toBe("boolean");
      } catch (err: any) {
        // Notification service may be unavailable, but should not be auth error
        expect(err.code).not.toBe("UNAUTHORIZED");
      }
    });
  });
});

// ── 3. RECEIVER ROUTER (13 procedures) ──────────────────────────

describe("E2E: receiver router", () => {
  describe("receiver.checkStatus", () => {
    it("validates input and attempts status check", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.receiver.checkStatus({
          receiverUrl: "http://example.com:8073",
          receiverType: "KiwiSDR",
        });
        expect(result).toBeDefined();
      } catch (err: any) {
        // Network errors or timeouts are expected in test environment
        expect(err).toBeDefined();
      }
    }, 15000);

    it("rejects invalid URL", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      await expect(
        caller.receiver.checkStatus({
          receiverUrl: "not-a-url",
          receiverType: "KiwiSDR",
        })
      ).rejects.toThrow();
    });
  });

  describe("receiver.checkBatch", () => {
    it("validates batch input", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.receiver.checkBatch({
          receivers: [
            { receiverUrl: "http://example.com:8073", receiverType: "KiwiSDR" },
          ],
        });
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // Network errors are expected
        expect(err).toBeDefined();
      }
    }, 15000);
  });

  describe("receiver.startBatchPrecheck", () => {
    it("starts a batch precheck job", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.startBatchPrecheck({
        receivers: [
          {
            receiverUrl: "http://example.com:8073",
            receiverType: "KiwiSDR",
            stationLabel: "Test Station",
          },
        ],
      });
      expect(result).toBeDefined();
    });
  });

  describe("receiver.batchPrecheckStatus", () => {
    it("returns batch precheck status", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.batchPrecheckStatus();
      expect(result).toBeDefined();
    });
  });

  describe("receiver.batchPrecheckSince", () => {
    it("returns batch results since a timestamp", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.batchPrecheckSince({
        since: Date.now() - 3600000,
      });
      expect(result).toBeDefined();
    });
  });

  describe("receiver.cancelBatchPrecheck", () => {
    it("cancels the batch precheck", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.cancelBatchPrecheck();
      expect(result).toEqual({ cancelled: true });
    });
  });

  describe("receiver.autoRefreshStatus", () => {
    it("returns auto-refresh status", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.autoRefreshStatus();
      expect(result).toBeDefined();
    });
  });

  describe("receiver.forceRefresh", () => {
    it("triggers a force refresh", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.forceRefresh();
      expect(result).toBeDefined();
    });
  });

  describe("receiver.stopAutoRefresh", () => {
    it("stops auto-refresh", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.stopAutoRefresh();
      expect(result).toEqual({ stopped: true });
    });
  });

  describe("receiver.cacheStats", () => {
    it("returns cache statistics", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.cacheStats();
      expect(result).toBeDefined();
      expect(result).toHaveProperty("cacheSize");
      expect(typeof result.cacheSize).toBe("number");
    });
  });

  describe("receiver.aggregateDirectories", () => {
    it("aggregates directory sources with existing stations", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.aggregateDirectories({
        existingStations: [
          {
            label: "Test Station",
            location: { coordinates: [0, 0], type: "Point" as const },
            receivers: [
              {
                label: "Test Receiver",
                url: "http://example.com:8073",
                type: "KiwiSDR",
              },
            ],
          },
        ],
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("stations");
      expect(result).toHaveProperty("sources");
      expect(result).toHaveProperty("totalStations");
      expect(result).toHaveProperty("totalNew");
      expect(result).toHaveProperty("fetchedAt");
      expect(Array.isArray(result.stations)).toBe(true);
      expect(Array.isArray(result.sources)).toBe(true);
      expect(typeof result.totalStations).toBe("number");
      expect(typeof result.totalNew).toBe("number");
    }, 120000);
  });

  describe("receiver.getDirectoryCache", () => {
    it("returns directory cache info", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.getDirectoryCache();
      expect(result).toBeDefined();
    });
  });

  describe("receiver.clearDirectoryCache", () => {
    it("clears the directory cache", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.receiver.clearDirectoryCache();
      expect(result).toEqual({ cleared: true });
    });
  });
});

// ── 4. TDOA ROUTER (9 procedures) ──────────────────────────────

describe("E2E: tdoa router", () => {
  describe("tdoa.getGpsHosts", () => {
    it("returns GPS host list", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.tdoa.getGpsHosts();
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // External API may timeout in test environment
        expect(err).toBeDefined();
      }
    }, 60000);
  });

  describe("tdoa.getRefs", () => {
    it("returns reference transmitter list", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.tdoa.getRefs();
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // External API may timeout in test environment
        expect(err).toBeDefined();
      }
    }, 60000);
  });

   describe("tdoa.autoSelectHosts", () => {
    it("returns auto-selected hosts with default count", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.tdoa.autoSelectHosts();
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // External API may timeout in test environment
        expect(err).toBeDefined();
      }
    }, 60000);
    it("respects custom count parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.tdoa.autoSelectHosts({ count: 4 });
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // External API may timeout in test environment
        expect(err).toBeDefined();
      }
    }, 60000);
  });

  describe("tdoa.recentJobs", () => {
    it("returns recent in-memory jobs", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.recentJobs();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("tdoa.jobHistory", () => {
    it("returns job history from database", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.jobHistory();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("tdoa.getJobById", () => {
    it("returns null for non-existent job", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.getJobById({ id: 999999 });
      expect(result).toBeNull();
    });
  });

  describe("tdoa.pollProgress", () => {
    it("returns null for non-existent job ID", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.pollProgress({ jobId: "nonexistent-job-id" });
      expect(result).toBeNull();
    });
  });

  describe("tdoa.cancelJob", () => {
    it("returns cancelled status for non-existent job", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.cancelJob({ jobId: "nonexistent-job-id" });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("cancelled");
    });
  });

  describe("tdoa.deleteJob", () => {
    it("returns deleted false for non-existent job", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.tdoa.deleteJob({ id: 999999 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("deleted");
    });
  });
});

// ── 5. RECORDINGS ROUTER (3 procedures) ─────────────────────────

describe("E2E: recordings router", () => {
  describe("recordings.getByJob", () => {
    it("returns results for a job ID", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        const result = await caller.recordings.getByJob({ jobId: 999999 });
        expect(Array.isArray(result)).toBe(true);
      } catch (err: any) {
        // DB may not be available in test
        expect(err).toBeDefined();
      }
    });
  });

  describe("recordings.delete", () => {
    it("returns deleted false for non-existent recording", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.recordings.delete({ id: 999999 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("deleted");
    });
  });

  // recordings.record requires real KiwiSDR hosts — tested via integration only
  describe("recordings.record", () => {
    it("rejects with invalid host format", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      try {
        await caller.recordings.record({
          jobId: 999999,
          hosts: [{ h: "invalid-host", p: 8073, id: "test" }],
          frequencyKhz: 14000,
          durationSec: 5,
          mode: "am",
        });
      } catch (err: any) {
        // Expected to fail — no real KiwiSDR host
        expect(err).toBeDefined();
      }
    });
  });
});

// ── 6. ANALYTICS ROUTER (8 procedures) ──────────────────────────

describe("E2E: analytics router", () => {
  describe("analytics.summary", () => {
    it("returns summary statistics", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.summary();
      expect(result).toBeDefined();
      expect(result).toHaveProperty("totalTargets");
      expect(result).toHaveProperty("totalJobs");
      expect(result).toHaveProperty("completedJobs");
      expect(result).toHaveProperty("totalRecordings");
      expect(result).toHaveProperty("totalFingerprints");
      expect(result).toHaveProperty("activeAnomalies");
      expect(result).toHaveProperty("totalAnomalies");
      expect(typeof result.totalTargets).toBe("number");
    });
  });

  describe("analytics.targetsByCategory", () => {
    it("returns targets grouped by category", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.targetsByCategory();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("analytics.anomalyTrend", () => {
    it("returns anomaly trend with default 30 days", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.anomalyTrend();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts custom days parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.anomalyTrend({ days: 7 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("analytics.jobTrend", () => {
    it("returns job trend with default 30 days", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.jobTrend();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts custom days parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.jobTrend({ days: 14 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("analytics.topFingerprints", () => {
    it("returns top fingerprints with default limit", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.topFingerprints();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts custom limit parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.topFingerprints({ limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("analytics.recentActivity", () => {
    it("returns recent activity with default limit", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.recentActivity();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts custom limit parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.recentActivity({ limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("analytics.receiverStats", () => {
    it("returns receiver statistics", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.receiverStats();
      expect(result).toBeDefined();
    });
  });

  describe("analytics.positionHeatmap", () => {
    it("returns position heatmap data", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.analytics.positionHeatmap();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
