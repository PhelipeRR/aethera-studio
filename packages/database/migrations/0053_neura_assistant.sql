CREATE TABLE `neura_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`consent` integer DEFAULT 0 NOT NULL,
	`meeting_language` text,
	`user_preferred_language` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `neura_sessions_status_idx` ON `neura_sessions` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `neura_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `neura_sessions`(`id`) ON DELETE CASCADE,
	`text` text NOT NULL,
	`language` text NOT NULL,
	`source_excerpt` text,
	`confidence` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `neura_suggestions_session_idx` ON `neura_suggestions` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `neura_suggestions_status_idx` ON `neura_suggestions` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `neura_action_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text REFERENCES `neura_sessions`(`id`) ON DELETE SET NULL,
	`action_type` text NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`fingerprint` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `neura_action_audits_fingerprint_unique` ON `neura_action_audits` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `neura_action_audits_session_idx` ON `neura_action_audits` (`session_id`,`created_at`);
