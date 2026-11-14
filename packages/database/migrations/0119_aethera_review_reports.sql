CREATE TABLE `aethera_review_reports` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `timeline_version` integer NOT NULL, `timeline_hash` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_review_reports_run_created_idx` ON `aethera_review_reports` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `aethera_review_reports_run_version_idx` ON `aethera_review_reports` (`run_id`,`timeline_version`);
