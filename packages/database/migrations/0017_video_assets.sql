CREATE TABLE `video_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE,
  `path` text NOT NULL,
  `kind` text NOT NULL,
  `bytes` integer NOT NULL,
  `sha256` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_assets_project_idx` ON `video_assets` (`project_id`,`path`);
