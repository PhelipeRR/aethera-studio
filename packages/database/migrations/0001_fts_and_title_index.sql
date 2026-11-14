-- Hand-written: drizzle-kit does not generate FTS5 tables, triggers or multi-argument expression indexes.

-- One live memory per title and project (global memories share the '' bucket), case-insensitive.
CREATE UNIQUE INDEX `memories_live_title_unique` ON `memories` (coalesce(`project_id`, ''), lower(`title`)) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
-- External-content FTS5 index over title and content, keyed on the stable integer `seq`.
CREATE VIRTUAL TABLE `memories_fts` USING fts5(
	title,
	content,
	content='memories',
	content_rowid='seq',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `memories_fts_ai` AFTER INSERT ON `memories` BEGIN
	INSERT INTO memories_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `memories_fts_ad` AFTER DELETE ON `memories` BEGIN
	INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `memories_fts_au` AFTER UPDATE OF title, content ON `memories` BEGIN
	INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
	INSERT INTO memories_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;
--> statement-breakpoint
-- Index rows that existed before this migration.
INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');
