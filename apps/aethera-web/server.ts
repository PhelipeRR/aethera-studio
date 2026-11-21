import { existsSync as webRecapExistsSync, readdirSync as webRecapReaddirSync, readFileSync as webRecapReadFileSync } from 'node:fs';
import { join as webRecapJoin } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  generateStoryboardScenes,
  parseBriefingIntent,
  planSurgicalRevision,
} from './src/domain/briefing-parser';
import {
  advancePipelineOneStage,
  buildCreativeLayers,
  completeEntirePipeline,
  createDefaultChecklist,
  createDefaultPublicationPackage,
  createInitialStages,
  generateDerivativeVariant,
  generateThumbnailLabVariants,
} from './src/domain/pipeline-engine';
import type {
  AgentProviderConfig,
  BrandKit,
  ChannelConfig,
  ConsoleLogEntry,
  CreativeArtProject,
  CreativeArtType,
  CreativeLayer,
  DerivativeVariant,
  MediaAsset,
  ProductionProject,
  PublicationPackage,
  RenderJob,
  SceneItem,
  StudioBootstrapState,
  StudioPreferences,
  TrendIdea,
} from './src/domain/types';
import {
  hydrateProviderAvailability,
  probeOrQueryYtDlp,
  runHumanizeTask,
  runYouTubeAgentTask,
  testAgentProvider,
} from './server/agent-orchestrator';
import { probeSystemCapabilities } from './server/capabilities';
import {
  createGeneralRateLimiter,
  createHttpsEnforcementMiddleware,
  createRequireAuthMiddleware,
  createRequireCsrfMiddleware,
  createRestrictiveCorsMiddleware,
} from './server/auth-middleware';
import { registerAuthAndComputerRoutes } from './server/auth-routes';
import { AuthStore } from './server/auth-store';
import { CredentialVault } from './server/crypto-vault';
import { AetheraDatabase } from './server/db';
import { FfmpegRenderManager } from './server/ffmpeg-renderer';
import { registerRemoteProxyRoutes } from './server/remote-proxy';
import { SseHub } from './server/sse';
import type { SsrfValidationOptions } from './server/ssrf-guard';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DB_PATH = process.env.AETHERA_DB_PATH
  ? path.resolve(MONOREPO_ROOT, process.env.AETHERA_DB_PATH)
  : path.resolve(__dirname, 'data/aethera-web.db');
const DEFAULT_RENDERS_DIR = path.resolve(__dirname, 'data/renders');
const DEFAULT_KEY_FILE = path.resolve(MONOREPO_ROOT, '.aethera-secrets/credential.key');

function nowTimeLabel(): string {
  return new Date().toTimeString().slice(0, 8);
}

export interface CreateAppOptions {
  dbPath?: string;
  rendersDir?: string;
  credentialKey?: string;
  credentialKeyFile?: string;
  adminSetupToken?: string;
  isProduction?: boolean;
  enforceHttps?: boolean;
  allowedOrigins?: string[];
  ssrfOptions?: SsrfValidationOptions;
  onPasswordResetIssued?: (payload: { email: string; userId: string; rawCode: string; expiresAt: string }) => void;
}

export function createAetheraApiApp(opts: CreateAppOptions = {}) {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const rendersDir = opts.rendersDir ?? DEFAULT_RENDERS_DIR;
  const isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';
  const enforceHttps =
    opts.enforceHttps ??
    (process.env.AETHERA_ENFORCE_HTTPS === '1' ||
      process.env.AETHERA_ENFORCE_HTTPS === 'true' ||
      isProduction);
  const allowedOrigins =
    opts.allowedOrigins ??
    String(process.env.AETHERA_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const db = new AetheraDatabase(dbPath);
  const vault = new CredentialVault({
    rawKey: opts.credentialKey,
    devSecretDir: path.dirname(opts.credentialKeyFile ?? DEFAULT_KEY_FILE),
    isProduction,
  });
  const authStore = new AuthStore(db.raw(), vault);
  const sse = new SseHub();
  const renderManager = new FfmpegRenderManager(rendersDir);
  const app = express();

  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(createHttpsEnforcementMiddleware(enforceHttps));
  app.use('/api', createRestrictiveCorsMiddleware(allowedOrigins));
  app.use('/api', createGeneralRateLimiter(600, 60_000));
  app.use(express.json({ limit: '4mb' }));

  const requireAuth = createRequireAuthMiddleware(authStore);
  const requireCsrf = createRequireCsrfMiddleware(allowedOrigins);

  const logEvent = (entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>): ConsoleLogEntry => {
    const full: ConsoleLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: nowTimeLabel(),
    };
    db.insertConsoleLog(full);
    sse.broadcast('console_log', full);
    return full;
  };

  const buildBootstrap = (): StudioBootstrapState => {
    const capabilities = probeSystemCapabilities({
      dbPath,
      rendersDir,
      monorepoRoot: MONOREPO_ROOT,
    });
    const hydratedProviders = hydrateProviderAvailability(db.listAgentProviders());
    return {
      projects: db.listProjects(),
      channels: db.listChannels(),
      trendIdeas: db.listTrendIdeas(),
      brandKits: db.listBrandKits(),
      creativeProjects: db.listCreativeProjects(),
      mediaAssets: db.listMediaAssets(),
      renderJobs: db.listRenderJobs(),
      agentProviders: hydratedProviders,
      agentRuns: db.listAgentRuns(),
      consoleLogs: db.listConsoleLogs(),
      preferences: db.getPreferences(),
      capabilities,
    };
  };

  // --- Public Minimal Health Endpoint ---
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'aethera-web',
      sqlite: true,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Authentication, Sessions, Password Recovery & Meus Computadores ---
  registerAuthAndComputerRoutes(app, authStore, requireAuth, requireCsrf, {
    adminSetupToken: opts.adminSetupToken,
    isProduction,
    ssrfOptions: opts.ssrfOptions,
    onPasswordResetIssued: opts.onPasswordResetIssued,
  });

  // --- Closed-Allowlist Authenticated Remote Host Proxy (REST + SSE + Range Media) ---
  registerRemoteProxyRoutes(app, authStore, requireAuth, requireCsrf, {
    ssrfOptions: opts.ssrfOptions,
  });

  // --- Protect ALL remaining Studio API routes with HttpOnly session + CSRF ---
  app.use('/api', requireAuth, requireCsrf);

  app.get('/api/system/capabilities', (_req, res) => {
    res.json(
      probeSystemCapabilities({
        dbPath,
        rendersDir,
        monorepoRoot: MONOREPO_ROOT,
      }),
    );
  });


  // Phase 7.2 — Aethera Recap Web status & review endpoint (respects local/remote host boundary)
  app.get('/api/recap/projects', (_req, res) => {
    const root = process.env['NB_RECAP_DATA_DIR'] ?? webRecapJoin(process.cwd(), '.aethera-recap-data');
    if (!webRecapExistsSync(root)) {
      res.json({
        mode: 'remote_host_required',
        projects: [],
        note: 'Nenhum diretório local de Recap encontrado; conecte um Remote Host para listar projetos com GPU/arquivos locais.',
      });
      return;
    }
    const projects = webRecapReaddirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const planPath = webRecapJoin(root, d.name, 'render', 'recap-audiovisual-plan.json');
        const gatePath = webRecapJoin(root, d.name, 'render', 'gate-h-report.json');
        let plan: Record<string, unknown> | null = null;
        let gateH: Record<string, unknown> | null = null;
        try { if (webRecapExistsSync(planPath)) plan = JSON.parse(webRecapReadFileSync(planPath, 'utf-8')) as Record<string, unknown>; } catch { /* ignore */ }
        try { if (webRecapExistsSync(gatePath)) gateH = JSON.parse(webRecapReadFileSync(gatePath, 'utf-8')) as Record<string, unknown>; } catch { /* ignore */ }
        return {
          id: d.name,
          title: plan?.['scriptTitle'] ?? d.name,
          aspectRatio: plan?.['aspectRatio'] ?? '16:9',
          totalDurationMs: plan?.['totalDurationMs'] ?? 0,
          approvalStatus: plan?.['approvalStatus'] ?? 'unknown',
          gateHVerdict: gateH?.['verdict'] ?? null,
        };
      });
    res.json({ mode: 'local_host', projects });
  });

  app.get('/api/bootstrap', (_req, res) => {
    res.json(buildBootstrap());
  });

  // --- SSE Realtime Stream ---
  app.get('/api/events', (_req, res) => {
    sse.attach(res);
  });

  // --- Serve Real FFmpeg Rendered MP4 / Thumbnails ---
  app.get('/api/renders/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(rendersDir, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Arquivo de render não encontrado.' });
      return;
    }
    res.sendFile(fullPath);
  });

  // --- Projects (AI + Manual) ---
  app.post('/api/projects', (req, res) => {
    const body = req.body as {
      title?: string;
      briefing?: string;
      creationMode?: 'ai' | 'manual';
      channelId?: string | null;
      format?: ProductionProject['format'];
      style?: ProductionProject['style'];
      durationMin?: number;
      humorLevel?: number;
      ttsProvider?: ProductionProject['ttsProvider'];
      ttsVoice?: string;
      qualityPreset?: ProductionProject['qualityPreset'];
      language?: string;
      initialScript?: string;
    };

    const briefing = (body.briefing ?? '').trim();
    const parsed = parseBriefingIntent(briefing || body.title || 'Nova Produção Audiovisual');
    const title = (body.title ?? '').trim() || parsed.title;
    const format = body.format ?? parsed.format;
    const style = body.style ?? parsed.style;
    const durationMin = Math.max(1, Math.min(60, Number(body.durationMin ?? parsed.durationMin) || 10));
    const aspectRatio = format === 'shorts_9_16' ? '9:16' : '16:9';
    const creationMode = body.creationMode ?? 'ai';
    const now = new Date().toISOString();
    const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

    const scenes = generateStoryboardScenes(title, briefing || title, durationMin, style);
    if (body.initialScript?.trim() && scenes[0]) {
      scenes[0] = { ...scenes[0], narration: body.initialScript.trim() };
    }

    const project: ProductionProject = {
      id,
      title,
      briefing: briefing || `Projeto manual: ${title}`,
      creationMode,
      channelId: body.channelId ?? db.listChannels()[0]?.id ?? null,
      format,
      style,
      aspectRatio,
      language: body.language ?? parsed.language,
      durationMin,
      humorLevel: Number(body.humorLevel ?? parsed.humorLevel),
      ttsProvider: body.ttsProvider ?? db.getPreferences().defaultTtsProvider,
      ttsVoice: body.ttsVoice ?? 'Narrador Épico (PT-BR)',
      qualityPreset: body.qualityPreset ?? db.getPreferences().defaultQuality,
      status: creationMode === 'manual' ? 'briefing' : 'producing',
      stages: createInitialStages(1),
      scenes,
      comments: [],
      checklist: createDefaultChecklist(false),
      revisions: [],
      scheduledDate: null,
      humanizedScript: body.initialScript?.trim() || null,
      publicationPackage: createDefaultPublicationPackage(title, briefing || title, parsed.keywords),
      derivatives: [],
      analyticsSnapshots: [],
      latestRenderJobId: null,
      createdAt: now,
      updatedAt: now,
    };

    db.upsertProject(project);
    logEvent({
      scope: 'pipeline',
      level: 'info',
      projectId: id,
      message:
        creationMode === 'manual'
          ? `Projeto manual criado no SQLite: "${project.title}" (${project.style}).`
          : `Nova produção IA criada no SQLite: "${project.title}" (${project.style}, ~${project.durationMin} min).`,
    });
    sse.broadcast('project_updated', project);
    res.status(201).json(project);
  });

  app.patch('/api/projects/:id', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const patch = req.body as Partial<ProductionProject>;
    const updated: ProductionProject = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  // --- Pipeline Stage Transitions ---
  app.post('/api/projects/:id/pipeline/advance', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { nextProject, completedStageLabel, reachedReview } = advancePipelineOneStage(existing);
    if (completedStageLabel) {
      db.upsertProject(nextProject);
      logEvent({
        scope: 'pipeline',
        level: reachedReview ? 'success' : 'info',
        projectId: existing.id,
        message: reachedReview
          ? `Pipeline concluído (9/9) para "${nextProject.title}". Pronto na Sala de Revisão.`
          : `Etapa concluída (${completedStageLabel}) em "${nextProject.title}".`,
      });
      sse.broadcast('project_updated', nextProject);
    }
    res.json(nextProject);
  });

  app.post('/api/projects/:id/pipeline/complete', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const done = completeEntirePipeline(existing);
    db.upsertProject(done);
    logEvent({
      scope: 'pipeline',
      level: 'success',
      projectId: existing.id,
      message: `Todas as 9 etapas concluídas para "${done.title}". Enviado para Revisão e Qualidade.`,
    });
    sse.broadcast('project_updated', done);
    res.json(done);
  });

  app.post('/api/projects/:id/pipeline/pause', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const paused: ProductionProject = {
      ...existing,
      stages: existing.stages.map((s) => (s.state === 'running' ? { ...s, state: 'paused' as const } : s)),
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(paused);
    logEvent({
      scope: 'pipeline',
      level: 'warn',
      projectId: existing.id,
      message: `Checkpoint salvo no SQLite e pipeline pausado em "${existing.title}".`,
    });
    sse.broadcast('project_updated', paused);
    res.json(paused);
  });

  // --- Scene Editing ---
  app.patch('/api/projects/:id/scenes/:sceneId', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const patch = req.body as Partial<SceneItem>;
    const updated: ProductionProject = {
      ...existing,
      scenes: existing.scenes.map((s) => (s.id === req.params.sceneId ? { ...s, ...patch } : s)),
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'editor',
      level: 'info',
      projectId: existing.id,
      message: `Cena ${req.params.sceneId} salva no SQLite.`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  // --- Review Comments, Checklist, Surgical Revision, Approval, Scheduling ---
  app.post('/api/projects/:id/comments', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { timestampSec = 0, text = '', author = 'Revisor do Estúdio' } = req.body as {
      timestampSec?: number;
      text?: string;
      author?: string;
    };
    const trimmed = text.trim();
    if (!trimmed) {
      res.status(400).json({ error: 'Comentário vazio.' });
      return;
    }
    const updated: ProductionProject = {
      ...existing,
      comments: [
        {
          id: `cmt-${Date.now()}`,
          timestampSec: Number(timestampSec) || 0,
          author,
          text: trimmed,
          resolved: false,
          createdAt: new Date().toISOString(),
        },
        ...existing.comments,
      ],
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'review',
      level: 'info',
      projectId: existing.id,
      message: `Nota registrada em ${timestampSec}s: "${trimmed.slice(0, 60)}"`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/checklist/:itemId/toggle', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const updated: ProductionProject = {
      ...existing,
      checklist: existing.checklist.map((item) =>
        item.id === req.params.itemId ? { ...item, passed: !item.passed } : item,
      ),
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/revisions', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const instruction = String((req.body as { instruction?: string }).instruction ?? '').trim();
    if (!instruction) {
      res.status(400).json({ error: 'Instrução de revisão obrigatória.' });
      return;
    }
    const plan = planSurgicalRevision(instruction);
    const updated: ProductionProject = {
      ...existing,
      revisions: [
        { ...plan, id: `rev-${Date.now()}`, createdAt: new Date().toISOString() },
        ...existing.revisions,
      ],
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'review',
      level: 'warn',
      projectId: existing.id,
      message: `Revisão cirúrgica planejada: ${plan.summary} (${plan.affectedStages.join(', ')})`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/approve', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const updated: ProductionProject = {
      ...existing,
      status: existing.scheduledDate ? 'scheduled' : 'approved',
      checklist: existing.checklist.map((c) => ({ ...c, passed: true })),
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'review',
      level: 'success',
      projectId: existing.id,
      message: `Versão final aprovada nos Release Gates para "${existing.title}".`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/schedule', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { dateIso = null } = req.body as { dateIso?: string | null };
    const updated: ProductionProject = {
      ...existing,
      scheduledDate: dateIso,
      status: dateIso && existing.status === 'approved' ? 'scheduled' : existing.status,
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'calendar',
      level: 'info',
      projectId: existing.id,
      message: dateIso
        ? `"${existing.title}" agendado no Calendário Editorial para ${dateIso}.`
        : `Agendamento removido de "${existing.title}".`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  // --- Project Sub-Screens: Publication Package, Derivatives/Shorts, Analytics Idea ---
  app.put('/api/projects/:id/package', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const patch = req.body as Partial<PublicationPackage>;
    const nextPkg: PublicationPackage = {
      ...existing.publicationPackage,
      ...patch,
      version: existing.publicationPackage.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (patch.approvalStatus === 'approved') {
      nextPkg.approvedAt = new Date().toISOString();
    }
    const updated: ProductionProject = {
      ...existing,
      publicationPackage: nextPkg,
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'publishing',
      level: patch.approvalStatus === 'approved' ? 'success' : 'info',
      projectId: existing.id,
      message:
        patch.approvalStatus === 'approved'
          ? `Pacote de publicação v${nextPkg.version} aprovado para "${existing.title}".`
          : `Pacote de publicação v${nextPkg.version} salvo para "${existing.title}".`,
    });
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/derivatives', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { formatId = 'youtube-short' } = req.body as { formatId?: DerivativeVariant['formatId'] };
    const variant = generateDerivativeVariant(existing, formatId);
    const updated: ProductionProject = {
      ...existing,
      derivatives: [variant, ...existing.derivatives],
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    logEvent({
      scope: 'pipeline',
      level: 'info',
      projectId: existing.id,
      message: `Derivado vertical criado (${formatId}): "${variant.title}".`,
    });
    sse.broadcast('project_updated', updated);
    res.status(201).json({ project: updated, variant });
  });

  app.post('/api/projects/:id/derivatives/:variantId/decide', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { decision } = req.body as { decision: 'approved' | 'rejected' };
    const updated: ProductionProject = {
      ...existing,
      derivatives: existing.derivatives.map((v) =>
        v.id === req.params.variantId ? { ...v, status: decision } : v,
      ),
      updatedAt: new Date().toISOString(),
    };
    db.upsertProject(updated);
    sse.broadcast('project_updated', updated);
    res.json(updated);
  });

  app.post('/api/projects/:id/derivatives/:variantId/promote', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const variant = existing.derivatives.find((v) => v.id === req.params.variantId);
    if (!variant) {
      res.status(404).json({ error: 'Derivado não encontrado.' });
      return;
    }
    const now = new Date().toISOString();
    const childId = `proj-short-${Date.now()}`;
    const childProject: ProductionProject = {
      id: childId,
      title: variant.title,
      briefing: `Corte vertical derivado de "${existing.title}". Gancho: ${variant.hookText}`,
      creationMode: 'manual',
      channelId: existing.channelId,
      format: 'shorts_9_16',
      style: existing.style,
      aspectRatio: '9:16',
      language: existing.language,
      durationMin: 1,
      humorLevel: existing.humorLevel,
      ttsProvider: existing.ttsProvider,
      ttsVoice: existing.ttsVoice,
      qualityPreset: 'master_1080p',
      status: 'producing',
      stages: createInitialStages(2),
      scenes: generateStoryboardScenes(variant.title, variant.hookText, 1, existing.style),
      comments: [],
      checklist: createDefaultChecklist(false),
      revisions: [],
      scheduledDate: null,
      humanizedScript: null,
      publicationPackage: createDefaultPublicationPackage(variant.title, variant.hookText, ['shorts', 'aethera']),
      derivatives: [],
      analyticsSnapshots: [],
      latestRenderJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    db.upsertProject(childProject);

    const parentUpdated: ProductionProject = {
      ...existing,
      derivatives: existing.derivatives.map((v) =>
        v.id === variant.id ? { ...v, status: 'promoted' as const, childProjectId: childId } : v,
      ),
      updatedAt: now,
    };
    db.upsertProject(parentUpdated);
    logEvent({
      scope: 'pipeline',
      level: 'success',
      projectId: childId,
      message: `Produção filha 9:16 criada a partir do derivado "${variant.title}".`,
    });
    sse.broadcast('project_updated', parentUpdated);
    sse.broadcast('project_updated', childProject);
    res.status(201).json({ parent: parentUpdated, child: childProject });
  });

  app.post('/api/projects/:id/analytics/idea', (req, res) => {
    const existing = db.getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const { title = '', angle = '' } = req.body as { title?: string; angle?: string };
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Título da ideia é obrigatório.' });
      return;
    }
    const idea: TrendIdea = {
      id: `idea-analytics-${Date.now()}`,
      title: cleanTitle,
      source: 'Analytics',
      angle: angle.trim() || `Derivada dos dados de retenção de "${existing.title}".`,
      suggestedDurationMin: existing.durationMin,
      suggestedStyle: existing.style,
      score: 95,
      briefingTemplate: `Crie um vídeo de ${existing.durationMin} minutos sobre "${cleanTitle}". Ângulo validado por analytics: ${angle.trim() || 'aprofundar formato de maior retenção do canal.'}`,
    };
    db.upsertTrendIdea(idea);
    logEvent({
      scope: 'publishing',
      level: 'success',
      projectId: existing.id,
      message: `Ideia editorial criada a partir de analytics: "${idea.title}".`,
    });
    sse.broadcast('idea_created', idea);
    res.status(201).json(idea);
  });

  // --- Real FFmpeg Rendering Queue ---
  app.post('/api/renders', (req, res) => {
    const { projectId, preset } = req.body as {
      projectId?: string;
      preset?: ProductionProject['qualityPreset'];
    };
    const project = projectId ? db.getProject(projectId) : db.listProjects()[0];
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado para renderização.' });
      return;
    }

    const job: RenderJob = {
      id: `rnd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      projectId: project.id,
      projectTitle: project.title,
      preset: preset ?? project.qualityPreset,
      aspectRatio: project.aspectRatio,
      status: 'queued',
      progressPct: 5,
      stageMessage: 'Job enfileirado no motor FFmpeg real...',
      outputFilename: null,
      outputUrl: null,
      thumbnailUrl: null,
      probeMetrics: null,
      engine: 'ffmpeg_real',
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };

    db.upsertRenderJob(job);
    sse.broadcast('render_progress', job);
    logEvent({
      scope: 'render',
      level: 'info',
      projectId: project.id,
      message: `Render FFmpeg iniciado (${job.preset}, ${job.aspectRatio}) para "${project.title}".`,
    });

    // Execute real FFmpeg asynchronously and push progress via SSE
    void renderManager.renderProjectPreview(project, job, {
      onProgress: (updatedJob) => {
        db.upsertRenderJob(updatedJob);
        sse.broadcast('render_progress', updatedJob);
      },
      onComplete: (completedJob) => {
        db.upsertRenderJob(completedJob);
        const currentProj = db.getProject(project.id);
        if (currentProj) {
          const patched: ProductionProject = {
            ...currentProj,
            latestRenderJobId: completedJob.id,
            updatedAt: new Date().toISOString(),
          };
          db.upsertProject(patched);
          sse.broadcast('project_updated', patched);
        }
        sse.broadcast('render_progress', completedJob);
        logEvent({
          scope: 'render',
          level: 'success',
          projectId: project.id,
          message: `FFmpeg concluiu MP4 real (${completedJob.probeMetrics?.width}x${completedJob.probeMetrics?.height}, ${completedJob.probeMetrics?.durationSec}s) para "${project.title}".`,
        });
      },
      onError: (failedJob) => {
        db.upsertRenderJob(failedJob);
        sse.broadcast('render_progress', failedJob);
        logEvent({
          scope: 'render',
          level: 'warn',
          projectId: project.id,
          message: `Render FFmpeg encerrado (${failedJob.status}): ${failedJob.error ?? 'erro desconhecido'}`,
        });
      },
    });

    res.status(202).json(job);
  });

  app.post('/api/renders/:jobId/cancel', (req, res) => {
    const job = db.getRenderJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job de render não encontrado.' });
      return;
    }
    renderManager.cancelJob(job.id);
    const updated: RenderJob = {
      ...job,
      status: 'cancelled',
      stageMessage: 'Cancelado pelo operador.',
      completedAt: new Date().toISOString(),
    };
    db.upsertRenderJob(updated);
    sse.broadcast('render_progress', updated);
    res.json(updated);
  });

  // --- Channels & Publishing ---
  app.post('/api/channels', (req, res) => {
    const body = req.body as Partial<ChannelConfig>;
    const name = (body.name ?? '').trim();
    const niche = (body.niche ?? '').trim();
    if (!name || !niche) {
      res.status(400).json({ error: 'Nome do canal e nicho são obrigatórios.' });
      return;
    }
    const now = new Date().toISOString();
    const channel: ChannelConfig = {
      id: `chan-${Date.now()}`,
      name,
      platform: body.platform ?? 'youtube',
      niche,
      targetAudience: (body.targetAudience ?? '').trim() || 'Público geral interessado no tema',
      toneOfVoice: (body.toneOfVoice ?? '').trim() || 'Editorial e claro',
      language: body.language ?? 'pt-BR',
      monthlyBudgetUsd: Math.max(0, Number(body.monthlyBudgetUsd ?? 50)),
      maxConcurrentProductions: Math.max(1, Number(body.maxConcurrentProductions ?? 2)),
      editorialStrategy: (body.editorialStrategy ?? '').trim() || 'Publicações semanais com aprovação humana obrigatória.',
      autonomyLevel: body.autonomyLevel ?? 'assisted',
      oauthStatus: process.env.YOUTUBE_OAUTH_CLIENT_ID ? 'ready' : 'not_configured',
      createdAt: now,
      updatedAt: now,
    };
    db.upsertChannel(channel);
    logEvent({
      scope: 'publishing',
      level: 'success',
      message: `Canal "${channel.name}" cadastrado (${channel.platform}, autonomia ${channel.autonomyLevel}).`,
    });
    sse.broadcast('channel_updated', channel);
    res.status(201).json(channel);
  });

  // --- Agents RF-07, Humanize & YouTube Agent ---
  app.patch('/api/agents/providers', (req, res) => {
    const { providers } = req.body as { providers?: AgentProviderConfig[] };
    if (!Array.isArray(providers)) {
      res.status(400).json({ error: 'Lista de provedores inválida.' });
      return;
    }
    providers.forEach((p, idx) => {
      db.upsertAgentProvider({ ...p, priority: idx + 1 });
    });
    const hydrated = hydrateProviderAvailability(db.listAgentProviders());
    logEvent({
      scope: 'agents',
      level: 'info',
      message: `Ordem de fallback RF-07 atualizada (${hydrated.filter((p) => p.enabled).map((p) => p.label).join(' → ')}).`,
    });
    sse.broadcast('agents_updated', hydrated);
    res.json(hydrated);
  });

  app.post('/api/agents/providers/:id/test', async (req, res) => {
    const providers = hydrateProviderAvailability(db.listAgentProviders());
    const target = providers.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Provedor de agente não encontrado.' });
      return;
    }
    const testRes = await testAgentProvider(target);
    const updated: AgentProviderConfig = {
      ...target,
      installed: testRes.installed,
      lastTestStatus: testRes.status,
      lastTestMessage: testRes.message,
      lastTestedAt: new Date().toISOString(),
    };
    db.upsertAgentProvider(updated);
    db.insertAgentRun({
      id: `arun-${Date.now()}`,
      taskKind: 'provider_test',
      providerUsed: updated.label,
      executionMode: testRes.status === 'ok' ? 'real_cli' : 'blocked',
      projectId: null,
      summary: testRes.message,
      createdAt: new Date().toISOString(),
    });
    logEvent({
      scope: 'agents',
      level: testRes.status === 'ok' ? 'success' : 'warn',
      message: `Teste ${updated.label}: ${testRes.message}`,
    });
    res.json({ provider: updated, runs: db.listAgentRuns() });
  });

  app.post('/api/agents/humanize', (req, res) => {
    const { text = '', tone = 'editorial', projectId = null } = req.body as {
      text?: string;
      tone?: 'editorial' | 'conversacional' | 'documental';
      projectId?: string | null;
    };
    const providers = hydrateProviderAvailability(db.listAgentProviders());
    const out = runHumanizeTask(providers, text, tone);

    if (projectId) {
      const proj = db.getProject(projectId);
      if (proj) {
        const updated: ProductionProject = {
          ...proj,
          humanizedScript: out.result.humanizedText,
          updatedAt: new Date().toISOString(),
        };
        db.upsertProject(updated);
        sse.broadcast('project_updated', updated);
      }
    }

    const run = db.insertAgentRun({
      id: `arun-${Date.now()}`,
      taskKind: 'humanize',
      providerUsed: out.providerUsed,
      executionMode: out.executionMode,
      projectId,
      summary: `Humanize (${tone}): legibilidade ${out.result.readabilityBefore} → ${out.result.readabilityAfter}. ${out.notice}`,
      createdAt: new Date().toISOString(),
    });
    logEvent({
      scope: 'agents',
      level: out.executionMode === 'real_cli' ? 'success' : 'info',
      projectId: projectId ?? undefined,
      message: run.summary,
    });
    res.json({ ...out, run });
  });

  app.post('/api/agents/youtube', (req, res) => {
    const { projectId } = req.body as { projectId?: string };
    const project = projectId ? db.getProject(projectId) : db.listProjects()[0];
    if (!project) {
      res.status(404).json({ error: 'Projeto não encontrado.' });
      return;
    }
    const providers = hydrateProviderAvailability(db.listAgentProviders());
    const out = runYouTubeAgentTask(providers, project, project.publicationPackage);

    const run = db.insertAgentRun({
      id: `arun-${Date.now()}`,
      taskKind: 'youtube_agent',
      providerUsed: out.providerUsed,
      executionMode: out.executionMode,
      projectId: project.id,
      summary: `YouTube Agent auditou "${project.title}": score ${out.analysis.score}/100. ${out.notice}`,
      createdAt: new Date().toISOString(),
    });
    logEvent({
      scope: 'agents',
      level: 'info',
      projectId: project.id,
      message: run.summary,
    });
    res.json({ ...out, run });
  });

  // --- Media Library & yt-dlp Acquisition Probe ---
  app.post('/api/media', (req, res) => {
    const body = req.body as Omit<MediaAsset, 'id' | 'addedAt'>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Nome do asset é obrigatório.' });
      return;
    }
    const asset: MediaAsset = {
      ...body,
      id: `media-${Date.now()}`,
      name: body.name.trim(),
      addedAt: new Date().toISOString().slice(0, 10),
    };
    db.upsertMediaAsset(asset);
    logEvent({
      scope: 'media',
      level: 'info',
      projectId: asset.projectId ?? undefined,
      message: `Mídia catalogada no SQLite: "${asset.name}" (${asset.license}).`,
    });
    res.status(201).json(asset);
  });

  app.post('/api/media/acquire-ytdlp', async (req, res) => {
    const { query = '' } = req.body as { query?: string };
    if (!query.trim()) {
      res.status(400).json({ error: 'Informe uma URL ou termo de busca.' });
      return;
    }
    const result = await probeOrQueryYtDlp(query);
    logEvent({
      scope: 'media',
      level: result.ok ? 'success' : 'warn',
      message: result.message,
    });
    if (result.ok && result.metadata) {
      const asset: MediaAsset = {
        id: `media-yt-${Date.now()}`,
        name: `${result.metadata.title.slice(0, 48)}.mp4`,
        kind: 'video',
        durationLabel: `${Math.floor(result.metadata.durationSec / 60)}:${String(Math.floor(result.metadata.durationSec % 60)).padStart(2, '0')}`,
        license: 'Uso Editorial',
        tags: ['yt-dlp', result.metadata.uploader.toLowerCase().slice(0, 18)],
        projectId: null,
        sourceUrl: result.metadata.webpageUrl,
        addedAt: new Date().toISOString().slice(0, 10),
      };
      db.upsertMediaAsset(asset);
      res.json({ ...result, asset });
      return;
    }
    res.status(503).json(result);
  });

  // --- Creative Studio ---
  app.post('/api/creative/arts', (req, res) => {
    const body = req.body as {
      artType: CreativeArtType;
      prompt: string;
      headline: string;
      fidelity: CreativeArtProject['fidelity'];
      brandKitId: string;
    };
    const kits = db.listBrandKits();
    const kit = kits.find((k) => k.id === body.brandKitId) ?? kits[0];
    const art: CreativeArtProject = {
      id: `art-${Date.now()}`,
      artType: body.artType,
      prompt: body.prompt.trim(),
      headline: body.headline.trim() || body.prompt.trim().slice(0, 26) || 'NOVO VÍDEO',
      fidelity: body.fidelity,
      brandKitId: kit.id,
      archetype: 'Composição Direta',
      layers: buildCreativeLayers(body.artType, body.headline, body.prompt, kit, 'Composição Direta'),
      approved: false,
      createdAt: new Date().toISOString(),
    };
    db.upsertCreativeProject(art);
    logEvent({
      scope: 'creative',
      level: 'success',
      message: `Creative Studio gerou ${body.artType} editável ("${art.headline}") com kit ${kit.name}.`,
    });
    res.status(201).json(art);
  });

  app.post('/api/creative/thumbnail-lab', (req, res) => {
    const body = req.body as {
      prompt: string;
      headline: string;
      fidelity: CreativeArtProject['fidelity'];
      brandKitId: string;
    };
    const kits = db.listBrandKits();
    const kit = kits.find((k) => k.id === body.brandKitId) ?? kits[0];
    const variants = generateThumbnailLabVariants(body.prompt, body.headline, body.fidelity, kit);
    for (const v of variants) {
      db.upsertCreativeProject(v);
    }
    logEvent({
      scope: 'creative',
      level: 'success',
      message: `Thumbnail Lab gerou 3 variações A/B/C para "${body.headline || body.prompt.slice(0, 28)}".`,
    });
    res.status(201).json(variants);
  });

  app.patch('/api/creative/arts/:id', (req, res) => {
    const existing = db.getCreativeProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Arte não encontrada.' });
      return;
    }
    const patch = req.body as { layers?: CreativeLayer[]; approved?: boolean };
    const updated: CreativeArtProject = {
      ...existing,
      layers: patch.layers ?? existing.layers,
      headline: patch.layers?.find((l) => l.kind === 'headline')?.text ?? existing.headline,
      approved: patch.approved ?? existing.approved,
    };
    db.upsertCreativeProject(updated);
    res.json(updated);
  });

  app.post('/api/creative/brand-kits', (req, res) => {
    const body = req.body as Omit<BrandKit, 'id'>;
    const created: BrandKit = { ...body, id: `kit-${Date.now()}` };
    db.upsertBrandKit(created);
    logEvent({
      scope: 'creative',
      level: 'info',
      message: `Novo Brand Kit salvo no SQLite: "${created.name}".`,
    });
    res.status(201).json(created);
  });

  // --- Cloud Social Publishing Hub & Unified Calendar (Fly.io / SQLite persistent queue) ---
  // Operates independently of Desktop and Remote Host availability.
  app.get('/api/social-publishing/events', (_req, res) => {
    res.json({
      events: db.listSocialPublications(),
      cloudSchedulerActive: true,
      remoteHostRequired: false,
    });
  });

  app.post('/api/social-publishing/schedule', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const now = new Date().toISOString();
    const id = String(body.publicationId ?? body.id ?? `pub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const existing = db.getSocialPublication(id);
    const platforms = Array.isArray(body.platforms) && body.platforms.length > 0
      ? [...new Set(body.platforms.map(String))]
      : [String(body.platform ?? 'youtube')];
    const status = String(body.status ?? (body.scheduledPublishAtIso ? 'scheduled' : 'draft'));

    if ((status === 'scheduled' || status === 'publishing') && body.reviewApproved === false) {
      res.status(400).json({ error: 'review_approval_required: aprovação final obrigatória antes de agendar.' });
      return;
    }
    const qg = body.qualityGates as { allMandatoryPassed?: boolean } | undefined;
    if ((status === 'scheduled' || status === 'publishing') && qg && qg.allMandatoryPassed === false) {
      res.status(400).json({ error: 'quality_gates_required: Gates obrigatórios precisam estar aprovados.' });
      return;
    }
    const rv = body.rightsVerification as { verified?: boolean } | undefined;
    if ((status === 'scheduled' || status === 'publishing') && rv && rv.verified === false) {
      res.status(400).json({ error: 'rights_verification_required: verificação de direitos obrigatória.' });
      return;
    }

    const prevTargets = (existing?.platformTargets as Record<string, Record<string, unknown>> | undefined) ?? {};
    const bodyTargets = (body.platformTargets as Record<string, Record<string, unknown>> | undefined) ?? {};
    const platformTargets: Record<string, Record<string, unknown>> = {};
    for (const p of platforms) {
      platformTargets[p] = {
        platform: p,
        status,
        title: String(bodyTargets[p]?.title ?? body.title ?? ''),
        description: String(bodyTargets[p]?.description ?? body.description ?? ''),
        hashtags: Array.isArray(bodyTargets[p]?.hashtags) ? bodyTargets[p]!.hashtags : [],
        ...prevTargets[p],
        ...bodyTargets[p],
        updatedAtIso: now,
      };
    }

    const auditLog = Array.isArray(existing?.auditLog) ? [...(existing!.auditLog as unknown[])] : [];
    auditLog.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestampIso: now,
      action: status === 'scheduled' ? 'scheduled' : 'created',
      actor: 'user',
      detail: `Agendamento unificado (${platforms.join(', ')}) salvo na nuvem.`,
    });

    const saved = db.upsertSocialPublication({
      ...(existing ?? {}),
      ...body,
      id,
      publicationId: id,
      platform: platforms[0],
      platforms,
      platformTargets,
      status,
      timezone: String(body.timezone ?? 'America/Sao_Paulo'),
      plannedDateIso: String(body.scheduledPublishAtIso ?? body.plannedDateIso ?? now),
      rescheduleHistory: Array.isArray(existing?.rescheduleHistory) ? existing!.rescheduleHistory : [],
      auditLog,
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    });
    sse.broadcast('social_publication_updated', saved);
    res.status(201).json({ event: saved, events: db.listSocialPublications() });
  });

  app.post('/api/social-publishing/reschedule', (req, res) => {
    const { publicationId, targetDateIso, reason } = req.body as {
      publicationId?: string;
      targetDateIso?: string;
      reason?: string;
    };
    if (!publicationId || !targetDateIso || Number.isNaN(Date.parse(targetDateIso))) {
      res.status(400).json({ error: 'invalid: publicationId e targetDateIso válidos são obrigatórios.' });
      return;
    }
    const existing = db.getSocialPublication(publicationId);
    if (!existing) {
      res.status(404).json({ error: `not_found: publicação ${publicationId} não encontrada.` });
      return;
    }
    const now = new Date().toISOString();
    const fromIso = String(existing.scheduledPublishAtIso ?? existing.plannedDateIso ?? now);
    const rescheduleHistory = [
      ...(Array.isArray(existing.rescheduleHistory) ? (existing.rescheduleHistory as unknown[]) : []),
      { fromIso, toIso: targetDateIso, targetKind: 'scheduled', changedAt: now, ...(reason ? { reason } : {}) },
    ];
    const auditLog = [
      ...(Array.isArray(existing.auditLog) ? (existing.auditLog as unknown[]) : []),
      {
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestampIso: now,
        action: 'rescheduled',
        actor: 'user',
        detail: `Reagendado de ${fromIso} para ${targetDateIso}${reason ? ` (${reason})` : ''}.`,
      },
    ];
    const updated = db.upsertSocialPublication({
      ...existing,
      scheduledPublishAtIso: targetDateIso,
      plannedDateIso: targetDateIso,
      rescheduleHistory,
      auditLog,
      updatedAt: now,
    });
    sse.broadcast('social_publication_updated', updated);
    res.json({ event: updated, events: db.listSocialPublications() });
  });

  app.post('/api/social-publishing/cancel', (req, res) => {
    const { publicationId, platform, reason, confirmIrreversible } = req.body as {
      publicationId?: string;
      platform?: string;
      reason?: string;
      confirmIrreversible?: boolean;
    };
    if (!publicationId) {
      res.status(400).json({ error: 'invalid: publicationId obrigatório.' });
      return;
    }
    const existing = db.getSocialPublication(publicationId);
    if (!existing) {
      res.status(404).json({ error: `not_found: publicação ${publicationId} não encontrada.` });
      return;
    }
    if (existing.status === 'published' && !confirmIrreversible) {
      res.status(409).json({ error: 'confirmation_required: confirme explicitamente para alterar publicação já enviada.' });
      return;
    }
    const now = new Date().toISOString();
    const targets = { ...((existing.platformTargets as Record<string, Record<string, unknown>>) ?? {}) };
    if (platform && targets[platform]) {
      targets[platform] = { ...targets[platform], status: 'cancelled', updatedAtIso: now };
    } else {
      for (const k of Object.keys(targets)) {
        if (targets[k]?.status !== 'published') {
          targets[k] = { ...targets[k], status: 'cancelled', updatedAtIso: now };
        }
      }
    }
    const anyStillActive = Object.values(targets).some(
      (t) => t.status === 'scheduled' || t.status === 'publishing' || t.status === 'published',
    );
    const auditLog = [
      ...(Array.isArray(existing.auditLog) ? (existing.auditLog as unknown[]) : []),
      {
        id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestampIso: now,
        action: platform ? 'platform_cancelled' : 'cancelled',
        actor: 'user',
        ...(platform ? { platform } : {}),
        detail: reason ?? (platform ? `Destino ${platform} cancelado.` : 'Agendamento cancelado.'),
      },
    ];
    const updated = db.upsertSocialPublication({
      ...existing,
      platformTargets: targets,
      status: anyStillActive ? existing.status : 'cancelled',
      auditLog,
      updatedAt: now,
    });
    sse.broadcast('social_publication_updated', updated);
    res.json({ event: updated, events: db.listSocialPublications() });
  });

  app.post('/api/social-publishing/worker/tick', (req, res) => {
    const { nowIso, simulatedOutcomes } = (req.body ?? {}) as {
      nowIso?: string;
      simulatedOutcomes?: Record<string, { ok: boolean; remoteId?: string; error?: string }>;
    };
    const nowMs = Date.parse(nowIso ?? new Date().toISOString());
    const all = db.listSocialPublications();
    const processed: Array<{ publicationId: string; platform: string; ok: boolean; error?: string }> = [];

    for (const pub of all) {
      if (pub.status !== 'scheduled' && pub.status !== 'publishing') continue;
      const schedIso = String(pub.scheduledPublishAtIso ?? pub.plannedDateIso ?? '');
      if (!schedIso || Number.isNaN(Date.parse(schedIso)) || Date.parse(schedIso) > nowMs) continue;

      const pubId = String(pub.publicationId ?? pub.id);
      const platforms = Array.isArray(pub.platforms) ? (pub.platforms as string[]) : [String(pub.platform ?? 'youtube')];
      const targets = { ...((pub.platformTargets as Record<string, Record<string, unknown>>) ?? {}) };
      const auditLog = Array.isArray(pub.auditLog) ? [...(pub.auditLog as unknown[])] : [];
      let anyFailed = false;
      let anyPublished = false;

      for (const platform of platforms) {
        const target = targets[platform] ?? { platform, status: 'scheduled' };
        if (target.status === 'published' || target.status === 'cancelled') {
          if (target.status === 'published') anyPublished = true;
          continue;
        }
        const idempKey = `${pubId}:${platform}:${schedIso}`;
        if (db.hasSocialIdempotencyKey(idempKey)) {
          anyPublished = true;
          continue;
        }
        const sim = simulatedOutcomes?.[platform];
        const outcome = sim ?? { ok: true, remoteId: `cloud_${platform}_${Date.now()}` };
        const doneAt = new Date().toISOString();
        if (outcome.ok) {
          db.recordSocialIdempotencyKey(idempKey, pubId, platform, outcome);
          anyPublished = true;
          targets[platform] = { ...target, status: 'published', remoteId: outcome.remoteId, publishedAtIso: doneAt, updatedAtIso: doneAt };
          auditLog.push({ id: `aud_${Date.now()}_${platform}`, timestampIso: doneAt, action: 'platform_published', actor: 'cloud_worker', platform, detail: `Publicado em ${platform} (${outcome.remoteId ?? 'ok'}).` });
          processed.push({ publicationId: pubId, platform, ok: true });
        } else {
          anyFailed = true;
          targets[platform] = { ...target, status: 'failed', lastError: outcome.error ?? `Falha em ${platform}`, updatedAtIso: doneAt };
          auditLog.push({ id: `aud_${Date.now()}_${platform}`, timestampIso: doneAt, action: 'platform_failed', actor: 'cloud_worker', platform, detail: outcome.error ?? `Falha em ${platform}` });
          processed.push({ publicationId: pubId, platform, ok: false, error: outcome.error });
        }
      }

      db.upsertSocialPublication({
        ...pub,
        platformTargets: targets,
        status: anyFailed ? 'failed' : anyPublished ? 'published' : 'scheduled',
        auditLog,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({ ok: true, processed, events: db.listSocialPublications() });
  });

  // --- Preferences, Logs & Reset ---
  app.patch('/api/preferences', (req, res) => {
    const patch = req.body as Partial<StudioPreferences>;
    const updated = db.setPreferences({ ...db.getPreferences(), ...patch });
    res.json(updated);
  });

  app.delete('/api/logs', (_req, res) => {
    db.clearConsoleLogs();
    res.json({ ok: true });
  });

  app.post('/api/workspace/reset', (_req, res) => {
    db.resetWorkspace();
    res.json(buildBootstrap());
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota API não encontrada.' });
  });

  return { app, db, authStore, vault, sse, renderManager };
}

async function startServer() {
  const { app } = createAetheraApiApp();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);

  if (isProd) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: path.resolve(__dirname, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[aethera-web] Server running on http://0.0.0.0:${port} (${isProd ? 'production' : 'dev'})`);
  });
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void startServer();
}
