CREATE TABLE `personal_accounts` (`id` text PRIMARY KEY NOT NULL, `provider` text NOT NULL, `identifier` text NOT NULL, `scopes_json` text NOT NULL, `state` text NOT NULL, `token_file` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_accounts_provider_identifier_idx` ON `personal_accounts` (`provider`, `identifier`);
--> statement-breakpoint
CREATE TABLE `personal_sync_state` (`account_id` text NOT NULL REFERENCES `personal_accounts`(`id`) ON DELETE CASCADE, `resource` text NOT NULL, `cursor` text, `updated_at` text NOT NULL, PRIMARY KEY(`account_id`, `resource`));
--> statement-breakpoint
CREATE TABLE `personal_processed_events` (`account_id` text NOT NULL REFERENCES `personal_accounts`(`id`) ON DELETE CASCADE, `event_key` text NOT NULL, `processed_at` text NOT NULL, PRIMARY KEY(`account_id`, `event_key`));
--> statement-breakpoint
CREATE TABLE `personal_automations` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `trigger_json` text NOT NULL, `condition_json` text NOT NULL, `action_json` text NOT NULL, `timezone` text NOT NULL, `state` text NOT NULL, `source_text` text, `next_run_at` text, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `personal_automations_next_run_idx` ON `personal_automations` (`state`, `next_run_at`);
--> statement-breakpoint
CREATE TABLE `personal_automation_runs` (`id` text PRIMARY KEY NOT NULL, `automation_id` text NOT NULL REFERENCES `personal_automations`(`id`) ON DELETE CASCADE, `attempt` integer NOT NULL DEFAULT 1, `state` text NOT NULL, `error` text, `task_id` text, `duration_ms` integer, `idempotency_key` text NOT NULL, `started_at` text NOT NULL, `finished_at` text);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_automation_runs_idempotency_idx` ON `personal_automation_runs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `personal_automation_runs_automation_idx` ON `personal_automation_runs` (`automation_id`, `started_at`);
--> statement-breakpoint
CREATE TABLE `personal_notifications` (`id` text PRIMARY KEY NOT NULL, `priority` text NOT NULL, `channel` text NOT NULL, `group_key` text, `title` text NOT NULL, `metadata_json` text NOT NULL, `dedupe_key` text NOT NULL, `read_at` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_notifications_dedupe_idx` ON `personal_notifications` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `personal_notifications_created_idx` ON `personal_notifications` (`read_at`, `created_at`);
--> statement-breakpoint
CREATE TABLE `personal_notification_prefs` (`id` text PRIMARY KEY NOT NULL, `channels_json` text NOT NULL, `quiet_from` text, `quiet_to` text, `locked_screen` integer NOT NULL DEFAULT 0, `updated_at` text NOT NULL);
