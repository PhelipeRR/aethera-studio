CREATE TABLE `aethera_timelines` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `version` integer NOT NULL, `document_json` text NOT NULL, `hash` text NOT NULL, `source` text NOT NULL, `author` text NOT NULL, `change_json` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_timelines_run_version_idx` ON `aethera_timelines` (`run_id`,`version`);
--> statement-breakpoint
CREATE INDEX `aethera_timelines_run_created_idx` ON `aethera_timelines` (`run_id`,`created_at`);
