import { describe, it, expect } from "vitest";

/**
 * Tests for FallbackMap utility functions.
 *
 * Since the FallbackMap component is a React component, we test the pure
 * utility functions (latLngToXY, clusterStations, getClusterGridSize)
 * by extracting the logic into testable units.
 *
 * We replicate the exact functions from FallbackMap.tsx here to validate
 * the core logic independently of React rendering.
 */

// ── Replicated utility functions from FallbackMap.tsx ──

function latLngToXY(
  lat: number,
  lng: number,
  width: number,
  height: number
): { x: number; y: number } {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

function getClusterGridSize(zoom: number): number {
  if (zoom >= 4) return 1;
  if (zoom >= 2) return 2;
  return 5;
}

const TYPE_COLORS: Record<string, string> = {
  OpenWebRX: "#06b6d4",
  WebSDR: "#ff6b6b",
  KiwiSDR: "#4ade80",
};

interface MinimalStation {
  label: string;
  location: { type: string; coordinates: [number, number] };
  receivers: { type: string; url: string; label: string }[];
}

interface ClusteredStation {
  lat: number;
  lng: number;
  stations: MinimalStation[];
  color: string;
  radius: number;
}

function clusterStations(
  stations: MinimalStation[],
  gridSize: number,
  isStationOnline?: (station: MinimalStation) => boolean | null
): ClusteredStation[] {
  if (stations.length <= 500 && gridSize <= 2) {
    return stations.map((s) => {
      const [lng, lat] = s.location.coordinates;
      const primaryType = s.receivers[0]?.type || "WebSDR";
      let color = TYPE_COLORS[primaryType] || TYPE_COLORS.WebSDR;

      if (isStationOnline) {
        const status = isStationOnline(s);
        if (status === true) color = "#22c55e";
        else if (status === false) color = "#ef4444";
      }

      return { lat, lng, stations: [s], color, radius: 3 };
    });
  }

  const grid = new Map<string, { lats: number[]; lngs: number[]; stations: MinimalStation[] }>();
  stations.forEach((s) => {
    const [lng, lat] = s.location.coordinates;
    const gridKey = `${Math.floor(lat / gridSize)},${Math.floor(lng / gridSize)}`;
    if (!grid.has(gridKey)) {
      grid.set(gridKey, { lats: [], lngs: [], stations: [] });
    }
    const cell = grid.get(gridKey)!;
    cell.lats.push(lat);
    cell.lngs.push(lng);
    cell.stations.push(s);
  });

  const clusters: ClusteredStation[] = [];
  grid.forEach((cell) => {
    const avgLat = cell.lats.reduce((a, b) => a + b, 0) / cell.lats.length;
    const avgLng = cell.lngs.reduce((a, b) => a + b, 0) / cell.lngs.length;

    const typeCounts: Record<string, number> = {};
    cell.stations.forEach((s) => {
      const t = s.receivers[0]?.type || "WebSDR";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const dominantType = Object.entries(typeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    let color = TYPE_COLORS[dominantType] || TYPE_COLORS.WebSDR;
    if (isStationOnline && cell.stations.length === 1) {
      const status = isStationOnline(cell.stations[0]);
      if (status === true) color = "#22c55e";
      else if (status === false) color = "#ef4444";
    }

    const radius = Math.min(8, 2 + Math.log2(cell.stations.length) * 1.5);

    clusters.push({
      lat: avgLat,
      lng: avgLng,
      stations: cell.stations,
      color,
      radius,
    });
  });

  return clusters;
}

// ── Helper to create test stations ──

function makeStation(
  label: string,
  lng: number,
  lat: number,
  type: string = "KiwiSDR"
): MinimalStation {
  return {
    label,
    location: { type: "Point", coordinates: [lng, lat] },
    receivers: [{ type, url: `http://${label}.example.com/`, label: `${label} receiver` }],
  };
}

// ── Tests ──

describe("latLngToXY — equirectangular projection", () => {
  const W = 960;
  const H = 480;

  it("maps (0, 0) to center of the map", () => {
    const { x, y } = latLngToXY(0, 0, W, H);
    expect(x).toBe(W / 2);
    expect(y).toBe(H / 2);
  });

  it("maps north pole (90, 0) to top center", () => {
    const { x, y } = latLngToXY(90, 0, W, H);
    expect(x).toBe(W / 2);
    expect(y).toBe(0);
  });

  it("maps south pole (-90, 0) to bottom center", () => {
    const { x, y } = latLngToXY(-90, 0, W, H);
    expect(x).toBe(W / 2);
    expect(y).toBe(H);
  });

  it("maps (-180 lng) to left edge", () => {
    const { x } = latLngToXY(0, -180, W, H);
    expect(x).toBe(0);
  });

  it("maps (180 lng) to right edge", () => {
    const { x } = latLngToXY(0, 180, W, H);
    expect(x).toBe(W);
  });

  it("maps New York (~40.7, -74.0) to correct quadrant (upper-left)", () => {
    const { x, y } = latLngToXY(40.7, -74.0, W, H);
    expect(x).toBeLessThan(W / 2); // West of center
    expect(y).toBeLessThan(H / 2); // North of equator
  });

  it("maps Tokyo (~35.7, 139.7) to correct quadrant (upper-right)", () => {
    const { x, y } = latLngToXY(35.7, 139.7, W, H);
    expect(x).toBeGreaterThan(W / 2); // East of center
    expect(y).toBeLessThan(H / 2); // North of equator
  });

  it("maps Sydney (~-33.9, 151.2) to correct quadrant (lower-right)", () => {
    const { x, y } = latLngToXY(-33.9, 151.2, W, H);
    expect(x).toBeGreaterThan(W / 2); // East of center
    expect(y).toBeGreaterThan(H / 2); // South of equator
  });
});

describe("getClusterGridSize — zoom-adaptive grid", () => {
  it("returns 5 at default zoom (1x)", () => {
    expect(getClusterGridSize(1)).toBe(5);
  });

  it("returns 2 at 2x zoom", () => {
    expect(getClusterGridSize(2)).toBe(2);
  });

  it("returns 2 at 3x zoom", () => {
    expect(getClusterGridSize(3)).toBe(2);
  });

  it("returns 1 at 4x zoom", () => {
    expect(getClusterGridSize(4)).toBe(1);
  });

  it("returns 1 at 8x zoom", () => {
    expect(getClusterGridSize(8)).toBe(1);
  });

  it("returns 5 at 0.5x zoom (zoomed out)", () => {
    expect(getClusterGridSize(0.5)).toBe(5);
  });
});

describe("clusterStations — station grouping", () => {
  it("returns individual stations when count <= 500 and gridSize <= 2", () => {
    const stations = [
      makeStation("A", 10, 50, "KiwiSDR"),
      makeStation("B", 20, 55, "OpenWebRX"),
    ];
    const result = clusterStations(stations, 2);
    expect(result).toHaveLength(2);
    expect(result[0].stations).toHaveLength(1);
    expect(result[1].stations).toHaveLength(1);
  });

  it("clusters nearby stations with gridSize 5", () => {
    // Two stations in the same 5-degree grid cell
    const stations = [
      makeStation("A", 10.1, 50.1, "KiwiSDR"),
      makeStation("B", 10.2, 50.2, "KiwiSDR"),
    ];
    const result = clusterStations(stations, 5);
    // Both should be in the same cluster (same 5-degree grid cell)
    expect(result).toHaveLength(1);
    expect(result[0].stations).toHaveLength(2);
  });

  it("separates stations in different grid cells", () => {
    // Two stations far apart
    const stations = [
      makeStation("A", 10, 50, "KiwiSDR"),
      makeStation("B", 100, -30, "OpenWebRX"),
    ];
    const result = clusterStations(stations, 5);
    expect(result).toHaveLength(2);
    expect(result[0].stations).toHaveLength(1);
    expect(result[1].stations).toHaveLength(1);
  });

  it("uses dominant type color for multi-station clusters", () => {
    const stations = [
      makeStation("A", 10.1, 50.1, "KiwiSDR"),
      makeStation("B", 10.2, 50.2, "KiwiSDR"),
      makeStation("C", 10.3, 50.3, "OpenWebRX"),
    ];
    const result = clusterStations(stations, 5);
    expect(result).toHaveLength(1);
    // KiwiSDR is dominant (2 vs 1)
    expect(result[0].color).toBe(TYPE_COLORS.KiwiSDR);
  });

  it("uses online/offline color for single stations when isStationOnline provided", () => {
    const stations = [makeStation("A", 10, 50, "KiwiSDR")];
    const isOnline = () => true;
    const result = clusterStations(stations, 2, isOnline);
    expect(result[0].color).toBe("#22c55e"); // STATUS_ONLINE
  });

  it("uses offline color for offline single stations", () => {
    const stations = [makeStation("A", 10, 50, "KiwiSDR")];
    const isOnline = () => false;
    const result = clusterStations(stations, 2, isOnline);
    expect(result[0].color).toBe("#ef4444"); // STATUS_OFFLINE
  });

  it("uses type color when status is null (unknown)", () => {
    const stations = [makeStation("A", 10, 50, "KiwiSDR")];
    const isOnline = () => null;
    const result = clusterStations(stations, 2, isOnline);
    expect(result[0].color).toBe(TYPE_COLORS.KiwiSDR);
  });

  it("computes cluster center as average of member coordinates", () => {
    const stations = [
      makeStation("A", 10, 50, "KiwiSDR"),
      makeStation("B", 12, 52, "KiwiSDR"),
    ];
    const result = clusterStations(stations, 5);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBeCloseTo(51, 0);
    expect(result[0].lng).toBeCloseTo(11, 0);
  });

  it("scales cluster radius with station count (logarithmic)", () => {
    // Create a large cluster
    const stations = Array.from({ length: 20 }, (_, i) =>
      makeStation(`S${i}`, 10 + i * 0.01, 50 + i * 0.01, "KiwiSDR")
    );
    const result = clusterStations(stations, 5);
    expect(result).toHaveLength(1);
    // radius = min(8, 2 + log2(20) * 1.5) ≈ 2 + 4.32 * 1.5 ≈ 8.48 → capped at 8
    expect(result[0].radius).toBeLessThanOrEqual(8);
    expect(result[0].radius).toBeGreaterThan(3);
  });

  it("single station cluster has radius 3", () => {
    const stations = [makeStation("A", 10, 50, "KiwiSDR")];
    const result = clusterStations(stations, 2);
    expect(result[0].radius).toBe(3);
  });

  it("handles empty station array", () => {
    const result = clusterStations([], 5);
    expect(result).toHaveLength(0);
  });
});

describe("cluster interaction logic", () => {
  it("single-station cluster should trigger direct selection", () => {
    const station = makeStation("TestStation", 10, 50, "KiwiSDR");
    const cluster: ClusteredStation = {
      lat: 50,
      lng: 10,
      stations: [station],
      color: "#4ade80",
      radius: 3,
    };
    // Simulate the click handler logic
    const shouldShowPicker = cluster.stations.length > 1;
    expect(shouldShowPicker).toBe(false);
    expect(cluster.stations[0].label).toBe("TestStation");
  });

  it("multi-station cluster should show picker", () => {
    const stationA = makeStation("StationA", 10.1, 50.1, "KiwiSDR");
    const stationB = makeStation("StationB", 10.2, 50.2, "OpenWebRX");
    const cluster: ClusteredStation = {
      lat: 50.15,
      lng: 10.15,
      stations: [stationA, stationB],
      color: "#4ade80",
      radius: 4,
    };
    const shouldShowPicker = cluster.stations.length > 1;
    expect(shouldShowPicker).toBe(true);
    expect(cluster.stations).toHaveLength(2);
  });

  it("selected station can be found in clusters by label and coordinates", () => {
    const stations = [
      makeStation("Alpha", 10, 50, "KiwiSDR"),
      makeStation("Beta", 20, 55, "OpenWebRX"),
      makeStation("Gamma", 100, -30, "WebSDR"),
    ];
    const clusters = clusterStations(stations, 2);
    const selectedStation = stations[1]; // Beta

    const selectedIdx = clusters.findIndex((c) =>
      c.stations.some(
        (s) =>
          s.label === selectedStation.label &&
          s.location.coordinates[0] === selectedStation.location.coordinates[0] &&
          s.location.coordinates[1] === selectedStation.location.coordinates[1]
      )
    );

    expect(selectedIdx).toBe(1);
    expect(clusters[selectedIdx].stations[0].label).toBe("Beta");
  });

  it("returns -1 when selected station is not in clusters", () => {
    const stations = [makeStation("Alpha", 10, 50, "KiwiSDR")];
    const clusters = clusterStations(stations, 2);
    const missingStation = makeStation("Missing", 99, 99, "WebSDR");

    const selectedIdx = clusters.findIndex((c) =>
      c.stations.some(
        (s) =>
          s.label === missingStation.label &&
          s.location.coordinates[0] === missingStation.location.coordinates[0] &&
          s.location.coordinates[1] === missingStation.location.coordinates[1]
      )
    );

    expect(selectedIdx).toBe(-1);
  });
});

describe("zoom-dependent clustering behavior", () => {
  it("at zoom 1 (gridSize 5), nearby stations cluster together", () => {
    const gridSize = getClusterGridSize(1);
    expect(gridSize).toBe(5);
    // Stations within 5 degrees should cluster
    const stations = Array.from({ length: 600 }, (_, i) =>
      makeStation(`S${i}`, 10 + (i % 5) * 0.5, 50 + Math.floor(i / 5) * 0.5, "KiwiSDR")
    );
    const clusters = clusterStations(stations, gridSize);
    expect(clusters.length).toBeLessThan(stations.length);
  });

  it("at zoom 4 (gridSize 1), stations are more spread out", () => {
    const gridSize = getClusterGridSize(4);
    expect(gridSize).toBe(1);
    // Stations 2 degrees apart should be in different clusters
    const stations = [
      makeStation("A", 10, 50, "KiwiSDR"),
      makeStation("B", 12, 52, "KiwiSDR"),
    ];
    const clusters = clusterStations(stations, gridSize);
    expect(clusters).toHaveLength(2);
  });
});
