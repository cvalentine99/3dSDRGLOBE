CREATE TABLE `conflict_sweep_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetsChecked` int NOT NULL DEFAULT 0,
	`targetsInConflict` int NOT NULL DEFAULT 0,
	`geofenceAlertCount` int NOT NULL DEFAULT 0,
	`newAlerts` int NOT NULL DEFAULT 0,
	`durationMs` int,
	`summary` json,
	`trigger` enum('scheduled','manual') NOT NULL DEFAULT 'scheduled',
	`createdAt` bigint NOT NULL,
	CONSTRAINT `conflict_sweep_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `geofence_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zoneId` int NOT NULL,
	`targetId` int NOT NULL,
	`anomalyAlertId` int,
	`eventType` enum('entered','exited') NOT NULL DEFAULT 'entered',
	`lat` decimal(10,6) NOT NULL,
	`lon` decimal(10,6) NOT NULL,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `geofence_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `geofence_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`zoneType` enum('exclusion','inclusion') NOT NULL DEFAULT 'exclusion',
	`polygon` json NOT NULL,
	`color` varchar(9) NOT NULL DEFAULT '#ff000066',
	`enabled` boolean NOT NULL DEFAULT true,
	`visible` boolean NOT NULL DEFAULT true,
	`description` text,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `geofence_zones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sweep_createdAt` ON `conflict_sweep_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_geofence_alerts_zoneId` ON `geofence_alerts` (`zoneId`);--> statement-breakpoint
CREATE INDEX `idx_geofence_alerts_targetId` ON `geofence_alerts` (`targetId`);--> statement-breakpoint
CREATE INDEX `idx_geofence_enabled` ON `geofence_zones` (`enabled`);