import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { checkReceiverStatus, getStatusCacheSize, clearStatusCache } from "./receiverStatus";
import {
  startBatchPrecheck,
  getBatchJobStatus,
  getBatchResultsSince,
  cancelBatchJob,
  type BatchReceiver,
} from "./batchPrecheck";
import {
  registerReceiversForAutoRefresh,
  getAutoRefreshStatus,
  stopAutoRefresh,
  forceRefresh,
} from "./autoRefresh";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  receiver: router({
    /**
     * Check the status of a single receiver.
     * Server-side proxy rotation avoids CORS and IP bans.
     * Results are cached for 15 minutes per receiver URL.
     */
    checkStatus: publicProcedure
      .input(
        z.object({
          receiverUrl: z.string().url(),
          receiverType: z.enum(["KiwiSDR", "OpenWebRX", "WebSDR"]),
        })
      )
      .query(async ({ input }) => {
        return await checkReceiverStatus(input.receiverUrl, input.receiverType);
      }),

    /**
     * Batch check multiple receivers at once.
     * Useful for checking all receivers at a station.
     */
    checkBatch: publicProcedure
      .input(
        z.object({
          receivers: z
            .array(
              z.object({
                receiverUrl: z.string().url(),
                receiverType: z.enum(["KiwiSDR", "OpenWebRX", "WebSDR"]),
              })
            )
            .max(10), // Limit batch size
        })
      )
      .query(async ({ input }) => {
        const results = await Promise.allSettled(
          input.receivers.map((r) =>
            checkReceiverStatus(r.receiverUrl, r.receiverType)
          )
        );

        return results.map((r, i) => {
          if (r.status === "fulfilled") return r.value;
          return {
            online: false,
            receiverType: input.receivers[i].receiverType,
            receiverUrl: input.receivers[i].receiverUrl,
            checkedAt: Date.now(),
            fromCache: false,
            proxyUsed: false,
            error: r.reason?.message || "Check failed",
          };
        });
      }),

    /**
     * Start a batch pre-check job for all receivers.
     * Processes receivers in throttled waves of 15 concurrent checks.
     * Also registers the receiver list for auto-refresh (every 30 min).
     * Returns a jobId for polling results.
     */
    startBatchPrecheck: publicProcedure
      .input(
        z.object({
          receivers: z.array(
            z.object({
              receiverUrl: z.string().url(),
              receiverType: z.enum(["KiwiSDR", "OpenWebRX", "WebSDR"]),
              stationLabel: z.string(),
            })
          ),
        })
      )
      .mutation(({ input }) => {
        const receivers = input.receivers as BatchReceiver[];
        const jobId = startBatchPrecheck(receivers);

        // Register receivers for auto-refresh scheduler
        registerReceiversForAutoRefresh(receivers);

        return { jobId };
      }),

    /**
     * Poll batch pre-check results.
     * Returns all results accumulated so far, plus progress info.
     */
    batchPrecheckStatus: publicProcedure.query(() => {
      return getBatchJobStatus();
    }),

    /**
     * Poll incremental batch results since a given timestamp.
     * More efficient than fetching all results every time.
     * Also returns auto-refresh metadata so the frontend knows
     * when the next cycle will happen.
     */
    batchPrecheckSince: publicProcedure
      .input(
        z.object({
          since: z.number(),
        })
      )
      .query(({ input }) => {
        const batchResults = getBatchResultsSince(input.since);
        const autoRefresh = getAutoRefreshStatus();
        return {
          ...batchResults,
          autoRefresh: {
            active: autoRefresh.active,
            cycleCount: autoRefresh.cycleCount,
            nextRefreshAt: autoRefresh.nextRefreshAt,
            lastRefreshCompletedAt: autoRefresh.lastRefreshCompletedAt,
          },
        };
      }),

    /**
     * Cancel the current batch pre-check job.
     */
    cancelBatchPrecheck: publicProcedure.mutation(() => {
      cancelBatchJob();
      return { cancelled: true };
    }),

    /**
     * Get auto-refresh scheduler status.
     */
    autoRefreshStatus: publicProcedure.query(() => {
      return getAutoRefreshStatus();
    }),

    /**
     * Force an immediate auto-refresh cycle.
     */
    forceRefresh: publicProcedure.mutation(() => {
      return forceRefresh();
    }),

    /**
     * Stop the auto-refresh scheduler.
     */
    stopAutoRefresh: publicProcedure.mutation(() => {
      stopAutoRefresh();
      return { stopped: true };
    }),

    /**
     * Get cache stats for monitoring.
     */
    cacheStats: publicProcedure.query(() => {
      return {
        cacheSize: getStatusCacheSize(),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
