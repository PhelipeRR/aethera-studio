CREATE TABLE `aethera_director_plans` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `version` integer NOT NULL, `preset_id` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_director_plans_run_version_idx` ON `aethera_director_plans` (`run_id`,`version`);
--> statement-breakpoint
CREATE INDEX `aethera_director_plans_run_created_idx` ON `aethera_director_plans` (`run_id`,`created_at`);
