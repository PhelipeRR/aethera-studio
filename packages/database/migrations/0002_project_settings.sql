ALTER TABLE `projects` ADD `preferred_agent` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `rules` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `stack` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `detected_at` text;