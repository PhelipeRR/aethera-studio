CREATE TABLE rag_embeddings (
  chunk_id text PRIMARY KEY NOT NULL,
  model text NOT NULL,
  dim integer NOT NULL,
  vector blob NOT NULL,
  content_hash text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
);
