CREATE TABLE `access_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`client` text NOT NULL,
	`action` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_log_memory_idx` ON `access_log` (`memory_id`,`at`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` blob NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text,
	`target_title` text NOT NULL,
	`relation` text DEFAULT 'references' NOT NULL,
	`origin` text DEFAULT 'wikilink' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "links_origin_check" CHECK(origin IN ('wikilink', 'explicit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_unique` ON `links` (`source_id`,lower("target_title"),`relation`);--> statement-breakpoint
CREATE INDEX `links_target_idx` ON `links` (`target_id`);--> statement-breakpoint
CREATE INDEX `links_pending_idx` ON `links` (lower("target_title")) WHERE "links"."target_id" IS NULL;--> statement-breakpoint
CREATE TABLE `memories` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text NOT NULL,
	`project_id` text,
	`trust` text DEFAULT 'unverified' NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text,
	`version` integer DEFAULT 1 NOT NULL,
	`embedding_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memories_type_check" CHECK(type IN ('decision', 'code_pattern', 'project_context', 'bug_fix', 'learning', 'preference', 'documentation', 'execution_summary')),
	CONSTRAINT "memories_trust_check" CHECK(trust IN ('unverified', 'reviewed', 'rejected')),
	CONSTRAINT "memories_source_kind_check" CHECK(source_kind IN ('user', 'claude', 'codex', 'mcp', 'extractor')),
	CONSTRAINT "memories_embedding_status_check" CHECK(embedding_status IN ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_id_unique` ON `memories` (`id`);--> statement-breakpoint
CREATE INDEX `memories_project_idx` ON `memories` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `memories_embedding_status_idx` ON `memories` (`embedding_status`);--> statement-breakpoint
CREATE TABLE `memory_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_sources_kind_check" CHECK(kind IN ('file', 'url', 'task', 'conversation'))
);
--> statement-breakpoint
CREATE INDEX `memory_sources_memory_idx` ON `memory_sources` (`memory_id`);--> statement-breakpoint
CREATE TABLE `memory_tags` (
	`memory_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`memory_id`, `tag_id`),
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_tags_tag_idx` ON `memory_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `memory_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text NOT NULL,
	`tags` text NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_versions_unique` ON `memory_versions` (`memory_id`,`version`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_path_unique` ON `projects` (`root_path`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`step_id` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `task_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_events_task_idx` ON `task_events` (`task_id`,`id`);--> statement-breakpoint
CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`agent` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_tokens` integer,
	`cost_usd` real,
	`files_changed` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_steps_agent_check" CHECK(agent IN ('claude', 'codex')),
	CONSTRAINT "task_steps_status_check" CHECK(status IN ('pending', 'planning', 'running', 'awaiting_approval', 'validating', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_steps_position_unique` ON `task_steps` (`task_id`,`position`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`project_id` text,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`parent_task_id` text,
	`summary` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_mode_check" CHECK(mode IN ('auto', 'claude', 'codex', 'collab')),
	CONSTRAINT "tasks_status_check" CHECK(status IN ('pending', 'planning', 'running', 'awaiting_approval', 'validating', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`,`created_at`);