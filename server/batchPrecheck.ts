/**
 * batchPrecheck.ts — Server-side batch receiver status pre-check
 *
 * Processes all receivers in throttled waves to avoid overwhelming
 * proxies and receiver endpoints. Results accumulate in memory and
 * the frontend polls for them.
 *
 * Architecture:
 * 1. Frontend POSTs a list of receivers to start a batch job
 * 2. Backend processes them in waves of CONCURRENCY_LIMIT
 * 3. Frontend polls GET /results to fetch accumulated results
 * 4. Each receiver is checked once; results are cached in receiverStatus.ts
 */

import { checkReceiverStatus, type ReceiverStatusResult } from "./receiverStatus";

/* ── Types ────────────────────────────────────────── */

export interface BatchReceiver {
  receiverUrl: string;
  receiverType: "KiwiSDR" | "OpenWebRX" | "WebSDR";
  stationLabel: string;
}

export interface BatchJobStatus {
  jobId: string;
  total: number;
  checked: number;
  results: Map<string, { online: boolean; checkedAt: number }>;
  startedAt: number;
  completedAt: number | null;
  running: boolean;
}

/* ── Configuration ────────────────────────────────── */

const CONCURRENCY_LIMIT = 15; // Max concurrent checks per wave
const WAVE_DELAY_MS = 500; // Delay between waves to be gentle
const JOB_TTL_MS = 30 * 60 * 1000; // Jobs expire after 30 minutes

/* ── Job Storage ──────────────────────────────────── */

let currentJob: BatchJobStatus | null = null;
let abortController: AbortController | null = null;

/* ── Helpers ──────────────────────────────────────── */

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Start Batch Job ──────────────────────────────── */

export function startBatchPrecheck(receivers: BatchReceiver[]): string {
  // If there's already a running job, abort it
  if (currentJob?.running && abortController) {
    abortController.abort();
  }

  const jobId = `batch-${Date.now()}`;
  abortController = new AbortController();

  // Deduplicate receivers by normalized URL
  const seen = new Set<string>();
  const dedupedReceivers: BatchReceiver[] = [];
  for (const r of receivers) {
    const key = normalizeUrl(r.receiverUrl);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedReceivers.push(r);
    }
  }

  currentJob = {
    jobId,
    total: dedupedReceivers.length,
    checked: 0,
    results: new Map(),
    startedAt: Date.now(),
    completedAt: null,
    running: true,
  };

  // Process in background (don't await)
  processReceivers(dedupedReceivers, currentJob, abortController.signal);

  return jobId;
}

/* ── Process Receivers in Waves ───────────────────── */

async function processReceivers(
  receivers: BatchReceiver[],
  job: BatchJobStatus,
  signal: AbortSignal
): Promise<void> {
  // Process in waves
  for (let i = 0; i < receivers.length; i += CONCURRENCY_LIMIT) {
    if (signal.aborted) {
      job.running = false;
      return;
    }

    const wave = receivers.slice(i, i + CONCURRENCY_LIMIT);

    const waveResults = await Promise.allSettled(
      wave.map(async (r) => {
        if (signal.aborted) throw new Error("Aborted");
        try {
          const result = await checkReceiverStatus(r.receiverUrl, r.receiverType);
          return { receiverUrl: r.receiverUrl, result };
        } catch (err: any) {
          return {
            receiverUrl: r.receiverUrl,
            result: {
              online: false,
              receiverType: r.receiverType,
              receiverUrl: r.receiverUrl,
              checkedAt: Date.now(),
              fromCache: false,
              proxyUsed: false,
              error: err.message || "Check failed",
            } as ReceiverStatusResult,
          };
        }
      })
    );

    // Accumulate results
    for (const wr of waveResults) {
      if (wr.status === "fulfilled") {
        const key = normalizeUrl(wr.value.receiverUrl);
        job.results.set(key, {
          online: wr.value.result.online,
          checkedAt: wr.value.result.checkedAt,
        });
        job.checked++;
      } else {
        job.checked++;
      }
    }

    // Delay between waves
    if (i + CONCURRENCY_LIMIT < receivers.length && !signal.aborted) {
      await sleep(WAVE_DELAY_MS);
    }
  }

  job.completedAt = Date.now();
  job.running = false;
}

/* ── Get Job Status ───────────────────────────────── */

export function getBatchJobStatus(): {
  jobId: string | null;
  total: number;
  checked: number;
  running: boolean;
  results: Record<string, { online: boolean; checkedAt: number }>;
  startedAt: number | null;
  completedAt: number | null;
} {
  if (!currentJob) {
    return {
      jobId: null,
      total: 0,
      checked: 0,
      running: false,
      results: {},
      startedAt: null,
      completedAt: null,
    };
  }

  // Check if job has expired
  if (Date.now() - currentJob.startedAt > JOB_TTL_MS) {
    currentJob = null;
    return {
      jobId: null,
      total: 0,
      checked: 0,
      running: false,
      results: {},
      startedAt: null,
      completedAt: null,
    };
  }

  // Convert Map to plain object for serialization
  const results: Record<string, { online: boolean; checkedAt: number }> = {};
  Array.from(currentJob.results.entries()).forEach(([key, val]) => {
    results[key] = val;
  });

  return {
    jobId: currentJob.jobId,
    total: currentJob.total,
    checked: currentJob.checked,
    running: currentJob.running,
    results,
    startedAt: currentJob.startedAt,
    completedAt: currentJob.completedAt,
  };
}

/* ── Get Results Since (incremental polling) ──────── */

export function getBatchResultsSince(sinceTimestamp: number): {
  results: Record<string, { online: boolean; checkedAt: number }>;
  checked: number;
  total: number;
  running: boolean;
} {
  if (!currentJob) {
    return { results: {}, checked: 0, total: 0, running: false };
  }

  const results: Record<string, { online: boolean; checkedAt: number }> = {};
  Array.from(currentJob.results.entries()).forEach(([key, val]) => {
    if (val.checkedAt >= sinceTimestamp) {
      results[key] = val;
    }
  });

  return {
    results,
    checked: currentJob.checked,
    total: currentJob.total,
    running: currentJob.running,
  };
}

/* ── Cancel Job ───────────────────────────────────── */

export function cancelBatchJob(): void {
  if (abortController) {
    abortController.abort();
  }
  if (currentJob) {
    currentJob.running = false;
  }
}

/** Reset all state — used for testing only */
export function resetBatchState(): void {
  if (abortController) {
    abortController.abort();
  }
  currentJob = null;
  abortController = null;
}
