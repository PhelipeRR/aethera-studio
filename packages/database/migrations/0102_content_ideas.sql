CREATE TABLE `content_ideas` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `channel_id` text REFERENCES `content_channels`(`id`) ON DELETE SET NULL, `title` text NOT NULL, `angle` text NOT NULL DEFAULT '', `source` text NOT NULL DEFAULT 'manual', `status` text NOT NULL DEFAULT 'new', `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `content_ideas_workspace_idx` ON `content_ideas` (`workspace_id`, `updated_at`);
