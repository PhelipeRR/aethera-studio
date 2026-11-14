CREATE TABLE content_publication_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL REFERENCES content_publication_packages(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  package_version INTEGER NOT NULL,
  decision TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
