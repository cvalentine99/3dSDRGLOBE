/**
 * receiverStatus.ts — Server-side receiver status checker with proxy rotation
 *
 * Uses real API endpoints for each receiver type:
 *   KiwiSDR:  /status (plain text key=value) + /snr (JSON band-by-band SNR)
 *   OpenWebRX: /status.json (receiver info, SDRs, version) + /metrics.json (users, decode counts)
 *   WebSDR:   /tmp/bandinfo.js (band/frequency info — proves receiver is live)
 *
 * Uses rotating free proxies from ProxyScrape to avoid IP bans.
 * Caches results per receiver for 15 minutes.
 */

import axios, { type AxiosRequestConfig } from "axios";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

/* ── Types ────────────────────────────────────────── */

export interface ReceiverStatusResult {
  online: boolean;
  receiverType: string;
  receiverUrl: string;
  // Common fields
  name?: string;
  users?: number;
  usersMax?: number;
  version?: string;
  // KiwiSDR-specific
  snrOverall?: number;
  antenna?: string;
  uptime?: number;
  gpsGood?: number;
  adcOverload?: boolean;
  antConnected?: boolean;
  snrBands?: SnrBand[];
  // OpenWebRX-specific
  sdrHardware?: SdrProfile[];
  location?: string;
  gps?: { lat: number; lon: number };
  decoderFeatures?: string[];
  metricsUsers?: number;
  pskReporterSpots?: number;
  wsprSpots?: number;
  decodingQueueLength?: number;
  // WebSDR-specific
  bands?: WebSdrBand[];
  // Metadata
  checkedAt: number; // Unix timestamp ms
  fromCache: boolean;
  proxyUsed: boolean;
  error?: string;
}

export interface SnrBand {
  lo: number;
  hi: number;
  snr: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

export interface SdrProfile {
  name: string;
  type: string;
  profiles: { name: string; centerFreq: number; sampleRate: number }[];
}

export interface WebSdrBand {
  min: number;
  max: number;
}

/* ── Proxy Pool ──────────────────────────────────── */

let proxyList: string[] = [];
let proxyListFetchedAt = 0;
const PROXY_LIST_TTL = 5 * 60 * 1000; // 5 minutes

async function getProxyList(): Promise<string[]> {
  const now = Date.now();
  if (proxyList.length > 0 && now - proxyListFetchedAt < PROXY_LIST_TTL) {
    return proxyList;
  }

  try {
    const res = await axios.get(
      "https://api.proxyscrape.com/v4/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all&limit=200",
      { timeout: 10000 }
    );
    const text = typeof res.data === "string" ? res.data : "";
    const proxies = text
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(line));

    if (proxies.length > 0) {
      proxyList = proxies;
      proxyListFetchedAt = now;
      console.log(`[ProxyPool] Refreshed proxy list: ${proxies.length} proxies`);
    }
  } catch (err) {
    console.warn("[ProxyPool] Failed to fetch proxy list, using direct connection");
  }

  return proxyList;
}

function pickRandomProxy(proxies: string[]): string | null {
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

/* ── Result Cache ────────────────────────────────── */

const statusCache = new Map<string, ReceiverStatusResult>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCachedResult(url: string): ReceiverStatusResult | null {
  const cached = statusCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.checkedAt > CACHE_TTL) {
    statusCache.delete(url);
    return null;
  }
  return { ...cached, fromCache: true };
}

/* ── Rate Limiting ───────────────────────────────── */

let activeChecks = 0;
const MAX_CONCURRENT = 10;

/* ── HTTP Request with Proxy ─────────────────────── */

async function fetchWithProxy(
  url: string,
  options: { timeout?: number; responseType?: "text" | "json" } = {}
): Promise<{ data: any; status: number }> {
  const timeout = options.timeout || 8000;
  const proxies = await getProxyList();
  const proxy = pickRandomProxy(proxies);

  const config: AxiosRequestConfig = {
    url,
    method: "GET",
    timeout,
    responseType: options.responseType || "text",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
    },
    maxRedirects: 3,
    validateStatus: (status) => status < 500,
  };

  // Try with proxy first
  if (proxy) {
    try {
      const proxyUrl = `http://${proxy}`;
      const isHttps = url.startsWith("https://");
      config.httpAgent = new HttpProxyAgent(proxyUrl);
      if (isHttps) {
        config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      }
      const res = await axios(config);
      return { data: res.data, status: res.status };
    } catch {
      // Proxy failed, fall through to direct request
    }
  }

  // Direct request fallback (no proxy)
  delete config.httpAgent;
  delete config.httpsAgent;
  const res = await axios(config);
  return { data: res.data, status: res.status };
}

/* ── KiwiSDR Status Parser ───────────────────────── */

function parseKiwiStatus(text: string): Partial<ReceiverStatusResult> {
  const kv: Record<string, string> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      kv[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
    }
  }

  return {
    online: kv.offline !== "yes",
    name: kv.name || undefined,
    users: kv.users ? parseInt(kv.users, 10) : undefined,
    usersMax: kv.users_max ? parseInt(kv.users_max, 10) : undefined,
    antenna: kv.antenna || undefined,
    version: kv.sw_version || undefined,
    uptime: kv.uptime ? parseInt(kv.uptime, 10) : undefined,
    gpsGood: kv.gps_good ? parseInt(kv.gps_good, 10) : undefined,
    adcOverload: kv.adc_ov === "1",
    antConnected: kv.ant_connected !== "0",
  };
}

/* ── KiwiSDR SNR Parser ──────────────────────────── */

function parseKiwiSnr(json: any): { snrOverall: number; snrBands: SnrBand[] } {
  let snrOverall = 0;
  const snrBands: SnrBand[] = [];

  if (Array.isArray(json) && json.length > 0) {
    const latest = json[json.length - 1];
    if (latest && latest.snr && Array.isArray(latest.snr)) {
      for (const b of latest.snr) {
        snrBands.push({
          lo: b.lo || 0,
          hi: b.hi || 0,
          snr: b.snr || 0,
          min: b.min || 0,
          max: b.max || 0,
          p50: b.p50 || 0,
          p95: b.p95 || 0,
        });
      }
      if (snrBands.length > 0) {
        snrOverall = snrBands[0].snr;
      }
    }
  }

  return { snrOverall, snrBands };
}

/* ── OpenWebRX Status Parser ─────────────────────── */

function parseOpenWebRXStatus(json: any): Partial<ReceiverStatusResult> {
  const result: Partial<ReceiverStatusResult> = { online: true };

  if (json.receiver) {
    result.name = json.receiver.name || undefined;
    if (json.receiver.gps) {
      result.gps = {
        lat: json.receiver.gps.lat,
        lon: json.receiver.gps.lon,
      };
    }
    // Clean HTML from location string
    if (json.receiver.location) {
      result.location = json.receiver.location.replace(/<[^>]*>/g, "").trim();
    }
  }

  result.usersMax = json.max_clients || undefined;
  result.version = json.version || undefined;

  // Parse SDR hardware profiles
  if (Array.isArray(json.sdrs)) {
    result.sdrHardware = json.sdrs.map((sdr: any) => ({
      name: sdr.name || "Unknown",
      type: sdr.type || "Unknown",
      profiles: Array.isArray(sdr.profiles)
        ? sdr.profiles.map((p: any) => ({
            name: p.name || "Default",
            centerFreq: p.center_freq || 0,
            sampleRate: p.sample_rate || 0,
          }))
        : [],
    }));
  }

  return result;
}

/* ── OpenWebRX Metrics Parser ────────────────────── */

function parseOpenWebRXMetrics(json: any): Partial<ReceiverStatusResult> {
  const result: Partial<ReceiverStatusResult> = {};

  if (json.openwebrx && typeof json.openwebrx.users === "number") {
    result.metricsUsers = json.openwebrx.users;
    result.users = json.openwebrx.users;
  }

  if (json.pskreporter?.spots?.count !== undefined) {
    result.pskReporterSpots = json.pskreporter.spots.count;
  }

  if (json.wsprnet?.spots?.count !== undefined) {
    result.wsprSpots = json.wsprnet.spots.count;
  }

  if (json.decoding?.queue?.length !== undefined) {
    result.decodingQueueLength = json.decoding.queue.length;
  }

  return result;
}

/* ── WebSDR bandinfo.js Parser ───────────────────── */

function parseWebSdrBandInfo(jsText: string): Partial<ReceiverStatusResult> {
  const result: Partial<ReceiverStatusResult> = { online: true };
  const bands: WebSdrBand[] = [];

  // Extract freqbands.push() calls: freqbands.push( { min:148.500000, max:283.500000 } )
  const bandRegex = /freqbands\.push\(\s*\{\s*min:\s*([\d.]+)\s*,\s*max:\s*([\d.]+)\s*\}\s*\)/g;
  let match;
  while ((match = bandRegex.exec(jsText)) !== null) {
    bands.push({
      min: parseFloat(match[1]),
      max: parseFloat(match[2]),
    });
  }

  if (bands.length > 0) {
    result.bands = bands;
  }

  // Try to extract name from the bandinfo data (bi array)
  // bi[0].centerfreq etc. are available but name is typically in the HTML page
  return result;
}

/* ── Main Check Function ─────────────────────────── */

export async function checkReceiverStatus(
  receiverUrl: string,
  receiverType: string
): Promise<ReceiverStatusResult> {
  // Normalize URL: strip trailing slash so cache keys are consistent
  const normalizedUrl = receiverUrl.replace(/\/+$/, "");

  // Check cache first (using normalized URL)
  const cached = getCachedResult(normalizedUrl);
  if (cached) return { ...cached, receiverUrl };

  // Rate limit concurrent checks
  if (activeChecks >= MAX_CONCURRENT) {
    return {
      online: false,
      receiverType,
      receiverUrl,
      checkedAt: Date.now(),
      fromCache: false,
      proxyUsed: false,
      error: "Too many concurrent checks, try again later",
    };
  }

  activeChecks++;

  try {
    if (receiverType === "KiwiSDR") {
      return await checkKiwiSDR(normalizedUrl, receiverType, receiverUrl);
    } else if (receiverType === "OpenWebRX") {
      return await checkOpenWebRX(normalizedUrl, receiverType, receiverUrl);
    } else {
      return await checkWebSDR(normalizedUrl, receiverType, receiverUrl);
    }
  } catch (err: any) {
    const result: ReceiverStatusResult = {
      online: false,
      receiverType,
      receiverUrl,
      checkedAt: Date.now(),
      fromCache: false,
      proxyUsed: false,
      error: err.message || "Connection failed",
    };
    statusCache.set(normalizedUrl, result);
    return result;
  } finally {
    activeChecks--;
  }
}

/* ── KiwiSDR Check ───────────────────────────────── */

async function checkKiwiSDR(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // Fetch /status (plain text key=value pairs)
  const statusResponse = await fetchWithProxy(`${baseUrl}/status`);
  const parsed = parseKiwiStatus(statusResponse.data);

  // Fetch /snr (JSON — non-critical, don't fail if this errors)
  let snrData = { snrOverall: 0, snrBands: [] as SnrBand[] };
  try {
    const snrResponse = await fetchWithProxy(`${baseUrl}/snr`, {
      responseType: "json",
    });
    if (snrResponse.data) {
      const jsonData =
        typeof snrResponse.data === "string"
          ? JSON.parse(snrResponse.data)
          : snrResponse.data;
      snrData = parseKiwiSnr(jsonData);
    }
  } catch {
    // SNR endpoint may not be available on all KiwiSDRs
  }

  const result: ReceiverStatusResult = {
    online: parsed.online ?? true,
    receiverType,
    receiverUrl,
    name: parsed.name,
    users: parsed.users,
    usersMax: parsed.usersMax,
    snrOverall: snrData.snrOverall,
    antenna: parsed.antenna,
    version: parsed.version,
    uptime: parsed.uptime,
    gpsGood: parsed.gpsGood,
    adcOverload: parsed.adcOverload,
    antConnected: parsed.antConnected,
    snrBands: snrData.snrBands,
    checkedAt: Date.now(),
    fromCache: false,
    proxyUsed: proxyList.length > 0,
  };

  statusCache.set(baseUrl, result);
  return result;
}

/* ── OpenWebRX Check ─────────────────────────────── */

async function checkOpenWebRX(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // Fetch /status.json — the primary status endpoint
  const statusResponse = await fetchWithProxy(`${baseUrl}/status.json`, {
    timeout: 10000,
  });

  let statusData: any;
  try {
    statusData =
      typeof statusResponse.data === "string"
        ? JSON.parse(statusResponse.data)
        : statusResponse.data;
  } catch {
    // If /status.json doesn't parse, receiver might still be online but older version
    const result: ReceiverStatusResult = {
      online: statusResponse.status >= 200 && statusResponse.status < 400,
      receiverType,
      receiverUrl,
      checkedAt: Date.now(),
      fromCache: false,
      proxyUsed: proxyList.length > 0,
    };
    statusCache.set(baseUrl, result);
    return result;
  }

  const parsed = parseOpenWebRXStatus(statusData);

  // Fetch /metrics.json for active user count and decode stats (non-critical)
  let metricsData: Partial<ReceiverStatusResult> = {};
  try {
    const metricsResponse = await fetchWithProxy(`${baseUrl}/metrics.json`, {
      timeout: 8000,
    });
    const metricsJson =
      typeof metricsResponse.data === "string"
        ? JSON.parse(metricsResponse.data)
        : metricsResponse.data;
    metricsData = parseOpenWebRXMetrics(metricsJson);
  } catch {
    // /metrics.json may not be available on all OpenWebRX versions
  }

  const result: ReceiverStatusResult = {
    online: true,
    receiverType,
    receiverUrl,
    name: parsed.name,
    users: metricsData.users,
    usersMax: parsed.usersMax,
    version: parsed.version,
    location: parsed.location,
    gps: parsed.gps,
    sdrHardware: parsed.sdrHardware,
    metricsUsers: metricsData.metricsUsers,
    pskReporterSpots: metricsData.pskReporterSpots,
    wsprSpots: metricsData.wsprSpots,
    decodingQueueLength: metricsData.decodingQueueLength,
    checkedAt: Date.now(),
    fromCache: false,
    proxyUsed: proxyList.length > 0,
  };

  statusCache.set(baseUrl, result);
  return result;
}

/* ── WebSDR Check ────────────────────────────────── */

async function checkWebSDR(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // Fetch /tmp/bandinfo.js — this file is dynamically generated by the WebSDR server
  // and contains band configuration + waterfall image references.
  // If it returns valid JS with freqbands data, the receiver is online.
  const bandInfoResponse = await fetchWithProxy(`${baseUrl}/tmp/bandinfo.js`, {
    timeout: 10000,
  });

  const jsText =
    typeof bandInfoResponse.data === "string" ? bandInfoResponse.data : "";

  // Verify this is actually bandinfo.js content (not an error page)
  const isValid =
    bandInfoResponse.status >= 200 &&
    bandInfoResponse.status < 400 &&
    (jsText.includes("freqbands") || jsText.includes("bi["));

  let parsed: Partial<ReceiverStatusResult> = { online: false };
  if (isValid) {
    parsed = parseWebSdrBandInfo(jsText);
  }

  const result: ReceiverStatusResult = {
    online: isValid,
    receiverType,
    receiverUrl,
    bands: parsed.bands,
    checkedAt: Date.now(),
    fromCache: false,
    proxyUsed: proxyList.length > 0,
  };

  statusCache.set(baseUrl, result);
  return result;
}

/* ── Cache Management ────────────────────────────── */

export function clearStatusCache(): void {
  statusCache.clear();
}

export function getStatusCacheSize(): number {
  return statusCache.size;
}
