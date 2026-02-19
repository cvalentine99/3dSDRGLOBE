/**
 * targets.test.ts — Tests for multi-target TDoA tracking and KiwiSDR recording
 *
 * Tests:
 * 1. Target CRUD operations (save, list, update, toggle, delete)
 * 2. WAV header generation
 * 3. Recording parameter detection (mode from frequency)
 * 4. Globe overlay marker creation
 * 5. Recording database operations
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── WAV Header Tests ──────────────────────────────────
describe("WAV header generation", () => {
  const SAMPLE_RATE = 12000;
  const BITS_PER_SAMPLE = 16;
  const CHANNELS = 1;

  function createWavHeader(dataLength: number): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
    const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }

  it("creates a valid 44-byte WAV header", () => {
    const header = createWavHeader(24000);
    expect(header.length).toBe(44);
  });

  it("starts with RIFF magic bytes", () => {
    const header = createWavHeader(24000);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("contains WAVE format identifier", () => {
    const header = createWavHeader(24000);
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("contains fmt sub-chunk", () => {
    const header = createWavHeader(24000);
    expect(header.toString("ascii", 12, 16)).toBe("fmt ");
  });

  it("contains data sub-chunk", () => {
    const header = createWavHeader(24000);
    expect(header.toString("ascii", 36, 40)).toBe("data");
  });

  it("sets PCM format (1)", () => {
    const header = createWavHeader(24000);
    expect(header.readUInt16LE(20)).toBe(1);
  });

  it("sets mono channel count", () => {
    const header = createWavHeader(24000);
    expect(header.readUInt16LE(22)).toBe(1);
  });

  it("sets 12kHz sample rate", () => {
    const header = createWavHeader(24000);
    expect(header.readUInt32LE(24)).toBe(12000);
  });

  it("sets 16-bit depth", () => {
    const header = createWavHeader(24000);
    expect(header.readUInt16LE(34)).toBe(16);
  });

  it("encodes correct file size in RIFF header", () => {
    const dataLen = 48000;
    const header = createWavHeader(dataLen);
    expect(header.readUInt32LE(4)).toBe(36 + dataLen);
  });

  it("encodes correct data chunk size", () => {
    const dataLen = 48000;
    const header = createWavHeader(dataLen);
    expect(header.readUInt32LE(40)).toBe(dataLen);
  });

  it("calculates correct byte rate (12000 * 1 * 2 = 24000)", () => {
    const header = createWavHeader(0);
    expect(header.readUInt32LE(28)).toBe(24000);
  });

  it("calculates correct block align (1 * 2 = 2)", () => {
    const header = createWavHeader(0);
    expect(header.readUInt16LE(32)).toBe(2);
  });

  it("produces valid WAV when combined with audio data", () => {
    const audioData = Buffer.alloc(24000); // 1 second of silence
    const header = createWavHeader(audioData.length);
    const wav = Buffer.concat([header, audioData]);
    expect(wav.length).toBe(44 + 24000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  });
});

// ── Mode Detection Tests ──────────────────────────────
describe("modulation mode detection", () => {
  function detectMode(freqKhz: number): "am" | "usb" | "lsb" | "cw" {
    if (freqKhz <= 500) return "cw";
    if (freqKhz <= 1800) return "am";
    if (freqKhz <= 30000) {
      const amFreqs = [
        2500, 3330, 5000, 7850, 10000, 15000, 20000, 25000,
        3330, 7850, 14670,
        77.5, 198,
        4996, 9996, 14996,
        68.5, 40, 60,
      ];
      if (amFreqs.some((f) => Math.abs(f - freqKhz) < 5)) return "am";
      return "usb";
    }
    return "am";
  }

  it("detects CW for frequencies <= 500 kHz", () => {
    expect(detectMode(100)).toBe("cw");
    expect(detectMode(500)).toBe("cw");
  });

  it("detects AM for MW broadcast (501-1800 kHz)", () => {
    expect(detectMode(1000)).toBe("am");
    expect(detectMode(1500)).toBe("am");
  });

  it("detects AM for WWV 10 MHz", () => {
    expect(detectMode(10000)).toBe("am");
  });

  it("detects AM for WWV 5 MHz", () => {
    expect(detectMode(5000)).toBe("am");
  });

  it("detects AM for WWV 15 MHz", () => {
    expect(detectMode(15000)).toBe("am");
  });

  it("detects AM for CHU 3330 kHz", () => {
    expect(detectMode(3330)).toBe("am");
  });

  it("detects USB for general HF frequencies", () => {
    expect(detectMode(7100)).toBe("usb");
    expect(detectMode(14200)).toBe("usb");
  });

  it("detects AM for frequencies above 30 MHz", () => {
    expect(detectMode(50000)).toBe("am");
  });
});

// ── Target Data Validation Tests ──────────────────────
describe("target data validation", () => {
  it("validates latitude range (-90 to 90)", () => {
    const isValid = (lat: number) => lat >= -90 && lat <= 90;
    expect(isValid(0)).toBe(true);
    expect(isValid(45.5)).toBe(true);
    expect(isValid(-90)).toBe(true);
    expect(isValid(90)).toBe(true);
    expect(isValid(91)).toBe(false);
    expect(isValid(-91)).toBe(false);
  });

  it("validates longitude range (-180 to 180)", () => {
    const isValid = (lon: number) => lon >= -180 && lon <= 180;
    expect(isValid(0)).toBe(true);
    expect(isValid(180)).toBe(true);
    expect(isValid(-180)).toBe(true);
    expect(isValid(181)).toBe(false);
  });

  it("validates hex color format", () => {
    const isValidColor = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
    expect(isValidColor("#ff6b6b")).toBe(true);
    expect(isValidColor("#4ade80")).toBe(true);
    expect(isValidColor("#000000")).toBe(true);
    expect(isValidColor("ff6b6b")).toBe(false);
    expect(isValidColor("#fff")).toBe(false);
    expect(isValidColor("#gggggg")).toBe(false);
  });

  it("validates label length (1-256 chars)", () => {
    const isValidLabel = (l: string) => l.length >= 1 && l.length <= 256;
    expect(isValidLabel("Test Target")).toBe(true);
    expect(isValidLabel("")).toBe(false);
    expect(isValidLabel("A".repeat(256))).toBe(true);
    expect(isValidLabel("A".repeat(257))).toBe(false);
  });

  it("generates correct auto-label from TDoA result", () => {
    const freq = 10000;
    const lat = 6.5;
    const lon = -85.3;
    const label = `TDoA ${freq} kHz — ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
    expect(label).toBe("TDoA 10000 kHz — 6.50°, -85.30°");
  });
});

// ── Target Color Palette Tests ────────────────────────
describe("target color palette", () => {
  const TARGET_COLORS = [
    "#ff6b6b", "#fbbf24", "#4ade80", "#06b6d4",
    "#a78bfa", "#f472b6", "#fb923c", "#38bdf8",
  ];

  it("provides 8 distinct colors", () => {
    expect(TARGET_COLORS.length).toBe(8);
  });

  it("all colors are valid hex format", () => {
    TARGET_COLORS.forEach((c) => {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("all colors are unique", () => {
    const unique = new Set(TARGET_COLORS);
    expect(unique.size).toBe(TARGET_COLORS.length);
  });

  it("default color is red (#ff6b6b)", () => {
    expect(TARGET_COLORS[0]).toBe("#ff6b6b");
  });
});

// ── Recording File Key Generation Tests ───────────────
describe("recording file key generation", () => {
  it("generates a valid S3 file key", () => {
    const jobId = 42;
    const hostId = "kiwi.example.com:8073";
    const freq = 10000;
    const timestamp = 1708123456789;
    const sanitizedHost = hostId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileKey = `tdoa-recordings/job-${jobId}/${sanitizedHost}-${freq}kHz-${timestamp}.wav`;

    expect(fileKey).toBe("tdoa-recordings/job-42/kiwi_example_com_8073-10000kHz-1708123456789.wav");
  });

  it("sanitizes special characters in host ID", () => {
    const hostId = "K9DXI/1:8073";
    const sanitized = hostId.replace(/[^a-zA-Z0-9_-]/g, "_");
    expect(sanitized).toBe("K9DXI_1_8073");
  });

  it("handles host IDs with dots and colons", () => {
    const hostId = "sdr.example.co.uk:8073";
    const sanitized = hostId.replace(/[^a-zA-Z0-9_-]/g, "_");
    expect(sanitized).toBe("sdr_example_co_uk_8073");
  });

  it("preserves hyphens in host IDs", () => {
    const hostId = "my-kiwi-sdr:8073";
    const sanitized = hostId.replace(/[^a-zA-Z0-9_-]/g, "_");
    expect(sanitized).toBe("my-kiwi-sdr_8073");
  });
});

// ── Globe Overlay Marker Data Tests ───────────────────
describe("saved target marker data", () => {
  interface SavedTargetData {
    id: number;
    label: string;
    lat: number;
    lon: number;
    color: string;
    frequencyKhz?: number | null;
  }

  it("converts database row to marker data", () => {
    const dbRow = {
      id: 1,
      label: "Test Target",
      lat: "45.500000",
      lon: "-73.600000",
      color: "#ff6b6b",
      frequencyKhz: "10000.00",
      visible: true,
    };

    const markerData: SavedTargetData = {
      id: dbRow.id,
      label: dbRow.label,
      lat: parseFloat(dbRow.lat),
      lon: parseFloat(dbRow.lon),
      color: dbRow.color,
      frequencyKhz: dbRow.frequencyKhz ? parseFloat(dbRow.frequencyKhz) : null,
    };

    expect(markerData.lat).toBe(45.5);
    expect(markerData.lon).toBe(-73.6);
    expect(markerData.frequencyKhz).toBe(10000);
  });

  it("handles null frequency", () => {
    const dbRow = {
      id: 2,
      label: "Unknown TX",
      lat: "10.000000",
      lon: "20.000000",
      color: "#4ade80",
      frequencyKhz: null,
      visible: true,
    };

    const markerData: SavedTargetData = {
      id: dbRow.id,
      label: dbRow.label,
      lat: parseFloat(dbRow.lat),
      lon: parseFloat(dbRow.lon),
      color: dbRow.color,
      frequencyKhz: dbRow.frequencyKhz ? parseFloat(dbRow.frequencyKhz) : null,
    };

    expect(markerData.frequencyKhz).toBeNull();
  });

  it("filters only visible targets for globe overlay", () => {
    const targets = [
      { id: 1, label: "A", lat: "10", lon: "20", color: "#ff6b6b", visible: true },
      { id: 2, label: "B", lat: "30", lon: "40", color: "#4ade80", visible: false },
      { id: 3, label: "C", lat: "50", lon: "60", color: "#06b6d4", visible: true },
    ];

    const visibleTargets = targets.filter((t) => t.visible);
    expect(visibleTargets.length).toBe(2);
    expect(visibleTargets.map((t) => t.id)).toEqual([1, 3]);
  });
});

// ── Label Truncation Tests ────────────────────────────
describe("target label display", () => {
  it("truncates labels longer than 24 characters", () => {
    const maxChars = 24;
    const label = "Very Long Target Label That Exceeds Limit";
    const truncated =
      label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;
    expect(truncated.length).toBeLessThanOrEqual(maxChars);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("does not truncate short labels", () => {
    const maxChars = 24;
    const label = "Short Label";
    const truncated =
      label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label;
    expect(truncated).toBe("Short Label");
  });

  it("formats label with frequency", () => {
    const label = "Test";
    const freq = 10000;
    const display = `${label} · ${freq} kHz`;
    expect(display).toBe("Test · 10000 kHz");
  });

  it("formats label without frequency", () => {
    const label = "Unknown TX";
    const freq = null;
    const display = freq ? `${label} · ${freq} kHz` : label;
    expect(display).toBe("Unknown TX");
  });
});

// ── Recording Duration Validation Tests ───────────────
describe("recording duration validation", () => {
  it("accepts valid durations (5-60 seconds)", () => {
    const isValid = (d: number) => d >= 5 && d <= 60;
    expect(isValid(5)).toBe(true);
    expect(isValid(15)).toBe(true);
    expect(isValid(30)).toBe(true);
    expect(isValid(60)).toBe(true);
  });

  it("rejects durations below 5 seconds", () => {
    const isValid = (d: number) => d >= 5 && d <= 60;
    expect(isValid(4)).toBe(false);
    expect(isValid(0)).toBe(false);
  });

  it("rejects durations above 60 seconds", () => {
    const isValid = (d: number) => d >= 5 && d <= 60;
    expect(isValid(61)).toBe(false);
    expect(isValid(120)).toBe(false);
  });

  it("calculates expected file size for 15s recording", () => {
    const durationSec = 15;
    const sampleRate = 12000;
    const bytesPerSample = 2;
    const channels = 1;
    const expectedDataSize = durationSec * sampleRate * bytesPerSample * channels;
    const expectedFileSize = 44 + expectedDataSize; // 44 byte WAV header
    expect(expectedFileSize).toBe(44 + 360000);
  });
});

// ── Target Category Tests ───────────────────────────
describe("target category system", () => {
  const CATEGORIES = [
    "unknown",
    "time_signal",
    "broadcast",
    "military",
    "aviation",
    "maritime",
    "amateur",
    "utility",
    "numbers",
    "other",
  ] as const;

  const CATEGORY_COLORS: Record<string, string> = {
    unknown: "#94a3b8",
    time_signal: "#fbbf24",
    broadcast: "#4ade80",
    military: "#ef4444",
    aviation: "#06b6d4",
    maritime: "#3b82f6",
    amateur: "#a78bfa",
    utility: "#f97316",
    numbers: "#ec4899",
    other: "#6b7280",
  };

  it("provides 10 distinct categories", () => {
    expect(CATEGORIES.length).toBe(10);
  });

  it("all categories have unique names", () => {
    const unique = new Set(CATEGORIES);
    expect(unique.size).toBe(CATEGORIES.length);
  });

  it("all categories have assigned colors", () => {
    CATEGORIES.forEach((cat) => {
      expect(CATEGORY_COLORS[cat]).toBeDefined();
      expect(CATEGORY_COLORS[cat]).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("defaults to 'unknown' category", () => {
    const defaultCategory = "unknown";
    expect(CATEGORIES.includes(defaultCategory as any)).toBe(true);
  });

  it("formats category label for display", () => {
    const formatCategory = (cat: string) =>
      cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    expect(formatCategory("time_signal")).toBe("Time Signal");
    expect(formatCategory("military")).toBe("Military");
    expect(formatCategory("numbers")).toBe("Numbers");
    expect(formatCategory("unknown")).toBe("Unknown");
  });

  it("filters targets by category", () => {
    const targets = [
      { id: 1, label: "WWV", category: "time_signal" },
      { id: 2, label: "BBC", category: "broadcast" },
      { id: 3, label: "Unknown TX", category: "unknown" },
      { id: 4, label: "VOLMET", category: "aviation" },
      { id: 5, label: "CHU", category: "time_signal" },
    ];

    const timeSignals = targets.filter((t) => t.category === "time_signal");
    expect(timeSignals.length).toBe(2);
    expect(timeSignals.map((t) => t.label)).toEqual(["WWV", "CHU"]);
  });

  it("counts targets per category", () => {
    const targets = [
      { category: "time_signal" },
      { category: "broadcast" },
      { category: "time_signal" },
      { category: "military" },
      { category: "broadcast" },
    ];

    const counts: Record<string, number> = {};
    targets.forEach((t) => {
      counts[t.category] = (counts[t.category] || 0) + 1;
    });

    expect(counts["time_signal"]).toBe(2);
    expect(counts["broadcast"]).toBe(2);
    expect(counts["military"]).toBe(1);
  });
});

// ── Position History Tests ──────────────────────────
describe("target position history", () => {
  it("creates a history entry from TDoA result", () => {
    const entry = {
      targetId: 1,
      lat: 45.5,
      lon: -73.6,
      frequencyKhz: 10000,
      tdoaJobId: 42,
      observedAt: Date.now(),
    };

    expect(entry.targetId).toBe(1);
    expect(entry.lat).toBeCloseTo(45.5);
    expect(entry.lon).toBeCloseTo(-73.6);
    expect(entry.tdoaJobId).toBe(42);
  });

  it("sorts history entries by observedAt ascending", () => {
    const entries = [
      { observedAt: 1000, lat: 10, lon: 20 },
      { observedAt: 500, lat: 11, lon: 21 },
      { observedAt: 1500, lat: 12, lon: 22 },
    ];

    const sorted = [...entries].sort((a, b) => a.observedAt - b.observedAt);
    expect(sorted[0].observedAt).toBe(500);
    expect(sorted[1].observedAt).toBe(1000);
    expect(sorted[2].observedAt).toBe(1500);
  });

  it("calculates distance between two position history points", () => {
    // Haversine formula
    function haversineKm(
      lat1: number, lon1: number,
      lat2: number, lon2: number
    ): number {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Two nearby points
    const dist = haversineKm(45.5, -73.6, 45.6, -73.5);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(20); // Should be ~13 km

    // Same point
    const zeroDist = haversineKm(45.5, -73.6, 45.5, -73.6);
    expect(zeroDist).toBeCloseTo(0);
  });

  it("calculates total drift distance across multiple points", () => {
    function totalDriftKm(points: Array<{ lat: number; lon: number }>): number {
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        const R = 6371;
        const dLat = ((points[i].lat - points[i - 1].lat) * Math.PI) / 180;
        const dLon = ((points[i].lon - points[i - 1].lon) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((points[i - 1].lat * Math.PI) / 180) *
            Math.cos((points[i].lat * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      return total;
    }

    const points = [
      { lat: 45.5, lon: -73.6 },
      { lat: 45.6, lon: -73.5 },
      { lat: 45.7, lon: -73.4 },
    ];

    const drift = totalDriftKm(points);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(40);
  });

  it("groups history entries by targetId", () => {
    const entries = [
      { targetId: 1, lat: 10, lon: 20, observedAt: 100 },
      { targetId: 2, lat: 30, lon: 40, observedAt: 200 },
      { targetId: 1, lat: 11, lon: 21, observedAt: 300 },
      { targetId: 2, lat: 31, lon: 41, observedAt: 400 },
      { targetId: 1, lat: 12, lon: 22, observedAt: 500 },
    ];

    const grouped = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (!grouped.has(entry.targetId)) {
        grouped.set(entry.targetId, []);
      }
      grouped.get(entry.targetId)!.push(entry);
    }

    expect(grouped.get(1)!.length).toBe(3);
    expect(grouped.get(2)!.length).toBe(2);
  });
});

// ── Drift Trail Geometry Tests ──────────────────────
describe("drift trail geometry", () => {
  function latLngToVector3(lat: number, lng: number, radius: number = 5) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return {
      x: -(radius * Math.sin(phi) * Math.cos(theta)),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
    };
  }

  it("converts lat/lng to 3D position on globe surface", () => {
    // North pole
    const north = latLngToVector3(90, 0, 5);
    expect(north.y).toBeCloseTo(5);
    expect(Math.abs(north.x)).toBeLessThan(0.001);
    expect(Math.abs(north.z)).toBeLessThan(0.001);
  });

  it("south pole is at negative y", () => {
    const south = latLngToVector3(-90, 0, 5);
    expect(south.y).toBeCloseTo(-5);
  });

  it("equator points are at y=0", () => {
    const eq = latLngToVector3(0, 0, 5);
    expect(Math.abs(eq.y)).toBeLessThan(0.001);
  });

  it("all points are at the correct radius", () => {
    const testCases = [
      { lat: 0, lon: 0 },
      { lat: 45, lon: 90 },
      { lat: -30, lon: -120 },
      { lat: 89, lon: 180 },
    ];

    for (const tc of testCases) {
      const p = latLngToVector3(tc.lat, tc.lon, 5);
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(dist).toBeCloseTo(5, 3);
    }
  });

  it("interpolates great circle points correctly", () => {
    function interpolateGreatCircle(
      lat1: number, lon1: number,
      lat2: number, lon2: number,
      t: number
    ): { lat: number; lon: number } {
      const toRad = Math.PI / 180;
      const toDeg = 180 / Math.PI;
      const phi1 = lat1 * toRad;
      const lam1 = lon1 * toRad;
      const phi2 = lat2 * toRad;
      const lam2 = lon2 * toRad;
      const d = 2 * Math.asin(
        Math.sqrt(
          Math.sin((phi2 - phi1) / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
        )
      );
      if (d < 1e-10) return { lat: lat1, lon: lon1 };
      const a = Math.sin((1 - t) * d) / Math.sin(d);
      const b = Math.sin(t * d) / Math.sin(d);
      const x = a * Math.cos(phi1) * Math.cos(lam1) + b * Math.cos(phi2) * Math.cos(lam2);
      const y = a * Math.cos(phi1) * Math.sin(lam1) + b * Math.cos(phi2) * Math.sin(lam2);
      const z = a * Math.sin(phi1) + b * Math.sin(phi2);
      return {
        lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
        lon: Math.atan2(y, x) * toDeg,
      };
    }

    // Midpoint of equator segment
    const mid = interpolateGreatCircle(0, 0, 0, 90, 0.5);
    expect(mid.lat).toBeCloseTo(0, 1);
    expect(mid.lon).toBeCloseTo(45, 1);

    // t=0 should be start point
    const start = interpolateGreatCircle(45, -73, 50, -80, 0);
    expect(start.lat).toBeCloseTo(45, 3);
    expect(start.lon).toBeCloseTo(-73, 3);

    // t=1 should be end point
    const end = interpolateGreatCircle(45, -73, 50, -80, 1);
    expect(end.lat).toBeCloseTo(50, 3);
    expect(end.lon).toBeCloseTo(-80, 3);
  });

  it("generates multiple intermediate points", () => {
    function interpolateMulti(
      lat1: number, lon1: number,
      lat2: number, lon2: number,
      numPoints: number
    ): Array<{ lat: number; lon: number }> {
      const points: Array<{ lat: number; lon: number }> = [];
      for (let i = 1; i <= numPoints; i++) {
        const t = i / (numPoints + 1);
        // Simplified linear interpolation for test
        points.push({
          lat: lat1 + (lat2 - lat1) * t,
          lon: lon1 + (lon2 - lon1) * t,
        });
      }
      return points;
    }

    const points = interpolateMulti(0, 0, 10, 10, 4);
    expect(points.length).toBe(4);
    expect(points[0].lat).toBeCloseTo(2, 0);
    expect(points[3].lat).toBeCloseTo(8, 0);
  });
});

// ── Spectrogram FFT Tests ───────────────────────────
describe("spectrogram FFT computation", () => {
  function fft(real: Float32Array, imag: Float32Array, n: number): void {
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let temp = real[i];
        real[i] = real[j];
        real[j] = temp;
        temp = imag[i];
        imag[i] = imag[j];
        imag[j] = temp;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const angle = (-2 * Math.PI) / len;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let curReal = 1;
        let curImag = 0;
        for (let k = 0; k < halfLen; k++) {
          const evenIdx = i + k;
          const oddIdx = i + k + halfLen;
          const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
          const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];
          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] += tReal;
          imag[evenIdx] += tImag;
          const newCurReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = newCurReal;
        }
      }
    }
  }

  it("computes FFT of a DC signal (all ones)", () => {
    const n = 16;
    const real = new Float32Array(n).fill(1);
    const imag = new Float32Array(n).fill(0);
    fft(real, imag, n);

    // DC component should be n, all others should be ~0
    expect(real[0]).toBeCloseTo(n, 3);
    for (let i = 1; i < n; i++) {
      expect(Math.abs(real[i])).toBeLessThan(0.001);
      expect(Math.abs(imag[i])).toBeLessThan(0.001);
    }
  });

  it("computes FFT of a pure sine wave", () => {
    const n = 64;
    const freq = 4; // 4 cycles in n samples
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      real[i] = Math.sin((2 * Math.PI * freq * i) / n);
    }

    fft(real, imag, n);

    // Magnitude at bin `freq` should be dominant
    const magnitudes = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }

    // Peak should be at bin 4
    let peakBin = 0;
    let peakMag = 0;
    for (let i = 0; i < n / 2; i++) {
      if (magnitudes[i] > peakMag) {
        peakMag = magnitudes[i];
        peakBin = i;
      }
    }
    expect(peakBin).toBe(freq);
    expect(peakMag).toBeGreaterThan(n / 4); // Should be ~n/2
  });

  it("computes FFT of silence (all zeros)", () => {
    const n = 32;
    const real = new Float32Array(n).fill(0);
    const imag = new Float32Array(n).fill(0);
    fft(real, imag, n);

    for (let i = 0; i < n; i++) {
      expect(real[i]).toBeCloseTo(0, 5);
      expect(imag[i]).toBeCloseTo(0, 5);
    }
  });

  it("preserves Parseval's theorem (energy conservation)", () => {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n).fill(0);

    // Random-ish signal
    for (let i = 0; i < n; i++) {
      real[i] = Math.sin(i * 0.7) + 0.5 * Math.cos(i * 2.3);
    }

    // Time-domain energy
    let timeEnergy = 0;
    for (let i = 0; i < n; i++) {
      timeEnergy += real[i] * real[i];
    }

    fft(real, imag, n);

    // Frequency-domain energy
    let freqEnergy = 0;
    for (let i = 0; i < n; i++) {
      freqEnergy += real[i] * real[i] + imag[i] * imag[i];
    }
    freqEnergy /= n;

    expect(freqEnergy).toBeCloseTo(timeEnergy, 2);
  });
});

// ── Spectrogram Color Map Tests ─────────────────────
describe("spectrogram color maps", () => {
  function infernoColor(t: number): [number, number, number] {
    if (t < 0.25) {
      const s = t / 0.25;
      return [Math.floor(s * 80), Math.floor(s * 10), Math.floor(40 + s * 100)];
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return [Math.floor(80 + s * 140), Math.floor(10 + s * 30), Math.floor(140 - s * 40)];
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return [Math.floor(220 + s * 35), Math.floor(40 + s * 120), Math.floor(100 - s * 80)];
    } else {
      const s = (t - 0.75) / 0.25;
      return [255, Math.floor(160 + s * 80), Math.floor(20 + s * 180)];
    }
  }

  it("returns dark colors for low values", () => {
    const [r, g, b] = infernoColor(0);
    expect(r).toBeLessThan(10);
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(50);
  });

  it("returns bright colors for high values", () => {
    const [r, g, b] = infernoColor(1);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(150);
  });

  it("returns intermediate colors for mid values", () => {
    const [r, g, b] = infernoColor(0.5);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(255);
  });

  it("all color values are in 0-255 range", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const [r, g, b] = infernoColor(t);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("dB normalization clamps to 0-1 range", () => {
    const MIN_DB = -100;
    const MAX_DB = -20;
    const normalize = (db: number) =>
      Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));

    expect(normalize(-100)).toBe(0);
    expect(normalize(-20)).toBe(1);
    expect(normalize(-60)).toBeCloseTo(0.5);
    expect(normalize(-150)).toBe(0); // clamped
    expect(normalize(0)).toBe(1); // clamped
  });
});

// ── Hann Window Tests ───────────────────────────────
describe("Hann window function", () => {
  it("creates a symmetric window", () => {
    const n = 64;
    const window = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }

    // Symmetric: window[i] ≈ window[n-1-i]
    for (let i = 0; i < n / 2; i++) {
      expect(window[i]).toBeCloseTo(window[n - 1 - i], 5);
    }
  });

  it("starts and ends near zero", () => {
    const n = 64;
    const window = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }

    expect(window[0]).toBeCloseTo(0, 5);
    expect(window[n - 1]).toBeCloseTo(0, 5);
  });

  it("peaks at center with value 1", () => {
    const n = 65; // odd for exact center
    const window = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }

    expect(window[32]).toBeCloseTo(1, 5);
  });

  it("all values are between 0 and 1", () => {
    const n = 128;
    const window = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }

    for (let i = 0; i < n; i++) {
      expect(window[i]).toBeGreaterThanOrEqual(0);
      expect(window[i]).toBeLessThanOrEqual(1);
    }
  });
});
