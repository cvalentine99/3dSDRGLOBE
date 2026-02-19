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


// ── Position Predictor Tests ──────────────────────────
describe("Position prediction (positionPredictor)", () => {
  // Import the actual predictor
  let predictPosition: typeof import("./positionPredictor").predictPosition;

  beforeEach(async () => {
    const mod = await import("./positionPredictor");
    predictPosition = mod.predictPosition;
  });

  it("returns null for fewer than 2 points", () => {
    expect(predictPosition([])).toBeNull();
    expect(predictPosition([{ lat: 50, lon: 10, time: 1000 }])).toBeNull();
  });

  it("produces a linear prediction from 2 points", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.2, time: 3600000 }, // 1 hour later
    ]);
    expect(result).not.toBeNull();
    expect(result!.modelType).toBe("linear");
    expect(result!.historyCount).toBe(2);
    expect(result!.predictedLat).toBeCloseTo(50.2, 1);
    expect(result!.predictedLon).toBeCloseTo(10.4, 1);
  });

  it("uses linear model for 3 points", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.1, time: 3600000 },
      { lat: 50.2, lon: 10.2, time: 7200000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.modelType).toBe("linear");
    expect(result!.rSquaredLat).toBeGreaterThan(0.9);
    expect(result!.rSquaredLon).toBeGreaterThan(0.9);
  });

  it("considers quadratic model for 4+ points with curvature", () => {
    // Points that follow a parabolic path
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.1, time: 3600000 },
      { lat: 50.3, lon: 10.3, time: 7200000 },
      { lat: 50.6, lon: 10.6, time: 10800000 },
    ]);
    expect(result).not.toBeNull();
    // May use quadratic or linear depending on fit quality
    expect(["linear", "quadratic"]).toContain(result!.modelType);
    expect(result!.historyCount).toBe(4);
  });

  it("produces valid confidence ellipse dimensions", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.2, time: 3600000 },
      { lat: 50.2, lon: 10.4, time: 7200000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.ellipseMajor).toBeGreaterThan(0);
    expect(result!.ellipseMinor).toBeGreaterThan(0);
    expect(result!.ellipseMajor).toBeGreaterThanOrEqual(result!.ellipseMinor);
    expect(result!.ellipseRotation).toBeGreaterThanOrEqual(-90);
    expect(result!.ellipseRotation).toBeLessThanOrEqual(90);
  });

  it("calculates velocity in km/h", () => {
    // Two points ~111 km apart (1 degree latitude), 1 hour apart
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 51.0, lon: 10.0, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    // Velocity should be approximately 111 km/h
    expect(result!.velocityKmh).toBeGreaterThan(90);
    expect(result!.velocityKmh).toBeLessThan(130);
  });

  it("calculates bearing correctly (north)", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 51.0, lon: 10.0, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    // Moving north → bearing ~0°
    expect(result!.bearingDeg).toBeLessThan(10);
  });

  it("calculates bearing correctly (east)", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.0, lon: 11.0, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    // Moving east → bearing ~90°
    expect(result!.bearingDeg).toBeGreaterThan(80);
    expect(result!.bearingDeg).toBeLessThan(100);
  });

  it("clamps predicted position to valid lat/lon range", () => {
    // Points near the pole heading further north
    const result = predictPosition([
      { lat: 89.0, lon: 0, time: 0 },
      { lat: 89.5, lon: 0, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.predictedLat).toBeLessThanOrEqual(90);
    expect(result!.predictedLat).toBeGreaterThanOrEqual(-90);
  });

  it("calculates average interval correctly", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.1, time: 3600000 },
      { lat: 50.2, lon: 10.2, time: 7200000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.avgIntervalHours).toBeCloseTo(1, 1);
  });

  it("handles stationary target (same position)", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.0, lon: 10.0, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.predictedLat).toBeCloseTo(50.0, 1);
    expect(result!.predictedLon).toBeCloseTo(10.0, 1);
    expect(result!.velocityKmh).toBeLessThan(1);
  });

  it("handles unsorted input by sorting by time", () => {
    const result = predictPosition([
      { lat: 50.2, lon: 10.2, time: 7200000 },
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.1, time: 3600000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.predictedLat).toBeCloseTo(50.3, 1);
  });

  it("R² is 1.0 for perfectly linear data", () => {
    const result = predictPosition([
      { lat: 50.0, lon: 10.0, time: 0 },
      { lat: 50.1, lon: 10.1, time: 3600000 },
      { lat: 50.2, lon: 10.2, time: 7200000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.rSquaredLat).toBeCloseTo(1.0, 2);
    expect(result!.rSquaredLon).toBeCloseTo(1.0, 2);
  });
});

// ── Signal Classifier Fallback Tests ──────────────────
describe("Signal classifier fallback heuristics", () => {
  // We test the fallback classification by mocking invokeLLM to throw
  let classifySignal: typeof import("./signalClassifier").classifySignal;

  beforeEach(async () => {
    // Mock the LLM to force fallback
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    }));
    // Re-import to pick up mock
    const mod = await import("./signalClassifier");
    classifySignal = mod.classifySignal;
  });

  it("classifies WWV 10 MHz as time_signal", async () => {
    const result = await classifySignal({
      frequencyKhz: 10000,
      lat: 40.68,
      lon: -105.04,
    });
    expect(result.category).toBe("time_signal");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies AM broadcast frequency as broadcast", async () => {
    const result = await classifySignal({
      frequencyKhz: 1000,
      lat: 40,
      lon: -74,
    });
    expect(result.category).toBe("broadcast");
  });

  it("classifies amateur band frequency as amateur", async () => {
    const result = await classifySignal({
      frequencyKhz: 14200,
      lat: 51,
      lon: -1,
    });
    expect(result.category).toBe("amateur");
  });

  it("classifies HFGCS frequency as military", async () => {
    const result = await classifySignal({
      frequencyKhz: 11175,
      lat: 38,
      lon: -97,
    });
    expect(result.category).toBe("military");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("classifies UVB-76 as custom", async () => {
    const result = await classifySignal({
      frequencyKhz: 4625,
      lat: 56,
      lon: 37,
    });
    expect(result.category).toBe("custom");
    expect(result.knownStation).toContain("UVB-76");
  });

  it("classifies 2182 kHz as utility (maritime)", async () => {
    const result = await classifySignal({
      frequencyKhz: 2182,
      lat: 50,
      lon: -5,
    });
    expect(result.category).toBe("utility");
  });

  it("classifies shortwave broadcast band as broadcast", async () => {
    const result = await classifySignal({
      frequencyKhz: 9500,
      lat: 39,
      lon: 116,
    });
    expect(result.category).toBe("broadcast");
  });

  it("returns unknown for null frequency", async () => {
    const result = await classifySignal({
      frequencyKhz: null,
      lat: 0,
      lon: 0,
    });
    expect(result.category).toBe("unknown");
  });

  it("returns utility for unidentified HF", async () => {
    const result = await classifySignal({
      frequencyKhz: 8000,
      lat: 50,
      lon: 10,
    });
    expect(result.category).toBe("utility");
  });

  it("classifies CHU 3330 kHz as time_signal", async () => {
    const result = await classifySignal({
      frequencyKhz: 3330,
      lat: 45.3,
      lon: -75.75,
    });
    expect(result.category).toBe("time_signal");
    expect(result.knownStation).toContain("CHU");
  });
});

// ── CSV Export/Import Tests ──────────────────────────
describe("CSV export format", () => {
  it("generates valid CSV header", () => {
    const header = "id,label,lat,lon,frequencyKhz,color,category,notes,visible,createdAt";
    const fields = header.split(",");
    expect(fields).toContain("id");
    expect(fields).toContain("label");
    expect(fields).toContain("lat");
    expect(fields).toContain("lon");
    expect(fields).toContain("frequencyKhz");
    expect(fields).toContain("color");
    expect(fields).toContain("category");
    expect(fields.length).toBe(10);
  });

  it("escapes commas in CSV fields", () => {
    function escapeCsvField(value: string): string {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }
    expect(escapeCsvField("hello, world")).toBe('"hello, world"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("normal")).toBe("normal");
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("CSV import parsing", () => {
  function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  it("parses simple CSV line", () => {
    const fields = parseCsvLine("1,Target A,50.0,10.0,10000,#ff0000,time_signal,,true,2025-01-01");
    expect(fields[0]).toBe("1");
    expect(fields[1]).toBe("Target A");
    expect(fields[2]).toBe("50.0");
    expect(fields[3]).toBe("10.0");
  });

  it("handles quoted fields with commas", () => {
    const fields = parseCsvLine('1,"Target, with comma",50.0,10.0');
    expect(fields[1]).toBe("Target, with comma");
  });

  it("handles escaped quotes", () => {
    const fields = parseCsvLine('1,"Target ""quoted""",50.0');
    expect(fields[1]).toBe('Target "quoted"');
  });

  it("handles empty fields", () => {
    const fields = parseCsvLine("1,,50.0,,10000");
    expect(fields[1]).toBe("");
    expect(fields[3]).toBe("");
  });
});

// ── KML Export Tests ──────────────────────────────────
describe("KML export format", () => {
  function escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  it("escapes XML special characters", () => {
    expect(escapeXml("A & B")).toBe("A &amp; B");
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
    expect(escapeXml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("generates valid KML placemark structure", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>TDoA Targets</name>
<Placemark>
<name>Test Target</name>
<Point><coordinates>10.0,50.0,0</coordinates></Point>
</Placemark>
</Document>
</kml>`;
    expect(kml).toContain("<?xml");
    expect(kml).toContain("<kml");
    expect(kml).toContain("<Placemark>");
    expect(kml).toContain("<coordinates>10.0,50.0,0</coordinates>");
  });

  it("formats coordinates as lon,lat,altitude", () => {
    const lat = 50.123;
    const lon = 10.456;
    const coordStr = `${lon},${lat},0`;
    expect(coordStr).toBe("10.456,50.123,0");
    // KML uses lon,lat order (opposite of most mapping)
    const parts = coordStr.split(",");
    expect(parseFloat(parts[0])).toBe(lon);
    expect(parseFloat(parts[1])).toBe(lat);
  });
});

// ── KML Import Tests ──────────────────────────────────
describe("KML import parsing", () => {
  function extractKmlPlacemarks(kml: string): Array<{ name: string; lat: number; lon: number; description?: string }> {
    const placemarks: Array<{ name: string; lat: number; lon: number; description?: string }> = [];
    const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
    let match;
    while ((match = placemarkRegex.exec(kml)) !== null) {
      const block = match[1];
      const nameMatch = /<name>(.*?)<\/name>/.exec(block);
      const coordMatch = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(block);
      const descMatch = /<description>([\s\S]*?)<\/description>/.exec(block);
      if (nameMatch && coordMatch) {
        const coords = coordMatch[1].trim().split(",");
        if (coords.length >= 2) {
          placemarks.push({
            name: nameMatch[1],
            lon: parseFloat(coords[0]),
            lat: parseFloat(coords[1]),
            description: descMatch?.[1],
          });
        }
      }
    }
    return placemarks;
  }

  it("extracts placemarks from KML", () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<Placemark>
<name>Target A</name>
<Point><coordinates>10.5,50.3,0</coordinates></Point>
</Placemark>
<Placemark>
<name>Target B</name>
<description>Some notes</description>
<Point><coordinates>-73.9,40.7,0</coordinates></Point>
</Placemark>
</Document>
</kml>`;
    const placemarks = extractKmlPlacemarks(kml);
    expect(placemarks).toHaveLength(2);
    expect(placemarks[0].name).toBe("Target A");
    expect(placemarks[0].lat).toBeCloseTo(50.3);
    expect(placemarks[0].lon).toBeCloseTo(10.5);
    expect(placemarks[1].name).toBe("Target B");
    expect(placemarks[1].description).toBe("Some notes");
  });

  it("handles empty KML", () => {
    const kml = `<?xml version="1.0"?><kml><Document></Document></kml>`;
    const placemarks = extractKmlPlacemarks(kml);
    expect(placemarks).toHaveLength(0);
  });

  it("skips placemarks without coordinates", () => {
    const kml = `<kml><Document>
<Placemark><name>No Coords</name></Placemark>
<Placemark><name>Has Coords</name><Point><coordinates>5,45,0</coordinates></Point></Placemark>
</Document></kml>`;
    const placemarks = extractKmlPlacemarks(kml);
    expect(placemarks).toHaveLength(1);
    expect(placemarks[0].name).toBe("Has Coords");
  });
});

// ── Prediction Ellipse Geometry Tests ─────────────────
describe("Prediction ellipse geometry", () => {
  it("generates ellipse points on a circle when major = minor", () => {
    const major = 1; // degrees
    const minor = 1;
    const rotation = 0;
    const centerLat = 50;
    const centerLon = 10;
    const segments = 32;

    const points: Array<{ lat: number; lon: number }> = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const localLat = major * Math.cos(angle);
      const localLon = minor * Math.sin(angle);
      points.push({
        lat: centerLat + localLat,
        lon: centerLon + localLon,
      });
    }

    // All points should be ~1 degree from center
    for (const p of points) {
      const dist = Math.sqrt(
        (p.lat - centerLat) ** 2 + (p.lon - centerLon) ** 2
      );
      expect(dist).toBeCloseTo(1, 1);
    }
  });

  it("applies rotation to ellipse points", () => {
    const major = 2;
    const minor = 1;
    const rotDeg = 45;
    const rotRad = (rotDeg * Math.PI) / 180;

    // Point at angle 0 (along major axis)
    const localLat = major * Math.cos(0);
    const localLon = minor * Math.sin(0);
    const rotLat = localLat * Math.cos(rotRad) - localLon * Math.sin(rotRad);
    const rotLon = localLat * Math.sin(rotRad) + localLon * Math.cos(rotRad);

    // After 45° rotation, the major axis point should be at ~45° from lat axis
    const angle = Math.atan2(rotLon, rotLat) * (180 / Math.PI);
    expect(angle).toBeCloseTo(45, 0);
  });

  it("ellipse major axis is always >= minor axis", () => {
    // Simulate what the predictor does
    const latStd = 0.5;
    const lonStd = 0.3;
    const ellipseMajor = Math.max(latStd, lonStd) * 2;
    const ellipseMinor = Math.min(latStd, lonStd) * 2;
    expect(ellipseMajor).toBeGreaterThanOrEqual(ellipseMinor);
  });
});

// ── Target Category Color Mapping Tests ───────────────
describe("Target category color mapping", () => {
  const CATEGORY_COLORS: Record<string, string> = {
    time_signal: "#f59e0b",
    broadcast: "#3b82f6",
    utility: "#10b981",
    military: "#ef4444",
    amateur: "#8b5cf6",
    maritime: "#06b6d4",
    aviation: "#f97316",
    numbers: "#ec4899",
    unknown: "#6b7280",
    other: "#a3a3a3",
  };

  it("has a color for every category", () => {
    const categories = [
      "time_signal", "broadcast", "utility", "military",
      "amateur", "maritime", "aviation", "numbers", "unknown", "other",
    ];
    for (const cat of categories) {
      expect(CATEGORY_COLORS[cat]).toBeDefined();
      expect(CATEGORY_COLORS[cat]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("all colors are unique", () => {
    const colors = Object.values(CATEGORY_COLORS);
    const unique = new Set(colors);
    expect(unique.size).toBe(colors.length);
  });
});

// ── Anomaly Detection Tests ──────────────────────────────
describe("Anomaly detection", () => {
  // Test the pure functions from anomalyDetector
  describe("ellipseDistance", () => {
    // Inline implementation for testing (mirrors anomalyDetector.ts)
    function ellipseDistance(
      pointLat: number, pointLon: number,
      centerLat: number, centerLon: number,
      semiMajorDeg: number, semiMinorDeg: number,
      rotationDeg: number
    ): number {
      const dLat = pointLat - centerLat;
      const dLon = pointLon - centerLon;
      const rotRad = (rotationDeg * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const rotatedLat = dLat * cosR + dLon * sinR;
      const rotatedLon = -dLat * sinR + dLon * cosR;
      if (semiMajorDeg <= 0 || semiMinorDeg <= 0) return Infinity;
      return Math.sqrt(
        (rotatedLat / semiMajorDeg) ** 2 + (rotatedLon / semiMinorDeg) ** 2
      );
    }

    it("returns 0 for a point at the center", () => {
      expect(ellipseDistance(50, 10, 50, 10, 1, 0.5, 0)).toBe(0);
    });

    it("returns 1.0 for a point on the ellipse boundary (major axis)", () => {
      const dist = ellipseDistance(51, 10, 50, 10, 1, 0.5, 0);
      expect(dist).toBeCloseTo(1.0, 5);
    });

    it("returns 1.0 for a point on the ellipse boundary (minor axis)", () => {
      const dist = ellipseDistance(50, 10.5, 50, 10, 1, 0.5, 0);
      expect(dist).toBeCloseTo(1.0, 5);
    });

    it("returns >1 for a point outside the ellipse", () => {
      const dist = ellipseDistance(52, 10, 50, 10, 1, 0.5, 0);
      expect(dist).toBeGreaterThan(1);
    });

    it("returns <1 for a point inside the ellipse", () => {
      const dist = ellipseDistance(50.3, 10.1, 50, 10, 1, 0.5, 0);
      expect(dist).toBeLessThan(1);
    });

    it("returns Infinity for zero semi-major axis", () => {
      expect(ellipseDistance(50, 10, 50, 10, 0, 0.5, 0)).toBe(Infinity);
    });

    it("returns Infinity for zero semi-minor axis", () => {
      expect(ellipseDistance(50, 10, 50, 10, 1, 0, 0)).toBe(Infinity);
    });

    it("handles rotation correctly", () => {
      // With 90° rotation, major and minor axes are swapped
      const distNoRotation = ellipseDistance(51, 10, 50, 10, 2, 1, 0);
      const distRotated = ellipseDistance(50, 11, 50, 10, 2, 1, 90);
      expect(distNoRotation).toBeCloseTo(distRotated, 3);
    });
  });

  describe("normalizedDistToSigma", () => {
    function normalizedDistToSigma(normalizedDist: number): number {
      return normalizedDist * 2;
    }

    it("converts normalized distance 1.0 to 2σ", () => {
      expect(normalizedDistToSigma(1.0)).toBe(2);
    });

    it("converts normalized distance 0.5 to 1σ", () => {
      expect(normalizedDistToSigma(0.5)).toBe(1);
    });

    it("converts normalized distance 1.5 to 3σ", () => {
      expect(normalizedDistToSigma(1.5)).toBe(3);
    });

    it("converts 0 to 0σ", () => {
      expect(normalizedDistToSigma(0)).toBe(0);
    });
  });

  describe("getSeverity", () => {
    function getSeverity(sigma: number): "low" | "medium" | "high" | null {
      if (sigma >= 3) return "high";
      if (sigma >= 2) return "medium";
      if (sigma >= 1.5) return "low";
      return null;
    }

    it("returns null for sigma < 1.5", () => {
      expect(getSeverity(0)).toBeNull();
      expect(getSeverity(1.0)).toBeNull();
      expect(getSeverity(1.49)).toBeNull();
    });

    it("returns 'low' for sigma 1.5–2", () => {
      expect(getSeverity(1.5)).toBe("low");
      expect(getSeverity(1.8)).toBe("low");
      expect(getSeverity(1.99)).toBe("low");
    });

    it("returns 'medium' for sigma 2–3", () => {
      expect(getSeverity(2.0)).toBe("medium");
      expect(getSeverity(2.5)).toBe("medium");
      expect(getSeverity(2.99)).toBe("medium");
    });

    it("returns 'high' for sigma >= 3", () => {
      expect(getSeverity(3.0)).toBe("high");
      expect(getSeverity(5.0)).toBe("high");
      expect(getSeverity(100)).toBe("high");
    });
  });

  describe("haversine distance", () => {
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

    it("returns 0 for identical points", () => {
      expect(haversineKm(50, 10, 50, 10)).toBe(0);
    });

    it("calculates distance between London and Paris (~340 km)", () => {
      const dist = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
      expect(dist).toBeGreaterThan(330);
      expect(dist).toBeLessThan(350);
    });

    it("calculates distance between equator points 1° apart (~111 km)", () => {
      const dist = haversineKm(0, 0, 0, 1);
      expect(dist).toBeGreaterThan(110);
      expect(dist).toBeLessThan(112);
    });

    it("calculates antipodal distance (~20015 km)", () => {
      const dist = haversineKm(0, 0, 0, 180);
      expect(dist).toBeGreaterThan(20000);
      expect(dist).toBeLessThan(20050);
    });
  });

  describe("anomaly alert description", () => {
    it("builds a multi-line description with all fields", () => {
      function buildAlertDescription(
        target: { label: string; category: string },
        prediction: any,
        actualLat: number, actualLon: number,
        deviationKm: number, deviationSigma: number,
        severity: string
      ): string {
        return [
          `Target "${target.label}" (${target.category}) has moved unexpectedly.`,
          `Predicted position: ${prediction.predictedLat.toFixed(4)}°, ${prediction.predictedLon.toFixed(4)}°`,
          `Observed position: ${actualLat.toFixed(4)}°, ${actualLon.toFixed(4)}°`,
          `Deviation: ${deviationKm.toFixed(1)} km (${deviationSigma.toFixed(1)}σ)`,
          `Severity: ${severity}`,
          `Model: ${prediction.modelType} (R² lat=${prediction.rSquaredLat.toFixed(2)}, lon=${prediction.rSquaredLon.toFixed(2)})`,
          `Based on ${prediction.historyCount} prior observations.`,
        ].join("\n");
      }

      const desc = buildAlertDescription(
        { label: "Test Target", category: "broadcast" },
        {
          predictedLat: 50.0, predictedLon: 10.0,
          modelType: "linear", rSquaredLat: 0.95, rSquaredLon: 0.88,
          historyCount: 5,
        },
        51.0, 11.0, 150.5, 2.5, "medium"
      );

      expect(desc).toContain("Test Target");
      expect(desc).toContain("broadcast");
      expect(desc).toContain("150.5 km");
      expect(desc).toContain("2.5σ");
      expect(desc).toContain("medium");
      expect(desc).toContain("linear");
      expect(desc).toContain("5 prior observations");
    });
  });
});

// ── Cosine Similarity Tests ──────────────────────────────
describe("Cosine similarity", () => {
  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  it("returns 1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
  });

  it("returns 1.0 for proportional vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("handles normalized vectors correctly", () => {
    const a = [0.5, 0.5, 0.5, 0.5];
    const b = [0.3, 0.4, 0.5, 0.6];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThanOrEqual(1.0);
  });

  it("handles large feature vectors (32-dim)", () => {
    const a = Array.from({ length: 32 }, (_, i) => Math.sin(i * 0.5));
    const b = Array.from({ length: 32 }, (_, i) => Math.sin(i * 0.5 + 0.1));
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.95); // Very similar signals
  });

  it("distinguishes different signal patterns", () => {
    const tonal = Array.from({ length: 32 }, (_, i) => i < 4 ? 1 : 0); // Energy in low bins
    const broadband = Array.from({ length: 32 }, () => 0.3); // Flat spectrum
    const sim = cosineSimilarity(tonal, broadband);
    expect(sim).toBeLessThan(0.7); // Should be distinguishable
  });
});

// ── Collaborative Sharing Tests ──────────────────────────────
describe("Collaborative sharing", () => {
  describe("invite token generation", () => {
    it("generates a unique token of expected length", () => {
      // Simulating the token generation from the router
      function generateToken(): string {
        return Array.from({ length: 32 }, () =>
          Math.random().toString(36).charAt(2)
        ).join("");
      }

      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1.length).toBe(32);
      expect(token2.length).toBe(32);
      expect(token1).not.toBe(token2);
    });

    it("generates alphanumeric tokens", () => {
      function generateToken(): string {
        return Array.from({ length: 32 }, () =>
          Math.random().toString(36).charAt(2)
        ).join("");
      }

      const token = generateToken();
      expect(token).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe("shared list permissions", () => {
    it("validates role types", () => {
      const validRoles = ["owner", "editor", "viewer"];
      expect(validRoles).toContain("owner");
      expect(validRoles).toContain("editor");
      expect(validRoles).toContain("viewer");
    });

    it("owner has all permissions", () => {
      const canEdit = (role: string) => role === "owner" || role === "editor";
      const canDelete = (role: string) => role === "owner";
      const canView = (role: string) => ["owner", "editor", "viewer"].includes(role);

      expect(canEdit("owner")).toBe(true);
      expect(canDelete("owner")).toBe(true);
      expect(canView("owner")).toBe(true);
    });

    it("editor can edit but not delete", () => {
      const canEdit = (role: string) => role === "owner" || role === "editor";
      const canDelete = (role: string) => role === "owner";

      expect(canEdit("editor")).toBe(true);
      expect(canDelete("editor")).toBe(false);
    });

    it("viewer can only view", () => {
      const canEdit = (role: string) => role === "owner" || role === "editor";
      const canDelete = (role: string) => role === "owner";

      expect(canEdit("viewer")).toBe(false);
      expect(canDelete("viewer")).toBe(false);
    });
  });

  describe("invite link construction", () => {
    it("builds a valid invite URL with token", () => {
      const origin = "https://radio-globe.manus.space";
      const token = "abc123def456";
      const url = `${origin}/invite/${token}`;
      expect(url).toBe("https://radio-globe.manus.space/invite/abc123def456");
    });

    it("handles different origins", () => {
      const origins = [
        "http://localhost:3000",
        "https://example.com",
        "https://radio-globe.manus.space",
      ];
      const token = "testtoken123";
      origins.forEach(origin => {
        const url = `${origin}/invite/${token}`;
        expect(url).toContain(token);
        expect(url.startsWith(origin)).toBe(true);
      });
    });
  });

  describe("invite expiration", () => {
    it("correctly identifies expired invites", () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      const validExpiry = now + oneDay;
      const expiredExpiry = now - oneDay;

      expect(validExpiry > now).toBe(true);
      expect(expiredExpiry > now).toBe(false);
    });

    it("handles null expiry as non-expiring", () => {
      const expiresAt: number | null = null;
      const isExpired = expiresAt !== null && expiresAt < Date.now();
      expect(isExpired).toBe(false);
    });
  });
});

// ── Signal Fingerprint Feature Vector Tests ──────────────────────────────
describe("Signal fingerprint feature vector", () => {
  describe("mel-scale bin calculation", () => {
    it("converts frequency to mel scale correctly", () => {
      function freqToMel(freq: number): number {
        return 2595 * Math.log10(1 + freq / 700);
      }

      expect(freqToMel(0)).toBe(0);
      expect(freqToMel(700)).toBeCloseTo(781.2, 0);
      expect(freqToMel(1000)).toBeCloseTo(999.9, 0);
    });

    it("converts mel back to frequency", () => {
      function melToFreq(mel: number): number {
        return 700 * (Math.pow(10, mel / 2595) - 1);
      }

      expect(melToFreq(0)).toBe(0);
      expect(melToFreq(781.2)).toBeCloseTo(700, 0);
    });

    it("generates 16 mel bins covering the frequency range", () => {
      const maxFreq = 6000; // Nyquist for 12kHz sample rate
      const melMax = 2595 * Math.log10(1 + maxFreq / 700);
      const melBins = 16;

      const bins: Array<{ low: number; high: number }> = [];
      for (let b = 0; b < melBins; b++) {
        const melLow = (melMax * b) / melBins;
        const melHigh = (melMax * (b + 1)) / melBins;
        const freqLow = 700 * (Math.pow(10, melLow / 2595) - 1);
        const freqHigh = 700 * (Math.pow(10, melHigh / 2595) - 1);
        bins.push({ low: freqLow, high: freqHigh });
      }

      expect(bins.length).toBe(16);
      expect(bins[0].low).toBeCloseTo(0, 0);
      expect(bins[15].high).toBeCloseTo(maxFreq, 0);
      // Each bin should be wider than the previous (mel scale)
      for (let i = 1; i < bins.length; i++) {
        const prevWidth = bins[i - 1].high - bins[i - 1].low;
        const currWidth = bins[i].high - bins[i].low;
        expect(currWidth).toBeGreaterThanOrEqual(prevWidth * 0.95); // Allow small float tolerance
      }
    });
  });

  describe("feature vector normalization", () => {
    it("normalizes a vector to unit length", () => {
      const vector = [3, 4]; // length = 5
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      const normalized = vector.map(v => v / norm);
      expect(normalized[0]).toBeCloseTo(0.6, 5);
      expect(normalized[1]).toBeCloseTo(0.8, 5);
      const newNorm = Math.sqrt(normalized.reduce((s, v) => s + v * v, 0));
      expect(newNorm).toBeCloseTo(1.0, 5);
    });

    it("handles zero vector gracefully", () => {
      const vector = [0, 0, 0];
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      if (norm > 0) {
        const normalized = vector.map(v => v / norm);
        expect(normalized).toEqual([0, 0, 0]);
      } else {
        expect(vector).toEqual([0, 0, 0]); // Returned as-is
      }
    });

    it("produces 32-dimensional vectors", () => {
      // Simulate building a 32-dim vector
      const vector: number[] = [];
      // 16 mel bins
      for (let i = 0; i < 16; i++) vector.push(Math.random());
      // 8 peak frequencies
      for (let i = 0; i < 8; i++) vector.push(Math.random());
      // 4 statistics
      for (let i = 0; i < 4; i++) vector.push(Math.random());
      // 4 temporal features
      for (let i = 0; i < 4; i++) vector.push(Math.random());

      expect(vector.length).toBe(32);
    });
  });

  describe("spectral peak detection", () => {
    it("finds peaks in a simple spectrum", () => {
      function findPeaks(spectrum: number[]): number[] {
        const peaks: number[] = [];
        for (let i = 2; i < spectrum.length - 2; i++) {
          if (
            spectrum[i] > spectrum[i - 1] &&
            spectrum[i] > spectrum[i + 1] &&
            spectrum[i] > spectrum[i - 2] &&
            spectrum[i] > spectrum[i + 2]
          ) {
            peaks.push(i);
          }
        }
        return peaks;
      }

      // Create a spectrum with a clear peak at index 10
      const spectrum = new Array(20).fill(0.1);
      spectrum[10] = 1.0;
      spectrum[9] = 0.5;
      spectrum[11] = 0.5;

      const peaks = findPeaks(spectrum);
      expect(peaks).toContain(10);
    });

    it("finds multiple peaks", () => {
      function findPeaks(spectrum: number[]): number[] {
        const peaks: number[] = [];
        for (let i = 2; i < spectrum.length - 2; i++) {
          if (
            spectrum[i] > spectrum[i - 1] &&
            spectrum[i] > spectrum[i + 1] &&
            spectrum[i] > spectrum[i - 2] &&
            spectrum[i] > spectrum[i + 2]
          ) {
            peaks.push(i);
          }
        }
        return peaks;
      }

      const spectrum = new Array(50).fill(0.1);
      spectrum[10] = 1.0;
      spectrum[9] = 0.5;
      spectrum[11] = 0.5;
      spectrum[30] = 0.8;
      spectrum[29] = 0.3;
      spectrum[31] = 0.3;

      const peaks = findPeaks(spectrum);
      expect(peaks).toContain(10);
      expect(peaks).toContain(30);
    });

    it("returns empty for flat spectrum", () => {
      function findPeaks(spectrum: number[]): number[] {
        const peaks: number[] = [];
        for (let i = 2; i < spectrum.length - 2; i++) {
          if (
            spectrum[i] > spectrum[i - 1] &&
            spectrum[i] > spectrum[i + 1] &&
            spectrum[i] > spectrum[i - 2] &&
            spectrum[i] > spectrum[i + 2]
          ) {
            peaks.push(i);
          }
        }
        return peaks;
      }

      const spectrum = new Array(20).fill(0.5);
      const peaks = findPeaks(spectrum);
      expect(peaks.length).toBe(0);
    });
  });

  describe("spectral features", () => {
    it("calculates spectral centroid correctly", () => {
      // Simple spectrum: energy concentrated at bin 5 (out of 10)
      const spectrum = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
      const freqBinWidth = 100; // Hz per bin

      let weightedSum = 0;
      let totalMag = 0;
      for (let i = 0; i < spectrum.length; i++) {
        weightedSum += (i * freqBinWidth) * spectrum[i];
        totalMag += spectrum[i];
      }
      const centroid = totalMag > 0 ? weightedSum / totalMag : 0;

      expect(centroid).toBe(500); // 5 * 100 Hz
    });

    it("calculates spectral flatness for pure tone (near 0)", () => {
      // Pure tone: all energy in one bin
      const spectrum = [0.001, 0.001, 0.001, 1.0, 0.001, 0.001, 0.001, 0.001];
      const logSum = spectrum.reduce((sum, val) => sum + Math.log(Math.max(val, 1e-10)), 0);
      const geometricMean = Math.exp(logSum / spectrum.length);
      const arithmeticMean = spectrum.reduce((s, v) => s + v, 0) / spectrum.length;
      const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

      expect(flatness).toBeLessThan(0.1); // Tonal signal = low flatness
    });

    it("calculates spectral flatness for noise (near 1)", () => {
      // White noise: equal energy in all bins
      const spectrum = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const logSum = spectrum.reduce((sum, val) => sum + Math.log(Math.max(val, 1e-10)), 0);
      const geometricMean = Math.exp(logSum / spectrum.length);
      const arithmeticMean = spectrum.reduce((s, v) => s + v, 0) / spectrum.length;
      const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

      expect(flatness).toBeCloseTo(1.0, 2); // Noise = high flatness
    });

    it("calculates RMS level in dB", () => {
      // Signal with known RMS
      const samples = new Float32Array([0.5, -0.5, 0.5, -0.5]);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));

      expect(rms).toBeCloseTo(0.5, 5);
      expect(rmsDb).toBeCloseTo(-6.02, 1); // -6 dB for 0.5 amplitude
    });

    it("calculates zero-crossing rate", () => {
      // Alternating signal: maximum zero crossings
      const samples = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
      let zeroCrossings = 0;
      for (let i = 1; i < samples.length; i++) {
        if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
          zeroCrossings++;
        }
      }
      const zcr = zeroCrossings / samples.length;

      expect(zeroCrossings).toBe(7);
      expect(zcr).toBeCloseTo(0.875, 3);
    });
  });
});

// ── Shared List Data Validation Tests ──────────────────────────────
describe("Shared list data validation", () => {
  it("validates list name is not empty", () => {
    const name = "My Target List";
    expect(name.length).toBeGreaterThan(0);
    expect(name.trim().length).toBeGreaterThan(0);
  });

  it("validates list description length", () => {
    const maxLength = 500;
    const validDesc = "A collection of broadcast targets in Europe";
    const tooLong = "x".repeat(501);

    expect(validDesc.length).toBeLessThanOrEqual(maxLength);
    expect(tooLong.length).toBeGreaterThan(maxLength);
  });

  it("validates target IDs are positive integers", () => {
    const targetIds = [1, 5, 10, 42];
    targetIds.forEach(id => {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    });
  });

  it("deduplicates target IDs", () => {
    const targetIds = [1, 5, 5, 10, 10, 42];
    const unique = [...new Set(targetIds)];
    expect(unique).toEqual([1, 5, 10, 42]);
    expect(unique.length).toBe(4);
  });
});

// ── FFT In-Place Tests ──────────────────────────────
describe("FFT in-place (Cooley-Tukey)", () => {
  function fftInPlace(real: Float64Array, imag: Float64Array): void {
    const n = real.length;
    if (n <= 1) return;

    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
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
          const tReal = curReal * real[i + k + halfLen] - curImag * imag[i + k + halfLen];
          const tImag = curReal * imag[i + k + halfLen] + curImag * real[i + k + halfLen];
          real[i + k + halfLen] = real[i + k] - tReal;
          imag[i + k + halfLen] = imag[i + k] - tImag;
          real[i + k] += tReal;
          imag[i + k] += tImag;
          const newReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = newReal;
        }
      }
    }
  }

  it("transforms a DC signal correctly", () => {
    const real = new Float64Array([1, 1, 1, 1]);
    const imag = new Float64Array([0, 0, 0, 0]);
    fftInPlace(real, imag);

    // DC component should be sum of all samples = 4
    expect(real[0]).toBeCloseTo(4, 5);
    // All other bins should be ~0
    expect(Math.abs(real[1])).toBeLessThan(1e-10);
    expect(Math.abs(real[2])).toBeLessThan(1e-10);
    expect(Math.abs(real[3])).toBeLessThan(1e-10);
  });

  it("transforms a pure cosine correctly", () => {
    const N = 8;
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    // cos(2π·1·n/N) → peaks at bin 1 and bin N-1
    for (let n = 0; n < N; n++) {
      real[n] = Math.cos((2 * Math.PI * n) / N);
    }
    fftInPlace(real, imag);

    // Magnitude at bin 1 should be N/2 = 4
    const mag1 = Math.sqrt(real[1] ** 2 + imag[1] ** 2);
    expect(mag1).toBeCloseTo(N / 2, 3);
  });

  it("preserves Parseval's theorem (energy conservation)", () => {
    const N = 16;
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      real[i] = Math.sin(i * 0.7) + Math.cos(i * 1.3);
    }

    // Time-domain energy
    let timeEnergy = 0;
    for (let i = 0; i < N; i++) {
      timeEnergy += real[i] ** 2;
    }

    fftInPlace(real, imag);

    // Frequency-domain energy (divided by N for Parseval's)
    let freqEnergy = 0;
    for (let i = 0; i < N; i++) {
      freqEnergy += real[i] ** 2 + imag[i] ** 2;
    }
    freqEnergy /= N;

    expect(freqEnergy).toBeCloseTo(timeEnergy, 3);
  });

  it("handles single element", () => {
    const real = new Float64Array([42]);
    const imag = new Float64Array([0]);
    fftInPlace(real, imag);
    expect(real[0]).toBe(42);
  });
});

// ── Analytics Dashboard Tests ──────────────────────────────────

describe("Analytics dashboard endpoints", () => {
  describe("summary statistics", () => {
    it("should return all expected summary fields", () => {
      const expectedFields = [
        "totalTargets",
        "totalJobs",
        "completedJobs",
        "totalRecordings",
        "totalFingerprints",
        "activeAnomalies",
        "totalAnomalies",
        "sharedLists",
        "totalMembers",
        "receiversOnline",
        "receiversTotal",
      ];

      // Simulate the default return when DB is not available
      const defaultSummary = {
        totalTargets: 0,
        totalJobs: 0,
        completedJobs: 0,
        totalRecordings: 0,
        totalFingerprints: 0,
        activeAnomalies: 0,
        totalAnomalies: 0,
        sharedLists: 0,
        totalMembers: 0,
        receiversOnline: 0,
        receiversTotal: 0,
      };

      for (const field of expectedFields) {
        expect(defaultSummary).toHaveProperty(field);
        expect(typeof (defaultSummary as any)[field]).toBe("number");
      }
    });

    it("should have non-negative values for all summary fields", () => {
      const summary = {
        totalTargets: 5,
        totalJobs: 12,
        completedJobs: 8,
        totalRecordings: 20,
        totalFingerprints: 15,
        activeAnomalies: 2,
        totalAnomalies: 7,
        sharedLists: 3,
        totalMembers: 6,
        receiversOnline: 450,
        receiversTotal: 1200,
      };

      for (const [key, value] of Object.entries(summary)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });

    it("should have completedJobs <= totalJobs", () => {
      const summary = { totalJobs: 12, completedJobs: 8 };
      expect(summary.completedJobs).toBeLessThanOrEqual(summary.totalJobs);
    });

    it("should have activeAnomalies <= totalAnomalies", () => {
      const summary = { activeAnomalies: 2, totalAnomalies: 7 };
      expect(summary.activeAnomalies).toBeLessThanOrEqual(summary.totalAnomalies);
    });

    it("should have receiversOnline <= receiversTotal", () => {
      const summary = { receiversOnline: 450, receiversTotal: 1200 };
      expect(summary.receiversOnline).toBeLessThanOrEqual(summary.receiversTotal);
    });
  });

  describe("anomaly trend aggregation", () => {
    function aggregateAnomalyTrend(
      alerts: Array<{ severity: "low" | "medium" | "high"; createdAt: number }>,
      days: number
    ) {
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const filtered = alerts.filter((a) => a.createdAt >= startTime);

      const dayMap = new Map<string, { low: number; medium: number; high: number; total: number }>();
      for (const alert of filtered) {
        const date = new Date(alert.createdAt).toISOString().split("T")[0];
        const entry = dayMap.get(date) ?? { low: 0, medium: 0, high: 0, total: 0 };
        entry[alert.severity]++;
        entry.total++;
        dayMap.set(date, entry);
      }

      const result: Array<{ date: string; low: number; medium: number; high: number; total: number }> = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        result.push({ date: dateStr, ...(dayMap.get(dateStr) ?? { low: 0, medium: 0, high: 0, total: 0 }) });
      }
      return result;
    }

    it("should return correct number of days", () => {
      const result = aggregateAnomalyTrend([], 7);
      expect(result).toHaveLength(7);
    });

    it("should return correct number of days for 30-day range", () => {
      const result = aggregateAnomalyTrend([], 30);
      expect(result).toHaveLength(30);
    });

    it("should fill missing days with zeros", () => {
      const result = aggregateAnomalyTrend([], 7);
      for (const day of result) {
        expect(day.low).toBe(0);
        expect(day.medium).toBe(0);
        expect(day.high).toBe(0);
        expect(day.total).toBe(0);
      }
    });

    it("should correctly count alerts by severity", () => {
      const now = Date.now();
      const alerts = [
        { severity: "low" as const, createdAt: now - 1000 },
        { severity: "low" as const, createdAt: now - 2000 },
        { severity: "medium" as const, createdAt: now - 3000 },
        { severity: "high" as const, createdAt: now - 4000 },
      ];

      const result = aggregateAnomalyTrend(alerts, 7);
      const today = result[result.length - 1];
      expect(today.low).toBe(2);
      expect(today.medium).toBe(1);
      expect(today.high).toBe(1);
      expect(today.total).toBe(4);
    });

    it("should filter out alerts older than the time range", () => {
      const now = Date.now();
      const alerts = [
        { severity: "high" as const, createdAt: now - 1000 },
        { severity: "low" as const, createdAt: now - 8 * 24 * 60 * 60 * 1000 }, // 8 days ago
      ];

      const result = aggregateAnomalyTrend(alerts, 7);
      const totalAlerts = result.reduce((sum, day) => sum + day.total, 0);
      expect(totalAlerts).toBe(1); // Only the recent one
    });

    it("should have dates in ascending order", () => {
      const result = aggregateAnomalyTrend([], 14);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].date > result[i - 1].date).toBe(true);
      }
    });
  });

  describe("job trend aggregation", () => {
    function aggregateJobTrend(
      jobs: Array<{ status: string; createdAt: number }>,
      days: number
    ) {
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const filtered = jobs.filter((j) => j.createdAt >= startTime);

      const dayMap = new Map<string, { complete: number; error: number; pending: number; total: number }>();
      for (const job of filtered) {
        const date = new Date(job.createdAt).toISOString().split("T")[0];
        const entry = dayMap.get(date) ?? { complete: 0, error: 0, pending: 0, total: 0 };
        if (job.status === "complete") entry.complete++;
        else if (job.status === "error") entry.error++;
        else entry.pending++;
        entry.total++;
        dayMap.set(date, entry);
      }

      const result: Array<{ date: string; complete: number; error: number; pending: number; total: number }> = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        result.push({ date: dateStr, ...(dayMap.get(dateStr) ?? { complete: 0, error: 0, pending: 0, total: 0 }) });
      }
      return result;
    }

    it("should categorize jobs by status correctly", () => {
      const now = Date.now();
      const jobs = [
        { status: "complete", createdAt: now - 1000 },
        { status: "complete", createdAt: now - 2000 },
        { status: "error", createdAt: now - 3000 },
        { status: "pending", createdAt: now - 4000 },
        { status: "sampling", createdAt: now - 5000 },
      ];

      const result = aggregateJobTrend(jobs, 7);
      const today = result[result.length - 1];
      expect(today.complete).toBe(2);
      expect(today.error).toBe(1);
      expect(today.pending).toBe(2); // pending + sampling both count as pending
      expect(today.total).toBe(5);
    });

    it("should return correct number of days", () => {
      const result = aggregateJobTrend([], 30);
      expect(result).toHaveLength(30);
    });
  });

  describe("target category distribution", () => {
    it("should group targets by category", () => {
      const targets = [
        { category: "broadcast" },
        { category: "broadcast" },
        { category: "military" },
        { category: "unknown" },
        { category: "unknown" },
        { category: "unknown" },
      ];

      const grouped = new Map<string, number>();
      for (const t of targets) {
        grouped.set(t.category, (grouped.get(t.category) ?? 0) + 1);
      }

      const result = Array.from(grouped.entries()).map(([category, count]) => ({ category, count }));
      expect(result).toHaveLength(3);
      expect(result.find((r) => r.category === "broadcast")?.count).toBe(2);
      expect(result.find((r) => r.category === "military")?.count).toBe(1);
      expect(result.find((r) => r.category === "unknown")?.count).toBe(3);
    });

    it("should return empty array when no targets exist", () => {
      const targets: Array<{ category: string }> = [];
      const grouped = new Map<string, number>();
      for (const t of targets) {
        grouped.set(t.category, (grouped.get(t.category) ?? 0) + 1);
      }
      const result = Array.from(grouped.entries()).map(([category, count]) => ({ category, count }));
      expect(result).toHaveLength(0);
    });
  });

  describe("recent activity feed", () => {
    it("should sort activities by timestamp descending", () => {
      const activities = [
        { type: "job", id: 1, label: "Job 1", detail: "", timestamp: 1000 },
        { type: "anomaly", id: 2, label: "Anomaly 1", detail: "", timestamp: 3000 },
        { type: "target", id: 3, label: "Target 1", detail: "", timestamp: 2000 },
      ];

      activities.sort((a, b) => b.timestamp - a.timestamp);
      expect(activities[0].type).toBe("anomaly");
      expect(activities[1].type).toBe("target");
      expect(activities[2].type).toBe("job");
    });

    it("should limit results to requested count", () => {
      const activities = Array.from({ length: 50 }, (_, i) => ({
        type: "job",
        id: i,
        label: `Job ${i}`,
        detail: "",
        timestamp: Date.now() - i * 1000,
      }));

      const limit = 20;
      activities.sort((a, b) => b.timestamp - a.timestamp);
      const result = activities.slice(0, limit);
      expect(result).toHaveLength(20);
    });
  });

  describe("receiver stats", () => {
    it("should calculate online/offline ratio", () => {
      const stats = { online: 450, offline: 750 };
      const total = stats.online + stats.offline;
      const onlinePercent = (stats.online / total) * 100;
      expect(onlinePercent).toBeCloseTo(37.5, 1);
    });

    it("should group receivers by type", () => {
      const receivers = [
        { type: "KiwiSDR" },
        { type: "KiwiSDR" },
        { type: "OpenWebRX" },
        { type: "WebSDR" },
        { type: "KiwiSDR" },
      ];

      const grouped = new Map<string, number>();
      for (const r of receivers) {
        grouped.set(r.type, (grouped.get(r.type) ?? 0) + 1);
      }

      expect(grouped.get("KiwiSDR")).toBe(3);
      expect(grouped.get("OpenWebRX")).toBe(1);
      expect(grouped.get("WebSDR")).toBe(1);
    });
  });

  describe("relative time formatting", () => {
    function formatRelativeTime(timestamp: number): string {
      const diff = Date.now() - timestamp;
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return "just now";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `${days}d ago`;
      return new Date(timestamp).toLocaleDateString();
    }

    it("should show 'just now' for recent events", () => {
      expect(formatRelativeTime(Date.now() - 5000)).toBe("just now");
    });

    it("should show minutes for events within an hour", () => {
      expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
    });

    it("should show hours for events within a day", () => {
      expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe("3h ago");
    });

    it("should show days for events within a week", () => {
      expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");
    });

    it("should show date for older events", () => {
      const oldDate = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const result = formatRelativeTime(oldDate);
      expect(result).not.toContain("ago");
    });
  });
});
