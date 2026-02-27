/**
 * testDbCleaner.ts — Automatic database cleanup for tests
 *
 * Prevents test data from leaking into the production database by:
 * 1. Snapshotting max IDs before each test suite runs
 * 2. Deleting any rows with IDs above the snapshot after each suite
 *
 * Usage in test files:
 *   import { dbCleaner } from "./testDbCleaner";
 *   beforeAll(() => dbCleaner.snapshot());
 *   afterAll(() => dbCleaner.cleanup());
 *
 * The global setup/teardown in vitest also calls these as a safety net.
 */

import { sql } from "drizzle-orm";
import { getDb } from "./db";

/**
 * Tables ordered by foreign key dependencies (children first).
 * When cleaning up, we delete from child tables before parent tables
 * to avoid FK constraint violations.
 */
const CLEANUP_TABLES = [
  // Leaf tables (no children reference them)
  "geofence_alerts",
  "signal_fingerprints",
  "shared_list_targets",
  "shared_list_members",
  "conflict_sweep_history",
  "briefings",
  "saved_queries",
  "chat_messages",
  // Mid-level tables
  "anomaly_alerts",
  "tdoa_target_history",
  "tdoa_recordings",
  "shared_target_lists",
  "geofence_zones",
  // Parent tables
  "tdoa_targets",
  "tdoa_jobs",
  // Don't clean these — they hold real operational data:
  // "receivers", "receiver_status_history", "scan_cycles", "users"
] as const;

type TableName = (typeof CLEANUP_TABLES)[number];

interface Snapshot {
  maxIds: Map<TableName, number>;
  timestamp: number;
}

class TestDbCleaner {
  private snapshot_: Snapshot | null = null;
  private static instance: TestDbCleaner | null = null;

  static getInstance(): TestDbCleaner {
    if (!TestDbCleaner.instance) {
      TestDbCleaner.instance = new TestDbCleaner();
    }
    return TestDbCleaner.instance;
  }

  /**
   * Take a snapshot of the current max ID for each table.
   * Any rows with IDs above these values after tests run will be deleted.
   */
  async snapshot(): Promise<void> {
    const db = await getDb();
    if (!db) {
      console.warn("[TestDbCleaner] No database connection — skipping snapshot");
      return;
    }

    const maxIds = new Map<TableName, number>();

    for (const table of CLEANUP_TABLES) {
      try {
        const result = await db.execute(
          sql.raw(`SELECT COALESCE(MAX(id), 0) as maxId FROM \`${table}\``)
        );
        const rows = result[0] as unknown as Array<{ maxId: number }>;
        const maxId = Number(rows[0]?.maxId ?? 0);
        maxIds.set(table, maxId);
      } catch {
        // Table might not exist yet — that's fine, set to 0
        maxIds.set(table, 0);
      }
    }

    this.snapshot_ = {
      maxIds,
      timestamp: Date.now(),
    };
  }

  /**
   * Delete any rows created after the snapshot was taken.
   * Uses DELETE WHERE id > snapshotMaxId for each table.
   */
  async cleanup(): Promise<{ deleted: Record<string, number>; errors: string[] }> {
    const result: { deleted: Record<string, number>; errors: string[] } = {
      deleted: {},
      errors: [],
    };

    if (!this.snapshot_) {
      console.warn("[TestDbCleaner] No snapshot taken — skipping cleanup");
      return result;
    }

    const db = await getDb();
    if (!db) {
      console.warn("[TestDbCleaner] No database connection — skipping cleanup");
      return result;
    }

    // Delete in dependency order (children first)
    for (const table of CLEANUP_TABLES) {
      const maxId = this.snapshot_.maxIds.get(table) ?? 0;
      try {
        const deleteResult = await db.execute(
          sql.raw(`DELETE FROM \`${table}\` WHERE id > ${maxId}`)
        );
        const affectedRows = (deleteResult[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
        if (affectedRows > 0) {
          result.deleted[table] = affectedRows;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Ignore "table doesn't exist" errors
        if (!msg.includes("doesn't exist")) {
          result.errors.push(`${table}: ${msg}`);
        }
      }
    }

    const totalDeleted = Object.values(result.deleted).reduce((a, b) => a + b, 0);
    if (totalDeleted > 0) {
      console.log(
        `[TestDbCleaner] Cleaned up ${totalDeleted} test rows:`,
        JSON.stringify(result.deleted)
      );
    }

    if (result.errors.length > 0) {
      console.warn("[TestDbCleaner] Cleanup errors:", result.errors);
    }

    // Reset snapshot
    this.snapshot_ = null;

    return result;
  }

  /**
   * Check if a snapshot has been taken.
   */
  hasSnapshot(): boolean {
    return this.snapshot_ !== null;
  }

  /**
   * Get the snapshot timestamp for debugging.
   */
  getSnapshotTimestamp(): number | null {
    return this.snapshot_?.timestamp ?? null;
  }
}

/** Singleton instance for use across test files */
export const dbCleaner = TestDbCleaner.getInstance();
