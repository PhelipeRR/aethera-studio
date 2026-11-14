ALTER TABLE `tasks` ADD `owner_instance_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `lease_expires_at` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `external_system` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `external_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `external_revision` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_external_ref_idx` ON `tasks` (`external_system`,`external_id`) WHERE `external_system` IS NOT NULL;
