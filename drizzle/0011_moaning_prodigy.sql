CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userOpenId` varchar(256) NOT NULL,
	`role` enum('user','assistant') NOT NULL DEFAULT 'user',
	`content` text NOT NULL,
	`globeActions` json,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_chat_userOpenId` ON `chat_messages` (`userOpenId`);--> statement-breakpoint
CREATE INDEX `idx_chat_createdAt` ON `chat_messages` (`createdAt`);