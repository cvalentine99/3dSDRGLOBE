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
import { classifySignal, type ClassificationInput } from "./signalClassifier";
import { predictPosition, type PredictionResult } from "./positionPredictor";

/* ── Helper functions for CSV/KML import/export ── */

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

interface KmlPlacemark {
  name: string;
  description: string | null;
  lat: number;
  lon: number;
}

function extractKmlPlacemarks(kml: string): KmlPlacemark[] {
  const placemarks: KmlPlacemark[] = [];
  const pmRegex = /<Placemark[\s\S]*?<\/Placemark>/gi;
  let match;

  while ((match = pmRegex.exec(kml)) !== null) {
    const pm = match[0];

    // Extract name
    const nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
    const name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";

    // Extract description
    const descMatch = pm.match(/<description>([\s\S]*?)<\/description>/i);
    const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;

    // Extract coordinates from Point
    const coordMatch = pm.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
    if (!coordMatch) continue;

    const coordStr = coordMatch[1].trim();
    const parts = coordStr.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;

    const lon = parts[0];
    const lat = parts[1];

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    placemarks.push({ name, description, lat, lon });
  }

  return placemarks;
}

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
    /** Classify a signal using LLM analysis */
    classify: publicProcedure
      .input(
        z.object({
          frequencyKhz: z.number().nullable(),
          mode: z.string().nullable().optional(),
          lat: z.number(),
          lon: z.number(),
          label: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          hostCount: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return await classifySignal(input as ClassificationInput);
      }),

    /** Export all targets as CSV */
    exportCsv: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { csv: "" };
      const targets = await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt));
      const history = await db.select().from(tdoaTargetHistory).orderBy(asc(tdoaTargetHistory.observedAt));

      // Build CSV header
      const lines: string[] = [
        "id,label,latitude,longitude,frequency_khz,color,category,notes,visible,created_at,history_count",
      ];

      for (const t of targets) {
        const histCount = history.filter((h) => h.targetId === t.id).length;
        const row = [
          t.id,
          `"${(t.label || "").replace(/"/g, '""')}"`,
          t.lat,
          t.lon,
          t.frequencyKhz || "",
          t.color,
          t.category,
          `"${(t.notes || "").replace(/"/g, '""')}"`,
          t.visible ? "true" : "false",
          t.createdAt,
          histCount,
        ].join(",");
        lines.push(row);
      }

      return { csv: lines.join("\n") };
    }),

    /** Export all targets as KML for Google Earth */
    exportKml: publicProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { kml: "" };
      const targets = await db.select().from(tdoaTargets).orderBy(desc(tdoaTargets.createdAt));
      const history = await db.select().from(tdoaTargetHistory).orderBy(asc(tdoaTargetHistory.observedAt));

      const categoryStyles: Record<string, { icon: string; color: string }> = {
        time_signal: { icon: "http://maps.google.com/mapfiles/kml/shapes/clock.png", color: "ff00ffff" },
        broadcast: { icon: "http://maps.google.com/mapfiles/kml/shapes/radio.png", color: "ff00ff00" },
        utility: { icon: "http://maps.google.com/mapfiles/kml/shapes/info.png", color: "ff0080ff" },
        military: { icon: "http://maps.google.com/mapfiles/kml/shapes/target.png", color: "ff0000ff" },
        amateur: { icon: "http://maps.google.com/mapfiles/kml/shapes/homegardenbusiness.png", color: "ffff8800" },
        unknown: { icon: "http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png", color: "ff888888" },
        custom: { icon: "http://maps.google.com/mapfiles/kml/shapes/star.png", color: "ffff00ff" },
      };

      let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
      kml += `<Document>\n`;
      kml += `  <name>Radio Globe — TDoA Targets</name>\n`;
      kml += `  <description>Exported TDoA target positions from Valentine RF SigINT</description>\n\n`;

      // Style definitions
      for (const [cat, style] of Object.entries(categoryStyles)) {
        kml += `  <Style id="style-${cat}">\n`;
        kml += `    <IconStyle><color>${style.color}</color><scale>1.2</scale>\n`;
        kml += `      <Icon><href>${style.icon}</href></Icon>\n`;
        kml += `    </IconStyle>\n`;
        kml += `  </Style>\n`;
      }

      // Folder for targets
      kml += `\n  <Folder>\n    <name>Targets</name>\n`;

      for (const t of targets) {
        const cat = t.category || "unknown";
        const freq = t.frequencyKhz ? `${t.frequencyKhz} kHz` : "Unknown freq";
        kml += `    <Placemark>\n`;
        kml += `      <name>${escapeXml(t.label)}</name>\n`;
        kml += `      <description><![CDATA[`;
        kml += `Category: ${cat}\nFrequency: ${freq}`;
        if (t.notes) kml += `\nNotes: ${t.notes}`;
        kml += `]]></description>\n`;
        kml += `      <styleUrl>#style-${cat}</styleUrl>\n`;
        kml += `      <Point><coordinates>${t.lon},${t.lat},0</coordinates></Point>\n`;
        kml += `    </Placemark>\n`;
      }

      kml += `  </Folder>\n`;

      // Folder for drift trails
      const targetHistoryMap = new Map<number, typeof history>();
      for (const h of history) {
        if (!targetHistoryMap.has(h.targetId)) targetHistoryMap.set(h.targetId, []);
        targetHistoryMap.get(h.targetId)!.push(h);
      }

      const targetsWithHistory = targets.filter(
        (t) => (targetHistoryMap.get(t.id)?.length || 0) >= 2
      );

      if (targetsWithHistory.length > 0) {
        kml += `\n  <Folder>\n    <name>Drift Trails</name>\n`;
        for (const t of targetsWithHistory) {
          const hist = targetHistoryMap.get(t.id) || [];
          const coords = hist.map((h) => `${h.lon},${h.lat},0`).join(" ");
          kml += `    <Placemark>\n`;
          kml += `      <name>${escapeXml(t.label)} — Drift Trail</name>\n`;
          kml += `      <Style><LineStyle><color>ff${t.color.slice(5, 7)}${t.color.slice(3, 5)}${t.color.slice(1, 3)}</color><width>2</width></LineStyle></Style>\n`;
          kml += `      <LineString><coordinates>${coords}</coordinates></LineString>\n`;
          kml += `    </Placemark>\n`;
        }
        kml += `  </Folder>\n`;
      }

      kml += `</Document>\n</kml>`;

      return { kml };
    }),

    /** Import targets from CSV data */
    importCsv: publicProcedure
      .input(z.object({ csvData: z.string() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const lines = input.csvData.trim().split("\n");
        if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row");

        // Parse header
        const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
        const latIdx = header.findIndex((h) => h === "latitude" || h === "lat");
        const lonIdx = header.findIndex((h) => h === "longitude" || h === "lon" || h === "lng");
        const labelIdx = header.findIndex((h) => h === "label" || h === "name");
        const freqIdx = header.findIndex((h) => h.includes("freq"));
        const catIdx = header.findIndex((h) => h === "category" || h === "cat" || h === "type");
        const colorIdx = header.findIndex((h) => h === "color");
        const notesIdx = header.findIndex((h) => h === "notes" || h === "description");

        if (latIdx === -1 || lonIdx === -1) {
          throw new Error("CSV must contain 'latitude' and 'longitude' columns");
        }

        const validCategories = ["time_signal", "broadcast", "utility", "military", "amateur", "unknown", "custom"];
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

        // Simple KML parser — extract Placemarks with coordinates
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
