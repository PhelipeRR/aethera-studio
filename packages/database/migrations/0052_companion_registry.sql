CREATE TABLE `companion_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	`project_id` text REFERENCES `projects`(`id`) ON DELETE SET NULL,
	`agent` text NOT NULL,
	`provider_session_id` text,
	`status` text NOT NULL,
	`connection` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_sequence` integer DEFAULT -1 NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `companion_sessions_task_idx` ON `companion_sessions` (`task_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `companion_sessions_project_idx` ON `companion_sessions` (`project_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `companion_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `companion_sessions`(`session_id`) ON DELETE CASCADE,
	`task_id` text NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	`agent` text NOT NULL,
	`sequence` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_events_session_sequence_unique` ON `companion_events` (`session_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `companion_events_task_idx` ON `companion_events` (`task_id`,`received_at`);
