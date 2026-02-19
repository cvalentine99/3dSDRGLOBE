CREATE TABLE `tdoa_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`frequencyKhz` decimal(10,2) NOT NULL,
	`passbandHz` int NOT NULL,
	`sampleTime` int NOT NULL DEFAULT 30,
	`hosts` json NOT NULL,
	`knownLocation` json,
	`mapBounds` json NOT NULL,
	`tdoaKey` varchar(32),
	`status` enum('pending','sampling','computing','complete','error') NOT NULL DEFAULT 'pending',
	`likelyLat` decimal(10,6),
	`likelyLon` decimal(10,6),
	`resultData` json,
	`contourData` json,
	`errorMessage` text,
	`createdAt` bigint NOT NULL,
	`completedAt` bigint,
	CONSTRAINT `tdoa_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tdoa_status` ON `tdoa_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tdoa_createdAt` ON `tdoa_jobs` (`createdAt`);