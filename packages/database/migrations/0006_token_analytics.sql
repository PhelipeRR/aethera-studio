CREATE TABLE IF NOT EXISTS token_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES task_steps(id) ON DELETE CASCADE,
  agent TEXT CHECK (agent IN ('claude', 'codex')),
  estimated_context_tokens INTEGER,
  reported_input_tokens INTEGER,
  reported_output_tokens INTEGER,
  cached_tokens INTEGER,
  cost_usd REAL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS token_analytics_task_idx ON token_analytics(task_id, id);
