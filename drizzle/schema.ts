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
    /** TDoA server job key for heatmap URL reconstruction */
    heatmapKey: varchar("heatmapKey", { length: 64 }),
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

/**
 * Saved TDoA target positions for multi-target tracking overlay.
 * Each target represents a triangulated position from a completed TDoA job.
 */
/**
 * Target category enum values for grouping/filtering.
 */
export const TARGET_CATEGORIES = [
  "time_signal",
  "broadcast",
  "utility",
  "military",
  "amateur",
  "unknown",
  "custom",
] as const;

export const tdoaTargets = mysqlTable(
  "tdoa_targets",
  {
    id: int("id").autoincrement().primaryKey(),
    /** User-assigned label for the target */
    label: varchar("label", { length: 256 }).notNull(),
    /** Estimated latitude */
    lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
    /** Estimated longitude */
    lon: decimal("lon", { precision: 10, scale: 6 }).notNull(),
    /** Frequency in kHz used for the TDoA run */
    frequencyKhz: decimal("frequencyKhz", { precision: 10, scale: 2 }),
    /** Color for the marker on the globe (hex) */
    color: varchar("color", { length: 7 }).default("#ff6b6b").notNull(),
    /** Target category for grouping and filtering */
    category: mysqlEnum("category", [
      "time_signal",
      "broadcast",
      "utility",
      "military",
      "amateur",
      "unknown",
      "custom",
    ]).default("unknown").notNull(),
    /** Optional notes */
    notes: text("notes"),
    /** Reference to the source TDoA job ID (tdoa_jobs.id) */
    sourceJobId: int("sourceJobId"),
    /** Whether this target is visible on the globe */
    visible: boolean("visible").default(true).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_targets_createdAt").on(table.createdAt),
    index("idx_targets_category").on(table.category),
  ]
);

export type TdoaTarget = typeof tdoaTargets.$inferSelect;
export type InsertTdoaTarget = typeof tdoaTargets.$inferInsert;

/**
 * Position history for TDoA targets — tracks how estimated position
 * changes across multiple TDoA runs over time.
 * Each row is one position observation linked to a target and a job.
 */
export const tdoaTargetHistory = mysqlTable(
  "tdoa_target_history",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to tdoa_targets.id */
    targetId: int("targetId").notNull(),
    /** FK to tdoa_jobs.id that produced this observation */
    jobId: int("jobId").notNull(),
    /** Observed latitude */
    lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
    /** Observed longitude */
    lon: decimal("lon", { precision: 10, scale: 6 }).notNull(),
    /** Frequency in kHz at time of observation */
    frequencyKhz: decimal("frequencyKhz", { precision: 10, scale: 2 }),
    /** Number of hosts used in the TDoA run */
    hostCount: int("hostCount"),
    /** Optional notes about this observation */
    notes: text("notes"),
    /** Timestamp of observation (Unix ms) */
    observedAt: bigint("observedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_target_history_targetId").on(table.targetId),
    index("idx_target_history_observedAt").on(table.observedAt),
  ]
);

export type TdoaTargetHistory = typeof tdoaTargetHistory.$inferSelect;
export type InsertTdoaTargetHistory = typeof tdoaTargetHistory.$inferInsert;

/**
 * Audio recordings captured from KiwiSDR hosts during TDoA jobs.
 * Each recording is a short audio clip (10-30s) from a single host.
 */
export const tdoaRecordings = mysqlTable(
  "tdoa_recordings",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to tdoa_jobs.id */
    jobId: int("jobId").notNull(),
    /** KiwiSDR host identifier (e.g. "kiwisdr.example.com:8073") */
    hostId: varchar("hostId", { length: 256 }).notNull(),
    /** Frequency in kHz at time of recording */
    frequencyKhz: decimal("frequencyKhz", { precision: 10, scale: 2 }).notNull(),
    /** Modulation mode (am, usb, lsb, cw) */
    mode: varchar("mode", { length: 8 }).default("am").notNull(),
    /** Duration of the recording in seconds */
    durationSec: int("durationSec").notNull(),
    /** S3 file key for the WAV file */
    fileKey: varchar("fileKey", { length: 512 }).notNull(),
    /** Public URL to the WAV file in S3 */
    fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
    /** File size in bytes */
    fileSizeBytes: int("fileSizeBytes"),
    /** Recording status */
    status: mysqlEnum("status", ["recording", "uploading", "ready", "error"]).default("recording").notNull(),
    /** Error message if recording failed */
    errorMessage: text("errorMessage"),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_recordings_jobId").on(table.jobId),
    index("idx_recordings_hostId").on(table.hostId),
  ]
);

export type TdoaRecording = typeof tdoaRecordings.$inferSelect;
export type InsertTdoaRecording = typeof tdoaRecordings.$inferInsert;

/**
 * Anomaly alerts — flagged when a target's latest position deviates
 * significantly from the prediction model (outside confidence ellipse).
 */
export const anomalyAlerts = mysqlTable(
  "anomaly_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to tdoa_targets.id */
    targetId: int("targetId").notNull(),
    /** FK to tdoa_target_history.id that triggered the alert */
    historyEntryId: int("historyEntryId").notNull(),
    /** Severity: low (1-2σ), medium (2-3σ), high (>3σ) */
    severity: mysqlEnum("severity", ["low", "medium", "high"]).default("medium").notNull(),
    /** Deviation distance in km from predicted position */
    deviationKm: float("deviationKm").notNull(),
    /** How many sigma the deviation represents */
    deviationSigma: float("deviationSigma").notNull(),
    /** Predicted latitude at time of observation */
    predictedLat: decimal("predictedLat", { precision: 10, scale: 6 }).notNull(),
    /** Predicted longitude at time of observation */
    predictedLon: decimal("predictedLon", { precision: 10, scale: 6 }).notNull(),
    /** Actual observed latitude */
    actualLat: decimal("actualLat", { precision: 10, scale: 6 }).notNull(),
    /** Actual observed longitude */
    actualLon: decimal("actualLon", { precision: 10, scale: 6 }).notNull(),
    /** Human-readable description of the anomaly */
    description: text("description"),
    /** Whether the alert has been acknowledged by the user */
    acknowledged: boolean("acknowledged").default(false).notNull(),
    /** Whether owner notification was sent */
    notificationSent: boolean("notificationSent").default(false).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_anomaly_targetId").on(table.targetId),
    index("idx_anomaly_severity").on(table.severity),
    index("idx_anomaly_acknowledged").on(table.acknowledged),
    index("idx_anomaly_createdAt").on(table.createdAt),
  ]
);

export type AnomalyAlert = typeof anomalyAlerts.$inferSelect;
export type InsertAnomalyAlert = typeof anomalyAlerts.$inferInsert;

/**
 * Shared target lists — collaborative collections of targets
 * that can be shared with other users via invite links.
 */
export const sharedTargetLists = mysqlTable(
  "shared_target_lists",
  {
    id: int("id").autoincrement().primaryKey(),
    /** List name */
    name: varchar("name", { length: 256 }).notNull(),
    /** Description of the list */
    description: text("description"),
    /** Owner user ID (FK to users.id) */
    ownerId: int("ownerId").notNull(),
    /** Unique invite token for sharing */
    inviteToken: varchar("inviteToken", { length: 64 }).notNull().unique(),
    /** Default permission for invited users */
    defaultPermission: mysqlEnum("defaultPermission", ["view", "edit"]).default("view").notNull(),
    /** Whether the list is publicly accessible (no auth needed to view) */
    isPublic: boolean("isPublic").default(false).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_shared_lists_ownerId").on(table.ownerId),
    index("idx_shared_lists_inviteToken").on(table.inviteToken),
  ]
);

export type SharedTargetList = typeof sharedTargetLists.$inferSelect;
export type InsertSharedTargetList = typeof sharedTargetLists.$inferInsert;

/**
 * Members of shared target lists — tracks who has access and their permission level.
 */
export const sharedListMembers = mysqlTable(
  "shared_list_members",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to shared_target_lists.id */
    listId: int("listId").notNull(),
    /** FK to users.id */
    userId: int("userId").notNull(),
    /** Permission level for this member */
    permission: mysqlEnum("permission", ["view", "edit"]).default("view").notNull(),
    joinedAt: bigint("joinedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_members_listId").on(table.listId),
    index("idx_members_userId").on(table.userId),
  ]
);

export type SharedListMember = typeof sharedListMembers.$inferSelect;
export type InsertSharedListMember = typeof sharedListMembers.$inferInsert;

/**
 * Target-to-list mapping — which targets belong to which shared lists.
 */
export const sharedListTargets = mysqlTable(
  "shared_list_targets",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to shared_target_lists.id */
    listId: int("listId").notNull(),
    /** FK to tdoa_targets.id */
    targetId: int("targetId").notNull(),
    addedAt: bigint("addedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_list_targets_listId").on(table.listId),
    index("idx_list_targets_targetId").on(table.targetId),
  ]
);

export type SharedListTarget = typeof sharedListTargets.$inferSelect;
export type InsertSharedListTarget = typeof sharedListTargets.$inferInsert;

/**
 * Signal fingerprints — spectral signatures extracted from audio recordings.
 * Used for pattern matching to automatically link new TDoA results to existing targets.
 */
export const signalFingerprints = mysqlTable(
  "signal_fingerprints",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to tdoa_targets.id */
    targetId: int("targetId").notNull(),
    /** FK to tdoa_recordings.id that this fingerprint was extracted from */
    recordingId: int("recordingId").notNull(),
    /** FK to tdoa_target_history.id */
    historyEntryId: int("historyEntryId"),
    /** Frequency in kHz */
    frequencyKhz: decimal("frequencyKhz", { precision: 10, scale: 2 }),
    /** Modulation mode */
    mode: varchar("mode", { length: 8 }),
    /** Spectral peak frequencies (JSON array of Hz values) */
    spectralPeaks: json("spectralPeaks"),
    /** Bandwidth estimate in Hz */
    bandwidthHz: float("bandwidthHz"),
    /** Dominant frequency in Hz (strongest spectral component) */
    dominantFreqHz: float("dominantFreqHz"),
    /** Spectral centroid in Hz */
    spectralCentroid: float("spectralCentroid"),
    /** Spectral flatness (0 = tonal, 1 = noise-like) */
    spectralFlatness: float("spectralFlatness"),
    /** RMS energy level */
    rmsLevel: float("rmsLevel"),
    /** Compact feature vector for fast comparison (JSON array of floats) */
    featureVector: json("featureVector"),
    /** S3 URL to the spectrogram image snapshot */
    spectrogramUrl: varchar("spectrogramUrl", { length: 1024 }),
    /** S3 file key for the spectrogram */
    spectrogramKey: varchar("spectrogramKey", { length: 512 }),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_fingerprints_targetId").on(table.targetId),
    index("idx_fingerprints_recordingId").on(table.recordingId),
    index("idx_fingerprints_frequencyKhz").on(table.frequencyKhz),
  ]
);

export type SignalFingerprint = typeof signalFingerprints.$inferSelect;
export type InsertSignalFingerprint = typeof signalFingerprints.$inferInsert;

/**
 * Custom geofence zones — user-drawn polygon regions on the globe.
 * When a tracked target enters or leaves a zone, an alert is triggered.
 * Zones can be "exclusion" (alert on entry) or "inclusion" (alert on exit).
 */
export const geofenceZones = mysqlTable(
  "geofence_zones",
  {
    id: int("id").autoincrement().primaryKey(),
    /** User-assigned name for the zone */
    name: varchar("name", { length: 256 }).notNull(),
    /** Zone type: exclusion = alert on entry, inclusion = alert on exit */
    zoneType: mysqlEnum("zoneType", ["exclusion", "inclusion"]).default("exclusion").notNull(),
    /** Polygon vertices as JSON array of {lat, lon} objects */
    polygon: json("polygon").notNull(),
    /** Fill color for rendering on globe (hex) */
    color: varchar("color", { length: 9 }).default("#ff000066").notNull(),
    /** Whether this zone is active for alert checking */
    enabled: boolean("enabled").default(true).notNull(),
    /** Whether this zone is visible on the globe */
    visible: boolean("visible").default(true).notNull(),
    /** Optional description/notes */
    description: text("description"),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_geofence_enabled").on(table.enabled),
  ]
);

export type GeofenceZone = typeof geofenceZones.$inferSelect;
export type InsertGeofenceZone = typeof geofenceZones.$inferInsert;

/**
 * Geofence alert log — records when targets enter or leave geofence zones.
 * Links to anomaly_alerts for unified alert management.
 */
export const geofenceAlerts = mysqlTable(
  "geofence_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    /** FK to geofence_zones.id */
    zoneId: int("zoneId").notNull(),
    /** FK to tdoa_targets.id */
    targetId: int("targetId").notNull(),
    /** FK to anomaly_alerts.id (the unified alert record) */
    anomalyAlertId: int("anomalyAlertId"),
    /** Event type: entered or exited the zone */
    eventType: mysqlEnum("eventType", ["entered", "exited"]).default("entered").notNull(),
    /** Target latitude at time of event */
    lat: decimal("lat", { precision: 10, scale: 6 }).notNull(),
    /** Target longitude at time of event */
    lon: decimal("lon", { precision: 10, scale: 6 }).notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_geofence_alerts_zoneId").on(table.zoneId),
    index("idx_geofence_alerts_targetId").on(table.targetId),
  ]
);

export type GeofenceAlert = typeof geofenceAlerts.$inferSelect;
export type InsertGeofenceAlert = typeof geofenceAlerts.$inferInsert;

/**
 * Conflict zone sweep history — records each scheduled sweep run.
 */
export const conflictSweepHistory = mysqlTable(
  "conflict_sweep_history",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Number of targets checked */
    targetsChecked: int("targetsChecked").default(0).notNull(),
    /** Number of targets found in conflict zones */
    targetsInConflict: int("targetsInConflict").default(0).notNull(),
    /** Number of targets that triggered geofence alerts */
    geofenceAlertCount: int("geofenceAlertCount").default(0).notNull(),
    /** Number of new alerts generated */
    newAlerts: int("newAlerts").default(0).notNull(),
    /** Duration of the sweep in milliseconds */
    durationMs: int("durationMs"),
    /** Summary of results as JSON */
    summary: json("summary"),
    /** Sweep trigger: scheduled or manual */
    trigger: mysqlEnum("trigger", ["scheduled", "manual"]).default("scheduled").notNull(),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_sweep_createdAt").on(table.createdAt),
  ]
);

export type ConflictSweepHistory = typeof conflictSweepHistory.$inferSelect;
export type InsertConflictSweepHistory = typeof conflictSweepHistory.$inferInsert;

/**
 * Chat messages — persistent conversation history for the HybridRAG Intelligence Chat.
 * Stores user queries and assistant responses with optional globe action metadata.
 */
export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    /** User open ID (from auth) */
    userOpenId: varchar("userOpenId", { length: 256 }).notNull(),
    /** Message role: user or assistant */
    role: mysqlEnum("role", ["user", "assistant"]).default("user").notNull(),
    /** Message content (markdown for assistant, plain text for user) */
    content: text("content").notNull(),
    /** Globe actions embedded in assistant responses (JSON array) */
    globeActions: json("globeActions"),
    /** Timestamp (Unix ms) */
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_chat_userOpenId").on(table.userOpenId),
    index("idx_chat_createdAt").on(table.createdAt),
  ]
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Saved queries — bookmarked chat prompts for quick re-use.
 * Users can pin favorites, organize by category, and track usage.
 */
export const savedQueries = mysqlTable(
  "saved_queries",
  {
    id: int("id").autoincrement().primaryKey(),
    /** User open ID (from auth) */
    userOpenId: varchar("userOpenId", { length: 256 }).notNull(),
    /** User-assigned name for the query */
    name: varchar("name", { length: 256 }).notNull(),
    /** The actual prompt text */
    prompt: text("prompt").notNull(),
    /** Category for grouping */
    category: mysqlEnum("category", [
      "general",
      "receivers",
      "targets",
      "conflicts",
      "anomalies",
      "geofence",
      "system",
    ]).default("general").notNull(),
    /** Whether this query is pinned to the top */
    pinned: boolean("pinned").default(false).notNull(),
    /** Number of times this query has been executed */
    usageCount: int("usageCount").default(0).notNull(),
    /** Last time this query was executed (Unix ms) */
    lastUsedAt: bigint("lastUsedAt", { mode: "number" }),
    createdAt: bigint("createdAt", { mode: "number" }).notNull(),
    updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_saved_queries_user").on(table.userOpenId),
    index("idx_saved_queries_pinned").on(table.pinned),
  ]
);

export type SavedQuery = typeof savedQueries.$inferSelect;
export type InsertSavedQuery = typeof savedQueries.$inferInsert;

/**
 * Intelligence briefings — auto-generated or on-demand summaries
 * combining receiver health, conflict events, and anomaly alerts.
 */
export const briefings = mysqlTable(
  "briefings",
  {
    id: int("id").autoincrement().primaryKey(),
    /** User open ID (owner of this briefing) */
    userOpenId: varchar("userOpenId", { length: 256 }).notNull(),
    /** Briefing title */
    title: varchar("title", { length: 256 }).notNull(),
    /** Full briefing content (markdown) */
    content: text("content").notNull(),
    /** Briefing type: daily, weekly, or on-demand */
    briefingType: mysqlEnum("briefingType", ["daily", "weekly", "on_demand"]).default("on_demand").notNull(),
    /** Summary statistics as JSON */
    stats: json("stats"),
    /** Data sources used to generate this briefing */
    dataSources: json("dataSources"),
    /** Whether this briefing has been read */
    isRead: boolean("isRead").default(false).notNull(),
    /** Generation timestamp (Unix ms) */
    generatedAt: bigint("generatedAt", { mode: "number" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_briefings_user").on(table.userOpenId),
    index("idx_briefings_type").on(table.briefingType),
    index("idx_briefings_generatedAt").on(table.generatedAt),
  ]
);

export type Briefing = typeof briefings.$inferSelect;
export type InsertBriefing = typeof briefings.$inferInsert;
