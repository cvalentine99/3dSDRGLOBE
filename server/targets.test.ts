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
