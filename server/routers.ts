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
  selectBestHosts,
} from "./tdoaService";
import { tdoaJobs, tdoaTargets, tdoaRecordings, tdoaTargetHistory, TARGET_CATEGORIES } from "../drizzle/schema";
import { getDb } from "./db";
import { desc, eq, asc } from "drizzle-orm";
import { recordAllHosts, type RecordingResult } from "./kiwiRecorder";

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
  /**
   * TDoA (Time Difference of Arrival) triangulation endpoints.
   * Proxies requests to tdoa.kiwisdr.com for HF transmitter geolocation.
   */
  tdoa: router({
    /**
     * Get list of GPS-active KiwiSDR hosts available for TDoA.
     * Cached for 5 minutes server-side.
     */
    getGpsHosts: publicProcedure.query(async () => {
      return await getGpsHosts();
    }),

    /**
     * Get reference transmitters (known frequency/location pairs).
     * Cached for 30 minutes server-side.
     */
    getRefs: publicProcedure.query(async () => {
      return await getRefTransmitters();
    }),

    /**
     * Auto-select the best hosts for TDoA triangulation.
     * Returns `count` hosts optimized for geographic spread and signal quality.
     */
    autoSelectHosts: publicProcedure
      .input(
        z.object({
          count: z.number().min(2).max(6).default(3),
        }).optional()
      )
      .query(async ({ input }) => {
        const hosts = await getGpsHosts();
        return selectBestHosts(hosts, input?.count ?? 3);
      }),

    /**
     * Submit a new TDoA triangulation job.
     * Sends the request to tdoa.kiwisdr.com and returns a job ID for polling.
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
          sampleTime: z.number().min(15).max(60),
          mapBounds: z.object({
            north: z.number(),
            south: z.number(),
            east: z.number(),
            west: z.number(),
          }),
          knownLocation: z.object({
            lat: z.number(),
            lon: z.number(),
            name: z.string(),
          }).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const job = await submitTdoaJob(input);

        // Persist to database
        try {
          const db = await getDb();
          if (db) {
            await db.insert(tdoaJobs).values({
              frequencyKhz: String(input.frequencyKhz),
              passbandHz: input.passbandHz,
              sampleTime: input.sampleTime,
              hosts: input.hosts,
              knownLocation: input.knownLocation || null,
              mapBounds: input.mapBounds,
              tdoaKey: job.key || null,
              status: job.status,
              createdAt: job.createdAt,
            });
          }
        } catch (err) {
          console.error("[TDoA] Failed to persist job:", err);
        }

        return { jobId: job.id, key: job.key, status: job.status };
      }),

    /**
     * Poll progress of an active TDoA job.
     * Returns current status, host statuses, and results when complete.
     */
    pollProgress: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const job = await pollJobProgress(input.jobId);
        if (!job) {
          return null;
        }

        // Update database if job completed
        if (job.status === "complete" || job.status === "error") {
          try {
            const db = await getDb();
            if (db && job.key) {
              await db
                .update(tdoaJobs)
                .set({
                  status: job.status,
                  likelyLat: job.result?.likely_position
                    ? String(job.result.likely_position.lat)
                    : null,
                  likelyLon: job.result?.likely_position
                    ? String(job.result.likely_position.lng)
                    : null,
                  resultData: job.result || null,
                  contourData: job.contours.length > 0 ? job.contours : null,
                  heatmapKey: job.key || null,
                  errorMessage: job.error || null,
                  completedAt: job.completedAt || Date.now(),
                })
                .where(eq(tdoaJobs.tdoaKey, job.key));
            }
          } catch (err) {
            console.error("[TDoA] Failed to update job in DB:", err);
          }
        }

        return {
          id: job.id,
          key: job.key,
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
     * Cancel an active TDoA job.
     */
    cancelJob: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(({ input }) => {
        const cancelled = cancelJob(input.jobId);
        return { cancelled };
      }),

    /**
     * Get recent in-memory TDoA jobs.
     */
    recentJobs: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
      .query(({ input }) => {
        return getRecentJobs(input?.limit ?? 20);
      }),

    /**
     * Get job history from database (persisted across restarts).
     */
    jobHistory: publicProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).default(20),
        }).optional()
      )
      .query(async ({ input }) => {
        try {
          const db = await getDb();
          if (!db) return [];
          const rows = await db
            .select()
            .from(tdoaJobs)
            .orderBy(desc(tdoaJobs.createdAt))
            .limit(input?.limit ?? 20);
          return rows;
        } catch (err) {
          console.error("[TDoA] Failed to fetch job history:", err);
          return [];
        }
      }),

    /**
     * Get a single TDoA job by ID (for shareable URLs).
     */
    getJobById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        try {
          const db = await getDb();
          if (!db) return null;
          const rows = await db
            .select()
            .from(tdoaJobs)
            .where(eq(tdoaJobs.id, input.id))
            .limit(1);
          return rows[0] || null;
        } catch (err) {
          console.error("[TDoA] Failed to fetch job by ID:", err);
          return null;
        }
      }),

    /**
     * Delete a job from history.
     */
    deleteJob: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        try {
          const db = await getDb();
          if (!db) return { deleted: false };
          await db.delete(tdoaJobs).where(eq(tdoaJobs.id, input.id));
          return { deleted: true };
        } catch (err) {
          console.error("[TDoA] Failed to delete job:", err);
          return { deleted: false };
        }
      }),
  }),

  targets: router({
    /** List all saved TDoA targets */
    list: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt));
    }),

    /** Save a new TDoA target position */
    save: publicProcedure
      .input(
        z.object({
          label: z.string().min(1).max(256),
          lat: z.number(),
          lon: z.number(),
          frequencyKhz: z.number().optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          category: z.enum(TARGET_CATEGORIES).optional(),
          notes: z.string().max(1000).optional(),
          sourceJobId: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [result] = await db.insert(tdoaTargets).values({
          label: input.label,
          lat: String(input.lat),
          lon: String(input.lon),
          frequencyKhz: input.frequencyKhz ? String(input.frequencyKhz) : null,
          color: input.color || "#ff6b6b",
          category: input.category || "unknown",
          notes: input.notes || null,
          sourceJobId: input.sourceJobId || null,
          visible: true,
          createdAt: Date.now(),
        });

        // Also create the first history entry
        if (input.sourceJobId) {
          await db.insert(tdoaTargetHistory).values({
            targetId: result.insertId,
            jobId: input.sourceJobId,
            lat: String(input.lat),
            lon: String(input.lon),
            frequencyKhz: input.frequencyKhz ? String(input.frequencyKhz) : null,
            observedAt: Date.now(),
          });
        }

        return { id: result.insertId };
      }),

    /** Toggle target visibility on the globe */
    toggleVisibility: publicProcedure
      .input(z.object({ id: z.number(), visible: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { updated: false };
        await db.update(tdoaTargets).set({ visible: input.visible }).where(eq(tdoaTargets.id, input.id));
        return { updated: true };
      }),

    /** Update target label, color, category, or notes */
    update: publicProcedure
      .input(
        z.object({
          id: z.number(),
          label: z.string().min(1).max(256).optional(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          category: z.enum(TARGET_CATEGORIES).optional(),
          notes: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { updated: false };
        const updates: Record<string, any> = {};
        if (input.label !== undefined) updates.label = input.label;
        if (input.color !== undefined) updates.color = input.color;
        if (input.category !== undefined) updates.category = input.category;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (Object.keys(updates).length === 0) return { updated: false };
        await db.update(tdoaTargets).set(updates).where(eq(tdoaTargets.id, input.id));
        return { updated: true };
      }),

    /** Delete a saved target (also deletes its history) */
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { deleted: false };
        await db.delete(tdoaTargetHistory).where(eq(tdoaTargetHistory.targetId, input.id));
        await db.delete(tdoaTargets).where(eq(tdoaTargets.id, input.id));
        return { deleted: true };
      }),

    /** Add a position observation to a target's history */
    addHistoryEntry: publicProcedure
      .input(
        z.object({
          targetId: z.number(),
          jobId: z.number(),
          lat: z.number(),
          lon: z.number(),
          frequencyKhz: z.number().optional(),
          hostCount: z.number().optional(),
          notes: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const [result] = await db.insert(tdoaTargetHistory).values({
          targetId: input.targetId,
          jobId: input.jobId,
          lat: String(input.lat),
          lon: String(input.lon),
          frequencyKhz: input.frequencyKhz ? String(input.frequencyKhz) : null,
          hostCount: input.hostCount || null,
          notes: input.notes || null,
          observedAt: Date.now(),
        });

        // Update the target's current position to the latest observation
        await db.update(tdoaTargets).set({
          lat: String(input.lat),
          lon: String(input.lon),
        }).where(eq(tdoaTargets.id, input.targetId));

        return { id: result.insertId };
      }),

    /** Get position history for a target (ordered by time) */
    getHistory: publicProcedure
      .input(z.object({ targetId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return await db
          .select()
          .from(tdoaTargetHistory)
          .where(eq(tdoaTargetHistory.targetId, input.targetId))
          .orderBy(asc(tdoaTargetHistory.observedAt));
      }),

    /** Get all history entries for all targets (for drift trail rendering) */
    getAllHistory: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db
        .select()
        .from(tdoaTargetHistory)
        .orderBy(asc(tdoaTargetHistory.observedAt));
    }),
  }),

  recordings: router({
    /** Start recording audio from all hosts in a TDoA job */
    startRecording: publicProcedure
      .input(
        z.object({
          jobId: z.number(),
          hosts: z.array(
            z.object({
              h: z.string(),
              p: z.number(),
            })
          ),
          frequencyKhz: z.number(),
          durationSec: z.number().min(5).max(60).default(15),
          mode: z.enum(["am", "usb", "lsb", "cw"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const results = await recordAllHosts(
          input.jobId,
          input.hosts,
          input.frequencyKhz,
          input.durationSec,
          input.mode
        );
        return { recordings: results };
      }),

    /** Get all recordings for a specific TDoA job */
    getByJob: publicProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return await db
          .select()
          .from(tdoaRecordings)
          .where(eq(tdoaRecordings.jobId, input.jobId))
          .orderBy(tdoaRecordings.hostId);
      }),

    /** Delete a recording */
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) return { deleted: false };
        await db.delete(tdoaRecordings).where(eq(tdoaRecordings.id, input.id));
        return { deleted: true };
      }),
  }),

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
});

export type AppRouter = typeof appRouter;
