import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  gridToLatLon,
  normalizeUrl,
  mergeStations,
  type DirectoryStation,
} from "./directoryAggregator";

/* ── gridToLatLon tests ──────────────────────────────── */

describe("gridToLatLon", () => {
  it("returns null for empty or short strings", () => {
    expect(gridToLatLon("")).toBeNull();
    expect(gridToLatLon("JO")).toBeNull();
    expect(gridToLatLon("J")).toBeNull();
  });

  it("converts a 4-char grid locator to approximate lat/lon", () => {
    // JO32 → field J=9, O=14; square 3,2
    // lon = 9*20 + 3*2 - 180 + 1 = 180+6-180+1 = 7
    // lat = 14*10 + 2*1 - 90 + 0.5 = 140+2-90+0.5 = 52.5
    const result = gridToLatLon("JO32");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(52.5, 0);
    expect(result!.lon).toBeCloseTo(7, 0);
  });

  it("converts a 6-char grid locator (JO32KF) to lat/lon", () => {
    const result = gridToLatLon("JO32KF");
    expect(result).not.toBeNull();
    // Should be near Enschede, Netherlands (~52.2°N, 6.9°E)
    expect(result!.lat).toBeGreaterThan(50);
    expect(result!.lat).toBeLessThan(54);
    expect(result!.lon).toBeGreaterThan(5);
    expect(result!.lon).toBeLessThan(9);
  });

  it("handles FN31 (New York area)", () => {
    const result = gridToLatLon("FN31");
    expect(result).not.toBeNull();
    // FN31 → lon = 5*20+3*2-180+1 = -73, lat = 13*10+1-90+0.5 = 41.5
    expect(result!.lat).toBeCloseTo(41.5, 0);
    expect(result!.lon).toBeCloseTo(-73, 0);
  });

  it("is case-insensitive", () => {
    const upper = gridToLatLon("JO32KF");
    const lower = gridToLatLon("jo32kf");
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper!.lat).toBeCloseTo(lower!.lat, 5);
    expect(upper!.lon).toBeCloseTo(lower!.lon, 5);
  });

  it("returns null for invalid characters", () => {
    expect(gridToLatLon("ZZ99")).toBeNull(); // Z > R
  });
});

/* ── normalizeUrl tests ──────────────────────────────── */

describe("normalizeUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeUrl("http://example.com/")).toBe("example.com");
    expect(normalizeUrl("http://example.com///")).toBe("example.com");
  });

  it("strips protocol", () => {
    expect(normalizeUrl("https://example.com")).toBe("example.com");
    expect(normalizeUrl("http://example.com")).toBe("example.com");
  });

  it("removes default port 80", () => {
    expect(normalizeUrl("http://example.com:80")).toBe("example.com");
  });

  it("preserves non-default ports", () => {
    expect(normalizeUrl("http://example.com:8073")).toBe("example.com:8073");
  });

  it("lowercases the URL", () => {
    expect(normalizeUrl("HTTP://EXAMPLE.COM:8073/")).toBe("example.com:8073");
  });
});

/* ── mergeStations tests ─────────────────────────────── */

describe("mergeStations", () => {
  const makeStation = (
    label: string,
    url: string,
    type: "KiwiSDR" | "OpenWebRX" | "WebSDR" = "KiwiSDR",
    source = "static"
  ): DirectoryStation => ({
    label,
    location: { coordinates: [0, 0], type: "Point" },
    receivers: [{ label, url, type }],
    source,
  });

  it("returns existing stations when no new sources", () => {
    const existing = [makeStation("A", "http://a.com:8073")];
    const result = mergeStations(existing);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("A");
  });

  it("adds non-duplicate stations from new sources", () => {
    const existing = [makeStation("A", "http://a.com:8073")];
    const newStations = [makeStation("B", "http://b.com:8073", "KiwiSDR", "kiwisdr-gps")];
    const result = mergeStations(existing, newStations);
    expect(result).toHaveLength(2);
  });

  it("deduplicates by normalized URL", () => {
    const existing = [makeStation("A", "http://a.com:8073/")];
    const newStations = [makeStation("A copy", "http://a.com:8073", "KiwiSDR", "kiwisdr-gps")];
    const result = mergeStations(existing, newStations);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("A"); // existing takes priority
  });

  it("deduplicates across multiple new sources", () => {
    const existing = [makeStation("A", "http://a.com:8073")];
    const source1 = [
      makeStation("B", "http://b.com:8073", "KiwiSDR", "kiwisdr-gps"),
      makeStation("C", "http://c.com:8073", "KiwiSDR", "kiwisdr-gps"),
    ];
    const source2 = [
      makeStation("B dup", "http://b.com:8073", "WebSDR", "websdr-org"),
      makeStation("D", "http://d.com:8073", "WebSDR", "websdr-org"),
    ];
    const result = mergeStations(existing, source1, source2);
    expect(result).toHaveLength(4); // A, B, C, D
    // B should be from source1 (first seen)
    expect(result.find((s) => normalizeUrl(s.receivers[0].url) === "b.com:8073")?.label).toBe("B");
  });

  it("handles protocol differences in dedup", () => {
    const existing = [makeStation("A", "https://a.com:8073")];
    const newStations = [makeStation("A http", "http://a.com:8073", "KiwiSDR", "kiwisdr-gps")];
    const result = mergeStations(existing, newStations);
    expect(result).toHaveLength(1); // Same after normalization
  });

  it("handles empty inputs", () => {
    expect(mergeStations([])).toHaveLength(0);
    expect(mergeStations([], [])).toHaveLength(0);
    expect(mergeStations([], [makeStation("A", "http://a.com")])).toHaveLength(1);
  });
});
