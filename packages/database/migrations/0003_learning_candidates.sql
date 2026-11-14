CREATE TABLE `learning_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`project_id` text,
	`agent` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`merge_target_id` text,
	`memory_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_candidates_status_check" CHECK(status IN ('pending', 'approved', 'rejected', 'blocked')),
	CONSTRAINT "learning_candidates_type_check" CHECK(type IN ('decision', 'code_pattern', 'project_context', 'bug_fix', 'learning', 'preference', 'documentation', 'execution_summary'))
);
--> statement-breakpoint
CREATE INDEX `learning_candidates_status_idx` ON `learning_candidates` (`status`,`created_at`);