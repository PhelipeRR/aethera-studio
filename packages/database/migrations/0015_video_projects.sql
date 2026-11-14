CREATE TABLE `video_projects` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `root_path` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_compositions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE,
  `version` integer DEFAULT 1 NOT NULL,
  `composition` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `video_compositions_project_idx` ON `video_compositions` (`project_id`,`updated_at`);
