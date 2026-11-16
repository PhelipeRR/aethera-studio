CREATE TABLE `aethera_creative_generation_runs` (`id` text PRIMARY KEY NOT NULL, `project_id` text REFERENCES `aethera_creative_projects`(`id`) ON DELETE SET NULL, `art_type` text NOT NULL, `prompt` text NOT NULL, `status` text NOT NULL, `request_json` text NOT NULL, `report_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_creative_generation_runs_project_idx` ON `aethera_creative_generation_runs` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `aethera_creative_generation_runs_created_idx` ON `aethera_creative_generation_runs` (`created_at`);
