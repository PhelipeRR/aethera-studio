ALTER TABLE `velix_discovery_searches` ADD COLUMN `filters` text;
--> statement-breakpoint
ALTER TABLE `velix_discovery_searches` ADD COLUMN `cache_key` text;
--> statement-breakpoint
ALTER TABLE `velix_discovery_searches` ADD COLUMN `results` text;
--> statement-breakpoint
ALTER TABLE `velix_discovery_searches` ADD COLUMN `next_page_token` text;
--> statement-breakpoint
ALTER TABLE `velix_discovery_searches` ADD COLUMN `expires_at` text;
--> statement-breakpoint
ALTER TABLE `velix_clip_suggestions` ADD COLUMN `favorite` integer NOT NULL DEFAULT 0;
