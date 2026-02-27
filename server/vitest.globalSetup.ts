/**
 * vitest.globalSetup.ts — Global setup/teardown for vitest
 *
 * This file is referenced in vitest.config.ts and runs once before
 * all test suites start and once after all test suites finish.
 *
 * It provides a safety net: even if individual test files forget to
 * clean up their database records, this global teardown will catch
 * any leaked rows by comparing against the pre-test snapshot.
 */

import { dbCleaner } from "./testDbCleaner";

/**
 * Called once before all test files run.
 * Takes a snapshot of current max IDs in all tracked tables.
 */
export async function setup(): Promise<void> {
  console.log("[GlobalSetup] Taking pre-test database snapshot...");
  await dbCleaner.snapshot();
  const ts = dbCleaner.getSnapshotTimestamp();
  console.log(`[GlobalSetup] Snapshot taken at ${ts ? new Date(ts).toISOString() : "N/A"}`);
}

/**
 * Called once after all test files have finished.
 * Deletes any rows created during the test run.
 */
export async function teardown(): Promise<void> {
  console.log("[GlobalTeardown] Running database cleanup...");
  const result = await dbCleaner.cleanup();

  const totalDeleted = Object.values(result.deleted).reduce((a, b) => a + b, 0);
  if (totalDeleted > 0) {
    console.log(`[GlobalTeardown] Removed ${totalDeleted} leaked test rows`);
    console.log("[GlobalTeardown] Breakdown:", JSON.stringify(result.deleted, null, 2));
  } else {
    console.log("[GlobalTeardown] No leaked test data found — database is clean");
  }

  if (result.errors.length > 0) {
    console.warn("[GlobalTeardown] Errors during cleanup:", result.errors);
  }
}
