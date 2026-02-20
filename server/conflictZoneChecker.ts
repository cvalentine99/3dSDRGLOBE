/**
 * conflictZoneChecker.ts — Conflict Zone Alert Engine
 *
 * Checks whether tracked TDoA targets are located near active conflict zones
 * using UCDP conflict event data. When a target drifts into or near a conflict
 * zone, an anomaly alert is generated with conflict context.
 *
 * Alert types:
 * - "conflict_entry": Target has moved INTO a conflict zone
 * - "conflict_proximity": Target is NEAR a conflict zone (within buffer)
 *
 * Severity mapping:
 * - high: Target is within 50km of active conflict events with >10 fatalities
 * - medium: Target is within 100km of active conflict events
 * - low: Target is within 200km of active conflict events
 */

import { haversineKm } from "@shared/geo";
import { getDb } from "./db";
import { anomalyAlerts, tdoaTargets, tdoaTargetHistory } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// ── Types ───────────────────────────────────────────────────────────

export interface ConflictEvent {
  id: number;
  lat: number;
  lng: number;
  type: number; // 1=state-based, 2=non-state, 3=one-sided
  best: number; // fatalities best estimate
  date: string;
  country: string;
  region: string;
  conflict: string;
  sideA: string;
  sideB: string;
}

export interface ConflictZoneCheckResult {
  isInConflictZone: boolean;
  severity: "low" | "medium" | "high" | null;
  nearbyEventCount: number;
  closestDistanceKm: number;
  totalFatalities: number;
  dominantConflict: string | null;
  dominantCountry: string | null;
  alertId: number | null;
}

// ── Configuration ───────────────────────────────────────────────────

/** Radius thresholds for conflict zone proximity (km) */
export const CONFLICT_ZONE_THRESHOLDS = {
  high: 50,    // Within 50km of events with significant fatalities
  medium: 100, // Within 100km of any conflict events
  low: 200,    // Within 200km of any conflict events
} as const;

/** Minimum fatalities in nearby events to escalate to "high" severity */
export const HIGH_SEVERITY_FATALITY_THRESHOLD = 10;

/** Minimum number of nearby events to generate an alert */
export const MIN_EVENTS_FOR_ALERT = 1;

// ── In-memory conflict event cache ──────────────────────────────────
// This is populated by the UCDP router and shared with the checker

let cachedConflictEvents: ConflictEvent[] = [];
let cacheTimestamp = 0;
const CONFLICT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Update the shared conflict event cache.
 * Called by the UCDP router after fetching events.
 */
export function updateConflictEventCache(events: ConflictEvent[]): void {
  cachedConflictEvents = events;
  cacheTimestamp = Date.now();
}

/**
 * Get the cached conflict events.
 */
export function getCachedConflictEvents(): ConflictEvent[] {
  if (Date.now() - cacheTimestamp > CONFLICT_CACHE_TTL) {
    return []; // Cache expired
  }
  return cachedConflictEvents;
}

/**
 * Check if cached conflict events are available and fresh.
 */
export function hasValidConflictCache(): boolean {
  return cachedConflictEvents.length > 0 && (Date.now() - cacheTimestamp) < CONFLICT_CACHE_TTL;
}

// ── Spatial index for fast proximity queries ────────────────────────

const CELL_SIZE = 2; // degrees

function buildSpatialIndex(events: ConflictEvent[]): Map<string, ConflictEvent[]> {
  const grid = new Map<string, ConflictEvent[]>();
  for (const evt of events) {
    const key = `${Math.floor(evt.lat / CELL_SIZE)},${Math.floor(evt.lng / CELL_SIZE)}`;
    const cell = grid.get(key);
    if (cell) cell.push(evt);
    else grid.set(key, [evt]);
  }
  return grid;
}

function getNearbyEvents(
  grid: Map<string, ConflictEvent[]>,
  lat: number,
  lon: number,
  radiusKm: number
): ConflictEvent[] {
  const cellRadius = Math.ceil(radiusKm / 111 / CELL_SIZE) + 1;
  const centerLat = Math.floor(lat / CELL_SIZE);
  const centerLon = Math.floor(lon / CELL_SIZE);
  const results: ConflictEvent[] = [];

  for (let dLat = -cellRadius; dLat <= cellRadius; dLat++) {
    for (let dLon = -cellRadius; dLon <= cellRadius; dLon++) {
      const key = `${centerLat + dLat},${centerLon + dLon}`;
      const cell = grid.get(key);
      if (cell) {
        for (const evt of cell) {
          const dist = haversineKm(lat, lon, evt.lat, evt.lng);
          if (dist <= radiusKm) results.push(evt);
        }
      }
    }
  }

  return results;
}

// ── Core check function ─────────────────────────────────────────────

/**
 * Determine the conflict zone severity for a given position.
 * Does NOT create alerts — just computes the proximity analysis.
 */
export function analyzeConflictProximity(
  lat: number,
  lon: number,
  events: ConflictEvent[]
): {
  severity: "low" | "medium" | "high" | null;
  nearbyEventCount: number;
  closestDistanceKm: number;
  totalFatalities: number;
  dominantConflict: string | null;
  dominantCountry: string | null;
  nearbyEvents: ConflictEvent[];
} {
  if (events.length === 0) {
    return {
      severity: null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null,
      dominantCountry: null,
      nearbyEvents: [],
    };
  }

  const grid = buildSpatialIndex(events);
  const nearby = getNearbyEvents(grid, lat, lon, CONFLICT_ZONE_THRESHOLDS.low);

  if (nearby.length < MIN_EVENTS_FOR_ALERT) {
    return {
      severity: null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null,
      dominantCountry: null,
      nearbyEvents: [],
    };
  }

  // Compute metrics
  let closestDist = Infinity;
  let totalFat = 0;
  const conflictCounts: Record<string, number> = {};
  const countryCounts: Record<string, number> = {};

  for (const evt of nearby) {
    const dist = haversineKm(lat, lon, evt.lat, evt.lng);
    if (dist < closestDist) closestDist = dist;
    totalFat += evt.best;
    conflictCounts[evt.conflict] = (conflictCounts[evt.conflict] ?? 0) + 1;
    countryCounts[evt.country] = (countryCounts[evt.country] ?? 0) + 1;
  }

  // Determine severity
  let severity: "low" | "medium" | "high" | null = null;

  // Events within 50km with significant fatalities → high
  const closeEvents = nearby.filter(
    (e) => haversineKm(lat, lon, e.lat, e.lng) <= CONFLICT_ZONE_THRESHOLDS.high
  );
  const closeFatalities = closeEvents.reduce((sum, e) => sum + e.best, 0);

  if (closeEvents.length > 0 && closeFatalities >= HIGH_SEVERITY_FATALITY_THRESHOLD) {
    severity = "high";
  } else if (
    nearby.some((e) => haversineKm(lat, lon, e.lat, e.lng) <= CONFLICT_ZONE_THRESHOLDS.medium)
  ) {
    severity = "medium";
  } else {
    severity = "low";
  }

  // Find dominant conflict and country
  const dominantConflict = Object.entries(conflictCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dominantCountry = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    severity,
    nearbyEventCount: nearby.length,
    closestDistanceKm: closestDist,
    totalFatalities: totalFat,
    dominantConflict,
    dominantCountry,
    nearbyEvents: nearby,
  };
}

/**
 * Check a target's current position against active conflict zones.
 * If the target is in/near a conflict zone, creates an anomaly alert.
 *
 * @param targetId - The target to check
 * @param lat - Target latitude
 * @param lon - Target longitude
 * @param historyEntryId - The history entry that triggered this check
 * @param conflictEvents - Optional pre-fetched conflict events (uses cache if not provided)
 * @param sendNotification - Whether to send owner notification
 */
export async function checkConflictZoneProximity(
  targetId: number,
  lat: number,
  lon: number,
  historyEntryId: number,
  conflictEvents?: ConflictEvent[],
  sendNotification: boolean = true
): Promise<ConflictZoneCheckResult> {
  const events = conflictEvents ?? getCachedConflictEvents();

  if (events.length === 0) {
    return {
      isInConflictZone: false,
      severity: null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null,
      dominantCountry: null,
      alertId: null,
    };
  }

  const analysis = analyzeConflictProximity(lat, lon, events);

  if (!analysis.severity) {
    return {
      isInConflictZone: false,
      severity: null,
      nearbyEventCount: 0,
      closestDistanceKm: Infinity,
      totalFatalities: 0,
      dominantConflict: null,
      dominantCountry: null,
      alertId: null,
    };
  }

  // Create the alert
  const db = await getDb();
  if (!db) {
    return {
      isInConflictZone: true,
      severity: analysis.severity,
      nearbyEventCount: analysis.nearbyEventCount,
      closestDistanceKm: analysis.closestDistanceKm,
      totalFatalities: analysis.totalFatalities,
      dominantConflict: analysis.dominantConflict,
      dominantCountry: analysis.dominantCountry,
      alertId: null,
    };
  }

  // Get target info for the alert description
  const target = await db
    .select()
    .from(tdoaTargets)
    .where(eq(tdoaTargets.id, targetId))
    .limit(1);

  const targetLabel = target[0]?.label ?? "Unknown";
  const targetCategory = target[0]?.category ?? "unknown";

  const description = buildConflictAlertDescription(
    targetLabel,
    targetCategory,
    lat,
    lon,
    analysis
  );

  // Insert the alert with a special marker in the description to indicate conflict zone type
  const [inserted] = await db.insert(anomalyAlerts).values({
    targetId,
    historyEntryId,
    severity: analysis.severity,
    deviationKm: analysis.closestDistanceKm,
    deviationSigma: 0, // Not applicable for conflict zone alerts
    predictedLat: String(lat),
    predictedLon: String(lon),
    actualLat: String(lat),
    actualLon: String(lon),
    description,
    acknowledged: false,
    notificationSent: false,
    createdAt: Date.now(),
  });

  const alertId = inserted.insertId;

  // Send owner notification for medium and high severity
  if (sendNotification && (analysis.severity === "medium" || analysis.severity === "high")) {
    try {
      const sent = await notifyOwner({
        title: `🔴 Conflict Zone Alert: ${targetLabel} (${analysis.severity.toUpperCase()})`,
        content: description,
      });
      if (sent && alertId) {
        await db
          .update(anomalyAlerts)
          .set({ notificationSent: true })
          .where(eq(anomalyAlerts.id, alertId));
      }
    } catch (err) {
      console.warn("[ConflictZoneChecker] Failed to send notification:", err);
    }
  }

  return {
    isInConflictZone: true,
    severity: analysis.severity,
    nearbyEventCount: analysis.nearbyEventCount,
    closestDistanceKm: analysis.closestDistanceKm,
    totalFatalities: analysis.totalFatalities,
    dominantConflict: analysis.dominantConflict,
    dominantCountry: analysis.dominantCountry,
    alertId,
  };
}

/**
 * Check ALL visible targets against active conflict zones.
 * Returns a summary of which targets are in conflict zones.
 */
export async function checkAllTargetsConflictZones(
  conflictEvents?: ConflictEvent[]
): Promise<
  Array<{
    targetId: number;
    targetLabel: string;
    lat: number;
    lon: number;
    severity: "low" | "medium" | "high";
    nearbyEventCount: number;
    closestDistanceKm: number;
    totalFatalities: number;
    dominantConflict: string | null;
    dominantCountry: string | null;
  }>
> {
  const events = conflictEvents ?? getCachedConflictEvents();
  if (events.length === 0) return [];

  const db = await getDb();
  if (!db) return [];

  const targets = await db
    .select()
    .from(tdoaTargets)
    .where(eq(tdoaTargets.visible, true));

  const results: Array<{
    targetId: number;
    targetLabel: string;
    lat: number;
    lon: number;
    severity: "low" | "medium" | "high";
    nearbyEventCount: number;
    closestDistanceKm: number;
    totalFatalities: number;
    dominantConflict: string | null;
    dominantCountry: string | null;
  }> = [];

  for (const target of targets) {
    const lat = parseFloat(target.lat);
    const lon = parseFloat(target.lon);
    const analysis = analyzeConflictProximity(lat, lon, events);

    if (analysis.severity) {
      results.push({
        targetId: target.id,
        targetLabel: target.label,
        lat,
        lon,
        severity: analysis.severity,
        nearbyEventCount: analysis.nearbyEventCount,
        closestDistanceKm: analysis.closestDistanceKm,
        totalFatalities: analysis.totalFatalities,
        dominantConflict: analysis.dominantConflict,
        dominantCountry: analysis.dominantCountry,
      });
    }
  }

  // Sort by severity (high first) then by distance
  const severityOrder = { high: 0, medium: 1, low: 2 };
  results.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.closestDistanceKm - b.closestDistanceKm
  );

  return results;
}

// ── Description builder ─────────────────────────────────────────────

function buildConflictAlertDescription(
  targetLabel: string,
  targetCategory: string,
  lat: number,
  lon: number,
  analysis: ReturnType<typeof analyzeConflictProximity>
): string {
  const lines = [
    `[CONFLICT ZONE] Target "${targetLabel}" (${targetCategory}) is located near an active conflict zone.`,
    `Position: ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    `Closest conflict event: ${analysis.closestDistanceKm.toFixed(1)} km`,
    `Nearby events (within ${CONFLICT_ZONE_THRESHOLDS.low}km): ${analysis.nearbyEventCount}`,
    `Total fatalities in area: ${analysis.totalFatalities}`,
  ];

  if (analysis.dominantConflict) {
    lines.push(`Primary conflict: ${analysis.dominantConflict}`);
  }
  if (analysis.dominantCountry) {
    lines.push(`Country: ${analysis.dominantCountry}`);
  }

  lines.push(`Severity: ${analysis.severity}`);

  return lines.join("\n");
}
