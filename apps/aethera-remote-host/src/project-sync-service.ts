import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Response } from 'express';
import {
  REMOTE_CONTRACT_VERSION,
  type ResolveSyncConflictRequest,
  type SyncActor,
  type SyncBackupSummary,
  type SyncChangeEvent,
  type SyncConflictPayload,
  type SyncedMediaRef,
  type SyncedProjectData,
  type SyncedProjectRecord,
  type SyncedSceneItem,
  type SyncChangesResponse,
  type SyncSnapshotResponse,
  type UpsertSyncedProjectRequest,
} from './contracts/v1';
import { isPathInsideAllowedRoots } from './security';

export interface ProjectSyncServiceOptions {
  dbPath: string;
  backupsDir: string;
  desktopUserDataDir: string | null;
  allowedMediaRoots: string[];
  enableDesktopWatcher?: boolean;
}

export class SyncConflictError extends Error {
  public readonly statusCode = 409;
  public readonly payload: SyncConflictPayload;

  constructor(payload: SyncConflictPayload) {
    super(payload.error);
    this.name = 'SyncConflictError';
    this.payload = payload;
  }
}

interface MediaIndexRow {
  mediaRefId: string;
  projectId: string;
  filePath: string;
  meta: SyncedMediaRef;
}

interface DesktopCinemaPackageLite {
  schemaVersion?: number;
  timeline?: {
    projectId?: string;
    fps?: number;
    width?: number;
    height?: number;
    tracks?: Array<{
      id?: string;
      type?: string;
      clips?: Array<{
        id?: string;
        label?: string;
        sourceUri?: string;
        startFrame?: number;
        durationFrames?: number;
        text?: string;
      }>;
    }>;
  };
  direction?: {
    treatment?: string;
    brief?: {
      prompt?: string;
      genre?: string;
      targetDurationSec?: number;
      aspectRatio?: string;
      language?: string;
      ttsProvider?: string;
      ttsVoice?: string;
      qualityProfile?: string;
    };
  };
  editorialScript?: {
    narrationText?: string;
    segments?: Array<{
      id?: string;
      title?: string;
      narration?: string;
      visualQuery?: string;
      durationSec?: number;
      caption?: string;
    }>;
  };
  aetheraSync?: {
    id?: string;
    version?: number;
    origin?: SyncActor;
    updatedBy?: SyncActor;
    updatedAt?: string;
    revisions?: SyncedProjectData['revisions'];
    style?: SyncedProjectData['style'];
    format?: SyncedProjectData['format'];
    creationMode?: SyncedProjectData['creationMode'];
    humorLevel?: number;
    status?: SyncedProjectData['status'];
    scheduledDate?: string | null;
    latestJobId?: string | null;
    settings?: Record<string, unknown>;
  };
}

interface DesktopSidecarMeta {
  projectId: string;
  version: number;
  contentHash: string;
  updatedBy: SyncActor;
  updatedAt: string;
  sourceFileHash: string;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,80}$/;

function sanitizeProjectId(raw?: string): string {
  if (raw && SAFE_ID_REGEX.test(raw.trim())) {
    return raw.trim();
  }
  const cleaned = (raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  if (cleaned.length >= 3) return cleaned;
  return `proj_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sha256FileQuick(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    // Hash full content up to 32 MB; for very large videos combine size + mtime + head/tail chunks
    if (stat.size <= 32 * 1024 * 1024) {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(65536);
      const tail = Buffer.alloc(65536);
      fs.readSync(fd, head, 0, head.length, 0);
      fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length));
      return crypto
        .createHash('sha256')
        .update(String(stat.size))
        .update(head)
        .update(tail)
        .digest('hex');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.srt': 'text/plain; charset=utf-8',
    '.vtt': 'text/vtt; charset=utf-8',
  };
  return map[ext] ?? 'application/octet-stream';
}

function guessMediaKind(filePath: string): SyncedMediaRef['kind'] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.mov' || ext === '.webm' || ext === '.mkv') return 'video_mp4';
  if (ext === '.wav' || ext === '.mp3' || ext === '.ogg') return 'audio';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') return 'image';
  if (ext === '.srt' || ext === '.vtt') return 'subtitle';
  return 'other';
}

function writeFileAtomic(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function computeChangedFields(prev: SyncedProjectData, next: SyncedProjectData): string[] {
  const keys: Array<keyof SyncedProjectData> = [
    'title',
    'briefing',
    'creationMode',
    'format',
    'style',
    'aspectRatio',
    'language',
    'durationMin',
    'humorLevel',
    'ttsProvider',
    'ttsVoice',
    'qualityPreset',
    'status',
    'scheduledDate',
    'humanizedScript',
    'scenes',
    'revisions',
    'latestJobId',
    'latestRenderMediaRefId',
    'settings',
  ];
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      changed.push(k);
    }
  }
  return changed;
}

function mapGenreToStyle(genre?: string): SyncedProjectData['style'] {
  const g = (genre ?? '').toLowerCase();
  if (g.includes('top') || g.includes('list')) return 'Top 10';
  if (g.includes('doc')) return 'Documentário';
  if (g.includes('tech') || g.includes('anal')) return 'Análise Técnica';
  if (g.includes('comed')) return 'Comédia Narrada';
  return 'Video Essay';
}

function mapStyleToGenre(style: SyncedProjectData['style']): string {
  switch (style) {
    case 'Top 10':
      return 'top_list';
    case 'Documentário':
      return 'documentary';
    case 'Análise Técnica':
      return 'technical_analysis';
    case 'Comédia Narrada':
      return 'comedy_essay';
    default:
      return 'video_essay';
  }
}

export class ProjectSyncService {
  public readonly authorityId: string;
  private readonly db: DatabaseSync;
  private readonly backupsDir: string;
  private readonly desktopUserDataDir: string | null;
  private readonly cinemaProjectsDir: string | null;
  private readonly allowedMediaRoots: string[];
  private readonly subscribers = new Set<Response>();
  private readonly recentlyProjectedHashes = new Map<string, { hash: string; at: number }>();
  private watcher: fs.FSWatcher | null = null;
  private heartbeatTimer: NodeJS.Timeout;
  private watchDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: ProjectSyncServiceOptions) {
    this.authorityId = `aethera-authority-${crypto.createHash('sha1').update(path.resolve(options.dbPath)).digest('hex').slice(0, 10)}`;
    this.backupsDir = path.resolve(options.backupsDir);
    this.desktopUserDataDir = options.desktopUserDataDir ? path.resolve(options.desktopUserDataDir) : null;
    this.cinemaProjectsDir = this.desktopUserDataDir ? path.join(this.desktopUserDataDir, 'cinema-projects') : null;
    this.allowedMediaRoots = [
      ...options.allowedMediaRoots.map((r) => path.resolve(r)),
      ...(this.desktopUserDataDir
        ? [
            path.join(this.desktopUserDataDir, 'cinema-renders'),
            path.join(this.desktopUserDataDir, 'cinema-workspaces'),
            path.join(this.desktopUserDataDir, 'cinema-media'),
            path.join(this.desktopUserDataDir, 'media-library'),
            path.join(this.desktopUserDataDir, 'cinema-thumbs'),
          ]
        : []),
    ];

    fs.mkdirSync(path.dirname(path.resolve(options.dbPath)), { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });

    this.db = new DatabaseSync(path.resolve(options.dbPath));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();

    // Non-destructive backup BEFORE first ingestion/migration of Desktop projects
    this.ensurePreMigrationBackup('initial_sync_bootstrap');
    this.ingestAllDesktopProjects();

    if (options.enableDesktopWatcher !== false) {
      this.startDesktopWatcher();
    }

    this.heartbeatTimer = setInterval(() => {
      const payload = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), seq: this.getCurrentSeq() })}\n\n`;
      for (const res of this.subscribers) {
        try {
          res.write(payload);
        } catch {
          this.subscribers.delete(res);
        }
      }
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  private initSchema(): void {
    // Purely additive tables — never drops or mutates existing remote-host tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS synced_projects (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        origin TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        desktop_projected_at TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS synced_project_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        actor TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_synced_rev_proj ON synced_project_revisions(project_id, version);

      CREATE TABLE IF NOT EXISTS sync_changelog (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        actor TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_media_refs (
        media_ref_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        meta_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_media_proj ON sync_media_refs(project_id);

      CREATE TABLE IF NOT EXISTS sync_backups (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        reason TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        backup_dir TEXT NOT NULL
      );
    `);
  }

  public close(): void {
    clearInterval(this.heartbeatTimer);
    for (const timer of this.watchDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.watchDebounceTimers.clear();
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
    for (const res of this.subscribers) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
    this.db.close();
  }

  public getCurrentSeq(): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM sync_changelog`).get() as { max_seq: number };
    return Number(row?.max_seq ?? 0);
  }

  public getLastBackup(): SyncBackupSummary | null {
    const row = this.db
      .prepare(`SELECT id, created_at, file_count, reason, manifest_sha256 FROM sync_backups ORDER BY created_at DESC LIMIT 1`)
      .get() as
      | { id: string; created_at: string; file_count: number; reason: string; manifest_sha256: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      createdAt: row.created_at,
      fileCount: row.file_count,
      reason: row.reason,
      manifestSha256: row.manifest_sha256,
    };
  }

  /**
   * Creates a verified, non-destructive backup of existing Desktop cinema-projects files
   * before performing any migration/ingestion write.
   */
  public ensurePreMigrationBackup(reason: string): SyncBackupSummary | null {
    const existing = this.getLastBackup();
    if (existing && reason === 'initial_sync_bootstrap') {
      return existing;
    }

    const filesToBackup: Array<{ rel: string; abs: string }> = [];
    if (this.cinemaProjectsDir && fs.existsSync(this.cinemaProjectsDir)) {
      for (const name of fs.readdirSync(this.cinemaProjectsDir)) {
        if (!name.endsWith('.json')) continue;
        const abs = path.join(this.cinemaProjectsDir, name);
        if (fs.statSync(abs).isFile()) {
          filesToBackup.push({ rel: path.join('cinema-projects', name), abs });
        }
      }
    }

    const id = `bkp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const targetDir = path.join(this.backupsDir, id);
    fs.mkdirSync(targetDir, { recursive: true });

    const manifestEntries: Array<{ rel: string; sha256: string; sizeBytes: number }> = [];
    for (const item of filesToBackup) {
      const dest = path.join(targetDir, item.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(item.abs, dest);
      const buf = fs.readFileSync(dest);
      manifestEntries.push({
        rel: item.rel,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        sizeBytes: buf.byteLength,
      });
    }

    const manifestPayload = JSON.stringify({ id, createdAt, reason, files: manifestEntries }, null, 2);
    const manifestSha256 = crypto.createHash('sha256').update(manifestPayload).digest('hex');
    writeFileAtomic(path.join(targetDir, 'manifest.json'), manifestPayload);

    this.db
      .prepare(
        `INSERT INTO sync_backups (id, created_at, file_count, reason, manifest_sha256, backup_dir)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, createdAt, manifestEntries.length, reason, manifestSha256, targetDir);

    return {
      id,
      createdAt,
      fileCount: manifestEntries.length,
      reason,
      manifestSha256,
    };
  }

  public registerMediaRef(input: {
    projectId: string;
    filePath: string;
    source: SyncedMediaRef['source'];
    kind?: SyncedMediaRef['kind'];
  }): SyncedMediaRef | null {
    const resolved = path.resolve(input.filePath);
    if (!isPathInsideAllowedRoots(resolved, this.allowedMediaRoots)) {
      return null;
    }
    if (!fs.existsSync(resolved)) {
      return null;
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;

    const mediaRefId = `mref_${crypto.createHash('sha256').update(`${input.projectId}:${resolved}`).digest('hex').slice(0, 16)}`;
    const now = new Date().toISOString();
    const meta: SyncedMediaRef = {
      mediaRefId,
      projectId: input.projectId,
      kind: input.kind ?? guessMediaKind(resolved),
      filename: path.basename(resolved),
      mimeType: guessMimeType(resolved),
      sizeBytes: stat.size,
      sha256: sha256FileQuick(resolved),
      available: true,
      source: input.source,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO sync_media_refs (media_ref_id, project_id, file_path, meta_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(media_ref_id) DO UPDATE SET
           file_path = excluded.file_path,
           meta_json = excluded.meta_json,
           updated_at = excluded.updated_at`,
      )
      .run(mediaRefId, input.projectId, resolved, JSON.stringify(meta), now);

    return meta;
  }

  public getMediaRefWithPath(mediaRefId: string): MediaIndexRow | null {
    const row = this.db
      .prepare(`SELECT media_ref_id, project_id, file_path, meta_json FROM sync_media_refs WHERE media_ref_id = ?`)
      .get(mediaRefId) as
      | { media_ref_id: string; project_id: string; file_path: string; meta_json: string }
      | undefined;
    if (!row) return null;
    if (!isPathInsideAllowedRoots(row.file_path, this.allowedMediaRoots)) return null;
    return {
      mediaRefId: row.media_ref_id,
      projectId: row.project_id,
      filePath: row.file_path,
      meta: JSON.parse(row.meta_json) as SyncedMediaRef,
    };
  }

  public listProjectMediaRefs(projectId: string): SyncedMediaRef[] {
    const rows = this.db
      .prepare(`SELECT file_path, meta_json FROM sync_media_refs WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId) as Array<{ file_path: string; meta_json: string }>;
    return rows.map((row) => {
      const meta = JSON.parse(row.meta_json) as SyncedMediaRef;
      return {
        ...meta,
        available: fs.existsSync(row.file_path),
      };
    });
  }

  public getProject(projectId: string): SyncedProjectRecord | null {
    const row = this.db
      .prepare(`SELECT payload_json FROM synced_projects WHERE id = ?`)
      .get(projectId) as { payload_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload_json) as SyncedProjectRecord;
  }

  public listProjects(includeDeleted = false): SyncedProjectRecord[] {
    const rows = includeDeleted
      ? (this.db.prepare(`SELECT payload_json FROM synced_projects ORDER BY updated_at DESC`).all() as Array<{
          payload_json: string;
        }>)
      : (this.db
          .prepare(`SELECT payload_json FROM synced_projects WHERE deleted_at IS NULL ORDER BY updated_at DESC`)
          .all() as Array<{ payload_json: string }>);
    return rows.map((r) => JSON.parse(r.payload_json) as SyncedProjectRecord);
  }

  public getSnapshot(): SyncSnapshotResponse {
    // Reconcile any desktop disk edits that arrived before snapshot
    this.ingestAllDesktopProjects();
    const projects = this.listProjects(false);
    let desktopCount = 0;
    if (this.cinemaProjectsDir && fs.existsSync(this.cinemaProjectsDir)) {
      desktopCount = fs
        .readdirSync(this.cinemaProjectsDir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.render.json') && !f.endsWith('.sync.json')).length;
    }

    return {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      authorityId: this.authorityId,
      currentSeq: this.getCurrentSeq(),
      desktopBridgeStatus: {
        desktopUserDataDetected: Boolean(this.desktopUserDataDir && fs.existsSync(this.desktopUserDataDir)),
        cinemaProjectsCount: desktopCount,
        watcherActive: Boolean(this.watcher),
        lastBackup: this.getLastBackup(),
      },
      projects,
    };
  }

  public getChangesSince(sinceSeq: number, limit = 200): SyncChangesResponse {
    this.ingestAllDesktopProjects();
    const rows = this.db
      .prepare(
        `SELECT seq, project_id, event_type, version, actor, timestamp, summary, payload_json
         FROM sync_changelog
         WHERE seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(Math.max(0, sinceSeq), Math.min(500, Math.max(1, limit))) as Array<{
      seq: number;
      project_id: string;
      event_type: SyncChangeEvent['eventType'];
      version: number;
      actor: SyncActor;
      timestamp: string;
      summary: string;
      payload_json: string | null;
    }>;

    return {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      sinceSeq,
      currentSeq: this.getCurrentSeq(),
      changes: rows.map((r) => ({
        seq: r.seq,
        projectId: r.project_id,
        eventType: r.event_type,
        version: r.version,
        actor: r.actor,
        timestamp: r.timestamp,
        summary: r.summary,
        ...(r.payload_json ? { project: JSON.parse(r.payload_json) as SyncedProjectRecord } : {}),
      })),
    };
  }

  public subscribeEvents(res: Response, lastEventId = 0): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const missed = this.getChangesSince(lastEventId, 200);
    for (const ev of missed.changes) {
      this.writeSse(res, ev);
    }

    this.subscribers.add(res);
    res.on('close', () => {
      this.subscribers.delete(res);
    });
  }

  private writeSse(res: Response, ev: SyncChangeEvent): void {
    res.write(`id: ${ev.seq}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  private emitChange(input: {
    projectId: string;
    eventType: SyncChangeEvent['eventType'];
    version: number;
    actor: SyncActor;
    summary: string;
    project?: SyncedProjectRecord;
  }): SyncChangeEvent {
    const timestamp = new Date().toISOString();
    const res = this.db
      .prepare(
        `INSERT INTO sync_changelog (project_id, event_type, version, actor, timestamp, summary, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.eventType,
        input.version,
        input.actor,
        timestamp,
        input.summary,
        input.project ? JSON.stringify(input.project) : null,
      );

    const ev: SyncChangeEvent = {
      seq: Number(res.lastInsertRowid),
      projectId: input.projectId,
      eventType: input.eventType,
      version: input.version,
      actor: input.actor,
      timestamp,
      summary: input.summary,
      ...(input.project ? { project: input.project } : {}),
    };

    for (const client of this.subscribers) {
      try {
        this.writeSse(client, ev);
      } catch {
        this.subscribers.delete(client);
      }
    }
    return ev;
  }

  /**
   * Single Write Authority upsert with idempotency, optimistic concurrency (409 Conflict),
   * revision history, incremental changelog broadcast, and atomic Desktop projection.
   */
  public upsertProject(req: UpsertSyncedProjectRequest, options?: { skipDesktopProjection?: boolean }): {
    project: SyncedProjectRecord;
    idempotentReplay: boolean;
  } {
    // 1. Check idempotency key first
    if (req.idempotencyKey) {
      const prior = this.db
        .prepare(`SELECT response_json FROM sync_idempotency WHERE idempotency_key = ?`)
        .get(req.idempotencyKey) as { response_json: string } | undefined;
      if (prior) {
        return {
          project: JSON.parse(prior.response_json) as SyncedProjectRecord,
          idempotentReplay: true,
        };
      }
    }

    const projectId = sanitizeProjectId(req.id);
    const existing = this.getProject(projectId);
    const normalizedData: SyncedProjectData = {
      ...req.data,
      mediaRefs: req.data.mediaRefs?.length ? req.data.mediaRefs : this.listProjectMediaRefs(projectId),
    };
    const nextHash = stableHash(normalizedData);

    // 2. Optimistic Concurrency Control — NEVER silently overwrite newer edits
    if (existing && !existing.deletedAt) {
      // Same exact content -> idempotent no-op returning current record
      if (existing.contentHash === nextHash) {
        return { project: existing, idempotentReplay: true };
      }

      if (
        req.expectedVersion !== undefined &&
        req.expectedVersion !== null &&
        req.expectedVersion !== existing.version
      ) {
        const changedFields = computeChangedFields(existing.data, normalizedData);
        throw new SyncConflictError({
          code: 'SYNC_VERSION_CONFLICT',
          error: `Conflito de versão no projeto "${existing.data.title}": versão esperada v${req.expectedVersion}, mas o host já está na v${existing.version} (editado por ${existing.updatedBy}).`,
          projectId,
          expectedVersion: req.expectedVersion,
          serverVersion: existing.version,
          changedFields,
          serverProject: existing,
          incomingData: normalizedData,
        });
      }
    }

    const now = new Date().toISOString();
    const nextVersion = existing ? existing.version + 1 : 1;
    const record: SyncedProjectRecord = {
      id: projectId,
      version: nextVersion,
      contentHash: nextHash,
      origin: existing ? existing.origin : req.actor,
      updatedBy: req.actor,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      deletedAt: null,
      desktopProjectedAt: existing?.desktopProjectedAt ?? null,
      data: normalizedData,
    };

    if (!options?.skipDesktopProjection) {
      const projectedAt = this.projectToDesktop(record);
      if (projectedAt) {
        record.desktopProjectedAt = projectedAt;
      }
    }

    this.saveRecord(record, req.actor);

    if (req.idempotencyKey) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sync_idempotency (idempotency_key, project_id, version, created_at, response_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(req.idempotencyKey, projectId, record.version, now, JSON.stringify(record));
    }

    this.emitChange({
      projectId,
      eventType: existing ? 'project_updated' : 'project_created',
      version: record.version,
      actor: req.actor,
      summary: existing
        ? `Projeto "${record.data.title}" atualizado para v${record.version} por ${req.actor}.`
        : `Projeto "${record.data.title}" criado (v1) por ${req.actor}.`,
      project: record,
    });

    return { project: record, idempotentReplay: false };
  }

  public resolveConflict(projectId: string, req: ResolveSyncConflictRequest): {
    project: SyncedProjectRecord;
    forkedProject?: SyncedProjectRecord;
  } {
    const server = this.getProject(projectId);
    if (!server) {
      throw new Error(`Projeto sincronizado não encontrado: ${projectId}`);
    }

    if (req.strategy === 'keep_server') {
      this.emitChange({
        projectId,
        eventType: 'conflict_resolved',
        version: server.version,
        actor: req.actor,
        summary: `Conflito resolvido mantendo a versão do PC (v${server.version}).`,
        project: server,
      });
      return { project: server };
    }

    if (req.strategy === 'force_client') {
      if (!req.clientData) {
        throw new Error('clientData é obrigatório para estratégia force_client.');
      }
      const { project } = this.upsertProject({
        id: projectId,
        expectedVersion: server.version,
        actor: req.actor,
        idempotencyKey: req.idempotencyKey,
        data: req.clientData,
      });
      this.emitChange({
        projectId,
        eventType: 'conflict_resolved',
        version: project.version,
        actor: req.actor,
        summary: `Conflito resolvido aplicando revisão do cliente (nova v${project.version}).`,
        project,
      });
      return { project };
    }

    // fork_copy — preserve server project untouched and create a stable copy with client edits
    if (!req.clientData) {
      throw new Error('clientData é obrigatório para estratégia fork_copy.');
    }
    const copyId = sanitizeProjectId(`${projectId}_copy_${Date.now().toString(36).slice(-4)}`);
    const { project: forkedProject } = this.upsertProject({
      id: copyId,
      actor: req.actor,
      idempotencyKey: req.idempotencyKey,
      data: {
        ...req.clientData,
        title: `${req.clientData.title} (Cópia)`,
      },
    });
    return { project: server, forkedProject };
  }

  /**
   * Attaches a newly rendered MP4/media artifact to a synced project, projects its
   * Desktop-compatible `.render.json`, and broadcasts a `media_ready` SSE event.
   */
  public attachArtifactToProject(input: {
    projectId: string;
    jobId: string;
    filePath: string;
    source: SyncedMediaRef['source'];
    encoderUsed?: string | null;
    probe?: {
      durationSec?: number | null;
      width?: number | null;
      height?: number | null;
      videoCodec?: string | null;
      audioCodec?: string | null;
      loudnessLufs?: number | null;
      sizeBytes?: number | null;
    };
  }): { project: SyncedProjectRecord; mediaRef: SyncedMediaRef } | null {
    const mediaRef = this.registerMediaRef({
      projectId: input.projectId,
      filePath: input.filePath,
      source: input.source,
      kind: guessMediaKind(input.filePath),
    });
    if (!mediaRef) return null;

    const existing = this.getProject(input.projectId);
    if (!existing) return null;

    const mergedRefs = [
      mediaRef,
      ...existing.data.mediaRefs.filter((m) => m.mediaRefId !== mediaRef.mediaRefId),
    ];

    const updatedData: SyncedProjectData = {
      ...existing.data,
      status: mediaRef.kind === 'video_mp4' ? 'awaiting_review' : existing.data.status,
      latestJobId: input.jobId,
      latestRenderMediaRefId: mediaRef.kind === 'video_mp4' ? mediaRef.mediaRefId : existing.data.latestRenderMediaRefId,
      mediaRefs: mergedRefs,
    };

    const { project } = this.upsertProject({
      id: existing.id,
      expectedVersion: existing.version,
      actor: 'remote_host',
      data: updatedData,
    });

    // Also write Desktop-compatible `.render.json` sidecar if cinema-projects dir is available
    if (mediaRef.kind === 'video_mp4' && this.cinemaProjectsDir) {
      const safeId = project.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const renderMetaPath = path.join(this.cinemaProjectsDir, `${safeId}.render.json`);
      const renderMeta = {
        mp4Path: path.resolve(input.filePath),
        mediaUrl: `aethera-media://local?path=${encodeURIComponent(path.resolve(input.filePath))}`,
        isTechnicalSample: false,
        narrationMode: existing.data.ttsProvider === 'elevenlabs' ? 'elevenlabs_tts' : 'voicestudio_tts',
        encoderUsed: input.encoderUsed ?? 'ffmpeg',
        appliedEffects: [],
        probe: {
          filePath: path.resolve(input.filePath),
          fileSizeBytes: input.probe?.sizeBytes ?? mediaRef.sizeBytes,
          durationSec: input.probe?.durationSec ?? existing.data.durationMin * 60,
          width: input.probe?.width ?? (existing.data.aspectRatio === '9:16' ? 1080 : 1920),
          height: input.probe?.height ?? (existing.data.aspectRatio === '9:16' ? 1920 : 1080),
          fps: 30,
          videoCodec: input.probe?.videoCodec ?? 'h264',
          audioCodec: input.probe?.audioCodec ?? 'aac',
          audioSampleRate: 48000,
          avDurationDeltaSec: 0,
          integratedLufs: input.probe?.loudnessLufs ?? -14,
          truePeakDbtp: -1,
          blackFramesCount: 0,
          frozenSegmentsCount: 0,
          sceneCutsCount: existing.data.scenes.length,
          silenceEventsCount: 0,
        },
        realQcFindings: [],
        waveformPeaks: [],
        audioTimeline: [],
        syncedFromRemoteHost: {
          jobId: input.jobId,
          mediaRefId: mediaRef.mediaRefId,
          syncedAt: new Date().toISOString(),
        },
      };
      try {
        writeFileAtomic(renderMetaPath, JSON.stringify(renderMeta, null, 2));
      } catch {
        // Non-fatal if Desktop directory is read-only
      }
    }

    this.emitChange({
      projectId: project.id,
      eventType: 'media_ready',
      version: project.version,
      actor: 'remote_host',
      summary: `Mídia "${mediaRef.filename}" pronta e vinculada ao projeto "${project.data.title}".`,
      project,
    });

    return { project, mediaRef };
  }

  private saveRecord(record: SyncedProjectRecord, actor: SyncActor): void {
    const json = JSON.stringify(record);
    this.db
      .prepare(
        `INSERT INTO synced_projects (id, version, content_hash, origin, updated_by, created_at, updated_at, deleted_at, desktop_projected_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           content_hash = excluded.content_hash,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           desktop_projected_at = excluded.desktop_projected_at,
           payload_json = excluded.payload_json`,
      )
      .run(
        record.id,
        record.version,
        record.contentHash,
        record.origin,
        record.updatedBy,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
        record.desktopProjectedAt,
        json,
      );

    this.db
      .prepare(
        `INSERT INTO synced_project_revisions (project_id, version, actor, content_hash, created_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.version, actor, record.contentHash, record.updatedAt, json);
  }

  /**
   * Projects an authoritative synced project into Aethera Desktop's `cinema-projects/<id>.json`
   * format atomically, preserving any existing Desktop CinemaProductionPackage fields!
   */
  private projectToDesktop(record: SyncedProjectRecord): string | null {
    if (!this.cinemaProjectsDir) return null;
    try {
      fs.mkdirSync(this.cinemaProjectsDir, { recursive: true });
      const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const projectFile = path.join(this.cinemaProjectsDir, `${safeId}.json`);
      const sidecarFile = path.join(this.cinemaProjectsDir, `${safeId}.sync.json`);

      let existingPkg: Record<string, unknown> = {};
      if (fs.existsSync(projectFile)) {
        try {
          existingPkg = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
        } catch {
          existingPkg = {};
        }
      }

      const fps = 30;
      const width = record.data.aspectRatio === '9:16' ? 1080 : 1920;
      const height = record.data.aspectRatio === '9:16' ? 1920 : 1080;
      const existingTimeline = (existingPkg['timeline'] as Record<string, unknown> | undefined) ?? {};
      const existingDirection = (existingPkg['direction'] as Record<string, unknown> | undefined) ?? {};
      const existingBrief = (existingDirection['brief'] as Record<string, unknown> | undefined) ?? {};
      const existingScript = (existingPkg['editorialScript'] as Record<string, unknown> | undefined) ?? {};

      // Preserve existing rich CinemaProductionPackage fields while updating synced fields
      let frameCursor = 0;
      const sceneClips = record.data.scenes.map((scene) => {
        const durationFrames = Math.max(30, Math.round((scene.durationSec || 6) * fps));
        const clip = {
          id: scene.id,
          label: scene.title,
          startFrame: frameCursor,
          durationFrames,
          text: scene.caption,
          visualQuery: scene.visualQuery,
          transition: scene.transition,
          accentHex: scene.accentHex,
        };
        frameCursor += durationFrames;
        return clip;
      });

      const mergedPkg = {
        ...existingPkg,
        timeline: {
          ...existingTimeline,
          projectId: record.id,
          fps: (existingTimeline['fps'] as number | undefined) ?? fps,
          width: (existingTimeline['width'] as number | undefined) ?? width,
          height: (existingTimeline['height'] as number | undefined) ?? height,
          tracks:
            Array.isArray(existingTimeline['tracks']) && (existingTimeline['tracks'] as unknown[]).length > 0
              ? existingTimeline['tracks']
              : [
                  {
                    id: 'V1_synced_storyboard',
                    type: 'video',
                    clips: sceneClips,
                  },
                ],
        },
        direction: {
          ...existingDirection,
          treatment: record.data.title,
          brief: {
            ...existingBrief,
            prompt: record.data.briefing || record.data.title,
            genre: mapStyleToGenre(record.data.style),
            targetDurationSec: Math.max(15, Math.round(record.data.durationMin * 60)),
            aspectRatio: record.data.aspectRatio,
            language: record.data.language,
            ttsProvider: record.data.ttsProvider,
            ttsVoice: record.data.ttsVoice,
            qualityProfile: record.data.qualityPreset,
          },
        },
        editorialScript: {
          ...existingScript,
          narrationText:
            record.data.humanizedScript ??
            record.data.scenes.map((s) => s.narration).filter(Boolean).join('\n\n'),
          segments: record.data.scenes.map((s) => ({
            id: s.id,
            index: s.index,
            title: s.title,
            narration: s.narration,
            visualQuery: s.visualQuery,
            durationSec: s.durationSec,
            caption: s.caption,
            transition: s.transition,
            accentHex: s.accentHex,
          })),
        },
        aetheraSync: {
          id: record.id,
          version: record.version,
          origin: record.origin,
          updatedBy: record.updatedBy,
          updatedAt: record.updatedAt,
          style: record.data.style,
          format: record.data.format,
          creationMode: record.data.creationMode,
          humorLevel: record.data.humorLevel,
          status: record.data.status,
          scheduledDate: record.data.scheduledDate,
          latestJobId: record.data.latestJobId,
          revisions: record.data.revisions,
          settings: record.data.settings,
        },
      };

      const serialized = JSON.stringify(mergedPkg, null, 2);
      const sourceFileHash = crypto.createHash('sha256').update(serialized).digest('hex');

      this.recentlyProjectedHashes.set(safeId, { hash: sourceFileHash, at: Date.now() });
      writeFileAtomic(projectFile, serialized);

      const sidecar: DesktopSidecarMeta = {
        projectId: record.id,
        version: record.version,
        contentHash: record.contentHash,
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt,
        sourceFileHash,
      };
      writeFileAtomic(sidecarFile, JSON.stringify(sidecar, null, 2));

      return new Date().toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Scans Aethera Desktop's `cinema-projects/*.json` and ingests any new or externally edited
   * Desktop project into the Single Write Authority, emitting incremental SSE events.
   */
  public ingestAllDesktopProjects(): SyncedProjectRecord[] {
    if (!this.cinemaProjectsDir || !fs.existsSync(this.cinemaProjectsDir)) {
      return [];
    }
    const ingested: SyncedProjectRecord[] = [];
    for (const fileName of fs.readdirSync(this.cinemaProjectsDir)) {
      if (!fileName.endsWith('.json') || fileName.endsWith('.render.json') || fileName.endsWith('.sync.json')) {
        continue;
      }
      const res = this.ingestDesktopProjectFile(path.join(this.cinemaProjectsDir, fileName));
      if (res) ingested.push(res);
    }
    return ingested;
  }

  public ingestDesktopProjectFile(filePath: string): SyncedProjectRecord | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const fileHash = crypto.createHash('sha256').update(raw).digest('hex');
      const baseId = path.basename(filePath, '.json');

      // Skip echo from our own recent atomic write
      const recent = this.recentlyProjectedHashes.get(baseId);
      if (recent && recent.hash === fileHash && Date.now() - recent.at < 5_000) {
        return null;
      }

      const parsed = JSON.parse(raw) as DesktopCinemaPackageLite;
      const projectId = sanitizeProjectId(parsed.timeline?.projectId ?? parsed.aetheraSync?.id ?? baseId);
      const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Check sidecar to avoid re-ingesting unchanged file
      const sidecarPath = path.join(path.dirname(filePath), `${safeId}.sync.json`);
      if (fs.existsSync(sidecarPath)) {
        try {
          const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as DesktopSidecarMeta;
          if (sidecar.sourceFileHash === fileHash && this.getProject(projectId)) {
            // Still check if a new render MP4 appeared in `.render.json`
            this.syncDesktopRenderSidecar(projectId);
            return null;
          }
        } catch {
          // Proceed with ingestion
        }
      }

      const brief = parsed.direction?.brief;
      const prompt = (brief?.prompt ?? '').trim();
      const title =
        (parsed.direction?.treatment ?? '').trim().slice(0, 120) ||
        prompt.slice(0, 72) ||
        projectId;

      const aspectRatio: '16:9' | '9:16' =
        brief?.aspectRatio === '9:16' ||
        ((parsed.timeline?.height ?? 0) > (parsed.timeline?.width ?? 0) && (parsed.timeline?.height ?? 0) > 0)
          ? '9:16'
          : '16:9';

      const durationMin = Math.max(1, Math.round((brief?.targetDurationSec ?? 180) / 60));
      const existing = this.getProject(projectId);

      // Extract scenes from editorialScript.segments or timeline tracks
      let scenes: SyncedSceneItem[] = [];
      if (Array.isArray(parsed.editorialScript?.segments) && parsed.editorialScript.segments.length > 0) {
        scenes = parsed.editorialScript.segments.map((seg, idx) => ({
          id: seg.id ?? `sc_${idx + 1}`,
          index: idx + 1,
          title: seg.title ?? `Cena ${idx + 1}`,
          narration: seg.narration ?? '',
          visualQuery: seg.visualQuery ?? title,
          durationSec: Math.max(2, Number(seg.durationSec ?? 8)),
          transition: 'corte_seco',
          mediaMatched: true,
          caption: seg.caption ?? seg.title ?? `Cena ${idx + 1}`,
          accentHex: '#b8a4f4',
        }));
      } else if (Array.isArray(parsed.timeline?.tracks) && parsed.timeline.tracks.length > 0) {
        const videoTrack = parsed.timeline.tracks.find((t) => t.type === 'video') ?? parsed.timeline.tracks[0];
        const fps = parsed.timeline.fps || 30;
        scenes = (videoTrack?.clips ?? []).map((clip, idx) => {
          let mediaRefId: string | null = null;
          if (clip.sourceUri && fs.existsSync(clip.sourceUri)) {
            const ref = this.registerMediaRef({
              projectId,
              filePath: clip.sourceUri,
              source: 'desktop_media',
            });
            mediaRefId = ref?.mediaRefId ?? null;
          }
          return {
            id: clip.id ?? `sc_${idx + 1}`,
            index: idx + 1,
            title: clip.label ?? `Cena ${idx + 1}`,
            narration: clip.text ?? '',
            visualQuery: clip.label ?? title,
            durationSec: Math.max(2, Math.round((clip.durationFrames ?? 180) / fps)),
            transition: 'corte_seco',
            mediaMatched: Boolean(clip.sourceUri),
            caption: clip.text ?? clip.label ?? `Cena ${idx + 1}`,
            accentHex: '#b8a4f4',
            mediaRefId,
          };
        });
      } else if (existing?.data.scenes.length) {
        scenes = existing.data.scenes;
      }

      // Check for rendered MP4 in Desktop `.render.json` or fallback paths
      const renderRef = this.discoverDesktopRenderRef(projectId);
      const mediaRefs = this.listProjectMediaRefs(projectId);

      const data: SyncedProjectData = {
        title,
        briefing: prompt || title,
        creationMode: parsed.aetheraSync?.creationMode ?? existing?.data.creationMode ?? 'ai',
        format:
          parsed.aetheraSync?.format ??
          (aspectRatio === '9:16' ? 'shorts_9_16' : 'youtube_1080p'),
        style: parsed.aetheraSync?.style ?? mapGenreToStyle(brief?.genre),
        aspectRatio,
        language: brief?.language ?? existing?.data.language ?? 'pt-BR',
        durationMin,
        humorLevel: parsed.aetheraSync?.humorLevel ?? existing?.data.humorLevel ?? 30,
        ttsProvider:
          brief?.ttsProvider === 'elevenlabs'
            ? 'elevenlabs'
            : brief?.ttsProvider === 'webspeech'
              ? 'webspeech'
              : 'voicestudio',
        ttsVoice: brief?.ttsVoice ?? existing?.data.ttsVoice ?? 'Narrador Épico (PT-BR)',
        qualityPreset:
          brief?.qualityProfile === 'cinema_4k'
            ? 'cinema_4k'
            : brief?.qualityProfile === 'master_1080p'
              ? 'master_1080p'
              : 'review_720p',
        status:
          parsed.aetheraSync?.status ??
          (renderRef ? 'awaiting_review' : existing?.data.status ?? 'briefing'),
        scheduledDate: parsed.aetheraSync?.scheduledDate ?? existing?.data.scheduledDate ?? null,
        humanizedScript: parsed.editorialScript?.narrationText ?? existing?.data.humanizedScript ?? null,
        scenes,
        revisions: parsed.aetheraSync?.revisions ?? existing?.data.revisions ?? [],
        latestJobId: parsed.aetheraSync?.latestJobId ?? existing?.data.latestJobId ?? null,
        latestRenderMediaRefId: renderRef?.mediaRefId ?? existing?.data.latestRenderMediaRefId ?? null,
        mediaRefs,
        settings: parsed.aetheraSync?.settings ?? existing?.data.settings,
      };

      const nextHash = stableHash(data);
      if (existing && existing.contentHash === nextHash) {
        // Update sidecar hash so we don't re-parse on next scan
        const sidecar: DesktopSidecarMeta = {
          projectId,
          version: existing.version,
          contentHash: existing.contentHash,
          updatedBy: existing.updatedBy,
          updatedAt: existing.updatedAt,
          sourceFileHash: fileHash,
        };
        writeFileAtomic(sidecarPath, JSON.stringify(sidecar, null, 2));
        return null;
      }

      const now = new Date().toISOString();
      const record: SyncedProjectRecord = {
        id: projectId,
        version: existing ? existing.version + 1 : 1,
        contentHash: nextHash,
        origin: existing ? existing.origin : 'desktop',
        updatedBy: 'desktop',
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        deletedAt: null,
        desktopProjectedAt: now,
        data,
      };

      this.saveRecord(record, 'desktop');

      const sidecar: DesktopSidecarMeta = {
        projectId,
        version: record.version,
        contentHash: record.contentHash,
        updatedBy: 'desktop',
        updatedAt: record.updatedAt,
        sourceFileHash: fileHash,
      };
      writeFileAtomic(sidecarPath, JSON.stringify(sidecar, null, 2));

      this.emitChange({
        projectId,
        eventType: 'desktop_ingested',
        version: record.version,
        actor: 'desktop',
        summary: existing
          ? `Edição do Aethera Desktop em "${record.data.title}" sincronizada (v${record.version}).`
          : `Projeto existente do Aethera Desktop "${record.data.title}" importado (v1).`,
        project: record,
      });

      return record;
    } catch {
      return null;
    }
  }

  private discoverDesktopRenderRef(projectId: string): SyncedMediaRef | null {
    if (!this.cinemaProjectsDir || !this.desktopUserDataDir) return null;
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const renderMetaFile = path.join(this.cinemaProjectsDir, `${safeId}.render.json`);
    if (fs.existsSync(renderMetaFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(renderMetaFile, 'utf8')) as { mp4Path?: string };
        if (parsed.mp4Path && fs.existsSync(parsed.mp4Path)) {
          return this.registerMediaRef({
            projectId,
            filePath: parsed.mp4Path,
            source: 'desktop_render',
            kind: 'video_mp4',
          });
        }
      } catch {
        // ignore malformed render metadata
      }
    }

    const candidates = [
      path.join(this.desktopUserDataDir, 'cinema-workspaces', safeId, 'renders', `${safeId}.mp4`),
      path.join(this.desktopUserDataDir, 'cinema-renders', `${safeId}.mp4`),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return this.registerMediaRef({
          projectId,
          filePath: candidate,
          source: 'desktop_render',
          kind: 'video_mp4',
        });
      }
    }
    return null;
  }

  private syncDesktopRenderSidecar(projectId: string): void {
    const existing = this.getProject(projectId);
    if (!existing) return;
    const ref = this.discoverDesktopRenderRef(projectId);
    if (ref && existing.data.latestRenderMediaRefId !== ref.mediaRefId) {
      const mergedRefs = [ref, ...existing.data.mediaRefs.filter((m) => m.mediaRefId !== ref.mediaRefId)];
      this.upsertProject(
        {
          id: projectId,
          expectedVersion: existing.version,
          actor: 'desktop',
          data: {
            ...existing.data,
            latestRenderMediaRefId: ref.mediaRefId,
            mediaRefs: mergedRefs,
          },
        },
        { skipDesktopProjection: true },
      );
    }
  }

  private startDesktopWatcher(): void {
    if (!this.cinemaProjectsDir) return;
    try {
      fs.mkdirSync(this.cinemaProjectsDir, { recursive: true });
      this.watcher = fs.watch(this.cinemaProjectsDir, (_eventType, fileName) => {
        if (!fileName || !fileName.endsWith('.json') || fileName.endsWith('.sync.json')) {
          return;
        }
        const prev = this.watchDebounceTimers.get(fileName);
        if (prev) clearTimeout(prev);

        const timer = setTimeout(() => {
          this.watchDebounceTimers.delete(fileName);
          if (!this.cinemaProjectsDir) return;
          if (fileName.endsWith('.render.json')) {
            const projId = fileName.replace(/\.render\.json$/, '');
            this.syncDesktopRenderSidecar(projId);
          } else {
            this.ingestDesktopProjectFile(path.join(this.cinemaProjectsDir, fileName));
          }
        }, 180);
        timer.unref();
        this.watchDebounceTimers.set(fileName, timer);
      });
    } catch {
      this.watcher = null;
    }
  }
}
