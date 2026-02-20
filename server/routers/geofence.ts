/**
 * geofence.ts — tRPC router for geofence zone management.
 *
 * Provides CRUD endpoints for custom geofence zones and
 * endpoints for checking targets against zones.
 */

import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { geofenceZones, geofenceAlerts } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import {
  pointInPolygon,
  distanceToPolygonKm,
  polygonCentroid,
  polygonAreaKm2,
  checkGeofences,
  checkAllTargetsGeofences,
  invalidateZoneCache,
  type PolygonVertex,
} from "../geofenceEngine";

const polygonVertexSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const geofenceRouter = router({
  /** List all geofence zones */
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return await db
      .select()
      .from(geofenceZones)
      .orderBy(desc(geofenceZones.createdAt));
  }),

  /** Get a single geofence zone by ID */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(geofenceZones)
        .where(eq(geofenceZones.id, input.id))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** Create a new geofence zone */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        zoneType: z.enum(["exclusion", "inclusion"]).default("exclusion"),
        polygon: z.array(polygonVertexSchema).min(3),
        color: z.string().max(9).default("#ff000066"),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const now = Date.now();
      const [inserted] = await db.insert(geofenceZones).values({
        name: input.name,
        zoneType: input.zoneType,
        polygon: input.polygon,
        color: input.color,
        description: input.description ?? null,
        enabled: true,
        visible: true,
        createdAt: now,
        updatedAt: now,
      });

      invalidateZoneCache();

      // Compute zone stats
      const centroid = polygonCentroid(input.polygon);
      const area = polygonAreaKm2(input.polygon);

      return {
        id: inserted.insertId,
        centroid,
        areaKm2: area,
      };
    }),

  /** Update a geofence zone */
  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(256).optional(),
        zoneType: z.enum(["exclusion", "inclusion"]).optional(),
        polygon: z.array(polygonVertexSchema).min(3).optional(),
        color: z.string().max(9).optional(),
        description: z.string().max(1000).optional(),
        enabled: z.boolean().optional(),
        visible: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, ...updates } = input;
      const setValues: Record<string, unknown> = { updatedAt: Date.now() };

      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.zoneType !== undefined) setValues.zoneType = updates.zoneType;
      if (updates.polygon !== undefined) setValues.polygon = updates.polygon;
      if (updates.color !== undefined) setValues.color = updates.color;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
      if (updates.visible !== undefined) setValues.visible = updates.visible;

      await db
        .update(geofenceZones)
        .set(setValues)
        .where(eq(geofenceZones.id, id));

      invalidateZoneCache();

      return { success: true };
    }),

  /** Delete a geofence zone */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Delete associated geofence alerts first
      await db.delete(geofenceAlerts).where(eq(geofenceAlerts.zoneId, input.id));
      await db.delete(geofenceZones).where(eq(geofenceZones.id, input.id));

      invalidateZoneCache();

      return { success: true };
    }),

  /** Check if a point is inside a specific zone */
  checkPoint: publicProcedure
    .input(
      z.object({
        lat: z.number(),
        lon: z.number(),
        zoneId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { inside: false, distanceKm: Infinity };

      const rows = await db
        .select()
        .from(geofenceZones)
        .where(eq(geofenceZones.id, input.zoneId))
        .limit(1);

      if (!rows[0]) return { inside: false, distanceKm: Infinity };

      const polygon = rows[0].polygon as PolygonVertex[];
      const inside = pointInPolygon(input.lat, input.lon, polygon);
      const distanceKm = distanceToPolygonKm(input.lat, input.lon, polygon);

      return { inside, distanceKm };
    }),

  /** Check a target against all active geofence zones */
  checkTarget: publicProcedure
    .input(
      z.object({
        targetId: z.number(),
        lat: z.number(),
        lon: z.number(),
        historyEntryId: z.number().default(0),
      })
    )
    .mutation(async ({ input }) => {
      return await checkGeofences(
        input.targetId,
        input.lat,
        input.lon,
        input.historyEntryId
      );
    }),

  /** Check ALL visible targets against all geofence zones */
  checkAllTargets: publicProcedure.mutation(async () => {
    return await checkAllTargetsGeofences();
  }),

  /** Get geofence alert history */
  alertHistory: publicProcedure
    .input(
      z
        .object({
          zoneId: z.number().optional(),
          targetId: z.number().optional(),
          limit: z.number().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      let query = db
        .select()
        .from(geofenceAlerts)
        .orderBy(desc(geofenceAlerts.createdAt))
        .limit(input?.limit ?? 50);

      return await query;
    }),
});
