/**
 * e2e.endpoints2.test.ts — Comprehensive E2E tests for every tRPC endpoint
 *
 * Part 2: Targets, Fingerprints, Anomalies, Uptime, Sharing routers
 * Tests every procedure with correct input schemas via createCaller.
 */
import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
      setHeader: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "e2e-test-user-p2",
    email: "e2e-p2@test.com",
    name: "E2E Test User P2",
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
      setHeader: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ── 1. TARGETS ROUTER (16 procedures) ────────────────────────────
describe("E2E: targets router", () => {
  describe("targets.list", () => {
    it("returns an array of targets", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("targets.save", () => {
    it("creates a new target and returns its id", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.save({
        label: "E2E Test Target",
        lat: 48.8566,
        lon: 2.3522,
        frequencyKhz: 14070,
        color: "#ff6b6b",
        category: "unknown",
        notes: "Test target for E2E",
      });
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");
    });
  });

  describe("targets.toggleVisibility", () => {
    it("toggles target visibility and returns updated status", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id } = await caller.targets.save({ label: "Vis Test", lat: 0, lon: 0 });
      const result = await caller.targets.toggleVisibility({ id, visible: false });
      expect(result).toHaveProperty("updated", true);
    });
  });

  describe("targets.update", () => {
    it("updates target properties", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id } = await caller.targets.save({ label: "Update Test", lat: 10, lon: 20 });
      const result = await caller.targets.update({ id, label: "Updated Label", color: "#00ff00" });
      expect(result).toHaveProperty("updated", true);
    });
  });

  describe("targets.delete", () => {
    it("deletes a target and returns deleted status", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id } = await caller.targets.save({ label: "Delete Test", lat: 5, lon: 5 });
      const result = await caller.targets.delete({ id });
      expect(result).toHaveProperty("deleted", true);
    });
  });

  describe("targets.addHistoryEntry", () => {
    it("adds a history entry and returns its id", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await caller.targets.save({ label: "History Test", lat: 1, lon: 1 });
      const result = await caller.targets.addHistoryEntry({
        targetId,
        jobId: 1,
        lat: 1.001,
        lon: 1.001,
        frequencyKhz: 7000,
      });
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");
    });
  });

  describe("targets.getHistory", () => {
    it("returns history array for a target", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await caller.targets.save({ label: "GetHist Test", lat: 2, lon: 2 });
      const result = await caller.targets.getHistory({ targetId });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("targets.getAllHistory", () => {
    it("returns all history entries across all targets", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.getAllHistory();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("targets.predict", () => {
    it("returns null or prediction for a target", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await caller.targets.save({ label: "Predict Test", lat: 3, lon: 3 });
      const result = await caller.targets.predict({ targetId });
      // With < 2 history points, should return null
      expect(result).toBeNull();
    });
  });

  describe("targets.predictAll", () => {
    it("returns an array of predictions", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.predictAll();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("targets.classify", () => {
    it("classifies a target and returns classification result", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await caller.targets.save({
        label: "Classify Test",
        lat: 40,
        lon: -74,
        frequencyKhz: 10000,
      });
      const result = await caller.targets.classify({
        targetId,
        frequencyKhz: 10000,
        lat: 40,
        lon: -74,
        label: "Classify Test",
      });
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasoning");
      expect(typeof result.category).toBe("string");
      expect(typeof result.confidence).toBe("number");
    });
  });

  describe("targets.exportCsv", () => {
    it("returns CSV string", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.exportCsv();
      expect(result).toHaveProperty("csv");
      expect(typeof result.csv).toBe("string");
    });
  });

  describe("targets.exportKml", () => {
    it("returns KML string", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.targets.exportKml();
      expect(result).toHaveProperty("kml");
      expect(typeof result.kml).toBe("string");
    });
  });

  describe("targets.importCsv", () => {
    it("imports targets from CSV data", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const csvData = "label,lat,lon,frequency_khz\nCSV Import Test,51.5,-0.1,14070";
      const result = await caller.targets.importCsv({ csvData });
      expect(result).toHaveProperty("imported");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("ids");
      expect(typeof result.imported).toBe("number");
    });
  });

  describe("targets.importKml", () => {
    it("imports targets from KML data", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const kmlData = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document><Placemark><name>KML Test</name>
<Point><coordinates>2.3522,48.8566,0</coordinates></Point>
</Placemark></Document></kml>`;
      const result = await caller.targets.importKml({ kmlData });
      expect(result).toHaveProperty("imported");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("ids");
    });
  });

  describe("targets.checkAnomaly", () => {
    it("checks anomaly for a target position", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await caller.targets.save({ label: "Anomaly Check", lat: 10, lon: 10 });
      const histEntry = await caller.targets.addHistoryEntry({
        targetId,
        jobId: 1,
        lat: 10,
        lon: 10,
      });
      const result = await caller.targets.checkAnomaly({
        targetId,
        lat: 10.5,
        lon: 10.5,
        historyEntryId: histEntry.id,
      });
      expect(result).toHaveProperty("isAnomaly");
      expect(result).toHaveProperty("severity");
      expect(result).toHaveProperty("deviationKm");
      expect(result).toHaveProperty("deviationSigma");
    });
  });
});

// ── 2. FINGERPRINTS ROUTER (4 procedures) ────────────────────────
describe("E2E: fingerprints router", () => {
  describe("fingerprints.create", () => {
    it("creates a fingerprint and returns its id", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.fingerprints.create({
        targetId: 1,
        recordingId: 1,
        frequencyKhz: 14070,
        mode: "usb",
        spectralPeaks: [100, 200, 300],
        bandwidthHz: 3000,
        dominantFreqHz: 1500,
        spectralCentroid: 1200,
        spectralFlatness: 0.5,
        rmsLevel: -30,
        featureVector: [0.1, 0.2, 0.3, 0.4, 0.5],
      });
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");
    });
  });

  describe("fingerprints.byTarget", () => {
    it("returns fingerprints for a target", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.fingerprints.byTarget({ targetId: 1 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("fingerprints.findMatches", () => {
    it("finds matching fingerprints by feature vector", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.fingerprints.findMatches({
        featureVector: [0.1, 0.2, 0.3, 0.4, 0.5],
        threshold: 0.5,
        limit: 5,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("fingerprints.delete", () => {
    it("deletes a fingerprint", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const { id } = await caller.fingerprints.create({
        targetId: 1,
        recordingId: 1,
        featureVector: [0.5, 0.6, 0.7],
      });
      const result = await caller.fingerprints.delete({ id });
      expect(result).toHaveProperty("success", true);
    });
  });
});

// ── 3. ANOMALIES ROUTER (12 procedures) ──────────────────────────
describe("E2E: anomalies router", () => {
  describe("anomalies.list", () => {
    it("returns an array of anomaly alerts (default)", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts filter parameters", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.list({
        acknowledged: false,
        alertType: "position",
        limit: 10,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("anomalies.acknowledge", () => {
    it("acknowledges an alert (non-existent id still succeeds)", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.acknowledge({ id: 999999 });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("anomalies.dismiss", () => {
    it("dismisses an alert (non-existent id still succeeds)", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.dismiss({ id: 999999 });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("anomalies.unacknowledgedCount", () => {
    it("returns count object with position and conflict breakdowns", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.unacknowledgedCount();
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("positionCount");
      expect(result).toHaveProperty("conflictCount");
      expect(typeof result.count).toBe("number");
    });

    it("accepts alertType filter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.unacknowledgedCount({ alertType: "conflict" });
      expect(result).toHaveProperty("count");
    });
  });

  describe("anomalies.checkConflictZone", () => {
    it("checks conflict zone proximity for a position", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.checkConflictZone({
        targetId: 1,
        lat: 48.8566,
        lon: 2.3522,
        historyEntryId: 1,
      });
      expect(result).toHaveProperty("isInConflictZone");
      expect(result).toHaveProperty("severity");
      expect(result).toHaveProperty("nearbyEventCount");
      expect(result).toHaveProperty("closestDistanceKm");
    });
  });

  describe("anomalies.checkAllConflictZones", () => {
    it("returns array of conflict zone results for all targets", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.checkAllConflictZones();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("anomalies.analyzePosition", () => {
    it("analyzes conflict proximity without creating alerts", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.analyzePosition({ lat: 48.8566, lon: 2.3522 });
      expect(result).toHaveProperty("severity");
      expect(result).toHaveProperty("nearbyEventCount");
      expect(result).toHaveProperty("closestDistanceKm");
      expect(result).toHaveProperty("cacheAvailable");
      expect(result).toHaveProperty("totalCachedEvents");
    });
  });

  describe("anomalies.triggerSweep", () => {
    it("triggers a manual conflict sweep (with graceful timeout)", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      // triggerSweep iterates all visible targets with network calls (HDX HAPI + notifications).
      // With 100+ accumulated test targets this can take minutes, so we race against a timeout.
      const SWEEP_TIMEOUT = 15000;
      const sweepPromise = caller.anomalies.triggerSweep();
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), SWEEP_TIMEOUT)
      );
      const result = await Promise.race([sweepPromise, timeoutPromise]);
      if (result === "timeout") {
        // The sweep is still running — verify the scheduler reports it as running
        const status = await caller.anomalies.sweepStatus();
        expect(status).toHaveProperty("isRunning");
        // Also verify a second call returns the "already running" guard
        const second = await caller.anomalies.triggerSweep();
        expect(second).toHaveProperty("success", false);
        expect(second.targetsChecked).toBe(0);
      } else {
        // Sweep completed within timeout — verify full shape
        expect(result).toHaveProperty("success");
        expect(result).toHaveProperty("targetsChecked");
        expect(result).toHaveProperty("trigger", "manual");
        expect(typeof result.targetsInConflict).toBe("number");
        expect(typeof result.geofenceAlertCount).toBe("number");
        expect(typeof result.durationMs).toBe("number");
        expect(result).toHaveProperty("details");
        expect(result.details).toHaveProperty("conflictResults");
        expect(result.details).toHaveProperty("geofenceResults");
      }
    }, 30000);
  });

  describe("anomalies.sweepStatus", () => {
    it("returns sweep scheduler status", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.sweepStatus();
      expect(result).toHaveProperty("active");
      expect(result).toHaveProperty("sweepCount");
      expect(result).toHaveProperty("isRunning");
      expect(result).toHaveProperty("intervalMs");
    });
  });

  describe("anomalies.startSweepScheduler", () => {
    it("starts the sweep scheduler", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.startSweepScheduler();
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("status");
      // Clean up: stop it
      await caller.anomalies.stopSweepScheduler();
    });
  });

  describe("anomalies.stopSweepScheduler", () => {
    it("stops the sweep scheduler", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.stopSweepScheduler();
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("status");
    });
  });

  describe("anomalies.sweepHistory", () => {
    it("returns sweep history array", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.sweepHistory();
      expect(Array.isArray(result)).toBe(true);
    });

    it("accepts limit parameter", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.anomalies.sweepHistory({ limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

// ── 4. UPTIME ROUTER (4 procedures) ─────────────────────────────
describe("E2E: uptime router", () => {
  describe("uptime.allReceivers", () => {
    it("returns array of receiver statuses", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.uptime.allReceivers();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("uptime.receiverHistory", () => {
    it("returns history for a receiver URL", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.uptime.receiverHistory({
        receiverUrl: "http://example.com:8073",
        hoursBack: 24,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("uptime.recentScans", () => {
    it("returns recent scan cycles", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.uptime.recentScans({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("uptime.aggregateStats", () => {
    it("returns aggregate stats object", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.uptime.aggregateStats();
      expect(result).toHaveProperty("totalReceivers");
      expect(result).toHaveProperty("onlineNow");
      expect(result).toHaveProperty("offlineNow");
      expect(result).toHaveProperty("totalScans");
      expect(result).toHaveProperty("byType");
      expect(typeof result.totalReceivers).toBe("number");
    });
  });
});

// ── 5. SHARING ROUTER (10 procedures) ────────────────────────────
describe("E2E: sharing router", () => {
  describe("sharing.createList", () => {
    it("creates a shared list and returns id + invite token", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.sharing.createList({
        name: "E2E Shared List",
        description: "Test list",
        defaultPermission: "view",
        isPublic: false,
      });
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("inviteToken");
      expect(typeof result.inviteToken).toBe("string");
    });
  });

  describe("sharing.myLists", () => {
    it("returns user's shared lists", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.sharing.myLists();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("sharing.getByToken", () => {
    it("returns list info for a valid invite token", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { inviteToken } = await caller.sharing.createList({
        name: "Token Test",
        defaultPermission: "view",
        isPublic: false,
      });
      const result = await caller.sharing.getByToken({ token: inviteToken });
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("name", "Token Test");
    });

    it("returns null for invalid token", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.sharing.getByToken({ token: "nonexistent-token" });
      expect(result).toBeNull();
    });
  });

  describe("sharing.joinByToken", () => {
    it("joins a list by invite token", async () => {
      const ownerCaller = appRouter.createCaller(createAuthContext({ openId: "owner-user" }));
      const { inviteToken } = await ownerCaller.sharing.createList({
        name: "Join Test",
        defaultPermission: "view",
        isPublic: false,
      });
      const joinerCaller = appRouter.createCaller(createAuthContext({ openId: "joiner-user" }));
      const result = await joinerCaller.sharing.joinByToken({ token: inviteToken });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("listId");
    });
  });

  describe("sharing.getListTargets", () => {
    it("returns targets in a shared list", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { id: listId } = await caller.sharing.createList({
        name: "Targets Test",
        defaultPermission: "view",
        isPublic: false,
      });
      const result = await caller.sharing.getListTargets({ listId });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("sharing.addTargets", () => {
    it("adds targets to a shared list", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { id: listId } = await caller.sharing.createList({
        name: "Add Targets Test",
        defaultPermission: "edit",
        isPublic: false,
      });
      const targetCaller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await targetCaller.targets.save({
        label: "Shared Target",
        lat: 30,
        lon: 30,
      });
      const result = await caller.sharing.addTargets({ listId, targetIds: [targetId] });
      expect(result).toHaveProperty("added");
      expect(typeof result.added).toBe("number");
    });
  });

  describe("sharing.removeTarget", () => {
    it("removes a target from a shared list", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { id: listId } = await caller.sharing.createList({
        name: "Remove Target Test",
        defaultPermission: "edit",
        isPublic: false,
      });
      const targetCaller = appRouter.createCaller(createPublicContext());
      const { id: targetId } = await targetCaller.targets.save({ label: "Remove Me", lat: 1, lon: 1 });
      await caller.sharing.addTargets({ listId, targetIds: [targetId] });
      const result = await caller.sharing.removeTarget({ listId, targetId });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("sharing.getMembers", () => {
    it("returns members of a shared list", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { id: listId } = await caller.sharing.createList({
        name: "Members Test",
        defaultPermission: "view",
        isPublic: false,
      });
      const result = await caller.sharing.getMembers({ listId });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("sharing.removeMember", () => {
    it("removes a member from a shared list", async () => {
      const caller = appRouter.createCaller(createPublicContext());
      const result = await caller.sharing.removeMember({ listId: 999999, userId: 999999 });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("sharing.deleteList", () => {
    it("deletes a shared list owned by the user", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const { id: listId } = await caller.sharing.createList({
        name: "Delete Me",
        defaultPermission: "view",
        isPublic: false,
      });
      const result = await caller.sharing.deleteList({ listId });
      expect(result).toHaveProperty("success", true);
    });
  });
});
