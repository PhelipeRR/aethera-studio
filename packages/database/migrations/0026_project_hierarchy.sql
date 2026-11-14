CREATE TABLE `git_repositories` (
  `id` text PRIMARY KEY NOT NULL,
  `git_root` text NOT NULL,
  `kind` text DEFAULT 'repository' NOT NULL,
  `last_verified_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_repositories_root_unique` ON `git_repositories` (`git_root`);
--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text DEFAULT 'project' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `parent_project_id` text REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `detection_confidence` integer;
--> statement-breakpoint
ALTER TABLE `projects` ADD `detection_evidence` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `detection_source` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `git_repository_id` text REFERENCES git_repositories(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `projects_parent_idx` ON `projects` (`parent_project_id`);
--> statement-breakpoint
CREATE TABLE `project_discovery_overrides` (
  `path` text PRIMARY KEY NOT NULL,
  `classification` text NOT NULL,
  `parent_path` text,
  `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
