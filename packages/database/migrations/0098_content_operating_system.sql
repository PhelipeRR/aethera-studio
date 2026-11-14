CREATE TABLE `content_channels` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `name` text NOT NULL, `niche` text NOT NULL DEFAULT '', `audience` text NOT NULL DEFAULT '', `tone` text NOT NULL DEFAULT '', `autonomy` text NOT NULL DEFAULT 'assisted', `identity_json` text NOT NULL DEFAULT '{}', `editorial_strategy_json` text NOT NULL DEFAULT '{}', `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `content_channels_workspace_idx` ON `content_channels` (`workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `content_projects` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `channel_id` text REFERENCES `content_channels`(`id`) ON DELETE SET NULL, `title` text NOT NULL, `status` text NOT NULL DEFAULT 'active', `autonomy` text NOT NULL DEFAULT 'assisted', `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `content_projects_workspace_idx` ON `content_projects` (`workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `content_projects_channel_idx` ON `content_projects` (`channel_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `content_executions` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `content_projects`(`id`) ON DELETE CASCADE, `status` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `content_executions_project_idx` ON `content_executions` (`project_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `content_publication_packages` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `content_projects`(`id`) ON DELETE CASCADE, `version` integer NOT NULL, `title` text NOT NULL DEFAULT '', `description` text NOT NULL DEFAULT '', `tags_json` text NOT NULL DEFAULT '[]', `chapters_json` text NOT NULL DEFAULT '[]', `thumbnail_asset_id` text, `status` text NOT NULL DEFAULT 'draft', `created_at` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_publication_packages_project_version_idx` ON `content_publication_packages` (`project_id`, `version`);
--> statement-breakpoint
CREATE INDEX `content_publication_packages_project_idx` ON `content_publication_packages` (`project_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `content_publications` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `content_projects`(`id`) ON DELETE CASCADE, `package_id` text NOT NULL REFERENCES `content_publication_packages`(`id`) ON DELETE RESTRICT, `platform` text NOT NULL, `visibility` text NOT NULL, `status` text NOT NULL, `approval_required` integer NOT NULL DEFAULT 1, `scheduled_at` text, `published_at` text);
--> statement-breakpoint
CREATE INDEX `content_publications_project_idx` ON `content_publications` (`project_id`, `status`);
