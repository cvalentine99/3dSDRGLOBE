/**
 * autoRefresh.ts — Server-side auto-refresh scheduler
 *
 * Stores the receiver list from the first batch pre-check and
 * automatically re-scans all receivers every REFRESH_INTERVAL_MS.
 * After each scan completes, results are persisted to the database.
 *
 * Architecture:
 * 1. First batch pre-check from frontend registers the receiver list
 * 2. After the first scan completes, results are persisted to DB, then scheduler starts
 * 3. On each tick, it clears stale cache entries and re-runs the batch
 * 4. Frontend polls pick up fresh results automatically
 * 5. The cycle counter tracks how many auto-refresh cycles have completed
 */

import {
  startBatchPrecheck,
  getBatchJobStatus,
  type BatchReceiver,
} from "./batchPrecheck";
import { clearStatusCache } from "./receiverStatus";
import {
  persistScanResults,
  type ScanResultForPersistence,
} from "./statusPersistence";

/* ── Configuration ────────────────────────────────── */

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const COMPLETION_CHECK_INTERVAL_MS = 10_000; // Check if batch is done every 10s

/* ── State ────────────────────────────────────────── */

let storedReceivers: BatchReceiver[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let completionChecker: ReturnType<typeof setInterval> | null = null;
let cycleCount = 0;
let lastRefreshStartedAt: number | null = null;
let lastRefreshCompletedAt: number | null = null;
let nextRefreshAt: number | null = null;
let isSchedulerActive = false;
let currentCycleStartedAt: number | null = null;
let currentJobId: string | null = null;

/* ── Public API ───────────────────────────────────── */

/**
 * Register receivers and start the auto-refresh scheduler.
 * Called when the frontend triggers the first batch pre-check.
 * If receivers are already registered, this updates the list
 * and restarts the scheduler.
 */
export function registerReceiversForAutoRefresh(receivers: BatchReceiver[]): void {
  // Store the receiver list (deduplicated by batchPrecheck.ts)
  storedReceivers = receivers;
  currentCycleStartedAt = Date.now();

  console.log(
    `[AutoRefresh] Registered ${receivers.length} receivers for auto-refresh`
  );

  // Start watching for the initial batch to complete
  startCompletionWatcher();
}

/**
 * Get the current auto-refresh scheduler status.
 */
export function getAutoRefreshStatus(): {
  active: boolean;
  receiverCount: number;
  cycleCount: number;
  lastRefreshStartedAt: number | null;
  lastRefreshCompletedAt: number | null;
  nextRefreshAt: number | null;
  intervalMs: number;
} {
  return {
    active: isSchedulerActive,
    receiverCount: storedReceivers.length,
    cycleCount,
    lastRefreshStartedAt,
    lastRefreshCompletedAt,
    nextRefreshAt,
    intervalMs: REFRESH_INTERVAL_MS,
  };
}

/**
 * Stop the auto-refresh scheduler.
 */
export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (completionChecker) {
    clearInterval(completionChecker);
    completionChecker = null;
  }
  isSchedulerActive = false;
  nextRefreshAt = null;
  console.log("[AutoRefresh] Scheduler stopped");
}

/**
 * Force an immediate refresh cycle outside the normal schedule.
 */
export function forceRefresh(): { started: boolean; reason?: string } {
  if (storedReceivers.length === 0) {
    return { started: false, reason: "No receivers registered" };
  }

  const jobStatus = getBatchJobStatus();
  if (jobStatus.running) {
    return { started: false, reason: "A batch job is already running" };
  }

  runRefreshCycle();
  return { started: true };
}

/**
 * Reset all auto-refresh state — used for testing only.
 */
export function resetAutoRefreshState(): void {
  stopAutoRefresh();
  storedReceivers = [];
  cycleCount = 0;
  lastRefreshStartedAt = null;
  lastRefreshCompletedAt = null;
  nextRefreshAt = null;
  isSchedulerActive = false;
  currentCycleStartedAt = null;
  currentJobId = null;
}

/* ── Internal ─────────────────────────────────────── */

/**
 * Watch for the current batch job to complete, then persist results and start the scheduler.
 */
function startCompletionWatcher(): void {
  // Clear any existing watcher
  if (completionChecker) {
    clearInterval(completionChecker);
  }

  completionChecker = setInterval(() => {
    const status = getBatchJobStatus();

    // If the batch is done (not running and has results), persist and start the timer
    if (!status.running && status.checked > 0 && status.checked >= status.total) {
      if (completionChecker) {
        clearInterval(completionChecker);
        completionChecker = null;
      }

      const completedAt = Date.now();
      lastRefreshCompletedAt = completedAt;

      // Persist scan results to the database
      persistCompletedScan(status, completedAt);

      startScheduler();
    }
  }, COMPLETION_CHECK_INTERVAL_MS);
}

/**
 * Persist the completed scan results to the database.
 */
async function persistCompletedScan(
  status: ReturnType<typeof getBatchJobStatus>,
  completedAt: number
): Promise<void> {
  try {
    // Build the persistence data from the batch results + stored receivers
    const results: ScanResultForPersistence[] = [];

    // Create a lookup from stored receivers for station labels and types
    const receiverLookup = new Map<string, BatchReceiver>();
    for (const r of storedReceivers) {
      const key = r.receiverUrl.replace(/\/+$/, "");
      receiverLookup.set(key, r);
    }

    // Map batch results to persistence format
    for (const [url, result] of Object.entries(status.results)) {
      const receiver = receiverLookup.get(url);
      results.push({
        receiverUrl: receiver?.receiverUrl || url,
        receiverType: (receiver?.receiverType || "KiwiSDR") as "KiwiSDR" | "OpenWebRX" | "WebSDR",
        stationLabel: receiver?.stationLabel || "Unknown",
        online: result.online,
        checkedAt: result.checkedAt,
      });
    }

    const cycleId = currentJobId || status.jobId || `cycle-${completedAt}`;
    const startedAt = currentCycleStartedAt || (completedAt - 60000); // fallback

    await persistScanResults(results, {
      cycleId,
      cycleNumber: cycleCount,
      startedAt,
      completedAt,
    });
  } catch (err: any) {
    console.error("[AutoRefresh] Failed to persist scan results:", err.message);
  }
}

/**
 * Start the recurring refresh timer.
 */
function startScheduler(): void {
  // Clear any existing timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  isSchedulerActive = true;
  nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;

  console.log(
    `[AutoRefresh] Scheduler started. Next refresh in ${REFRESH_INTERVAL_MS / 60000} minutes ` +
    `(at ${new Date(nextRefreshAt).toISOString()})`
  );

  refreshTimer = setInterval(() => {
    const jobStatus = getBatchJobStatus();

    // Don't start a new cycle if one is still running
    if (jobStatus.running) {
      console.log("[AutoRefresh] Skipping cycle — previous batch still running");
      nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
      return;
    }

    runRefreshCycle();
  }, REFRESH_INTERVAL_MS);
}

/**
 * Execute a single refresh cycle.
 */
function runRefreshCycle(): void {
  cycleCount++;
  lastRefreshStartedAt = Date.now();
  currentCycleStartedAt = Date.now();
  nextRefreshAt = Date.now() + REFRESH_INTERVAL_MS;

  console.log(
    `[AutoRefresh] Starting cycle #${cycleCount} — ` +
    `scanning ${storedReceivers.length} receivers`
  );

  // Clear the status cache so all receivers get fresh checks
  clearStatusCache();

  // Start a new batch pre-check with the stored receiver list
  const jobId = startBatchPrecheck(storedReceivers);
  currentJobId = jobId;

  console.log(`[AutoRefresh] Batch job ${jobId} started`);

  // Watch for completion to persist results and update lastRefreshCompletedAt
  startCompletionWatcher();
}
