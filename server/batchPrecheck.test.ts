import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  startBatchPrecheck,
  getBatchJobStatus,
  getBatchResultsSince,
  cancelBatchJob,
  resetBatchState,
  type BatchReceiver,
} from "./batchPrecheck";

// Helper to wait for job completion
async function waitForCompletion(timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = getBatchJobStatus();
    if (!status.running) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeEach(() => {
  resetBatchState();
});

afterEach(() => {
  resetBatchState();
});

describe("batchPrecheck", () => {
  it("starts a batch job and returns a jobId", () => {
    const receivers: BatchReceiver[] = [
      {
        receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Test KiwiSDR",
      },
    ];

    const jobId = startBatchPrecheck(receivers);
    expect(jobId).toBeTruthy();
    expect(jobId).toMatch(/^batch-\d+$/);

    const status = getBatchJobStatus();
    expect(status.jobId).toBe(jobId);
    expect(status.total).toBe(1);
    expect(status.running).toBe(true);
  });

  it("deduplicates receivers by normalized URL", () => {
    const receivers: BatchReceiver[] = [
      {
        receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Test 1",
      },
      {
        receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073/",
        receiverType: "KiwiSDR",
        stationLabel: "Test 2 (duplicate with trailing slash)",
      },
    ];

    startBatchPrecheck(receivers);
    const status = getBatchJobStatus();
    // Should deduplicate to 1 receiver
    expect(status.total).toBe(1);
  });

  it("processes receivers and accumulates results", async () => {
    const receivers: BatchReceiver[] = [
      {
        receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
        receiverType: "KiwiSDR",
        stationLabel: "NZ KiwiSDR",
      },
    ];

    startBatchPrecheck(receivers);
    await waitForCompletion(30000);

    const status = getBatchJobStatus();
    expect(status.checked).toBe(1);
    expect(status.running).toBe(false);
    expect(Object.keys(status.results).length).toBe(1);

    // The result should have an online boolean
    const key = Object.keys(status.results)[0];
    expect(typeof status.results[key].online).toBe("boolean");
    expect(typeof status.results[key].checkedAt).toBe("number");
  }, 35000);

  it("getBatchResultsSince returns only new results", async () => {
    // Use a unique URL that won't be cached from other tests
    const receivers: BatchReceiver[] = [
      {
        receiverUrl: "http://example.net:9999",
        receiverType: "WebSDR",
        stationLabel: "Test WebSDR",
      },
    ];

    const beforeStart = Date.now() - 1000; // 1 second buffer
    startBatchPrecheck(receivers);
    await waitForCompletion(30000);

    // Results since before the job started should include everything
    const allResults = getBatchResultsSince(beforeStart);
    expect(Object.keys(allResults.results).length).toBeGreaterThanOrEqual(1);
    expect(allResults.checked).toBe(1);

    // Results since far in the future should be empty
    const futureResults = getBatchResultsSince(Date.now() + 100000);
    expect(Object.keys(futureResults.results).length).toBe(0);
  }, 35000);

  it("cancels a running job", async () => {
    const receivers: BatchReceiver[] = [
      {
        receiverUrl: "http://example.com:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Test 1",
      },
      {
        receiverUrl: "http://example.org:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Test 2",
      },
    ];

    startBatchPrecheck(receivers);
    cancelBatchJob();

    // Wait a moment for the cancellation to propagate
    await new Promise((r) => setTimeout(r, 500));

    const status = getBatchJobStatus();
    expect(status.running).toBe(false);
  });

  it("returns empty status when no job exists", () => {
    const status = getBatchJobStatus();
    expect(status.jobId).toBeNull();
    expect(status.total).toBe(0);
    expect(status.checked).toBe(0);
    expect(status.running).toBe(false);
    expect(Object.keys(status.results).length).toBe(0);
  });

  it("replaces a running job when a new one is started", async () => {
    const receivers1: BatchReceiver[] = [
      {
        receiverUrl: "http://example.com:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Job 1",
      },
    ];

    const jobId1 = startBatchPrecheck(receivers1);

    // Wait 2ms to ensure different timestamp
    await new Promise((r) => setTimeout(r, 2));

    const receivers2: BatchReceiver[] = [
      {
        receiverUrl: "http://example.org:8073",
        receiverType: "KiwiSDR",
        stationLabel: "Job 2",
      },
    ];

    const jobId2 = startBatchPrecheck(receivers2);

    expect(jobId2).not.toBe(jobId1);
    const status = getBatchJobStatus();
    expect(status.jobId).toBe(jobId2);
  });
});
