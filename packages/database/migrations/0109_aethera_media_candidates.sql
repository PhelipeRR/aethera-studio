CREATE TABLE `aethera_media_candidates` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `subject_id` text NOT NULL REFERENCES `aethera_subjects`(`id`) ON DELETE CASCADE, `reference_id` text REFERENCES `velix_media_references`(`id`) ON DELETE SET NULL, `url` text NOT NULL, `source` text NOT NULL, `kind` text NOT NULL, `status` text NOT NULL, `score` real NOT NULL DEFAULT 0, `identity` text, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_media_candidates_run_url_idx` ON `aethera_media_candidates` (`run_id`, `url`);
--> statement-breakpoint
CREATE INDEX `aethera_media_candidates_subject_idx` ON `aethera_media_candidates` (`subject_id`, `score`);
--> statement-breakpoint
CREATE TABLE `aethera_media_usage_events` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `asset_id` text REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `candidate_id` text REFERENCES `aethera_media_candidates`(`id`) ON DELETE SET NULL, `subject_id` text, `event` text NOT NULL, `detail` text NOT NULL DEFAULT '', `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_media_usage_events_asset_idx` ON `aethera_media_usage_events` (`asset_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `aethera_media_usage_events_run_idx` ON `aethera_media_usage_events` (`run_id`, `created_at`);
