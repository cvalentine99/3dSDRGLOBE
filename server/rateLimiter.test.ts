/**
 * rateLimiter.test.ts — Tests for the in-memory rate limiting module
 *
 * Covers:
 *   - Basic rate limit enforcement (allow/deny)
 *   - Sliding window behavior
 *   - Multiple IPs tracked independently
 *   - Multiple limiter configs tracked independently
 *   - Remaining count accuracy
 *   - Reset time calculation
 *   - getClientIp extraction from headers and socket
 *   - RATE_LIMITS config values
 *   - resetAllRateLimits cleanup
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  getClientIp,
  resetAllRateLimits,
  RATE_LIMITS,
} from "./rateLimiter";

const testConfig = {
  maxRequests: 3,
  windowMs: 60000, // 1 minute
  name: "test_limiter",
};

describe("rateLimiter", () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  describe("checkRateLimit", () => {
    it("should allow requests under the limit", () => {
      const result = checkRateLimit("192.168.1.1", testConfig);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 max - 1 used
    });

    it("should track remaining count correctly", () => {
      const r1 = checkRateLimit("192.168.1.1", testConfig);
      expect(r1.remaining).toBe(2);

      const r2 = checkRateLimit("192.168.1.1", testConfig);
      expect(r2.remaining).toBe(1);

      const r3 = checkRateLimit("192.168.1.1", testConfig);
      expect(r3.remaining).toBe(0);
    });

    it("should deny requests when limit is reached", () => {
      checkRateLimit("192.168.1.1", testConfig);
      checkRateLimit("192.168.1.1", testConfig);
      checkRateLimit("192.168.1.1", testConfig);

      const result = checkRateLimit("192.168.1.1", testConfig);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should return positive resetMs when rate limited", () => {
      checkRateLimit("192.168.1.1", testConfig);
      checkRateLimit("192.168.1.1", testConfig);
      checkRateLimit("192.168.1.1", testConfig);

      const result = checkRateLimit("192.168.1.1", testConfig);
      expect(result.allowed).toBe(false);
      expect(result.resetMs).toBeGreaterThan(0);
      expect(result.resetMs).toBeLessThanOrEqual(testConfig.windowMs);
    });

    it("should track different IPs independently", () => {
      // Fill up IP 1
      checkRateLimit("10.0.0.1", testConfig);
      checkRateLimit("10.0.0.1", testConfig);
      checkRateLimit("10.0.0.1", testConfig);

      // IP 1 should be rate limited
      const r1 = checkRateLimit("10.0.0.1", testConfig);
      expect(r1.allowed).toBe(false);

      // IP 2 should still be allowed
      const r2 = checkRateLimit("10.0.0.2", testConfig);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(2);
    });

    it("should track different limiter configs independently", () => {
      const configA = { maxRequests: 1, windowMs: 60000, name: "limiter_a" };
      const configB = { maxRequests: 1, windowMs: 60000, name: "limiter_b" };

      // Use up limiter A
      checkRateLimit("10.0.0.1", configA);
      const rA = checkRateLimit("10.0.0.1", configA);
      expect(rA.allowed).toBe(false);

      // Limiter B should still be available for the same IP
      const rB = checkRateLimit("10.0.0.1", configB);
      expect(rB.allowed).toBe(true);
    });

    it("should allow requests again after window expires", () => {
      // Use a very short window for this test
      const shortConfig = { maxRequests: 1, windowMs: 50, name: "short_test" };

      checkRateLimit("10.0.0.1", shortConfig);
      const denied = checkRateLimit("10.0.0.1", shortConfig);
      expect(denied.allowed).toBe(false);

      // Wait for the window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const allowed = checkRateLimit("10.0.0.1", shortConfig);
          expect(allowed.allowed).toBe(true);
          resolve();
        }, 60);
      });
    });

    it("should handle first request for unknown IP", () => {
      const result = checkRateLimit("never-seen-before", testConfig);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  describe("getClientIp", () => {
    it("should extract IP from X-Forwarded-For header", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
      });
      expect(ip).toBe("203.0.113.50");
    });

    it("should extract IP from single X-Forwarded-For value", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": "198.51.100.42" },
      });
      expect(ip).toBe("198.51.100.42");
    });

    it("should extract IP from array X-Forwarded-For header", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": ["10.0.0.1", "10.0.0.2"] },
      });
      expect(ip).toBe("10.0.0.1");
    });

    it("should fall back to socket remoteAddress", () => {
      const ip = getClientIp({
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      });
      expect(ip).toBe("127.0.0.1");
    });

    it("should return 'unknown' when no IP info available", () => {
      const ip = getClientIp({ headers: {} });
      expect(ip).toBe("unknown");
    });

    it("should trim whitespace from forwarded IP", () => {
      const ip = getClientIp({
        headers: { "x-forwarded-for": "  203.0.113.50 , 70.41.3.18" },
      });
      expect(ip).toBe("203.0.113.50");
    });
  });

  describe("resetAllRateLimits", () => {
    it("should clear all stored rate limit data", () => {
      // Fill up a limiter
      checkRateLimit("10.0.0.1", testConfig);
      checkRateLimit("10.0.0.1", testConfig);
      checkRateLimit("10.0.0.1", testConfig);

      const denied = checkRateLimit("10.0.0.1", testConfig);
      expect(denied.allowed).toBe(false);

      // Reset
      resetAllRateLimits();

      // Should be allowed again
      const allowed = checkRateLimit("10.0.0.1", testConfig);
      expect(allowed.allowed).toBe(true);
      expect(allowed.remaining).toBe(2);
    });
  });

  describe("RATE_LIMITS config", () => {
    it("should have tdoaSubmit config with reasonable limits", () => {
      expect(RATE_LIMITS.tdoaSubmit.maxRequests).toBe(10);
      expect(RATE_LIMITS.tdoaSubmit.windowMs).toBe(3600000); // 1 hour
      expect(RATE_LIMITS.tdoaSubmit.name).toBe("tdoa_submit");
    });

    it("should have llmClassify config with reasonable limits", () => {
      expect(RATE_LIMITS.llmClassify.maxRequests).toBe(20);
      expect(RATE_LIMITS.llmClassify.windowMs).toBe(3600000); // 1 hour
      expect(RATE_LIMITS.llmClassify.name).toBe("llm_classify");
    });
  });

  describe("sliding window behavior", () => {
    it("should correctly expire old timestamps in the window", () => {
      const shortConfig = { maxRequests: 2, windowMs: 100, name: "sliding_test" };

      // Make 2 requests (fills the limit)
      checkRateLimit("10.0.0.1", shortConfig);
      checkRateLimit("10.0.0.1", shortConfig);

      const denied = checkRateLimit("10.0.0.1", shortConfig);
      expect(denied.allowed).toBe(false);

      // Wait for window to expire, then one more should be allowed
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = checkRateLimit("10.0.0.1", shortConfig);
          expect(result.allowed).toBe(true);
          resolve();
        }, 120);
      });
    });
  });
});
