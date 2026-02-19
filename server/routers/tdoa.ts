import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
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
} from "../tdoaService";
import { tdoaJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { desc, eq } from "drizzle-orm";

export const tdoaRouter = router({
  getGpsHosts: publicProcedure.query(async () => {
    return await getGpsHosts();
  }),

  getRefs: publicProcedure.query(async () => {
    return await getRefTransmitters();
  }),

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

  pollProgress: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await pollJobProgress(input.jobId);
      if (!job) {
        return null;
      }

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

  cancelJob: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(({ input }) => {
      const cancelled = cancelJob(input.jobId);
      return { cancelled };
    }),

  recentJobs: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(({ input }) => {
      return getRecentJobs(input?.limit ?? 20);
    }),

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
});
