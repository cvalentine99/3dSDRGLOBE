/**
 * sigintLogger.ts — Signal Intelligence Logging Service
 * 
 * Automatically records signal data (SNR, status, users, band SNR) for
 * monitored stations over time. Persists to localStorage with automatic
 * pruning to keep storage bounded.
 * 
 * Storage key: "sigint-logs"
 * Max entries per station: 200 (oldest pruned first)
 * Max total stations tracked: 50
 */

/* ── Types ────────────────────────────────────────── */

export interface SigintLogEntry {
  /** ISO timestamp */
  ts: string;
  /** Online status */
  online: boolean;
  /** Overall SNR in dB (-1 if unavailable) */
  snr: number;
  /** Active users (-1 if unavailable) */
  users: number;
  /** Max users (-1 if unavailable) */
  usersMax: number;
  /** ADC overload flag */
  adcOverload: boolean;
  /** GPS satellites locked (-1 if unavailable) */
  gps: number;
  /** Uptime in seconds (-1 if unavailable) */
  uptime: number;
  /** Per-band SNR snapshots (band label → dB) */
  bandSnr: Record<string, number>;
}

export interface StationLog {
  /** Station identifier (label used as key) */
  stationLabel: string;
  /** Receiver URL being monitored */
  receiverUrl: string;
  /** Receiver type */
  receiverType: string;
  /** First log timestamp */
  firstSeen: string;
  /** Last log timestamp */
  lastSeen: string;
  /** Whether auto-logging is enabled for this station */
  monitoring: boolean;
  /** Log entries sorted by timestamp ascending */
  entries: SigintLogEntry[];
}

export interface SigintLogStore {
  version: number;
  stations: Record<string, StationLog>;
}

/* ── Constants ────────────────────────────────────── */

const STORAGE_KEY = "sigint-logs";
const MAX_ENTRIES_PER_STATION = 200;
const MAX_STATIONS = 50;
const STORE_VERSION = 1;

/* ── Helpers ──────────────────────────────────────── */

function loadStore(): SigintLogStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: STORE_VERSION, stations: {} };
    const parsed = JSON.parse(raw);
    if (parsed.version !== STORE_VERSION) return { version: STORE_VERSION, stations: {} };
    return parsed;
  } catch {
    return { version: STORE_VERSION, stations: {} };
  }
}

function saveStore(store: SigintLogStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full — prune oldest stations
    const keys = Object.keys(store.stations);
    if (keys.length > 5) {
      const sorted = keys.sort((a, b) => {
        const aLast = store.stations[a].lastSeen;
        const bLast = store.stations[b].lastSeen;
        return aLast.localeCompare(bLast);
      });
      // Remove oldest 25%
      const toRemove = Math.ceil(sorted.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        delete store.stations[sorted[i]];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch {
        // Give up
      }
    }
  }
}

/** Generate a stable key for a station */
export function stationKey(stationLabel: string, receiverUrl: string): string {
  return `${stationLabel}|||${receiverUrl}`;
}

/* ── Public API ───────────────────────────────────── */

/** Record a new log entry for a station */
export function logSignalData(
  stationLabel: string,
  receiverUrl: string,
  receiverType: string,
  entry: Omit<SigintLogEntry, "ts">
): void {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  const now = new Date().toISOString();

  if (!store.stations[key]) {
    // Enforce max stations limit
    const stationKeys = Object.keys(store.stations);
    if (stationKeys.length >= MAX_STATIONS) {
      // Remove the least recently seen station
      const oldest = stationKeys.sort((a, b) =>
        store.stations[a].lastSeen.localeCompare(store.stations[b].lastSeen)
      )[0];
      delete store.stations[oldest];
    }

    store.stations[key] = {
      stationLabel,
      receiverUrl,
      receiverType,
      firstSeen: now,
      lastSeen: now,
      monitoring: true,
      entries: [],
    };
  }

  const stationLog = store.stations[key];
  stationLog.lastSeen = now;

  const fullEntry: SigintLogEntry = { ...entry, ts: now };
  stationLog.entries.push(fullEntry);

  // Prune if over limit
  if (stationLog.entries.length > MAX_ENTRIES_PER_STATION) {
    stationLog.entries = stationLog.entries.slice(-MAX_ENTRIES_PER_STATION);
  }

  saveStore(store);
}

/** Get all log entries for a specific station/receiver */
export function getStationLogs(stationLabel: string, receiverUrl: string): SigintLogEntry[] {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  return store.stations[key]?.entries || [];
}

/** Get the full station log object */
export function getStationLog(stationLabel: string, receiverUrl: string): StationLog | null {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  return store.stations[key] || null;
}

/** Get all monitored stations */
export function getAllMonitoredStations(): StationLog[] {
  const store = loadStore();
  return Object.values(store.stations).sort((a, b) =>
    b.lastSeen.localeCompare(a.lastSeen)
  );
}

/** Toggle monitoring for a station */
export function toggleMonitoring(stationLabel: string, receiverUrl: string): boolean {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  if (store.stations[key]) {
    store.stations[key].monitoring = !store.stations[key].monitoring;
    saveStore(store);
    return store.stations[key].monitoring;
  }
  return false;
}

/** Clear all logs for a specific station */
export function clearStationLogs(stationLabel: string, receiverUrl: string): void {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  if (store.stations[key]) {
    store.stations[key].entries = [];
    saveStore(store);
  }
}

/** Remove a station from the log entirely */
export function removeStationFromLog(stationLabel: string, receiverUrl: string): void {
  const store = loadStore();
  const key = stationKey(stationLabel, receiverUrl);
  delete store.stations[key];
  saveStore(store);
}

/** Clear all logs */
export function clearAllLogs(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Export all logs as a JSON string */
export function exportLogsAsJson(): string {
  const store = loadStore();
  return JSON.stringify(store, null, 2);
}

/** Export logs for a specific station as CSV with peak/trough annotations */
export function exportStationLogAsCsv(stationLabel: string, receiverUrl: string): string {
  const entries = getStationLogs(stationLabel, receiverUrl);
  if (entries.length === 0) return "";

  // Run peak/trough detection
  const dataPoints = entries.map((e, idx) => ({
    ts: new Date(e.ts).getTime(),
    val: e.snr >= 0 ? e.snr : 0,
    idx,
  })).filter((d) => d.val > 0);

  // Import-free peak detection (inline simplified version)
  const extremaMap = new Map<number, { type: string; prominence: number; severity: string }>();
  if (dataPoints.length >= 3) {
    const vals = dataPoints.map((d) => d.val);
    const globalMax = Math.max(...vals);
    const globalMin = Math.min(...vals);
    const range = globalMax - globalMin;
    if (range >= 2) {
      const minProm = range * 0.12;
      for (let i = 1; i < vals.length - 1; i++) {
        // Local maxima
        if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1]) {
          const prom = calcProm(vals, i, "peak");
          if (prom >= minProm) {
            extremaMap.set(dataPoints[i].idx, {
              type: "PEAK",
              prominence: Math.round(prom * 10) / 10,
              severity: prom >= range * 0.3 ? "MAJOR" : "MINOR",
            });
          }
        }
        // Local minima
        if (vals[i] < vals[i - 1] && vals[i] <= vals[i + 1]) {
          const prom = calcProm(vals, i, "trough");
          if (prom >= minProm) {
            extremaMap.set(dataPoints[i].idx, {
              type: "TROUGH",
              prominence: Math.round(prom * 10) / 10,
              severity: prom >= range * 0.3 ? "MAJOR" : "MINOR",
            });
          }
        }
      }
    }
  }

  // Build CSV
  const headers = [
    "Timestamp", "Online", "SNR (dB)", "Users", "Max Users",
    "ADC Overload", "GPS Sats", "Uptime (s)",
    "Event Type", "Prominence (dB)", "Severity",
  ];

  // Collect all band keys
  const bandKeys = new Set<string>();
  entries.forEach((e) => {
    Object.keys(e.bandSnr).forEach((k) => bandKeys.add(k));
  });
  const sortedBandKeys = Array.from(bandKeys).sort();
  sortedBandKeys.forEach((k) => headers.push(`SNR: ${k}`));

  const rows = entries.map((e, idx) => {
    const ext = extremaMap.get(idx);
    const base = [
      e.ts,
      e.online ? "Yes" : "No",
      e.snr >= 0 ? e.snr.toString() : "N/A",
      e.users >= 0 ? e.users.toString() : "N/A",
      e.usersMax >= 0 ? e.usersMax.toString() : "N/A",
      e.adcOverload ? "Yes" : "No",
      e.gps >= 0 ? e.gps.toString() : "N/A",
      e.uptime >= 0 ? e.uptime.toString() : "N/A",
      ext ? ext.type : "",
      ext ? ext.prominence.toString() : "",
      ext ? ext.severity : "",
    ];
    sortedBandKeys.forEach((k) => {
      base.push(e.bandSnr[k] !== undefined ? e.bandSnr[k].toString() : "N/A");
    });
    return base.map(csvEscape).join(",");
  });

  // Summary section
  const summary = getLogSummary(stationLabel, receiverUrl);
  const peakEvents = Array.from(extremaMap.values()).filter((e) => e.type === "PEAK");
  const troughEvents = Array.from(extremaMap.values()).filter((e) => e.type === "TROUGH");

  const summaryLines = [
    `# Valentine RF - SigINT Export`,
    `# Station: ${csvEscape(stationLabel)}`,
    `# Receiver: ${csvEscape(receiverUrl)}`,
    `# Export Date: ${new Date().toISOString()}`,
    `# Total Entries: ${entries.length}`,
    summary ? `# Avg SNR: ${summary.avgSnr} dB` : "",
    summary ? `# Max SNR: ${summary.maxSnr} dB` : "",
    summary ? `# Min SNR: ${summary.minSnr} dB` : "",
    summary ? `# Uptime: ${summary.uptimePercent}%` : "",
    summary ? `# Time Span: ${summary.timeSpanHours} hours` : "",
    `# Peaks Detected: ${peakEvents.length}`,
    `# Troughs Detected: ${troughEvents.length}`,
    `# Major Events: ${Array.from(extremaMap.values()).filter((e) => e.severity === "MAJOR").length}`,
    `#`,
  ].filter(Boolean);

  return [...summaryLines, headers.join(","), ...rows].join("\n");
}

/** Export ALL monitored stations as a combined CSV report */
export function exportAllStationsCsv(): string {
  const store = loadStore();
  const stations = Object.values(store.stations);
  if (stations.length === 0) return "";

  const lines: string[] = [
    `# Valentine RF - SigINT Full Export`,
    `# Export Date: ${new Date().toISOString()}`,
    `# Total Stations: ${stations.length}`,
    `# Total Entries: ${stations.reduce((sum, s) => sum + s.entries.length, 0)}`,
    `#`,
  ];

  // Station summary table
  lines.push("Station,Receiver URL,Type,First Seen,Last Seen,Entries,Avg SNR (dB),Max SNR (dB),Min SNR (dB),Uptime %,Peaks,Troughs,Major Events");

  for (const station of stations) {
    const summary = getLogSummary(station.stationLabel, station.receiverUrl);
    // Detect peaks/troughs for this station
    const dataPoints = station.entries.map((e, idx) => ({
      ts: new Date(e.ts).getTime(),
      val: e.snr >= 0 ? e.snr : 0,
      idx,
    })).filter((d) => d.val > 0);

    let peaks = 0, troughs = 0, major = 0;
    if (dataPoints.length >= 3) {
      const vals = dataPoints.map((d) => d.val);
      const range = Math.max(...vals) - Math.min(...vals);
      if (range >= 2) {
        const minProm = range * 0.12;
        for (let i = 1; i < vals.length - 1; i++) {
          if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1]) {
            const prom = calcProm(vals, i, "peak");
            if (prom >= minProm) { peaks++; if (prom >= range * 0.3) major++; }
          }
          if (vals[i] < vals[i - 1] && vals[i] <= vals[i + 1]) {
            const prom = calcProm(vals, i, "trough");
            if (prom >= minProm) { troughs++; if (prom >= range * 0.3) major++; }
          }
        }
      }
    }

    lines.push([
      csvEscape(station.stationLabel),
      csvEscape(station.receiverUrl),
      station.receiverType,
      station.firstSeen,
      station.lastSeen,
      station.entries.length.toString(),
      summary ? summary.avgSnr.toString() : "N/A",
      summary ? summary.maxSnr.toString() : "N/A",
      summary ? summary.minSnr.toString() : "N/A",
      summary ? summary.uptimePercent.toString() : "N/A",
      peaks.toString(),
      troughs.toString(),
      major.toString(),
    ].join(","));
  }

  // Detailed entries for each station
  lines.push("");
  lines.push("# ── Detailed Entries ──");

  for (const station of stations) {
    if (station.entries.length === 0) continue;
    lines.push("");
    lines.push(`# Station: ${station.stationLabel}`);

    const bandKeys = new Set<string>();
    station.entries.forEach((e) => Object.keys(e.bandSnr).forEach((k) => bandKeys.add(k)));
    const sortedBands = Array.from(bandKeys).sort();

    const detailHeaders = [
      "Timestamp", "Online", "SNR (dB)", "Users", "Max Users",
      "ADC Overload", "GPS Sats", "Uptime (s)",
      "Event Type", "Prominence (dB)", "Severity",
      ...sortedBands.map((b) => `SNR: ${b}`),
    ];
    lines.push(detailHeaders.join(","));

    // Detect peaks for this station
    const dataPoints = station.entries.map((e, idx) => ({
      ts: new Date(e.ts).getTime(),
      val: e.snr >= 0 ? e.snr : 0,
      idx,
    })).filter((d) => d.val > 0);

    const extMap = new Map<number, { type: string; prominence: number; severity: string }>();
    if (dataPoints.length >= 3) {
      const vals = dataPoints.map((d) => d.val);
      const range = Math.max(...vals) - Math.min(...vals);
      if (range >= 2) {
        const minProm = range * 0.12;
        for (let i = 1; i < vals.length - 1; i++) {
          if (vals[i] > vals[i - 1] && vals[i] >= vals[i + 1]) {
            const prom = calcProm(vals, i, "peak");
            if (prom >= minProm) {
              extMap.set(dataPoints[i].idx, {
                type: "PEAK", prominence: Math.round(prom * 10) / 10,
                severity: prom >= range * 0.3 ? "MAJOR" : "MINOR",
              });
            }
          }
          if (vals[i] < vals[i - 1] && vals[i] <= vals[i + 1]) {
            const prom = calcProm(vals, i, "trough");
            if (prom >= minProm) {
              extMap.set(dataPoints[i].idx, {
                type: "TROUGH", prominence: Math.round(prom * 10) / 10,
                severity: prom >= range * 0.3 ? "MAJOR" : "MINOR",
              });
            }
          }
        }
      }
    }

    station.entries.forEach((e, idx) => {
      const ext = extMap.get(idx);
      const row = [
        e.ts,
        e.online ? "Yes" : "No",
        e.snr >= 0 ? e.snr.toString() : "N/A",
        e.users >= 0 ? e.users.toString() : "N/A",
        e.usersMax >= 0 ? e.usersMax.toString() : "N/A",
        e.adcOverload ? "Yes" : "No",
        e.gps >= 0 ? e.gps.toString() : "N/A",
        e.uptime >= 0 ? e.uptime.toString() : "N/A",
        ext ? ext.type : "",
        ext ? ext.prominence.toString() : "",
        ext ? ext.severity : "",
        ...sortedBands.map((b) => e.bandSnr[b] !== undefined ? e.bandSnr[b].toString() : "N/A"),
      ];
      lines.push(row.map(csvEscape).join(","));
    });
  }

  return lines.join("\n");
}

/** Inline prominence calculation for CSV export (avoids circular imports) */
function calcProm(values: number[], idx: number, type: "peak" | "trough"): number {
  const val = values[idx];
  if (type === "peak") {
    let leftMin = val;
    for (let i = idx - 1; i >= 0; i--) {
      leftMin = Math.min(leftMin, values[i]);
      if (values[i] > val) break;
    }
    let rightMin = val;
    for (let i = idx + 1; i < values.length; i++) {
      rightMin = Math.min(rightMin, values[i]);
      if (values[i] > val) break;
    }
    return val - Math.max(leftMin, rightMin);
  } else {
    let leftMax = val;
    for (let i = idx - 1; i >= 0; i--) {
      leftMax = Math.max(leftMax, values[i]);
      if (values[i] < val) break;
    }
    let rightMax = val;
    for (let i = idx + 1; i < values.length; i++) {
      rightMax = Math.max(rightMax, values[i]);
      if (values[i] < val) break;
    }
    return Math.min(leftMax, rightMax) - val;
  }
}

/** Escape a CSV field value */
function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** Get summary stats for a station's logs */
export function getLogSummary(stationLabel: string, receiverUrl: string): {
  totalEntries: number;
  avgSnr: number;
  maxSnr: number;
  minSnr: number;
  uptimePercent: number;
  avgUsers: number;
  timeSpanHours: number;
} | null {
  const entries = getStationLogs(stationLabel, receiverUrl);
  if (entries.length === 0) return null;

  const snrEntries = entries.filter((e) => e.snr >= 0);
  const onlineEntries = entries.filter((e) => e.online);
  const userEntries = entries.filter((e) => e.users >= 0);

  const avgSnr = snrEntries.length > 0
    ? snrEntries.reduce((sum, e) => sum + e.snr, 0) / snrEntries.length
    : 0;
  const maxSnr = snrEntries.length > 0
    ? Math.max(...snrEntries.map((e) => e.snr))
    : 0;
  const minSnr = snrEntries.length > 0
    ? Math.min(...snrEntries.map((e) => e.snr))
    : 0;
  const avgUsers = userEntries.length > 0
    ? userEntries.reduce((sum, e) => sum + e.users, 0) / userEntries.length
    : 0;

  const first = new Date(entries[0].ts).getTime();
  const last = new Date(entries[entries.length - 1].ts).getTime();
  const timeSpanHours = (last - first) / (1000 * 60 * 60);

  return {
    totalEntries: entries.length,
    avgSnr: Math.round(avgSnr * 10) / 10,
    maxSnr,
    minSnr,
    uptimePercent: entries.length > 0
      ? Math.round((onlineEntries.length / entries.length) * 100)
      : 0,
    avgUsers: Math.round(avgUsers * 10) / 10,
    timeSpanHours: Math.round(timeSpanHours * 10) / 10,
  };
}
