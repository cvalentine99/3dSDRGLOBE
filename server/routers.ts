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
import {
  getAllReceiverStatuses,
  getReceiverHistory,
  getRecentScanCycles,
  getAggregateStats,
} from "./statusPersistence";
import {
  getGpsHosts,
  getRefTransmitters,
  submitTdoaJob,
  pollJobProgress,
  getJob,
  getRecentJobs,
  cancelJob,
  proxyResultFile,
} from "./tdoaService";

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

  /**
   * Uptime history and trend endpoints.
   * Query persisted scan data from the database.
   */
  uptime: router({
    /**
     * Get all receivers with their latest status and uptime percentages.
     * Used for the main receiver list with uptime badges.
     */
    allReceivers: publicProcedure.query(async () => {
      return await getAllReceiverStatuses();
    }),

    /**
     * Get status history for a specific receiver over a time range.
     * Used for rendering uptime trend sparklines/charts.
     */
    receiverHistory: publicProcedure
      .input(
        z.object({
          receiverUrl: z.string(),
          hoursBack: z.number().min(1).max(720).default(24), // 1 hour to 30 days
        })
      )
      .query(async ({ input }) => {
        return await getReceiverHistory(input.receiverUrl, input.hoursBack);
      }),

    /**
     * Get recent scan cycle summaries.
     * Used for the scan history timeline.
     */
    recentScans: publicProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(200).default(48),
        })
      )
      .query(async ({ input }) => {
        return await getRecentScanCycles(input.limit);
      }),

    /**
     * Get aggregate stats across all receivers.
     * Used for the dashboard overview.
     */
    aggregateStats: publicProcedure.query(async () => {
      return await getAggregateStats();
    }),
  }),

  /**
   * TDoA (Time Difference of Arrival) triangulation endpoints.
   * Proxies requests to tdoa.kiwisdr.com for HF transmitter geolocation.
   */
  tdoa: router({
    /**
     * Get list of GPS-active KiwiSDR hosts available for TDoA.
     * Cached for 5 minutes.
     */
    getGpsHosts: publicProcedure.query(async () => {
      return await getGpsHosts();
    }),

    /**
     * Get reference transmitter database (known callsigns, frequencies, locations).
     * Cached for 30 minutes.
     */
    getRefs: publicProcedure.query(async () => {
      return await getRefTransmitters();
    }),

    /**
     * Submit a TDoA triangulation job.
     * Sends job to tdoa.kiwisdr.com and returns a jobId for progress polling.
     */
    submitJob: publicProcedure
      .input(
        z.object({
          hosts: z.array(
            z.object({
              h: z.string(),
              p: z.number(),
              id: z.string(),
              lat: z.number(),
              lon: z.number(),
            })
          ).min(2).max(6),
          frequencyKhz: z.number().positive(),
          passbandHz: z.number().positive(),
          sampleTime: z.number().refine((v) => [15, 30, 45, 60].includes(v)),
          mapBounds: z.object({
            north: z.number(),
            south: z.number(),
            east: z.number(),
            west: z.number(),
          }),
          knownLocation: z.object({
            lat: z.number(),
            lon: z.number(),
            name: z.string().max(100).regex(/^[a-zA-Z0-9 .\-]*$/, "Name contains invalid characters"),
          }).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const job = await submitTdoaJob(input);
        return { jobId: job.id, status: job.status };
      }),

    /**
     * Poll progress of a running TDoA job.
     * Returns current status, per-host sampling status, and results if complete.
     */
    pollProgress: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const job = await pollJobProgress(input.jobId);
        if (!job) {
          return { id: input.jobId, status: "error" as const, error: "Job not found", hostStatuses: {}, contours: [], createdAt: 0 };
        }
        return {
          id: job.id,
          status: job.status,
          hostStatuses: job.hostStatuses,
          result: job.result,
          contours: job.contours,
          heatmapUrl: job.heatmapUrl,
          error: job.error,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        };
      }),

    /**
     * Cancel a running TDoA job.
     */
    cancelJob: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(({ input }) => {
        const cancelled = cancelJob(input.jobId);
        return { cancelled };
      }),

    /**
     * Get recent TDoA job history.
     */
    recentJobs: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
      .query(({ input }) => {
        return getRecentJobs(input?.limit ?? 20).map((job) => ({
          id: job.id,
          status: job.status,
          frequencyKhz: job.params.frequencyKhz,
          hostCount: job.params.hosts.length,
          likelyPosition: job.result?.likely_position,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          error: job.error,
        }));
      }),

    /**
     * Proxy a result file (heatmap PNG, etc.) from the TDoA server.
     * Avoids mixed-content issues (TDoA server is HTTP-only).
     */
    resultFile: publicProcedure
      .input(
        z.object({
          key: z.string().regex(/^[a-zA-Z0-9._\-]+$/, "Invalid key format"),
          filename: z.string().regex(/^[a-zA-Z0-9._\- ]+$/, "Invalid filename format"),
        })
      )
      .query(async ({ input }) => {
        const file = await proxyResultFile(input.key, input.filename);
        if (!file) return { found: false as const };
        // Return base64-encoded data for the client
        return {
          found: true as const,
          data: file.data.toString("base64"),
          contentType: file.contentType,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
