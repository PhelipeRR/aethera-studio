CREATE TABLE `workflow_templates` (`id` text PRIMARY KEY NOT NULL, `version` integer NOT NULL, `name` text NOT NULL, `category` text NOT NULL, `description` text NOT NULL, `requirements` text NOT NULL, `definition` text NOT NULL, `source` text NOT NULL DEFAULT 'builtin', `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL);
--> statement-breakpoint
CREATE TABLE `workflow_template_favorites` (`template_id` text NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE, `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, PRIMARY KEY (`template_id`));
--> statement-breakpoint
ALTER TABLE `workflows` ADD `template_id` text;
--> statement-breakpoint
ALTER TABLE `workflows` ADD `template_version` integer;
