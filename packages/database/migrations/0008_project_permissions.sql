ALTER TABLE `projects` ADD `permission_level` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `allowed_commands` text DEFAULT '[]' NOT NULL;