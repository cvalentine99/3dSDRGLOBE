/**
 * geofenceEngine.ts — Geofence Alert Engine
 *
 * Provides point-in-polygon detection for custom geofence zones,
 * tracks target entry/exit events, and generates alerts.
 *
 * Zone types:
 * - "exclusion": Alert when a target ENTERS the zone
 * - "inclusion": Alert when a target EXITS the zone
 */

import { haversineKm } from "@shared/geo";
import { getDb } from "./db";
import {
  geofenceZones,
  geofenceAlerts,
  anomalyAlerts,
  tdoaTargets,
  type GeofenceZone,
} from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// ── Types ───────────────────────────────────────────────────────────

export interface PolygonVertex {
  lat: number;
  lon: number;
}

export interface GeofenceCheckResult {
  zoneId: number;
  zoneName: string;
  zoneType: "exclusion" | "inclusion";
  isInside: boolean;
  triggered: boolean;
  eventType: "entered" | "exited" | null;
  alertId: number | null;
}

// ── Point-in-Polygon (Ray Casting Algorithm) ────────────────────────

/**
 * Determine if a point is inside a polygon using the ray casting algorithm.
 * Works for simple (non-self-intersecting) polygons on a flat projection.
 * Accurate enough for geofencing at the scale we operate (zones of 10s-1000s km).
 */
export function pointInPolygon(
  lat: number,
  lon: number,
  polygon: PolygonVertex[]
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lon;
    const xj = polygon[j].lat;
    const yj = polygon[j].lon;

    const intersect =
      yi > lon !== yj > lon &&
      lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculate the minimum distance from a point to a polygon boundary.
 * Returns 0 if the point is inside the polygon.
 */
export function distanceToPolygonKm(
  lat: number,
  lon: number,
  polygon: PolygonVertex[]
): number {
  if (pointInPolygon(lat, lon, polygon)) return 0;

  let minDist = Infinity;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = distanceToSegmentKm(
      lat,
      lon,
      polygon[i].lat,
      polygon[i].lon,
      polygon[j].lat,
      polygon[j].lon
    );
    if (dist < minDist) minDist = dist;
  }

  return minDist;
}

/**
 * Approximate distance from a point to a line segment using haversine.
 */
function distanceToSegmentKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dAB = haversineKm(aLat, aLon, bLat, bLon);
  if (dAB < 0.001) return haversineKm(pLat, pLon, aLat, aLon);

  const dAP = haversineKm(aLat, aLon, pLat, pLon);
  const dBP = haversineKm(bLat, bLon, pLat, pLon);

  // Project P onto AB using dot product approximation
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pLat - aLat) * (bLat - aLat) + (pLon - aLon) * (bLon - aLon)) /
        ((bLat - aLat) ** 2 + (bLon - aLon) ** 2)
    )
  );

  const projLat = aLat + t * (bLat - aLat);
  const projLon = aLon + t * (bLon - aLon);

  return haversineKm(pLat, pLon, projLat, projLon);
}

/**
 * Calculate the centroid of a polygon.
 */
export function polygonCentroid(polygon: PolygonVertex[]): PolygonVertex {
  if (polygon.length === 0) return { lat: 0, lon: 0 };
  const sum = polygon.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lon: acc.lon + v.lon }),
    { lat: 0, lon: 0 }
  );
  return { lat: sum.lat / polygon.length, lon: sum.lon / polygon.length };
}

/**
 * Calculate the approximate area of a polygon in km².
 * Uses the shoelface formula with degree-to-km conversion.
 */
export function polygonAreaKm2(polygon: PolygonVertex[]): number {
  if (polygon.length < 3) return 0;
  const centroid = polygonCentroid(polygon);
  const cosLat = Math.cos((centroid.lat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * cosLat;

  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = polygon[i].lon * kmPerDegLon;
    const yi = polygon[i].lat * kmPerDegLat;
    const xj = polygon[j].lon * kmPerDegLon;
    const yj = polygon[j].lat * kmPerDegLat;
    area += xi * yj - xj * yi;
  }

  return Math.abs(area) / 2;
}

// ── In-memory zone cache ────────────────────────────────────────────

let cachedZones: GeofenceZone[] = [];
let zoneCacheTimestamp = 0;
const ZONE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get all enabled geofence zones (with caching).
 */
export async function getActiveGeofenceZones(): Promise<GeofenceZone[]> {
  if (Date.now() - zoneCacheTimestamp < ZONE_CACHE_TTL && cachedZones.length > 0) {
    return cachedZones;
  }

  const db = await getDb();
  if (!db) return [];

  cachedZones = await db
    .select()
    .from(geofenceZones)
    .where(eq(geofenceZones.enabled, true));
  zoneCacheTimestamp = Date.now();

  return cachedZones;
}

/**
 * Invalidate the zone cache (call after CRUD operations).
 */
export function invalidateZoneCache(): void {
  zoneCacheTimestamp = 0;
  cachedZones = [];
}

// ── Target-zone state tracking ──────────────────────────────────────
// Tracks which targets are currently inside which zones to detect transitions

const targetZoneState = new Map<string, boolean>(); // key: "targetId:zoneId"

function getStateKey(targetId: number, zoneId: number): string {
  return `${targetId}:${zoneId}`;
}

/**
 * Check a target position against all active geofence zones.
 * Detects entry/exit transitions and generates alerts.
 */
export async function checkGeofences(
  targetId: number,
  lat: number,
  lon: number,
  historyEntryId: number,
  sendNotification: boolean = true
): Promise<GeofenceCheckResult[]> {
  const zones = await getActiveGeofenceZones();
  if (zones.length === 0) return [];

  const results: GeofenceCheckResult[] = [];
  const db = await getDb();

  for (const zone of zones) {
    const polygon = zone.polygon as PolygonVertex[];
    if (!polygon || polygon.length < 3) continue;

    const isInside = pointInPolygon(lat, lon, polygon);
    const stateKey = getStateKey(targetId, zone.id);
    const wasInside = targetZoneState.get(stateKey);

    // Determine if a transition occurred
    let eventType: "entered" | "exited" | null = null;
    let triggered = false;

    if (wasInside === undefined) {
      // First check — initialize state, only trigger if already in exclusion zone
      targetZoneState.set(stateKey, isInside);
      if (isInside && zone.zoneType === "exclusion") {
        eventType = "entered";
        triggered = true;
      } else if (!isInside && zone.zoneType === "inclusion") {
        eventType = "exited";
        triggered = true;
      }
    } else if (wasInside !== isInside) {
      // State transition
      targetZoneState.set(stateKey, isInside);
      if (isInside) {
        eventType = "entered";
        triggered = zone.zoneType === "exclusion";
      } else {
        eventType = "exited";
        triggered = zone.zoneType === "inclusion";
      }
    } else {
      targetZoneState.set(stateKey, isInside);
    }

    let alertId: number | null = null;

    if (triggered && eventType && db) {
      // Get target info
      const target = await db
        .select()
        .from(tdoaTargets)
        .where(eq(tdoaTargets.id, targetId))
        .limit(1);

      const targetLabel = target[0]?.label ?? "Unknown";
      const action = eventType === "entered" ? "entered" : "left";
      const zoneTypeLabel = zone.zoneType === "exclusion" ? "exclusion" : "inclusion";

      const description = [
        `[GEOFENCE] Target "${targetLabel}" ${action} ${zoneTypeLabel} zone "${zone.name}".`,
        `Position: ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        `Zone type: ${zoneTypeLabel}`,
        `Event: ${eventType}`,
      ].join("\n");

      // Create anomaly alert
      const [inserted] = await db.insert(anomalyAlerts).values({
        targetId,
        historyEntryId,
        severity: "high",
        deviationKm: distanceToPolygonKm(lat, lon, polygon),
        deviationSigma: 0,
        predictedLat: String(lat),
        predictedLon: String(lon),
        actualLat: String(lat),
        actualLon: String(lon),
        description,
        acknowledged: false,
        notificationSent: false,
        createdAt: Date.now(),
      });

      alertId = inserted.insertId;

      // Create geofence-specific alert record
      await db.insert(geofenceAlerts).values({
        zoneId: zone.id,
        targetId,
        anomalyAlertId: alertId,
        eventType,
        lat: String(lat),
        lon: String(lon),
        createdAt: Date.now(),
      });

      // Send notification
      if (sendNotification) {
        try {
          const sent = await notifyOwner({
            title: `⚠️ Geofence Alert: ${targetLabel} ${action} "${zone.name}"`,
            content: description,
          });
          if (sent && alertId) {
            await db
              .update(anomalyAlerts)
              .set({ notificationSent: true })
              .where(eq(anomalyAlerts.id, alertId));
          }
        } catch (err) {
          console.warn("[GeofenceEngine] Failed to send notification:", err);
        }
      }
    }

    results.push({
      zoneId: zone.id,
      zoneName: zone.name,
      zoneType: zone.zoneType as "exclusion" | "inclusion",
      isInside,
      triggered,
      eventType,
      alertId,
    });
  }

  return results;
}

/**
 * Check ALL visible targets against all active geofence zones.
 * Used by the scheduled sweep.
 */
export async function checkAllTargetsGeofences(): Promise<{
  targetsChecked: number;
  alertsGenerated: number;
  results: Array<{
    targetId: number;
    targetLabel: string;
    zoneId: number;
    zoneName: string;
    eventType: "entered" | "exited";
  }>;
}> {
  const db = await getDb();
  if (!db) return { targetsChecked: 0, alertsGenerated: 0, results: [] };

  const targets = await db
    .select()
    .from(tdoaTargets)
    .where(eq(tdoaTargets.visible, true));

  let alertsGenerated = 0;
  const results: Array<{
    targetId: number;
    targetLabel: string;
    zoneId: number;
    zoneName: string;
    eventType: "entered" | "exited";
  }> = [];

  for (const target of targets) {
    const lat = parseFloat(target.lat);
    const lon = parseFloat(target.lon);

    // Use a dummy historyEntryId of 0 for sweep-generated checks
    const checks = await checkGeofences(target.id, lat, lon, 0, true);

    for (const check of checks) {
      if (check.triggered && check.eventType) {
        alertsGenerated++;
        results.push({
          targetId: target.id,
          targetLabel: target.label,
          zoneId: check.zoneId,
          zoneName: check.zoneName,
          eventType: check.eventType,
        });
      }
    }
  }

  return { targetsChecked: targets.length, alertsGenerated, results };
}
