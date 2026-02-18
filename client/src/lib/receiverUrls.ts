/**
 * receiverUrls.ts — Smart URL builder and auto-detection for SDR receivers
 * 
 * Builds auto-tuned URLs for KiwiSDR, OpenWebRX, and WebSDR receivers
 * with frequency, mode, and other parameters pre-filled.
 * 
 * Auto-detects receiver type from URL patterns (port, hostname, path)
 * and provides optimal iframe embed configuration per type.
 * 
 * KiwiSDR:   http://host:port/#f=<freq_kHz><mode>,z=<zoom>
 * OpenWebRX: http://host:port/#freq=<freq_Hz>&mod=<mode>
 * WebSDR:    http://host:port/?tune=<freq_kHz><mode>
 */

export type SDRMode = "am" | "amn" | "usb" | "lsb" | "cw" | "cwn" | "nbfm" | "wfm" | "iq" | "drm";

export type ReceiverTypeId = "KiwiSDR" | "OpenWebRX" | "WebSDR";

export interface TuneParams {
  frequencyKhz: number;
  mode?: SDRMode;
  zoom?: number;  // KiwiSDR only: 0-14
}

/* ── Auto-Detection ─────────────────────────────────── */

/**
 * Detection result with confidence level.
 * High confidence = strong URL signal (e.g., "kiwisdr" in hostname).
 * Medium = port-based heuristic.
 * Low = fallback guess.
 */
export interface DetectionResult {
  type: ReceiverTypeId;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Auto-detect receiver type from a URL.
 * 
 * Uses a multi-signal scoring approach:
 *   1. Hostname keywords (kiwisdr, openwebrx, owrx, websdr)
 *   2. Path keywords (/owrx, /openwebrx, /websdr)
 *   3. Port heuristics (8073 = likely KiwiSDR, 890x = likely WebSDR)
 *   4. Receiver label text (if provided)
 * 
 * Returns the most likely type with a confidence level.
 */
export function detectReceiverType(
  url: string,
  label?: string
): DetectionResult {
  try {
    const parsed = new URL(url);
    const host = (parsed.hostname || "").toLowerCase();
    const path = (parsed.pathname || "").toLowerCase();
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "https:" ? 443 : 80);
    const labelLower = (label || "").toLowerCase();

    // ── 1. Hostname keywords (highest confidence) ──
    if (host.includes("kiwisdr") || host.includes("kiwi-sdr")) {
      return { type: "KiwiSDR", confidence: "high", reason: "hostname contains 'kiwisdr'" };
    }
    if (host.includes("openwebrx") || host.includes("owrx")) {
      return { type: "OpenWebRX", confidence: "high", reason: "hostname contains 'openwebrx/owrx'" };
    }
    if (host.includes("websdr") && !host.includes("openwebrx")) {
      // "websdr" in hostname but NOT "openwebrx" (some OpenWebRX instances use websdr.* domains)
      // Check if port suggests OpenWebRX
      if (port === 8073 || port === 8074 || port === 8076 || port === 8077) {
        return { type: "OpenWebRX", confidence: "medium", reason: "websdr hostname but OpenWebRX-typical port" };
      }
      return { type: "WebSDR", confidence: "high", reason: "hostname contains 'websdr'" };
    }

    // ── 2. Path keywords ──
    if (path.includes("/owrx") || path.includes("/openwebrx")) {
      return { type: "OpenWebRX", confidence: "high", reason: "path contains '/owrx' or '/openwebrx'" };
    }
    if (path.includes("/websdr")) {
      return { type: "WebSDR", confidence: "high", reason: "path contains '/websdr'" };
    }

    // ── 3. Label text (medium confidence) ──
    if (labelLower.includes("kiwisdr") || labelLower.includes("kiwi sdr")) {
      return { type: "KiwiSDR", confidence: "medium", reason: "label mentions KiwiSDR" };
    }
    if (labelLower.includes("openwebrx") || labelLower.includes("owrx")) {
      return { type: "OpenWebRX", confidence: "medium", reason: "label mentions OpenWebRX" };
    }
    if (labelLower.includes("websdr") || labelLower.includes("web sdr")) {
      return { type: "WebSDR", confidence: "medium", reason: "label mentions WebSDR" };
    }

    // ── 4. Port heuristics (medium confidence) ──
    // Port 8901-8910: almost exclusively WebSDR (56 WebSDR vs 3 OpenWebRX in dataset)
    if (port >= 8901 && port <= 8910) {
      return { type: "WebSDR", confidence: "medium", reason: `port ${port} is typical for WebSDR` };
    }
    // Port 8073: shared between KiwiSDR (730) and OpenWebRX (181) — lean KiwiSDR
    if (port === 8073) {
      return { type: "KiwiSDR", confidence: "medium", reason: "port 8073 is the default KiwiSDR port" };
    }
    // Port 8074-8079: mostly KiwiSDR (63+28+8+7+4+3 = 113 KiwiSDR vs ~30 OpenWebRX)
    if (port >= 8074 && port <= 8079) {
      return { type: "KiwiSDR", confidence: "medium", reason: `port ${port} is commonly used by KiwiSDR` };
    }
    // Port 8080-8090: mixed, but OpenWebRX slightly more common
    if (port >= 8080 && port <= 8090) {
      return { type: "OpenWebRX", confidence: "low", reason: `port ${port} — could be OpenWebRX or WebSDR` };
    }
    // Port 8100: WebSDR sometimes
    if (port === 8100) {
      return { type: "WebSDR", confidence: "low", reason: "port 8100 sometimes used by WebSDR" };
    }

    // ── 5. Default fallback ──
    // Standard HTTP ports with no other signals — most common is OpenWebRX on 80/443
    if (port === 80 || port === 443) {
      return { type: "OpenWebRX", confidence: "low", reason: "standard port with no distinguishing signals" };
    }

    return { type: "KiwiSDR", confidence: "low", reason: "no distinguishing signals found" };
  } catch {
    return { type: "KiwiSDR", confidence: "low", reason: "could not parse URL" };
  }
}

/* ── Optimal Iframe Configuration ───────────────────── */

/**
 * Iframe configuration optimized for each receiver type.
 * Each receiver has different requirements for sandbox permissions,
 * feature policies, and display characteristics.
 */
export interface IframeConfig {
  /** Sandbox attribute string for the iframe */
  sandbox: string;
  /** Allow attribute string for feature policies */
  allow: string;
  /** Recommended minimum height in pixels */
  minHeight: number;
  /** Recommended aspect ratio (width:height) */
  aspectRatio: string;
  /** Whether to enable scrolling in the iframe */
  scrolling: "auto" | "yes" | "no";
  /** Loading strategy */
  loading: "eager" | "lazy";
  /** CSS class for the iframe container */
  containerClass: string;
  /** Description of what the user will see */
  description: string;
  /** Tips for optimal usage */
  tips: string[];
  /** Whether the receiver supports audio autoplay */
  supportsAutoplay: boolean;
  /** Whether the receiver needs user interaction to start */
  needsClickToStart: boolean;
  /** Referrer policy */
  referrerPolicy: string;
}

/**
 * Get optimal iframe configuration for a receiver type.
 * 
 * Each receiver type has different technical requirements:
 * 
 * - **KiwiSDR**: Needs audio context, WebSocket, and canvas for waterfall display.
 *   Uses a custom JavaScript audio pipeline. Requires allow-scripts and allow-same-origin.
 *   The waterfall display is canvas-based and benefits from larger viewport.
 * 
 * - **OpenWebRX**: Modern web app using WebSocket audio streaming and HTML5 canvas.
 *   Needs audio context, WebSocket, and sometimes WebGL for spectrum display.
 *   More responsive layout that adapts to container size.
 * 
 * - **WebSDR**: Classic Java-applet-era design using HTML5 audio and canvas waterfall.
 *   Simpler requirements but needs forms for frequency input and mode selection.
 *   Fixed-width layout that may need scrolling.
 */
export function getOptimalIframeConfig(receiverType: ReceiverTypeId): IframeConfig {
  switch (receiverType) {
    case "KiwiSDR":
      return {
        // KiwiSDR needs: WebSocket for audio/waterfall streaming, AudioContext/AudioWorklet
        // for audio processing, Canvas for waterfall rendering, localStorage for settings.
        // allow-top-navigation-by-user-activation: some KiwiSDR versions redirect during init.
        // allow-downloads: for REC (WAV recording) feature.
        sandbox: "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads allow-top-navigation-by-user-activation",
        allow: "autoplay; microphone; fullscreen; web-share",
        minHeight: 500,
        aspectRatio: "16/9",
        scrolling: "auto",
        loading: "eager",
        containerClass: "kiwisdr-embed",
        description: "KiwiSDR waterfall display with real-time spectrum analysis",
        tips: [
          "Click the waterfall to tune to a frequency",
          "Use the zoom slider to narrow the displayed bandwidth",
          "The REC button records audio in WAV format",
          "Keyboard: arrow keys adjust frequency, +/- adjusts zoom",
        ],
        supportsAutoplay: false,
        needsClickToStart: true,
        referrerPolicy: "no-referrer-when-downgrade",
      };

    case "OpenWebRX":
      return {
        // OpenWebRX needs: WebSocket for audio streaming, WebGL for spectrum display,
        // AudioContext for playback, localStorage for user preferences.
        // allow-top-navigation-by-user-activation: some versions redirect to login.
        // allow-downloads: for audio recording feature.
        sandbox: "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads allow-top-navigation-by-user-activation",
        allow: "autoplay; microphone; fullscreen; web-share",
        minHeight: 450,
        aspectRatio: "16/10",
        scrolling: "auto",
        loading: "eager",
        containerClass: "openwebrx-embed",
        description: "OpenWebRX spectrum display with digital mode decoding",
        tips: [
          "Click the spectrum to tune — drag to adjust bandwidth",
          "Select mode (AM/USB/LSB/CW/NFM) from the controls",
          "Digital modes (FT8, WSPR) decode automatically when selected",
          "The secondary receiver panel allows monitoring two frequencies",
        ],
        supportsAutoplay: false,
        needsClickToStart: true,
        referrerPolicy: "no-referrer-when-downgrade",
      };

    case "WebSDR":
      return {
        // WebSDR needs: Canvas for waterfall, HTML5 audio, forms for frequency input.
        // allow-top-navigation-by-user-activation: some WebSDR instances redirect.
        // allow-downloads: for WAV recording feature.
        sandbox: "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads allow-top-navigation-by-user-activation",
        allow: "autoplay; fullscreen",
        minHeight: 400,
        aspectRatio: "4/3",
        scrolling: "yes",
        loading: "eager",
        containerClass: "websdr-embed",
        description: "WebSDR receiver with band selection and waterfall display",
        tips: [
          "Select a band from the tabs at the top",
          "Click the waterfall to tune to a signal",
          "Type a frequency in the input box and press Enter",
          "Use the 'Audio recording: Start' button to record",
        ],
        supportsAutoplay: false,
        needsClickToStart: true,
        referrerPolicy: "no-referrer-when-downgrade",
      };

    default:
      return {
        sandbox: "allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads allow-top-navigation-by-user-activation",
        allow: "autoplay; fullscreen",
        minHeight: 400,
        aspectRatio: "16/9",
        scrolling: "auto",
        loading: "eager",
        containerClass: "generic-embed",
        description: "SDR receiver",
        tips: ["Open in a new tab for the best experience"],
        supportsAutoplay: false,
        needsClickToStart: true,
        referrerPolicy: "no-referrer-when-downgrade",
      };
  }
}

/**
 * Get a human-readable click-to-start message for each receiver type.
 */
export function getClickToStartMessage(receiverType: ReceiverTypeId): {
  title: string;
  subtitle: string;
} {
  switch (receiverType) {
    case "KiwiSDR":
      return {
        title: "Click to Load KiwiSDR",
        subtitle: "The waterfall will load with a pre-filled call sign. If prompted, enter any name then click the waterfall to start listening.",
      };
    case "OpenWebRX":
      return {
        title: "Click to Load OpenWebRX",
        subtitle: "OpenWebRX will load — click anywhere on the dark area or the 'Start' button inside to activate the waterfall and audio.",
      };
    case "WebSDR":
      return {
        title: "Click to Load WebSDR",
        subtitle: "WebSDR will load. Click inside the receiver window to activate audio, then click the waterfall to tune.",
      };
    default:
      return {
        title: "Click to Load Receiver",
        subtitle: "The receiver will load. You may need to click inside the window to activate the waterfall and audio.",
      };
  }
}

/* ── Mode Mapping ───────────────────────────────────── */

/**
 * Suggest the best mode for a given frequency in kHz
 */
export function suggestMode(frequencyKhz: number): SDRMode {
  if (frequencyKhz < 500) return "am";        // LF/MF broadcast
  if (frequencyKhz < 1800) return "am";        // MW broadcast
  if (frequencyKhz < 4000) return "lsb";       // 160m/80m amateur
  if (frequencyKhz < 10000) return "usb";      // HF general
  if (frequencyKhz < 30000) return "usb";      // HF upper
  if (frequencyKhz < 108000) return "nbfm";    // VHF
  if (frequencyKhz < 174000) return "nbfm";    // VHF
  return "nbfm";                                // UHF default
}

/**
 * Map our SDRMode to each receiver type's mode string
 */
function kiwiMode(mode: SDRMode): string {
  const map: Record<SDRMode, string> = {
    am: "am", amn: "amn", usb: "usb", lsb: "lsb",
    cw: "cw", cwn: "cwn", nbfm: "nbfm", wfm: "nbfm",
    iq: "iq", drm: "drm",
  };
  return map[mode] || "am";
}

function openwebrxMode(mode: SDRMode): string {
  const map: Record<SDRMode, string> = {
    am: "am", amn: "am", usb: "usb", lsb: "lsb",
    cw: "cw", cwn: "cw", nbfm: "nfm", wfm: "wfm",
    iq: "usb", drm: "am",
  };
  return map[mode] || "am";
}

function websdrMode(mode: SDRMode): string {
  const map: Record<SDRMode, string> = {
    am: "am", amn: "am", usb: "usb", lsb: "lsb",
    cw: "cw", cwn: "cw", nbfm: "fm", wfm: "fm",
    iq: "usb", drm: "am",
  };
  return map[mode] || "am";
}

/* ── Random Ident for KiwiSDR ──────────────────────── */

/**
 * Generate a random 6-character alphanumeric ident for KiwiSDR.
 * This auto-fills the call sign dialog so users don't get blocked.
 */
function randomKiwiIdent(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/* ── URL Builders ───────────────────────────────────── */

/**
 * Build a tuned URL for a KiwiSDR receiver.
 *
 * Correct KiwiSDR URL format (per official docs):
 *   ?f=<freq_kHz><mode>z<zoom>&u=<ident>&sp
 *
 * The `u=` param auto-fills the call sign dialog (v1.431+).
 * The `sp` flag enables the spectrum display on load.
 */
export function buildKiwiUrl(baseUrl: string, params: TuneParams): string {
  const url = baseUrl.replace(/\/$/, "").replace(/[#?].*$/, "");
  const mode = kiwiMode(params.mode || suggestMode(params.frequencyKhz));
  const zoom = params.zoom ?? 10;
  const ident = randomKiwiIdent();
  return `${url}/?f=${params.frequencyKhz.toFixed(2)}${mode}z${zoom}&u=${ident}&sp`;
}

/**
 * Build a tuned URL for an OpenWebRX receiver
 */
export function buildOpenWebRxUrl(baseUrl: string, params: TuneParams): string {
  const url = baseUrl.replace(/\/$/, "").replace(/#.*$/, "");
  const mode = openwebrxMode(params.mode || suggestMode(params.frequencyKhz));
  const freqHz = Math.round(params.frequencyKhz * 1000);
  return `${url}/#freq=${freqHz}&mod=${mode}`;
}

/**
 * Build a tuned URL for a WebSDR receiver
 */
export function buildWebSdrUrl(baseUrl: string, params: TuneParams): string {
  const url = baseUrl.replace(/\/$/, "").replace(/\?.*$/, "");
  const mode = websdrMode(params.mode || suggestMode(params.frequencyKhz));
  return `${url}/?tune=${params.frequencyKhz.toFixed(0)}${mode}`;
}

/**
 * Build a tuned URL for any receiver type
 */
export function buildTunedUrl(
  baseUrl: string,
  receiverType: string,
  params: TuneParams
): string {
  switch (receiverType) {
    case "KiwiSDR":
      return buildKiwiUrl(baseUrl, params);
    case "OpenWebRX":
      return buildOpenWebRxUrl(baseUrl, params);
    case "WebSDR":
      return buildWebSdrUrl(baseUrl, params);
    default:
      return baseUrl;
  }
}

/**
 * Append KiwiSDR-specific params (call sign + spectrum) to a base receiver URL.
 * Used when no custom tuning is applied but we still want to bypass the call sign dialog.
 */
export function appendKiwiIdentToUrl(baseUrl: string): string {
  const ident = randomKiwiIdent();
  const separator = baseUrl.includes("?") ? "&" : "/?";
  return `${baseUrl.replace(/\/$/, "")}${separator}u=${ident}&sp`;
}

/* ── Display Helpers ────────────────────────────────── */

/**
 * Format frequency for display
 */
export function formatFrequency(khz: number): string {
  if (khz >= 1000) {
    return `${(khz / 1000).toFixed(3)} MHz`;
  }
  return `${khz.toFixed(1)} kHz`;
}

/**
 * Parse a frequency string like "14.100 MHz" or "7100 kHz" to kHz
 */
export function parseFrequencyToKhz(freqStr: string): number | null {
  const mhzMatch = freqStr.match(/([\d.]+)\s*MHz/i);
  if (mhzMatch) return parseFloat(mhzMatch[1]) * 1000;
  
  const khzMatch = freqStr.match(/([\d.]+)\s*kHz/i);
  if (khzMatch) return parseFloat(khzMatch[1]);
  
  const numMatch = freqStr.match(/([\d.]+)/);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    // Heuristic: if > 30000, likely Hz; if > 30, likely kHz; else MHz
    if (val > 30000) return val / 1000;
    if (val > 30) return val;
    return val * 1000;
  }
  return null;
}

/* ── Recording Info ─────────────────────────────────── */

/**
 * Recording capabilities per receiver type
 */
export interface RecordingInfo {
  supported: boolean;
  method: string;
  instructions: string[];
  formats: string[];
}

export function getRecordingInfo(receiverType: string): RecordingInfo {
  switch (receiverType) {
    case "KiwiSDR":
      return {
        supported: true,
        method: "Built-in browser recording",
        instructions: [
          "Open receiver in new tab for best experience",
          "Click the REC button in the KiwiSDR interface",
          "Recording starts immediately in WAV format",
          "Click REC again to stop — file downloads automatically",
          "For IQ recording: switch to IQ mode first, then record",
          "Tip: Use kiwirecorder.py for automated/scheduled recording",
        ],
        formats: ["WAV (audio)", "IQ (raw RF data)"],
      };
    case "OpenWebRX":
      return {
        supported: true,
        method: "Built-in audio recorder (OpenWebRX+ v1.2.7+)",
        instructions: [
          "Open receiver in new tab for best experience",
          "Look for the record/microphone icon in the interface",
          "Click to start recording — audio is captured as MP3",
          "Click again to stop and download the recording",
          "Note: Original OpenWebRX may not have recording",
          "Alternative: Use browser audio capture extensions",
        ],
        formats: ["MP3 (audio)"],
      };
    case "WebSDR":
      return {
        supported: true,
        method: "Built-in audio recording",
        instructions: [
          "Open receiver in new tab for best experience",
          "Find the 'Audio recording: Start' button below the waterfall",
          "Click Start to begin recording",
          "Click Stop when finished — WAV file downloads automatically",
          "Recording captures the demodulated audio output",
        ],
        formats: ["WAV (audio)"],
      };
    default:
      return {
        supported: false,
        method: "Unknown",
        instructions: ["Open receiver in a new tab and use browser audio capture"],
        formats: [],
      };
  }
}

/* ── Quick Tune Presets ─────────────────────────────── */

/**
 * Common amateur/broadcast frequencies for quick-tune presets
 */
export const QUICK_TUNE_PRESETS = [
  { label: "WWV Time", freq: 10000, mode: "am" as SDRMode, desc: "NIST time signal" },
  { label: "CHU Time", freq: 7850, mode: "usb" as SDRMode, desc: "Canadian time signal" },
  { label: "BBC WS", freq: 9410, mode: "am" as SDRMode, desc: "BBC World Service" },
  { label: "VOA", freq: 9760, mode: "am" as SDRMode, desc: "Voice of America" },
  { label: "CW Beacon", freq: 14100, mode: "cw" as SDRMode, desc: "20m beacon band" },
  { label: "20m SSB", freq: 14200, mode: "usb" as SDRMode, desc: "20m amateur SSB" },
  { label: "40m SSB", freq: 7200, mode: "lsb" as SDRMode, desc: "40m amateur SSB" },
  { label: "80m SSB", freq: 3800, mode: "lsb" as SDRMode, desc: "80m amateur SSB" },
  { label: "VOLMET", freq: 8957, mode: "usb" as SDRMode, desc: "Aviation weather" },
  { label: "HFGCS", freq: 8992, mode: "usb" as SDRMode, desc: "US Air Force" },
  { label: "Maritime", freq: 2182, mode: "usb" as SDRMode, desc: "Distress/calling" },
  { label: "NDB", freq: 350, mode: "am" as SDRMode, desc: "Non-directional beacon" },
];
