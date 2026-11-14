PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `tasks_new` (
  `id` text PRIMARY KEY NOT NULL,
  `prompt` text NOT NULL,
  `project_id` text,
  `mode` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `parent_task_id` text,
  `title` text,
  `model` text,
  `images` text DEFAULT '[]' NOT NULL,
  `summary` text,
  `error` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `started_at` text,
  `finished_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT "tasks_mode_check" CHECK(mode IN ('auto', 'claude', 'codex', 'collab')),
  CONSTRAINT "tasks_status_check" CHECK(status IN ('pending', 'planning', 'running', 'awaiting_approval', 'validating', 'paused', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `tasks_new` (`id`,`prompt`,`project_id`,`mode`,`status`,`parent_task_id`,`title`,`model`,`images`,`summary`,`error`,`created_at`,`started_at`,`finished_at`)
SELECT `id`,`prompt`,`project_id`,`mode`,`status`,`parent_task_id`,`title`,`model`,`images`,`summary`,`error`,`created_at`,`started_at`,`finished_at` FROM `tasks`;
--> statement-breakpoint
DROP TABLE `tasks`;
--> statement-breakpoint
ALTER TABLE `tasks_new` RENAME TO `tasks`;
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);
--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
