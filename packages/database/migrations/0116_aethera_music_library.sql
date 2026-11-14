CREATE TABLE `aethera_music_library` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `aethera_music_library_project_track_idx` ON `aethera_music_library` (`project_id`,`id`);
--> statement-breakpoint
CREATE INDEX `aethera_music_library_project_idx` ON `aethera_music_library` (`project_id`,`updated_at`);
