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

/** Export logs for a specific station as CSV */
export function exportStationLogAsCsv(stationLabel: string, receiverUrl: string): string {
  const entries = getStationLogs(stationLabel, receiverUrl);
  if (entries.length === 0) return "";

  const headers = ["Timestamp", "Online", "SNR (dB)", "Users", "Max Users", "ADC Overload", "GPS Sats", "Uptime (s)"];
  
  // Collect all band keys
  const bandKeys = new Set<string>();
  entries.forEach((e) => {
    Object.keys(e.bandSnr).forEach((k) => bandKeys.add(k));
  });
  const sortedBandKeys = Array.from(bandKeys).sort();
  sortedBandKeys.forEach((k) => headers.push(`SNR: ${k}`));

  const rows = entries.map((e) => {
    const base = [
      e.ts,
      e.online ? "Yes" : "No",
      e.snr >= 0 ? e.snr.toString() : "N/A",
      e.users >= 0 ? e.users.toString() : "N/A",
      e.usersMax >= 0 ? e.usersMax.toString() : "N/A",
      e.adcOverload ? "Yes" : "No",
      e.gps >= 0 ? e.gps.toString() : "N/A",
      e.uptime >= 0 ? e.uptime.toString() : "N/A",
    ];
    sortedBandKeys.forEach((k) => {
      base.push(e.bandSnr[k] !== undefined ? e.bandSnr[k].toString() : "N/A");
    });
    return base.join(",");
  });

  return [headers.join(","), ...rows].join("\n");
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
