CREATE TABLE `workflows` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `project_id` text REFERENCES projects(id) ON DELETE SET NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `definition` text NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflows_project_idx` ON `workflows` (`project_id`,`updated_at`);
