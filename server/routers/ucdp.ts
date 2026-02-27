import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { updateConflictEventCache } from "../conflictZoneChecker";

// ── HDX HAPI Configuration (free, no auth required) ────────────────
const HAPI_BASE = "https://hapi.humdata.org/api/v2";
const APP_ID = Buffer.from("radio-globe:radioglobe@manus.im").toString("base64");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const MAX_LIMIT = 10000; // HDX HAPI max records per request

// ── HDX event type → UCDP violence type mapping ───────────────────
// HDX HAPI event_type: "political_violence" | "civilian_targeting" | "demonstration"
// UCDP type_of_violence: 1=state-based, 2=non-state, 3=one-sided
const EVENT_TYPE_TO_VIOLENCE: Record<string, number> = {
  political_violence: 1,  // State-based armed conflict
  civilian_targeting: 3,  // One-sided violence against civilians
  demonstration: 2,       // Non-state collective action
};

const VIOLENCE_TO_EVENT_TYPE: Record<string, string[]> = {
  "1": ["political_violence"],
  "2": ["demonstration"],
  "3": ["civilian_targeting"],
};

// ── Region mapping (UCDP regions → ISO3 country groups) ───────────
// HDX HAPI uses ISO3 country codes; we map UCDP-style region names
const REGION_COUNTRY_MAP: Record<string, string[]> = {
  Africa: [
    "DZA", "AGO", "BEN", "BWA", "BFA", "BDI", "CMR", "CPV", "CAF", "TCD",
    "COM", "COG", "COD", "CIV", "DJI", "EGY", "GNQ", "ERI", "SWZ", "ETH",
    "GAB", "GMB", "GHA", "GIN", "GNB", "KEN", "LSO", "LBR", "LBY", "MDG",
    "MWI", "MLI", "MRT", "MUS", "MAR", "MOZ", "NAM", "NER", "NGA", "RWA",
    "STP", "SEN", "SYC", "SLE", "SOM", "ZAF", "SSD", "SDN", "TZA", "TGO",
    "TUN", "UGA", "ZMB", "ZWE",
  ],
  Americas: [
    "ARG", "BHS", "BRB", "BLZ", "BOL", "BRA", "CAN", "CHL", "COL", "CRI",
    "CUB", "DOM", "ECU", "SLV", "GTM", "GUY", "HTI", "HND", "JAM", "MEX",
    "NIC", "PAN", "PRY", "PER", "PRI", "SUR", "TTO", "USA", "URY", "VEN",
  ],
  Asia: [
    "AFG", "BGD", "BTN", "BRN", "KHM", "CHN", "IND", "IDN", "JPN", "KAZ",
    "KGZ", "LAO", "MYS", "MDV", "MNG", "MMR", "NPL", "PRK", "PAK", "PHL",
    "KOR", "LKA", "TWN", "TJK", "THA", "TLS", "TKM", "UZB", "VNM",
  ],
  Europe: [
    "ALB", "AND", "ARM", "AUT", "AZE", "BLR", "BEL", "BIH", "BGR", "HRV",
    "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "GEO", "DEU", "GRC", "HUN",
    "ISL", "IRL", "ITA", "XKX", "LVA", "LTU", "LUX", "MKD", "MLT", "MDA",
    "MNE", "NLD", "NOR", "POL", "PRT", "ROU", "RUS", "SRB", "SVK", "SVN",
    "ESP", "SWE", "CHE", "TUR", "UKR", "GBR",
  ],
  "Middle East": [
    "BHR", "IRN", "IRQ", "ISR", "JOR", "KWT", "LBN", "OMN", "PSE", "QAT",
    "SAU", "SYR", "ARE", "YEM",
  ],
};

// ── Country centroid coordinates for globe markers ─────────────────
// Approximate geographic center of each country (lat, lng)
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  AFG: [33.94, 67.71], AGO: [-11.20, 17.87], ALB: [41.15, 20.17],
  DZA: [28.03, 1.66], AND: [42.55, 1.60], ARE: [23.42, 53.85],
  ARG: [-38.42, -63.62], ARM: [40.07, 45.04], AUS: [-25.27, 133.78],
  AUT: [47.52, 14.55], AZE: [40.14, 47.58], BHS: [25.03, -77.40],
  BHR: [26.07, 50.56], BGD: [23.68, 90.36], BRB: [13.19, -59.54],
  BLR: [53.71, 27.95], BEL: [50.50, 4.47], BLZ: [17.19, -88.50],
  BEN: [9.31, 2.32], BTN: [27.51, 90.43], BOL: [-16.29, -63.59],
  BIH: [43.92, 17.68], BWA: [-22.33, 24.68], BRA: [-14.24, -51.93],
  BRN: [4.54, 114.73], BGR: [42.73, 25.49], BFA: [12.24, -1.56],
  BDI: [-3.37, 29.92], KHM: [12.57, 104.99], CMR: [7.37, 12.35],
  CAN: [56.13, -106.35], CPV: [16.00, -24.01], CAF: [6.61, 20.94],
  TCD: [15.45, 18.73], CHL: [-35.68, -71.54], CHN: [35.86, 104.20],
  COL: [4.57, -74.30], COM: [-11.88, 43.87], COG: [-0.23, 15.83],
  COD: [-4.04, 21.76], CRI: [9.75, -83.75], HRV: [45.10, 15.20],
  CUB: [21.52, -77.78], CYP: [35.13, 33.43], CZE: [49.82, 15.47],
  CIV: [7.54, -5.55], DNK: [56.26, 9.50], DJI: [11.83, 42.59],
  DOM: [18.74, -70.16], ECU: [-1.83, -78.18], EGY: [26.82, 30.80],
  SLV: [13.79, -88.90], GNQ: [1.65, 10.27], ERI: [15.18, 39.78],
  EST: [58.60, 25.01], SWZ: [-26.52, 31.47], ETH: [9.15, 40.49],
  FIN: [61.92, 25.75], FRA: [46.23, 2.21], GAB: [-0.80, 11.61],
  GMB: [13.44, -15.31], GEO: [42.32, 43.36], DEU: [51.17, 10.45],
  GHA: [7.95, -1.02], GRC: [39.07, 21.82], GTM: [15.78, -90.23],
  GIN: [9.95, -9.70], GNB: [11.80, -15.18], GUY: [4.86, -58.93],
  HTI: [18.97, -72.29], HND: [15.20, -86.24], HUN: [47.16, 19.50],
  ISL: [64.96, -19.02], IND: [20.59, 78.96], IDN: [-0.79, 113.92],
  IRN: [32.43, 53.69], IRQ: [33.22, 43.68], IRL: [53.41, -8.24],
  ISR: [31.05, 34.85], ITA: [41.87, 12.57], JAM: [18.11, -77.30],
  JPN: [36.20, 138.25], JOR: [30.59, 36.24], KAZ: [48.02, 66.92],
  KEN: [-0.02, 37.91], KGZ: [41.20, 74.77], KWT: [29.31, 47.48],
  LAO: [19.86, 102.50], LVA: [56.88, 24.60], LBN: [33.85, 35.86],
  LSO: [-29.61, 28.23], LBR: [6.43, -9.43], LBY: [26.34, 17.23],
  LTU: [55.17, 23.88], LUX: [49.82, 6.13], MKD: [41.51, 21.75],
  MDG: [-18.77, 46.87], MWI: [-13.25, 34.30], MYS: [4.21, 101.98],
  MDV: [3.20, 73.22], MLI: [17.57, -4.00], MLT: [35.94, 14.38],
  MRT: [21.01, -10.94], MUS: [-20.35, 57.55], MEX: [23.63, -102.55],
  MDA: [47.41, 28.37], MNG: [46.86, 103.85], MNE: [42.71, 19.37],
  MAR: [31.79, -7.09], MOZ: [-18.67, 35.53], MMR: [21.91, 95.96],
  NAM: [-22.96, 18.49], NPL: [28.39, 84.12], NLD: [52.13, 5.29],
  NIC: [12.87, -85.21], NER: [17.61, 8.08], NGA: [9.08, 8.68],
  PRK: [40.34, 127.51], NOR: [60.47, 8.47], OMN: [21.47, 55.98],
  PAK: [30.38, 69.35], PAN: [8.54, -80.78], PNG: [-6.31, 143.96],
  PRY: [-23.44, -58.44], PER: [-9.19, -75.02], PHL: [12.88, 121.77],
  POL: [51.92, 19.15], PRT: [39.40, -8.22], PRI: [18.22, -66.59],
  PSE: [31.95, 35.23], QAT: [25.35, 51.18], ROU: [45.94, 24.97],
  RUS: [61.52, 105.32], RWA: [-1.94, 29.87], SAU: [23.89, 45.08],
  SEN: [14.50, -14.45], SRB: [44.02, 21.01], SYC: [-4.68, 55.49],
  SLE: [8.46, -11.78], SVK: [48.67, 19.70], SVN: [46.15, 14.99],
  SOM: [5.15, 46.20], ZAF: [-30.56, 22.94], KOR: [35.91, 127.77],
  SSD: [6.88, 31.31], ESP: [40.46, -3.75], LKA: [7.87, 80.77],
  SDN: [12.86, 30.22], SUR: [3.92, -56.03], SWE: [60.13, 18.64],
  CHE: [46.82, 8.23], SYR: [34.80, 38.99], TWN: [23.70, 120.96],
  TJK: [38.86, 71.28], TZA: [-6.37, 34.89], THA: [15.87, 100.99],
  TLS: [-8.87, 125.73], TGO: [8.62, 1.21], TTO: [10.69, -61.22],
  TUN: [33.89, 9.54], TUR: [38.96, 35.24], TKM: [38.97, 59.56],
  UGA: [1.37, 32.29], UKR: [48.38, 31.17], GBR: [55.38, -3.44],
  USA: [37.09, -95.71], URY: [-32.52, -55.77], UZB: [41.38, 64.59],
  VEN: [6.42, -66.59], VNM: [14.06, 108.28], XKX: [42.60, 20.90],
  YEM: [15.55, 48.52], ZMB: [-13.13, 27.85], ZWE: [-19.02, 29.15],
  STP: [0.19, 6.61],
};

// ── Types (maintained for backward compatibility) ──────────────────
export interface UcdpEvent {
  id: number;
  relid: string;
  year: number;
  type_of_violence: number; // 1=state-based, 2=non-state, 3=one-sided
  conflict_name: string;
  dyad_name: string;
  side_a: string;
  side_b: string;
  latitude: number;
  longitude: number;
  country: string;
  country_id: number;
  region: string;
  date_start: string;
  date_end: string;
  best: number; // best estimate of fatalities
  high: number;
  low: number;
  deaths_a: number;
  deaths_b: number;
  deaths_civilians: number;
  deaths_unknown: number;
  where_description: string;
  adm_1: string;
  adm_2: string;
  source_article: string;
  event_clarity: number;
  where_prec: number;
}

// ── HDX HAPI response types ────────────────────────────────────────
interface HapiConflictEvent {
  location_code: string;
  location_name: string;
  admin1_code: string | null;
  admin1_name: string | null;
  admin2_code: string | null;
  admin2_name: string | null;
  admin_level: number;
  resource_hdx_id: string;
  event_type: string; // "political_violence" | "civilian_targeting" | "demonstration"
  events: number;
  fatalities: number;
  reference_period_start: string;
  reference_period_end: string;
}

interface HapiNationalRisk {
  risk_class: string;
  global_rank: number;
  overall_risk: number;
  hazard_exposure_risk: number;
  vulnerability_risk: number;
  coping_capacity_risk: number;
  location_code: string;
  location_name: string;
  reference_period_start: string;
  reference_period_end: string;
}

interface HapiResponse<T> {
  data: T[];
}

// ── In-memory cache ─────────────────────────────────────────────────
interface CacheEntry<T = UcdpEvent[]> {
  data: T;
  totalCount: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

function getCacheKey(params: Record<string, any>): string {
  return JSON.stringify(params);
}

function getCached<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry as CacheEntry<T>;
}

// ── Determine region from ISO3 country code ────────────────────────
function getRegionForCountry(code: string): string {
  for (const [region, codes] of Object.entries(REGION_COUNTRY_MAP)) {
    if (codes.includes(code)) return region;
  }
  return "Other";
}

// ── Add jitter to coordinates so markers don't stack ───────────────
function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range;
}

// ── Convert HDX HAPI aggregated records to UcdpEvent format ────────
function hapiToUcdpEvents(records: HapiConflictEvent[]): UcdpEvent[] {
  const events: UcdpEvent[] = [];
  let syntheticId = 1_000_000; // Start high to avoid collision

  for (const rec of records) {
    // Skip zero-event records
    if (rec.events === 0 && rec.fatalities === 0) continue;

    const centroid = COUNTRY_CENTROIDS[rec.location_code];
    if (!centroid) continue;

    const violenceType = EVENT_TYPE_TO_VIOLENCE[rec.event_type] ?? 1;
    const region = getRegionForCountry(rec.location_code);
    const dateEnd = rec.reference_period_end?.split("T")[0] ?? rec.reference_period_start?.split("T")[0] ?? "";
    const dateStart = rec.reference_period_start?.split("T")[0] ?? "";
    const year = dateStart ? parseInt(dateStart.substring(0, 4), 10) : new Date().getFullYear();

    // For each aggregated record, create individual synthetic events
    // Spread them across the country with jitter for visual diversity
    const eventCount = Math.min(rec.events, 50); // Cap at 50 markers per record
    const fatalitiesPerEvent = eventCount > 0 ? Math.round(rec.fatalities / eventCount) : rec.fatalities;

    for (let i = 0; i < Math.max(1, eventCount); i++) {
      events.push({
        id: syntheticId++,
        relid: `HAPI-${rec.location_code}-${rec.event_type}-${dateStart}-${i}`,
        year,
        type_of_violence: violenceType,
        conflict_name: `${rec.event_type.replace(/_/g, " ")} in ${rec.location_name}`,
        dyad_name: `${rec.location_name} conflict`,
        side_a: rec.location_name,
        side_b: "",
        latitude: jitter(centroid[0], 3), // ±1.5 degrees jitter
        longitude: jitter(centroid[1], 3),
        country: rec.location_name,
        country_id: 0,
        region,
        date_start: dateStart,
        date_end: dateEnd,
        best: i === 0 ? fatalitiesPerEvent + (rec.fatalities % Math.max(1, eventCount)) : fatalitiesPerEvent,
        high: Math.round((i === 0 ? fatalitiesPerEvent + (rec.fatalities % Math.max(1, eventCount)) : fatalitiesPerEvent) * 1.2),
        low: Math.round((i === 0 ? fatalitiesPerEvent + (rec.fatalities % Math.max(1, eventCount)) : fatalitiesPerEvent) * 0.8),
        deaths_a: 0,
        deaths_b: 0,
        deaths_civilians: violenceType === 3 ? (i === 0 ? fatalitiesPerEvent : fatalitiesPerEvent) : 0,
        deaths_unknown: violenceType !== 3 ? (i === 0 ? fatalitiesPerEvent : fatalitiesPerEvent) : 0,
        where_description: rec.admin1_name || rec.location_name,
        adm_1: rec.admin1_name || "",
        adm_2: rec.admin2_name || "",
        source_article: "HDX Humanitarian API (ACLED data)",
        event_clarity: 1,
        where_prec: rec.admin_level === 0 ? 5 : rec.admin_level === 1 ? 3 : 1,
      });
    }
  }

  return events;
}

// ── Fetch conflict events from HDX HAPI ────────────────────────────
export async function fetchUcdpEvents(params: {
  startDate?: string;
  endDate?: string;
  region?: string;
  typeOfViolence?: string;
  country?: string;
  maxPages?: number;
}): Promise<{ events: UcdpEvent[]; totalCount: number }> {
  const cacheKey = getCacheKey({ ...params, source: "hapi" });
  const cached = getCached<UcdpEvent[]>(cacheKey);
  if (cached) {
    return { events: cached.data, totalCount: cached.totalCount };
  }

  // Build HDX HAPI query URL
  const url = new URL(`${HAPI_BASE}/coordination-context/conflict-events`);
  url.searchParams.set("app_identifier", APP_ID);
  url.searchParams.set("admin_level", "0"); // Country-level aggregation
  url.searchParams.set("limit", String(MAX_LIMIT));

  // Date filtering
  if (params.startDate) {
    url.searchParams.set("start_date", params.startDate);
  }
  if (params.endDate) {
    url.searchParams.set("end_date", params.endDate);
  }

  // Event type filtering (map UCDP violence type numbers to HDX event types)
  if (params.typeOfViolence) {
    const types = params.typeOfViolence.split(",").map((t) => t.trim());
    const hapiTypes = new Set<string>();
    for (const t of types) {
      const mapped = VIOLENCE_TO_EVENT_TYPE[t];
      if (mapped) mapped.forEach((m) => hapiTypes.add(m));
    }
    if (hapiTypes.size === 1) {
      url.searchParams.set("event_type", Array.from(hapiTypes)[0]);
    }
    // If multiple types, we fetch all and filter client-side
  }

  // Country filtering (ISO3 code or name)
  if (params.country) {
    // If it looks like an ISO3 code
    if (params.country.length === 3 && params.country === params.country.toUpperCase()) {
      url.searchParams.set("location_code", params.country);
    } else {
      url.searchParams.set("location_name", params.country);
    }
  }

  // Region filtering: filter by country codes in that region
  // HDX HAPI doesn't have a region filter, so we fetch all and filter
  const regionFilter = params.region;

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`HDX HAPI error: ${res.status} ${res.statusText}`);
    }

    const data: HapiResponse<HapiConflictEvent> = await res.json();
    let records = data.data || [];

    // Apply region filter if specified
    if (regionFilter) {
      const regionCodes = REGION_COUNTRY_MAP[regionFilter];
      if (regionCodes) {
        records = records.filter((r) => regionCodes.includes(r.location_code));
      }
    }

    // Apply violence type filter if multiple types specified
    if (params.typeOfViolence) {
      const types = params.typeOfViolence.split(",").map((t) => t.trim());
      const hapiTypes = new Set<string>();
      for (const t of types) {
        const mapped = VIOLENCE_TO_EVENT_TYPE[t];
        if (mapped) mapped.forEach((m) => hapiTypes.add(m));
      }
      if (hapiTypes.size > 0) {
        records = records.filter((r) => hapiTypes.has(r.event_type));
      }
    }

    // Convert to UcdpEvent format
    const events = hapiToUcdpEvents(records);

    // Sort by date descending
    events.sort((a, b) => b.date_end.localeCompare(a.date_end));

    // Cache the result
    cache.set(cacheKey, {
      data: events,
      totalCount: events.length,
      fetchedAt: Date.now(),
    });

    return { events, totalCount: events.length };
  } catch (error) {
    console.error("[HDX HAPI] Fetch error:", error);
    throw error;
  }
}

// ── Fetch national risk data from HDX HAPI ─────────────────────────
async function fetchNationalRisk(params?: {
  country?: string;
}): Promise<HapiNationalRisk[]> {
  const cacheKey = getCacheKey({ ...params, source: "hapi-risk" });
  const cached = getCached<HapiNationalRisk[]>(cacheKey);
  if (cached) return cached.data;

  const url = new URL(`${HAPI_BASE}/coordination-context/national-risk`);
  url.searchParams.set("app_identifier", APP_ID);
  url.searchParams.set("limit", String(MAX_LIMIT));

  if (params?.country) {
    if (params.country.length === 3 && params.country === params.country.toUpperCase()) {
      url.searchParams.set("location_code", params.country);
    } else {
      url.searchParams.set("location_name", params.country);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`HDX HAPI risk error: ${res.status}`);

  const data: HapiResponse<HapiNationalRisk> = await res.json();
  const risks = data.data || [];

  cache.set(cacheKey, { data: risks, totalCount: risks.length, fetchedAt: Date.now() });
  return risks;
}

// ── Slim event type for the globe overlay (reduce payload) ──────────
export interface SlimConflictEvent {
  id: number;
  lat: number;
  lng: number;
  type: number; // type_of_violence
  best: number; // fatalities best estimate
  date: string; // date_end
  country: string;
  region: string;
  conflict: string;
  sideA: string;
  sideB: string;
}

export function slimEvent(e: UcdpEvent): SlimConflictEvent {
  return {
    id: e.id,
    lat: e.latitude,
    lng: e.longitude,
    type: e.type_of_violence,
    best: e.best,
    date: e.date_end,
    country: e.country,
    region: e.region,
    conflict: e.conflict_name,
    sideA: e.side_a,
    sideB: e.side_b,
  };
}

// ── Router ──────────────────────────────────────────────────────────
export const ucdpRouter = router({
  /**
   * Get conflict events for the globe overlay.
   * Returns slim events to minimize payload size.
   * Data sourced from HDX Humanitarian API (ACLED conflict data).
   * Defaults to last 365 days of data.
   */
  getEvents: publicProcedure
    .input(
      z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          region: z.string().optional(),
          typeOfViolence: z.string().optional(), // "1", "2", "3", or "1,2" etc.
          country: z.string().optional(),
          maxPages: z.number().min(1).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const params = input ?? {};

      // Default to last 365 days if no date range specified
      if (!params.startDate && !params.endDate) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        params.startDate = oneYearAgo.toISOString().split("T")[0];
      }

      const { events, totalCount } = await fetchUcdpEvents(params);
      const slimEvents = events.map(slimEvent);

      // Update the shared conflict event cache for conflict zone alert checking
      updateConflictEventCache(slimEvents);

      return {
        events: slimEvents,
        totalCount,
        fetchedCount: events.length,
      };
    }),

  /**
   * Get full detail for a single event by ID.
   * For HDX HAPI, returns the event from the cached dataset.
   */
  getEventDetail: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // Search through all cached events
      for (const entry of Array.from(cache.values())) {
        if (Array.isArray(entry.data)) {
          const found = (entry.data as UcdpEvent[]).find((e) => e.id === input.id);
          if (found) return found;
        }
      }

      // If not in cache, fetch recent data and search
      const { events } = await fetchUcdpEvents({});
      const found = events.find((e) => e.id === input.id);
      if (found) return found;

      throw new Error(`Event ${input.id} not found`);
    }),

  /**
   * Get summary statistics for the current filter set.
   */
  getSummary: publicProcedure
    .input(
      z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          region: z.string().optional(),
          typeOfViolence: z.string().optional(),
          country: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const params = input ?? {};

      if (!params.startDate && !params.endDate) {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        params.startDate = oneYearAgo.toISOString().split("T")[0];
      }

      const { events, totalCount } = await fetchUcdpEvents(params);

      // Compute summary stats
      const byType: Record<number, number> = {};
      const byRegion: Record<string, number> = {};
      const byCountry: Record<string, number> = {};
      let totalFatalities = 0;
      let civilianDeaths = 0;

      for (const e of events) {
        byType[e.type_of_violence] = (byType[e.type_of_violence] ?? 0) + 1;
        byRegion[e.region] = (byRegion[e.region] ?? 0) + 1;
        byCountry[e.country] = (byCountry[e.country] ?? 0) + 1;
        totalFatalities += e.best;
        civilianDeaths += e.deaths_civilians;
      }

      // Sort countries by event count descending
      const topCountries = Object.entries(byCountry)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, count }));

      // Also fetch national risk data for enrichment
      let riskData: HapiNationalRisk[] = [];
      try {
        riskData = await fetchNationalRisk(params.country ? { country: params.country } : undefined);
      } catch {
        // Risk data is optional enrichment
      }

      return {
        totalEvents: totalCount,
        fetchedEvents: events.length,
        totalFatalities,
        civilianDeaths,
        byType: {
          stateBased: byType[1] ?? 0,
          nonState: byType[2] ?? 0,
          oneSided: byType[3] ?? 0,
        },
        byRegion,
        topCountries,
        // Enrichment: national risk scores (if available)
        riskScores: riskData.length > 0
          ? riskData.slice(0, 20).map((r) => ({
              country: r.location_name,
              code: r.location_code,
              riskClass: r.risk_class,
              overallRisk: r.overall_risk,
              globalRank: r.global_rank,
            }))
          : undefined,
      };
    }),

  /**
   * Get available regions for filtering.
   */
  getRegions: publicProcedure.query(() => {
    return [
      "Africa",
      "Americas",
      "Asia",
      "Europe",
      "Middle East",
    ];
  }),

  /**
   * Get national risk scores for countries.
   * Uses INFORM risk framework data from HDX HAPI.
   */
  getNationalRisk: publicProcedure
    .input(
      z
        .object({
          country: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const risks = await fetchNationalRisk(input ?? undefined);
      return {
        risks: risks.map((r) => ({
          country: r.location_name,
          code: r.location_code,
          riskClass: r.risk_class,
          globalRank: r.global_rank,
          overallRisk: r.overall_risk,
          hazardExposure: r.hazard_exposure_risk,
          vulnerability: r.vulnerability_risk,
          copingCapacity: r.coping_capacity_risk,
        })),
        totalCount: risks.length,
      };
    }),

  /**
   * Clear the server-side cache (admin utility).
   */
  clearCache: publicProcedure.mutation(() => {
    cache.clear();
    return { cleared: true };
  }),
});
