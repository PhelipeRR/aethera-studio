ALTER TABLE `workflows` ADD `layout` text;
--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `definition_snapshot` text;
--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `definition_version` integer;
--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `inputs` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `trigger` text;
--> statement-breakpoint
CREATE TABLE `workflow_run_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  `step_id` text NOT NULL,
  `status` text NOT NULL,
  `task_id` text,
  `output` text,
  `error` text,
  `started_at` text,
  `finished_at` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_run_steps_run_idx` ON `workflow_run_steps` (`run_id`, `created_at`);
