CREATE TABLE `idempotency_keys` (`scope` text NOT NULL, `key` text NOT NULL, `fingerprint` text NOT NULL, `state` text NOT NULL DEFAULT 'in_progress', `status_code` integer, `response` text, `created_at` text NOT NULL, `expires_at` text NOT NULL, PRIMARY KEY(`scope`, `key`));
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expiry_idx` ON `idempotency_keys` (`expires_at`);
