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
} from './contracts/v1';
import { RemoteAgentManager, type AgentRunnerOverrides } from './agents';
import { createCinemaBridge } from './cinema-bridge';
import { RemoteHostDatabase } from './db';
import { RemoteJobOrchestrator } from './job-orchestrator';
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
  agentOverrides?: AgentRunnerOverrides;
}

export interface RemoteHostInstance {
  app: Express;
  db: RemoteHostDatabase;
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

  const agents = new RemoteAgentManager(config.agentOverrides);
  const cinema = createCinemaBridge(config.monorepoRoot);
  const orchestrator = new RemoteJobOrchestrator({
    db,
    agents,
    cinema,
    artifactsDir,
    workspaceDir: config.monorepoRoot,
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
    orchestrator,
    agents,
    config,
    close() {
      orchestrator.close();
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
