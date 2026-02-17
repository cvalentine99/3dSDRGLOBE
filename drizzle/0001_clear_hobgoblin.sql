CREATE TABLE `receiver_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receiverId` int NOT NULL,
	`scanCycleId` int NOT NULL,
	`online` boolean NOT NULL DEFAULT false,
	`users` int,
	`usersMax` int,
	`snr` float,
	`checkedAt` bigint NOT NULL,
	`error` varchar(512),
	CONSTRAINT `receiver_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receivers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`normalizedUrl` varchar(512) NOT NULL,
	`originalUrl` varchar(512) NOT NULL,
	`receiverType` enum('KiwiSDR','OpenWebRX','WebSDR') NOT NULL,
	`stationLabel` varchar(256) NOT NULL,
	`receiverName` text,
	`lastOnline` boolean NOT NULL DEFAULT false,
	`lastCheckedAt` bigint,
	`lastSnr` float,
	`lastUsers` int,
	`lastUsersMax` int,
	`uptime24h` float,
	`uptime7d` float,
	`totalChecks` int NOT NULL DEFAULT 0,
	`onlineChecks` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `receivers_id` PRIMARY KEY(`id`),
	CONSTRAINT `receivers_normalizedUrl_unique` UNIQUE(`normalizedUrl`)
);
--> statement-breakpoint
CREATE TABLE `scan_cycles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cycleId` varchar(64) NOT NULL,
	`cycleNumber` int NOT NULL DEFAULT 0,
	`totalReceivers` int NOT NULL DEFAULT 0,
	`onlineCount` int NOT NULL DEFAULT 0,
	`offlineCount` int NOT NULL DEFAULT 0,
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`durationSec` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_cycles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_history_receiver_checked` ON `receiver_status_history` (`receiverId`,`checkedAt`);--> statement-breakpoint
CREATE INDEX `idx_history_scanCycle` ON `receiver_status_history` (`scanCycleId`);--> statement-breakpoint
CREATE INDEX `idx_history_checkedAt` ON `receiver_status_history` (`checkedAt`);--> statement-breakpoint
CREATE INDEX `idx_receivers_type` ON `receivers` (`receiverType`);--> statement-breakpoint
CREATE INDEX `idx_receivers_lastOnline` ON `receivers` (`lastOnline`);