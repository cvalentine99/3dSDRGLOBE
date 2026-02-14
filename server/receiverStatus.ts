/**
 * receiverStatus.ts — Server-side receiver status checker with proxy rotation
 *
 * Fetches real status data from KiwiSDR /status and /snr endpoints,
 * and performs reachability checks for OpenWebRX and WebSDR receivers.
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
  // KiwiSDR-specific fields
  name?: string;
  users?: number;
  usersMax?: number;
  snrOverall?: number;
  antenna?: string;
  version?: string;
  uptime?: number;
  gpsGood?: number;
  adcOverload?: boolean;
  antConnected?: boolean;
  snrBands?: SnrBand[];
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
    // Disable automatic redirect following for status checks
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
      // Use the first band (0-30MHz composite) as overall if available
      if (snrBands.length > 0) {
        snrOverall = snrBands[0].snr;
      }
    }
  }

  return { snrOverall, snrBands };
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

async function checkKiwiSDR(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // Fetch /status
  const statusResponse = await fetchWithProxy(`${baseUrl}/status`);
  const parsed = parseKiwiStatus(statusResponse.data);

  // Fetch /snr (non-critical — don't fail if this errors)
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

async function checkOpenWebRX(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // OpenWebRX has no public status API — just check reachability
  const response = await fetchWithProxy(baseUrl, { timeout: 10000 });
  const isOnline = response.status >= 200 && response.status < 400;

  const result: ReceiverStatusResult = {
    online: isOnline,
    receiverType,
    receiverUrl,
    checkedAt: Date.now(),
    fromCache: false,
    proxyUsed: proxyList.length > 0,
  };

  statusCache.set(baseUrl, result);
  return result;
}

async function checkWebSDR(
  baseUrl: string,
  receiverType: string,
  receiverUrl: string
): Promise<ReceiverStatusResult> {
  // WebSDR has no public status API — just check reachability
  const response = await fetchWithProxy(baseUrl, { timeout: 10000 });
  const isOnline = response.status >= 200 && response.status < 400;

  const result: ReceiverStatusResult = {
    online: isOnline,
    receiverType,
    receiverUrl,
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
