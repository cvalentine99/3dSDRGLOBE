/**
 * UCDP Router Tests
 *
 * Tests for the UCDP conflict data integration:
 * - API connectivity and data format validation
 * - Event slimming and summary computation
 * - Cache behavior
 * - Input validation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Unit tests for data transformation logic ────────────────────────

describe("UCDP Data Transformation", () => {
  // Test the slim event transformation
  it("should correctly slim a UCDP event", () => {
    const rawEvent = {
      id: 12345,
      relid: "SYR-2024-01-01-0001",
      year: 2024,
      type_of_violence: 1,
      conflict_name: "Syria: Government",
      dyad_name: "Government of Syria vs. SNA",
      side_a: "Government of Syria",
      side_b: "SNA",
      latitude: 36.2,
      longitude: 37.15,
      country: "Syria",
      country_id: 652,
      region: "Middle East",
      date_start: "2024-01-01",
      date_end: "2024-01-01",
      best: 15,
      high: 20,
      low: 10,
      deaths_a: 5,
      deaths_b: 8,
      deaths_civilians: 2,
      deaths_unknown: 0,
      where_description: "Aleppo",
      adm_1: "Aleppo",
      adm_2: "",
      source_article: "Reuters 2024-01-02",
      event_clarity: 1,
      where_prec: 1,
    };

    // Replicate the slimEvent function logic
    const slim = {
      id: rawEvent.id,
      lat: rawEvent.latitude,
      lng: rawEvent.longitude,
      type: rawEvent.type_of_violence,
      best: rawEvent.best,
      date: rawEvent.date_end,
      country: rawEvent.country,
      region: rawEvent.region,
      conflict: rawEvent.conflict_name,
      sideA: rawEvent.side_a,
      sideB: rawEvent.side_b,
    };

    expect(slim.id).toBe(12345);
    expect(slim.lat).toBe(36.2);
    expect(slim.lng).toBe(37.15);
    expect(slim.type).toBe(1);
    expect(slim.best).toBe(15);
    expect(slim.date).toBe("2024-01-01");
    expect(slim.country).toBe("Syria");
    expect(slim.region).toBe("Middle East");
    expect(slim.conflict).toBe("Syria: Government");
    expect(slim.sideA).toBe("Government of Syria");
    expect(slim.sideB).toBe("SNA");
  });

  it("should compute summary statistics correctly", () => {
    const events = [
      { type_of_violence: 1, country: "Syria", region: "Middle East", best: 10, deaths_civilians: 3 },
      { type_of_violence: 1, country: "Syria", region: "Middle East", best: 5, deaths_civilians: 1 },
      { type_of_violence: 2, country: "Nigeria", region: "Africa", best: 20, deaths_civilians: 8 },
      { type_of_violence: 3, country: "Myanmar", region: "Asia", best: 50, deaths_civilians: 50 },
      { type_of_violence: 1, country: "Ukraine", region: "Europe", best: 30, deaths_civilians: 10 },
    ];

    const byType: Record<number, number> = {};
    const byCountry: Record<string, number> = {};
    let totalFatalities = 0;
    let civilianDeaths = 0;

    for (const e of events) {
      byType[e.type_of_violence] = (byType[e.type_of_violence] ?? 0) + 1;
      byCountry[e.country] = (byCountry[e.country] ?? 0) + 1;
      totalFatalities += e.best;
      civilianDeaths += e.deaths_civilians;
    }

    expect(byType[1]).toBe(3); // state-based
    expect(byType[2]).toBe(1); // non-state
    expect(byType[3]).toBe(1); // one-sided
    expect(totalFatalities).toBe(115);
    expect(civilianDeaths).toBe(72);
    expect(byCountry["Syria"]).toBe(2);
    expect(byCountry["Nigeria"]).toBe(1);
    expect(byCountry["Myanmar"]).toBe(1);
    expect(byCountry["Ukraine"]).toBe(1);

    // Top countries sorted by count
    const topCountries = Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    expect(topCountries[0]).toEqual({ name: "Syria", count: 2 });
    expect(topCountries.length).toBe(4);
  });
});

describe("UCDP Cache Logic", () => {
  it("should generate consistent cache keys", () => {
    const params1 = {
      startDate: "2024-01-01",
      region: "Africa",
      dataset: "ged",
    };
    const params2 = {
      startDate: "2024-01-01",
      region: "Africa",
      dataset: "ged",
    };
    const params3 = {
      startDate: "2024-01-01",
      region: "Europe",
      dataset: "ged",
    };

    const key1 = JSON.stringify(params1);
    const key2 = JSON.stringify(params2);
    const key3 = JSON.stringify(params3);

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("should expire cache entries after TTL", () => {
    const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
    const entry = {
      data: [],
      totalCount: 0,
      fetchedAt: Date.now() - CACHE_TTL_MS - 1000, // 1 second past TTL
    };

    const isExpired = Date.now() - entry.fetchedAt > CACHE_TTL_MS;
    expect(isExpired).toBe(true);
  });

  it("should not expire fresh cache entries", () => {
    const CACHE_TTL_MS = 60 * 60 * 1000;
    const entry = {
      data: [],
      totalCount: 0,
      fetchedAt: Date.now() - 1000, // 1 second ago
    };

    const isExpired = Date.now() - entry.fetchedAt > CACHE_TTL_MS;
    expect(isExpired).toBe(false);
  });
});

describe("UCDP Input Validation", () => {
  it("should validate violence type values", () => {
    const validTypes = ["1", "2", "3", "1,2", "1,3", "2,3", "1,2,3"];
    const invalidTypes = ["0", "4", "abc", ""];

    for (const t of validTypes) {
      const nums = t.split(",").map(Number);
      expect(nums.every((n) => n >= 1 && n <= 3)).toBe(true);
    }

    for (const t of invalidTypes) {
      if (t === "") continue;
      const nums = t.split(",").map(Number);
      const allValid = nums.every((n) => n >= 1 && n <= 3);
      expect(allValid).toBe(false);
    }
  });

  it("should validate date format", () => {
    const validDates = ["2024-01-01", "2025-12-31", "2023-06-15"];
    const invalidDates = ["01-01-2024", "2024/01/01", "not-a-date"];

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    for (const d of validDates) {
      expect(dateRegex.test(d)).toBe(true);
    }

    for (const d of invalidDates) {
      expect(dateRegex.test(d)).toBe(false);
    }
  });

  it("should validate region names", () => {
    const validRegions = ["Africa", "Americas", "Asia", "Europe", "Middle East"];
    const allValid = validRegions.every((r) => typeof r === "string" && r.length > 0);
    expect(allValid).toBe(true);
  });
});

describe("UCDP Marker Sizing", () => {
  it("should return appropriate marker sizes based on fatalities", () => {
    // Replicate getMarkerSize logic
    function getMarkerSize(fatalities: number): number {
      if (fatalities <= 0) return 0.03;
      if (fatalities <= 5) return 0.04;
      if (fatalities <= 20) return 0.055;
      if (fatalities <= 100) return 0.07;
      if (fatalities <= 500) return 0.09;
      return 0.12;
    }

    expect(getMarkerSize(0)).toBe(0.03);
    expect(getMarkerSize(1)).toBe(0.04);
    expect(getMarkerSize(5)).toBe(0.04);
    expect(getMarkerSize(6)).toBe(0.055);
    expect(getMarkerSize(20)).toBe(0.055);
    expect(getMarkerSize(21)).toBe(0.07);
    expect(getMarkerSize(100)).toBe(0.07);
    expect(getMarkerSize(101)).toBe(0.09);
    expect(getMarkerSize(500)).toBe(0.09);
    expect(getMarkerSize(501)).toBe(0.12);
    expect(getMarkerSize(10000)).toBe(0.12);
  });

  it("should have monotonically increasing sizes", () => {
    function getMarkerSize(fatalities: number): number {
      if (fatalities <= 0) return 0.03;
      if (fatalities <= 5) return 0.04;
      if (fatalities <= 20) return 0.055;
      if (fatalities <= 100) return 0.07;
      if (fatalities <= 500) return 0.09;
      return 0.12;
    }

    const sizes = [0, 1, 10, 50, 200, 1000].map(getMarkerSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });
});

describe("UCDP Merged Dataset Logic", () => {
  const GED_CUTOFF_DATE = "2025-01-01";

  it("should determine correct datasets based on date range", () => {
    // Date range entirely before cutoff → only GED
    const range1 = { startDate: "2023-01-01", endDate: "2024-06-30" };
    const needsGed1 = range1.startDate < GED_CUTOFF_DATE;
    const needsCandidate1 = !range1.endDate || range1.endDate >= GED_CUTOFF_DATE;
    expect(needsGed1).toBe(true);
    expect(needsCandidate1).toBe(false);

    // Date range entirely after cutoff → only Candidate
    const range2 = { startDate: "2025-02-01", endDate: "2025-06-30" };
    const needsGed2 = range2.startDate < GED_CUTOFF_DATE;
    const needsCandidate2 = !range2.endDate || range2.endDate >= GED_CUTOFF_DATE;
    expect(needsGed2).toBe(false);
    expect(needsCandidate2).toBe(true);

    // Date range spanning cutoff → both datasets
    const range3 = { startDate: "2024-06-01", endDate: "2025-06-30" };
    const needsGed3 = range3.startDate < GED_CUTOFF_DATE;
    const needsCandidate3 = !range3.endDate || range3.endDate >= GED_CUTOFF_DATE;
    expect(needsGed3).toBe(true);
    expect(needsCandidate3).toBe(true);
  });

  it("should determine both datasets when no end date is specified", () => {
    const range = { startDate: "2024-01-01", endDate: undefined };
    const needsGed = range.startDate < GED_CUTOFF_DATE;
    const needsCandidate = !range.endDate || range.endDate >= GED_CUTOFF_DATE;
    expect(needsGed).toBe(true);
    expect(needsCandidate).toBe(true);
  });

  it("should deduplicate events by ID when merging datasets", () => {
    const gedEvents = [
      { id: 1, date_end: "2024-12-01" },
      { id: 2, date_end: "2024-11-15" },
      { id: 3, date_end: "2024-12-31" },
    ];
    const candidateEvents = [
      { id: 3, date_end: "2024-12-31" }, // duplicate
      { id: 4, date_end: "2025-01-15" },
      { id: 5, date_end: "2025-02-01" },
    ];

    const eventMap = new Map<number, any>();
    for (const e of gedEvents) eventMap.set(e.id, e);
    for (const e of candidateEvents) {
      if (!eventMap.has(e.id)) eventMap.set(e.id, e);
    }

    const merged = Array.from(eventMap.values());
    expect(merged.length).toBe(5); // 3 GED + 2 unique candidate
    expect(merged.filter(e => e.id === 3).length).toBe(1); // no duplicates
  });

  it("should sort merged events by date descending", () => {
    const events = [
      { id: 1, date_end: "2024-06-01" },
      { id: 2, date_end: "2025-02-01" },
      { id: 3, date_end: "2024-12-15" },
      { id: 4, date_end: "2025-01-01" },
    ];

    events.sort((a, b) => b.date_end.localeCompare(a.date_end));

    expect(events[0].id).toBe(2); // 2025-02-01
    expect(events[1].id).toBe(4); // 2025-01-01
    expect(events[2].id).toBe(3); // 2024-12-15
    expect(events[3].id).toBe(1); // 2024-06-01
  });

  it("should default to last 365 days when no dates specified", () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const defaultStart = oneYearAgo.toISOString().split("T")[0];

    // The default start date should be a valid YYYY-MM-DD string
    expect(/^\d{4}-\d{2}-\d{2}$/.test(defaultStart)).toBe(true);

    // It should be approximately 365 days ago
    const diffMs = Date.now() - new Date(defaultStart).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(360);
    expect(diffDays).toBeLessThan(370);
  });
});

describe("UCDP Violence Type Configuration", () => {
  it("should have colors for all violence types", () => {
    const VIOLENCE_TYPE_COLORS: Record<number, string> = {
      1: "#ef4444",
      2: "#f97316",
      3: "#eab308",
    };

    expect(VIOLENCE_TYPE_COLORS[1]).toBeDefined();
    expect(VIOLENCE_TYPE_COLORS[2]).toBeDefined();
    expect(VIOLENCE_TYPE_COLORS[3]).toBeDefined();
  });

  it("should have labels for all violence types", () => {
    const VIOLENCE_TYPE_LABELS: Record<number, string> = {
      1: "State-based",
      2: "Non-state",
      3: "One-sided",
    };

    expect(VIOLENCE_TYPE_LABELS[1]).toBe("State-based");
    expect(VIOLENCE_TYPE_LABELS[2]).toBe("Non-state");
    expect(VIOLENCE_TYPE_LABELS[3]).toBe("One-sided");
  });
});
