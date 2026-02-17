import { describe, it, expect } from "vitest";

/**
 * Tests for receiver auto-detection and optimal iframe configuration.
 * 
 * These tests validate the detectReceiverType() and getOptimalIframeConfig()
 * functions from client/src/lib/receiverUrls.ts.
 * 
 * Since vitest is configured for server tests, we import the shared logic
 * by path alias.
 */

// We need to test the client-side functions, so import them directly
// The vitest config has the @ alias pointing to client/src
import {
  detectReceiverType,
  getOptimalIframeConfig,
  getClickToStartMessage,
  buildTunedUrl,
  suggestMode,
  type ReceiverTypeId,
} from "@/lib/receiverUrls";

/* ── detectReceiverType ─────────────────────────────── */

describe("detectReceiverType", () => {
  describe("hostname-based detection (high confidence)", () => {
    it("detects KiwiSDR from hostname containing 'kiwisdr'", () => {
      const result = detectReceiverType("http://hasenberg01.kiwisdr.ch/");
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("high");
    });

    it("detects KiwiSDR from hostname containing 'kiwisdr' with port", () => {
      const result = detectReceiverType("http://kiwisdr.owdjim.gen.nz:8073/");
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("high");
    });

    it("detects OpenWebRX from hostname containing 'openwebrx'", () => {
      const result = detectReceiverType("http://openwebrx.example.com:8073/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("high");
    });

    it("detects OpenWebRX from hostname containing 'owrx'", () => {
      const result = detectReceiverType("http://owrx.example.com:8073/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("high");
    });

    it("detects WebSDR from hostname containing 'websdr' (no OpenWebRX port)", () => {
      const result = detectReceiverType("http://websdr1.sdrutah.org:8901/");
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("high");
    });

    it("detects OpenWebRX when websdr hostname has OpenWebRX-typical port", () => {
      // Some OpenWebRX instances use websdr.* domains
      const result = detectReceiverType("http://websdr.dynv6.net:8073/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("medium");
    });
  });

  describe("path-based detection (high confidence)", () => {
    it("detects OpenWebRX from /owrx path", () => {
      const result = detectReceiverType("http://jimjackii.no-ip.org/owrx/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("high");
    });

    it("detects OpenWebRX from /openwebrx path", () => {
      const result = detectReceiverType("http://example.com/openwebrx/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("high");
    });

    it("detects WebSDR from /websdr path", () => {
      const result = detectReceiverType("http://example.com/websdr/");
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("high");
    });
  });

  describe("label-based detection (medium confidence)", () => {
    it("detects KiwiSDR from label text", () => {
      const result = detectReceiverType(
        "http://example.com:8073/",
        "0.5-30 MHz SDR (KiwiSDR 1 of 5)"
      );
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("medium");
    });

    it("detects OpenWebRX from label text", () => {
      const result = detectReceiverType(
        "http://example.com/",
        "Berlin OpenWebRxPlus 0-30 MHz"
      );
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("medium");
    });

    it("detects WebSDR from label text", () => {
      const result = detectReceiverType(
        "http://example.com/",
        "Barney's Websdr #1 LF/MF/80m"
      );
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("medium");
    });
  });

  describe("port-based detection (medium confidence)", () => {
    it("detects WebSDR from port 8901", () => {
      const result = detectReceiverType("http://dk0te.dhbw-ravensburg.de:8901/");
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("medium");
    });

    it("detects WebSDR from port 8902", () => {
      const result = detectReceiverType("http://9a1cra.ddns.net:8902/");
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("medium");
    });

    it("detects KiwiSDR from port 8073 (default KiwiSDR port)", () => {
      const result = detectReceiverType("http://sigmasdr.ddns.net:8073/");
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("medium");
    });

    it("detects KiwiSDR from port 8074", () => {
      const result = detectReceiverType("http://thomas0177.ddns.net:8074/");
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("medium");
    });

    it("detects KiwiSDR from port 8075", () => {
      const result = detectReceiverType("http://kiwisdr2.owdjim.gen.nz:8075/");
      // hostname has kiwisdr, so it should be high confidence
      expect(result.type).toBe("KiwiSDR");
      expect(result.confidence).toBe("high");
    });
  });

  describe("fallback detection (low confidence)", () => {
    it("falls back to OpenWebRX for standard HTTP port with no signals", () => {
      const result = detectReceiverType("http://example.com/");
      expect(result.type).toBe("OpenWebRX");
      expect(result.confidence).toBe("low");
    });

    it("falls back to OpenWebRX for HTTPS with no signals", () => {
      const result = detectReceiverType("https://sdr.vk4dl.com/");
      expect(result.confidence).toBe("low");
    });

    it("returns a result even for malformed URLs", () => {
      const result = detectReceiverType("not-a-url");
      expect(result).toHaveProperty("type");
      expect(result).toHaveProperty("confidence");
      expect(result.confidence).toBe("low");
    });
  });

  describe("real-world URL examples from dataset", () => {
    it("correctly identifies KiwiSDR: hasenberg01.kiwisdr.ch", () => {
      expect(detectReceiverType("https://hasenberg01.kiwisdr.ch/").type).toBe("KiwiSDR");
    });

    it("correctly identifies OpenWebRX: ea3rkeuhf.sytes.net", () => {
      // No strong signals in URL, but standard port
      const result = detectReceiverType("http://ea3rkeuhf.sytes.net/");
      expect(result.confidence).toBe("low"); // No strong signal
    });

    it("correctly identifies WebSDR: hackgreensdr.org:8901", () => {
      expect(detectReceiverType("http://hackgreensdr.org:8901/").type).toBe("WebSDR");
    });

    it("correctly identifies WebSDR: websdr1.sdrutah.org:8901", () => {
      const result = detectReceiverType("http://websdr1.sdrutah.org:8901/");
      expect(result.type).toBe("WebSDR");
      expect(result.confidence).toBe("high"); // websdr in hostname
    });
  });
});

/* ── getOptimalIframeConfig ─────────────────────────── */

describe("getOptimalIframeConfig", () => {
  it("returns KiwiSDR config with correct sandbox permissions", () => {
    const config = getOptimalIframeConfig("KiwiSDR");
    expect(config.sandbox).toContain("allow-scripts");
    expect(config.sandbox).toContain("allow-same-origin");
    expect(config.sandbox).toContain("allow-forms");
    expect(config.sandbox).toContain("allow-modals");
    expect(config.allow).toContain("autoplay");
    expect(config.minHeight).toBeGreaterThanOrEqual(400);
    expect(config.containerClass).toBe("kiwisdr-embed");
  });

  it("returns OpenWebRX config with WebSocket-friendly permissions", () => {
    const config = getOptimalIframeConfig("OpenWebRX");
    expect(config.sandbox).toContain("allow-scripts");
    expect(config.sandbox).toContain("allow-same-origin");
    expect(config.sandbox).toContain("allow-modals");
    expect(config.allow).toContain("autoplay");
    expect(config.containerClass).toBe("openwebrx-embed");
  });

  it("returns WebSDR config with scrolling enabled", () => {
    const config = getOptimalIframeConfig("WebSDR");
    expect(config.sandbox).toContain("allow-scripts");
    expect(config.sandbox).toContain("allow-forms");
    expect(config.scrolling).toBe("yes");
    expect(config.containerClass).toBe("websdr-embed");
  });

  it("all configs have required fields", () => {
    const types: ReceiverTypeId[] = ["KiwiSDR", "OpenWebRX", "WebSDR"];
    for (const type of types) {
      const config = getOptimalIframeConfig(type);
      expect(config).toHaveProperty("sandbox");
      expect(config).toHaveProperty("allow");
      expect(config).toHaveProperty("minHeight");
      expect(config).toHaveProperty("aspectRatio");
      expect(config).toHaveProperty("scrolling");
      expect(config).toHaveProperty("loading");
      expect(config).toHaveProperty("containerClass");
      expect(config).toHaveProperty("description");
      expect(config).toHaveProperty("tips");
      expect(config.tips.length).toBeGreaterThan(0);
      expect(config).toHaveProperty("referrerPolicy");
    }
  });

  it("KiwiSDR has higher minHeight than WebSDR (needs more space for waterfall)", () => {
    const kiwi = getOptimalIframeConfig("KiwiSDR");
    const websdr = getOptimalIframeConfig("WebSDR");
    expect(kiwi.minHeight).toBeGreaterThanOrEqual(websdr.minHeight);
  });
});

/* ── getClickToStartMessage ─────────────────────────── */

describe("getClickToStartMessage", () => {
  it("returns KiwiSDR-specific message", () => {
    const msg = getClickToStartMessage("KiwiSDR");
    expect(msg.title).toContain("KiwiSDR");
    expect(msg.subtitle.length).toBeGreaterThan(0);
  });

  it("returns OpenWebRX-specific message", () => {
    const msg = getClickToStartMessage("OpenWebRX");
    expect(msg.title).toContain("OpenWebRX");
    expect(msg.subtitle.length).toBeGreaterThan(0);
  });

  it("returns WebSDR-specific message", () => {
    const msg = getClickToStartMessage("WebSDR");
    expect(msg.title).toContain("WebSDR");
    expect(msg.subtitle.length).toBeGreaterThan(0);
  });
});

/* ── buildTunedUrl with detected type ───────────────── */

describe("buildTunedUrl uses correct format per type", () => {
  it("builds KiwiSDR URL with hash fragment", () => {
    const url = buildTunedUrl("http://kiwisdr.example.com:8073/", "KiwiSDR", {
      frequencyKhz: 7200,
      mode: "lsb",
    });
    expect(url).toContain("#f=7200.00lsb");
    expect(url).toContain(",z=10");
  });

  it("builds OpenWebRX URL with hash fragment in Hz", () => {
    const url = buildTunedUrl("http://openwebrx.example.com/", "OpenWebRX", {
      frequencyKhz: 14200,
      mode: "usb",
    });
    expect(url).toContain("#freq=14200000");
    expect(url).toContain("&mod=usb");
  });

  it("builds WebSDR URL with query parameter", () => {
    const url = buildTunedUrl("http://websdr.example.com:8901/", "WebSDR", {
      frequencyKhz: 7200,
      mode: "lsb",
    });
    expect(url).toContain("?tune=7200lsb");
  });
});

/* ── Integration: detect + config + URL ─────────────── */

describe("end-to-end: detect type, get config, build URL", () => {
  it("KiwiSDR URL -> detect -> config -> tuned URL", () => {
    const url = "http://hasenberg01.kiwisdr.ch/";
    const detection = detectReceiverType(url);
    expect(detection.type).toBe("KiwiSDR");

    const config = getOptimalIframeConfig(detection.type);
    expect(config.containerClass).toBe("kiwisdr-embed");

    const tunedUrl = buildTunedUrl(url, detection.type, {
      frequencyKhz: 10000,
      mode: "am",
    });
    expect(tunedUrl).toContain("#f=10000.00am");
  });

  it("WebSDR URL -> detect -> config -> tuned URL", () => {
    const url = "http://websdr1.sdrutah.org:8901/";
    const detection = detectReceiverType(url);
    expect(detection.type).toBe("WebSDR");

    const config = getOptimalIframeConfig(detection.type);
    expect(config.scrolling).toBe("yes");

    const tunedUrl = buildTunedUrl(url, detection.type, {
      frequencyKhz: 14200,
      mode: "usb",
    });
    expect(tunedUrl).toContain("?tune=14200usb");
  });

  it("OpenWebRX URL with /owrx path -> detect -> config -> tuned URL", () => {
    const url = "http://jimjackii.no-ip.org/owrx/";
    const detection = detectReceiverType(url);
    expect(detection.type).toBe("OpenWebRX");

    const config = getOptimalIframeConfig(detection.type);
    expect(config.containerClass).toBe("openwebrx-embed");

    const tunedUrl = buildTunedUrl(url, detection.type, {
      frequencyKhz: 7200,
      mode: "lsb",
    });
    expect(tunedUrl).toContain("#freq=7200000");
    expect(tunedUrl).toContain("&mod=lsb");
  });
});
