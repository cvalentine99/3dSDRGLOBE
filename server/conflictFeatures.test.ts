/**
 * Tests for conflict overlay enhancements:
 * - Conflict-receiver correlation (haversine distance, spatial indexing)
 * - Heatmap density mode (grid aggregation)
 * - Timeline scrubber (month generation)
 */
import { describe, it, expect } from "vitest";

// ── Haversine distance tests ──────────────────────────────────────────
describe("haversineDistance", () => {
  // Inline implementation for server-side testing (mirrors client/src/lib/conflictCorrelation.ts)
  function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  it("returns 0 for identical points", () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
    expect(haversineDistance(51.5, -0.12, 51.5, -0.12)).toBe(0);
  });

  it("calculates correct distance between London and Paris (~340km)", () => {
    const dist = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(350);
  });

  it("calculates correct distance between New York and Los Angeles (~3940km)", () => {
    const dist = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(dist).toBeGreaterThan(3900);
    expect(dist).toBeLessThan(4000);
  });

  it("handles antipodal points (~20000km)", () => {
    const dist = haversineDistance(0, 0, 0, 180);
    expect(dist).toBeGreaterThan(19900);
    expect(dist).toBeLessThan(20100);
  });

  it("handles negative coordinates", () => {
    // Sydney to Buenos Aires
    const dist = haversineDistance(-33.8688, 151.2093, -34.6037, -58.3816);
    expect(dist).toBeGreaterThan(11000);
    expect(dist).toBeLessThan(12500);
  });
});

// ── Conflict correlation logic tests ──────────────────────────────────
describe("conflict correlation logic", () => {
  interface MockStation {
    label: string;
    location: { coordinates: [number, number] };
    receivers: { type: string }[];
  }

  interface MockEvent {
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

  function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Simplified correlation computation for testing
  function computeCorrelations(
    stations: MockStation[],
    events: MockEvent[],
    radiusKm: number
  ) {
    const results: { label: string; nearbyConflicts: number; closestDistance: number; totalFatalities: number }[] = [];

    for (const station of stations) {
      const [lng, lat] = station.location.coordinates;
      let nearbyCount = 0;
      let closestDist = Infinity;
      let totalFat = 0;

      for (const evt of events) {
        const dist = haversineDistance(lat, lng, evt.lat, evt.lng);
        if (dist <= radiusKm) {
          nearbyCount++;
          if (dist < closestDist) closestDist = dist;
          totalFat += evt.best;
        }
      }

      if (nearbyCount > 0) {
        results.push({
          label: station.label,
          nearbyConflicts: nearbyCount,
          closestDistance: closestDist,
          totalFatalities: totalFat,
        });
      }
    }

    return results.sort((a, b) => b.nearbyConflicts - a.nearbyConflicts);
  }

  const stations: MockStation[] = [
    { label: "KiwiSDR-Kyiv", location: { coordinates: [30.5234, 50.4501] }, receivers: [{ type: "KiwiSDR" }] },
    { label: "KiwiSDR-London", location: { coordinates: [-0.1278, 51.5074] }, receivers: [{ type: "KiwiSDR" }] },
    { label: "WebSDR-Tokyo", location: { coordinates: [139.6917, 35.6895] }, receivers: [{ type: "WebSDR" }] },
  ];

  const events: MockEvent[] = [
    { id: 1, lat: 50.45, lng: 30.52, type: 1, best: 10, date: "2024-01-01", country: "Ukraine", region: "Europe", conflict: "Ukraine conflict", sideA: "A", sideB: "B" },
    { id: 2, lat: 50.50, lng: 30.60, type: 1, best: 5, date: "2024-01-02", country: "Ukraine", region: "Europe", conflict: "Ukraine conflict", sideA: "A", sideB: "B" },
    { id: 3, lat: 48.00, lng: 37.00, type: 2, best: 3, date: "2024-01-03", country: "Ukraine", region: "Europe", conflict: "Ukraine conflict", sideA: "A", sideB: "B" },
  ];

  it("identifies stations near conflict events", () => {
    const results = computeCorrelations(stations, events, 200);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.label === "KiwiSDR-Kyiv")).toBe(true);
  });

  it("excludes stations far from conflict events", () => {
    const results = computeCorrelations(stations, events, 200);
    expect(results.some((r) => r.label === "WebSDR-Tokyo")).toBe(false);
    expect(results.some((r) => r.label === "KiwiSDR-London")).toBe(false);
  });

  it("counts nearby conflicts correctly", () => {
    const results = computeCorrelations(stations, events, 200);
    const kyiv = results.find((r) => r.label === "KiwiSDR-Kyiv");
    expect(kyiv).toBeDefined();
    // Events 1 and 2 are within 200km of Kyiv, event 3 is ~500km away
    expect(kyiv!.nearbyConflicts).toBe(2);
  });

  it("sums fatalities correctly", () => {
    const results = computeCorrelations(stations, events, 200);
    const kyiv = results.find((r) => r.label === "KiwiSDR-Kyiv");
    expect(kyiv!.totalFatalities).toBe(15); // 10 + 5
  });

  it("returns empty array for no events", () => {
    const results = computeCorrelations(stations, [], 200);
    expect(results).toEqual([]);
  });

  it("returns empty array for no stations", () => {
    const results = computeCorrelations([], events, 200);
    expect(results).toEqual([]);
  });

  it("respects radius parameter", () => {
    // With a very small radius, no events should match
    const results = computeCorrelations(stations, events, 0.001);
    expect(results.length).toBe(0);

    // With a very large radius, Kyiv should match all 3 events
    const largeResults = computeCorrelations(stations, events, 1000);
    const kyiv = largeResults.find((r) => r.label === "KiwiSDR-Kyiv");
    expect(kyiv!.nearbyConflicts).toBe(3);
  });
});

// ── Threat level computation tests ────────────────────────────────────
describe("threat level computation", () => {
  function getStationThreatLevel(correlation: {
    nearbyConflicts: number;
    closestDistance: number;
    totalFatalities: number;
  }): number {
    const eventFactor = Math.min(correlation.nearbyConflicts / 50, 1);
    const proximityFactor = 1 - Math.min(correlation.closestDistance / 200, 1);
    const fatalityFactor = Math.min(correlation.totalFatalities / 500, 1);
    return Math.min(eventFactor * 0.4 + proximityFactor * 0.3 + fatalityFactor * 0.3, 1);
  }

  it("returns 0 for no nearby conflicts", () => {
    expect(getStationThreatLevel({ nearbyConflicts: 0, closestDistance: 999, totalFatalities: 0 })).toBe(0);
  });

  it("returns high threat for close, frequent, fatal conflicts", () => {
    const level = getStationThreatLevel({ nearbyConflicts: 100, closestDistance: 5, totalFatalities: 1000 });
    expect(level).toBeGreaterThan(0.8);
  });

  it("returns moderate threat for moderate proximity", () => {
    const level = getStationThreatLevel({ nearbyConflicts: 10, closestDistance: 100, totalFatalities: 50 });
    expect(level).toBeGreaterThan(0.1);
    expect(level).toBeLessThan(0.5);
  });

  it("caps at 1.0", () => {
    const level = getStationThreatLevel({ nearbyConflicts: 999, closestDistance: 0, totalFatalities: 99999 });
    expect(level).toBeLessThanOrEqual(1);
  });
});

// ── Heatmap grid aggregation tests ────────────────────────────────────
describe("heatmap grid aggregation", () => {
  interface MockEvent {
    lat: number;
    lng: number;
    type: number;
    best: number;
  }

  function aggregateToGrid(events: MockEvent[], cellSize: number) {
    const grid = new Map<string, { lat: number; lng: number; count: number; fatalities: number; dominantType: number; typeCounts: Record<number, number> }>();

    for (const evt of events) {
      const cellKey = `${Math.round(evt.lat / cellSize)},${Math.round(evt.lng / cellSize)}`;
      const existing = grid.get(cellKey);
      if (existing) {
        existing.count++;
        existing.fatalities += evt.best;
        existing.typeCounts[evt.type] = (existing.typeCounts[evt.type] ?? 0) + 1;
        let maxCount = 0;
        for (const [type, count] of Object.entries(existing.typeCounts)) {
          if (count > maxCount) {
            maxCount = count;
            existing.dominantType = Number(type);
          }
        }
      } else {
        grid.set(cellKey, {
          lat: Math.round(evt.lat / cellSize) * cellSize,
          lng: Math.round(evt.lng / cellSize) * cellSize,
          count: 1,
          fatalities: evt.best,
          dominantType: evt.type,
          typeCounts: { [evt.type]: 1 },
        });
      }
    }

    return Array.from(grid.values());
  }

  it("aggregates nearby events into the same cell", () => {
    const events: MockEvent[] = [
      { lat: 50.1, lng: 30.1, type: 1, best: 5 },
      { lat: 50.2, lng: 30.2, type: 1, best: 10 },
      { lat: 50.3, lng: 30.3, type: 2, best: 3 },
    ];
    const cells = aggregateToGrid(events, 1.0);
    // All three events should be in the same 1° cell (centered at 50, 30)
    expect(cells.length).toBe(1);
    expect(cells[0].count).toBe(3);
    expect(cells[0].fatalities).toBe(18);
  });

  it("separates distant events into different cells", () => {
    const events: MockEvent[] = [
      { lat: 50.0, lng: 30.0, type: 1, best: 5 },
      { lat: 55.0, lng: 35.0, type: 2, best: 10 },
    ];
    const cells = aggregateToGrid(events, 1.0);
    expect(cells.length).toBe(2);
  });

  it("tracks dominant violence type correctly", () => {
    const events: MockEvent[] = [
      { lat: 50.1, lng: 30.1, type: 1, best: 5 },
      { lat: 50.2, lng: 30.2, type: 2, best: 10 },
      { lat: 50.3, lng: 30.3, type: 2, best: 3 },
    ];
    const cells = aggregateToGrid(events, 1.0);
    expect(cells[0].dominantType).toBe(2); // Non-state is dominant (2 vs 1)
  });

  it("handles empty events array", () => {
    const cells = aggregateToGrid([], 1.0);
    expect(cells.length).toBe(0);
  });
});

// ── Timeline month generation tests ───────────────────────────────────
describe("timeline month generation", () => {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseLocalDate(dateStr: string): { year: number; month: number } {
    const [y, m] = dateStr.split("-").map(Number);
    return { year: y, month: m - 1 };
  }

  function generateMonths(startDate: string, endDate: string) {
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    const months: { year: number; month: number; label: string; startDate: string; endDate: string }[] = [];

    let current = new Date(start.year, start.month, 1);
    const lastMonth = new Date(end.year, end.month, 1);

    while (current <= lastMonth) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const nextMonth = new Date(year, month + 1, 1);
      const endOfMonth = new Date(nextMonth.getTime() - 1);

      months.push({
        year,
        month,
        label: `${MONTH_NAMES[month]} ${year}`,
        startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
        endDate: `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`,
      });

      current = nextMonth;
    }

    return months;
  }

  it("generates correct number of months for a 1-year range", () => {
    const months = generateMonths("2024-01-01", "2024-12-31");
    expect(months.length).toBe(12);
  });

  it("generates correct number of months for a 6-month range", () => {
    const months = generateMonths("2024-07-01", "2024-12-31");
    expect(months.length).toBe(6);
  });

  it("generates correct labels", () => {
    const months = generateMonths("2024-01-01", "2024-03-31");
    expect(months[0].label).toBe("Jan 2024");
    expect(months[1].label).toBe("Feb 2024");
    expect(months[2].label).toBe("Mar 2024");
  });

  it("generates correct start/end dates for February", () => {
    const months = generateMonths("2024-02-01", "2024-02-29");
    expect(months.length).toBe(1);
    expect(months[0].startDate).toBe("2024-02-01");
    expect(months[0].endDate).toBe("2024-02-29");
  });

  it("handles cross-year ranges", () => {
    const months = generateMonths("2023-11-01", "2024-02-28");
    expect(months.length).toBe(4);
    expect(months[0].label).toBe("Nov 2023");
    expect(months[3].label).toBe("Feb 2024");
  });

  it("handles single month range", () => {
    const months = generateMonths("2024-06-15", "2024-06-20");
    expect(months.length).toBe(1);
    expect(months[0].label).toBe("Jun 2024");
  });

  it("returns empty for reversed range", () => {
    const months = generateMonths("2024-06-01", "2024-05-01");
    expect(months.length).toBe(0);
  });
});
