CREATE TABLE `aethera_media_proxies` (`id` text PRIMARY KEY NOT NULL, `asset_id` text NOT NULL REFERENCES `velix_local_assets`(`id`) ON DELETE CASCADE, `original_hash` text NOT NULL, `relative_path` text NOT NULL, `width` integer NOT NULL, `height` integer NOT NULL, `fps` real NOT NULL, `codec` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_media_proxies_asset_hash_idx` ON `aethera_media_proxies` (`asset_id`,`original_hash`);
--> statement-breakpoint
CREATE INDEX `aethera_media_proxies_asset_idx` ON `aethera_media_proxies` (`asset_id`);
