import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AuditLogEntry,
  RemoteArtifactRecord,
  RemoteJobEvent,
  RemoteJobRecord,
  RemoteProjectSummary,
} from './contracts/v1';

interface ArtifactRow extends RemoteArtifactRecord {
  filePath: string;
}

export class RemoteHostDatabase {
  public readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        operation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        type TEXT NOT NULL,
        level TEXT NOT NULL,
        stage TEXT NOT NULL,
        message TEXT NOT NULL,
        progress_pct REAL,
        timestamp TEXT NOT NULL,
        data_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_events_job_seq ON job_events(job_id, seq);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        remote_ip TEXT NOT NULL,
        actor TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        detail TEXT NOT NULL
      );
    `);
  }

  public close(): void {
    this.db.close();
  }

  public recoverInterruptedJobs(): RemoteJobRecord[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM jobs WHERE status IN ('running', 'queued')`)
      .all() as Array<{ payload_json: string }>;

    const recovered: RemoteJobRecord[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      const job = JSON.parse(row.payload_json) as RemoteJobRecord;
      const updated: RemoteJobRecord = {
        ...job,
        status: 'interrupted_on_restart',
        currentStage: 'interrompido_no_reinicio',
        error: 'O Remote Host foi reiniciado enquanto este job estava em execução. Reenvie ou retome quando o host estiver pronto.',
        updatedAt: now,
        completedAt: now,
        stages: job.stages.map((s) =>
          s.status === 'running'
            ? {
                ...s,
                status: 'failed',
                completedAt: now,
                detail: 'Interrompido por reinicialização do Remote Host.',
              }
            : s,
        ),
      };
      this.saveJob(updated);
      this.appendJobEvent({
        jobId: updated.id,
        type: 'job_status',
        level: 'warn',
        stage: 'recovery',
        message: 'Job recuperado após reinicialização do Remote Host (marcado como interrupted_on_restart).',
        progressPct: updated.progressPct,
      });
      recovered.push(updated);
    }
    return recovered;
  }

  public saveJob(job: RemoteJobRecord): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, status, operation, created_at, updated_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           operation = excluded.operation,
           updated_at = excluded.updated_at,
           payload_json = excluded.payload_json`,
      )
      .run(job.id, job.status, job.operation, job.createdAt, job.updatedAt, JSON.stringify(job));
  }

  public getJob(id: string): RemoteJobRecord | null {
    const row = this.db.prepare('SELECT payload_json FROM jobs WHERE id = ?').get(id) as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    const job = JSON.parse(row.payload_json) as RemoteJobRecord;
    job.artifacts = this.listArtifactsByJob(id);
    return job;
  }

  public listJobs(limit = 50): RemoteJobRecord[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM jobs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{ payload_json: string }>;
    return rows.map((r) => {
      const job = JSON.parse(r.payload_json) as RemoteJobRecord;
      job.artifacts = this.listArtifactsByJob(job.id);
      return job;
    });
  }

  public countJobsByStatus(): { running: number; queued: number; awaitingApproval: number } {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as cnt FROM jobs WHERE status IN ('running', 'queued', 'awaiting_approval') GROUP BY status`)
      .all() as Array<{ status: string; cnt: number }>;
    const map = new Map(rows.map((r) => [r.status, Number(r.cnt)]));
    return {
      running: map.get('running') ?? 0,
      queued: map.get('queued') ?? 0,
      awaitingApproval: map.get('awaiting_approval') ?? 0,
    };
  }

  public appendJobEvent(input: {
    jobId: string;
    type: RemoteJobEvent['type'];
    level: RemoteJobEvent['level'];
    stage: string;
    message: string;
    progressPct: number | null;
    data?: Record<string, unknown>;
  }): RemoteJobEvent {
    const timestamp = new Date().toISOString();
    const res = this.db
      .prepare(
        `INSERT INTO job_events (job_id, type, level, stage, message, progress_pct, timestamp, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.jobId,
        input.type,
        input.level,
        input.stage,
        input.message,
        input.progressPct,
        timestamp,
        input.data ? JSON.stringify(input.data) : null,
      );

    return {
      seq: Number(res.lastInsertRowid),
      jobId: input.jobId,
      type: input.type,
      level: input.level,
      stage: input.stage,
      message: input.message,
      progressPct: input.progressPct,
      timestamp,
      ...(input.data ? { data: input.data } : {}),
    };
  }

  public listJobEvents(jobId: string, afterSeq = 0, limit = 300): RemoteJobEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, job_id, type, level, stage, message, progress_pct, timestamp, data_json
         FROM job_events
         WHERE job_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(jobId, afterSeq, limit) as Array<{
      seq: number;
      job_id: string;
      type: RemoteJobEvent['type'];
      level: RemoteJobEvent['level'];
      stage: string;
      message: string;
      progress_pct: number | null;
      timestamp: string;
      data_json: string | null;
    }>;

    return rows.map((r) => ({
      seq: r.seq,
      jobId: r.job_id,
      type: r.type,
      level: r.level,
      stage: r.stage,
      message: r.message,
      progressPct: r.progress_pct,
      timestamp: r.timestamp,
      ...(r.data_json ? { data: JSON.parse(r.data_json) as Record<string, unknown> } : {}),
    }));
  }

  public saveArtifact(artifact: RemoteArtifactRecord, filePath: string): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, job_id, file_path, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           file_path = excluded.file_path,
           payload_json = excluded.payload_json`,
      )
      .run(artifact.id, artifact.jobId, path.resolve(filePath), JSON.stringify(artifact), artifact.createdAt);
  }

  public getArtifactWithPath(id: string): ArtifactRow | null {
    const row = this.db
      .prepare('SELECT file_path, payload_json FROM artifacts WHERE id = ?')
      .get(id) as { file_path: string; payload_json: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as RemoteArtifactRecord;
    return { ...parsed, filePath: row.file_path };
  }

  public listArtifactsByJob(jobId: string): RemoteArtifactRecord[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM artifacts WHERE job_id = ? ORDER BY created_at ASC')
      .all(jobId) as Array<{ payload_json: string }>;
    return rows.map((r) => JSON.parse(r.payload_json) as RemoteArtifactRecord);
  }

  public saveProject(project: RemoteProjectSummary): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, updated_at, payload_json)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           updated_at = excluded.updated_at,
           payload_json = excluded.payload_json`,
      )
      .run(project.id, project.updatedAt, JSON.stringify(project));
  }

  public listProjects(): RemoteProjectSummary[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM projects ORDER BY updated_at DESC')
      .all() as Array<{ payload_json: string }>;
    return rows.map((r) => JSON.parse(r.payload_json) as RemoteProjectSummary);
  }

  public recordAudit(entry: {
    method: string;
    path: string;
    remoteIp: string;
    actor: string;
    statusCode: number;
    detail: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (timestamp, method, path, remote_ip, actor, status_code, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        entry.method,
        entry.path,
        entry.remoteIp,
        entry.actor,
        entry.statusCode,
        entry.detail,
      );
  }

  public listAuditLogs(limit = 100): AuditLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, timestamp, method, path, remote_ip, actor, status_code, detail
         FROM audit_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      timestamp: string;
      method: string;
      path: string;
      remote_ip: string;
      actor: string;
      status_code: number;
      detail: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      method: r.method,
      path: r.path,
      remoteIp: r.remote_ip,
      actor: r.actor,
      statusCode: r.status_code,
      detail: r.detail,
    }));
  }
}
