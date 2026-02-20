import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";

// ── UCDP API Configuration ──────────────────────────────────────────
const UCDP_BASE = "https://ucdpapi.pcr.uu.se/api";
const GED_VERSION = "25.1"; // Latest GED version
const CANDIDATE_VERSION = "25.0.12"; // Latest candidate (near-real-time) version
const PAGE_SIZE = 1000; // Max allowed by UCDP API
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// ── Types ───────────────────────────────────────────────────────────
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

interface UcdpApiResponse {
  TotalCount: number;
  TotalPages: number;
  PreviousPageUrl: string | null;
  NextPageUrl: string | null;
  Result: UcdpEvent[];
}

// ── In-memory cache ─────────────────────────────────────────────────
interface CacheEntry {
  data: UcdpEvent[];
  totalCount: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(params: {
  startDate?: string;
  endDate?: string;
  region?: string;
  typeOfViolence?: string;
  country?: string;
  dataset: string;
}): string {
  return JSON.stringify(params);
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

// ── UCDP API fetcher ────────────────────────────────────────────────
async function fetchUcdpEvents(params: {
  startDate?: string;
  endDate?: string;
  region?: string;
  typeOfViolence?: string;
  country?: string;
  dataset?: "ged" | "candidate";
  maxPages?: number;
}): Promise<{ events: UcdpEvent[]; totalCount: number }> {
  const dataset = params.dataset ?? "ged";
  const version = dataset === "candidate" ? CANDIDATE_VERSION : GED_VERSION;
  const maxPages = params.maxPages ?? 10; // Default: fetch up to 10 pages (10,000 events)

  const cacheKey = getCacheKey({ ...params, dataset });
  const cached = getCached(cacheKey);
  if (cached) {
    return { events: cached.data, totalCount: cached.totalCount };
  }

  const allEvents: UcdpEvent[] = [];
  let page = 0;
  let totalCount = 0;
  let totalPages = 1;

  while (page < totalPages && page < maxPages) {
    const url = new URL(`${UCDP_BASE}/gedevents/${version}`);
    url.searchParams.set("pagesize", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));

    if (params.startDate) url.searchParams.set("StartDate", params.startDate);
    if (params.endDate) url.searchParams.set("EndDate", params.endDate);
    if (params.region) url.searchParams.set("Region", params.region);
    if (params.typeOfViolence)
      url.searchParams.set("TypeOfViolence", params.typeOfViolence);
    if (params.country) url.searchParams.set("Country", params.country);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(
        `UCDP API error: ${res.status} ${res.statusText}`
      );
    }

    const data: UcdpApiResponse = await res.json();
    totalCount = data.TotalCount;
    totalPages = data.TotalPages;
    allEvents.push(...data.Result);
    page++;
  }

  // Cache the result
  cache.set(cacheKey, {
    data: allEvents,
    totalCount,
    fetchedAt: Date.now(),
  });

  return { events: allEvents, totalCount };
}

// ── Slim event type for the globe overlay (reduce payload) ──────────
interface SlimConflictEvent {
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

function slimEvent(e: UcdpEvent): SlimConflictEvent {
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
          dataset: z.enum(["ged", "candidate"]).optional(),
          maxPages: z.number().min(1).max(50).optional(),
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

      return {
        events: events.map(slimEvent),
        totalCount,
        fetchedCount: events.length,
      };
    }),

  /**
   * Get full detail for a single event by ID.
   */
  getEventDetail: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const url = `${UCDP_BASE}/gedevents/${GED_VERSION}/${input.id}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        // Try candidate dataset
        const candidateUrl = `${UCDP_BASE}/gedevents/${CANDIDATE_VERSION}/${input.id}`;
        const candidateRes = await fetch(candidateUrl, {
          headers: { Accept: "application/json" },
        });
        if (!candidateRes.ok) {
          throw new Error(`Event ${input.id} not found`);
        }
        const data = await candidateRes.json();
        return (data.Result?.[0] ?? data) as UcdpEvent;
      }

      const data = await res.json();
      return (data.Result?.[0] ?? data) as UcdpEvent;
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
          dataset: z.enum(["ged", "candidate"]).optional(),
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

      const { events, totalCount } = await fetchUcdpEvents({
        ...params,
        maxPages: 50,
      });

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
   * Clear the server-side cache (admin utility).
   */
  clearCache: publicProcedure.mutation(() => {
    cache.clear();
    return { cleared: true };
  }),
});
