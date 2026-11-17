import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { TraceMoeProvenanceAdapter } from '@neuralbridge/cinema';
import {
  AssetIngestionService,
  BrandKitManager,
  ComfyUiImageAdapter,
  CompositionPlanner,
  ConceptDrivenEngine,
  CreativeOrchestrator,
  ExportService,
  LayeredDocumentEditor,
  LocalPythonAiAdapter,
  ProviderChainImageAdapter,
  QualityGateService,
  SharpSvgCompositionEngine,
  VideoFrameAnalyzer,
  brandKitSchema,
  creativeProjectDocumentSchema,
  generateAiBackground,
  generateTypographyConceptLab,
  type AiGenerationReport,
  type AlignTarget,
  type AuthenticMediaSource,
  type ComfyUiStatus,
  type ApprovalStates,
  type ReleaseReadiness,
  defaultApprovalStates,
  recordHumanAestheticDecision,
  recordTechnicalAudit,
  releaseReadiness,
  type BrandKit,
  type BrandKitStore,
  type CreativeArtType,
  type CreativeConceptProposal,
  type CreativeLayer,
  type CreativeProjectDocument,
  type ExportFormat,
  type ExtractedFrameCandidate,
  type LayerEffect,
  type LayerMask,
  type LayerTransform,
  type ManagedAssetRef,
  type QualityAuditReport,
  type ProfessionalPresetId,
  type ReasoningEngineProvider,
  type ThumbnailLabVariant,
  type VideoSceneHint,
  type VisualConceptCritique,
  discoverComfyUi,
} from '@neuralbridge/creative-studio';
import { AetheraCreativeStudioRepository, type Db } from '@neuralbridge/database';
import { detectAntigravityCli, runAntigravityPrompt } from './antigravity-cli.js';
import { createProductionJobId, type ProductionConsoleService } from './production-console.js';
import { CreativeImageEngineSettingsStore, type CreativeImageEngineSettings } from './creative-image-engine-settings.js';

class SqliteBrandKitStore implements BrandKitStore {
  constructor(private readonly repo: AetheraCreativeStudioRepository) {}

  list(): BrandKit[] {
    return this.repo.listBrandKits().map((row) => brandKitSchema.parse(JSON.parse(row.dataJson)));
  }

  get(id: string): BrandKit | null {
    const row = this.repo.getBrandKit(id);
    return row ? brandKitSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  save(kit: BrandKit): BrandKit {
    const parsed = brandKitSchema.parse(kit);
    this.repo.saveBrandKit({
      id: parsed.id,
      channelId: parsed.channelId ?? null,
      channelName: parsed.channelName,
      dataJson: JSON.stringify(parsed),
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
    return parsed;
  }

  delete(id: string): boolean {
    return this.repo.deleteBrandKit(id);
  }
}

export interface CreativeStudioServiceOptions {
  db: Db;
  userDataDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  resolveClaudeGatewayEnv?: () => Record<string, string | undefined>;
/** When present, thumbnail generation reports each reasoning-engine run to the production console. */
  productionConsole?: ProductionConsoleService;
  /** CS-9: authentic media from the existing Aethera sources (see creative-authentic-media.ts). */
  authenticMediaSource?: AuthenticMediaSource | null;
  comfyUiEndpoint?: string;
  comfyUiCheckpoint?: string;
}

/**
 * Job id the creative studio writes its console entries under. Thumbnails are not part of a cinema production job,
 * so they get their own console scope instead of polluting the video job's log.
 */
/** Project id of creative jobs not tied to a cinema project. Each execution still gets its own `jobId`. */
export const CREATIVE_STUDIO_CONSOLE_JOB_ID = 'creative-studio';

interface CreativeConsoleJob {
  jobId: string;
  projectId: string;
}

export class AetheraCreativeStudioService {
  readonly repo: AetheraCreativeStudioRepository;
  readonly storageRoot: string;
  readonly ingestion: AssetIngestionService;
  readonly brandKits: BrandKitManager;
  readonly imageAdapter: ProviderChainImageAdapter;
  readonly comfyUiAdapter: ComfyUiImageAdapter;
  private readonly localImageAdapter: LocalPythonAiAdapter;
  readonly engine: SharpSvgCompositionEngine;
  readonly exporter: ExportService;
  readonly frameAnalyzer: VideoFrameAnalyzer;
  readonly qualityGate: QualityGateService;
  readonly planner: CompositionPlanner;
  readonly orchestrator: CreativeOrchestrator;
  readonly conceptEngine: ConceptDrivenEngine;
  private readonly editors = new Map<string, LayeredDocumentEditor>();
  private readonly productionConsole: ProductionConsoleService | undefined;
  private readonly comfyUiEndpoint: string | undefined;
  private readonly imageEngineSettingsStore: CreativeImageEngineSettingsStore;
  /** Console job of the creative execution in progress; concurrent thumbnails each carry their own. */
  private readonly consoleJob = new AsyncLocalStorage<CreativeConsoleJob>();

  constructor(options: CreativeStudioServiceOptions) {
    this.productionConsole = options.productionConsole;
    this.repo = new AetheraCreativeStudioRepository(options.db);
    this.storageRoot = join(options.userDataDir, 'creative-studio');
    this.imageEngineSettingsStore = new CreativeImageEngineSettingsStore(join(this.storageRoot, 'image-engine-settings.json'));
    const imageEngineSettings = this.imageEngineSettingsStore.load();
    this.comfyUiEndpoint = options.comfyUiEndpoint ?? imageEngineSettings.endpoint;
    this.ingestion = new AssetIngestionService({
      storageRoot: this.storageRoot,
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    });
    this.brandKits = new BrandKitManager(new SqliteBrandKitStore(this.repo));
    this.comfyUiAdapter = new ComfyUiImageAdapter({
      endpoint: this.comfyUiEndpoint,
      ...(options.comfyUiCheckpoint ? { checkpoint: options.comfyUiCheckpoint } : { checkpoint: imageEngineSettings.checkpoint }),
      releaseMemoryAfterGeneration: imageEngineSettings.releaseMemoryAfterGeneration,
      requestTimeoutMs: 750,
    });
    this.localImageAdapter = new LocalPythonAiAdapter();
    this.imageAdapter = new ProviderChainImageAdapter([this.comfyUiAdapter, this.localImageAdapter]);
    this.engine = new SharpSvgCompositionEngine(this.ingestion, this.imageAdapter);
    this.exporter = new ExportService(this.engine, {
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    });
    this.frameAnalyzer = new VideoFrameAnalyzer(this.ingestion, {
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
      provenanceResolver: new TraceMoeProvenanceAdapter({
        cachePath: join(this.storageRoot, 'trace-moe-cache.json'),
      }),
    });
    this.qualityGate = new QualityGateService(this.engine);
    this.planner = new CompositionPlanner();
    const providers = this.buildEngineProviders(options.resolveClaudeGatewayEnv);
    this.orchestrator = new CreativeOrchestrator(
      providers,
      this.planner,
      this.qualityGate,
    );
    this.conceptEngine = new ConceptDrivenEngine(this.ingestion, this.engine, this.qualityGate, {
      imageAdapter: this.imageAdapter,
      providers,
      authenticMediaSource: options.authenticMediaSource ?? null,
    });
  }

  async imageEngineStatus(): Promise<{ comfyUi: ComfyUiStatus; localAvailable: boolean; activeProvider: string }> {
    const [comfyUi, localAvailable, comfyAvailable] = await Promise.all([
      discoverComfyUi({
        requestTimeoutMs: 750,
        ...(this.comfyUiEndpoint ? { endpoints: [this.comfyUiEndpoint] } : {}),
      }),
      this.localImageAdapter.isAvailable(),
      this.comfyUiAdapter.isAvailable(),
    ]);
    return {
      comfyUi,
      localAvailable,
      activeProvider: comfyAvailable ? this.comfyUiAdapter.id : localAvailable ? this.localImageAdapter.id : 'none',
    };
  }

  async cancelImageGeneration(): Promise<boolean> {
    return this.comfyUiAdapter.cancel();
  }

  async releaseImageMemory(): Promise<boolean> {
    return this.comfyUiAdapter.releaseMemory();
  }

  async upscaleProjectBackground(input: { projectId: string; model: string }): Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
  }> {
    const doc = this.loadDocument(input.projectId);
    if (!doc) throw new Error(`Creative project not found: ${input.projectId}`);
    const background = doc.layers.find((layer): layer is Extract<CreativeLayer, { type: 'background' }> => layer.type === 'background' && Boolean(layer.assetId));
    if (!background?.assetId) throw new Error('O projeto não possui um fundo de imagem para upscale.');
    const sourceRef = doc.assetManifest[background.assetId];
    if (!sourceRef) throw new Error('O asset do fundo não está disponível no manifesto do projeto.');
    if (!this.imageAdapter.upscaleImage) throw new Error('Nenhum provedor de upscale está configurado.');
    const sourcePath = this.ingestion.resolvePortablePath(sourceRef.relativePath);
    const upscaled = await this.imageAdapter.upscaleImage({ imageBuffer: readFileSync(sourcePath), model: input.model });
    const upscaledRef = await this.ingestion.ingestBuffer({
      buffer: upscaled,
      kind: 'image',
      extension: 'png',
      originalName: `${sourceRef.originalName.replace(/\.[^.]+$/u, '')}-upscaled.png`,
    });
    const updated = {
      ...doc,
      assetManifest: { ...doc.assetManifest, [upscaledRef.id]: upscaledRef },
      layers: doc.layers.map((layer) => layer.id === background.id ? { ...layer, assetId: upscaledRef.id, source: 'asset' as const, generatedByAi: true } : layer),
      updatedAt: new Date().toISOString(),
    };
    const saved = this.saveDocument(updated);
    this.editors.set(saved.id, new LayeredDocumentEditor(saved));
    const brandKit = saved.brandKitId ? this.brandKits.get(saved.brandKitId) : null;
    const [previewDataUrl, audit] = await Promise.all([
      this.renderPreviewDataUrl(saved),
      this.qualityGate.auditProject(saved, { brandKit }),
    ]);
    return { document: saved, audit, previewDataUrl };
  }

  async getImageEngineSettings(): Promise<{
    settings: CreativeImageEngineSettings;
    availableCheckpoints: string[];
    status: Awaited<ReturnType<AetheraCreativeStudioService['imageEngineStatus']>>;
  }> {
    const settings = this.imageEngineSettingsStore.load();
    const status = await this.imageEngineStatus();
    return { settings, availableCheckpoints: status.comfyUi.models.checkpoints, status };
  }

  async saveImageEngineSettings(input: unknown): Promise<{
    settings: CreativeImageEngineSettings;
    availableCheckpoints: string[];
    status: Awaited<ReturnType<AetheraCreativeStudioService['imageEngineStatus']>>;
    requiresRestart: boolean;
  }> {
    const settings = this.imageEngineSettingsStore.save(input);
    this.comfyUiAdapter.setCheckpoint(settings.checkpoint);
    this.comfyUiAdapter.setReleaseMemoryAfterGeneration(settings.releaseMemoryAfterGeneration);
    const current = await this.getImageEngineSettings();
    return { ...current, requiresRestart: settings.endpoint !== this.comfyUiEndpoint };
  }

  /**
   * Runs one creative execution as its own console job (kind `thumbnail`): `job_started`, every engine command it
   * triggers, and `job_completed`/`job_failed`. A nested call (cinema thumbnail -> thumbnail lab) stays in the
   * caller's job.
   */
  private async withConsoleJob<T>(title: string, projectId: string | undefined, run: () => Promise<T>): Promise<T> {
    const consoleService = this.productionConsole;
    if (!consoleService || this.consoleJob.getStore()) return run();
    const job: CreativeConsoleJob = {
      jobId: createProductionJobId('thumb'),
      projectId: projectId || CREATIVE_STUDIO_CONSOLE_JOB_ID,
    };
    consoleService.registerJob({ ...job, attempt: 1, kind: 'thumbnail', title: title.slice(0, 140) });
    const base = {
      ...job,
      attempt: 1,
      stage: 'prompt' as const,
      origin: 'pipeline' as const,
      source: 'creative-studio',
      channel: 'progress' as const,
    };
    const startedAt = Date.now();
    consoleService.emit({ ...base, event: 'job_started', severity: 'info', message: `Thumbnail iniciada: ${title}`, pct: 0 });
    try {
      const result = await this.consoleJob.run(job, run);
      consoleService.emit({
        ...base,
        stage: 'qc',
        event: 'job_completed',
        severity: 'info',
        message: 'Thumbnail concluída',
        pct: 100,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      consoleService.emit({
        ...base,
        event: 'job_failed',
        severity: 'error',
        message: `Thumbnail falhou: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      consoleService.releaseJob(job.jobId);
    }
  }

  createFromPrompt(input: Parameters<AetheraCreativeStudioService['createFromPromptImpl']>[0]) {
    return this.withConsoleJob(input.title || input.prompt, input.sourceCinemaProjectId, () => this.createFromPromptImpl(input));
  }

  generateBatch(input: Parameters<AetheraCreativeStudioService['createFromPromptImpl']>[0] & { batchSize?: number }) {
    const batchSize = Math.max(1, Math.min(4, Math.floor(input.batchSize ?? 1)));
    const { batchSize: ignoredBatchSize, ...base } = input;
    void ignoredBatchSize;
    return this.withConsoleJob(`${input.title || input.prompt} (batch ${batchSize})`, input.sourceCinemaProjectId, async () => {
      const results: Array<Awaited<ReturnType<AetheraCreativeStudioService['createFromPromptImpl']>>> = [];
      for (let index = 0; index < batchSize; index += 1) {
        results.push(await this.createFromPromptImpl({
          ...base,
          ...(base.title ? { title: `${base.title} — ${index + 1}` } : {}),
          ...(base.seed !== undefined ? { seed: base.seed + index } : {}),
        }));
      }
      return results;
    });
  }

  runThumbnailLabFromVideo(input: Parameters<AetheraCreativeStudioService['runThumbnailLabFromVideoImpl']>[0]) {
    return this.withConsoleJob(input.title || input.prompt, input.sourceCinemaProjectId, () =>
      this.runThumbnailLabFromVideoImpl(input),
    );
  }

  runTypographyConceptLab(input: Parameters<AetheraCreativeStudioService['runTypographyConceptLabImpl']>[0]) {
    return this.withConsoleJob(input.headline || input.prompt || 'Typography Concept Lab', input.projectId, () =>
      this.runTypographyConceptLabImpl(input),
    );
  }

  generateThumbnailForCinemaVideo(
    input: Parameters<AetheraCreativeStudioService['generateThumbnailForCinemaVideoImpl']>[0],
  ) {
    return this.withConsoleJob(input.headline || input.prompt, input.cinemaProjectId, () =>
      this.generateThumbnailForCinemaVideoImpl(input),
    );
  }

  /**
   * Records one reasoning-engine execution (thumbnail / banner direction) in the production console: which engine
   * ran, how long it took, the size of the answer and its first characters. These adapters return text, not a raw
   * stdout, so nothing beyond what they really produced is shown.
   */
  private async trackReasoningRun(providerId: string, prompt: string, run: () => Promise<string>): Promise<string> {
    const consoleService = this.productionConsole;
    if (!consoleService) return run();
    const runId = `${providerId}_${Date.now().toString(36)}`;
    const job = this.consoleJob.getStore();
    const base = {
      projectId: job?.projectId ?? CREATIVE_STUDIO_CONSOLE_JOB_ID,
      jobId: job?.jobId ?? CREATIVE_STUDIO_CONSOLE_JOB_ID,
      runId,
      stage: 'agent' as const,
      origin: 'agent' as const,
      source: providerId,
    };
    const startedAt = Date.now();
    consoleService.emit({
      ...base,
      channel: 'command',
      event: 'command_started',
      severity: 'info',
      message: `Direção criativa: ${providerId} iniciado`,
      details: { promptChars: prompt.length, promptPreview: prompt.slice(0, 240) },
    });
    try {
      const text = await run();
      consoleService.emit({
        ...base,
        channel: 'result',
        event: 'command_completed',
        severity: 'info',
        message: `Direção criativa: ${providerId} concluído`,
        durationMs: Date.now() - startedAt,
        details: { outputChars: text.length, outputPreview: text.slice(0, 600) },
      });
      return text;
    } catch (error) {
      consoleService.emit({
        ...base,
        channel: 'result',
        event: 'command_failed',
        severity: 'error',
        message: `Direção criativa: ${providerId} falhou — ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private buildEngineProviders(
    resolveGatewayEnv?: () => Record<string, string | undefined>,
  ): ReasoningEngineProvider[] {
    const claude = new ClaudeCliAdapter();
    const codex = new CodexCliAdapter();
    const claudeGateway = new ClaudeCliAdapter(resolveGatewayEnv ? { resolveEnv: resolveGatewayEnv } : {});

    const collectAdapterText = async (
      adapter: ClaudeCliAdapter | CodexCliAdapter,
      prompt: string,
      providerId: string,
    ): Promise<string> => {
      return this.trackReasoningRun(providerId, prompt, async () => {
        let output = '';
        for await (const ev of adapter.run({
          prompt,
          cwd: this.storageRoot,
          mode: 'read-only',
          timeoutMs: 30_000,
        })) {
          if (ev.kind === 'text' && 'text' in ev && typeof ev.text === 'string') {
            output += ev.text;
          }
        }
        return output;
      });
    };

    return [
      {
        id: 'claude-code',
        isAvailable: async () => (await claude.detect()).installed,
        runPrompt: async (prompt) => ({ text: await collectAdapterText(claude, prompt, 'claude-code') }),
      },
      {
        id: 'codex-cli',
        isAvailable: async () => (await codex.detect()).installed,
        runPrompt: async (prompt) => ({ text: await collectAdapterText(codex, prompt, 'codex-cli') }),
      },
      {
        id: 'antigravity-cli',
        isAvailable: async () => (await detectAntigravityCli()).installed,
        runPrompt: async (prompt) => {
          const text = await this.trackReasoningRun('antigravity-cli', prompt, async () => {
            const res = await runAntigravityPrompt({ prompt, timeoutMs: 30_000 });
            return res.output;
          });
          return { text };
        },
      },
      {
        id: 'claude-gateway',
        isAvailable: async () => {
          const env = resolveGatewayEnv?.() ?? {};
          if (!env['ANTHROPIC_AUTH_TOKEN'] && !env['ANTHROPIC_API_KEY']) return false;
          return (await claudeGateway.detect()).installed;
        },
        runPrompt: async (prompt) => ({ text: await collectAdapterText(claudeGateway, prompt, 'claude-gateway') }),
      },
    ];
  }

  saveDocument(doc: CreativeProjectDocument): CreativeProjectDocument {
    const parsed = creativeProjectDocumentSchema.parse(doc);
    this.repo.saveProject({
      id: parsed.id,
      artType: parsed.artType,
      title: parsed.title,
      brandKitId: parsed.brandKitId ?? null,
      sourceCinemaProjectId: parsed.sourceCinemaProjectId ?? null,
      schemaVersion: parsed.schemaVersion,
      dataJson: JSON.stringify(parsed),
      approvedBy: parsed.approvedBy ?? null,
      approvedAt: parsed.approvedAt ?? null,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
    return parsed;
  }

  loadDocument(projectId: string): CreativeProjectDocument | null {
    const row = this.repo.getProject(projectId);
    return row ? creativeProjectDocumentSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  listDocuments(artType?: CreativeArtType): CreativeProjectDocument[] {
    return this.repo
      .listProjects(artType)
      .map((row) => creativeProjectDocumentSchema.parse(JSON.parse(row.dataJson)));
  }

  listGenerationHistory(limit = 30): Array<{
    id: string;
    projectId: string | null;
    artType: string;
    prompt: string;
    status: string;
    request: Record<string, unknown>;
    report: AiGenerationReport;
    createdAt: string;
  }> {
    return this.repo.listGenerationRuns(limit).flatMap((row) => {
      try {
        const request = JSON.parse(row.requestJson) as Record<string, unknown>;
        const report = JSON.parse(row.reportJson) as AiGenerationReport;
        return [{ id: row.id, projectId: row.projectId, artType: row.artType, prompt: row.prompt, status: row.status, request, report, createdAt: row.createdAt }];
      } catch {
        return [];
      }
    });
  }

  async regenerateGeneration(id: string): Promise<Awaited<ReturnType<AetheraCreativeStudioService['createFromPrompt']>>> {
    const row = this.repo.getGenerationRun(id);
    if (!row) throw new Error(`Generation history item not found: ${id}`);
    let request: unknown;
    try {
      request = JSON.parse(row.requestJson);
    } catch (error) {
      throw new Error(`Generation history item is corrupted: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return this.createFromPrompt(request as Parameters<AetheraCreativeStudioService['createFromPrompt']>[0]);
  }

  getOrCreateEditor(projectId: string): LayeredDocumentEditor {
    const existing = this.editors.get(projectId);
    if (existing) return existing;
    const doc = this.loadDocument(projectId);
    if (!doc) throw new Error(`Creative project not found: ${projectId}`);
    const editor = new LayeredDocumentEditor(doc);
    this.editors.set(projectId, editor);
    return editor;
  }

  async renderPreviewDataUrl(doc: CreativeProjectDocument): Promise<string> {
    const png = await this.engine.renderDocumentToBuffer(doc, 'png');
    return `data:image/png;base64,${png.toString('base64')}`;
  }

  private async createFromPromptImpl(input: {
    artType: CreativeArtType;
    prompt: string;
    title?: string;
    headline?: string;
    brandKitId?: string;
    backgroundAssetId?: string;
    subjectAssetId?: string;
    sourceCinemaProjectId?: string;
    avatarBackdrop?: 'light' | 'dark' | 'transparent';
    useAiGeneration?: boolean;
    seed?: number;
    maxSide?: number;
    stylization?: number;
    professionalPreset?: ProfessionalPresetId;
    referenceImagePaths?: string[];
    characterCount?: number;
    assetManifest?: Record<string, ManagedAssetRef>;
  }): Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
    availableEngines: string[];
    /** CF-1: what happened in the AI image step (shown to the user instead of a silent gradient fallback). */
    generation: AiGenerationReport & { generationRunId: string };
  }> {
    const brandKit = input.brandKitId ? this.brandKits.get(input.brandKitId) : null;
    let backgroundAsset = input.backgroundAssetId ? input.assetManifest?.[input.backgroundAssetId] ?? null : null;
    let subjectAsset = input.subjectAssetId ? input.assetManifest?.[input.subjectAssetId] ?? null : null;
    let backgroundOrigin: 'ai_composed' | 'media' | undefined = backgroundAsset ? 'media' : undefined;

    // CF-1: creative direction runs BEFORE the image so its structured answer feeds the visual recipe.
    const direction = await this.orchestrator.runCreativeDirection({
      artType: input.artType,
      prompt: input.prompt,
      ...(input.headline ? { headline: input.headline } : {}),
    });

    let generation: AiGenerationReport;
    if (!input.useAiGeneration) {
      generation = {
        status: 'disabled',
        engineId: this.imageAdapter.id,
        message: 'IA de imagem desmarcada: a arte usa só a paleta do Brand Kit.',
      };
    } else if (backgroundAsset) {
      generation = {
        status: 'skipped_existing_background',
        engineId: this.imageAdapter.id,
        message: 'Fundo fornecido pelo usuário; geração por IA não executada.',
      };
    } else {
      const generated = await generateAiBackground({
        artType: input.artType,
        prompt: input.prompt,
        ...(input.headline || direction.headline ? { headline: input.headline || direction.headline } : {}),
        brandKit,
        direction: direction.direction,
        imageAdapter: this.imageAdapter,
        ingestion: this.ingestion,
        ...(input.professionalPreset ? { professionalPreset: input.professionalPreset } : {}),
        ...(input.referenceImagePaths?.length ? { referenceImagePaths: input.referenceImagePaths } : {}),
        ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(input.maxSide !== undefined ? { maxSide: input.maxSide } : {}),
        ...(input.stylization !== undefined ? { stylization: input.stylization } : {}),
      });
      generation = generated.report;
      this.reportGeneration(generation);
      const generatedAsset = generated.asset;
      if (generatedAsset && input.artType === 'avatar' && !subjectAsset) {
        try {
          const genAbsPath = this.ingestion.resolvePortablePath(generatedAsset.relativePath);
          const cutoutBuffer = await this.imageAdapter.removeBackground({ inputImagePath: genAbsPath });
          subjectAsset = await this.ingestion.ingestBuffer({
            buffer: cutoutBuffer,
            kind: 'cutout',
            extension: 'png',
            originalName: `ai-mascot-cutout-${Date.now()}.png`,
          });
          if (brandKit) {
            this.brandKits.registerIdentityAsset(brandKit.id, 'mascot', subjectAsset);
          }
        } catch {
          backgroundAsset = generatedAsset;
          backgroundOrigin = 'ai_composed';
        }
      } else if (generatedAsset) {
        backgroundAsset = generatedAsset;
        backgroundOrigin = 'ai_composed';
      }
    }

    const activeBrandKit = input.brandKitId ? this.brandKits.get(input.brandKitId) : brandKit;
    const result = await this.orchestrator.orchestrateCreation(
      {
        artType: input.artType,
        prompt: input.prompt,
        ...(input.title ? { title: input.title } : {}),
        ...(input.headline ? { headline: input.headline } : {}),
        brandKit: activeBrandKit,
        backgroundAsset,
        subjectAsset,
        ...(backgroundOrigin ? { backgroundOrigin } : {}),
        ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
        ...(input.avatarBackdrop ? { avatarBackdrop: input.avatarBackdrop } : {}),
      },
      direction,
    );

    const saved = this.saveDocument(result.document);
    this.editors.set(saved.id, new LayeredDocumentEditor(saved));
    if (activeBrandKit && (input.artType === 'avatar' || input.artType === 'watermark')) {
      const renderedPng = await this.engine.renderDocumentToBuffer(saved, 'png');
      const role = input.artType === 'avatar' ? 'avatar' : 'watermark';
      const identityRef = await this.ingestion.ingestBuffer({
        buffer: renderedPng,
        kind: 'logo',
        extension: 'png',
        originalName: `brand-${role}-${Date.now()}.png`,
      });
      this.brandKits.registerIdentityAsset(activeBrandKit.id, role, identityRef);
    }
    const previewDataUrl = await this.renderPreviewDataUrl(saved);
    const generationRunId = randomUUID();
    const createdAt = new Date().toISOString();
    const historyRequest: Record<string, unknown> = {
      artType: input.artType,
      prompt: input.prompt,
      ...(input.title ? { title: input.title } : {}),
      ...(input.headline ? { headline: input.headline } : {}),
      ...(input.brandKitId ? { brandKitId: input.brandKitId } : {}),
      ...(input.backgroundAssetId ? { backgroundAssetId: input.backgroundAssetId } : {}),
      ...(input.subjectAssetId ? { subjectAssetId: input.subjectAssetId } : {}),
      ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
      ...(input.avatarBackdrop ? { avatarBackdrop: input.avatarBackdrop } : {}),
      ...(input.useAiGeneration !== undefined ? { useAiGeneration: input.useAiGeneration } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.maxSide !== undefined ? { maxSide: input.maxSide } : {}),
      ...(input.stylization !== undefined ? { stylization: input.stylization } : {}),
      ...(input.professionalPreset ? { professionalPreset: input.professionalPreset } : {}),
      ...(input.referenceImagePaths?.length ? { referenceImagePaths: input.referenceImagePaths.slice(0, 4) } : {}),
      ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
    };
    this.repo.saveGenerationRun({
      id: generationRunId,
      projectId: saved.id,
      artType: input.artType,
      prompt: input.prompt,
      status: generation.status,
      requestJson: JSON.stringify(historyRequest),
      reportJson: JSON.stringify(generation),
      createdAt,
      updatedAt: createdAt,
    });

    return {
      document: saved,
      audit: result.audit,
      previewDataUrl,
      availableEngines: result.availableEngines,
      generation: { ...generation, generationRunId },
    };
  }

  /** CF-1: the AI image step is visible in the production console, including why it fell back. */
  private reportGeneration(report: AiGenerationReport): void {
    const consoleService = this.productionConsole;
    const job = this.consoleJob.getStore();
    if (!consoleService || !job) return;
    consoleService.emit({
      ...job,
      attempt: 1,
      stage: 'prompt',
      origin: 'pipeline',
      source: report.engineId,
      channel: 'progress',
      event: report.status === 'generated' ? 'command_completed' : 'command_failed',
      severity: report.status === 'generated' ? 'info' : 'warn',
      message: report.message,
      ...(report.durationMs !== undefined ? { durationMs: report.durationMs } : {}),
      ...(report.recipe
        ? {
            details: {
              preset: report.recipe.preset,
              seed: report.recipe.seed,
              size: `${report.recipe.width}x${report.recipe.height}`,
              recipeSource: report.recipe.source,
              promptPreview: report.recipe.positivePrompt.slice(0, 240),
            },
          }
        : {}),
    });
  }

  private async runThumbnailLabFromVideoImpl(input: {
    videoPath?: string;
    prompt: string;
    scriptText?: string;
    headline?: string;
    brandKitId?: string;
    sourceCinemaProjectId?: string;
    sceneHints?: VideoSceneHint[];
    fidelityMode?: 'conceptual_art' | 'content_faithful' | 'authentic_gameplay';
    videoSourceType?: 'authentic_gameplay' | 'synthetic_ai_clip' | 'unknown';
    title?: string;
  }): Promise<{
    availableEngines: string[];
    extractedFrames: Array<{ timestampSec: number; impactScore: number; asset: ManagedAssetRef }>;
    variants: Array<
      ThumbnailLabVariant & {
        previewDataUrl: string;
        concept: CreativeConceptProposal;
        postRenderCritique: VisualConceptCritique;
      }
    >;
  }> {
    const brandKit = input.brandKitId ? this.brandKits.get(input.brandKitId) : null;
    let extractedFrames: Array<{ timestampSec: number; impactScore: number; asset: ManagedAssetRef }> = [];
    let fullCandidates: ExtractedFrameCandidate[] = [];

    if (input.videoPath) {
      const analysis = await this.frameAnalyzer.analyzeAndExtractFrames({
        videoPath: input.videoPath,
        sampleCount: 5,
        ...(input.sceneHints ? { sceneHints: input.sceneHints } : {}),
      });
      fullCandidates = analysis.candidates;
      extractedFrames = analysis.candidates.map((c) => ({
        timestampSec: c.timestampSec,
        impactScore: c.impactScore,
        asset: c.asset,
      }));
    }

    const lab = await this.orchestrator.orchestrateConceptThumbnailLab(this.conceptEngine, {
      prompt: input.prompt,
      ...(input.scriptText ? { scriptText: input.scriptText } : {}),
      ...(input.headline ? { headline: input.headline } : {}),
      brandKit,
      ...(input.sceneHints ? { sceneHints: input.sceneHints } : {}),
      ...(fullCandidates.length > 0 ? { extractedFrames: fullCandidates } : {}),
      ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
      ...(input.fidelityMode ? { fidelityMode: input.fidelityMode } : {}),
      ...(input.title ? { title: input.title } : {}),
      // Cinema-rendered videos are composed (often from AI assets): never assume authentic gameplay unless declared
      videoSourceType: input.videoSourceType ?? (input.sourceCinemaProjectId ? 'synthetic_ai_clip' : 'unknown'),
    });

    const variantsWithPreview: Array<
      ThumbnailLabVariant & {
        previewDataUrl: string;
        concept: CreativeConceptProposal;
        postRenderCritique: VisualConceptCritique;
      }
    > = [];
    for (const proposal of lab.proposals) {
      this.saveDocument(proposal.document);
      this.editors.set(proposal.document.id, new LayeredDocumentEditor(proposal.document));
      const previewDataUrl = await this.renderPreviewDataUrl(proposal.document);
      const styleMap = { A: 'impact', B: 'tech', C: 'cinematic' } as const;
      variantsWithPreview.push({
        label: proposal.concept.label,
        style: styleMap[proposal.concept.label],
        styleTitle: `${proposal.concept.label} — ${proposal.concept.title}`,
        editorialRationale: proposal.concept.editorialRationale,
        document: proposal.document,
        audit: proposal.audit,
        previewDataUrl,
        concept: proposal.concept,
        postRenderCritique: proposal.postRenderCritique,
      });
    }

    return {
      availableEngines: lab.availableEngines,
      extractedFrames,
      variants: variantsWithPreview,
    };
  }

  async combineThumbnailConcepts(input: {
    baseProjectId: string;
    donorProjectId: string;
    takeFromDonor: Array<'typography' | 'vfx' | 'watermark' | 'background'>;
  }): Promise<{ document: CreativeProjectDocument; previewDataUrl: string; audit: QualityAuditReport }> {
    const base = this.loadDocument(input.baseProjectId);
    const donor = this.loadDocument(input.donorProjectId);
    if (!base || !donor) {
      throw new Error('Base or donor Creative Studio project not found.');
    }
    const combined = this.conceptEngine.combineConceptElements({
      baseDocument: base,
      donorDocument: donor,
      takeFromDonor: input.takeFromDonor,
    });
    this.saveDocument(combined);
    this.editors.set(combined.id, new LayeredDocumentEditor(combined));
    const brandKit = combined.brandKitId ? this.brandKits.get(combined.brandKitId) : null;
    const [previewDataUrl, audit] = await Promise.all([
      this.renderPreviewDataUrl(combined),
      this.qualityGate.auditProject(combined, { brandKit }),
    ]);
    return { document: combined, previewDataUrl, audit };
  }

  private async runTypographyConceptLabImpl(input: {
    projectId: string;
    prompt?: string;
    headline?: string;
  }): Promise<{
    variants: Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale: string;
      document: CreativeProjectDocument;
      audit: QualityAuditReport;
      previewDataUrl: string;
    }>;
  }> {
    const base = this.loadDocument(input.projectId);
    if (!base) {
      throw new Error('Creative Studio project not found for Typography Concept Lab.');
    }
    const brandKit = base.brandKitId ? this.brandKits.get(base.brandKitId) : null;
    const lab = await generateTypographyConceptLab({
      baseDocument: base,
      input: {
        title: base.title,
        prompt: input.prompt ?? base.prompt,
        ...(input.headline ? { headline: input.headline } : {}),
        brandKit,
      },
      compositionEngine: this.engine,
    });
    const variants: Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale: string;
      document: CreativeProjectDocument;
      audit: QualityAuditReport;
      previewDataUrl: string;
    }> = [];
    for (const v of lab.variants) {
      this.saveDocument(v.document);
      this.editors.set(v.document.id, new LayeredDocumentEditor(v.document));
      const audit = await this.qualityGate.auditProject(v.document, {
        brandKit,
        renderedBuffer: v.previewBuffer,
      });
      variants.push({
        label: v.direction.label,
        styleTitle: `Tipografia ${v.direction.label} — ${v.direction.styleName}`,
        editorialRationale: v.direction.editorialRationale,
        document: v.document,
        audit,
        previewDataUrl: `data:image/png;base64,${v.previewBuffer.toString('base64')}`,
      });
    }
    return { variants };
  }

  /**
   * Automatically creates a thumbnail proposal when a Cinema Pipeline video finishes rendering.
   */
  private async generateThumbnailForCinemaVideoImpl(input: {
    cinemaProjectId: string;
    videoPath: string;
    prompt: string;
    headline?: string;
    brandKitId?: string;
    sceneHints?: VideoSceneHint[];
  }): Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
  }> {
    const lab = await this.runThumbnailLabFromVideo({
      videoPath: input.videoPath,
      prompt: input.prompt,
      ...(input.headline ? { headline: input.headline } : {}),
      ...(input.brandKitId ? { brandKitId: input.brandKitId } : {}),
      sourceCinemaProjectId: input.cinemaProjectId,
      ...(input.sceneHints ? { sceneHints: input.sceneHints } : {}),
    });

    const best = [...lab.variants].sort((a, b) => b.audit.scorecard.overall - a.audit.scorecard.overall)[0];
    if (!best) throw new Error('Thumbnail Lab returned no variants.');
    return {
      document: best.document,
      audit: best.audit,
      previewDataUrl: best.previewDataUrl,
    };
  }

  /** Technical state only: re-runs the automated gate and records it without touching the human decision. */
  async evaluateTechnicalApproval(projectId: string): Promise<CreativeProjectDocument> {
    const doc = this.loadDocument(projectId);
    if (!doc) throw new Error(`Creative project not found: ${projectId}`);
    const brandKit = doc.brandKitId ? this.brandKits.get(doc.brandKitId) : null;
    const audit = await this.qualityGate.auditProject(doc, { brandKit });
    const states = recordTechnicalAudit(doc.approvalStates ?? defaultApprovalStates(), audit);
    return this.saveDocument({ ...doc, approvalStates: states, updatedAt: new Date().toISOString() });
  }

  /**
   * Human aesthetic decision. It is recorded as given by the named reviewer and is NOT blocked by the technical
   * gate (independent states); the technical state is refreshed alongside so both are visible, and release
   * readiness requires technical + semantic fidelity + human approval.
   */
  async recordAestheticDecision(
    projectId: string,
    decision: 'approved' | 'rejected',
    reviewer: string,
    notes?: string,
  ): Promise<{ document: CreativeProjectDocument; readiness: ReleaseReadiness }> {
    const technical = await this.evaluateTechnicalApproval(projectId);
    const states = recordHumanAestheticDecision(technical.approvalStates ?? defaultApprovalStates(), {
      decision,
      reviewer,
      ...(notes ? { notes } : {}),
    });
    const updated: CreativeProjectDocument = {
      ...technical,
      approvalStates: states,
      // Legacy fields mirror ONLY the human aesthetic approval.
      ...(decision === 'approved'
        ? { approvedBy: states.humanAesthetic.reviewer, approvedAt: states.humanAesthetic.decidedAt }
        : { approvedBy: undefined, approvedAt: undefined }),
      updatedAt: new Date().toISOString(),
    };
    const saved = this.saveDocument(updated);
    return { document: saved, readiness: releaseReadiness(states) };
  }

  /** Kept for the existing IPC contract: records a human aesthetic approval (no longer gated by QualityGate). */
  async approveProject(projectId: string, approvedBy: string): Promise<CreativeProjectDocument> {
    return (await this.recordAestheticDecision(projectId, 'approved', approvedBy.trim() || 'Criador')).document;
  }

  approvalStatus(projectId: string): { states: ApprovalStates; readiness: ReleaseReadiness } {
    const doc = this.loadDocument(projectId);
    if (!doc) throw new Error(`Creative project not found: ${projectId}`);
    const states = doc.approvalStates ?? defaultApprovalStates();
    return { states, readiness: releaseReadiness(states) };
  }
}

export function registerCreativeStudioIpc(ipcMain: IpcMain, service: AetheraCreativeStudioService): void {
  ipcMain.handle('creative:engines', async () => {
    return service.orchestrator.detectAvailableEngines();
  });

  ipcMain.handle('creative:list-brand-kits', async () => {
    return service.brandKits.list();
  });

  ipcMain.handle(
    'creative:save-brand-kit',
    async (
      _ev,
      input: {
        id?: string;
        channelName: string;
        palette?: Partial<BrandKit['palette']>;
        typography?: Partial<BrandKit['typography']>;
      },
    ) => {
      if (input.id && service.brandKits.get(input.id)) {
        return service.brandKits.update(input.id, input);
      }
      return service.brandKits.create(input);
    },
  );

  ipcMain.handle('creative:list-projects', async (_ev, artType?: CreativeArtType) => {
    return service.listDocuments(artType);
  });

  ipcMain.handle('creative:load-project', async (_ev, projectId: string) => {
    const doc = service.loadDocument(projectId);
    if (!doc) return null;
    const brandKit = doc.brandKitId ? service.brandKits.get(doc.brandKitId) : null;
    const [previewDataUrl, audit] = await Promise.all([
      service.renderPreviewDataUrl(doc),
      service.qualityGate.auditProject(doc, { brandKit }),
    ]);
    return { document: doc, previewDataUrl, audit };
  });

  ipcMain.handle('creative:create-from-prompt', async (_ev, input: Parameters<AetheraCreativeStudioService['createFromPrompt']>[0]) => {
    return service.createFromPrompt(input);
  });
  ipcMain.handle('creative:generate-batch', async (_ev, input: Parameters<AetheraCreativeStudioService['generateBatch']>[0]) => {
    return service.generateBatch(input);
  });
  ipcMain.handle('creative:generation-history', async (_ev, limit?: number) => service.listGenerationHistory(limit));
  ipcMain.handle('creative:regenerate', async (_ev, id: string) => service.regenerateGeneration(id));

  ipcMain.handle('creative:thumbnail-lab', async (_ev, input: Parameters<AetheraCreativeStudioService['runThumbnailLabFromVideo']>[0]) => {
    try {
      return await service.runThumbnailLabFromVideo(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('[VisualContentGate]')) {
        throw new Error(
          `🚫 Aquisição de mídia bloqueada pelo VisualContentGate.\n\n${message}\n\n💡 Sugestões de recuperação:\n` +
          `• Verifique se o adapter de IA (SDXL/CLIP) está disponível e configurado.\n` +
          `• Forneça frames extraídos do vídeo como fonte de mídia autêntica.\n` +
          `• Ajuste o prompt para incluir termos mais específicos do assunto.\n` +
          `• Se o modelo local não estiver carregado, aguarde o download ou configure um adapter remoto.`,
          { cause: err },
        );
      }
      throw err;
    }
  });

  ipcMain.handle('creative:combine-concepts', async (_ev, input: Parameters<AetheraCreativeStudioService['combineThumbnailConcepts']>[0]) => {
    try {
      return await service.combineThumbnailConcepts(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('[VisualContentGate]')) {
        throw new Error(
          `🚫 Combinação de conceitos bloqueada pelo VisualContentGate.\n\n${message}\n\n💡 Verifique se as mídias de origem são relevantes ao tema e não são placeholders.`,
          { cause: err },
        );
      }
      throw err;
    }
  });

  ipcMain.handle('creative:typography-lab', async (_ev, input: Parameters<AetheraCreativeStudioService['runTypographyConceptLab']>[0]) => {
    try {
      return await service.runTypographyConceptLab(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('[VisualContentGate]')) {
        throw new Error(
          `🚫 Laboratório de tipografia bloqueado pelo VisualContentGate.\n\n${message}\n\n💡 Forneça mídia real ou verifique a disponibilidade do adapter de IA.`,
          { cause: err },
        );
      }
      throw err;
    }
  });

  ipcMain.handle(
    'creative:edit-layer',
    async (
      _ev,
      input: {
        projectId: string;
        action:
          | { kind: 'updateLayer'; layerId: string; patch: Partial<CreativeLayer> }
          | { kind: 'updateTransform'; layerId: string; transform: Partial<LayerTransform> }
          | { kind: 'align'; layerId: string; align: AlignTarget }
          | { kind: 'reorder'; layerId: string; direction: 'up' | 'down' | 'top' | 'bottom' }
          | { kind: 'removeLayer'; layerId: string }
          | { kind: 'duplicateLayer'; layerId: string }
          | { kind: 'setMask'; layerId: string; mask: LayerMask }
          | { kind: 'upsertEffect'; layerId: string; effect: LayerEffect }
          | { kind: 'removeEffect'; layerId: string; effectKind: LayerEffect['kind'] }
          | { kind: 'undo' }
          | { kind: 'redo' }
          | { kind: 'promptEdit'; instruction: string };
      },
    ) => {
      const editor = service.getOrCreateEditor(input.projectId);
      let promptSummary: string | undefined;
      switch (input.action.kind) {
        case 'updateLayer':
          editor.updateLayer(input.action.layerId, input.action.patch);
          break;
        case 'updateTransform':
          editor.updateTransform(input.action.layerId, input.action.transform);
          break;
        case 'align':
          editor.alignLayer(input.action.layerId, input.action.align);
          break;
        case 'reorder':
          editor.reorderLayer(input.action.layerId, input.action.direction);
          break;
        case 'removeLayer':
          editor.removeLayer(input.action.layerId);
          break;
        case 'duplicateLayer':
          editor.duplicateLayer(input.action.layerId);
          break;
        case 'setMask':
          editor.setMask(input.action.layerId, input.action.mask);
          break;
        case 'upsertEffect':
          editor.upsertEffect(input.action.layerId, input.action.effect);
          break;
        case 'removeEffect':
          editor.removeEffect(input.action.layerId, input.action.effectKind);
          break;
        case 'undo':
          editor.undo();
          break;
        case 'redo':
          editor.redo();
          break;
        case 'promptEdit': {
          const res = editor.applyLocalizedPromptEdit(input.action.instruction);
          promptSummary = res.summary;
          break;
        }
      }
      const saved = service.saveDocument(editor.getDocument());
      editor.markSaved(saved.updatedAt);
      const brandKit = saved.brandKitId ? service.brandKits.get(saved.brandKitId) : null;
      const [previewDataUrl, audit] = await Promise.all([
        service.renderPreviewDataUrl(saved),
        service.qualityGate.auditProject(saved, { brandKit }),
      ]);
      return {
        document: saved,
        previewDataUrl,
        audit,
        canUndo: editor.canUndo(),
        canRedo: editor.canRedo(),
        ...(promptSummary ? { promptSummary } : {}),
      };
    },
  );

  ipcMain.handle(
    'creative:export',
    async (_ev, input: { projectId: string; outputPath: string; format: ExportFormat; quality?: number }) => {
      const doc = service.loadDocument(input.projectId);
      if (!doc) throw new Error(`Creative project not found: ${input.projectId}`);
      return service.exporter.exportProject(doc, {
        outputPath: input.outputPath,
        format: input.format,
        ...(input.quality !== undefined ? { quality: input.quality } : {}),
      });
    },
  );

  ipcMain.handle('creative:approve', async (_ev, input: { projectId: string; approvedBy: string }) => {
    return service.approveProject(input.projectId, input.approvedBy);
  });

  ipcMain.handle(
    'creative:aesthetic-decision',
    async (_ev, input: { projectId: string; decision: 'approved' | 'rejected'; reviewer: string; notes?: string }) => {
      return service.recordAestheticDecision(input.projectId, input.decision, input.reviewer, input.notes);
    },
  );

  ipcMain.handle('creative:evaluate-technical', async (_ev, projectId: string) => {
    const doc = await service.evaluateTechnicalApproval(projectId);
    return service.approvalStatus(doc.id);
  });

  ipcMain.handle('creative:approval-status', async (_ev, projectId: string) => {
    return service.approvalStatus(projectId);
  });

  ipcMain.handle('creative:ingest-file', async (_ev, input: { sourcePath: string; kind: ManagedAssetRef['kind'] }) => {
    return service.ingestion.ingestFile(input);
  });

  ipcMain.handle('creative:ai-status', async () => {
    return {
      available: await service.imageAdapter.isAvailable(),
      provider: service.imageAdapter.id,
    };
  });

  ipcMain.handle('creative:image-engine-status', async () => service.imageEngineStatus());
  ipcMain.handle('creative:cancel-generation', async () => service.cancelImageGeneration());
  ipcMain.handle('creative:release-image-memory', async () => service.releaseImageMemory());
  ipcMain.handle('creative:upscale-project-background', async (_ev, input: { projectId: string; model: string }) => service.upscaleProjectBackground(input));
  ipcMain.handle('creative:image-engine-settings', async () => service.getImageEngineSettings());
  ipcMain.handle('creative:save-image-engine-settings', async (_ev, input: unknown) => service.saveImageEngineSettings(input));
}
