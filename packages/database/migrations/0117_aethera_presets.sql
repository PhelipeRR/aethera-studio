CREATE TABLE `aethera_presets` (`id` text PRIMARY KEY NOT NULL, `version` integer NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_presets_id_version_idx` ON `aethera_presets` (`id`,`version`);
