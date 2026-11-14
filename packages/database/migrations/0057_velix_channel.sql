CREATE TABLE `velix_brand_identities` (`project_id` text PRIMARY KEY NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data` text NOT NULL, `updated_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE TABLE `velix_publications` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `status` text NOT NULL, `youtube_video_id` text, `publish_at` text, `data` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE INDEX `velix_publications_project_date_idx` ON `velix_publications` (`project_id`,`publish_at`);
--> statement-breakpoint
CREATE TABLE `velix_agenda_items` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE INDEX `velix_agenda_items_project_date_idx` ON `velix_agenda_items` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `velix_niche_references` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE INDEX `velix_niche_references_project_idx` ON `velix_niche_references` (`project_id`,`created_at`);
