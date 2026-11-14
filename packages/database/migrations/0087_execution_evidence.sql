CREATE TABLE `execution_snapshots` (
  `task_id` text PRIMARY KEY NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  `phase` text NOT NULL,
  `attempt` integer NOT NULL DEFAULT 0,
  `checkpoint` text,
  `approval` text NOT NULL DEFAULT 'not-required',
  `cancellation` text NOT NULL DEFAULT 'none',
  `failure_category` text NOT NULL DEFAULT 'none',
  `evidence_ids` text NOT NULL DEFAULT '[]',
  `recovery_action` text NOT NULL DEFAULT 'none',
  `updated_at` text NOT NULL
);
