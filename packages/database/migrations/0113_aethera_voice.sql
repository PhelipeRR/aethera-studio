CREATE TABLE `aethera_voice_presets` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `aethera_voice_authorizations` (`id` text PRIMARY KEY NOT NULL, `preset_id` text NOT NULL REFERENCES `aethera_voice_presets`(`id`) ON DELETE CASCADE, `project_id` text NOT NULL REFERENCES `video_projects`(`id`) ON DELETE CASCADE, `data_json` text NOT NULL, `granted_at` text NOT NULL, `revoked_at` text);
--> statement-breakpoint
CREATE TABLE `aethera_narration_directions` (`run_id` text NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `scene_id` text NOT NULL, `data_json` text NOT NULL, PRIMARY KEY(`run_id`, `scene_id`));
