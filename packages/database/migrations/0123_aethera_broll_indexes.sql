CREATE TABLE `aethera_broll_indexes` (`asset_id` text PRIMARY KEY NOT NULL REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `index_version` text NOT NULL, `source_hash` text NOT NULL, `status` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_broll_indexes_status_idx` ON `aethera_broll_indexes` (`status`,`updated_at`);
