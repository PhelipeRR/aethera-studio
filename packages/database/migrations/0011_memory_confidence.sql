ALTER TABLE memories ADD COLUMN confidence TEXT NOT NULL DEFAULT 'unverified';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memories_confidence_idx ON memories(confidence);
