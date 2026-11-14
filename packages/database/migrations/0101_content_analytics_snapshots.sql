CREATE TABLE `content_analytics_snapshots` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `content_projects`(`id`) ON DELETE CASCADE, `publication_id` text REFERENCES `content_publications`(`id`) ON DELETE SET NULL, `platform` text NOT NULL, `captured_at` text NOT NULL, `metrics_json` text NOT NULL DEFAULT '{}', `notes` text NOT NULL DEFAULT '');
--> statement-breakpoint
CREATE INDEX `content_analytics_project_idx` ON `content_analytics_snapshots` (`project_id`, `captured_at`);
