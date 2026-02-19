CREATE TABLE `tdoa_target_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetId` int NOT NULL,
	`jobId` int NOT NULL,
	`lat` decimal(10,6) NOT NULL,
	`lon` decimal(10,6) NOT NULL,
	`frequencyKhz` decimal(10,2),
	`hostCount` int,
	`notes` text,
	`observedAt` bigint NOT NULL,
	CONSTRAINT `tdoa_target_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tdoa_targets` ADD `category` enum('time_signal','broadcast','utility','military','amateur','unknown','custom') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_target_history_targetId` ON `tdoa_target_history` (`targetId`);--> statement-breakpoint
CREATE INDEX `idx_target_history_observedAt` ON `tdoa_target_history` (`observedAt`);--> statement-breakpoint
CREATE INDEX `idx_targets_category` ON `tdoa_targets` (`category`);