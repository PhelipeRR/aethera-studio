CREATE TABLE `aethera_vision_benchmarks` (`id` text PRIMARY KEY NOT NULL, `dataset_version` text NOT NULL, `category` text NOT NULL, `synthetic` integer NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `aethera_vision_benchmarks_dataset_idx` ON `aethera_vision_benchmarks` (`dataset_version`, `category`);
