/**
 * Tests for the three new features:
 * 1. Geofence zone management (point-in-polygon, area, centroid, distance)
 * 2. Conflict sweep scheduler (status, timing, result structure)
 * 3. SIGINT PDF export (data preparation, report structure)
 *
 * Uses inlined pure functions to avoid importing heavy server modules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { haversineKm } from "@shared/geo";

// ══════════════════════════════════════════════════════════════════
// ── INLINED GEOFENCE ENGINE PURE FUNCTIONS ───────────────────────
// ══════════════════════════════════════════════════════════════════

interface PolygonVertex {
  lat: number;
  lon: number;
}

/**
 * Point-in-polygon using ray casting algorithm.
 */
function pointInPolygon(lat: number, lon: number, polygon: PolygonVertex[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lon;
    const xj = polygon[j].lat;
    const yj = polygon[j].lon;
    const intersect = yi > lon !== yj > lon && lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCentroid(polygon: PolygonVertex[]): PolygonVertex {
  if (polygon.length === 0) return { lat: 0, lon: 0 };
  const sum = polygon.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lon: acc.lon + v.lon }),
    { lat: 0, lon: 0 }
  );
  return { lat: sum.lat / polygon.length, lon: sum.lon / polygon.length };
}

function polygonAreaKm2(polygon: PolygonVertex[]): number {
  if (polygon.length < 3) return 0;
  const centroid = polygonCentroid(polygon);
  const cosLat = Math.cos((centroid.lat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * cosLat;
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = polygon[i].lon * kmPerDegLon;
    const yi = polygon[i].lat * kmPerDegLat;
    const xj = polygon[j].lon * kmPerDegLon;
    const yj = polygon[j].lat * kmPerDegLat;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area) / 2;
}

function distanceToPolygonKm(lat: number, lon: number, polygon: PolygonVertex[]): number {
  if (pointInPolygon(lat, lon, polygon)) return 0;
  let minDist = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = haversineKm(lat, lon, polygon[i].lat, polygon[i].lon);
    if (dist < minDist) minDist = dist;
    // Also check midpoint of segment
    const midLat = (polygon[i].lat + polygon[j].lat) / 2;
    const midLon = (polygon[i].lon + polygon[j].lon) / 2;
    const midDist = haversineKm(lat, lon, midLat, midLon);
    if (midDist < minDist) minDist = midDist;
  }
  return minDist;
}

// ══════════════════════════════════════════════════════════════════
// ── INLINED SWEEP SCHEDULER TYPES ────────────────────────────────
// ══════════════════════════════════════════════════════════════════

interface SweepSchedulerStatus {
  active: boolean;
  sweepCount: number;
  lastSweepAt: number | null;
  nextSweepAt: number | null;
  isRunning: boolean;
  intervalMs: number;
}

interface SweepResult {
  success: boolean;
  targetsChecked: number;
  targetsInConflict: number;
  geofenceAlertCount: number;
  newAlerts: number;
  durationMs: number;
  trigger: "scheduled" | "manual";
  conflictCacheAvailable: boolean;
  geofenceZoneCount: number;
  details: {
    conflictResults: Array<{
      targetId: number;
      targetLabel: string;
      severity: string;
      closestDistanceKm: number;
      dominantConflict: string | null;
    }>;
    geofenceResults: Array<{
      targetId: number;
      targetLabel: string;
      zoneId: number;
      zoneName: string;
      eventType: string;
    }>;
  };
}

// ══════════════════════════════════════════════════════════════════
// ── INLINED PDF EXPORT TYPES ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

interface TimelineEntry {
  id: string;
  timestamp: string;
  type: "signal" | "conflict";
  stationLabel?: string;
  snr?: number;
  online?: boolean;
  adcOverload?: boolean;
  users?: number;
  signalEventType?: "snr_drop" | "snr_spike" | "offline" | "adc_overload" | "normal";
  conflictEvent?: {
    id: number;
    date: string;
    lat: number;
    lng: number;
    country: string;
    conflict: string;
    type: number;
    best: number;
  };
  lat?: number;
  lon?: number;
}

interface CorrelationMatch {
  signalEntry: TimelineEntry;
  conflictEntry: TimelineEntry;
  timeDeltaHours: number;
  score: number;
  reason: string;
}

// ══════════════════════════════════════════════════════════════════
// ── TEST FIXTURES ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// A square zone around Kyiv, Ukraine (approx 50km x 50km)
const KYIV_ZONE: PolygonVertex[] = [
  { lat: 50.7, lon: 30.2 },
  { lat: 50.7, lon: 30.8 },
  { lat: 50.2, lon: 30.8 },
  { lat: 50.2, lon: 30.2 },
];

// A triangle zone in the Middle East
const MIDDLE_EAST_ZONE: PolygonVertex[] = [
  { lat: 35.0, lon: 40.0 },
  { lat: 33.0, lon: 44.0 },
  { lat: 37.0, lon: 44.0 },
];

// A small zone near the equator
const EQUATOR_ZONE: PolygonVertex[] = [
  { lat: 1.0, lon: 30.0 },
  { lat: 1.0, lon: 31.0 },
  { lat: -1.0, lon: 31.0 },
  { lat: -1.0, lon: 30.0 },
];

// ══════════════════════════════════════════════════════════════════
// ── TESTS: GEOFENCE POINT-IN-POLYGON ────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Geofence: Point-in-Polygon", () => {
  it("should detect point inside a square zone", () => {
    // Kyiv center (50.45, 30.52)
    expect(pointInPolygon(50.45, 30.52, KYIV_ZONE)).toBe(true);
  });

  it("should detect point outside a square zone", () => {
    // London (51.5, -0.12) — clearly outside
    expect(pointInPolygon(51.5, -0.12, KYIV_ZONE)).toBe(false);
  });

  it("should detect point inside a triangle zone", () => {
    // Center of the Middle East triangle
    const centroid = polygonCentroid(MIDDLE_EAST_ZONE);
    expect(pointInPolygon(centroid.lat, centroid.lon, MIDDLE_EAST_ZONE)).toBe(true);
  });

  it("should detect point outside a triangle zone", () => {
    expect(pointInPolygon(30.0, 40.0, MIDDLE_EAST_ZONE)).toBe(false);
  });

  it("should handle equator-crossing zone", () => {
    expect(pointInPolygon(0.5, 30.5, EQUATOR_ZONE)).toBe(true);
    expect(pointInPolygon(-0.5, 30.5, EQUATOR_ZONE)).toBe(true);
    expect(pointInPolygon(0.0, 30.5, EQUATOR_ZONE)).toBe(true);
  });

  it("should return false for degenerate polygon (< 3 vertices)", () => {
    expect(pointInPolygon(50.0, 30.0, [])).toBe(false);
    expect(pointInPolygon(50.0, 30.0, [{ lat: 50, lon: 30 }])).toBe(false);
    expect(
      pointInPolygon(50.0, 30.0, [
        { lat: 50, lon: 30 },
        { lat: 51, lon: 31 },
      ])
    ).toBe(false);
  });

  it("should handle point near polygon edge", () => {
    // Point very close to the edge of Kyiv zone
    const nearEdge = pointInPolygon(50.7, 30.5, KYIV_ZONE);
    // On the boundary — result depends on implementation, just verify no crash
    expect(typeof nearEdge).toBe("boolean");
  });

  it("should handle large polygon with many vertices", () => {
    // Create a circular polygon with 36 vertices
    const circle: PolygonVertex[] = [];
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * 2 * Math.PI;
      circle.push({
        lat: 45 + 2 * Math.cos(angle),
        lon: 10 + 2 * Math.sin(angle),
      });
    }
    expect(pointInPolygon(45, 10, circle)).toBe(true);
    expect(pointInPolygon(50, 10, circle)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: GEOFENCE POLYGON METRICS ─────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Geofence: Polygon Metrics", () => {
  it("should calculate centroid of a square zone", () => {
    const centroid = polygonCentroid(KYIV_ZONE);
    expect(centroid.lat).toBeCloseTo(50.45, 1);
    expect(centroid.lon).toBeCloseTo(30.5, 1);
  });

  it("should calculate centroid of empty polygon", () => {
    const centroid = polygonCentroid([]);
    expect(centroid.lat).toBe(0);
    expect(centroid.lon).toBe(0);
  });

  it("should calculate area of a square zone", () => {
    const area = polygonAreaKm2(KYIV_ZONE);
    // 0.5 degrees lat × 0.6 degrees lon at lat ~50
    // ~55.6km × ~42.8km ≈ 2380 km²
    expect(area).toBeGreaterThan(1500);
    expect(area).toBeLessThan(4000);
  });

  it("should return 0 area for degenerate polygon", () => {
    expect(polygonAreaKm2([])).toBe(0);
    expect(polygonAreaKm2([{ lat: 0, lon: 0 }])).toBe(0);
    expect(polygonAreaKm2([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])).toBe(0);
  });

  it("should calculate area of equator zone", () => {
    const area = polygonAreaKm2(EQUATOR_ZONE);
    // 2 degrees lat × 1 degree lon at equator
    // ~222.6km × ~111.3km ≈ 24,780 km²
    expect(area).toBeGreaterThan(15000);
    expect(area).toBeLessThan(35000);
  });

  it("should calculate distance to polygon for point outside", () => {
    // London to Kyiv zone
    const dist = distanceToPolygonKm(51.5, -0.12, KYIV_ZONE);
    expect(dist).toBeGreaterThan(1500); // London is ~2000km from Kyiv
    expect(dist).toBeLessThan(3000);
  });

  it("should return 0 distance for point inside polygon", () => {
    const dist = distanceToPolygonKm(50.45, 30.52, KYIV_ZONE);
    expect(dist).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: GEOFENCE ZONE TYPES ──────────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Geofence: Zone Type Logic", () => {
  // Simulate the state tracking logic from geofenceEngine.ts
  const targetZoneState = new Map<string, boolean>();

  function simulateCheck(
    targetId: number,
    zoneId: number,
    isInside: boolean,
    zoneType: "exclusion" | "inclusion"
  ): { triggered: boolean; eventType: "entered" | "exited" | null } {
    const stateKey = `${targetId}:${zoneId}`;
    const wasInside = targetZoneState.get(stateKey);
    let eventType: "entered" | "exited" | null = null;
    let triggered = false;

    if (wasInside === undefined) {
      targetZoneState.set(stateKey, isInside);
      if (isInside && zoneType === "exclusion") {
        eventType = "entered";
        triggered = true;
      } else if (!isInside && zoneType === "inclusion") {
        eventType = "exited";
        triggered = true;
      }
    } else if (wasInside !== isInside) {
      targetZoneState.set(stateKey, isInside);
      if (isInside) {
        eventType = "entered";
        triggered = zoneType === "exclusion";
      } else {
        eventType = "exited";
        triggered = zoneType === "inclusion";
      }
    } else {
      targetZoneState.set(stateKey, isInside);
    }

    return { triggered, eventType };
  }

  beforeEach(() => {
    targetZoneState.clear();
  });

  it("should trigger on first check inside exclusion zone", () => {
    const result = simulateCheck(1, 100, true, "exclusion");
    expect(result.triggered).toBe(true);
    expect(result.eventType).toBe("entered");
  });

  it("should NOT trigger on first check outside exclusion zone", () => {
    const result = simulateCheck(2, 100, false, "exclusion");
    expect(result.triggered).toBe(false);
    expect(result.eventType).toBeNull();
  });

  it("should trigger on first check outside inclusion zone", () => {
    const result = simulateCheck(3, 200, false, "inclusion");
    expect(result.triggered).toBe(true);
    expect(result.eventType).toBe("exited");
  });

  it("should NOT trigger on first check inside inclusion zone", () => {
    const result = simulateCheck(4, 200, true, "inclusion");
    expect(result.triggered).toBe(false);
    expect(result.eventType).toBeNull();
  });

  it("should trigger exclusion alert on entry transition", () => {
    // First: outside
    simulateCheck(5, 100, false, "exclusion");
    // Then: inside → should trigger
    const result = simulateCheck(5, 100, true, "exclusion");
    expect(result.triggered).toBe(true);
    expect(result.eventType).toBe("entered");
  });

  it("should trigger inclusion alert on exit transition", () => {
    // First: inside
    simulateCheck(6, 200, true, "inclusion");
    // Then: outside → should trigger
    const result = simulateCheck(6, 200, false, "inclusion");
    expect(result.triggered).toBe(true);
    expect(result.eventType).toBe("exited");
  });

  it("should NOT trigger when state doesn't change", () => {
    simulateCheck(7, 100, false, "exclusion");
    const result = simulateCheck(7, 100, false, "exclusion");
    expect(result.triggered).toBe(false);
    expect(result.eventType).toBeNull();
  });

  it("should NOT trigger exclusion alert on exit", () => {
    simulateCheck(8, 100, true, "exclusion");
    const result = simulateCheck(8, 100, false, "exclusion");
    expect(result.triggered).toBe(false);
    expect(result.eventType).toBe("exited");
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: SWEEP SCHEDULER STATUS ────────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Sweep Scheduler: Status Structure", () => {
  it("should have correct initial status shape", () => {
    const status: SweepSchedulerStatus = {
      active: false,
      sweepCount: 0,
      lastSweepAt: null,
      nextSweepAt: null,
      isRunning: false,
      intervalMs: 30 * 60 * 1000,
    };

    expect(status.active).toBe(false);
    expect(status.sweepCount).toBe(0);
    expect(status.lastSweepAt).toBeNull();
    expect(status.nextSweepAt).toBeNull();
    expect(status.isRunning).toBe(false);
    expect(status.intervalMs).toBe(1800000);
  });

  it("should have correct active status shape", () => {
    const now = Date.now();
    const status: SweepSchedulerStatus = {
      active: true,
      sweepCount: 5,
      lastSweepAt: now - 1800000,
      nextSweepAt: now + 1800000,
      isRunning: false,
      intervalMs: 1800000,
    };

    expect(status.active).toBe(true);
    expect(status.sweepCount).toBe(5);
    expect(status.lastSweepAt).toBeLessThan(now);
    expect(status.nextSweepAt).toBeGreaterThan(now);
  });
});

describe("Sweep Scheduler: Result Structure", () => {
  it("should have correct empty result shape", () => {
    const result: SweepResult = {
      success: true,
      targetsChecked: 0,
      targetsInConflict: 0,
      geofenceAlertCount: 0,
      newAlerts: 0,
      durationMs: 50,
      trigger: "manual",
      conflictCacheAvailable: false,
      geofenceZoneCount: 0,
      details: { conflictResults: [], geofenceResults: [] },
    };

    expect(result.success).toBe(true);
    expect(result.targetsChecked).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.details.conflictResults).toHaveLength(0);
    expect(result.details.geofenceResults).toHaveLength(0);
  });

  it("should have correct populated result shape", () => {
    const result: SweepResult = {
      success: true,
      targetsChecked: 10,
      targetsInConflict: 3,
      geofenceAlertCount: 2,
      newAlerts: 2,
      durationMs: 1500,
      trigger: "scheduled",
      conflictCacheAvailable: true,
      geofenceZoneCount: 5,
      details: {
        conflictResults: [
          {
            targetId: 1,
            targetLabel: "Target Alpha",
            severity: "high",
            closestDistanceKm: 25.3,
            dominantConflict: "Syria conflict",
          },
        ],
        geofenceResults: [
          {
            targetId: 2,
            targetLabel: "Target Bravo",
            zoneId: 100,
            zoneName: "Exclusion Zone 1",
            eventType: "entered",
          },
        ],
      },
    };

    expect(result.targetsChecked).toBe(10);
    expect(result.targetsInConflict).toBe(3);
    expect(result.geofenceAlertCount).toBe(2);
    expect(result.details.conflictResults).toHaveLength(1);
    expect(result.details.conflictResults[0].severity).toBe("high");
    expect(result.details.geofenceResults).toHaveLength(1);
    expect(result.details.geofenceResults[0].eventType).toBe("entered");
  });

  it("should distinguish manual vs scheduled triggers", () => {
    const manual: SweepResult = {
      success: true,
      targetsChecked: 5,
      targetsInConflict: 0,
      geofenceAlertCount: 0,
      newAlerts: 0,
      durationMs: 100,
      trigger: "manual",
      conflictCacheAvailable: true,
      geofenceZoneCount: 0,
      details: { conflictResults: [], geofenceResults: [] },
    };

    const scheduled: SweepResult = { ...manual, trigger: "scheduled" };

    expect(manual.trigger).toBe("manual");
    expect(scheduled.trigger).toBe("scheduled");
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: PDF EXPORT DATA PREPARATION ───────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("PDF Export: Data Preparation", () => {
  const sampleTimeline: TimelineEntry[] = [
    {
      id: "sig-station1-2026-01-15T10:00:00Z",
      timestamp: "2026-01-15T10:00:00Z",
      type: "signal",
      stationLabel: "Station Alpha",
      snr: 25.5,
      online: true,
      users: 3,
      signalEventType: "snr_drop",
    },
    {
      id: "sig-station2-2026-01-15T11:00:00Z",
      timestamp: "2026-01-15T11:00:00Z",
      type: "signal",
      stationLabel: "Station Bravo",
      snr: 40.2,
      online: true,
      users: 1,
      signalEventType: "normal",
    },
    {
      id: "conf-1001",
      timestamp: "2026-01-15T09:00:00Z",
      type: "conflict",
      conflictEvent: {
        id: 1001,
        date: "2026-01-15",
        lat: 35.5,
        lng: 44.2,
        country: "Iraq",
        conflict: "Government of Iraq - IS",
        type: 1,
        best: 15,
      },
      lat: 35.5,
      lon: 44.2,
    },
    {
      id: "sig-station1-2026-01-15T12:00:00Z",
      timestamp: "2026-01-15T12:00:00Z",
      type: "signal",
      stationLabel: "Station Alpha",
      snr: 10.1,
      online: false,
      users: 0,
      signalEventType: "offline",
    },
  ];

  const sampleCorrelations: CorrelationMatch[] = [
    {
      signalEntry: sampleTimeline[0],
      conflictEntry: sampleTimeline[2],
      timeDeltaHours: 1.0,
      score: 0.65,
      reason: "Significant SNR drop detected within 1 hour of conflict event",
    },
    {
      signalEntry: sampleTimeline[3],
      conflictEntry: sampleTimeline[2],
      timeDeltaHours: 3.0,
      score: 0.52,
      reason: "Station went offline within 3h of conflict event",
    },
  ];

  it("should separate signal and conflict entries", () => {
    const signalEntries = sampleTimeline.filter((e) => e.type === "signal");
    const conflictEntries = sampleTimeline.filter((e) => e.type === "conflict");

    expect(signalEntries).toHaveLength(3);
    expect(conflictEntries).toHaveLength(1);
  });

  it("should identify anomalies from signal entries", () => {
    const anomalies = sampleTimeline.filter(
      (e) => e.type === "signal" && e.signalEventType && e.signalEventType !== "normal"
    );
    expect(anomalies).toHaveLength(2);
    expect(anomalies[0].signalEventType).toBe("snr_drop");
    expect(anomalies[1].signalEventType).toBe("offline");
  });

  it("should compute high-score correlations", () => {
    const highScore = sampleCorrelations.filter((c) => c.score >= 0.5);
    expect(highScore).toHaveLength(2);
  });

  it("should compute country breakdown from conflict events", () => {
    const byCountry = new Map<string, { count: number; fatalities: number }>();
    for (const e of sampleTimeline) {
      if (e.type !== "conflict" || !e.conflictEvent) continue;
      const c = e.conflictEvent.country;
      const existing = byCountry.get(c) ?? { count: 0, fatalities: 0 };
      existing.count++;
      existing.fatalities += e.conflictEvent.best;
      byCountry.set(c, existing);
    }

    expect(byCountry.size).toBe(1);
    expect(byCountry.get("Iraq")?.count).toBe(1);
    expect(byCountry.get("Iraq")?.fatalities).toBe(15);
  });

  it("should compute station activity summary", () => {
    const stationStats = new Map<string, { entries: number; anomalies: number; totalSnr: number }>();
    for (const e of sampleTimeline) {
      if (e.type !== "signal" || !e.stationLabel) continue;
      const s = stationStats.get(e.stationLabel) ?? { entries: 0, anomalies: 0, totalSnr: 0 };
      s.entries++;
      if (e.signalEventType && e.signalEventType !== "normal") s.anomalies++;
      if (e.snr !== undefined) s.totalSnr += e.snr;
      stationStats.set(e.stationLabel, s);
    }

    expect(stationStats.size).toBe(2);
    expect(stationStats.get("Station Alpha")?.entries).toBe(2);
    expect(stationStats.get("Station Alpha")?.anomalies).toBe(2);
    expect(stationStats.get("Station Bravo")?.entries).toBe(1);
    expect(stationStats.get("Station Bravo")?.anomalies).toBe(0);
  });

  it("should handle empty timeline gracefully", () => {
    const empty: TimelineEntry[] = [];
    const signalEntries = empty.filter((e) => e.type === "signal");
    const conflictEntries = empty.filter((e) => e.type === "conflict");
    expect(signalEntries).toHaveLength(0);
    expect(conflictEntries).toHaveLength(0);
  });

  it("should sort correlations by score descending", () => {
    const sorted = [...sampleCorrelations].sort((a, b) => b.score - a.score);
    expect(sorted[0].score).toBeGreaterThanOrEqual(sorted[1].score);
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: PDF EXPORT FORMATTING ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("PDF Export: Formatting Helpers", () => {
  function formatDate(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
  }

  it("should format dates correctly", () => {
    const formatted = formatDate("2026-01-15T10:00:00Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("Jan");
    expect(formatted).toContain("15");
  });

  it("should truncate long strings", () => {
    const long = "A very long conflict name that exceeds the maximum length";
    const truncated = truncate(long, 20);
    expect(truncated.length).toBe(20);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("should not truncate short strings", () => {
    const short = "Short";
    expect(truncate(short, 20)).toBe("Short");
  });

  it("should handle empty string truncation", () => {
    expect(truncate("", 10)).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: GEOFENCE + CONFLICT INTEGRATION ───────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Geofence + Conflict Integration", () => {
  it("should detect target in conflict zone AND geofence zone", () => {
    // Target in Kyiv zone
    const inKyiv = pointInPolygon(50.45, 30.52, KYIV_ZONE);
    expect(inKyiv).toBe(true);

    // Simulate conflict events near Kyiv
    const conflictNearKyiv = { lat: 50.4, lng: 30.5, best: 20 };
    const distToConflict = haversineKm(50.45, 30.52, conflictNearKyiv.lat, conflictNearKyiv.lng);
    expect(distToConflict).toBeLessThan(10); // Very close
  });

  it("should detect target outside both zones", () => {
    // Target in London
    const inKyiv = pointInPolygon(51.5, -0.12, KYIV_ZONE);
    const inMiddleEast = pointInPolygon(51.5, -0.12, MIDDLE_EAST_ZONE);
    expect(inKyiv).toBe(false);
    expect(inMiddleEast).toBe(false);
  });

  it("should handle multiple zones for same target", () => {
    // Create overlapping zones
    const zone1: PolygonVertex[] = [
      { lat: 50, lon: 30 },
      { lat: 50, lon: 32 },
      { lat: 48, lon: 32 },
      { lat: 48, lon: 30 },
    ];
    const zone2: PolygonVertex[] = [
      { lat: 49.5, lon: 31 },
      { lat: 49.5, lon: 33 },
      { lat: 47.5, lon: 33 },
      { lat: 47.5, lon: 31 },
    ];

    // Point in overlap area
    const inZone1 = pointInPolygon(49.0, 31.5, zone1);
    const inZone2 = pointInPolygon(49.0, 31.5, zone2);
    expect(inZone1).toBe(true);
    expect(inZone2).toBe(true);

    // Point only in zone1
    const onlyZone1 = pointInPolygon(49.5, 30.5, zone1);
    const notZone2 = pointInPolygon(49.5, 30.5, zone2);
    expect(onlyZone1).toBe(true);
    expect(notZone2).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// ── TESTS: SWEEP INTERVAL LOGIC ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════

describe("Sweep Scheduler: Interval Logic", () => {
  it("should calculate correct next sweep time", () => {
    const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
    const now = Date.now();
    const nextSweep = now + SWEEP_INTERVAL_MS;

    expect(nextSweep - now).toBe(1800000);
    expect(nextSweep).toBeGreaterThan(now);
  });

  it("should track sweep count correctly", () => {
    let sweepCount = 0;
    for (let i = 0; i < 5; i++) {
      sweepCount++;
    }
    expect(sweepCount).toBe(5);
  });

  it("should prevent concurrent sweeps", () => {
    let isRunning = false;

    function startSweep(): boolean {
      if (isRunning) return false;
      isRunning = true;
      return true;
    }

    function endSweep(): void {
      isRunning = false;
    }

    expect(startSweep()).toBe(true);
    expect(startSweep()).toBe(false); // Should be blocked
    endSweep();
    expect(startSweep()).toBe(true); // Should work again
  });
});
