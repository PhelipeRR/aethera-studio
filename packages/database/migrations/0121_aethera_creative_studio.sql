CREATE TABLE `aethera_creative_brand_kits` (`id` text PRIMARY KEY NOT NULL, `channel_id` text, `channel_name` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_creative_brand_kits_channel_idx` ON `aethera_creative_brand_kits` (`channel_id`);
--> statement-breakpoint
CREATE TABLE `aethera_creative_projects` (`id` text PRIMARY KEY NOT NULL, `art_type` text NOT NULL, `title` text NOT NULL, `brand_kit_id` text REFERENCES `aethera_creative_brand_kits`(`id`) ON DELETE SET NULL, `source_cinema_project_id` text, `schema_version` integer NOT NULL, `data_json` text NOT NULL, `approved_by` text, `approved_at` text, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_creative_projects_art_type_idx` ON `aethera_creative_projects` (`art_type`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `aethera_creative_projects_cinema_idx` ON `aethera_creative_projects` (`source_cinema_project_id`);
