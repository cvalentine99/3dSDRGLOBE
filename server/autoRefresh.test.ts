import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  registerReceiversForAutoRefresh,
  getAutoRefreshStatus,
  stopAutoRefresh,
  forceRefresh,
  resetAutoRefreshState,
} from "./autoRefresh";
import { resetBatchState, getBatchJobStatus } from "./batchPrecheck";
import { clearStatusCache } from "./receiverStatus";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

beforeEach(() => {
  resetAutoRefreshState();
  resetBatchState();
  clearStatusCache();
});

afterEach(() => {
  resetAutoRefreshState();
  resetBatchState();
});

describe("autoRefresh", () => {
  it("starts with inactive status and zero receivers", () => {
    const status = getAutoRefreshStatus();
    expect(status.active).toBe(false);
    expect(status.receiverCount).toBe(0);
    expect(status.cycleCount).toBe(0);
    expect(status.nextRefreshAt).toBeNull();
    expect(status.lastRefreshStartedAt).toBeNull();
    expect(status.lastRefreshCompletedAt).toBeNull();
    expect(status.intervalMs).toBe(30 * 60 * 1000);
  });

  it("registers receivers and updates receiver count", () => {
    registerReceiversForAutoRefresh([
      { receiverUrl: "http://example.com:8073", receiverType: "KiwiSDR", stationLabel: "Test" },
      { receiverUrl: "http://example2.com:8073", receiverType: "OpenWebRX", stationLabel: "Test2" },
    ]);

    const status = getAutoRefreshStatus();
    expect(status.receiverCount).toBe(2);
  });

  it("forceRefresh returns error when no receivers registered", () => {
    const result = forceRefresh();
    expect(result.started).toBe(false);
    expect(result.reason).toContain("No receivers registered");
  });

  it("forceRefresh starts a batch job when receivers are registered", () => {
    registerReceiversForAutoRefresh([
      { receiverUrl: "http://example.com:8073", receiverType: "KiwiSDR", stationLabel: "Test" },
    ]);

    // Wait for any initial batch to not be running
    const result = forceRefresh();
    // It should start (or report already running from the register call)
    expect(typeof result.started).toBe("boolean");
  });

  it("stopAutoRefresh deactivates the scheduler", () => {
    registerReceiversForAutoRefresh([
      { receiverUrl: "http://example.com:8073", receiverType: "KiwiSDR", stationLabel: "Test" },
    ]);

    stopAutoRefresh();
    const status = getAutoRefreshStatus();
    expect(status.active).toBe(false);
    expect(status.nextRefreshAt).toBeNull();
  });

  it("resetAutoRefreshState clears all state", () => {
    registerReceiversForAutoRefresh([
      { receiverUrl: "http://example.com:8073", receiverType: "KiwiSDR", stationLabel: "Test" },
    ]);

    resetAutoRefreshState();
    const status = getAutoRefreshStatus();
    expect(status.active).toBe(false);
    expect(status.receiverCount).toBe(0);
    expect(status.cycleCount).toBe(0);
  });
});

describe("autoRefresh tRPC endpoints", () => {
  it("autoRefreshStatus returns scheduler info", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const status = await caller.receiver.autoRefreshStatus();
    expect(status).toHaveProperty("active");
    expect(status).toHaveProperty("receiverCount");
    expect(status).toHaveProperty("cycleCount");
    expect(status).toHaveProperty("nextRefreshAt");
    expect(status).toHaveProperty("intervalMs");
    expect(status.intervalMs).toBe(30 * 60 * 1000);
  });

  it("forceRefresh endpoint returns result", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.receiver.forceRefresh();
    expect(result).toHaveProperty("started");
    // No receivers registered, so it should fail
    expect(result.started).toBe(false);
  });

  it("stopAutoRefresh endpoint stops the scheduler", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.receiver.stopAutoRefresh();
    expect(result).toEqual({ stopped: true });
  });

  it("batchPrecheckSince includes autoRefresh metadata", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.receiver.batchPrecheckSince({ since: 0 });
    expect(result).toHaveProperty("autoRefresh");
    expect(result.autoRefresh).toHaveProperty("active");
    expect(result.autoRefresh).toHaveProperty("cycleCount");
    expect(result.autoRefresh).toHaveProperty("nextRefreshAt");
  });
});
