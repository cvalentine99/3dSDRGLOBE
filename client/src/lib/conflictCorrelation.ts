/**
 * conflictCorrelation.ts — Utilities for correlating receivers with conflict zones
 *
 * Computes which receivers are geographically near active conflict events
 * using the Haversine formula for great-circle distance.
 */
import type { Station } from "./types";
import type { SlimConflictEvent } from "@/components/ConflictOverlay";

/** Default radius in km to consider a receiver "near" a conflict zone */
export const DEFAULT_CONFLICT_RADIUS_KM = 200;

/** Result of correlating a receiver with nearby conflicts */
export interface ConflictCorrelation {
  station: Station;
  nearbyConflicts: number; // count of nearby events
  closestDistance: number; // km to nearest event
  totalFatalities: number; // sum of fatalities in nearby events
  dominantType: number; // most common violence type nearby
}

/**
 * Haversine distance between two lat/lng points in km
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Build a spatial index (grid) for conflict events to speed up proximity queries.
 * Grid cells are ~2° x 2° (roughly 200km at equator).
 */
function buildSpatialIndex(events: SlimConflictEvent[]): Map<string, SlimConflictEvent[]> {
  const grid = new Map<string, SlimConflictEvent[]>();
  const CELL_SIZE = 2; // degrees

  for (const evt of events) {
    const cellKey = `${Math.floor(evt.lat / CELL_SIZE)},${Math.floor(evt.lng / CELL_SIZE)}`;
    const cell = grid.get(cellKey);
    if (cell) {
      cell.push(evt);
    } else {
      grid.set(cellKey, [evt]);
    }
  }

  return grid;
}

/**
 * Get nearby events from the spatial index for a given lat/lng and radius.
 */
function getNearbyFromGrid(
  grid: Map<string, SlimConflictEvent[]>,
  lat: number,
  lng: number,
  radiusKm: number
): SlimConflictEvent[] {
  const CELL_SIZE = 2;
  // How many cells to search in each direction (radius in degrees, roughly)
  const cellRadius = Math.ceil(radiusKm / 111 / CELL_SIZE) + 1;
  const centerCellLat = Math.floor(lat / CELL_SIZE);
  const centerCellLng = Math.floor(lng / CELL_SIZE);

  const candidates: SlimConflictEvent[] = [];

  for (let dLat = -cellRadius; dLat <= cellRadius; dLat++) {
    for (let dLng = -cellRadius; dLng <= cellRadius; dLng++) {
      const key = `${centerCellLat + dLat},${centerCellLng + dLng}`;
      const cell = grid.get(key);
      if (cell) {
        candidates.push(...cell);
      }
    }
  }

  return candidates;
}

/**
 * Compute conflict correlations for all stations.
 * Returns only stations that have at least one nearby conflict event.
 */
export function computeConflictCorrelations(
  stations: Station[],
  events: SlimConflictEvent[],
  radiusKm: number = DEFAULT_CONFLICT_RADIUS_KM
): ConflictCorrelation[] {
  if (events.length === 0 || stations.length === 0) return [];

  const grid = buildSpatialIndex(events);
  const results: ConflictCorrelation[] = [];

  for (const station of stations) {
    const [lng, lat] = station.location.coordinates;
    const candidates = getNearbyFromGrid(grid, lat, lng, radiusKm);

    let nearbyCount = 0;
    let closestDist = Infinity;
    let totalFat = 0;
    const typeCounts: Record<number, number> = {};

    for (const evt of candidates) {
      const dist = haversineDistance(lat, lng, evt.lat, evt.lng);
      if (dist <= radiusKm) {
        nearbyCount++;
        if (dist < closestDist) closestDist = dist;
        totalFat += evt.best;
        typeCounts[evt.type] = (typeCounts[evt.type] ?? 0) + 1;
      }
    }

    if (nearbyCount > 0) {
      // Find dominant violence type
      let dominantType = 1;
      let maxCount = 0;
      for (const [type, count] of Object.entries(typeCounts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantType = Number(type);
        }
      }

      results.push({
        station,
        nearbyConflicts: nearbyCount,
        closestDistance: closestDist,
        totalFatalities: totalFat,
        dominantType,
      });
    }
  }

  // Sort by number of nearby conflicts descending
  results.sort((a, b) => b.nearbyConflicts - a.nearbyConflicts);

  return results;
}

/**
 * Get a Set of station labels that are near conflict zones.
 * Used for quick lookup when rendering globe markers.
 */
export function getConflictZoneStationLabels(
  stations: Station[],
  events: SlimConflictEvent[],
  radiusKm: number = DEFAULT_CONFLICT_RADIUS_KM
): Set<string> {
  const correlations = computeConflictCorrelations(stations, events, radiusKm);
  return new Set(correlations.map((c) => c.station.label));
}

/**
 * Compute a "threat level" for a station based on nearby conflict intensity.
 * Returns 0-1 where 0 = no conflict, 1 = extreme conflict zone.
 */
export function getStationThreatLevel(correlation: ConflictCorrelation): number {
  // Factors: number of events, proximity, fatalities
  const eventFactor = Math.min(correlation.nearbyConflicts / 50, 1);
  const proximityFactor = 1 - Math.min(correlation.closestDistance / 200, 1);
  const fatalityFactor = Math.min(correlation.totalFatalities / 500, 1);

  return Math.min(
    eventFactor * 0.4 + proximityFactor * 0.3 + fatalityFactor * 0.3,
    1
  );
}
