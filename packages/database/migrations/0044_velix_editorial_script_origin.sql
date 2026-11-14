ALTER TABLE `velix_editorial_versions` ADD COLUMN `source_version_id` text REFERENCES `velix_editorial_versions`(`id`) ON DELETE SET NULL;
