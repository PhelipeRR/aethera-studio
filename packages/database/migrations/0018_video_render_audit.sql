ALTER TABLE `video_render_jobs` ADD COLUMN `origin` text NOT NULL DEFAULT 'studio';
--> statement-breakpoint
ALTER TABLE `video_render_jobs` ADD COLUMN `agent` text;
