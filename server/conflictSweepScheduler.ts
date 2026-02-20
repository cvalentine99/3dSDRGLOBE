/**
 * conflictSweepScheduler.ts — Scheduled Conflict Zone Sweep
 *
 * Periodically re-checks ALL visible targets against:
 * 1. Active UCDP conflict zones (using cached conflict events)
 * 2. Custom geofence zones (user-drawn polygons)
 *
 * Runs every 30 minutes (configurable). Results are persisted to
 * the conflict_sweep_history table for audit trail.
 *
 * Architecture:
 * - Uses setInterval for scheduling (same pattern as autoRefresh.ts)
 * - Fetches latest conflict data from cache (populated by UCDP router)
 * - Checks all visible targets against both conflict zones and geofences
 * - Creates alerts for new entries/exits
 * - Persists sweep summary to database
 */

import { getDb } from "./db";
import {
  conflictSweepHistory,
  tdoaTargets,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  checkAllTargetsConflictZones,
  hasValidConflictCache,
  getCachedConflictEvents,
} from "./conflictZoneChecker";
import { checkAllTargetsGeofences, getActiveGeofenceZones } from "./geofenceEngine";
import { notifyOwner } from "./_core/notification";

// ── Configuration ────────────────────────────────────────

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_TARGETS_FOR_SWEEP = 1; // Minimum targets to justify a sweep

// ── State ────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastSweepAt: number | null = null;
let nextSweepAt: number | null = null;
let sweepCount = 0;
let isSchedulerActive = false;

// ── Public API ───────────────────────────────────────────

/**
 * Start the conflict zone sweep scheduler.
 * Should be called once during server startup, after the first
 * UCDP data fetch populates the conflict event cache.
 */
export function startConflictSweepScheduler(): void {
  if (sweepTimer) {
    console.log("[ConflictSweep] Scheduler already running, restarting...");
    stopConflictSweepScheduler();
  }

  isSchedulerActive = true;
  nextSweepAt = Date.now() + SWEEP_INTERVAL_MS;

  sweepTimer = setInterval(async () => {
    await runSweep("scheduled");
  }, SWEEP_INTERVAL_MS);

  console.log(
    `[ConflictSweep] Scheduler started. Sweep interval: ${SWEEP_INTERVAL_MS / 60000} minutes`
  );
}

/**
 * Stop the conflict zone sweep scheduler.
 */
export function stopConflictSweepScheduler(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  isSchedulerActive = false;
  nextSweepAt = null;
  console.log("[ConflictSweep] Scheduler stopped.");
}

/**
 * Manually trigger a sweep (e.g., from a tRPC endpoint).
 */
export async function triggerManualSweep(): Promise<SweepResult> {
  return await runSweep("manual");
}

/**
 * Get the current scheduler status.
 */
export function getSweepSchedulerStatus(): SweepSchedulerStatus {
  return {
    active: isSchedulerActive,
    sweepCount,
    lastSweepAt,
    nextSweepAt,
    isRunning,
    intervalMs: SWEEP_INTERVAL_MS,
  };
}

// ── Types ────────────────────────────────────────────────

export interface SweepResult {
  success: boolean;
  targetsChecked: number;
  targetsInConflict: number;
  geofenceAlertCount: number;
  newAlerts: number;
  durationMs: number;
  trigger: "scheduled" | "manual";
  conflictCacheAvailable: boolean;
  geofenceZoneCount: number;
  details: {
    conflictResults: Array<{
      targetId: number;
      targetLabel: string;
      severity: string;
      closestDistanceKm: number;
      dominantConflict: string | null;
    }>;
    geofenceResults: Array<{
      targetId: number;
      targetLabel: string;
      zoneId: number;
      zoneName: string;
      eventType: string;
    }>;
  };
}

export interface SweepSchedulerStatus {
  active: boolean;
  sweepCount: number;
  lastSweepAt: number | null;
  nextSweepAt: number | null;
  isRunning: boolean;
  intervalMs: number;
}

// ── Core sweep logic ─────────────────────────────────────

async function runSweep(
  trigger: "scheduled" | "manual"
): Promise<SweepResult> {
  if (isRunning) {
    console.log("[ConflictSweep] Sweep already in progress, skipping.");
    return {
      success: false,
      targetsChecked: 0,
      targetsInConflict: 0,
      geofenceAlertCount: 0,
      newAlerts: 0,
      durationMs: 0,
      trigger,
      conflictCacheAvailable: false,
      geofenceZoneCount: 0,
      details: { conflictResults: [], geofenceResults: [] },
    };
  }

  isRunning = true;
  const startTime = Date.now();

  console.log(
    `[ConflictSweep] Starting ${trigger} sweep #${sweepCount + 1}...`
  );

  try {
    const db = await getDb();
    const conflictCacheAvailable = hasValidConflictCache();
    const geofenceZones = await getActiveGeofenceZones();

    // Check how many visible targets we have
    let targetCount = 0;
    if (db) {
      const targets = await db
        .select()
        .from(tdoaTargets)
        .where(eq(tdoaTargets.visible, true));
      targetCount = targets.length;
    }

    if (targetCount < MIN_TARGETS_FOR_SWEEP) {
      console.log(
        `[ConflictSweep] Only ${targetCount} visible targets, skipping sweep.`
      );
      isRunning = false;
      return {
        success: true,
        targetsChecked: 0,
        targetsInConflict: 0,
        geofenceAlertCount: 0,
        newAlerts: 0,
        durationMs: Date.now() - startTime,
        trigger,
        conflictCacheAvailable,
        geofenceZoneCount: geofenceZones.length,
        details: { conflictResults: [], geofenceResults: [] },
      };
    }

    // ── Run conflict zone checks ──────────────────────────
    let conflictResults: SweepResult["details"]["conflictResults"] = [];
    let targetsInConflict = 0;

    if (conflictCacheAvailable) {
      const results = await checkAllTargetsConflictZones();
      targetsInConflict = results.length;
      conflictResults = results.map((r) => ({
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        severity: r.severity,
        closestDistanceKm: r.closestDistanceKm,
        dominantConflict: r.dominantConflict,
      }));
    }

    // ── Run geofence checks ───────────────────────────────
    let geofenceAlertCount = 0;
    let geofenceResults: SweepResult["details"]["geofenceResults"] = [];

    if (geofenceZones.length > 0) {
      const geoResult = await checkAllTargetsGeofences();
      geofenceAlertCount = geoResult.alertsGenerated;
      geofenceResults = geoResult.results.map((r) => ({
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        zoneId: r.zoneId,
        zoneName: r.zoneName,
        eventType: r.eventType,
      }));
    }

    const newAlerts = geofenceAlertCount; // Conflict zone alerts are informational (no new DB alerts from sweep)
    const durationMs = Date.now() - startTime;

    // ── Persist sweep history ─────────────────────────────
    if (db) {
      await db.insert(conflictSweepHistory).values({
        targetsChecked: targetCount,
        targetsInConflict,
        geofenceAlertCount,
        newAlerts,
        durationMs,
        summary: {
          conflictCacheAvailable,
          geofenceZoneCount: geofenceZones.length,
          conflictEvents: getCachedConflictEvents().length,
          highSeverityCount: conflictResults.filter(
            (r) => r.severity === "high"
          ).length,
          mediumSeverityCount: conflictResults.filter(
            (r) => r.severity === "medium"
          ).length,
        },
        trigger,
        createdAt: Date.now(),
      });
    }

    sweepCount++;
    lastSweepAt = Date.now();
    nextSweepAt = isSchedulerActive ? Date.now() + SWEEP_INTERVAL_MS : null;

    console.log(
      `[ConflictSweep] Sweep #${sweepCount} complete: ` +
        `${targetCount} targets checked, ` +
        `${targetsInConflict} in conflict zones, ` +
        `${geofenceAlertCount} geofence alerts, ` +
        `${durationMs}ms`
    );

    // Notify owner if high-severity targets found
    const highSeverity = conflictResults.filter(
      (r) => r.severity === "high"
    );
    if (highSeverity.length > 0 || geofenceAlertCount > 0) {
      const lines = [`Sweep #${sweepCount} completed in ${durationMs}ms.`];
      if (highSeverity.length > 0) {
        lines.push(
          `\n**${highSeverity.length} HIGH severity conflict zone targets:**`
        );
        for (const r of highSeverity.slice(0, 5)) {
          lines.push(
            `- ${r.targetLabel}: ${r.closestDistanceKm.toFixed(1)}km from ${r.dominantConflict ?? "conflict zone"}`
          );
        }
      }
      if (geofenceAlertCount > 0) {
        lines.push(`\n**${geofenceAlertCount} geofence alerts triggered.**`);
      }

      notifyOwner({
        title: `🔍 Conflict Sweep: ${targetsInConflict} targets in conflict zones`,
        content: lines.join("\n"),
      }).catch(() => {});
    }

    return {
      success: true,
      targetsChecked: targetCount,
      targetsInConflict,
      geofenceAlertCount,
      newAlerts,
      durationMs,
      trigger,
      conflictCacheAvailable,
      geofenceZoneCount: geofenceZones.length,
      details: { conflictResults, geofenceResults },
    };
  } catch (err) {
    console.error("[ConflictSweep] Sweep failed:", err);
    isRunning = false;
    return {
      success: false,
      targetsChecked: 0,
      targetsInConflict: 0,
      geofenceAlertCount: 0,
      newAlerts: 0,
      durationMs: Date.now() - startTime,
      trigger,
      conflictCacheAvailable: false,
      geofenceZoneCount: 0,
      details: { conflictResults: [], geofenceResults: [] },
    };
  } finally {
    isRunning = false;
  }
}
