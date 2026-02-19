/**
 * tdoaService.ts — TDoA (Time Difference of Arrival) service layer
 *
 * Proxies requests to tdoa.kiwisdr.com for HF transmitter geolocation.
 * Manages GPS host list caching, job submission, progress polling, and result retrieval.
 */

import axios from "axios";

const TDOA_BASE = "http://tdoa.kiwisdr.com";
const GPS_HOSTS_URL = `${TDOA_BASE}/tdoa/files/kiwi.gps.json`;
const REFS_URL = `${TDOA_BASE}/tdoa/refs.cjson`;
const SUBMIT_URL = `${TDOA_BASE}/php/tdoa.php`;
const FILES_BASE = `${TDOA_BASE}/tdoa/files`;

// Cache TTLs
const GPS_HOSTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REFS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/* ── Types ────────────────────────────────────────── */

export interface GpsHost {
  i: number;
  id: string;
  h: string;
  p: number;
  lat: number;
  lon: number;
  lo: number;
  fm: number;
  u: number;
  um: number;
  tc: number;
  snr: number;
  v: string;
  mac: string;
  a: string;
  n: string;
}

export interface RefTransmitter {
  r: string;
  id: string;
  t: string;
  f: number;
  p: number;
  z: number;
  lat: number;
  lon: number;
  mz?: number;
}

export interface TdoaSubmitParams {
  hosts: { h: string; p: number; id: string; lat: number; lon: number }[];
  frequencyKhz: number;
  passbandHz: number;
  sampleTime: number;
  mapBounds: { north: number; south: number; east: number; west: number };
  knownLocation?: { lat: number; lon: number; name: string };
}

export interface TdoaProgress {
  key?: string;
  files?: string[];
  status0?: number;
  done?: boolean;
  error?: string;
}

export interface TdoaContour {
  imgBounds: { north: number; south: number; east: number; west: number };
  polygons: { lat: number; lng: number }[][];
  polygon_colors: string[];
  polylines: { lat: number; lng: number }[][];
  polyline_colors: string[];
}

export interface TdoaResult {
  likely_position?: { lat: number; lng: number };
  input?: {
    per_file: { name: string; status: string }[];
    result: { status: string; message: string };
  };
  constraints?: {
    result: { status: string; message: string };
  };
}

export interface TdoaJobState {
  id: string;
  key?: string;
  status: "pending" | "sampling" | "computing" | "complete" | "error";
  params: TdoaSubmitParams;
  hostStatuses: Record<string, "sampling" | "ok" | "failed" | "busy" | "no_gps">;
  progress?: TdoaProgress;
  result?: TdoaResult;
  contours: TdoaContour[];
  heatmapUrl?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/* ── In-Memory Caches ────────────────────────────── */

let gpsHostsCache: { data: GpsHost[]; fetchedAt: number } | null = null;
let refsCache: { data: RefTransmitter[]; fetchedAt: number } | null = null;

// Active jobs tracked in memory
const activeJobs = new Map<string, TdoaJobState>();

/* ── GPS Host List ──────────────────────────────── */

export async function getGpsHosts(): Promise<GpsHost[]> {
  if (gpsHostsCache && Date.now() - gpsHostsCache.fetchedAt < GPS_HOSTS_CACHE_TTL) {
    return gpsHostsCache.data;
  }

  try {
    const resp = await axios.get(GPS_HOSTS_URL, { timeout: 15000 });
    const hosts: GpsHost[] = resp.data;
    gpsHostsCache = { data: hosts, fetchedAt: Date.now() };
    console.log(`[TDoA] Fetched ${hosts.length} GPS-active hosts`);
    return hosts;
  } catch (err: any) {
    console.error("[TDoA] Failed to fetch GPS hosts:", err.message);
    if (gpsHostsCache) return gpsHostsCache.data;
    throw new Error("Failed to fetch GPS host list");
  }
}

/* ── Reference Transmitters ──────────────────────── */

export async function getRefTransmitters(): Promise<RefTransmitter[]> {
  if (refsCache && Date.now() - refsCache.fetchedAt < REFS_CACHE_TTL) {
    return refsCache.data;
  }

  try {
    const resp = await axios.get(REFS_URL, { timeout: 15000, responseType: "text" });
    // refs.cjson is JSON with comments — strip them
    const cleaned = (resp.data as string)
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const refs: RefTransmitter[] = JSON.parse(cleaned);
    refsCache = { data: refs, fetchedAt: Date.now() };
    console.log(`[TDoA] Fetched ${refs.length} reference transmitters`);
    return refs;
  } catch (err: any) {
    console.error("[TDoA] Failed to fetch refs:", err.message);
    if (refsCache) return refsCache.data;
    throw new Error("Failed to fetch reference transmitters");
  }
}

/* ── Job Submission ──────────────────────────────── */

function generateJobKey(): string {
  return String(Date.now()).slice(-5);
}

function buildPiParam(params: TdoaSubmitParams): string {
  const { mapBounds, knownLocation } = params;
  let pi = `struct('lat_range',[${mapBounds.south},${mapBounds.north}],'lon_range',[${mapBounds.west},${mapBounds.east}]`;
  if (knownLocation) {
    pi += `,'known_location',struct('coord',[${knownLocation.lat},${knownLocation.lon}],'name','${knownLocation.name.replace(/'/g, "''")}')`;
  }
  pi += `,'new',true)`;
  return pi;
}

export async function submitTdoaJob(params: TdoaSubmitParams): Promise<TdoaJobState> {
  const jobId = `tdoa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const key = generateJobKey();

  const job: TdoaJobState = {
    id: jobId,
    key,
    status: "pending",
    params,
    hostStatuses: {},
    contours: [],
    createdAt: Date.now(),
  };

  for (const host of params.hosts) {
    job.hostStatuses[host.h] = "sampling";
  }

  activeJobs.set(jobId, job);

  const queryParams = new URLSearchParams();
  queryParams.set("key", key);
  queryParams.set("h", params.hosts.map((h) => h.h).join(","));
  queryParams.set("p", params.hosts.map((h) => String(h.p)).join(","));
  queryParams.set("id", params.hosts.map((h) => h.id).join(","));
  queryParams.set("f", String(params.frequencyKhz));
  queryParams.set("s", String(params.sampleTime));
  queryParams.set("w", String(params.passbandHz));
  queryParams.set("pi", buildPiParam(params));

  try {
    await axios.get(`${SUBMIT_URL}?${queryParams.toString()}`, { timeout: 30000 });
    job.status = "sampling";
    console.log(`[TDoA] Job ${jobId} submitted with key ${key}`);
  } catch (err: any) {
    job.status = "error";
    job.error = `Submit failed: ${err.message}`;
    console.error(`[TDoA] Job ${jobId} submit failed:`, err.message);
  }

  return job;
}

/* ── Progress Polling ───────────────────────────── */

function decodeHostStatuses(
  status0: number,
  hostCount: number
): ("ok" | "failed" | "busy" | "no_gps")[] {
  const statuses: ("ok" | "failed" | "busy" | "no_gps")[] = [];
  for (let i = 0; i < hostCount; i++) {
    const bits = (status0 >> (i * 2)) & 0x3;
    switch (bits) {
      case 0: statuses.push("ok"); break;
      case 1: statuses.push("failed"); break;
      case 2: statuses.push("busy"); break;
      case 3: statuses.push("no_gps"); break;
      default: statuses.push("failed");
    }
  }
  return statuses;
}

export async function pollJobProgress(jobId: string): Promise<TdoaJobState | null> {
  const job = activeJobs.get(jobId);
  if (!job || !job.key) return job || null;

  if (job.status === "complete" || job.status === "error") {
    return job;
  }

  try {
    const resp = await axios.get(`${FILES_BASE}/${job.key}/progress.json`, {
      timeout: 10000,
      validateStatus: (s) => s === 200 || s === 404,
    });

    if (resp.status === 404) return job;

    const progress: TdoaProgress = resp.data;
    job.progress = progress;

    if (progress.key && progress.key !== job.key) {
      job.key = progress.key;
    }

    if (progress.status0 !== undefined) {
      const statuses = decodeHostStatuses(progress.status0, job.params.hosts.length);
      job.params.hosts.forEach((host, i) => {
        job.hostStatuses[host.h] = statuses[i];
      });
      job.status = "computing";
    }

    if (progress.done) {
      job.status = "computing";
      await fetchJobResults(job);
    }
  } catch (err: any) {
    console.error(`[TDoA] Progress poll failed for ${jobId}:`, err.message);
  }

  return job;
}

/* ── Result Retrieval ───────────────────────────── */

async function fetchJobResults(job: TdoaJobState): Promise<void> {
  if (!job.key) return;

  try {
    const statusResp = await axios.get(`${FILES_BASE}/${job.key}/status.json`, {
      timeout: 15000,
      validateStatus: (s) => s === 200 || s === 404,
    });

    if (statusResp.status === 200) {
      job.result = statusResp.data;
      job.status = "complete";
      job.completedAt = Date.now();

      job.heatmapUrl = `${FILES_BASE}/${job.key}/TDoA map_for_map.png`;

      // Fetch contour data for each host pair
      const hosts = job.params.hosts;
      const contourPromises: Promise<void>[] = [];

      for (let i = 0; i < hosts.length; i++) {
        for (let j = i + 1; j < hosts.length; j++) {
          const pairId = `${hosts[i].id}-${hosts[j].id}`;
          contourPromises.push(
            axios
              .get(`${FILES_BASE}/${job.key}/${pairId}_contour_for_map.json`, {
                timeout: 10000,
                validateStatus: (s) => s === 200 || s === 404,
              })
              .then((resp) => {
                if (resp.status === 200 && resp.data) {
                  job.contours.push(resp.data);
                }
              })
              .catch(() => {})
          );
        }
      }

      await Promise.allSettled(contourPromises);

      console.log(
        `[TDoA] Job ${job.id} complete. Likely position:`,
        job.result?.likely_position,
        `Contours: ${job.contours.length}`
      );
    }
  } catch (err: any) {
    job.status = "error";
    job.error = `Result fetch failed: ${err.message}`;
    console.error(`[TDoA] Result fetch failed for ${job.id}:`, err.message);
  }
}

/* ── Job Management ────────────────────────────── */

export function getJob(jobId: string): TdoaJobState | null {
  return activeJobs.get(jobId) || null;
}

export function getRecentJobs(limit: number = 20): TdoaJobState[] {
  return Array.from(activeJobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  if (job.status === "complete" || job.status === "error") return false;
  job.status = "error";
  job.error = "Cancelled by user";
  return true;
}

export async function proxyResultFile(
  key: string,
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const url = `${FILES_BASE}/${key}/${filename}`;
    const resp = await axios.get(url, {
      timeout: 15000,
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200 || s === 404,
    });
    if (resp.status === 404) return null;
    return {
      data: Buffer.from(resp.data),
      contentType: resp.headers["content-type"] || "application/octet-stream",
    };
  } catch {
    return null;
  }
}
