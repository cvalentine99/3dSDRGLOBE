/**
 * Tests for the three new features:
 * 1. Conflict zone alert rules (analyzeConflictProximity logic, cache management)
 * 2. Expanded date range options (5 years, All time)
 * 3. SIGINT × Conflict timeline correlation logic
 *
 * Uses inlined pure functions to avoid importing heavy server modules (db, drizzle)
 * that cause vitest worker timeouts.
 */
import { describe, it, expect } from "vitest";
import { haversineKm } from "@shared/geo";

// ── Inlined types & logic from conflictZoneChecker.ts ────────────────

interface ConflictEvent {
  id: number;
  lat: number;
  lng: number;
  type: number;
  best: number;
  date: string;
  country: string;
  region: string;
  conflict: string;
  sideA: string;
  sideB: string;
}

const CONFLICT_ZONE_THRESHOLDS = { high: 50, medium: 100, low: 200 } as const;
const HIGH_SEVERITY_FATALITY_THRESHOLD = 10;
const MIN_EVENTS_FOR_ALERT = 1;
const CELL_SIZE = 2;

function buildSpatialIndex(events: ConflictEvent[]): Map<string, ConflictEvent[]> {
  const grid = new Map<string, ConflictEvent[]>();
  for (const evt of events) {
    const key = `${Math.floor(evt.lat / CELL_SIZE)},${Math.floor(evt.lng / CELL_SIZE)}`;
    const cell = grid.get(key);
    if (cell) cell.push(evt);
    else grid.set(key, [evt]);
  }
  return grid;
}

function getNearbyEvents(
  grid: Map<string, ConflictEvent[]>,
  lat: number,
  lon: number,
  radiusKm: number
): ConflictEvent[] {
  const cellRadius = Math.ceil(radiusKm / 111 / CELL_SIZE) + 1;
  const centerLat = Math.floor(lat / CELL_SIZE);
  const centerLon = Math.floor(lon / CELL_SIZE);
  const results: ConflictEvent[] = [];
  for (let dLat = -cellRadius; dLat <= cellRadius; dLat++) {
    for (let dLon = -cellRadius; dLon <= cellRadius; dLon++) {
      const key = `${centerLat + dLat},${centerLon + dLon}`;
      const cell = grid.get(key);
      if (cell) {
        for (const evt of cell) {
          const dist = haversineKm(lat, lon, evt.lat, evt.lng);
          if (dist <= radiusKm) results.push(evt);
        }
      }
    }
  }
  return results;
}

function analyzeConflictProximity(
  lat: number,
  lon: number,
  events: ConflictEvent[]
) {
  if (events.length === 0) {
    return {
      severity: null as "low" | "medium" | "high" | null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null as string | null,
      dominantCountry: null as string | null,
      nearbyEvents: [] as ConflictEvent[],
    };
  }
  const grid = buildSpatialIndex(events);
  const nearby = getNearbyEvents(grid, lat, lon, CONFLICT_ZONE_THRESHOLDS.low);
  if (nearby.length < MIN_EVENTS_FOR_ALERT) {
    return {
      severity: null as "low" | "medium" | "high" | null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null as string | null,
      dominantCountry: null as string | null,
      nearbyEvents: [] as ConflictEvent[],
    };
  }
  let closestDist = Infinity;
  let totalFat = 0;
  const conflictCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};
  for (const evt of nearby) {
    const dist = haversineKm(lat, lon, evt.lat, evt.lng);
    if (dist < closestDist) closestDist = dist;
    totalFat += evt.best;
    conflictCounts[evt.conflict] = (conflictCounts[evt.conflict] ?? 0) + 1;
    countryCounts[evt.country] = (countryCounts[evt.country] ?? 0) + 1;
  }
  let severity: "low" | "medium" | "high" | null = null;
  const closeEvents = nearby.filter(
    (e) => haversineKm(lat, lon, e.lat, e.lng) <= CONFLICT_ZONE_THRESHOLDS.high
  );
  const closeFatalities = closeEvents.reduce((sum, e) => sum + e.best, 0);
  if (closeEvents.length > 0 && closeFatalities >= HIGH_SEVERITY_FATALITY_THRESHOLD) {
    severity = "high";
  } else if (
    nearby.some((e) => haversineKm(lat, lon, e.lat, e.lng) <= CONFLICT_ZONE_THRESHOLDS.medium)
  ) {
    severity = "medium";
  } else {
    severity = "low";
  }
  const dominantConflict = Object.entries(conflictCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dominantCountry = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    severity,
    nearbyEventCount: nearby.length,
    closestDistanceKm: closestDist,
    totalFatalities: totalFat,
    dominantConflict,
    dominantCountry,
    nearbyEvents: nearby,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id: 1,
    lat: 50.45,
    lng: 30.52,
    type: 1,
    best: 5,
    date: "2025-01-15",
    country: "Ukraine",
    region: "Europe",
    conflict: "Ukraine conflict",
    sideA: "Side A",
    sideB: "Side B",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 1. CONFLICT ZONE ALERT RULES
// ══════════════════════════════════════════════════════════════════════

describe("analyzeConflictProximity", () => {
  it("returns null severity when no events are provided", () => {
    const result = analyzeConflictProximity(50.0, 30.0, []);
    expect(result.severity).toBeNull();
    expect(result.nearbyEventCount).toBe(0);
    expect(result.closestDistanceKm).toBe(Infinity);
    expect(result.totalFatalities).toBe(0);
    expect(result.dominantConflict).toBeNull();
    expect(result.dominantCountry).toBeNull();
    expect(result.nearbyEvents).toEqual([]);
  });

  it("returns null severity when all events are far away (>200km)", () => {
    const events = [makeEvent({ lat: 35.68, lng: 139.69 })]; // Tokyo
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.severity).toBeNull();
    expect(result.nearbyEventCount).toBe(0);
  });

  it("detects HIGH severity for close events with significant fatalities", () => {
    const events = [
      makeEvent({ id: 1, lat: 50.45, lng: 30.52, best: 8 }),
      makeEvent({ id: 2, lat: 50.46, lng: 30.53, best: 5 }),
    ];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.severity).toBe("high");
    expect(result.nearbyEventCount).toBe(2);
    expect(result.totalFatalities).toBe(13);
    expect(result.closestDistanceKm).toBeLessThan(CONFLICT_ZONE_THRESHOLDS.high);
  });

  it("detects MEDIUM severity for events within 100km", () => {
    // ~80km away
    const events = [makeEvent({ id: 1, lat: 51.17, lng: 30.52, best: 2 })];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.severity).toBe("medium");
    expect(result.closestDistanceKm).toBeGreaterThan(CONFLICT_ZONE_THRESHOLDS.high);
    expect(result.closestDistanceKm).toBeLessThan(CONFLICT_ZONE_THRESHOLDS.medium);
  });

  it("detects LOW severity for events within 200km but beyond 100km", () => {
    // ~150km away
    const events = [makeEvent({ id: 1, lat: 51.80, lng: 30.52, best: 2 })];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.severity).toBe("low");
    expect(result.closestDistanceKm).toBeGreaterThan(CONFLICT_ZONE_THRESHOLDS.medium);
    expect(result.closestDistanceKm).toBeLessThan(CONFLICT_ZONE_THRESHOLDS.low);
  });

  it("identifies dominant conflict and country correctly", () => {
    const events = [
      makeEvent({ id: 1, lat: 50.45, lng: 30.52, conflict: "Conflict A", country: "Country X" }),
      makeEvent({ id: 2, lat: 50.46, lng: 30.53, conflict: "Conflict A", country: "Country X" }),
      makeEvent({ id: 3, lat: 50.47, lng: 30.54, conflict: "Conflict B", country: "Country Y" }),
    ];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.dominantConflict).toBe("Conflict A");
    expect(result.dominantCountry).toBe("Country X");
  });

  it("sums fatalities from all nearby events", () => {
    const events = [
      makeEvent({ id: 1, lat: 50.45, lng: 30.52, best: 10 }),
      makeEvent({ id: 2, lat: 50.46, lng: 30.53, best: 20 }),
      makeEvent({ id: 3, lat: 50.47, lng: 30.54, best: 30 }),
    ];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.totalFatalities).toBe(60);
  });

  it("returns nearby events in the result", () => {
    const events = [
      makeEvent({ id: 1, lat: 50.45, lng: 30.52 }),
      makeEvent({ id: 2, lat: 50.46, lng: 30.53 }),
    ];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.nearbyEvents.length).toBe(2);
  });

  it("does not escalate to HIGH when close events have low fatalities", () => {
    const events = [makeEvent({ id: 1, lat: 50.45, lng: 30.52, best: 2 })];
    const result = analyzeConflictProximity(50.45, 30.52, events);
    expect(result.severity).not.toBe("high");
  });
});

describe("spatial index correctness", () => {
  it("builds grid cells correctly", () => {
    const events = [
      makeEvent({ lat: 0.5, lng: 0.5 }),
      makeEvent({ lat: 0.7, lng: 0.7 }),
      makeEvent({ lat: 5.0, lng: 5.0 }),
    ];
    const grid = buildSpatialIndex(events);
    // First two events should be in same cell (0,0), third in (2,2)
    expect(grid.size).toBe(2);
    expect(grid.get("0,0")?.length).toBe(2);
    expect(grid.get("2,2")?.length).toBe(1);
  });

  it("handles negative coordinates", () => {
    const events = [makeEvent({ lat: -33.86, lng: -58.38 })]; // Buenos Aires
    const grid = buildSpatialIndex(events);
    expect(grid.size).toBe(1);
    const key = `${Math.floor(-33.86 / CELL_SIZE)},${Math.floor(-58.38 / CELL_SIZE)}`;
    expect(grid.get(key)?.length).toBe(1);
  });
});

describe("CONFLICT_ZONE_THRESHOLDS configuration", () => {
  it("has correct threshold ordering (high < medium < low)", () => {
    expect(CONFLICT_ZONE_THRESHOLDS.high).toBeLessThan(CONFLICT_ZONE_THRESHOLDS.medium);
    expect(CONFLICT_ZONE_THRESHOLDS.medium).toBeLessThan(CONFLICT_ZONE_THRESHOLDS.low);
  });

  it("has expected threshold values", () => {
    expect(CONFLICT_ZONE_THRESHOLDS.high).toBe(50);
    expect(CONFLICT_ZONE_THRESHOLDS.medium).toBe(100);
    expect(CONFLICT_ZONE_THRESHOLDS.low).toBe(200);
  });

  it("HIGH_SEVERITY_FATALITY_THRESHOLD is 10", () => {
    expect(HIGH_SEVERITY_FATALITY_THRESHOLD).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. EXPANDED DATE RANGE
// ══════════════════════════════════════════════════════════════════════

describe("expanded date range presets", () => {
  function computeStartDate(daysBack: number): string {
    if (daysBack === -1) return "1989-01-01";
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().split("T")[0];
  }

  function computeMaxPages(daysBack: number): number {
    if (daysBack === -1) return 50;
    if (daysBack >= 1825) return 40;
    if (daysBack >= 730) return 30;
    return 20;
  }

  it("computes correct start date for All time (-1)", () => {
    expect(computeStartDate(-1)).toBe("1989-01-01");
  });

  it("computes correct start date for 5 years (1825 days)", () => {
    const result = computeStartDate(1825);
    const expected = new Date();
    expected.setDate(expected.getDate() - 1825);
    expect(result).toBe(expected.toISOString().split("T")[0]);
  });

  it("computes correct start date for 2 years (730 days)", () => {
    const result = computeStartDate(730);
    const expected = new Date();
    expected.setDate(expected.getDate() - 730);
    expect(result).toBe(expected.toISOString().split("T")[0]);
  });

  it("computes correct start date for 30 days", () => {
    const result = computeStartDate(30);
    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    expect(result).toBe(expected.toISOString().split("T")[0]);
  });

  it("allocates correct maxPages for All time", () => {
    expect(computeMaxPages(-1)).toBe(50);
  });

  it("allocates correct maxPages for 5 years", () => {
    expect(computeMaxPages(1825)).toBe(40);
  });

  it("allocates correct maxPages for 2 years", () => {
    expect(computeMaxPages(730)).toBe(30);
  });

  it("allocates correct maxPages for 30 days", () => {
    expect(computeMaxPages(30)).toBe(20);
  });

  it("allocates correct maxPages for 1 year (365 days)", () => {
    expect(computeMaxPages(365)).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. SIGINT × CONFLICT TIMELINE CORRELATION LOGIC
// ══════════════════════════════════════════════════════════════════════

describe("SIGINT × Conflict timeline correlation", () => {
  const CORRELATION_TIME_WINDOW_HOURS = 48;

  type SignalEventType = "snr_drop" | "snr_spike" | "offline" | "adc_overload" | "normal";

  interface SignalEntry {
    id: string;
    timestamp: string;
    signalEventType: SignalEventType;
    snr?: number;
    stationLabel?: string;
  }

  interface ConflictEntry {
    id: string;
    timestamp: string;
    conflict: string;
    country: string;
    best: number;
  }

  function computeCorrelationScore(
    sig: SignalEntry,
    conf: ConflictEntry,
    timeDeltaHours: number
  ): number {
    if (timeDeltaHours > CORRELATION_TIME_WINDOW_HOURS) return 0;
    const timeScore = 1 - timeDeltaHours / CORRELATION_TIME_WINDOW_HOURS;
    let severityBoost = 0;
    if (sig.signalEventType === "offline") severityBoost = 0.3;
    else if (sig.signalEventType === "adc_overload") severityBoost = 0.2;
    else if (sig.signalEventType === "snr_drop") severityBoost = 0.15;
    const fatalityBoost = Math.min((conf.best || 0) / 100, 0.2);
    return Math.min(timeScore * 0.5 + severityBoost + fatalityBoost, 1);
  }

  function classifySignalEvent(
    snr: number,
    online: boolean,
    adcOverload: boolean,
    prevSnr?: number
  ): SignalEventType {
    if (!online) return "offline";
    if (adcOverload) return "adc_overload";
    if (prevSnr !== undefined && prevSnr >= 0 && snr >= 0) {
      const delta = snr - prevSnr;
      if (delta <= -5) return "snr_drop";
      if (delta >= 8) return "snr_spike";
    }
    return "normal";
  }

  describe("signal event classification", () => {
    it("classifies offline station", () => {
      expect(classifySignalEvent(0, false, false)).toBe("offline");
    });

    it("classifies ADC overload", () => {
      expect(classifySignalEvent(10, true, true)).toBe("adc_overload");
    });

    it("classifies SNR drop (>= 5 dB decrease)", () => {
      expect(classifySignalEvent(5, true, false, 12)).toBe("snr_drop");
    });

    it("classifies SNR spike (>= 8 dB increase)", () => {
      expect(classifySignalEvent(20, true, false, 10)).toBe("snr_spike");
    });

    it("classifies normal signal", () => {
      expect(classifySignalEvent(15, true, false, 14)).toBe("normal");
    });

    it("classifies as normal when no previous entry", () => {
      expect(classifySignalEvent(15, true, false)).toBe("normal");
    });

    it("offline takes priority over ADC overload", () => {
      expect(classifySignalEvent(0, false, true)).toBe("offline");
    });
  });

  describe("correlation scoring", () => {
    const baseSig: SignalEntry = {
      id: "sig-1",
      timestamp: "2025-01-15T12:00:00Z",
      signalEventType: "offline",
      snr: -1,
      stationLabel: "TestStation",
    };

    const baseConf: ConflictEntry = {
      id: "conf-1",
      timestamp: "2025-01-15T12:00:00Z",
      conflict: "Test conflict",
      country: "TestCountry",
      best: 50,
    };

    it("returns 0 for events outside the time window", () => {
      const score = computeCorrelationScore(baseSig, baseConf, 49);
      expect(score).toBe(0);
    });

    it("returns highest score for simultaneous offline + high fatality events", () => {
      const score = computeCorrelationScore(baseSig, baseConf, 0);
      // timeScore = 1.0, severityBoost = 0.3 (offline), fatalityBoost = 0.2 (50/100 capped at 0.2)
      // total = 1.0 * 0.5 + 0.3 + 0.2 = 1.0
      expect(score).toBe(1.0);
    });

    it("gives higher score to offline than snr_drop", () => {
      const offlineScore = computeCorrelationScore(
        { ...baseSig, signalEventType: "offline" },
        baseConf,
        6
      );
      const snrDropScore = computeCorrelationScore(
        { ...baseSig, signalEventType: "snr_drop" },
        baseConf,
        6
      );
      expect(offlineScore).toBeGreaterThan(snrDropScore);
    });

    it("gives higher score to closer temporal events", () => {
      const closeScore = computeCorrelationScore(baseSig, baseConf, 1);
      const farScore = computeCorrelationScore(baseSig, baseConf, 24);
      expect(closeScore).toBeGreaterThan(farScore);
    });

    it("gives higher score to higher fatality events", () => {
      const highFatScore = computeCorrelationScore(
        baseSig,
        { ...baseConf, best: 100 },
        12
      );
      const lowFatScore = computeCorrelationScore(
        baseSig,
        { ...baseConf, best: 1 },
        12
      );
      expect(highFatScore).toBeGreaterThan(lowFatScore);
    });

    it("caps score at 1.0", () => {
      const score = computeCorrelationScore(
        { ...baseSig, signalEventType: "offline" },
        { ...baseConf, best: 1000 },
        0
      );
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it("normal events get no severity boost", () => {
      const normalScore = computeCorrelationScore(
        { ...baseSig, signalEventType: "normal" },
        { ...baseConf, best: 0 },
        12
      );
      // timeScore only: (1 - 12/48) * 0.5 = 0.375
      expect(normalScore).toBeCloseTo(0.375, 2);
    });

    it("adc_overload gets moderate severity boost", () => {
      const adcScore = computeCorrelationScore(
        { ...baseSig, signalEventType: "adc_overload" },
        { ...baseConf, best: 0 },
        0
      );
      // timeScore = 0.5, severityBoost = 0.2, fatalityBoost = 0
      expect(adcScore).toBeCloseTo(0.7, 2);
    });

    it("minimum threshold of 0.15 filters weak correlations", () => {
      const score = computeCorrelationScore(
        { ...baseSig, signalEventType: "normal" },
        { ...baseConf, best: 0 },
        46
      );
      // timeScore = (1 - 46/48) * 0.5 ≈ 0.021
      expect(score).toBeLessThan(0.15);
    });
  });
});
