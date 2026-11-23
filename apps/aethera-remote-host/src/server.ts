import { registerRecapUrlImportRoutes } from './recap-url-import-routes.js';
import { registerRecapJobRoutes } from './recap-job-routes.js';
import { existsSync as recapExistsSync, readdirSync as recapReaddirSync, readFileSync as recapReadFileSync, writeFileSync as recapWriteFileSync } from 'node:fs';
import { join as recapJoin } from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import {
  REMOTE_CONTRACT_VERSION,
  type ArtifactTicketResponse,
  type CreateRemoteJobRequest,
  type RemoteHealthResponse,
  type RemoteJobDetailResponse,
  type RemoteJobsListResponse,
  type RemoteOperationType,
  type RemoteProjectsResponse,
  type RemoteProjectSummary,
  type ResolveSyncConflictRequest,
  type SyncMediaTicketResponse,
  type UpsertSyncedProjectRequest,
} from './contracts/v1';
import { RemoteAgentManager, type AgentRunnerOverrides } from './agents';
import { createCinemaBridge } from './cinema-bridge';
import { RemoteHostDatabase } from './db';
import { RemoteJobOrchestrator } from './job-orchestrator';
import { ProjectSyncService, SyncConflictError } from './project-sync-service';
import {
  assertSafeBindHost,
  createArtifactTicket,
  createAuthMiddleware,
  createCorsMiddleware,
  createRateLimiter,
  generateSecureToken,
  isPathInsideAllowedRoots,
  sha256Hex,
  verifyArtifactTicket,
} from './security';
import { collectHostStatus } from './telemetry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MONOREPO_ROOT = path.resolve(__dirname, '../../..');

const ALLOWED_OPERATIONS = new Set<RemoteOperationType>([
  'cinema.produce',
  'agent.run',
  'cinema.humanize',
  'cinema.youtube_audit',
  'media.acquire',
  'render.ffmpeg',
  'media.probe',
]);

export interface RemoteHostConfig {
  bindHost: string;
  port: number;
  allowNonLoopback: boolean;
  authToken: string;
  signingSecret?: string;
  dataDir: string;
  monorepoRoot: string;
  allowedOrigins: string[];
  allowedRoots: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  desktopUserDataDir?: string | null;
  enableDesktopWatcher?: boolean;
  agentOverrides?: AgentRunnerOverrides;
}

export interface RemoteHostInstance {
  app: Express;
  db: RemoteHostDatabase;
  syncService: ProjectSyncService;
  orchestrator: RemoteJobOrchestrator;
  agents: RemoteAgentManager;
  config: RemoteHostConfig;
  close(): void;
}

function loadEnvLocalFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

function scanAuthorizedProjects(db: RemoteHostDatabase, monorepoRoot: string): RemoteProjectsResponse {
  const remoteProjects = db.listProjects();
  const projects: RemoteProjectSummary[] = [...remoteProjects];
  const sourcesChecked: RemoteProjectsResponse['sourcesChecked'] = [
    {
      source: 'remote_host',
      available: true,
      detail: `${remoteProjects.length} projeto(s) persistido(s) no Remote Host SQLite.`,
    },
  ];

  // Check Desktop userData directory read-only on Windows (never exposes raw DB file or Electron IPC)
  const appData = process.env['APPDATA'];
  const desktopDbPath = appData ? path.join(appData, 'AetheraStudio', 'aethera.db') : null;
  if (desktopDbPath && fs.existsSync(desktopDbPath)) {
    sourcesChecked.push({
      source: 'desktop_sqlite',
      available: true,
      detail: `Banco do Aethera Desktop localizado em %APPDATA%\\AetheraStudio\\aethera.db (leitura controlada).`,
    });
  } else {
    sourcesChecked.push({
      source: 'desktop_sqlite',
      available: false,
      detail: 'Banco do Aethera Desktop (%APPDATA%\\AetheraStudio\\aethera.db) não detectado neste sistema.',
    });
  }

  // Also inspect aethera-web SQLite if running in same workspace (read-only summary)
  const webDbPath = path.join(monorepoRoot, 'apps', 'aethera-web', 'data', 'aethera-web.db');
  sourcesChecked.push({
    source: 'workspace_dir',
    available: fs.existsSync(webDbPath),
    detail: fs.existsSync(webDbPath)
      ? 'Workspace local do monorepo acessível.'
      : 'Nenhum banco local adicional encontrado no workspace.',
  });

  return {
    schemaVersion: REMOTE_CONTRACT_VERSION,
    projects,
    sourcesChecked,
  };
}

export function createRemoteHostApp(config: RemoteHostConfig): RemoteHostInstance {
  assertSafeBindHost(config.bindHost, config.allowNonLoopback);

  const startedAtMs = Date.now();
  const dataDir = path.resolve(config.dataDir);
  const artifactsDir = path.join(dataDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const allowedRoots = Array.from(new Set([...config.allowedRoots.map((r) => path.resolve(r)), artifactsDir]));
  const db = new RemoteHostDatabase(path.join(dataDir, 'remote-host.db'));
  db.recoverInterruptedJobs();

  const resolvedDesktopUserDataDir =
    config.desktopUserDataDir !== undefined
      ? config.desktopUserDataDir
      : process.env['AETHERA_DESKTOP_USER_DATA_DIR'] ||
        (process.env['APPDATA'] ? path.join(process.env['APPDATA'], 'AetheraStudio') : null);

  const syncService = new ProjectSyncService({
    dbPath: path.join(dataDir, 'remote-host.db'),
    backupsDir: path.join(dataDir, 'backups'),
    desktopUserDataDir: resolvedDesktopUserDataDir,
    allowedMediaRoots: allowedRoots,
    enableDesktopWatcher: config.enableDesktopWatcher,
  });

  const agents = new RemoteAgentManager(config.agentOverrides);
  const cinema = createCinemaBridge(config.monorepoRoot);
  const orchestrator = new RemoteJobOrchestrator({
    db,
    agents,
    cinema,
    artifactsDir,
    workspaceDir: config.monorepoRoot,
    onArtifactRegistered: (job, artifact, filePath) => {
      if (!job.projectId) return;
      syncService.attachArtifactToProject({
        projectId: job.projectId,
        jobId: job.id,
        filePath,
        source: 'remote_artifact',
        encoderUsed: artifact.encoderUsed,
        probe: {
          durationSec: artifact.durationSec,
          width: artifact.width,
          height: artifact.height,
          videoCodec: artifact.videoCodec,
          audioCodec: artifact.audioCodec,
          loudnessLufs: artifact.loudnessLufs,
          sizeBytes: artifact.sizeBytes,
        },
      });
    },
  });

  const signingSecret = config.signingSecret || crypto.randomBytes(32).toString('hex');
  const authTokenHash = sha256Hex(config.authToken);

  const requireScope = createAuthMiddleware({
    bindHost: config.bindHost,
    allowNonLoopback: config.allowNonLoopback,
    authTokenHash,
    signingSecret,
    allowedOrigins: config.allowedOrigins,
    allowedRoots,
    rateLimitWindowMs: config.rateLimitWindowMs,
    rateLimitMaxRequests: config.rateLimitMaxRequests,
    onAudit: (entry) => db.recordAudit(entry),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use(createCorsMiddleware(config.allowedOrigins));
  app.use('/api', createRateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests));

  // Public minimal health endpoint
  app.get('/api/health', (_req, res) => {
    const body: RemoteHealthResponse = {
      ok: true,
      service: 'aethera-remote-host',
      version: '0.1.73',
      schemaVersion: REMOTE_CONTRACT_VERSION,
      uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
      engineMode: cinema.engineMode,
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });

  // Host hardware & engine status
  app.get('/api/host/status', requireScope('host:read'), async (_req, res) => {
    const counts = db.countJobsByStatus();
    const status = await collectHostStatus({
      monorepoRoot: config.monorepoRoot,
      bindHost: config.bindHost,
      port: config.port,
      allowedRoots,
      activeJobsCount: counts.running,
      queuedJobsCount: counts.queued,
      awaitingApprovalCount: counts.awaitingApproval,
      startedAtMs,
      env: config.agentOverrides?.env,
    });
    res.json(status);
  });

  // Real installed agent discovery
  app.get('/api/agents', requireScope('agents:read'), async (_req, res) => {
    const result = await agents.discoverAgents();
    res.json(result);
  });

  // Authorized projects summary
  app.get('/api/projects', requireScope('projects:read'), (_req, res) => {
    res.json(scanAuthorizedProjects(db, config.monorepoRoot));
  });

  // Phase 7.2 — Aethera Recap remote monitoring & preview approval routes
  const resolveRecapDataRoot = () => process.env['NB_RECAP_DATA_DIR'] ?? recapJoin(config.monorepoRoot, '.aethera-recap-data');
  const readRecapProjects = () => {
    const root = resolveRecapDataRoot();
    if (!recapExistsSync(root)) return [];
    const entries = recapReaddirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    return entries.map((dir) => {
      const base = recapJoin(root, dir.name);
      const stateFile = recapJoin(base, 'state', 'recap-orchestrator-state.json');
      const gateHFile = recapJoin(base, 'render', 'gate-h-report.json');
      const planFile = recapJoin(base, 'render', 'recap-audiovisual-plan.json');
      const previewMp4 = recapJoin(base, 'render', 'recap-preview.mp4');
      let state: unknown = null;
      let gateH: unknown = null;
      let planSummary: unknown = null;
      try { if (recapExistsSync(stateFile)) state = JSON.parse(recapReadFileSync(stateFile, 'utf-8')); } catch { /* ignore */ }
      try { if (recapExistsSync(gateHFile)) gateH = JSON.parse(recapReadFileSync(gateHFile, 'utf-8')); } catch { /* ignore */ }
      try {
        if (recapExistsSync(planFile)) {
          const p = JSON.parse(recapReadFileSync(planFile, 'utf-8')) as Record<string, unknown>;
          planSummary = {
            chapterId: p['chapterId'],
            scriptTitle: p['scriptTitle'],
            aspectRatio: p['aspectRatio'],
            totalDurationMs: p['totalDurationMs'],
            approvalStatus: p['approvalStatus'],
            isSyntheticFixture: p['isSyntheticFixture'],
          };
        }
      } catch { /* ignore */ }
      return {
        id: dir.name,
        hasPreviewMp4: recapExistsSync(previewMp4),
        state,
        gateH,
        planSummary,
      };
    });
  };

  registerRecapUrlImportRoutes({
    app,
    libraryRootDir: resolveRecapDataRoot(),
    requireRead: requireScope('jobs:read'),
    requireWrite: requireScope('jobs:write'),
    requireControl: requireScope('jobs:control'),
  });

  registerRecapJobRoutes({
    app,
    workspaceDir: resolvedDesktopUserDataDir ? recapJoin(resolvedDesktopUserDataDir, 'recap-workspace') : null,
    requireRead: requireScope('jobs:read'),
    requireControl: requireScope('jobs:control'),
  });

  app.get('/api/recap/projects', requireScope('projects:read'), (_req, res) => {
    res.json({ projects: readRecapProjects() });
  });

  app.get('/api/recap/projects/:chapterId', requireScope('projects:read'), (req, res) => {
    const match = readRecapProjects().find((p) => p.id === req.params.chapterId);
    if (!match) {
      res.status(404).json({ error: 'Projeto Recap não encontrado no host remoto.' });
      return;
    }
    res.json(match);
  });

  app.post('/api/recap/projects/:chapterId/approve-master', requireScope('jobs:approve'), (req, res) => {
    const root = resolveRecapDataRoot();
    const approvalFile = recapJoin(root, String(req.params.chapterId), 'master-approval.json');
    if (!recapExistsSync(recapJoin(root, String(req.params.chapterId)))) {
      res.status(404).json({ error: 'Projeto Recap não encontrado no host remoto.' });
      return;
    }
    const payload = {
      chapterId: req.params.chapterId,
      approved: true,
      approvedAtIso: new Date().toISOString(),
    };
    recapWriteFileSync(approvalFile, JSON.stringify(payload, null, 2), 'utf-8');
    res.json(payload);
  });


  // Global real-time SSE stream
  app.get('/api/events', requireScope('jobs:read'), (_req, res) => {
    orchestrator.subscribeGlobal(res);
  });

  // List jobs
  app.get('/api/jobs', requireScope('jobs:read'), (_req, res) => {
    const body: RemoteJobsListResponse = {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      jobs: db.listJobs(60),
    };
    res.json(body);
  });

  // Create typed job from closed operation catalog (ZERO arbitrary shell commands)
  app.post('/api/jobs', requireScope('jobs:write'), (req, res) => {
    const body = req.body as Partial<CreateRemoteJobRequest>;
    if (!body?.operation || !ALLOWED_OPERATIONS.has(body.operation)) {
      res.status(400).json({
        error: `Operação inválida ou não permitida. Operações aceitas: ${[...ALLOWED_OPERATIONS].join(', ')}.`,
      });
      return;
    }

    if (body.prompt && body.prompt.length > 20_000) {
      res.status(400).json({ error: 'Prompt excede o limite de 20.000 caracteres.' });
      return;
    }

    const job = orchestrator.createJob(body as CreateRemoteJobRequest);
    res.status(201).json({
      schemaVersion: REMOTE_CONTRACT_VERSION,
      job,
    });
  });

  // Job detail + recent events
  app.get('/api/jobs/:id', requireScope('jobs:read'), (req, res) => {
    const job = db.getJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    const body: RemoteJobDetailResponse = {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      job,
      recentEvents: db.listJobEvents(job.id, 0, 200),
    };
    res.json(body);
  });

  // Cancel job & kill process tree
  app.post('/api/jobs/:id/cancel', requireScope('jobs:control'), (req, res) => {
    const job = orchestrator.cancelJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    res.json({ schemaVersion: REMOTE_CONTRACT_VERSION, job });
  });

  // Approve or reject sensitive job
  app.post('/api/jobs/:id/approve', requireScope('jobs:approve'), (req, res) => {
    const body = req.body as { approved?: boolean; note?: string };
    const job = orchestrator.approveJob(String(req.params.id), body?.approved !== false, body?.note);
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    res.json({ schemaVersion: REMOTE_CONTRACT_VERSION, job });
  });

  // Per-job SSE stream with Last-Event-ID replay
  app.get('/api/jobs/:id/events', requireScope('jobs:read'), (req, res) => {
    const jobId = String(req.params.id);
    const job = db.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job não encontrado.' });
      return;
    }
    const rawLastId = req.headers['last-event-id'] ?? req.query['lastEventId'];
    const lastEventId = Number.isFinite(Number(rawLastId)) ? Number(rawLastId) : 0;
    orchestrator.subscribeJob(jobId, res, lastEventId);
  });

  // Mint short-lived (60s) HMAC-signed ticket for <video src> and download links without leaking master Bearer token
  app.post('/api/artifacts/:id/ticket', requireScope('artifacts:read'), (req, res) => {
    const artifactId = String(req.params.id);
    const art = db.getArtifactWithPath(artifactId);
    if (!art) {
      res.status(404).json({ error: 'Artefato não encontrado.' });
      return;
    }
    if (!isPathInsideAllowedRoots(art.filePath, allowedRoots) || !fs.existsSync(art.filePath)) {
      res.status(403).json({ error: 'Acesso negado ao caminho do artefato.' });
      return;
    }
    const { token, expiresAt } = createArtifactTicket(artifactId, signingSecret, 60);
    const payload: ArtifactTicketResponse = {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      artifactId,
      expiresAt,
      streamPath: `/api/artifacts/${encodeURIComponent(artifactId)}?ticket=${encodeURIComponent(token)}`,
      downloadPath: `/api/artifacts/${encodeURIComponent(artifactId)}?ticket=${encodeURIComponent(token)}&download=1`,
    };
    res.json(payload);
  });

  // Authenticated HTTP Range streaming for video previews and downloads (replaces Electron aethera-media://)
  app.get('/api/artifacts/:id', (req, res) => {
    const artifactId = String(req.params.id);
    const ticket = typeof req.query['ticket'] === 'string' ? req.query['ticket'] : undefined;
    const authHeader = req.headers.authorization;

    let authorized = false;
    if (ticket && verifyArtifactTicket(artifactId, ticket, signingSecret)) {
      authorized = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const provided = authHeader.slice('Bearer '.length).trim();
      if (provided && sha256Hex(provided) === authTokenHash) {
        authorized = true;
      }
    }

    if (!authorized) {
      res.status(401).json({ error: 'Ticket efêmero ou token Bearer obrigatório para acessar artefatos.' });
      return;
    }

    const art = db.getArtifactWithPath(artifactId);
    if (!art) {
      res.status(404).json({ error: 'Artefato não encontrado.' });
      return;
    }
    if (!isPathInsideAllowedRoots(art.filePath, allowedRoots) || !fs.existsSync(art.filePath)) {
      res.status(403).json({ error: 'Artefato fora dos diretórios autorizados.' });
      return;
    }

    const stat = fs.statSync(art.filePath);
    const fileSize = stat.size;
    res.setHeader('Content-Type', art.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.query['download'] === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(art.filename)}"`);
    }

    const rangeHeader = req.headers.range;
    if (!rangeHeader) {
      res.setHeader('Content-Length', String(fileSize));
      fs.createReadStream(art.filePath).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(Number.parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(art.filePath, { start, end }).pipe(res);
  });

  // ============================================================================
  // Bidirectional Project Sync Endpoints (Single Write Authority)
  // ============================================================================

  app.get('/api/sync/snapshot', requireScope('sync:read'), (_req, res) => {
    res.json(syncService.getSnapshot());
  });

  app.get('/api/sync/changes', requireScope('sync:read'), (req, res) => {
    const rawSince = req.query['since'];
    const sinceSeq = Number.isFinite(Number(rawSince)) ? Number(rawSince) : 0;
    res.json(syncService.getChangesSince(sinceSeq));
  });

  app.get('/api/sync/events', requireScope('sync:read'), (req, res) => {
    const rawLast = req.headers['last-event-id'] ?? req.query['since'] ?? req.query['lastEventId'];
    const lastEventId = Number.isFinite(Number(rawLast)) ? Number(rawLast) : 0;
    syncService.subscribeEvents(res, lastEventId);
  });

  app.post('/api/sync/projects', requireScope('sync:write'), (req, res) => {
    const body = req.body as Partial<UpsertSyncedProjectRequest>;
    if (!body?.data || typeof body.data.title !== 'string') {
      res.status(400).json({ error: 'Payload inválido: data.title é obrigatório.' });
      return;
    }
    const headerIdem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
    try {
      const result = syncService.upsertProject({
        id: body.id,
        expectedVersion: body.expectedVersion,
        actor: body.actor ?? 'web',
        idempotencyKey: body.idempotencyKey ?? headerIdem,
        data: body.data,
      });
      res.status(result.idempotentReplay ? 200 : 201).json({
        schemaVersion: REMOTE_CONTRACT_VERSION,
        ...result,
      });
    } catch (err) {
      if (err instanceof SyncConflictError) {
        res.status(409).json(err.payload);
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put('/api/sync/projects/:id', requireScope('sync:write'), (req, res) => {
    const projectId = String(req.params.id);
    const body = req.body as Partial<UpsertSyncedProjectRequest>;
    if (!body?.data || typeof body.data.title !== 'string') {
      res.status(400).json({ error: 'Payload inválido: data.title é obrigatório.' });
      return;
    }
    const headerIdem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
    try {
      const result = syncService.upsertProject({
        id: projectId,
        expectedVersion: body.expectedVersion,
        actor: body.actor ?? 'web',
        idempotencyKey: body.idempotencyKey ?? headerIdem,
        data: body.data,
      });
      res.json({
        schemaVersion: REMOTE_CONTRACT_VERSION,
        ...result,
      });
    } catch (err) {
      if (err instanceof SyncConflictError) {
        res.status(409).json(err.payload);
        return;
      }
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/sync/projects/:id/resolve-conflict', requireScope('sync:write'), (req, res) => {
    const projectId = String(req.params.id);
    const body = req.body as Partial<ResolveSyncConflictRequest>;
    if (!body?.strategy || !['keep_server', 'force_client', 'fork_copy'].includes(body.strategy)) {
      res.status(400).json({ error: 'Estratégia inválida. Use keep_server, force_client ou fork_copy.' });
      return;
    }
    const headerIdem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
    try {
      const result = syncService.resolveConflict(projectId, {
        strategy: body.strategy,
        actor: body.actor ?? 'web',
        idempotencyKey: body.idempotencyKey ?? headerIdem,
        clientData: body.clientData,
      });
      res.json({
        schemaVersion: REMOTE_CONTRACT_VERSION,
        ...result,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/sync/desktop-ingest', requireScope('sync:write'), (_req, res) => {
    const ingested = syncService.ingestAllDesktopProjects();
    res.json({
      schemaVersion: REMOTE_CONTRACT_VERSION,
      ingestedCount: ingested.length,
      ingested,
      currentSeq: syncService.getCurrentSeq(),
    });
  });

  // Mint short-lived (60s) HMAC ticket for synced mediaRefId without exposing Windows paths
  app.post('/api/sync/media/:mediaRefId/ticket', requireScope('artifacts:read'), (req, res) => {
    const mediaRefId = String(req.params.mediaRefId);
    const media = syncService.getMediaRefWithPath(mediaRefId);
    if (!media || !fs.existsSync(media.filePath)) {
      res.status(404).json({ error: 'Mídia sincronizada não encontrada ou indisponível.' });
      return;
    }
    const { token, expiresAt } = createArtifactTicket(`syncmedia:${mediaRefId}`, signingSecret, 60);
    const payload: SyncMediaTicketResponse = {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      mediaRefId,
      expiresAt,
      streamPath: `/api/sync/media/${encodeURIComponent(mediaRefId)}/stream?ticket=${encodeURIComponent(token)}`,
      downloadPath: `/api/sync/media/${encodeURIComponent(mediaRefId)}/stream?ticket=${encodeURIComponent(token)}&download=1`,
    };
    res.json(payload);
  });

  app.get('/api/sync/media/:mediaRefId/stream', (req, res) => {
    const mediaRefId = String(req.params.mediaRefId);
    const ticket = typeof req.query['ticket'] === 'string' ? req.query['ticket'] : undefined;
    const authHeader = req.headers.authorization;

    let authorized = false;
    if (ticket && verifyArtifactTicket(`syncmedia:${mediaRefId}`, ticket, signingSecret)) {
      authorized = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const provided = authHeader.slice('Bearer '.length).trim();
      if (provided && sha256Hex(provided) === authTokenHash) {
        authorized = true;
      }
    }

    if (!authorized) {
      res.status(401).json({ error: 'Ticket efêmero ou token Bearer obrigatório para mídia sincronizada.' });
      return;
    }

    const media = syncService.getMediaRefWithPath(mediaRefId);
    if (!media || !fs.existsSync(media.filePath)) {
      res.status(404).json({ error: 'Mídia sincronizada não encontrada.' });
      return;
    }

    const stat = fs.statSync(media.filePath);
    const fileSize = stat.size;
    res.setHeader('Content-Type', media.meta.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.query['download'] === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(media.meta.filename)}"`);
    }

    const rangeHeader = req.headers.range;
    if (!rangeHeader) {
      res.setHeader('Content-Length', String(fileSize));
      fs.createReadStream(media.filePath).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(Number.parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(media.filePath, { start, end }).pipe(res);
  });

  // Security audit log inspection
  app.get('/api/audit', requireScope('host:read'), (_req, res) => {
    res.json({
      schemaVersion: REMOTE_CONTRACT_VERSION,
      entries: db.listAuditLogs(80),
    });
  });

  return {
    app,
    db,
    syncService,
    orchestrator,
    agents,
    config,
    close() {
      orchestrator.close();
      syncService.close();
      db.close();
    },
  };
}

function buildRuntimeConfigFromEnv(): RemoteHostConfig {
  const localEnvPath = path.resolve(__dirname, '../.env.local');
  const fileEnv = loadEnvLocalFile(localEnvPath);
  const env = { ...fileEnv, ...process.env };

  const bindHost = (env['AETHERA_REMOTE_BIND_HOST'] || '127.0.0.1').trim();
  const port = Number(env['AETHERA_REMOTE_PORT'] || 4848);
  const allowNonLoopback = env['AETHERA_REMOTE_ALLOW_NON_LOOPBACK'] === '1';

  const defaultDataDir =
    process.platform === 'win32'
      ? path.join(env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'), 'AetheraRemoteHost')
      : path.resolve(__dirname, '../data');

  const dataDir = path.resolve(env['AETHERA_REMOTE_DATA_DIR'] || defaultDataDir);
  const monorepoRoot = path.resolve(env['AETHERA_MONOREPO_ROOT'] || DEFAULT_MONOREPO_ROOT);

  let authToken = env['AETHERA_REMOTE_TOKEN']?.trim() || '';
  if (!authToken) {
    authToken = generateSecureToken(32);
    console.warn('[Aethera Remote Host] AETHERA_REMOTE_TOKEN não definido — gerado token efêmero para esta sessão.');
  }

  const defaultOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://*.run.app',
    'https://*.ngrok-free.app',
    'https://*.ngrok-free.dev',
    'https://*.trycloudflare.com',
  ];
  const allowedOrigins = env['AETHERA_ALLOWED_ORIGINS']
    ? env['AETHERA_ALLOWED_ORIGINS']
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : defaultOrigins;

  const allowedRoots = env['AETHERA_ALLOWED_ROOTS']
    ? env['AETHERA_ALLOWED_ROOTS']
        .split(path.delimiter)
        .map((s) => s.trim())
        .filter(Boolean)
    : [path.join(dataDir, 'artifacts')];

  return {
    bindHost,
    port,
    allowNonLoopback,
    authToken,
    dataDir,
    monorepoRoot,
    allowedOrigins,
    allowedRoots,
    rateLimitWindowMs: Number(env['AETHERA_RATE_LIMIT_WINDOW_MS'] || 60_000),
    rateLimitMaxRequests: Number(env['AETHERA_RATE_LIMIT_MAX'] || 240),
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isEntrypoint) {
  const cfg = buildRuntimeConfigFromEnv();
  const instance = createRemoteHostApp(cfg);
  const server = instance.app.listen(cfg.port, cfg.bindHost, () => {
    console.log(`[Aethera Remote Host] Escutando em http://${cfg.bindHost}:${cfg.port}`);
    console.log(`[Aethera Remote Host] Engine Mode: ${instance.config.monorepoRoot} | SQLite: ${instance.db.dbPath}`);
    console.log(`[Aethera Remote Host] CORS permitido: ${cfg.allowedOrigins.join(', ')}`);
  });

  const shutdown = () => {
    server.close(() => {
      instance.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
