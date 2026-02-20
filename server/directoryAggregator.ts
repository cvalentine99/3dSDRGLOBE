/**
 * directoryAggregator.ts — Multi-source SDR receiver directory aggregator
 *
 * Fetches receiver listings from:
 *   1. KiwiSDR GPS JSON (kiwisdr.com/tdoa/files/kiwi.gps.json) — ~500 receivers
 *   2. WebSDR.org AJAX JSON (websdr.ewi.utwente.nl) — ~125 receivers
 *   3. sdr-list.xyz RSC (NovaSDR/PhantomSDR) — ~25 receivers
 *   4. ReceiverBook.de map (receiverbook.de/map) — ~1500 receivers
 *
 * Merges with existing stations.json and deduplicates by normalized URL.
 */

import axios from "axios";

/* ── Types ──────────────────────────────────────────── */

export interface DirectoryReceiver {
  label: string;
  url: string;
  type: "KiwiSDR" | "OpenWebRX" | "WebSDR";
  version?: string;
}

export interface DirectoryStation {
  label: string;
  location: {
    coordinates: [number, number]; // [longitude, latitude]
    type: "Point";
  };
  receivers: DirectoryReceiver[];
  source: string; // e.g. "kiwisdr-gps", "websdr-org", "sdr-list", "static"
}

export interface AggregationResult {
  stations: DirectoryStation[];
  sources: {
    name: string;
    fetched: number;
    newStations: number;
    errors: string[];
  }[];
  totalStations: number;
  totalNew: number;
  fetchedAt: number;
}

/* ── Maidenhead Grid → Lat/Lon Conversion ──────────── */

/**
 * Convert a Maidenhead grid locator (e.g. "JO32KF") to lat/lon center.
 * Supports 4-char and 6-char locators.
 */
export function gridToLatLon(grid: string): { lat: number; lon: number } | null {
  if (!grid || grid.length < 4) return null;
  const g = grid.toUpperCase();

  const A = "A".charCodeAt(0);

  // Field (18x18)
  const lonField = g.charCodeAt(0) - A;
  const latField = g.charCodeAt(1) - A;
  if (lonField < 0 || lonField > 17 || latField < 0 || latField > 17) return null;

  // Square (10x10)
  const lonSquare = parseInt(g[2], 10);
  const latSquare = parseInt(g[3], 10);
  if (isNaN(lonSquare) || isNaN(latSquare)) return null;

  let lon = lonField * 20 + lonSquare * 2 - 180;
  let lat = latField * 10 + latSquare * 1 - 90;

  // Subsquare (24x24) — optional 5th and 6th chars
  if (g.length >= 6) {
    const lonSub = g.charCodeAt(4) - A;
    const latSub = g.charCodeAt(5) - A;
    if (lonSub >= 0 && lonSub < 24 && latSub >= 0 && latSub < 24) {
      lon += (lonSub * 2) / 24 + 1 / 24;
      lat += (latSub * 1) / 24 + 0.5 / 24;
    } else {
      lon += 1; // center of square
      lat += 0.5;
    }
  } else {
    lon += 1; // center of square
    lat += 0.5;
  }

  return { lat, lon };
}

/* ── URL Normalization ─────────────────────────────── */

export function normalizeUrl(url: string): string {
  let u = url.trim().toLowerCase();
  // Remove trailing slash
  u = u.replace(/\/+$/, "");
  // Remove protocol
  u = u.replace(/^https?:\/\//, "");
  // Remove default port 80
  u = u.replace(/:80$/, "");
  return u;
}

/* ── Source 1: KiwiSDR GPS JSON ────────────────────── */

interface KiwiGpsHost {
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

const KIWI_GPS_URL = "http://kiwisdr.com/tdoa/files/kiwi.gps.json";

export async function fetchKiwiSdrDirectory(): Promise<{
  stations: DirectoryStation[];
  errors: string[];
}> {
  const errors: string[] = [];
  const stations: DirectoryStation[] = [];

  try {
    const res = await axios.get<KiwiGpsHost[]>(KIWI_GPS_URL, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!Array.isArray(res.data)) {
      errors.push("KiwiSDR GPS response is not an array");
      return { stations, errors };
    }

    for (const host of res.data) {
      if (!host.h || !host.lat || !host.lon) continue;

      const port = host.p || 8073;
      const url = `http://${host.h}:${port}`;
      const label =
        host.n ||
        `KiwiSDR ${host.id || host.h}`;

      stations.push({
        label: label.replace(/<[^>]*>/g, "").trim(), // Strip HTML tags
        location: {
          coordinates: [host.lon, host.lat],
          type: "Point",
        },
        receivers: [
          {
            label,
            url,
            type: "KiwiSDR",
            version: host.v,
          },
        ],
        source: "kiwisdr-gps",
      });
    }

    console.log(
      `[DirectoryAggregator] KiwiSDR GPS: fetched ${stations.length} receivers`
    );
  } catch (err: any) {
    const msg = `KiwiSDR GPS fetch failed: ${err.message}`;
    errors.push(msg);
    console.warn(`[DirectoryAggregator] ${msg}`);
  }

  return { stations, errors };
}

/* ── Source 2: WebSDR.org AJAX JSON ────────────────── */

/**
 * WebSDR.org populates its receiver list via an AJAX endpoint that returns
 * a JSON array with lat/lon, URL, description, QTH locator, user count, and bands.
 */
const WEBSDR_ORG_AJAX_URL =
  "http://websdr.ewi.utwente.nl/~~websdrlistk?v=1&fmt=2&chseq=0";

interface WebSdrEntry {
  url: string;
  desc: string;
  qth: string;
  lon: number;
  lat: number;
  users: string;
  logourl: string;
  mobile?: string;
  bands: { c: string; l: number; h: number; a: string }[];
}

export async function fetchWebSdrDirectory(): Promise<{
  stations: DirectoryStation[];
  errors: string[];
}> {
  const errors: string[] = [];
  const stations: DirectoryStation[] = [];

  try {
    const res = await axios.get<string>(WEBSDR_ORG_AJAX_URL, {
      timeout: 15000,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    let text = res.data;
    // Strip the copyright comment line at the top
    const bracketIdx = text.indexOf("[");
    if (bracketIdx >= 0) {
      text = text.substring(bracketIdx);
    }

    const entries: WebSdrEntry[] = JSON.parse(text);

    for (const entry of entries) {
      if (!entry.url || typeof entry.lat !== "number" || typeof entry.lon !== "number") {
        continue;
      }

      // Clean up HTML entities in description
      const desc = entry.desc
        .replace(/&#38;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/-&gt;/g, "→")
        .replace(/<[^>]*>/g, "")
        .trim();

      const receiverUrl = entry.url.replace(/\/$/, "");
      const label = desc || `WebSDR at ${receiverUrl}`;

      // Build a frequency summary from bands
      const freqRanges = entry.bands
        .map((b) => {
          if (b.l < 0.1 && b.h > 29) return "0–30 MHz";
          return `${b.l.toFixed(3)}–${b.h.toFixed(3)} MHz`;
        })
        .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
        .join(", ");

      const receiverLabel = freqRanges
        ? `${label} (${freqRanges})`
        : label;

      stations.push({
        label,
        location: {
          coordinates: [entry.lon, entry.lat],
          type: "Point",
        },
        receivers: [
          {
            label: receiverLabel,
            url: receiverUrl,
            type: "WebSDR",
          },
        ],
        source: "websdr-org",
      });
    }

    console.log(
      `[DirectoryAggregator] WebSDR.org: fetched ${stations.length} receivers`
    );
  } catch (err: any) {
    const msg = `WebSDR.org fetch failed: ${err.message}`;
    errors.push(msg);
    console.warn(`[DirectoryAggregator] ${msg}`);
  }

  return { stations, errors };
}

/* ── Source 3: sdr-list.xyz (NovaSDR / PhantomSDR) ── */

const SDR_LIST_URL = "https://sdr-list.xyz";

interface SdrListEntry {
  antenna: string;
  bandwidth: number;
  center_frequency: number;
  grid_locator: string;
  id: string;
  ip: string;
  max_users: number;
  name: string;
  url: string;
  users: number;
}

export async function fetchSdrListDirectory(): Promise<{
  stations: DirectoryStation[];
  errors: string[];
}> {
  const errors: string[] = [];
  const stations: DirectoryStation[] = [];

  try {
    const res = await axios.get<string>(SDR_LIST_URL, {
      timeout: 15000,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });

    const html = res.data;

    // sdr-list.xyz is a Next.js RSC app. The receiver data is embedded in the
    // initial HTML as part of an "initialData" prop in the RSC payload.
    // Find the initialData array start
    const dataIdx = html.indexOf('initialData');
    if (dataIdx >= 0) {
      const arrStart = html.indexOf('[{', dataIdx);
      if (arrStart >= 0) {
        // Find the matching closing bracket
        let depth = 0;
        let i = arrStart;
        while (i < html.length) {
          if (html[i] === '[') depth++;
          else if (html[i] === ']') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        let arrStr = html.substring(arrStart, i + 1);
        // Unescape RSC-encoded quotes
        arrStr = arrStr.replace(/\\\\"/g, '"').replace(/\\"/g, '"');

        try {
          const entries: SdrListEntry[] = JSON.parse(arrStr);
          for (const entry of entries) {
            if (!entry.url || !entry.grid_locator) continue;

            const coords = gridToLatLon(entry.grid_locator);
            if (!coords) continue;

            const receiverUrl = entry.url.replace(/\/$/, "");
            const label = entry.name || `SDR at ${receiverUrl}`;

            // Build frequency info from center_frequency and bandwidth
            const centerMHz = entry.center_frequency / 1_000_000;
            const bwMHz = entry.bandwidth / 1_000_000;
            const freqInfo = `${(centerMHz - bwMHz / 2).toFixed(3)}–${(centerMHz + bwMHz / 2).toFixed(3)} MHz`;

            stations.push({
              label,
              location: {
                coordinates: [coords.lon, coords.lat],
                type: "Point",
              },
              receivers: [
                {
                  label: `${label} (${freqInfo}, ${entry.antenna})`,
                  url: receiverUrl,
                  type: "WebSDR", // NovaSDR/PhantomSDR are WebSDR-compatible
                },
              ],
              source: "sdr-list",
            });
          }
        } catch (parseErr: any) {
          errors.push(`sdr-list.xyz JSON parse failed: ${parseErr.message}`);
        }
      }
    }

    console.log(
      `[DirectoryAggregator] sdr-list.xyz: fetched ${stations.length} receivers`
    );
  } catch (err: any) {
    const msg = `sdr-list.xyz fetch failed: ${err.message}`;
    errors.push(msg);
    console.warn(`[DirectoryAggregator] ${msg}`);
  }

  return { stations, errors };
}

/* ── Source 4: ReceiverBook.de Map ──────────────── */

/**
 * ReceiverBook.de aggregates KiwiSDR and OpenWebRX receivers.
 * The /map page embeds a `var receivers = [...]` JS array with full
 * coordinates, labels, URLs, and type info for ~1500 receivers.
 */
const RECEIVERBOOK_MAP_URL = "https://receiverbook.de/map";

interface ReceiverBookEntry {
  label: string;
  location: {
    coordinates: [number, number]; // [lon, lat]
    type: string;
  };
  receivers: {
    label: string;
    version?: string;
    url: string;
    type: string; // "OpenWebRX", "KiwiSDR", etc.
  }[];
}

export async function fetchReceiverBookDirectory(): Promise<{
  stations: DirectoryStation[];
  errors: string[];
}> {
  const errors: string[] = [];
  const stations: DirectoryStation[] = [];

  try {
    const res = await axios.get<string>(RECEIVERBOOK_MAP_URL, {
      timeout: 20000,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    });

    const html = res.data;

    // Extract the `var receivers = [...]` array from the HTML
    const match = html.match(/var\s+receivers\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) {
      errors.push("ReceiverBook: could not find receivers array in HTML");
      return { stations, errors };
    }

    let entries: ReceiverBookEntry[];
    try {
      entries = JSON.parse(match[1]);
    } catch (parseErr: any) {
      errors.push(`ReceiverBook: JSON parse failed: ${parseErr.message}`);
      return { stations, errors };
    }

    for (const entry of entries) {
      if (
        !entry.location?.coordinates ||
        !Array.isArray(entry.receivers) ||
        entry.receivers.length === 0
      ) {
        continue;
      }

      const [lon, lat] = entry.location.coordinates;
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      if (lat === 0 && lon === 0) continue; // Skip null-island entries

      const mappedReceivers: DirectoryReceiver[] = entry.receivers
        .filter((r) => r.url)
        .map((r) => {
          // Normalize type to our known types
          let type: DirectoryReceiver["type"] = "OpenWebRX";
          const t = (r.type || "").toLowerCase();
          if (t.includes("kiwi")) type = "KiwiSDR";
          else if (t.includes("websdr")) type = "WebSDR";
          else if (t.includes("openwebrx")) type = "OpenWebRX";

          return {
            label: r.label || entry.label || "Unknown",
            url: r.url.replace(/\/$/, ""),
            type,
            version: r.version,
          };
        });

      if (mappedReceivers.length === 0) continue;

      stations.push({
        label: entry.label || mappedReceivers[0].label,
        location: {
          coordinates: [lon, lat],
          type: "Point",
        },
        receivers: mappedReceivers,
        source: "receiverbook",
      });
    }

    console.log(
      `[DirectoryAggregator] ReceiverBook.de: fetched ${stations.length} stations (${stations.reduce((n, s) => n + s.receivers.length, 0)} receivers)`
    );
  } catch (err: any) {
    const msg = `ReceiverBook.de fetch failed: ${err.message}`;
    errors.push(msg);
    console.warn(`[DirectoryAggregator] ${msg}`);
  }

  return { stations, errors };
}

/* ── Aggregation & Deduplication ───────────────────── */

/**
 * Merge new directory stations with existing static stations.
 * Deduplicates by normalized receiver URL.
 * Returns the merged list with source attribution.
 */
export function mergeStations(
  existingStations: DirectoryStation[],
  ...newSources: DirectoryStation[][]
): DirectoryStation[] {
  // Build a set of normalized URLs from existing stations
  const seenUrls = new Set<string>();
  const merged: DirectoryStation[] = [];

  // Add existing stations first (they take priority)
  for (const station of existingStations) {
    const stationUrls: string[] = [];
    for (const r of station.receivers) {
      const norm = normalizeUrl(r.url);
      seenUrls.add(norm);
      stationUrls.push(norm);
    }
    merged.push(station);
  }

  // Add new stations, skipping duplicates
  for (const source of newSources) {
    for (const station of source) {
      // Check if any receiver URL already exists
      const isDuplicate = station.receivers.some((r) =>
        seenUrls.has(normalizeUrl(r.url))
      );

      if (!isDuplicate) {
        for (const r of station.receivers) {
          seenUrls.add(normalizeUrl(r.url));
        }
        merged.push(station);
      }
    }
  }

  return merged;
}

/* ── In-Memory Cache ───────────────────────────────── */

let cachedResult: AggregationResult | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function getCachedAggregation(): AggregationResult | null {
  if (!cachedResult) return null;
  if (Date.now() - cachedResult.fetchedAt > CACHE_TTL) {
    cachedResult = null;
    return null;
  }
  return cachedResult;
}

/**
 * Fetch from all directory sources, merge with existing stations,
 * and return the aggregated result.
 */
export async function aggregateDirectories(
  existingStations: DirectoryStation[]
): Promise<AggregationResult> {
  // Check cache first
  const cached = getCachedAggregation();
  if (cached) return cached;

  const existingCount = existingStations.length;
  const taggedExisting = existingStations.map((s) => ({
    ...s,
    source: s.source || "static",
  }));

  // Fetch all sources in parallel
  const [kiwiResult, websdrResult, sdrListResult, receiverBookResult] = await Promise.all([
    fetchKiwiSdrDirectory(),
    fetchWebSdrDirectory(),
    fetchSdrListDirectory(),
    fetchReceiverBookDirectory(),
  ]);

  // Merge with deduplication
  const merged = mergeStations(
    taggedExisting,
    kiwiResult.stations,
    websdrResult.stations,
    sdrListResult.stations,
    receiverBookResult.stations
  );

  const totalNew = merged.length - existingCount;

  const result: AggregationResult = {
    stations: merged,
    sources: [
      {
        name: "static (stations.json)",
        fetched: existingCount,
        newStations: 0,
        errors: [],
      },
      {
        name: "KiwiSDR GPS Directory",
        fetched: kiwiResult.stations.length,
        newStations: kiwiResult.stations.filter(
          (s) =>
            !taggedExisting.some((e) =>
              e.receivers.some((er) =>
                s.receivers.some(
                  (sr) => normalizeUrl(er.url) === normalizeUrl(sr.url)
                )
              )
            )
        ).length,
        errors: kiwiResult.errors,
      },
      {
        name: "WebSDR.org",
        fetched: websdrResult.stations.length,
        newStations: websdrResult.stations.filter(
          (s) =>
            !taggedExisting.some((e) =>
              e.receivers.some((er) =>
                s.receivers.some(
                  (sr) => normalizeUrl(er.url) === normalizeUrl(sr.url)
                )
              )
            )
        ).length,
        errors: websdrResult.errors,
      },
      {
        name: "sdr-list.xyz (NovaSDR)",
        fetched: sdrListResult.stations.length,
        newStations: sdrListResult.stations.filter(
          (s) =>
            !taggedExisting.some((e) =>
              e.receivers.some((er) =>
                s.receivers.some(
                  (sr) => normalizeUrl(er.url) === normalizeUrl(sr.url)
                )
              )
            )
        ).length,
        errors: sdrListResult.errors,
      },
      {
        name: "ReceiverBook.de",
        fetched: receiverBookResult.stations.length,
        newStations: receiverBookResult.stations.filter(
          (s) =>
            !taggedExisting.some((e) =>
              e.receivers.some((er) =>
                s.receivers.some(
                  (sr) => normalizeUrl(er.url) === normalizeUrl(sr.url)
                )
              )
            )
        ).length,
        errors: receiverBookResult.errors,
      },
    ],
    totalStations: merged.length,
    totalNew,
    fetchedAt: Date.now(),
  };

  cachedResult = result;
  console.log(
    `[DirectoryAggregator] Aggregation complete: ${merged.length} total stations (${totalNew} new from directories)`
  );

  return result;
}

/**
 * Force-clear the aggregation cache so the next call re-fetches.
 */
export function clearAggregationCache(): void {
  cachedResult = null;
}
