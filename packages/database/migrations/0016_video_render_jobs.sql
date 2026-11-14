CREATE TABLE `video_render_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_render_jobs_status_idx` ON `video_render_jobs` (`status`,`updated_at`);
