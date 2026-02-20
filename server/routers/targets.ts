import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { createRateLimitMiddleware, RATE_LIMITS } from "../rateLimiter";
import {
  tdoaTargets,
  tdoaTargetHistory,
  TARGET_CATEGORIES,
} from "../../drizzle/schema";
import { eq, desc, asc } from "drizzle-orm";
import { classifySignal } from "../signalClassifier";
import { predictPosition } from "../positionPredictor";
import { checkForAnomaly } from "../anomalyDetector";
import { checkConflictZoneProximity } from "../conflictZoneChecker";
import { checkGeofences } from "../geofenceEngine";

export const targetsRouter = router({
  /** Auto-classify a target using LLM */
  classify: publicProcedure
    .use(createRateLimitMiddleware(RATE_LIMITS.llmClassify))
    .input(
      z.object({
        targetId: z.number(),
        frequencyKhz: z.number().optional(),
        mode: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        label: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await classifySignal({
        frequencyKhz: input.frequencyKhz ?? null,
        mode: input.mode ?? null,
        lat: input.lat ?? 0,
        lon: input.lon ?? 0,
        label: input.label ?? null,
        notes: input.notes ?? null,
      });

      // Auto-update the target's category if confidence is high enough
      if (result.confidence >= 0.7) {
        const db = await getDb();
        if (db) {
          await db
            .update(tdoaTargets)
            .set({ category: result.category as any })
            .where(eq(tdoaTargets.id, input.targetId));
        }
      }

      return result;
    }),

  /** Export all targets as CSV */
  exportCsv: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { csv: "" };
    const targets = await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt));
    const history = await db.select().from(tdoaTargetHistory).orderBy(asc(tdoaTargetHistory.observedAt));

    const historyByTarget = new Map<number, typeof history>();
    for (const h of history) {
      const arr = historyByTarget.get(h.targetId) || [];
      arr.push(h);
      historyByTarget.set(h.targetId, arr);
    }

    const header = "id,label,lat,lon,frequency_khz,color,category,notes,observations,created_at";
    const rows = targets.map((t) => {
      const obs = historyByTarget.get(t.id)?.length || 0;
      return [
        t.id,
        `"${(t.label || "").replace(/"/g, '""')}"`,
        t.lat,
        t.lon,
        t.frequencyKhz || "",
        t.color,
        t.category,
        `"${(t.notes || "").replace(/"/g, '""')}"`,
        obs,
        new Date(t.createdAt).toISOString(),
      ].join(",");
    });

    return { csv: [header, ...rows].join("\n") };
  }),

  /** Export all targets as KML for Google Earth */
  exportKml: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { kml: "" };
    const targets = await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt));

    const placemarks = targets.map((t) => `
    <Placemark>
      <name>${escapeXml(t.label)}</name>
      <description>${escapeXml(t.notes || `${t.category} — ${t.frequencyKhz || "?"} kHz`)}</description>
      <Point>
        <coordinates>${t.lon},${t.lat},0</coordinates>
      </Point>
      <Style>
        <IconStyle>
          <color>ff${(t.color || "#ff6b6b").slice(5, 7)}${(t.color || "#ff6b6b").slice(3, 5)}${(t.color || "#ff6b6b").slice(1, 3)}</color>
        </IconStyle>
      </Style>
    </Placemark>`).join("\n");

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Radio Globe Targets</name>
    <description>Exported from Radio Globe — Valentine RF SigINT</description>
${placemarks}
  </Document>
</kml>`;

    return { kml };
  }),

  /** Import targets from CSV data */
  importCsv: publicProcedure
    .input(z.object({ csvData: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const lines = input.csvData.split("\n").filter((l) => l.trim());
      if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row");

      const headerLine = lines[0].toLowerCase();
      const headers = parseCsvLine(headerLine);

      const latIdx = headers.findIndex((h) => h === "lat" || h === "latitude");
      const lonIdx = headers.findIndex((h) => h === "lon" || h === "lng" || h === "longitude");
      if (latIdx < 0 || lonIdx < 0) throw new Error("CSV must have lat/latitude and lon/lng/longitude columns");

      const labelIdx = headers.findIndex((h) => h === "label" || h === "name");
      const freqIdx = headers.findIndex((h) => h.includes("freq") || h === "frequency_khz");
      const catIdx = headers.findIndex((h) => h === "category" || h === "cat" || h === "type");
      const colorIdx = headers.findIndex((h) => h === "color");
      const notesIdx = headers.findIndex((h) => h === "notes" || h === "description");

      const validCategories = TARGET_CATEGORIES as readonly string[];
      const imported: number[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const fields = parseCsvLine(lines[i]);
          const lat = parseFloat(fields[latIdx]);
          const lon = parseFloat(fields[lonIdx]);

          if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            errors.push(`Row ${i + 1}: Invalid coordinates`);
            continue;
          }

          const label = labelIdx >= 0 ? fields[labelIdx]?.trim() || `Import ${i}` : `Import ${i}`;
          const freq = freqIdx >= 0 ? parseFloat(fields[freqIdx]) : NaN;
          const cat = catIdx >= 0 ? fields[catIdx]?.trim().toLowerCase() : "unknown";
          const color = colorIdx >= 0 && /^#[0-9a-fA-F]{6}$/.test(fields[colorIdx]?.trim()) ? fields[colorIdx].trim() : "#ff6b6b";
          const notes = notesIdx >= 0 ? fields[notesIdx]?.trim() || null : null;

          const [result] = await db.insert(tdoaTargets).values({
            label,
            lat: String(lat),
            lon: String(lon),
            frequencyKhz: !isNaN(freq) ? String(freq) : null,
            color,
            category: validCategories.includes(cat) ? cat as any : "unknown",
            notes,
            visible: true,
            createdAt: Date.now(),
          });

          imported.push(Number(result.insertId));
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      return { imported: imported.length, errors, ids: imported };
    }),

  /** Import targets from KML data */
  importKml: publicProcedure
    .input(z.object({ kmlData: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const placemarks = extractKmlPlacemarks(input.kmlData);

      if (placemarks.length === 0) {
        throw new Error("No valid Placemarks found in KML data");
      }

      const imported: number[] = [];
      const errors: string[] = [];

      for (let i = 0; i < placemarks.length; i++) {
        try {
          const pm = placemarks[i];
          const [result] = await db.insert(tdoaTargets).values({
            label: pm.name || `KML Import ${i + 1}`,
            lat: String(pm.lat),
            lon: String(pm.lon),
            frequencyKhz: null,
            color: "#06b6d4",
            category: "unknown",
            notes: pm.description || null,
            visible: true,
            createdAt: Date.now(),
          });
          imported.push(Number(result.insertId));
        } catch (err) {
          errors.push(`Placemark ${i + 1}: ${(err as Error).message}`);
        }
      }

      return { imported: imported.length, errors, ids: imported };
    }),

  /** Predict future position based on drift history */
  predict: publicProcedure
    .input(z.object({ targetId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const history = await db
        .select()
        .from(tdoaTargetHistory)
        .where(eq(tdoaTargetHistory.targetId, input.targetId))
        .orderBy(asc(tdoaTargetHistory.observedAt));

      if (history.length < 2) return null;

      const points = history.map((h) => ({
        lat: parseFloat(h.lat),
        lon: parseFloat(h.lon),
        time: h.observedAt,
      }));

      return predictPosition(points);
    }),

  /** Predict positions for all targets that have enough history */
  predictAll: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const allTargets = await db.select().from(tdoaTargets);
    const results: Array<{
      targetId: number;
      predictedLat: number;
      predictedLon: number;
      ellipseMajor: number;
      ellipseMinor: number;
      ellipseRotation: number;
      rSquaredLat: number;
      rSquaredLon: number;
      bearingDeg: number;
      velocityKmh: number;
    }> = [];
    for (const target of allTargets) {
      const history = await db
        .select()
        .from(tdoaTargetHistory)
        .where(eq(tdoaTargetHistory.targetId, target.id))
        .orderBy(asc(tdoaTargetHistory.observedAt));
      if (history.length < 2) continue;
      const points = history.map((h) => ({
        lat: parseFloat(h.lat),
        lon: parseFloat(h.lon),
        time: h.observedAt,
      }));
      const pred = predictPosition(points);
      if (pred) {
        results.push({ targetId: target.id, ...pred });
      }
    }
    return results;
  }),

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

      // Check for anomaly (async, don't block the response)
      const historyId = result.insertId;
      checkForAnomaly(input.targetId, input.lat, input.lon, historyId).catch((err) =>
        console.warn("[AnomalyDetector] Check failed:", err)
      );

      // Check for conflict zone proximity (async, don't block the response)
      checkConflictZoneProximity(input.targetId, input.lat, input.lon, historyId).catch((err) =>
        console.warn("[ConflictZoneChecker] Check failed:", err)
      );

      // Check geofence zones (async, don't block the response)
      checkGeofences(input.targetId, input.lat, input.lon, historyId).catch((err) =>
        console.warn("[GeofenceEngine] Check failed:", err)
      );

      return { id: historyId };
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

  /** Check a specific target for anomaly against its prediction model */
  checkAnomaly: publicProcedure
    .input(z.object({
      targetId: z.number(),
      lat: z.number(),
      lon: z.number(),
      historyEntryId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return await checkForAnomaly(input.targetId, input.lat, input.lon, input.historyEntryId);
    }),
});

/** Helper: escape XML special characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Helper: parse a CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Helper: extract Placemarks from KML data */
function extractKmlPlacemarks(kml: string): Array<{ name: string; description: string; lat: number; lon: number }> {
  const results: Array<{ name: string; description: string; lat: number; lon: number }> = [];
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/gi;
  let match;
  while ((match = placemarkRegex.exec(kml)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/i);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
    const coordMatch = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (coordMatch) {
      const parts = coordMatch[1].trim().split(",");
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        results.push({
          name: nameMatch?.[1]?.trim() || "",
          description: descMatch?.[1]?.trim() || "",
          lat,
          lon,
        });
      }
    }
  }
  return results;
}
