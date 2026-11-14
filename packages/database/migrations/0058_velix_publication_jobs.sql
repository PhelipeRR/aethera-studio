CREATE TABLE `velix_publication_jobs` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `publication_id` text NOT NULL, `status` text NOT NULL, `progress` integer NOT NULL DEFAULT 0, `error` text, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE INDEX `velix_publication_jobs_project_status_idx` ON `velix_publication_jobs` (`project_id`,`status`,`updated_at`);
