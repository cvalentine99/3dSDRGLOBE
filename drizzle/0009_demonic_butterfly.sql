CREATE TABLE `anomaly_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetId` int NOT NULL,
	`historyEntryId` int NOT NULL,
	`severity` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`deviationKm` float NOT NULL,
	`deviationSigma` float NOT NULL,
	`predictedLat` decimal(10,6) NOT NULL,
	`predictedLon` decimal(10,6) NOT NULL,
	`actualLat` decimal(10,6) NOT NULL,
	`actualLon` decimal(10,6) NOT NULL,
	`description` text,
	`acknowledged` boolean NOT NULL DEFAULT false,
	`notificationSent` boolean NOT NULL DEFAULT false,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `anomaly_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shared_list_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listId` int NOT NULL,
	`userId` int NOT NULL,
	`permission` enum('view','edit') NOT NULL DEFAULT 'view',
	`joinedAt` bigint NOT NULL,
	CONSTRAINT `shared_list_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shared_list_targets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listId` int NOT NULL,
	`targetId` int NOT NULL,
	`addedAt` bigint NOT NULL,
	CONSTRAINT `shared_list_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shared_target_lists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`ownerId` int NOT NULL,
	`inviteToken` varchar(64) NOT NULL,
	`defaultPermission` enum('view','edit') NOT NULL DEFAULT 'view',
	`isPublic` boolean NOT NULL DEFAULT false,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `shared_target_lists_id` PRIMARY KEY(`id`),
	CONSTRAINT `shared_target_lists_inviteToken_unique` UNIQUE(`inviteToken`)
);
--> statement-breakpoint
CREATE TABLE `signal_fingerprints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetId` int NOT NULL,
	`recordingId` int NOT NULL,
	`historyEntryId` int,
	`frequencyKhz` decimal(10,2),
	`mode` varchar(8),
	`spectralPeaks` json,
	`bandwidthHz` float,
	`dominantFreqHz` float,
	`spectralCentroid` float,
	`spectralFlatness` float,
	`rmsLevel` float,
	`featureVector` json,
	`spectrogramUrl` varchar(1024),
	`spectrogramKey` varchar(512),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `signal_fingerprints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_anomaly_targetId` ON `anomaly_alerts` (`targetId`);--> statement-breakpoint
CREATE INDEX `idx_anomaly_severity` ON `anomaly_alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_anomaly_acknowledged` ON `anomaly_alerts` (`acknowledged`);--> statement-breakpoint
CREATE INDEX `idx_anomaly_createdAt` ON `anomaly_alerts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_members_listId` ON `shared_list_members` (`listId`);--> statement-breakpoint
CREATE INDEX `idx_members_userId` ON `shared_list_members` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_list_targets_listId` ON `shared_list_targets` (`listId`);--> statement-breakpoint
CREATE INDEX `idx_list_targets_targetId` ON `shared_list_targets` (`targetId`);--> statement-breakpoint
CREATE INDEX `idx_shared_lists_ownerId` ON `shared_target_lists` (`ownerId`);--> statement-breakpoint
CREATE INDEX `idx_shared_lists_inviteToken` ON `shared_target_lists` (`inviteToken`);--> statement-breakpoint
CREATE INDEX `idx_fingerprints_targetId` ON `signal_fingerprints` (`targetId`);--> statement-breakpoint
CREATE INDEX `idx_fingerprints_recordingId` ON `signal_fingerprints` (`recordingId`);--> statement-breakpoint
CREATE INDEX `idx_fingerprints_frequencyKhz` ON `signal_fingerprints` (`frequencyKhz`);