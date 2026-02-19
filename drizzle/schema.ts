import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  float,
  bigint,
  index,
  decimal,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Master list of known receivers.
 * Deduplicated by normalizedUrl (URL with trailing slash stripped).
 * Stores the latest status summary for quick lookups.
 */
export const receivers = mysqlTable(
  "receivers",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Normalized URL (trailing slash stripped) — unique key for dedup */
    normalizedUrl: varchar("normalizedUrl", { length: 512 }).notNull().unique(),
    /** Original URL as provided by the station data */
    originalUrl: varchar("originalUrl", { length: 512 }).notNull(),
    /** Receiver type: KiwiSDR, OpenWebRX, WebSDR */
    receiverType: mysqlEnum("receiverType", ["KiwiSDR", "OpenWebRX", "WebSDR"]).notNull(),
    /** Station label from the station data */
    stationLabel: varchar("stationLabel", { length: 256 }).notNull(),
    /** Receiver name (from /status or /status.json) */
    receiverName: text("receiverName"),
    /** Latest known online status */
    lastOnline: boolean("lastOnline").default(false).notNull(),
    /** Timestamp of the last status check (Unix ms) */
    lastCheckedAt: bigint("lastCheckedAt", { mode: "number" }),
    /** Latest SNR (KiwiSDR only) */
    lastSnr: float("lastSnr"),
    /** Latest user count */
    lastUsers: int("lastUsers"),
    /** Max user slots */
    lastUsersMax: int("lastUsersMax"),
    /** Uptime percentage over the last 24 hours (0-100) */
    uptime24h: float("uptime24h"),
    /** Uptime percentage over the last 7 days (0-100) */
    uptime7d: float("uptime7d"),
    /** Total number of checks recorded */
    totalChecks: int("totalChecks").default(0).notNull(),
    /** Total number of online checks recorded */
    onlineChecks: int("onlineChecks").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("idx_receivers_type").on(table.receiverType),
    index("idx_receivers_lastOnline").on(table.lastOnline),
  ]
);

export type Receiver = typeof receivers.$inferSelect;
export type InsertReceiver = typeof receivers.$inferInsert;

/**
 * Scan cycles — one row per completed batch scan.
 * Provides a high-level overview of each scan run.
 */
export const scanCycles = mysqlTable("scan_cycles", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique cycle identifier (e.g. "batch-1708123456789") */
  cycleId: varchar("cycleId", { length: 64 }).notNull(),
  /** Auto-refresh cycle number (0 = initial scan) */
  cycleNumber: int("cycleNumber").default(0).notNull(),
  /** Total receivers scanned */
  totalReceivers: int("totalReceivers").default(0).notNull(),
  /** Number of receivers found online */
  onlineCount: int("onlineCount").default(0).notNull(),
  /** Number of receivers found offline */
  offlineCount: int("offlineCount").default(0).notNull(),
  /** Scan start time (Unix ms) */
  startedAt: bigint("startedAt", { mode: "number" }).notNull(),
  /** Scan completion time (Unix ms) */
  completedAt: bigint("completedAt", { mode: "number" }),
  /** Duration in seconds */
  durationSec: float("durationSec"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScanCycle = typeof scanCycles.$inferSelect;
export type InsertScanCycle = typeof scanCycles.$inferInsert;

/**
 * Receiver status history — one row per receiver per scan cycle.
 * This is the time-series data for uptime trend tracking.
 *
 * At ~1,500 receivers per 30-min cycle = ~72,000 rows/day.
 * Records older than 30 days should be purged periodically.
 */
export const receiverStatusHistory = mysqlTable(
  "receiver_status_history",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to receivers.id */
    receiverId: int("receiverId").notNull(),
    /** FK to scan_cycles.id */
    scanCycleId: int("scanCycleId").notNull(),
    /** Was the receiver online? */
    online: boolean("online").default(false).notNull(),
    /** User count at time of check */
    users: int("users"),
    /** Max user slots at time of check */
    usersMax: int("usersMax"),
    /** SNR at time of check (KiwiSDR only) */
    snr: float("snr"),
    /** Timestamp of the check (Unix ms) */
    checkedAt: bigint("checkedAt", { mode: "number" }).notNull(),
    /** Error message if check failed */
    error: varchar("error", { length: 512 }),
  },
  (table) => [
    index("idx_history_receiver_checked").on(table.receiverId, table.checkedAt),
    index("idx_history_scanCycle").on(table.scanCycleId),
    index("idx_history_checkedAt").on(table.checkedAt),
  ]
);

export type ReceiverStatusHistoryRow = typeof receiverStatusHistory.$inferSelect;
export type InsertReceiverStatusHistory = typeof receiverStatusHistory.$inferInsert;

/**
 * TDoA (Time Difference of Arrival) triangulation jobs.
 * Each row represents a single TDoA computation submitted to tdoa.kiwisdr.com.
 * Stores the selected hosts, frequency, results, and heatmap data.
 */
export const tdoaJobs = mysqlTable(
  "tdoa_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Center frequency in kHz */
    frequencyKhz: decimal("frequencyKhz", { precision: 10, scale: 2 }).notNull(),
    /** Passband width in Hz */
    passbandHz: int("passbandHz").notNull(),
    /** IQ sample duration in seconds (15, 30, 45, or 60) */
    sampleTime: int("sampleTime").default(30).notNull(),
    /** Selected GPS-active KiwiSDR hosts [{h, p, id, lat, lon}] */
    hosts: json("hosts").notNull(),
    /** Optional known reference location {lat, lon, name} */
    knownLocation: json("knownLocation"),
    /** Map bounds for result rendering {north, south, east, west} */
    mapBounds: json("mapBounds").notNull(),
    /** Server-assigned job key from tdoa.kiwisdr.com */
    tdoaKey: varchar("tdoaKey", { length: 32 }),
    /** Job lifecycle status */
    status: mysqlEnum("status", [
      "pending",
      "sampling",
      "computing",
      "complete",
      "error",
    ]).default("pending").notNull(),
    /** Estimated transmitter latitude */
    likelyLat: decimal("likelyLat", { precision: 10, scale: 6 }),
    /** Estimated transmitter longitude */
    likelyLon: decimal("likelyLon", { precision: 10, scale: 6 }),
    /** Full status.json response from TDoA server */
    resultData: json("resultData"),
    /** Contour polygons for rendering on globe */
    contourData: json("contourData"),
    /** Error message if job failed */
    errorMessage: text("errorMessage"),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    completedAt: bigint("completedAt", { mode: "number" }),
  },
  (table) => [
    index("idx_tdoa_status").on(table.status),
    index("idx_tdoa_createdAt").on(table.createdAt),
  ]
);

export type TdoaJob = typeof tdoaJobs.$inferSelect;
export type InsertTdoaJob = typeof tdoaJobs.$inferInsert;
