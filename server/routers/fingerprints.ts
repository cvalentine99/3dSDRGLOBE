import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { signalFingerprints, tdoaTargets } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

export const fingerprintsRouter = router({
  /** Store a signal fingerprint for a target */
  create: publicProcedure
    .input(z.object({
      targetId: z.number(),
      recordingId: z.number(),
      historyEntryId: z.number().optional(),
      frequencyKhz: z.number().optional(),
      mode: z.string().optional(),
      spectralPeaks: z.array(z.number()).optional(),
      bandwidthHz: z.number().optional(),
      dominantFreqHz: z.number().optional(),
      spectralCentroid: z.number().optional(),
      spectralFlatness: z.number().optional(),
      rmsLevel: z.number().optional(),
      featureVector: z.array(z.number()).optional(),
      spectrogramUrl: z.string().optional(),
      spectrogramKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [result] = await db.insert(signalFingerprints).values({
        targetId: input.targetId,
        recordingId: input.recordingId,
        historyEntryId: input.historyEntryId ?? null,
        frequencyKhz: input.frequencyKhz ? String(input.frequencyKhz) : null,
        mode: input.mode ?? null,
        spectralPeaks: input.spectralPeaks ?? null,
        bandwidthHz: input.bandwidthHz ?? null,
        dominantFreqHz: input.dominantFreqHz ?? null,
        spectralCentroid: input.spectralCentroid ?? null,
        spectralFlatness: input.spectralFlatness ?? null,
        rmsLevel: input.rmsLevel ?? null,
        featureVector: input.featureVector ?? null,
        spectrogramUrl: input.spectrogramUrl ?? null,
        spectrogramKey: input.spectrogramKey ?? null,
        createdAt: Date.now(),
      });

      return { id: result.insertId };
    }),

  /** Get fingerprints for a target */
  byTarget: publicProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(signalFingerprints)
        .where(eq(signalFingerprints.targetId, input.targetId))
        .orderBy(desc(signalFingerprints.createdAt));
    }),

  /** Find matching fingerprints for a given feature vector using cosine similarity */
  findMatches: publicProcedure
    .input(z.object({
      featureVector: z.array(z.number()),
      frequencyKhz: z.number().optional(),
      threshold: z.number().min(0).max(1).default(0.85),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      let allFingerprints = await db.select().from(signalFingerprints);
      allFingerprints = allFingerprints.filter(fp => fp.featureVector != null);

      if (input.frequencyKhz) {
        const freqStr = String(input.frequencyKhz);
        allFingerprints.sort((a, b) => {
          const aMatch = a.frequencyKhz === freqStr ? 0 : 1;
          const bMatch = b.frequencyKhz === freqStr ? 0 : 1;
          return aMatch - bMatch;
        });
      }

      const matches: Array<{
        fingerprintId: number;
        targetId: number;
        similarity: number;
        frequencyKhz: string | null;
        mode: string | null;
      }> = [];

      for (const fp of allFingerprints) {
        const fpVector = fp.featureVector as number[];
        if (!fpVector || fpVector.length !== input.featureVector.length) continue;

        const similarity = cosineSimilarity(input.featureVector, fpVector);
        if (similarity >= input.threshold) {
          matches.push({
            fingerprintId: fp.id,
            targetId: fp.targetId,
            similarity,
            frequencyKhz: fp.frequencyKhz,
            mode: fp.mode,
          });
        }
      }

      matches.sort((a, b) => b.similarity - a.similarity);

      const enriched = await Promise.all(
        matches.slice(0, input.limit).map(async (m) => {
          const target = await db.select({ label: tdoaTargets.label, category: tdoaTargets.category })
            .from(tdoaTargets).where(eq(tdoaTargets.id, m.targetId)).limit(1);
          return {
            ...m,
            targetLabel: target[0]?.label ?? "Unknown",
            targetCategory: target[0]?.category ?? "unknown",
          };
        })
      );

      return enriched;
    }),

  /** Delete a fingerprint */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(signalFingerprints).where(eq(signalFingerprints.id, input.id));
      return { success: true };
    }),
});
