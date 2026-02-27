/**
 * HDX HAPI Rate Limiting, Caching, and Jitter Tests
 *
 * Tests for the enhanced conflict data features:
 * - Seeded PRNG determinism (mulberry32)
 * - Gaussian jitter distribution
 * - Golden-angle spiral point distribution
 * - Country-extent-aware coordinate spreading
 * - Rate limiting window enforcement
 * - Request deduplication logic
 * - Cache TTL and stats tracking
 * - Heatmap density grid aggregation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Replicate core utility functions for unit testing ──────────────

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function spiralPoint(
  index: number,
  total: number,
  rng: () => number
): [number, number] {
  const r = Math.sqrt((index + 0.5) / total);
  const theta = index * GOLDEN_ANGLE + rng() * 0.3;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash >>> 0;
}

// ── Seeded PRNG Tests ──────────────────────────────────────────────

describe("Mulberry32 Seeded PRNG", () => {
  it("should produce deterministic sequences for the same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const seq1 = Array.from({ length: 100 }, () => rng1());
    const seq2 = Array.from({ length: 100 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("should produce different sequences for different seeds", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(43);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it("should produce values in [0, 1) range", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 10000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("should have reasonable distribution (no extreme clustering)", () => {
    const rng = mulberry32(99);
    const buckets = new Array(10).fill(0);
    const N = 10000;

    for (let i = 0; i < N; i++) {
      const val = rng();
      buckets[Math.floor(val * 10)]++;
    }

    // Each bucket should have roughly N/10 = 1000 entries
    // Allow ±30% tolerance
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});

// ── Gaussian Random Tests ──────────────────────────────────────────

describe("Gaussian Random (Box-Muller)", () => {
  it("should have mean approximately 0", () => {
    const rng = mulberry32(42);
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += gaussianRandom(rng);
    }
    const mean = sum / N;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });

  it("should have standard deviation approximately 1", () => {
    const rng = mulberry32(42);
    const N = 10000;
    const values: number[] = [];
    for (let i = 0; i < N; i++) {
      values.push(gaussianRandom(rng));
    }
    const mean = values.reduce((a, b) => a + b, 0) / N;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / N;
    const stddev = Math.sqrt(variance);
    expect(stddev).toBeGreaterThan(0.9);
    expect(stddev).toBeLessThan(1.1);
  });

  it("should produce values mostly within ±3 standard deviations", () => {
    const rng = mulberry32(42);
    const N = 10000;
    let outliers = 0;
    for (let i = 0; i < N; i++) {
      const val = gaussianRandom(rng);
      if (Math.abs(val) > 3) outliers++;
    }
    // ~0.3% should be outside ±3σ
    expect(outliers / N).toBeLessThan(0.01);
  });
});

// ── Golden-Angle Spiral Tests ──────────────────────────────────────

describe("Golden-Angle Spiral Distribution", () => {
  it("should distribute points within unit disc", () => {
    const rng = mulberry32(42);
    const total = 50;
    for (let i = 0; i < total; i++) {
      const [x, y] = spiralPoint(i, total, rng);
      const r = Math.sqrt(x * x + y * y);
      // Points should be within ~1.3 of unit radius (with perturbation)
      expect(r).toBeLessThan(1.5);
    }
  });

  it("should produce evenly distributed angles", () => {
    const rng = mulberry32(42);
    const total = 100;
    const angles: number[] = [];
    for (let i = 0; i < total; i++) {
      const [x, y] = spiralPoint(i, total, rng);
      angles.push(Math.atan2(y, x));
    }

    // Check that angles span the full range [-π, π]
    const minAngle = Math.min(...angles);
    const maxAngle = Math.max(...angles);
    expect(maxAngle - minAngle).toBeGreaterThan(Math.PI);
  });

  it("should produce different positions for different indices", () => {
    const rng = mulberry32(42);
    const total = 20;
    const points = Array.from({ length: total }, (_, i) => spiralPoint(i, total, rng));

    // No two points should be identical
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dist = Math.sqrt(
          (points[i][0] - points[j][0]) ** 2 + (points[i][1] - points[j][1]) ** 2
        );
        expect(dist).toBeGreaterThan(0.01);
      }
    }
  });

  it("should have increasing radius for increasing indices", () => {
    // The spiral should generally move outward
    const rng = mulberry32(42);
    const total = 50;
    const radii: number[] = [];
    for (let i = 0; i < total; i++) {
      const [x, y] = spiralPoint(i, total, rng);
      radii.push(Math.sqrt(x * x + y * y));
    }

    // Average radius of first 10 should be less than average of last 10
    const firstAvg = radii.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const lastAvg = radii.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(lastAvg).toBeGreaterThan(firstAvg);
  });
});

// ── Hash Code Tests ────────────────────────────────────────────────

describe("String Hash Code", () => {
  it("should produce consistent hashes", () => {
    expect(hashCode("test")).toBe(hashCode("test"));
    expect(hashCode("SYR-political_violence-2024-01-01")).toBe(
      hashCode("SYR-political_violence-2024-01-01")
    );
  });

  it("should produce different hashes for different inputs", () => {
    expect(hashCode("SYR")).not.toBe(hashCode("IRQ"));
    expect(hashCode("a")).not.toBe(hashCode("b"));
  });

  it("should return unsigned 32-bit integers", () => {
    const testStrings = ["", "a", "test", "long-string-with-many-chars-12345"];
    for (const s of testStrings) {
      const h = hashCode(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

// ── Country Extent Jitter Tests ────────────────────────────────────

describe("Country-Extent-Aware Jitter", () => {
  const COUNTRY_EXTENT: Record<string, [number, number]> = {
    RUS: [30, 80],
    USA: [20, 50],
    QAT: [1, 1],
    MLT: [0.3, 0.3],
  };
  const DEFAULT_EXTENT: [number, number] = [3, 3];

  it("should spread markers more for larger countries", () => {
    const centroid = [55.75, 37.62]; // Moscow
    const extent = COUNTRY_EXTENT["RUS"]!;
    const latSpread = extent[0] * 0.4;
    const lngSpread = extent[1] * 0.4;

    // Russia should have ~12° lat spread and ~32° lng spread
    expect(latSpread).toBe(12);
    expect(lngSpread).toBe(32);
  });

  it("should spread markers less for smaller countries", () => {
    const extent = COUNTRY_EXTENT["QAT"]!;
    const latSpread = extent[0] * 0.4;
    const lngSpread = extent[1] * 0.4;

    expect(latSpread).toBe(0.4);
    expect(lngSpread).toBe(0.4);
  });

  it("should use default extent for unknown countries", () => {
    const extent = COUNTRY_EXTENT["XYZ"] ?? DEFAULT_EXTENT;
    expect(extent).toEqual([3, 3]);
  });

  it("should produce coordinates within country extent bounds", () => {
    const centroid: [number, number] = [38.96, -77.0]; // USA centroid
    const extent = COUNTRY_EXTENT["USA"]!;
    const latSpread = extent[0] * 0.4;
    const lngSpread = extent[1] * 0.4;

    const rng = mulberry32(42);
    const total = 50;

    for (let i = 0; i < total; i++) {
      const [sx, sy] = spiralPoint(i, total, rng);
      const gx = gaussianRandom(rng) * 0.15;
      const gy = gaussianRandom(rng) * 0.15;
      const lat = centroid[0] + (sx + gx) * latSpread;
      const lng = centroid[1] + (sy + gy) * lngSpread;

      // Should be within reasonable bounds (spiral + gaussian can exceed 1.0)
      expect(Math.abs(lat - centroid[0])).toBeLessThan(latSpread * 2);
      expect(Math.abs(lng - centroid[1])).toBeLessThan(lngSpread * 2);
    }
  });

  it("should produce deterministic positions for the same record", () => {
    const seed1 = hashCode("SYR-political_violence-2024-01-01");
    const seed2 = hashCode("SYR-political_violence-2024-01-01");
    expect(seed1).toBe(seed2);

    const rng1 = mulberry32(seed1);
    const rng2 = mulberry32(seed2);

    const points1 = Array.from({ length: 10 }, (_, i) => {
      const [sx, sy] = spiralPoint(i, 10, rng1);
      const gx = gaussianRandom(rng1) * 0.15;
      const gy = gaussianRandom(rng1) * 0.15;
      return [sx + gx, sy + gy];
    });

    const points2 = Array.from({ length: 10 }, (_, i) => {
      const [sx, sy] = spiralPoint(i, 10, rng2);
      const gx = gaussianRandom(rng2) * 0.15;
      const gy = gaussianRandom(rng2) * 0.15;
      return [sx + gx, sy + gy];
    });

    expect(points1).toEqual(points2);
  });
});

// ── Rate Limiting Tests ────────────────────────────────────────────

describe("Rate Limiting Logic", () => {
  it("should allow requests within the limit", () => {
    const RATE_LIMIT_WINDOW_MS = 60 * 1000;
    const RATE_LIMIT_MAX_REQUESTS = 10;
    const log: number[] = [];

    function checkRateLimit(): boolean {
      const now = Date.now();
      while (log.length > 0 && log[0] < now - RATE_LIMIT_WINDOW_MS) {
        log.shift();
      }
      return log.length < RATE_LIMIT_MAX_REQUESTS;
    }

    function recordRequest(): void {
      log.push(Date.now());
    }

    // Should allow first 10 requests
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit()).toBe(true);
      recordRequest();
    }

    // 11th should be blocked
    expect(checkRateLimit()).toBe(false);
  });

  it("should reset after the window expires", () => {
    const RATE_LIMIT_WINDOW_MS = 60 * 1000;
    const RATE_LIMIT_MAX_REQUESTS = 10;
    const log: number[] = [];

    function checkRateLimit(now: number): boolean {
      while (log.length > 0 && log[0] < now - RATE_LIMIT_WINDOW_MS) {
        log.shift();
      }
      return log.length < RATE_LIMIT_MAX_REQUESTS;
    }

    const baseTime = 1000000;

    // Fill up the limit
    for (let i = 0; i < 10; i++) {
      log.push(baseTime + i * 100);
    }

    // Should be blocked at baseTime + 1000
    expect(checkRateLimit(baseTime + 1000)).toBe(false);

    // Should be allowed after window expires
    expect(checkRateLimit(baseTime + RATE_LIMIT_WINDOW_MS + 1)).toBe(true);
  });

  it("should prune old entries from the log", () => {
    const RATE_LIMIT_WINDOW_MS = 60 * 1000;
    const log: number[] = [];

    function checkRateLimit(now: number): boolean {
      while (log.length > 0 && log[0] < now - RATE_LIMIT_WINDOW_MS) {
        log.shift();
      }
      return true; // just testing pruning
    }

    // Add 100 old entries
    for (let i = 0; i < 100; i++) {
      log.push(1000 + i);
    }

    expect(log.length).toBe(100);

    // Check at a time well after the window
    checkRateLimit(1000 + RATE_LIMIT_WINDOW_MS + 1000);

    // All old entries should be pruned
    expect(log.length).toBe(0);
  });
});

// ── Request Deduplication Tests ────────────────────────────────────

describe("Request Deduplication", () => {
  it("should deduplicate concurrent identical requests", async () => {
    const inflightRequests = new Map<string, Promise<any>>();
    let fetchCount = 0;

    async function fetchWithDedup(key: string): Promise<string> {
      const inflight = inflightRequests.get(key);
      if (inflight) return inflight;

      const promise = (async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return `result-${key}`;
      })();

      inflightRequests.set(key, promise);
      try {
        return await promise;
      } finally {
        inflightRequests.delete(key);
      }
    }

    // Fire 5 concurrent requests with the same key
    const results = await Promise.all([
      fetchWithDedup("key1"),
      fetchWithDedup("key1"),
      fetchWithDedup("key1"),
      fetchWithDedup("key1"),
      fetchWithDedup("key1"),
    ]);

    // All should get the same result
    expect(results.every((r) => r === "result-key1")).toBe(true);
    // But only 1 actual fetch should have occurred
    expect(fetchCount).toBe(1);
  });

  it("should not deduplicate different keys", async () => {
    const inflightRequests = new Map<string, Promise<any>>();
    let fetchCount = 0;

    async function fetchWithDedup(key: string): Promise<string> {
      const inflight = inflightRequests.get(key);
      if (inflight) return inflight;

      const promise = (async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 50));
        return `result-${key}`;
      })();

      inflightRequests.set(key, promise);
      try {
        return await promise;
      } finally {
        inflightRequests.delete(key);
      }
    }

    const results = await Promise.all([
      fetchWithDedup("key1"),
      fetchWithDedup("key2"),
      fetchWithDedup("key3"),
    ]);

    expect(results).toEqual(["result-key1", "result-key2", "result-key3"]);
    expect(fetchCount).toBe(3);
  });
});

// ── Cache Stats Tests ──────────────────────────────────────────────

describe("Cache Statistics", () => {
  it("should track cache hits and misses", () => {
    const CACHE_TTL_MS = 20 * 60 * 1000;
    const cache = new Map<string, { data: any; fetchedAt: number }>();
    let hits = 0;
    let misses = 0;

    function getCached(key: string): any | null {
      const entry = cache.get(key);
      if (!entry) {
        misses++;
        return null;
      }
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
        cache.delete(key);
        misses++;
        return null;
      }
      hits++;
      return entry.data;
    }

    // Miss
    getCached("key1");
    expect(misses).toBe(1);
    expect(hits).toBe(0);

    // Add to cache
    cache.set("key1", { data: "value1", fetchedAt: Date.now() });

    // Hit
    getCached("key1");
    expect(misses).toBe(1);
    expect(hits).toBe(1);

    // Hit rate
    const hitRate = Math.round((hits / (hits + misses)) * 100);
    expect(hitRate).toBe(50);
  });

  it("should use 20-minute TTL for cache entries", () => {
    const CACHE_TTL_MS = 20 * 60 * 1000;
    expect(CACHE_TTL_MS).toBe(1200000); // 20 minutes in ms

    // Entry created 19 minutes ago should be valid
    const fresh = { fetchedAt: Date.now() - 19 * 60 * 1000 };
    expect(Date.now() - fresh.fetchedAt < CACHE_TTL_MS).toBe(true);

    // Entry created 21 minutes ago should be expired
    const stale = { fetchedAt: Date.now() - 21 * 60 * 1000 };
    expect(Date.now() - stale.fetchedAt > CACHE_TTL_MS).toBe(true);
  });
});

// ── Heatmap Grid Aggregation Tests ─────────────────────────────────

describe("Heatmap Density Grid", () => {
  interface SlimEvent {
    lat: number;
    lng: number;
    best: number;
    type: number;
  }

  function aggregateToGrid(events: SlimEvent[], cellSize: number) {
    const grid = new Map<string, { lat: number; lng: number; count: number; fatalities: number }>();

    for (const evt of events) {
      const cellLat = Math.round(evt.lat / cellSize) * cellSize;
      const cellLng = Math.round(evt.lng / cellSize) * cellSize;
      const key = `${cellLat},${cellLng}`;
      const existing = grid.get(key);
      if (existing) {
        existing.count++;
        existing.fatalities += evt.best;
      } else {
        grid.set(key, { lat: cellLat, lng: cellLng, count: 1, fatalities: evt.best });
      }
    }

    return grid;
  }

  it("should aggregate nearby events into the same cell", () => {
    const events: SlimEvent[] = [
      { lat: 36.1, lng: 37.1, best: 5, type: 1 },
      { lat: 36.2, lng: 37.2, best: 10, type: 1 },
      { lat: 36.3, lng: 37.3, best: 3, type: 2 },
    ];

    const grid = aggregateToGrid(events, 0.5);

    // All three events are within 0.5° of each other, should be in same or adjacent cells
    expect(grid.size).toBeLessThanOrEqual(2);

    // Total fatalities should be preserved
    let totalFat = 0;
    for (const cell of Array.from(grid.values())) {
      totalFat += cell.fatalities;
    }
    expect(totalFat).toBe(18);
  });

  it("should separate distant events into different cells", () => {
    const events: SlimEvent[] = [
      { lat: 36.0, lng: 37.0, best: 5, type: 1 }, // Syria
      { lat: 9.0, lng: 7.5, best: 10, type: 2 },  // Nigeria
      { lat: 50.4, lng: 30.5, best: 8, type: 1 },  // Ukraine
    ];

    const grid = aggregateToGrid(events, 0.5);
    expect(grid.size).toBe(3);
  });

  it("should compute intensity with logarithmic scaling", () => {
    function computeIntensity(count: number, fatalities: number): number {
      return Math.log2(count + 1) + Math.log2(fatalities + 1) * 0.5;
    }

    // Low activity
    const low = computeIntensity(1, 5);
    // Medium activity
    const med = computeIntensity(10, 50);
    // High activity
    const high = computeIntensity(100, 500);

    expect(low).toBeLessThan(med);
    expect(med).toBeLessThan(high);

    // Logarithmic: doubling events shouldn't double intensity
    const i1 = computeIntensity(10, 100);
    const i2 = computeIntensity(20, 100);
    expect(i2 / i1).toBeLessThan(1.5);
  });
});
