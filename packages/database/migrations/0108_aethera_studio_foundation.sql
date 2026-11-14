CREATE TABLE `aethera_subjects` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `kind` text NOT NULL, `title` text NOT NULL, `data_json` text NOT NULL, `verification` text NOT NULL, `checked_at` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_subjects_run_idx` ON `aethera_subjects` (`run_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `aethera_media_acquisitions` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `subject_id` text REFERENCES `aethera_subjects`(`id`) ON DELETE SET NULL, `reference_id` text NOT NULL, `adapter` text NOT NULL, `idempotency_key` text NOT NULL, `status` text NOT NULL, `attempt` integer NOT NULL DEFAULT 0, `bytes_done` integer NOT NULL DEFAULT 0, `bytes_total` integer, `partial_path` text, `result_json` text, `error_json` text, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_media_acquisitions_key_idx` ON `aethera_media_acquisitions` (`run_id`, `idempotency_key`);
--> statement-breakpoint
CREATE TABLE `aethera_media_provenance` (`asset_id` text PRIMARY KEY NOT NULL REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `url` text NOT NULL, `platform` text NOT NULL, `publisher` text NOT NULL, `official` integer NOT NULL, `published_at` text, `license` text, `known_restrictions_json` text NOT NULL DEFAULT '[]', `adapter` text NOT NULL, `adapter_version` text NOT NULL, `acquired_at` text NOT NULL, `usage` text NOT NULL, `legal_clearance` text NOT NULL DEFAULT 'unknown', `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `aethera_media_segments` (`id` text PRIMARY KEY NOT NULL, `asset_id` text NOT NULL REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `start_ms` integer NOT NULL, `end_ms` integer NOT NULL, `kind` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_media_segments_asset_idx` ON `aethera_media_segments` (`asset_id`, `start_ms`);
--> statement-breakpoint
CREATE TABLE `aethera_subject_identities` (`id` text PRIMARY KEY NOT NULL, `asset_id` text NOT NULL REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `segment_id` text REFERENCES `aethera_media_segments`(`id`) ON DELETE CASCADE, `subject_id` text NOT NULL REFERENCES `aethera_subjects`(`id`) ON DELETE CASCADE, `status` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_subject_identities_subject_idx` ON `aethera_subject_identities` (`subject_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `aethera_vision_cache` (`key` text PRIMARY KEY NOT NULL, `provider` text NOT NULL, `model` text NOT NULL, `prompt_version` text NOT NULL, `task` text NOT NULL, `result_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
ALTER TABLE `velix_production_approvals` ADD COLUMN `gate` text;
--> statement-breakpoint
ALTER TABLE `velix_production_approvals` ADD COLUMN `version` text;
