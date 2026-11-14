CREATE TABLE `workflow_checkpoints` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, `workflow_id` text NOT NULL, `definition_version` integer NOT NULL, `sequence` integer NOT NULL, `completed` text NOT NULL, `pending` text NOT NULL, `artifacts` text NOT NULL DEFAULT '[]', `provider` text, `approval_state` text, `recovery_meta` text NOT NULL DEFAULT '{}', `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL);
--> statement-breakpoint
CREATE TABLE `workflow_step_attempts` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, `step_id` text NOT NULL, `attempt` integer NOT NULL, `provider` text, `task_id` text, `failure_kind` text, `delay_ms` integer, `decision` text, `reason` text, `started_at` text, `finished_at` text);
--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `recovery_state` text;
