import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSeedState } from '../src/domain/seed-data';
import type {
  AgentProviderConfig,
  AgentRunRecord,
  BrandKit,
  ChannelConfig,
  ConsoleLogEntry,
  CreativeArtProject,
  MediaAsset,
  ProductionProject,
  RenderJob,
  StudioPreferences,
  TrendIdea,
} from '../src/domain/types';

export class AetheraDatabase {
  public readonly dbPath: string;
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
    this.seedIfEmpty();
  }

  public raw(): DatabaseSync {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_projects (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS brand_kits (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS creative_projects (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        added_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_providers (
        id TEXT PRIMARY KEY,
        priority INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS console_logs (
        id TEXT PRIMARY KEY,
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL
      );
    `.replace('id TEXT PRIMARY KEY,\n        seq INTEGER PRIMARY KEY AUTOINCREMENT,', 'seq INTEGER PRIMARY KEY AUTOINCREMENT,\n        id TEXT UNIQUE NOT NULL,'));

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trend_ideas (
        id TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS studio_kv (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS social_publications (
        id TEXT PRIMARY KEY,
        publication_id TEXT UNIQUE NOT NULL,
        batch_series_id TEXT,
        status TEXT NOT NULL,
        scheduled_at TEXT,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS social_publish_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        publication_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
  }

  private seedIfEmpty(): void {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM studio_projects').get() as { cnt: number };
    if (row.cnt > 0) return;
    this.applySeed();
  }

  public resetWorkspace(): void {
    this.db.exec(`
      DELETE FROM studio_projects;
      DELETE FROM channels;
      DELETE FROM brand_kits;
      DELETE FROM creative_projects;
      DELETE FROM media_assets;
      DELETE FROM render_jobs;
      DELETE FROM agent_providers;
      DELETE FROM agent_runs;
      DELETE FROM console_logs;
      DELETE FROM trend_ideas;
      DELETE FROM studio_kv;
    `);
    this.applySeed();
  }

  private applySeed(): void {
    const seed = createSeedState();
    for (const p of seed.projects) this.upsertProject(p);
    for (const ch of seed.channels) this.upsertChannel(ch);
    for (const bk of seed.brandKits) this.upsertBrandKit(bk);
    for (const cp of seed.creativeProjects) this.upsertCreativeProject(cp);
    for (const ma of seed.mediaAssets) this.upsertMediaAsset(ma);
    for (const ap of seed.agentProviders) this.upsertAgentProvider(ap);
    for (const idea of seed.trendIdeas) this.upsertTrendIdea(idea);
    // Insert logs oldest-first so newest has highest seq
    for (const log of [...seed.consoleLogs].reverse()) this.insertConsoleLog(log);
    this.setPreferences(seed.preferences);
  }

  // Projects
  public listProjects(): ProductionProject[] {
    const rows = this.db
      .prepare('SELECT payload FROM studio_projects ORDER BY updated_at DESC, created_at DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as ProductionProject);
  }

  public getProject(id: string): ProductionProject | null {
    const row = this.db.prepare('SELECT payload FROM studio_projects WHERE id = ?').get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as ProductionProject) : null;
  }

  public upsertProject(project: ProductionProject): ProductionProject {
    this.db
      .prepare(
        `INSERT INTO studio_projects (id, created_at, updated_at, payload)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
      )
      .run(project.id, project.createdAt, project.updatedAt, JSON.stringify(project));
    return project;
  }

  // Channels
  public listChannels(): ChannelConfig[] {
    const rows = this.db
      .prepare('SELECT payload FROM channels ORDER BY created_at DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as ChannelConfig);
  }

  public upsertChannel(channel: ChannelConfig): ChannelConfig {
    this.db
      .prepare(
        `INSERT INTO channels (id, created_at, updated_at, payload)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
      )
      .run(channel.id, channel.createdAt, channel.updatedAt, JSON.stringify(channel));
    return channel;
  }

  // Brand Kits
  public listBrandKits(): BrandKit[] {
    const rows = this.db.prepare('SELECT payload FROM brand_kits').all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as BrandKit);
  }

  public upsertBrandKit(kit: BrandKit): BrandKit {
    this.db
      .prepare(
        `INSERT INTO brand_kits (id, payload) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(kit.id, JSON.stringify(kit));
    return kit;
  }

  // Creative Projects
  public listCreativeProjects(): CreativeArtProject[] {
    const rows = this.db
      .prepare('SELECT payload FROM creative_projects ORDER BY created_at DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as CreativeArtProject);
  }

  public getCreativeProject(id: string): CreativeArtProject | null {
    const row = this.db.prepare('SELECT payload FROM creative_projects WHERE id = ?').get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as CreativeArtProject) : null;
  }

  public upsertCreativeProject(art: CreativeArtProject): CreativeArtProject {
    this.db
      .prepare(
        `INSERT INTO creative_projects (id, created_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(art.id, art.createdAt, JSON.stringify(art));
    return art;
  }

  // Media Assets
  public listMediaAssets(): MediaAsset[] {
    const rows = this.db
      .prepare('SELECT payload FROM media_assets ORDER BY added_at DESC, id DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as MediaAsset);
  }

  public upsertMediaAsset(asset: MediaAsset): MediaAsset {
    this.db
      .prepare(
        `INSERT INTO media_assets (id, added_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(asset.id, asset.addedAt, JSON.stringify(asset));
    return asset;
  }

  // Render Jobs
  public listRenderJobs(): RenderJob[] {
    const rows = this.db
      .prepare('SELECT payload FROM render_jobs ORDER BY started_at DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as RenderJob);
  }

  public getRenderJob(id: string): RenderJob | null {
    const row = this.db.prepare('SELECT payload FROM render_jobs WHERE id = ?').get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as RenderJob) : null;
  }

  public upsertRenderJob(job: RenderJob): RenderJob {
    this.db
      .prepare(
        `INSERT INTO render_jobs (id, project_id, started_at, payload) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      )
      .run(job.id, job.projectId, job.startedAt, JSON.stringify(job));
    return job;
  }

  // Agent Providers
  public listAgentProviders(): AgentProviderConfig[] {
    const rows = this.db
      .prepare('SELECT payload FROM agent_providers ORDER BY priority ASC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as AgentProviderConfig);
  }

  public upsertAgentProvider(provider: AgentProviderConfig): AgentProviderConfig {
    this.db
      .prepare(
        `INSERT INTO agent_providers (id, priority, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET priority = excluded.priority, payload = excluded.payload`,
      )
      .run(provider.id, provider.priority, JSON.stringify(provider));
    return provider;
  }

  // Agent Runs
  public listAgentRuns(limit = 40): AgentRunRecord[] {
    const rows = this.db
      .prepare('SELECT payload FROM agent_runs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as AgentRunRecord);
  }

  public insertAgentRun(run: AgentRunRecord): AgentRunRecord {
    this.db
      .prepare('INSERT OR REPLACE INTO agent_runs (id, created_at, payload) VALUES (?, ?, ?)')
      .run(run.id, run.createdAt, JSON.stringify(run));
    return run;
  }

  // Trend Ideas
  public listTrendIdeas(): TrendIdea[] {
    const rows = this.db
      .prepare('SELECT payload FROM trend_ideas ORDER BY score DESC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as TrendIdea);
  }

  public upsertTrendIdea(idea: TrendIdea): TrendIdea {
    this.db
      .prepare(
        `INSERT INTO trend_ideas (id, score, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET score = excluded.score, payload = excluded.payload`,
      )
      .run(idea.id, idea.score, JSON.stringify(idea));
    return idea;
  }

  // Console Logs
  public listConsoleLogs(limit = 150): ConsoleLogEntry[] {
    const rows = this.db
      .prepare('SELECT payload FROM console_logs ORDER BY seq DESC LIMIT ?')
      .all(limit) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as ConsoleLogEntry);
  }

  public insertConsoleLog(entry: ConsoleLogEntry): ConsoleLogEntry {
    this.db
      .prepare('INSERT OR IGNORE INTO console_logs (id, payload) VALUES (?, ?)')
      .run(entry.id, JSON.stringify(entry));
    return entry;
  }

  public clearConsoleLogs(): void {
    this.db.exec('DELETE FROM console_logs;');
  }

  // Preferences
  public getPreferences(): StudioPreferences {
    const row = this.db
      .prepare("SELECT payload FROM studio_kv WHERE key = 'preferences'")
      .get() as { payload: string } | undefined;
    if (row) return JSON.parse(row.payload) as StudioPreferences;
    return {
      defaultTtsProvider: 'voicestudio',
      defaultQuality: 'review_720p',
      defaultLanguage: 'pt-BR',
      autoAdvancePipeline: false,
    };
  }

  public setPreferences(prefs: StudioPreferences): StudioPreferences {
    this.db
      .prepare(
        `INSERT INTO studio_kv (key, payload) VALUES ('preferences', ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      )
      .run(JSON.stringify(prefs));
    return prefs;
  }

  // Cloud Social Publishing Hub & Unified Calendar (persists across restarts & offline Desktop/Remote Host)
  public listSocialPublications(): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare('SELECT payload FROM social_publications ORDER BY COALESCE(scheduled_at, updated_at) ASC')
      .all() as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as Record<string, unknown>);
  }

  public getSocialPublication(id: string): Record<string, unknown> | null {
    const row = this.db
      .prepare('SELECT payload FROM social_publications WHERE id = ? OR publication_id = ?')
      .get(id, id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Record<string, unknown>) : null;
  }

  public upsertSocialPublication(pub: Record<string, unknown>): Record<string, unknown> {
    const id = String(pub.id ?? pub.publicationId);
    const pubId = String(pub.publicationId ?? id);
    const batchSeriesId = typeof pub.batchSeriesId === 'string' ? pub.batchSeriesId : null;
    const status = String(pub.status ?? 'draft');
    const scheduledAt = typeof pub.scheduledPublishAtIso === 'string' ? pub.scheduledPublishAtIso : null;
    const updatedAt = String(pub.updatedAt ?? new Date().toISOString());
    this.db
      .prepare(
        `INSERT INTO social_publications (id, publication_id, batch_series_id, status, scheduled_at, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           batch_series_id = excluded.batch_series_id,
           status = excluded.status,
           scheduled_at = excluded.scheduled_at,
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(id, pubId, batchSeriesId, status, scheduledAt, updatedAt, JSON.stringify(pub));
    return pub;
  }

  public hasSocialIdempotencyKey(key: string): boolean {
    const row = this.db
      .prepare('SELECT 1 as ok FROM social_publish_idempotency WHERE idempotency_key = ?')
      .get(key) as { ok: number } | undefined;
    return Boolean(row?.ok);
  }

  public recordSocialIdempotencyKey(key: string, publicationId: string, platform: string, result: unknown): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO social_publish_idempotency (idempotency_key, publication_id, platform, executed_at, result_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, publicationId, platform, new Date().toISOString(), JSON.stringify(result));
  }

  public close(): void {
    this.db.close();
  }
}
