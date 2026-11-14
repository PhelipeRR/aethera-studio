CREATE TABLE rag_documents (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL,
  path text NOT NULL,
  content_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'indexed',
  indexed_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT rag_documents_status_check CHECK(status IN ('indexed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX rag_documents_project_path_unique ON rag_documents (project_id, path);
--> statement-breakpoint
CREATE TABLE rag_chunks (
  id text PRIMARY KEY NOT NULL,
  document_id text NOT NULL,
  project_id text NOT NULL,
  content text NOT NULL,
  symbol text,
  start_line integer NOT NULL,
  end_line integer NOT NULL,
  chunk_index integer NOT NULL,
  content_hash text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX rag_chunks_project_idx ON rag_chunks (project_id);
--> statement-breakpoint
CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(content, symbol, content='rag_chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rowid, content, symbol) VALUES (new.rowid, new.content, new.symbol); END;
--> statement-breakpoint
CREATE TRIGGER rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, symbol) VALUES ('delete', old.rowid, old.content, old.symbol); END;
--> statement-breakpoint
CREATE TRIGGER rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, symbol) VALUES ('delete', old.rowid, old.content, old.symbol); INSERT INTO rag_chunks_fts(rowid, content, symbol) VALUES (new.rowid, new.content, new.symbol); END;
