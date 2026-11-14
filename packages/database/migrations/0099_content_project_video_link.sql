ALTER TABLE `content_projects` ADD `video_project_id` text REFERENCES `projects`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `content_projects_video_project_idx` ON `content_projects` (`video_project_id`);
