/**
 * statusPersistence.ts — Persists receiver status scan results to the database
 *
 * Called after each batch scan cycle completes (initial + auto-refresh).
 * Handles:
 * 1. Upserting receivers into the `receivers` master table
 * 2. Creating a `scan_cycles` row for the completed scan
 * 3. Inserting `receiver_status_history` rows for each receiver result
 * 4. Updating uptime percentages on the `receivers` table
 * 5. Purging old history records (>30 days)
 */

import { eq, and, gte, lt, sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  receivers,
  scanCycles,
  receiverStatusHistory,
  type InsertReceiver,
  type InsertScanCycle,
  type InsertReceiverStatusHistory,
} from "../drizzle/schema";

/* ── Configuration ────────────────────────────────── */

const HISTORY_RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // Run purge every 6 hours

let lastPurgeAt = 0;

/* ── Types ────────────────────────────────────────── */

export interface ScanResultForPersistence {
  receiverUrl: string;
  receiverType: "KiwiSDR" | "OpenWebRX" | "WebSDR";
  stationLabel: string;
  online: boolean;
  checkedAt: number;
  users?: number;
  usersMax?: number;
  snr?: number;
  name?: string;
  error?: string;
}

/* ── Normalize URL ────────────────────────────────── */

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/* ── Main Persistence Function ────────────────────── */

/**
 * Persist a completed batch scan to the database.
 * Called after each batch cycle (initial or auto-refresh) completes.
 */
export async function persistScanResults(
  results: ScanResultForPersistence[],
  cycleInfo: {
    cycleId: string;
    cycleNumber: number;
    startedAt: number;
    completedAt: number;
  }
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    console.warn("[Persistence] Database not available, skipping persistence");
    return { success: false, error: "Database not available" };
  }

  try {
    const onlineCount = results.filter((r) => r.online).length;
    const offlineCount = results.length - onlineCount;
    const durationSec = (cycleInfo.completedAt - cycleInfo.startedAt) / 1000;

    // 1. Create scan cycle record
    await db.insert(scanCycles).values({
      cycleId: cycleInfo.cycleId,
      cycleNumber: cycleInfo.cycleNumber,
      totalReceivers: results.length,
      onlineCount,
      offlineCount,
      startedAt: cycleInfo.startedAt,
      completedAt: cycleInfo.completedAt,
      durationSec,
    });

    // Get the inserted scan cycle ID
    const [scanCycleRow] = await db
      .select({ id: scanCycles.id })
      .from(scanCycles)
      .where(eq(scanCycles.cycleId, cycleInfo.cycleId))
      .limit(1);

    if (!scanCycleRow) {
      return { success: false, error: "Failed to retrieve scan cycle ID" };
    }

    const scanCycleId = scanCycleRow.id;

    // 2. Upsert receivers and insert history in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      for (const result of batch) {
        const normalizedUrl = normalizeUrl(result.receiverUrl);

        // Upsert receiver
        await db
          .insert(receivers)
          .values({
            normalizedUrl,
            originalUrl: result.receiverUrl,
            receiverType: result.receiverType,
            stationLabel: result.stationLabel,
            receiverName: result.name || null,
            lastOnline: result.online,
            lastCheckedAt: result.checkedAt,
            lastSnr: result.snr ?? null,
            lastUsers: result.users ?? null,
            lastUsersMax: result.usersMax ?? null,
            totalChecks: 1,
            onlineChecks: result.online ? 1 : 0,
          } satisfies InsertReceiver)
          .onDuplicateKeyUpdate({
            set: {
              lastOnline: result.online,
              lastCheckedAt: result.checkedAt,
              lastSnr: result.snr ?? null,
              lastUsers: result.users ?? null,
              lastUsersMax: result.usersMax ?? null,
              receiverName: result.name || undefined,
              stationLabel: result.stationLabel,
              totalChecks: sql`${receivers.totalChecks} + 1`,
              onlineChecks: result.online
                ? sql`${receivers.onlineChecks} + 1`
                : sql`${receivers.onlineChecks}`,
            },
          });

        // Get the receiver ID
        const [receiverRow] = await db
          .select({ id: receivers.id })
          .from(receivers)
          .where(eq(receivers.normalizedUrl, normalizedUrl))
          .limit(1);

        if (receiverRow) {
          // Insert history row
          await db.insert(receiverStatusHistory).values({
            receiverId: receiverRow.id,
            scanCycleId,
            online: result.online,
            users: result.users ?? null,
            usersMax: result.usersMax ?? null,
            snr: result.snr ?? null,
            checkedAt: result.checkedAt,
            error: result.error ?? null,
          } satisfies InsertReceiverStatusHistory);
        }
      }
    }

    // 3. Update uptime percentages (async, non-blocking)
    updateUptimePercentages(db).catch((err) => {
      console.warn("[Persistence] Failed to update uptime percentages:", err.message);
    });

    // 4. Purge old records if needed
    maybePurgeOldRecords(db).catch((err) => {
      console.warn("[Persistence] Failed to purge old records:", err.message);
    });

    console.log(
      `[Persistence] Saved cycle #${cycleInfo.cycleNumber} — ` +
        `${results.length} receivers (${onlineCount} online, ${offlineCount} offline) ` +
        `in ${durationSec.toFixed(1)}s`
    );

    return { success: true };
  } catch (err: any) {
    console.error("[Persistence] Failed to persist scan results:", err.message);
    return { success: false, error: err.message };
  }
}

/* ── Uptime Percentage Calculation ────────────────── */

async function updateUptimePercentages(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Get all receiver IDs
  const allReceivers = await db.select({ id: receivers.id }).from(receivers);

  for (const receiver of allReceivers) {
    // 24h uptime
    const history24h = await db
      .select({
        total: sql<number>`COUNT(*)`,
        online: sql<number>`SUM(CASE WHEN ${receiverStatusHistory.online} = true THEN 1 ELSE 0 END)`,
      })
      .from(receiverStatusHistory)
      .where(
        and(
          eq(receiverStatusHistory.receiverId, receiver.id),
          gte(receiverStatusHistory.checkedAt, oneDayAgo)
        )
      );

    // 7d uptime
    const history7d = await db
      .select({
        total: sql<number>`COUNT(*)`,
        online: sql<number>`SUM(CASE WHEN ${receiverStatusHistory.online} = true THEN 1 ELSE 0 END)`,
      })
      .from(receiverStatusHistory)
      .where(
        and(
          eq(receiverStatusHistory.receiverId, receiver.id),
          gte(receiverStatusHistory.checkedAt, sevenDaysAgo)
        )
      );

    const uptime24h =
      history24h[0]?.total > 0
        ? (Number(history24h[0].online) / Number(history24h[0].total)) * 100
        : null;

    const uptime7d =
      history7d[0]?.total > 0
        ? (Number(history7d[0].online) / Number(history7d[0].total)) * 100
        : null;

    await db
      .update(receivers)
      .set({
        uptime24h: uptime24h,
        uptime7d: uptime7d,
      })
      .where(eq(receivers.id, receiver.id));
  }
}

/* ── Old Record Purge ─────────────────────────────── */

async function maybePurgeOldRecords(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;

  lastPurgeAt = now;
  const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const result = await db
    .delete(receiverStatusHistory)
    .where(lt(receiverStatusHistory.checkedAt, cutoff));

  console.log(`[Persistence] Purged history records older than ${HISTORY_RETENTION_DAYS} days`);

  // Also purge old scan cycles
  await db.delete(scanCycles).where(lt(scanCycles.startedAt, cutoff));
}

/* ── Query Helpers ────────────────────────────────── */

/**
 * Get all receivers with their latest status and uptime percentages.
 */
export async function getAllReceiverStatuses(): Promise<
  {
    normalizedUrl: string;
    originalUrl: string;
    receiverType: string;
    stationLabel: string;
    receiverName: string | null;
    lastOnline: boolean;
    lastCheckedAt: number | null;
    lastSnr: number | null;
    lastUsers: number | null;
    lastUsersMax: number | null;
    uptime24h: number | null;
    uptime7d: number | null;
    totalChecks: number;
    onlineChecks: number;
  }[]
> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      normalizedUrl: receivers.normalizedUrl,
      originalUrl: receivers.originalUrl,
      receiverType: receivers.receiverType,
      stationLabel: receivers.stationLabel,
      receiverName: receivers.receiverName,
      lastOnline: receivers.lastOnline,
      lastCheckedAt: receivers.lastCheckedAt,
      lastSnr: receivers.lastSnr,
      lastUsers: receivers.lastUsers,
      lastUsersMax: receivers.lastUsersMax,
      uptime24h: receivers.uptime24h,
      uptime7d: receivers.uptime7d,
      totalChecks: receivers.totalChecks,
      onlineChecks: receivers.onlineChecks,
    })
    .from(receivers);
}

/**
 * Get status history for a specific receiver over a time range.
 * Used for rendering uptime trend charts.
 */
export async function getReceiverHistory(
  receiverUrl: string,
  hoursBack: number = 24
): Promise<
  {
    online: boolean;
    users: number | null;
    snr: number | null;
    checkedAt: number;
    error: string | null;
  }[]
> {
  const db = await getDb();
  if (!db) return [];

  const normalizedUrl = normalizeUrl(receiverUrl);
  const sinceMs = Date.now() - hoursBack * 60 * 60 * 1000;

  // Find the receiver ID
  const [receiverRow] = await db
    .select({ id: receivers.id })
    .from(receivers)
    .where(eq(receivers.normalizedUrl, normalizedUrl))
    .limit(1);

  if (!receiverRow) return [];

  return db
    .select({
      online: receiverStatusHistory.online,
      users: receiverStatusHistory.users,
      snr: receiverStatusHistory.snr,
      checkedAt: receiverStatusHistory.checkedAt,
      error: receiverStatusHistory.error,
    })
    .from(receiverStatusHistory)
    .where(
      and(
        eq(receiverStatusHistory.receiverId, receiverRow.id),
        gte(receiverStatusHistory.checkedAt, sinceMs)
      )
    )
    .orderBy(receiverStatusHistory.checkedAt);
}

/**
 * Get recent scan cycle summaries.
 */
export async function getRecentScanCycles(limit: number = 48): Promise<
  {
    cycleId: string;
    cycleNumber: number;
    totalReceivers: number;
    onlineCount: number;
    offlineCount: number;
    startedAt: number;
    completedAt: number | null;
    durationSec: number | null;
  }[]
> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      cycleId: scanCycles.cycleId,
      cycleNumber: scanCycles.cycleNumber,
      totalReceivers: scanCycles.totalReceivers,
      onlineCount: scanCycles.onlineCount,
      offlineCount: scanCycles.offlineCount,
      startedAt: scanCycles.startedAt,
      completedAt: scanCycles.completedAt,
      durationSec: scanCycles.durationSec,
    })
    .from(scanCycles)
    .orderBy(desc(scanCycles.startedAt))
    .limit(limit);
}

/**
 * Get aggregate stats across all receivers.
 */
export async function getAggregateStats(): Promise<{
  totalReceivers: number;
  onlineNow: number;
  offlineNow: number;
  avgUptime24h: number | null;
  avgUptime7d: number | null;
  totalScans: number;
  byType: { type: string; total: number; online: number }[];
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalReceivers: 0,
      onlineNow: 0,
      offlineNow: 0,
      avgUptime24h: null,
      avgUptime7d: null,
      totalScans: 0,
      byType: [],
    };
  }

  const [totals] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      online: sql<number>`SUM(CASE WHEN ${receivers.lastOnline} = true THEN 1 ELSE 0 END)`,
      avgUptime24h: sql<number>`AVG(${receivers.uptime24h})`,
      avgUptime7d: sql<number>`AVG(${receivers.uptime7d})`,
    })
    .from(receivers);

  const [scanCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(scanCycles);

  const byType = await db
    .select({
      type: receivers.receiverType,
      total: sql<number>`COUNT(*)`,
      online: sql<number>`SUM(CASE WHEN ${receivers.lastOnline} = true THEN 1 ELSE 0 END)`,
    })
    .from(receivers)
    .groupBy(receivers.receiverType);

  return {
    totalReceivers: Number(totals?.total ?? 0),
    onlineNow: Number(totals?.online ?? 0),
    offlineNow: Number(totals?.total ?? 0) - Number(totals?.online ?? 0),
    avgUptime24h: totals?.avgUptime24h ? Number(totals.avgUptime24h) : null,
    avgUptime7d: totals?.avgUptime7d ? Number(totals.avgUptime7d) : null,
    totalScans: Number(scanCount?.count ?? 0),
    byType: byType.map((row) => ({
      type: row.type,
      total: Number(row.total),
      online: Number(row.online),
    })),
  };
}
