CREATE TABLE `velix_motion_projects` (`project_id` text PRIMARY KEY NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data` text NOT NULL, `updated_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE TABLE `velix_motion_jobs` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `editorial_version_id` text NOT NULL, `status` text NOT NULL, `output_path` text, `error` text, `created_at` text NOT NULL DEFAULT (datetime('now')));
--> statement-breakpoint
CREATE INDEX `velix_motion_jobs_project_idx` ON `velix_motion_jobs` (`project_id`,`created_at`);
