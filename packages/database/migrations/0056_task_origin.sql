ALTER TABLE `tasks` ADD `origin` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
UPDATE `tasks` SET `origin` = 'neura' WHERE `prompt` LIKE 'You are Neura, a personal desktop assistant.%';
