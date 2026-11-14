CREATE TABLE `task_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
  `attempt` integer NOT NULL,
  `correlation_id` text NOT NULL,
  `payload` text NOT NULL,
  `created_at` text NOT NULL
);
