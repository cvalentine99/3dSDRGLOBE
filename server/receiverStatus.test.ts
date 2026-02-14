import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Tests for the receiver.checkStatus tRPC procedure.
 * These tests call the actual backend endpoint which makes real HTTP requests
 * to receiver servers via proxy rotation.
 */

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

describe("receiver.checkStatus", () => {
  it("returns a valid response shape for a KiwiSDR receiver", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Use a known KiwiSDR that is often online
    const result = await caller.receiver.checkStatus({
      receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
      receiverType: "KiwiSDR",
    });

    // Verify the response shape regardless of online/offline status
    expect(result).toHaveProperty("online");
    expect(typeof result.online).toBe("boolean");
    expect(result).toHaveProperty("receiverType", "KiwiSDR");
    expect(result).toHaveProperty("receiverUrl", "http://kiwisdr.owdjim.gen.nz:8073");
    expect(result).toHaveProperty("checkedAt");
    expect(typeof result.checkedAt).toBe("number");
    expect(result).toHaveProperty("fromCache");
    expect(typeof result.fromCache).toBe("boolean");
    expect(result).toHaveProperty("proxyUsed");
    expect(typeof result.proxyUsed).toBe("boolean");

    // If online and not from cache, verify KiwiSDR-specific fields are present
    // (cached results from batch pre-check may not have all fields)
    if (result.online && !result.fromCache) {
      // These fields should be present on a fresh KiwiSDR status check
      // but may be undefined if the receiver's /status endpoint is partially broken
      if (result.users !== undefined) {
        expect(typeof result.users).toBe("number");
        expect(typeof result.usersMax).toBe("number");
      }
    }
  }, 30000); // 30s timeout for network request

  it("returns a valid response for an OpenWebRX receiver", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.receiver.checkStatus({
      receiverUrl: "http://sdrpt.dynip.sapo.pt:8073",
      receiverType: "OpenWebRX",
    });

    expect(result).toHaveProperty("online");
    expect(typeof result.online).toBe("boolean");
    expect(result).toHaveProperty("receiverType", "OpenWebRX");
    expect(result).toHaveProperty("checkedAt");
    expect(typeof result.checkedAt).toBe("number");
  }, 30000);

  it("returns cached result on second call for same receiver", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // First call
    const result1 = await caller.receiver.checkStatus({
      receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
      receiverType: "KiwiSDR",
    });

    // Second call should be cached
    const result2 = await caller.receiver.checkStatus({
      receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073",
      receiverType: "KiwiSDR",
    });

    expect(result2.fromCache).toBe(true);
    expect(result2.checkedAt).toBe(result1.checkedAt);
  }, 30000);

  it("rejects invalid receiver type", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.receiver.checkStatus({
        receiverUrl: "http://example.com",
        receiverType: "InvalidType" as any,
      })
    ).rejects.toThrow();
  });

  it("rejects invalid URL format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.receiver.checkStatus({
        receiverUrl: "not-a-url",
        receiverType: "KiwiSDR",
      })
    ).rejects.toThrow();
  });
});

describe("receiver.checkBatch", () => {
  it("returns results for multiple receivers", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const results = await caller.receiver.checkBatch({
      receivers: [
        { receiverUrl: "http://kiwisdr.owdjim.gen.nz:8073", receiverType: "KiwiSDR" },
        { receiverUrl: "http://sdrpt.dynip.sapo.pt:8073", receiverType: "OpenWebRX" },
      ],
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r).toHaveProperty("online");
      expect(r).toHaveProperty("receiverType");
      expect(r).toHaveProperty("checkedAt");
    }
  }, 60000);
});

describe("receiver.cacheStats", () => {
  it("returns cache size", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.receiver.cacheStats();
    expect(stats).toHaveProperty("cacheSize");
    expect(typeof stats.cacheSize).toBe("number");
    expect(stats.cacheSize).toBeGreaterThanOrEqual(0);
  });
});
