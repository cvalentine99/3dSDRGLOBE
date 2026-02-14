/**
 * watchlistService.ts — Watchlist with background polling
 *
 * Allows users to mark stations for continuous monitoring.
 * Polls KiwiSDR /status endpoints at configurable intervals
 * and stores results in localStorage. Triggers alert checks
 * for each polled station.
 */

import { checkAlerts, getAlertConfig } from "./alertService";
import { logSignalData } from "./sigintLogger";

/* ── Types ────────────────────────────────────────── */

export interface WatchlistEntry {
  /** Unique key: label|lng|lat */
  key: string;
  /** Station display label */
  label: string;
  /** First receiver URL (used for polling) */
  receiverUrl: string;
  /** Receiver type */
  receiverType: string;
  /** Coordinates [lng, lat] */
  coordinates: [number, number];
  /** When the station was added to watchlist */
  addedAt: string;
  /** Last poll result */
  lastStatus?: WatchlistStatus;
  /** Last poll timestamp */
  lastPollAt?: string;
  /** User notes for this station */
  notes?: string;
  /** When notes were last updated */
  notesUpdatedAt?: string;
}

export interface WatchlistStatus {
  online: boolean;
  snr: number;
  users: number;
  usersMax: number;
  adcOverload: boolean;
  gpsGood: number;
  uptime: number;
  antenna: string;
  version: string;
  bandSnr?: Record<string, number>;
}

export interface WatchlistConfig {
  /** Enable background polling */
  enabled: boolean;
  /** Poll interval in seconds */
  intervalSeconds: number;
  /** Maximum concurrent polls */
  maxConcurrent: number;
}

export type WatchlistChangeCallback = () => void;

/* ── Constants ────────────────────────────────────── */

const WATCHLIST_KEY = "valentine-rf-watchlist";
const WATCHLIST_CONFIG_KEY = "valentine-rf-watchlist-config";

const DEFAULT_CONFIG: WatchlistConfig = {
  enabled: true,
  intervalSeconds: 60,
  maxConcurrent: 5,
};

/* ── State ────────────────────────────────────────── */

let entries: Map<string, WatchlistEntry> = new Map();
let config: WatchlistConfig = DEFAULT_CONFIG;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
let changeListeners: WatchlistChangeCallback[] = [];

/* ── Persistence ──────────────────────────────────── */

function loadEntries(): Map<string, WatchlistEntry> {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw) {
      const arr: WatchlistEntry[] = JSON.parse(raw);
      const map = new Map<string, WatchlistEntry>();
      arr.forEach((e) => map.set(e.key, e));
      return map;
    }
  } catch { /* ignore */ }
  return new Map();
}

function saveEntries() {
  try {
    localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify(Array.from(entries.values()))
    );
  } catch { /* ignore */ }
}

function loadConfig(): WatchlistConfig {
  try {
    const raw = localStorage.getItem(WATCHLIST_CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig() {
  try {
    localStorage.setItem(WATCHLIST_CONFIG_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

/* ── Initialize ───────────────────────────────────── */

function init() {
  entries = loadEntries();
  config = loadConfig();
  if (config.enabled && entries.size > 0) {
    startPolling();
  }
}

/* ── Change notification ──────────────────────────── */

function notifyChange() {
  changeListeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

export function onWatchlistChange(cb: WatchlistChangeCallback): () => void {
  changeListeners.push(cb);
  return () => {
    changeListeners = changeListeners.filter((l) => l !== cb);
  };
}

/* ── Public API ───────────────────────────────────── */

export function getWatchlist(): WatchlistEntry[] {
  return Array.from(entries.values());
}

export function getWatchlistConfig(): WatchlistConfig {
  return { ...config };
}

export function setWatchlistConfig(patch: Partial<WatchlistConfig>): WatchlistConfig {
  config = { ...config, ...patch };
  saveConfig();

  // Restart polling with new interval
  stopPolling();
  if (config.enabled && entries.size > 0) {
    startPolling();
  }
  notifyChange();
  return { ...config };
}

export function isWatched(key: string): boolean {
  return entries.has(key);
}

export function addToWatchlist(
  key: string,
  label: string,
  receiverUrl: string,
  receiverType: string,
  coordinates: [number, number]
): void {
  if (entries.has(key)) return;

  const entry: WatchlistEntry = {
    key,
    label,
    receiverUrl,
    receiverType,
    coordinates,
    addedAt: new Date().toISOString(),
  };
  entries.set(key, entry);
  saveEntries();

  // Start polling if not already running
  if (config.enabled && !pollTimer) {
    startPolling();
  }

  // Immediately poll this new entry
  pollStation(entry);
  notifyChange();
}

export function removeFromWatchlist(key: string): void {
  entries.delete(key);
  saveEntries();

  if (entries.size === 0) {
    stopPolling();
  }
  notifyChange();
}

export function clearWatchlist(): void {
  entries.clear();
  saveEntries();
  stopPolling();
  notifyChange();
}

export function getWatchlistCount(): number {
  return entries.size;
}

export function getOnlineCount(): number {
  let count = 0;
  entries.forEach((e) => {
    if (e.lastStatus?.online) count++;
  });
  return count;
}

export function getWatchlistEntry(key: string): WatchlistEntry | undefined {
  return entries.get(key);
}

/** Get notes for a station */
export function getStationNote(key: string): string {
  const entry = entries.get(key);
  return entry?.notes || "";
}

/** Set/update notes for a station */
export function setStationNote(key: string, note: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.notes = note.trim();
  entry.notesUpdatedAt = new Date().toISOString();
  entries.set(key, entry);
  saveEntries();
  notifyChange();
}

/** Delete notes for a station */
export function deleteStationNote(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  delete entry.notes;
  delete entry.notesUpdatedAt;
  entries.set(key, entry);
  saveEntries();
  notifyChange();
}

/* ── Polling ──────────────────────────────────────── */

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollAll, config.intervalSeconds * 1000);
  // Run first poll immediately
  pollAll();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollAll() {
  if (isPolling) return;
  isPolling = true;

  const entryList = Array.from(entries.values());

  // Poll in batches of maxConcurrent
  for (let i = 0; i < entryList.length; i += config.maxConcurrent) {
    const batch = entryList.slice(i, i + config.maxConcurrent);
    await Promise.allSettled(batch.map(pollStation));
  }

  isPolling = false;
  notifyChange();
}

async function pollStation(entry: WatchlistEntry): Promise<void> {
  const baseUrl = entry.receiverUrl.replace(/\/$/, "");
  const isKiwi = entry.receiverType === "KiwiSDR";

  try {
    if (isKiwi) {
      // Fetch /status
      const statusRes = await fetch(`${baseUrl}/status`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!statusRes.ok) throw new Error("Status unavailable");
      const statusText = await statusRes.text();
      const parsed = parseKiwiStatus(statusText);

      // Fetch /snr
      let bandSnr: Record<string, number> = {};
      try {
        const snrRes = await fetch(`${baseUrl}/snr`, {
          signal: AbortSignal.timeout(8000),
        });
        if (snrRes.ok) {
          const snrJson = await snrRes.json();
          if (Array.isArray(snrJson) && snrJson.length > 0) {
            const latest = snrJson[snrJson.length - 1];
            if (latest.snr && Array.isArray(latest.snr)) {
              latest.snr.forEach((b: any) => {
                const label = getBandLabel(b.lo, b.hi);
                bandSnr[label] = b.snr || 0;
              });
            }
          }
        }
      } catch { /* SNR may not be available */ }

      const status: WatchlistStatus = {
        online: !parsed.offline && parsed.status === "active",
        snr: parsed.snrOverall,
        users: parsed.users,
        usersMax: parsed.usersMax,
        adcOverload: parsed.adcOverload,
        gpsGood: parsed.gpsGood,
        uptime: parsed.uptime,
        antenna: parsed.antenna,
        version: parsed.version,
        bandSnr,
      };

      entry.lastStatus = status;
      entry.lastPollAt = new Date().toISOString();
      entries.set(entry.key, entry);
      saveEntries();

      // Log signal data
      logSignalData(entry.label, entry.receiverUrl, entry.receiverType, {
        online: status.online,
        snr: status.snr,
        users: status.users,
        usersMax: status.usersMax,
        adcOverload: status.adcOverload,
        gps: status.gpsGood,
        uptime: status.uptime,
        bandSnr,
      });

      // Check alerts
      const alertConfig = getAlertConfig();
      if (alertConfig.enabled) {
        checkAlerts(entry.label, entry.receiverUrl, {
          online: status.online,
          snr: status.snr,
          adcOverload: status.adcOverload,
        });
      }
    } else {
      // Non-KiwiSDR: reachability check
      try {
        await fetch(baseUrl, {
          mode: "no-cors",
          signal: AbortSignal.timeout(8000),
        });
        entry.lastStatus = {
          online: true,
          snr: -1,
          users: -1,
          usersMax: -1,
          adcOverload: false,
          gpsGood: -1,
          uptime: -1,
          antenna: "",
          version: "",
        };
      } catch {
        entry.lastStatus = {
          online: false,
          snr: -1,
          users: -1,
          usersMax: -1,
          adcOverload: false,
          gpsGood: -1,
          uptime: -1,
          antenna: "",
          version: "",
        };
      }
      entry.lastPollAt = new Date().toISOString();
      entries.set(entry.key, entry);
      saveEntries();
    }
  } catch {
    // Mark as offline on error
    entry.lastStatus = {
      online: false,
      snr: -1,
      users: -1,
      usersMax: -1,
      adcOverload: false,
      gpsGood: -1,
      uptime: -1,
      antenna: "",
      version: "",
    };
    entry.lastPollAt = new Date().toISOString();
    entries.set(entry.key, entry);
    saveEntries();
  }
}

/** Force poll a single station immediately */
export async function forcePollStation(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  await pollStation(entry);
  notifyChange();
}

/** Force poll all stations immediately */
export async function forcePollAll(): Promise<void> {
  await pollAll();
}

/* ── Helpers ──────────────────────────────────────── */

const BAND_LABELS: Record<string, string> = {
  "0-30000": "Full Spectrum",
  "1800-30000": "HF",
  "0-1800": "LF/MF",
  "1800-10000": "Lower HF",
  "10000-20000": "Mid HF",
  "20000-30000": "Upper HF",
  "3500-3900": "80m",
  "7000-7300": "40m",
  "14000-14350": "20m",
  "21000-21450": "15m",
  "28000-29700": "10m",
};

function getBandLabel(lo: number, hi: number): string {
  const key = `${lo}-${hi}`;
  return BAND_LABELS[key] || `${(lo / 1000).toFixed(1)}-${(hi / 1000).toFixed(1)} MHz`;
}

interface ParsedKiwiStatus {
  status: string;
  offline: boolean;
  name: string;
  users: number;
  usersMax: number;
  snrOverall: number;
  antenna: string;
  version: string;
  uptime: number;
  gpsGood: number;
  adcOverload: boolean;
}

function parseKiwiStatus(text: string): ParsedKiwiStatus {
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      kv[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
    }
  }

  const snrParts = (kv.snr || "").split(",");
  const snrOverall = snrParts.length > 0 ? parseInt(snrParts[0], 10) : 0;

  return {
    status: kv.status === "active" ? "active" : "inactive",
    offline: kv.offline === "yes",
    name: kv.name || "",
    users: parseInt(kv.users || "0", 10),
    usersMax: parseInt(kv.users_max || "4", 10),
    snrOverall: isNaN(snrOverall) ? 0 : snrOverall,
    antenna: kv.antenna || "",
    version: kv.sw_version || "",
    uptime: parseInt(kv.uptime || "0", 10),
    gpsGood: parseInt(kv.gps_good || "0", 10),
    adcOverload: kv.adc_ov === "1",
  };
}

/* ── Auto-init ────────────────────────────────────── */

init();
