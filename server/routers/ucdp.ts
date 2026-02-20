import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";

// ── UCDP API Configuration ──────────────────────────────────────────
const UCDP_BASE = "https://ucdpapi.pcr.uu.se/api";
const GED_VERSION = "25.1"; // Full verified dataset (up to ~end of 2024)
const CANDIDATE_VERSION = "25.0.12"; // Near-real-time candidate data (2025+)
const PAGE_SIZE = 1000; // Max allowed by UCDP API
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// The GED dataset typically covers up to the end of the previous year.
// Candidate data covers the current year onward.
// We use Jan 1 of the current year as the cutover point.
const GED_CUTOFF_DATE = "2025-01-01";

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

// ── Single-dataset UCDP API fetcher ─────────────────────────────────
async function fetchFromDataset(params: {
  version: string;
  startDate?: string;
  endDate?: string;
  region?: string;
  typeOfViolence?: string;
  country?: string;
  maxPages: number;
}): Promise<{ events: UcdpEvent[]; totalCount: number }> {
  const allEvents: UcdpEvent[] = [];
  let page = 0;
  let totalCount = 0;
  let totalPages = 1;

  while (page < totalPages && page < params.maxPages) {
    const url = new URL(`${UCDP_BASE}/gedevents/${params.version}`);
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
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(
        `UCDP API error: ${res.status} ${res.statusText} (${params.version})`
      );
    }

    const data: UcdpApiResponse = await res.json();
    totalCount = data.TotalCount;
    totalPages = data.TotalPages;
    allEvents.push(...data.Result);
    page++;
  }

  return { events: allEvents, totalCount };
}

// ── Merged fetcher: GED for older data + Candidate for recent ───────
async function fetchUcdpEvents(params: {
  startDate?: string;
  endDate?: string;
  region?: string;
  typeOfViolence?: string;
  country?: string;
  maxPages?: number;
}): Promise<{ events: UcdpEvent[]; totalCount: number }> {
  const maxPages = params.maxPages ?? 10;

  // Check merged cache first
  const cacheKey = getCacheKey({ ...params, dataset: "merged" });
  const cached = getCached(cacheKey);
  if (cached) {
    return { events: cached.data, totalCount: cached.totalCount };
  }

  const requestStart = params.startDate ?? "2020-01-01";
  const requestEnd = params.endDate;

  // Determine which datasets to query based on the date range
  const needsGed = requestStart < GED_CUTOFF_DATE;
  const needsCandidate = !requestEnd || requestEnd >= GED_CUTOFF_DATE;

  const fetches: Promise<{ events: UcdpEvent[]; totalCount: number }>[] = [];

  if (needsGed) {
    // Fetch GED data for the portion before the cutoff
    const gedEnd =
      requestEnd && requestEnd < GED_CUTOFF_DATE
        ? requestEnd
        : "2024-12-31";
    fetches.push(
      fetchFromDataset({
        version: GED_VERSION,
        startDate: requestStart,
        endDate: gedEnd,
        region: params.region,
        typeOfViolence: params.typeOfViolence,
        country: params.country,
        maxPages: Math.ceil(maxPages / (needsCandidate ? 2 : 1)),
      })
    );
  }

  if (needsCandidate) {
    // Fetch candidate data for the portion from the cutoff onward
    const candidateStart =
      requestStart >= GED_CUTOFF_DATE ? requestStart : GED_CUTOFF_DATE;
    fetches.push(
      fetchFromDataset({
        version: CANDIDATE_VERSION,
        startDate: candidateStart,
        endDate: requestEnd,
        region: params.region,
        typeOfViolence: params.typeOfViolence,
        country: params.country,
        maxPages: Math.ceil(maxPages / (needsGed ? 2 : 1)),
      })
    );
  }

  // Execute in parallel
  const results = await Promise.all(fetches);

  // Merge and deduplicate by event ID
  const eventMap = new Map<number, UcdpEvent>();
  let totalCount = 0;

  for (const result of results) {
    totalCount += result.totalCount;
    for (const event of result.events) {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }
  }

  const allEvents = Array.from(eventMap.values());

  // Sort by date descending (most recent first)
  allEvents.sort((a, b) => b.date_end.localeCompare(a.date_end));

  // Cache the merged result
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
   * Merges GED (verified, up to ~2024) and Candidate (near-real-time, 2025+) datasets.
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
   * Tries GED first, then falls back to candidate dataset.
   */
  getEventDetail: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // Try GED first
      const gedUrl = `${UCDP_BASE}/gedevents/${GED_VERSION}/${input.id}`;
      try {
        const res = await fetch(gedUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const data = await res.json();
          const event = data.Result?.[0] ?? data;
          if (event && event.id) return event as UcdpEvent;
        }
      } catch {
        // Fall through to candidate
      }

      // Try candidate dataset
      const candidateUrl = `${UCDP_BASE}/gedevents/${CANDIDATE_VERSION}/${input.id}`;
      const candidateRes = await fetch(candidateUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!candidateRes.ok) {
        throw new Error(`Event ${input.id} not found in either GED or candidate dataset`);
      }
      const data = await candidateRes.json();
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
