import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { tdoaRecordings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { recordAllHosts } from "../kiwiRecorder";

export const recordingsRouter = router({
  /** Record audio from KiwiSDR hosts */
  record: publicProcedure
    .input(
      z.object({
        jobId: z.number(),
        hosts: z.array(
          z.object({
            h: z.string(),
            p: z.number(),
            id: z.string(),
          })
        ),
        frequencyKhz: z.number(),
        durationSec: z.number().min(5).max(30).default(15),
        mode: z.enum(["am", "usb", "lsb", "cw"]).default("am"),
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
});
