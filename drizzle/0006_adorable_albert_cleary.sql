CREATE TABLE `tdoa_targets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(256) NOT NULL,
	`lat` decimal(10,6) NOT NULL,
	`lon` decimal(10,6) NOT NULL,
	`frequencyKhz` decimal(10,2),
	`color` varchar(7) NOT NULL DEFAULT '#ff6b6b',
	`notes` text,
	`sourceJobId` int,
	`visible` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `tdoa_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_targets_createdAt` ON `tdoa_targets` (`createdAt`);