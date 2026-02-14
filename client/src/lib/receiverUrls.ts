/**
 * receiverUrls.ts — Smart URL builder for SDR receivers
 * 
 * Builds auto-tuned URLs for KiwiSDR, OpenWebRX, and WebSDR receivers
 * with frequency, mode, and other parameters pre-filled.
 * 
 * KiwiSDR:   http://host:port/#f=<freq_kHz><mode>,z=<zoom>
 * OpenWebRX: http://host:port/#freq=<freq_Hz>&mod=<mode>
 * WebSDR:    http://host:port/?tune=<freq_kHz><mode>
 */

export type SDRMode = "am" | "amn" | "usb" | "lsb" | "cw" | "cwn" | "nbfm" | "wfm" | "iq" | "drm";

export interface TuneParams {
  frequencyKhz: number;
  mode?: SDRMode;
  zoom?: number;  // KiwiSDR only: 0-14
}

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

/**
 * Build a tuned URL for a KiwiSDR receiver
 */
export function buildKiwiUrl(baseUrl: string, params: TuneParams): string {
  const url = baseUrl.replace(/\/$/, "").replace(/#.*$/, "");
  const mode = kiwiMode(params.mode || suggestMode(params.frequencyKhz));
  const zoom = params.zoom ?? 10;
  return `${url}/#f=${params.frequencyKhz.toFixed(2)}${mode},z=${zoom}`;
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
