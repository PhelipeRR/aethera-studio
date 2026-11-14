ALTER TABLE `velix_media_references` ADD COLUMN `review_status` text NOT NULL DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE `velix_media_references` ADD COLUMN `idea_id` text;
--> statement-breakpoint
ALTER TABLE `velix_media_references` ADD COLUMN `agent` text;
--> statement-breakpoint
ALTER TABLE `velix_media_references` ADD COLUMN `execution_id` text;
