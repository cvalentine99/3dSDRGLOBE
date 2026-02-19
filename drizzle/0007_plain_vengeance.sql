CREATE TABLE `tdoa_recordings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`hostId` varchar(256) NOT NULL,
	`frequencyKhz` decimal(10,2) NOT NULL,
	`mode` varchar(8) NOT NULL DEFAULT 'am',
	`durationSec` int NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileUrl` varchar(1024) NOT NULL,
	`fileSizeBytes` int,
	`status` enum('recording','uploading','ready','error') NOT NULL DEFAULT 'recording',
	`errorMessage` text,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `tdoa_recordings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_recordings_jobId` ON `tdoa_recordings` (`jobId`);--> statement-breakpoint
CREATE INDEX `idx_recordings_hostId` ON `tdoa_recordings` (`hostId`);