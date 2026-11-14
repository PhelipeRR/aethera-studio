CREATE TABLE `imported_conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `agent` text NOT NULL,
  `external_id` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `source_path` text NOT NULL,
  `source_hash` text NOT NULL,
  `project_id` text,
  `project_path` text,
  `association` text DEFAULT 'unassociated' NOT NULL,
  `updated_at` text,
  `imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imported_conversations_agent_external` ON `imported_conversations` (`agent`,`external_id`);
--> statement-breakpoint
CREATE INDEX `imported_conversations_project_idx` ON `imported_conversations` (`project_id`,`updated_at`);
