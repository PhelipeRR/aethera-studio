CREATE TABLE `core_devices` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `platform` text NOT NULL, `app_version` text NOT NULL, `public_key` text NOT NULL, `key_thumbprint` text NOT NULL, `grant_json` text NOT NULL, `paired_at` text NOT NULL, `last_seen_at` text, `revoked_at` text);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_devices_thumbprint_idx` ON `core_devices` (`key_thumbprint`);
--> statement-breakpoint
CREATE TABLE `core_pairings` (`id` text PRIMARY KEY NOT NULL, `code_hash` text NOT NULL, `grant_json` text NOT NULL, `state` text NOT NULL, `device_name` text, `platform` text, `app_version` text, `public_key` text, `device_id` text, `created_at` text NOT NULL, `expires_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_pairings_code_idx` ON `core_pairings` (`code_hash`);
--> statement-breakpoint
CREATE TABLE `core_tokens` (`token_hash` text PRIMARY KEY NOT NULL, `device_id` text NOT NULL REFERENCES `core_devices`(`id`) ON DELETE CASCADE, `family_id` text NOT NULL, `kind` text NOT NULL, `expires_at` text NOT NULL, `used_at` text, `revoked_at` text, `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `core_tokens_device_idx` ON `core_tokens` (`device_id`, `family_id`);
--> statement-breakpoint
CREATE TABLE `core_proof_ids` (`jti` text PRIMARY KEY NOT NULL, `expires_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `core_audit` (`id` text PRIMARY KEY NOT NULL, `at` text NOT NULL, `action` text NOT NULL, `principal_kind` text NOT NULL, `principal_id` text NOT NULL, `principal_label` text, `target` text, `outcome` text NOT NULL, `detail` text);
--> statement-breakpoint
CREATE INDEX `core_audit_at_idx` ON `core_audit` (`at`);
