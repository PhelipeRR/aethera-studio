import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  accessLog,
  DatabaseUnavailableError,
  classifyDatabaseFailure,
  embeddings,
  links,
  memories,
  memoryTags,
  memoryVersions,
  openDatabase,
  projects,
  tags,
  type DatabaseHandle,
} from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
const EXPECTED_TABLES = [
  'access_log',
  'aethera_director_plans',
  'aethera_editorial_plans',
  'aethera_editorial_policies',
  'aethera_media_acquisitions',
  'aethera_media_candidates',
  'aethera_media_editorial_decisions',
  'aethera_media_provenance',
  'aethera_media_proxies',
  'aethera_media_segments',
  'aethera_media_usage_events',
  'aethera_music_library',
  'aethera_narration_directions',
  'aethera_presets',
  'aethera_review_reports',
  'aethera_subject_identities',
  'aethera_subjects',
  'aethera_timelines',
  'aethera_vision_benchmarks',
  'aethera_vision_cache',
  'aethera_vision_spend',
  'aethera_voice_authorizations',
  'aethera_voice_presets',
  'autonomous_mission_tasks',
  'autonomous_missions',
  'azure_devops_cache',
  'azure_devops_connections',
  'companion_events',
  'companion_sessions',
  'content_analytics_snapshots',
  'content_channels',
  'content_executions',
  'content_ideas',
  'content_projects',
  'content_publication_approvals',
  'content_publication_packages',
  'content_publications',
  'core_audit',
  'core_devices',
  'core_pairings',
  'core_proof_ids',
  'core_tokens',
  'embeddings',
  'execution_snapshots',
  'extensions',
  'git_automation_events',
  'git_automations',
  'git_ref_cursors',
  'git_repositories',
  'idempotency_keys',
  'imported_conversations',
  'learning_candidates',
  'links',
  'memories',
  'memories_fts',
  'memory_sources',
  'memory_tags',
  'memory_versions',
  'neura_action_audits',
  'neura_sessions',
  'neura_suggestions',
  'personal_accounts',
  'personal_automation_runs',
  'personal_automations',
  'personal_notification_prefs',
  'personal_notifications',
  'personal_processed_events',
  'personal_sync_state',
  'project_discovery_overrides',
  'project_profiles',
  'projects',
  'rag_chunks',
  'rag_chunks_fts',
  'rag_documents',
  'rag_embeddings',
  'settings',
  'tags',
  'task_capacity_waits',
  'task_events',
  'task_evidence',
  'task_steps',
  'tasks',
  'token_analytics',
  'velix_agenda_items',
  'velix_brand_identities',
  'velix_claim_evidence',
  'velix_clip_suggestions',
  'velix_collage_jobs',
  'velix_derivatives',
  'velix_discovery_searches',
  'velix_editorial_claims',
  'velix_editorial_decisions',
  'velix_editorial_versions',
  'velix_local_assets',
  'velix_media_analyses',
  'velix_media_references',
  'velix_media_rights', 'velix_motion_jobs', 'velix_motion_projects',
  'velix_niche_references',
  'velix_production_approvals',
  'velix_production_artifacts',
  'velix_production_budgets',
  'velix_production_ideas',
  'velix_production_runs',
  'velix_production_stages',
  'velix_publication_jobs',
  'velix_publications',
  'velix_quality_reports',
  'velix_research_cache',
  'velix_storyboards',
  'velix_video_styles',
  'video_assets',
  'video_compositions',
  'video_projects',
  'video_render_jobs',
  'workflow_checkpoints',
  'workflow_run_steps',
  'workflow_runs',
  'workflow_step_attempts',
  'workflow_template_favorites',
  'workflow_templates',
  'workflows',
];

const open: DatabaseHandle[] = [];
afterEach(() => {
  while (open.length) open.pop()?.close();
});

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'nb-db-')), 'db', 'brain.db');
}

function openAt(file: string, migrationsFolder = MIGRATIONS): DatabaseHandle {
  const handle = openDatabase(file, { migrationsFolder });
  open.push(handle);
  return handle;
}

function close(handle: DatabaseHandle): void {
  handle.close();
  open.splice(open.indexOf(handle), 1);
}

function tableNames(handle: DatabaseHandle): string[] {
  return handle.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts_%' AND name NOT LIKE '__drizzle%' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function addMemory(handle: DatabaseHandle, id: string, title: string, content: string, projectId: string | null = null): void {
  handle.db.insert(memories).values({ id, title, content, type: 'decision', projectId, sourceKind: 'user' }).run();
}

function ftsHits(handle: DatabaseHandle, query: string): string[] {
  return handle.sqlite
    .prepare('SELECT m.id FROM memories_fts f JOIN memories m ON m.seq = f.rowid WHERE memories_fts MATCH ? ORDER BY m.id')
    .all(query)
    .map((row) => (row as { id: string }).id);
}

/** Copies the first `count` migrations into a new folder, as an older app version would have shipped them. */
function olderMigrations(count: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'nb-migrations-'));
  mkdirSync(join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  return folder;
}

function migrationCount(): number {
  return (JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;
}

describe('openDatabase', () => {
  it('creates the file, its folder and the full schema on first open', () => {
    const file = tempFile();
    const handle = openAt(file);
    expect(existsSync(file)).toBe(true);
    expect(tableNames(handle)).toEqual(EXPECTED_TABLES);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('keeps data across reopen without re-running migrations', () => {
    const file = tempFile();
    const first = openAt(file);
    first.db.insert(projects).values({ id: 'p1', name: 'api', rootPath: 'C:\\src\\api' }).run();
    const applied = first.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number };
    close(first);

    const second = openAt(file);
    expect(second.db.select().from(projects).all()).toHaveLength(1);
    expect(second.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(applied);
  });

  // One full upgrade per migration, so its cost grows with the history and is not a hang under parallel load.
  it('upgrades databases created by every earlier set of migrations', { timeout: 90_000 }, () => {
    expect(migrationCount()).toBeGreaterThan(1);
    for (let count = 1; count < migrationCount(); count++) {
      const file = tempFile();
      const old = openAt(file, olderMigrations(count));
      old.sqlite.prepare("INSERT INTO projects (id, name, root_path) VALUES ('p1', 'api', 'C:\\src\\api')").run();
      close(old);

      const upgraded = openAt(file);
      expect(tableNames(upgraded)).toEqual(EXPECTED_TABLES);
      expect(upgraded.db.select().from(projects).all()).toHaveLength(1);
      close(upgraded);
    }
  });

  it('reports a corrupted file as a typed, recoverable error', () => {
    const file = tempFile();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'this is not a sqlite database, just some bytes that fill the header area');
    expect(() => openAt(file)).toThrow(DatabaseUnavailableError);
    try {
      openAt(file);
    } catch (error) {
      expect((error as DatabaseUnavailableError).reason).toBe('corrupt');
      expect((error as DatabaseUnavailableError).file).toBe(file);
    }
  });

  it('reports an unusable location as an io error', () => {
    const parent = mkdtempSync(join(tmpdir(), 'nb-db-'));
    writeFileSync(join(parent, 'db'), 'a file where the folder should be');
    try {
      openAt(join(parent, 'db', 'brain.db'));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect((error as DatabaseUnavailableError).reason).toBe('io');
    }
  });

  it('reports a failing migration as a migration failure and leaves the previous data in place', () => {
    const file = tempFile();
    close(openAt(file));
    const folder = join(mkdtempSync(join(tmpdir(), 'nb-migrations-')), 'migrations');
    cpSync(MIGRATIONS, folder, { recursive: true });
    const journalFile = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };
    const last = journal.entries.at(-1);
    if (!last) throw new Error('no migrations');
    journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1, tag: '9999_broken', breakpoints: true });
    writeFileSync(journalFile, JSON.stringify(journal));
    writeFileSync(join(folder, '9999_broken.sql'), 'ALTER TABLE `does_not_exist` ADD `x` text;');
    try {
      openDatabase(file, { migrationsFolder: folder });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect((error as DatabaseUnavailableError).reason).toBe('migration');
    }
    const reopened = openAt(file);
    expect(tableNames(reopened)).toEqual(EXPECTED_TABLES);
    close(reopened);
  });

  it.each([
    [{ code: 'SQLITE_FULL', message: 'database or disk is full' }, 'disk-full'],
    [{ code: 'ENOSPC', message: 'no space left on device' }, 'disk-full'],
    [{ code: 'SQLITE_BUSY', message: 'database is locked' }, 'locked'],
    [{ code: 'SQLITE_CORRUPT', message: 'malformed' }, 'corrupt'],
    [{ code: 'EACCES', message: 'permission denied' }, 'io'],
    [new Error('something else'), 'unknown'],
  ])('classifies %o as %s', (error, reason) => {
    expect(classifyDatabaseFailure(error)).toBe(reason);
  });
});

describe('schema integrity', () => {
  it('rejects links from a memory that does not exist', () => {
    const handle = openAt(tempFile());
    expect(() => handle.db.insert(links).values({ sourceId: 'missing', targetTitle: 'X' }).run()).toThrow(/FOREIGN KEY/);
  });

  it('deleting a memory removes everything that belongs to it and leaves incoming links pending', () => {
    const handle = openAt(tempFile());
    addMemory(handle, 'm1', 'Cache strategy', 'Use [[Redis]]');
    addMemory(handle, 'm2', 'Redis', 'In-memory store');
    handle.db.insert(links).values({ sourceId: 'm1', targetId: 'm2', targetTitle: 'Redis' }).run();
    handle.db.insert(links).values({ sourceId: 'm2', targetTitle: 'Cache strategy' }).run();
    const tag = handle.db.insert(tags).values({ name: 'infra' }).returning().get();
    handle.db.insert(memoryTags).values({ memoryId: 'm2', tagId: tag.id }).run();
    handle.db.insert(memoryVersions).values({ memoryId: 'm2', version: 1, title: 'Redis', content: 'In-memory store', type: 'decision', tags: '[]', changedBy: 'user' }).run();
    handle.db.insert(embeddings).values({ memoryId: 'm2', model: 'e5-small', dim: 2, vector: Buffer.from(new Float32Array([0.1, 0.2]).buffer), contentHash: 'h' }).run();
    handle.db.insert(accessLog).values({ memoryId: 'm2', client: 'electron', action: 'recall' }).run();

    handle.db.delete(memories).where(eq(memories.id, 'm2')).run();

    expect(handle.db.select().from(links).all()).toEqual([expect.objectContaining({ sourceId: 'm1', targetId: null, targetTitle: 'Redis' })]);
    expect(handle.db.select().from(memoryTags).all()).toHaveLength(0);
    expect(handle.db.select().from(memoryVersions).all()).toHaveLength(0);
    expect(handle.db.select().from(embeddings).all()).toHaveLength(0);
    expect(handle.db.select().from(accessLog).all()).toHaveLength(0);
  });

  it('deleting a project deletes its memories but keeps global ones', () => {
    const handle = openAt(tempFile());
    handle.db.insert(projects).values({ id: 'p1', name: 'api', rootPath: 'C:\\src\\api' }).run();
    addMemory(handle, 'm1', 'Project rule', 'x', 'p1');
    addMemory(handle, 'm2', 'Global rule', 'y');
    handle.db.delete(projects).where(eq(projects.id, 'p1')).run();
    expect(handle.db.select({ id: memories.id }).from(memories).all()).toEqual([{ id: 'm2' }]);
  });

  it('allows one live memory per title and project, ignoring case', () => {
    const handle = openAt(tempFile());
    handle.db.insert(projects).values({ id: 'p1', name: 'api', rootPath: 'C:\\src\\api' }).run();
    addMemory(handle, 'm1', 'Logging', 'a');
    expect(() => addMemory(handle, 'm2', 'logging', 'b')).toThrow(/UNIQUE/);
    expect(() => addMemory(handle, 'm3', 'Logging', 'c', 'p1')).not.toThrow();
    handle.db.update(memories).set({ deletedAt: '2026-10-28T00:00:00.000Z' }).where(eq(memories.id, 'm1')).run();
    expect(() => addMemory(handle, 'm4', 'Logging', 'd')).not.toThrow();
  });

  it('rejects values outside the allowed memory types and trust states', () => {
    const handle = openAt(tempFile());
    expect(() =>
      handle.sqlite.prepare("INSERT INTO memories (id, title, content, type, source_kind) VALUES ('x', 't', 'c', 'gossip', 'user')").run(),
    ).toThrow(/CHECK/);
    expect(() =>
      handle.sqlite.prepare("INSERT INTO memories (id, title, content, type, source_kind, trust) VALUES ('x', 't', 'c', 'decision', 'user', 'maybe')").run(),
    ).toThrow(/CHECK/);
  });
});

describe('full-text index', () => {
  it('stays in sync on insert, update and delete, ignoring accents and case', () => {
    const handle = openAt(tempFile());
    addMemory(handle, 'm1', 'Decisão de migração', 'Usar Drizzle com migrações versionadas');
    expect(ftsHits(handle, 'decisao')).toEqual(['m1']);
    expect(ftsHits(handle, 'DRIZZLE')).toEqual(['m1']);

    handle.db.update(memories).set({ content: 'Trocar para Kysely' }).where(eq(memories.id, 'm1')).run();
    expect(ftsHits(handle, 'drizzle')).toEqual([]);
    expect(ftsHits(handle, 'kysely')).toEqual(['m1']);

    handle.db.delete(memories).where(eq(memories.id, 'm1')).run();
    expect(ftsHits(handle, 'kysely')).toEqual([]);
  });

  it('survives VACUUM, which may renumber implicit rowids', () => {
    const handle = openAt(tempFile());
    for (let i = 0; i < 20; i++) addMemory(handle, `m${String(i).padStart(2, '0')}`, `Nota ${i}`, `conteúdo ${i}`);
    handle.db.delete(memories).where(eq(memories.id, 'm03')).run();
    handle.sqlite.exec('VACUUM');
    expect(ftsHits(handle, '"Nota 7"')).toEqual(['m07']);
    expect(handle.sqlite.prepare("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)").run()).toBeTruthy();
  });
});
