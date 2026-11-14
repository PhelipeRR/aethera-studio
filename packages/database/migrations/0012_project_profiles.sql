CREATE TABLE `project_profiles` (
	`project_id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
