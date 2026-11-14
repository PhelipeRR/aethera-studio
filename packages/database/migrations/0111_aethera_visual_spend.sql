CREATE TABLE `aethera_vision_spend` (`run_id` text PRIMARY KEY NOT NULL REFERENCES `velix_production_runs`(`id`) ON DELETE CASCADE, `amount_usd` real NOT NULL DEFAULT 0, `updated_at` text NOT NULL);
