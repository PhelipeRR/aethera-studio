CREATE TABLE `task_capacity_waits` (
  `task_id` text PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  `status` text DEFAULT 'waiting' NOT NULL,
  `agents` text DEFAULT '[]' NOT NULL,
  `retry_at` text,
  `auto_resume` integer DEFAULT true NOT NULL,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_capacity_waits_status_idx` ON `task_capacity_waits` (`status`);
