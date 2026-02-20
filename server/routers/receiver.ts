import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { checkReceiverStatus, getStatusCacheSize, clearStatusCache } from "../receiverStatus";
import {
  startBatchPrecheck,
  getBatchJobStatus,
  getBatchResultsSince,
  cancelBatchJob,
  type BatchReceiver,
} from "../batchPrecheck";
import {
  registerReceiversForAutoRefresh,
  getAutoRefreshStatus,
  stopAutoRefresh,
  forceRefresh,
} from "../autoRefresh";
import {
  aggregateDirectories,
  getCachedAggregation,
  clearAggregationCache,
  type DirectoryStation,
} from "../directoryAggregator";

export const receiverRouter = router({
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
          .max(10),
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
      registerReceiversForAutoRefresh(receivers);
      return { jobId };
    }),

  batchPrecheckStatus: publicProcedure.query(() => {
    return getBatchJobStatus();
  }),

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

  cancelBatchPrecheck: publicProcedure.mutation(() => {
    cancelBatchJob();
    return { cancelled: true };
  }),

  autoRefreshStatus: publicProcedure.query(() => {
    return getAutoRefreshStatus();
  }),

  forceRefresh: publicProcedure.mutation(() => {
    return forceRefresh();
  }),

  stopAutoRefresh: publicProcedure.mutation(() => {
    stopAutoRefresh();
    return { stopped: true };
  }),

  cacheStats: publicProcedure.query(() => {
    return {
      cacheSize: getStatusCacheSize(),
    };
  }),

  /**
   * Fetch aggregated stations from all directory sources.
   * Merges KiwiSDR GPS, WebSDR.org, and sdr-list.xyz with the existing static stations.
   * Results are cached for 1 hour.
   */
  aggregateDirectories: publicProcedure
    .input(
      z.object({
        /** Pass the existing stations from the client so we can merge/dedup */
        existingStations: z.array(
          z.object({
            label: z.string(),
            location: z.object({
              coordinates: z.tuple([z.number(), z.number()]),
              type: z.literal("Point"),
            }),
            receivers: z.array(
              z.object({
                label: z.string(),
                url: z.string(),
                type: z.enum(["KiwiSDR", "OpenWebRX", "WebSDR"]),
                version: z.string().optional(),
              })
            ),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const existing: DirectoryStation[] = input.existingStations.map((s) => ({
        ...s,
        source: "static",
      }));
      return await aggregateDirectories(existing);
    }),

  /** Get the cached aggregation result without re-fetching */
  getDirectoryCache: publicProcedure.query(() => {
    const cached = getCachedAggregation();
    return {
      hasCachedData: !!cached,
      totalStations: cached?.totalStations ?? 0,
      totalNew: cached?.totalNew ?? 0,
      sources: cached?.sources ?? [],
      fetchedAt: cached?.fetchedAt ?? null,
    };
  }),

  /** Clear the directory aggregation cache to force a fresh fetch */
  clearDirectoryCache: publicProcedure.mutation(() => {
    clearAggregationCache();
    return { cleared: true };
  }),
});
