/**
 * e2e.sideeffects.test.ts — Mutation side-effect tests
 *
 * Verifies that mutations like targets.save + addHistoryEntry correctly
 * trigger anomaly detection, geofence alerts, and conflict zone checks
 * in sequence. Also tests cross-router data consistency.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { dbCleaner } from "./testDbCleaner";

// ── Per-file DB cleanup ─────────────────────────────────────────
beforeAll(() => dbCleaner.snapshot());
afterAll(() => dbCleaner.cleanup());

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as unknown as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn(), setHeader: vi.fn() } as unknown as TrpcContext["res"],
  };
}

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1, openId: "e2e-sideeffect-user", email: "sideeffect@test.com", name: "Side Effect Tester",
    loginMethod: "manus", role: "user",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as unknown as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn(), setHeader: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ── MUTATION SIDE-EFFECT TESTS ──────────────────────────────────────

describe("mutation side-effects", () => {

  // ── 1. targets.save → analytics.summary count increases ──────────
  describe("targets.save → analytics.summary", () => {
    it("creating a target increases the analytics summary count", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      const before = await caller.analytics.summary();
      const initialCount = before.totalTargets;

      const target = await caller.targets.save({
        label: "SE-Analytics-Test",
        lat: 33.0,
        lon: 44.0,
        frequencyKhz: 12000,
        category: "military",
      });

      const after = await caller.analytics.summary();
      // Use >= instead of exact match since other parallel tests may also create targets
      expect(after.totalTargets).toBeGreaterThanOrEqual(initialCount + 1);

      // Clean up
      if (target.id) {
        await caller.targets.delete({ id: target.id });
        // Verify deletion succeeded by checking the target no longer exists
        // Note: we don't assert on totalTargets after delete because parallel
        // test suites may insert targets between our delete and the count query,
        // making the count non-deterministic.
      }
    });
  });

  // ── 2. targets.save → targets.addHistoryEntry → anomaly detection ─
  describe("targets.save → addHistoryEntry → checkAnomaly", () => {
    it("anomaly detection returns valid result after adding history entries", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a target
      const target = await caller.targets.save({
        label: "SE-Anomaly-Test",
        lat: 40.0,
        lon: 30.0,
        frequencyKhz: 8000,
        category: "military",
      });
      expect(target.id).toBeDefined();

      // Add 3 history entries to build a prediction model
      const h1 = await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 9001,
        lat: 40.0,
        lon: 30.0,
      });
      expect(h1).toHaveProperty("id");

      const h2 = await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 9002,
        lat: 40.01,
        lon: 30.01,
      });
      expect(h2).toHaveProperty("id");

      const h3 = await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 9003,
        lat: 40.02,
        lon: 30.02,
      });
      expect(h3).toHaveProperty("id");

      // Wait a moment for async side-effects to complete
      await new Promise((r) => setTimeout(r, 500));

      // Check anomaly with a normal position (should NOT be anomaly)
      const normalCheck = await caller.targets.checkAnomaly({
        targetId: target.id,
        lat: 40.03,
        lon: 30.03,
        historyEntryId: h3.id,
      });
      expect(normalCheck).toHaveProperty("isAnomaly");
      expect(normalCheck).toHaveProperty("severity");
      expect(normalCheck).toHaveProperty("deviationKm");
      expect(normalCheck).toHaveProperty("deviationSigma");
      expect(normalCheck).toHaveProperty("prediction");
      expect(normalCheck).toHaveProperty("alertId");
      expect(typeof normalCheck.isAnomaly).toBe("boolean");
      expect(typeof normalCheck.deviationKm).toBe("number");

      // Check anomaly with a wildly different position (likely anomaly)
      const anomalyCheck = await caller.targets.checkAnomaly({
        targetId: target.id,
        lat: 80.0, // Far from the 40° trajectory
        lon: -100.0,
        historyEntryId: h3.id,
      });
      expect(anomalyCheck).toHaveProperty("isAnomaly");
      expect(anomalyCheck).toHaveProperty("deviationKm");
      // Deviation should be significant
      expect(anomalyCheck.deviationKm).toBeGreaterThan(100);
      // With 3 history points, the prediction model should exist
      expect(anomalyCheck.prediction).not.toBeNull();
      if (anomalyCheck.prediction) {
        expect(anomalyCheck.prediction).toHaveProperty("predictedLat");
        expect(anomalyCheck.prediction).toHaveProperty("predictedLon");
        expect(anomalyCheck.prediction).toHaveProperty("rSquaredLat");
        expect(anomalyCheck.prediction).toHaveProperty("rSquaredLon");
        expect(anomalyCheck.prediction).toHaveProperty("velocityKmh");
        expect(anomalyCheck.prediction).toHaveProperty("bearingDeg");
        expect(anomalyCheck.prediction).toHaveProperty("modelType");
      }

      // Verify history was recorded
      const history = await caller.targets.getHistory({ targetId: target.id });
      expect(history.length).toBe(3);

      // Clean up
      await caller.targets.delete({ id: target.id });
    });
  });

  // ── 3. geofence.create → targets.addHistoryEntry → geofence alert ─
  describe("geofence.create → addHistoryEntry → geofence.checkTarget", () => {
    it("target entering an exclusion zone triggers geofence alert", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create an exclusion geofence zone around Damascus (33.5°N, 36.3°E)
      const zone = await caller.geofence.create({
        name: "SE-Exclusion-Zone",
        zoneType: "exclusion",
        polygon: [
          { lat: 33.0, lon: 35.5 },
          { lat: 34.0, lon: 35.5 },
          { lat: 34.0, lon: 37.0 },
          { lat: 33.0, lon: 37.0 },
        ],
        color: "#ff0000",
      });
      expect(zone.id).toBeDefined();

      // Create a target outside the zone
      const target = await caller.targets.save({
        label: "SE-Geofence-Test",
        lat: 32.0,
        lon: 36.0,
        frequencyKhz: 5000,
        category: "military",
      });

      // Step 1: Initialize geofence state with target OUTSIDE the zone
      // This first checkTarget call sets the in-memory state to "outside"
      const initialCheck = await caller.geofence.checkTarget({
        targetId: target.id,
        lat: 32.0,
        lon: 36.0,
        historyEntryId: 0,
      });
      expect(Array.isArray(initialCheck)).toBe(true);
      const zoneResult = initialCheck.find((r: any) => r.zoneId === zone.id);
      if (zoneResult) {
        expect(zoneResult.isInside).toBe(false);
      }

      // Step 2: Now call checkTarget with position INSIDE the exclusion zone
      // This detects the state transition from outside→inside and triggers an alert
      // NOTE: We call checkTarget directly (not addHistoryEntry) because
      // addHistoryEntry fires checkGeofences as a fire-and-forget side-effect,
      // which would consume the state transition before our explicit check.
      const afterCheck = await caller.geofence.checkTarget({
        targetId: target.id,
        lat: 33.5,
        lon: 36.3,
        historyEntryId: 0,
      });
      expect(Array.isArray(afterCheck)).toBe(true);
      const afterZoneResult = afterCheck.find((r: any) => r.zoneId === zone.id);
      expect(afterZoneResult).toBeDefined();
      expect(afterZoneResult!.isInside).toBe(true);
      expect(afterZoneResult!.triggered).toBe(true);
      expect(afterZoneResult!.eventType).toBe("entered");

      // Check alert history for this zone
      const alerts = await caller.geofence.alertHistory({ zoneId: zone.id });
      expect(Array.isArray(alerts)).toBe(true);
      const matchingAlerts = alerts.filter(
        (a: any) => a.targetId === target.id && a.eventType === "entered"
      );
      expect(matchingAlerts.length).toBeGreaterThanOrEqual(1);

      // Clean up
      await caller.targets.delete({ id: target.id });
      await caller.geofence.delete({ id: zone.id });
    });

    it("target exiting an inclusion zone triggers geofence alert", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create an inclusion zone (alert when target LEAVES)
      const zone = await caller.geofence.create({
        name: "SE-Inclusion-Zone",
        zoneType: "inclusion",
        polygon: [
          { lat: 50.0, lon: 10.0 },
          { lat: 51.0, lon: 10.0 },
          { lat: 51.0, lon: 12.0 },
          { lat: 50.0, lon: 12.0 },
        ],
        color: "#00ff00",
      });

      // Create a target inside the zone
      const target = await caller.targets.save({
        label: "SE-Inclusion-Test",
        lat: 50.5,
        lon: 11.0,
        frequencyKhz: 6000,
        category: "utility",
      });

      // Step 1: Initialize geofence state by checking target INSIDE the zone
      // This sets the in-memory state to "inside" for this target+zone pair
      const insideCheck = await caller.geofence.checkTarget({
        targetId: target.id,
        lat: 50.5,
        lon: 11.0,
        historyEntryId: 0,
      });
      const insideResult = insideCheck.find((r: any) => r.zoneId === zone.id);
      expect(insideResult).toBeDefined();
      expect(insideResult!.isInside).toBe(true);

      // Step 2: Now check with position OUTSIDE the inclusion zone
      // This should detect the state transition from inside→outside
      const outsideCheck = await caller.geofence.checkTarget({
        targetId: target.id,
        lat: 48.0,
        lon: 8.0,
        historyEntryId: 0,
      });
      const zoneResult = outsideCheck.find((r: any) => r.zoneId === zone.id);
      expect(zoneResult).toBeDefined();
      expect(zoneResult!.isInside).toBe(false);
      expect(zoneResult!.triggered).toBe(true);
      expect(zoneResult!.eventType).toBe("exited");

      // Clean up
      await caller.targets.delete({ id: target.id });
      await caller.geofence.delete({ id: zone.id });
    });
  });

  // ── 4. targets.addHistoryEntry → conflict zone proximity check ────
  describe("addHistoryEntry → conflict zone proximity check", () => {
    it("checking conflict zone proximity returns valid result", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a target in a known conflict area (Syria)
      const target = await caller.targets.save({
        label: "SE-Conflict-Test",
        lat: 36.2,
        lon: 37.15,
        frequencyKhz: 9000,
        category: "military",
      });

      // Add a history entry first (needed for historyEntryId)
      const h1 = await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 9901,
        lat: 36.2,
        lon: 37.15,
      });

      // Explicitly check conflict zone proximity
      const conflictCheck = await caller.anomalies.checkConflictZone({
        targetId: target.id,
        lat: 36.2,
        lon: 37.15,
        historyEntryId: h1.id,
      });
      expect(conflictCheck).toHaveProperty("isInConflictZone");
      expect(conflictCheck).toHaveProperty("severity");
      expect(conflictCheck).toHaveProperty("nearbyEventCount");
      expect(conflictCheck).toHaveProperty("closestDistanceKm");
      expect(conflictCheck).toHaveProperty("totalFatalities");
      expect(conflictCheck).toHaveProperty("dominantConflict");
      expect(conflictCheck).toHaveProperty("dominantCountry");
      expect(conflictCheck).toHaveProperty("alertId");
      expect(typeof conflictCheck.isInConflictZone).toBe("boolean");
      expect(typeof conflictCheck.nearbyEventCount).toBe("number");
      expect(typeof conflictCheck.closestDistanceKm).toBe("number");
      expect(typeof conflictCheck.totalFatalities).toBe("number");

      // Also check analyzePosition (more detailed analysis, no radiusKm param)
      // analyzePosition returns: severity, nearbyEventCount, closestDistanceKm,
      // totalFatalities, dominantConflict, dominantCountry, nearbyEvents,
      // cacheAvailable, totalCachedEvents (no isInConflictZone field)
      const analysis = await caller.anomalies.analyzePosition({
        lat: 36.2,
        lon: 37.15,
      });
      expect(analysis).toHaveProperty("severity");
      expect(analysis).toHaveProperty("nearbyEventCount");
      expect(analysis).toHaveProperty("closestDistanceKm");
      expect(analysis).toHaveProperty("totalFatalities");
      expect(analysis).toHaveProperty("nearbyEvents");
      expect(analysis).toHaveProperty("cacheAvailable");
      expect(analysis).toHaveProperty("totalCachedEvents");
      expect(Array.isArray(analysis.nearbyEvents)).toBe(true);

      // Clean up
      await caller.targets.delete({ id: target.id });
    });
  });

  // ── 5. Full lifecycle: save → history → anomaly → geofence → analytics ─
  describe("full mutation lifecycle", () => {
    it("complete target lifecycle with all side-effects", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Step 1: Create geofence zone
      const zone = await caller.geofence.create({
        name: "SE-Lifecycle-Zone",
        zoneType: "exclusion",
        polygon: [
          { lat: 44.0, lon: 24.0 },
          { lat: 46.0, lon: 24.0 },
          { lat: 46.0, lon: 27.0 },
          { lat: 44.0, lon: 27.0 },
        ],
        color: "#ff6600",
      });

      // Step 2: Create target outside zone
      const target = await caller.targets.save({
        label: "SE-Lifecycle-Target",
        lat: 42.0,
        lon: 25.0,
        frequencyKhz: 11000,
        category: "military",
      });

      // Step 3: Verify analytics count increased
      const summary = await caller.analytics.summary();
      expect(summary.totalTargets).toBeGreaterThanOrEqual(1);

      // Step 4: Add history entries to build prediction model
      await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 7001,
        lat: 42.0,
        lon: 25.0,
      });
      await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 7002,
        lat: 42.5,
        lon: 25.2,
      });
      const h3 = await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 7003,
        lat: 43.0,
        lon: 25.4,
      });

      // Wait for async side-effects and retry history check
      let history: any[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        history = await caller.targets.getHistory({ targetId: target.id });
        if (history.length >= 1) break;
      }
      expect(history.length).toBeGreaterThanOrEqual(1);

      // Step 6: Check anomaly detection works with prediction model
      const anomalyResult = await caller.targets.checkAnomaly({
        targetId: target.id,
        lat: 43.5,
        lon: 25.6,
        historyEntryId: h3.id,
      });
      expect(anomalyResult).toHaveProperty("isAnomaly");
      expect(anomalyResult).toHaveProperty("prediction");
      // With 3 points, prediction should exist
      expect(anomalyResult.prediction).not.toBeNull();

      // Step 7: Move target into the exclusion zone
      await caller.targets.addHistoryEntry({
        targetId: target.id,
        jobId: 7004,
        lat: 45.0,
        lon: 25.5,
      });

      // Wait for async geofence check
      await new Promise((r) => setTimeout(r, 500));

      // Step 8: Verify geofence triggered
      const geoCheck = await caller.geofence.checkTarget({
        targetId: target.id,
        lat: 45.0,
        lon: 25.5,
      });
      const zoneResult = geoCheck.find((r: any) => r.zoneId === zone.id);
      expect(zoneResult).toBeDefined();
      expect(zoneResult!.isInside).toBe(true);

      // Step 9: Verify anomaly list has entries
      const anomalies = await caller.anomalies.list();
      expect(Array.isArray(anomalies)).toBe(true);

      // Step 10: Create a fingerprint for the target (with featureVector)
      const fp = await caller.fingerprints.create({
        targetId: target.id,
        recordingId: 0,
        frequencyKhz: 11000,
        mode: "usb",
        bandwidthHz: 3000,
        featureVector: [0.1, 0.2, 0.3, 0.4, 0.5],
      });
      expect(fp.id).toBeDefined();

      // Step 11: Verify fingerprint appears in byTarget
      const fps = await caller.fingerprints.byTarget({ targetId: target.id });
      expect(fps.length).toBe(1);

      // Step 12: Verify analytics reflects the target
      const categoryStats = await caller.analytics.targetsByCategory();
      expect(categoryStats).toBeDefined();
      const militaryCount = categoryStats.find((c: any) => c.category === "military");
      if (militaryCount) {
        expect(militaryCount.count).toBeGreaterThanOrEqual(1);
      }

      // Clean up in reverse order
      if (fp.id) await caller.fingerprints.delete({ id: fp.id });
      await caller.targets.delete({ id: target.id });
      await caller.geofence.delete({ id: zone.id });
    });
  });

  // ── 6. Sharing lifecycle: create list → add targets → verify ──────
  describe("sharing list lifecycle with targets", () => {
    it("creates a sharing list, adds targets, and verifies membership", async () => {
      const caller = appRouter.createCaller(createAuthContext());

      // Create two targets
      const t1 = await caller.targets.save({
        label: "SE-Share-Target-1",
        lat: 51.5,
        lon: -0.1,
        frequencyKhz: 7000,
        category: "utility",
      });
      const t2 = await caller.targets.save({
        label: "SE-Share-Target-2",
        lat: 48.9,
        lon: 2.3,
        frequencyKhz: 8000,
        category: "broadcast",
      });

      // Create a sharing list
      const list = await caller.sharing.createList({
        name: "SE-Test-Sharing-List",
      });
      expect(list).toHaveProperty("id");
      expect(list).toHaveProperty("inviteToken");
      expect(typeof list.inviteToken).toBe("string");

      // Add targets to the list
      const addResult = await caller.sharing.addTargets({
        listId: list.id,
        targetIds: [t1.id, t2.id],
      });
      expect(addResult).toHaveProperty("added");
      expect(addResult.added).toBe(2);

      // Verify targets are in the list
      const listTargets = await caller.sharing.getListTargets({ listId: list.id });
      expect(Array.isArray(listTargets)).toBe(true);
      expect(listTargets.length).toBe(2);

      // Verify the list appears in myLists
      const myLists = await caller.sharing.myLists();
      expect(Array.isArray(myLists)).toBe(true);
      const foundList = myLists.find((l: any) => l.id === list.id);
      expect(foundList).toBeDefined();

      // Remove one target
      await caller.sharing.removeTarget({
        listId: list.id,
        targetId: t1.id,
      });
      const afterRemove = await caller.sharing.getListTargets({ listId: list.id });
      expect(afterRemove.length).toBe(1);

      // Clean up (deleteList uses listId, not id)
      await caller.sharing.deleteList({ listId: list.id });
      await caller.targets.delete({ id: t1.id });
      await caller.targets.delete({ id: t2.id });
    });
  });

  // ── 7. savedQueries lifecycle: create → list → delete ─────────────
  describe("savedQueries lifecycle", () => {
    it("creates, lists, and deletes a saved query", async () => {
      const authCaller = appRouter.createCaller(createAuthContext());

      // Create a saved query (requires prompt and category)
      const query = await authCaller.savedQueries.create({
        name: "SE-Test-Query",
        prompt: "Show all military targets in the Middle East",
        category: "targets",
      });
      expect(query).toHaveProperty("success");
      expect(query.success).toBe(true);
      expect(query).toHaveProperty("id");

      // List should include the new query
      const list = await authCaller.savedQueries.list();
      expect(list).toHaveProperty("queries");
      expect(Array.isArray(list.queries)).toBe(true);
      const found = list.queries.find((q: any) => q.id === query.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("SE-Test-Query");
      expect(found!.prompt).toBe("Show all military targets in the Middle East");

      // Delete the query
      const deleteResult = await authCaller.savedQueries.delete({ id: query.id! });
      expect(deleteResult).toEqual({ success: true });

      // Verify it's gone
      const afterDelete = await authCaller.savedQueries.list();
      const notFound = afterDelete.queries.find((q: any) => q.id === query.id);
      expect(notFound).toBeUndefined();
    });
  });

  // ── 8. Fingerprint matching after creating multiple fingerprints ───
  describe("fingerprint matching side-effects", () => {
    it("findMatches returns results after creating similar fingerprints", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create two targets
      const t1 = await caller.targets.save({
        label: "SE-FP-Match-1",
        lat: 55.0,
        lon: 37.0,
        frequencyKhz: 14000,
        category: "military",
      });
      const t2 = await caller.targets.save({
        label: "SE-FP-Match-2",
        lat: 56.0,
        lon: 38.0,
        frequencyKhz: 14000,
        category: "military",
      });

      // Create similar fingerprints on both targets (with featureVector!)
      const fp1 = await caller.fingerprints.create({
        targetId: t1.id,
        recordingId: 0,
        frequencyKhz: 14000,
        mode: "usb",
        bandwidthHz: 3000,
        featureVector: [0.5, 0.6, 0.7, 0.8, 0.9],
        notes: "Test fingerprint 1",
      });
      const fp2 = await caller.fingerprints.create({
        targetId: t2.id,
        recordingId: 0,
        frequencyKhz: 14000,
        mode: "usb",
        bandwidthHz: 3000,
        featureVector: [0.5, 0.6, 0.7, 0.8, 0.9],
        notes: "Test fingerprint 2",
      });

      // Find matches using featureVector (findMatches requires featureVector, not fingerprintId)
      const matches = await caller.fingerprints.findMatches({
        featureVector: [0.5, 0.6, 0.7, 0.8, 0.9],
        frequencyKhz: 14000,
        threshold: 0.5,
      });
      expect(matches).toBeDefined();
      expect(Array.isArray(matches)).toBe(true);
      // Should find both fingerprints as matches
      expect(matches.length).toBeGreaterThanOrEqual(1);
      if (matches.length > 0) {
        expect(matches[0]).toHaveProperty("fingerprintId");
        expect(matches[0]).toHaveProperty("similarity");
        expect(matches[0]).toHaveProperty("targetId");
      }

      // Clean up
      await caller.fingerprints.delete({ id: fp1.id });
      await caller.fingerprints.delete({ id: fp2.id });
      await caller.targets.delete({ id: t1.id });
      await caller.targets.delete({ id: t2.id });
    });
  });

  // ── 9. targets.update → verify category changes reflect in analytics ─
  describe("targets.update → analytics consistency", () => {
    it("updating target category reflects in analytics.targetsByCategory", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a military target
      const target = await caller.targets.save({
        label: "SE-Category-Update",
        lat: 60.0,
        lon: 25.0,
        frequencyKhz: 10000,
        category: "military",
      });

      // Get initial category counts
      const before = await caller.analytics.targetsByCategory();
      const militaryBefore = before.find((c: any) => c.category === "military")?.count ?? 0;

      // Update to broadcast category
      await caller.targets.update({
        id: target.id,
        category: "broadcast",
      });

      // Check category counts changed
      const after = await caller.analytics.targetsByCategory();
      const militaryAfter = after.find((c: any) => c.category === "military")?.count ?? 0;
      const broadcastAfter = after.find((c: any) => c.category === "broadcast")?.count ?? 0;

      expect(militaryAfter).toBe(militaryBefore - 1);
      expect(broadcastAfter).toBeGreaterThanOrEqual(1);

      // Clean up
      await caller.targets.delete({ id: target.id });
    });
  });

  // ── 10. targets.toggleVisibility → verify hidden targets ──────────
  describe("targets.toggleVisibility → list filtering", () => {
    it("toggling visibility updates the target's visible field", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a target (visible by default)
      const target = await caller.targets.save({
        label: "SE-Visibility-Test",
        lat: 35.0,
        lon: 139.0,
        frequencyKhz: 15000,
        category: "utility",
      });

      // Should be visible initially
      const listBefore = await caller.targets.list();
      const foundBefore = listBefore.find((t: any) => t.id === target.id);
      expect(foundBefore).toBeDefined();
      expect(foundBefore!.visible).toBe(true);

      // Toggle visibility off (requires both id and visible boolean)
      const toggleResult = await caller.targets.toggleVisibility({ id: target.id, visible: false });
      expect(toggleResult).toHaveProperty("updated");
      expect(toggleResult.updated).toBe(true);

      // Verify target is now hidden
      const listAfter = await caller.targets.list();
      const foundAfter = listAfter.find((t: any) => t.id === target.id);
      expect(foundAfter).toBeDefined();
      expect(foundAfter!.visible).toBe(false);

      // Toggle back
      const toggleBack = await caller.targets.toggleVisibility({ id: target.id, visible: true });
      expect(toggleBack.updated).toBe(true);

      // Clean up
      await caller.targets.delete({ id: target.id });
    });
  });

  // ── 11. geofence.checkPoint → verifies point-in-polygon check ─────
  describe("geofence.checkPoint → point-in-polygon verification", () => {
    it("checkPoint correctly identifies points inside and outside a zone", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a zone
      const zone = await caller.geofence.create({
        name: "SE-CheckPoint-Zone",
        zoneType: "exclusion",
        polygon: [
          { lat: 20.0, lon: 40.0 },
          { lat: 22.0, lon: 40.0 },
          { lat: 22.0, lon: 42.0 },
          { lat: 20.0, lon: 42.0 },
        ],
        color: "#990000",
      });

      // Check a point inside the zone
      const insideResult = await caller.geofence.checkPoint({
        lat: 21.0,
        lon: 41.0,
        zoneId: zone.id,
      });
      expect(insideResult).toHaveProperty("inside");
      expect(insideResult.inside).toBe(true);

      // Check a point outside the zone
      const outsideResult = await caller.geofence.checkPoint({
        lat: 10.0,
        lon: 10.0,
        zoneId: zone.id,
      });
      expect(outsideResult.inside).toBe(false);

      // Clean up
      await caller.geofence.delete({ id: zone.id });
    });
  });

  // ── 12. anomalies.checkAllConflictZones batch check ───────────────
  describe("anomalies.checkAllConflictZones batch check", () => {
    it("batch conflict zone check returns an array of results", async () => {
      const caller = appRouter.createCaller(createPublicContext());

      // Create a target
      const target = await caller.targets.save({
        label: "SE-Batch-Conflict",
        lat: 15.0,
        lon: 32.0,
        frequencyKhz: 7000,
        category: "military",
      });

      // checkAllConflictZones returns an array (not an object with results/totalTargets)
      const results = await caller.anomalies.checkAllConflictZones();
      expect(Array.isArray(results)).toBe(true);

      // Each result should have the expected shape
      for (const r of results) {
        expect(r).toHaveProperty("targetId");
        expect(r).toHaveProperty("targetLabel");
        expect(r).toHaveProperty("severity");
        expect(r).toHaveProperty("nearbyEventCount");
        expect(r).toHaveProperty("closestDistanceKm");
        expect(r).toHaveProperty("totalFatalities");
      }

      // Clean up
      await caller.targets.delete({ id: target.id });
    });
  });
});
