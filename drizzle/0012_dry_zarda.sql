CREATE TABLE `briefings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userOpenId` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`content` text NOT NULL,
	`briefingType` enum('daily','weekly','on_demand') NOT NULL DEFAULT 'on_demand',
	`stats` json,
	`dataSources` json,
	`isRead` boolean NOT NULL DEFAULT false,
	`generatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `briefings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `saved_queries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userOpenId` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`prompt` text NOT NULL,
	`category` enum('general','receivers','targets','conflicts','anomalies','geofence','system') NOT NULL DEFAULT 'general',
	`pinned` boolean NOT NULL DEFAULT false,
	`usageCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` bigint,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `saved_queries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_briefings_user` ON `briefings` (`userOpenId`);--> statement-breakpoint
CREATE INDEX `idx_briefings_type` ON `briefings` (`briefingType`);--> statement-breakpoint
CREATE INDEX `idx_briefings_generatedAt` ON `briefings` (`generatedAt`);--> statement-breakpoint
CREATE INDEX `idx_saved_queries_user` ON `saved_queries` (`userOpenId`);--> statement-breakpoint
CREATE INDEX `idx_saved_queries_pinned` ON `saved_queries` (`pinned`);