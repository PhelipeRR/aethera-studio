CREATE TABLE `aethera_editorial_plans` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `version` integer NOT NULL, `status` text NOT NULL, `hash` text NOT NULL, `script_key` text NOT NULL, `data_json` text NOT NULL, `approved_by` text, `approved_at` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_editorial_plans_run_version_idx` ON `aethera_editorial_plans` (`run_id`,`version`);
--> statement-breakpoint
CREATE INDEX `aethera_editorial_plans_run_script_idx` ON `aethera_editorial_plans` (`run_id`,`script_key`);
