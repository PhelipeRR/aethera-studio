CREATE TABLE `workflow_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `workflow_id` text NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  `status` text DEFAULT 'pending' NOT NULL,
  `approved` integer DEFAULT false NOT NULL,
  `current_layer` integer DEFAULT 0 NOT NULL,
  `task_ids` text DEFAULT '[]' NOT NULL,
  `error` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_workflow_idx` ON `workflow_runs` (`workflow_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);
