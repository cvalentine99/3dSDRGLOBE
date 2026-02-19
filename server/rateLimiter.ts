/**
 * rateLimiter.ts — In-memory rate limiting for tRPC procedures
 *
 * Provides a configurable rate limiter that tracks request counts per IP address
 * using a sliding window approach. Designed to protect expensive operations
 * like TDoA job submission and LLM classification from abuse.
 *
 * Features:
 *   - Per-IP tracking using client IP from request headers (X-Forwarded-For) or socket
 *   - Configurable window size and max requests per window
 *   - Automatic cleanup of expired entries to prevent memory leaks
 *   - Returns remaining quota and reset time in response for client feedback
 *   - tRPC middleware factory for easy integration with any procedure
 */
import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Human-readable name for error messages */
  name: string;
}

/** In-memory store keyed by limiter name -> IP -> entry */
const stores = new Map<string, Map<string, RateLimitEntry>>();

/** Cleanup interval handle */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Start periodic cleanup of expired entries (every 5 minutes) */
function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    stores.forEach((store, limiterName) => {
      store.forEach((entry, ip) => {
        // Remove timestamps older than 1 hour (max reasonable window)
        entry.timestamps = entry.timestamps.filter((ts: number) => now - ts < 3600000);
        if (entry.timestamps.length === 0) {
          store.delete(ip);
        }
      });
      if (store.size === 0) {
        stores.delete(limiterName);
      }
    });
  }, 300000); // 5 min
}

/**
 * Extract client IP from the request, considering proxies.
 */
export function getClientIp(req: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Check rate limit for a given IP and limiter configuration.
 * Returns { allowed, remaining, resetMs } where resetMs is the time until the oldest
 * request in the window expires.
 */
export function checkRateLimit(
  ip: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetMs: number } {
  ensureCleanup();

  if (!stores.has(config.name)) {
    stores.set(config.name, new Map());
  }
  const store = stores.get(config.name)!;

  const now = Date.now();
  let entry = store.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(ip, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);

  if (entry.timestamps.length >= config.maxRequests) {
    // Rate limited
    const oldestInWindow = entry.timestamps[0];
    const resetMs = oldestInWindow + config.windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
    };
  }

  // Allow and record
  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetMs: entry.timestamps[0] + config.windowMs - now,
  };
}

/**
 * Reset all rate limit stores (for testing).
 */
export function resetAllRateLimits(): void {
  stores.clear();
}

/**
 * Pre-configured rate limit configs for specific endpoints.
 */
export const RATE_LIMITS = {
  /** TDoA job submission: 10 requests per 60 minutes */
  tdoaSubmit: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    name: "tdoa_submit",
  } satisfies RateLimitConfig,

  /** LLM classification: 20 requests per 60 minutes */
  llmClassify: {
    maxRequests: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
    name: "llm_classify",
  } satisfies RateLimitConfig,
} as const;

/**
 * Create a tRPC middleware that enforces rate limiting.
 * Throws TOO_MANY_REQUESTS error when limit is exceeded.
 */
const t = initTRPC.context<TrpcContext>().create();

export function createRateLimitMiddleware(config: RateLimitConfig) {
  return t.middleware(async ({ ctx, next }) => {
    const ip = getClientIp(ctx.req);
    const result = checkRateLimit(ip, config);

    // Set rate limit headers on the response
    ctx.res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
    ctx.res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    ctx.res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetMs / 1000).toString());

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.resetMs / 1000);
      const retryMin = Math.ceil(retryAfterSec / 60);
      ctx.res.setHeader("Retry-After", retryAfterSec.toString());
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded for ${config.name}. You have used all ${config.maxRequests} requests in the current window. Please try again in ${retryMin} minute${retryMin !== 1 ? "s" : ""}.`,
      });
    }

    return next({ ctx });
  });
}
