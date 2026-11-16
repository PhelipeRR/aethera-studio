import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { TraceMoeProvenanceAdapter } from '@neuralbridge/cinema';
import {
  AssetIngestionService,
  BrandKitManager,
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
  generateTypographyConceptLab,
  type AlignTarget,
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
  type ReasoningEngineProvider,
  type ThumbnailLabVariant,
  type VideoSceneHint,
  type VisualConceptCritique,
} from '@neuralbridge/creative-studio';
import { AetheraCreativeStudioRepository, type Db } from '@neuralbridge/database';
import { detectAntigravityCli, runAntigravityPrompt } from './antigravity-cli.js';
import { createProductionJobId, type ProductionConsoleService } from './production-console.js';

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
  readonly engine: SharpSvgCompositionEngine;
  readonly exporter: ExportService;
  readonly frameAnalyzer: VideoFrameAnalyzer;
  readonly qualityGate: QualityGateService;
  readonly planner: CompositionPlanner;
  readonly orchestrator: CreativeOrchestrator;
  readonly conceptEngine: ConceptDrivenEngine;
  private readonly editors = new Map<string, LayeredDocumentEditor>();
  private readonly productionConsole: ProductionConsoleService | undefined;
  /** Console job of the creative execution in progress; concurrent thumbnails each carry their own. */
  private readonly consoleJob = new AsyncLocalStorage<CreativeConsoleJob>();

  constructor(options: CreativeStudioServiceOptions) {
    this.productionConsole = options.productionConsole;
    this.repo = new AetheraCreativeStudioRepository(options.db);
    this.storageRoot = join(options.userDataDir, 'creative-studio');
    this.ingestion = new AssetIngestionService({
      storageRoot: this.storageRoot,
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
    });
    this.brandKits = new BrandKitManager(new SqliteBrandKitStore(this.repo));
    this.imageAdapter = new ProviderChainImageAdapter([new LocalPythonAiAdapter()]);
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
    });
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
    assetManifest?: Record<string, ManagedAssetRef>;
  }): Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
    availableEngines: string[];
  }> {
    const brandKit = input.brandKitId ? this.brandKits.get(input.brandKitId) : null;
    let backgroundAsset = input.backgroundAssetId ? input.assetManifest?.[input.backgroundAssetId] ?? null : null;
    let subjectAsset = input.subjectAssetId ? input.assetManifest?.[input.subjectAssetId] ?? null : null;

    if (input.useAiGeneration && !backgroundAsset && (await this.imageAdapter.isAvailable())) {
      const genBuffer = await this.imageAdapter.generateImage({
        prompt: input.prompt,
        width: input.artType === 'avatar' ? 768 : 1024,
        height: input.artType === 'avatar' ? 768 : 576,
      });
      const generatedAsset = await this.ingestion.ingestBuffer({
        buffer: genBuffer,
        kind: 'image',
        extension: 'png',
        originalName: `ai-gen-${Date.now()}.png`,
      });
      if (input.artType === 'avatar' && !subjectAsset) {
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
        }
      } else {
        backgroundAsset = generatedAsset;
      }
    }

    const activeBrandKit = input.brandKitId ? this.brandKits.get(input.brandKitId) : brandKit;
    const result = await this.orchestrator.orchestrateCreation({
      artType: input.artType,
      prompt: input.prompt,
      ...(input.title ? { title: input.title } : {}),
      ...(input.headline ? { headline: input.headline } : {}),
      brandKit: activeBrandKit,
      backgroundAsset,
      subjectAsset,
      ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
      ...(input.avatarBackdrop ? { avatarBackdrop: input.avatarBackdrop } : {}),
    });

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

    return {
      document: saved,
      audit: result.audit,
      previewDataUrl,
      availableEngines: result.availableEngines,
    };
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

    const best = [...lab.variants].sort((a, b) => b.audit.scorecard.overall - a.audit.scorecard.overall)[0]!;
    return {
      document: best.document,
      audit: best.audit,
      previewDataUrl: best.previewDataUrl,
    };
  }

  async approveProject(projectId: string, approvedBy: string): Promise<CreativeProjectDocument> {
    const doc = this.loadDocument(projectId);
    if (!doc) throw new Error(`Creative project not found: ${projectId}`);
    const brandKit = doc.brandKitId ? this.brandKits.get(doc.brandKitId) : null;
    const audit = await this.qualityGate.auditProject(doc, { brandKit });
    if (!audit.passed) {
      throw new Error(
        `Aprovação bloqueada pelo Quality Gate (${audit.criticalCount} problema(s) crítico(s)): ${audit.findings
          .filter((f) => f.severity === 'critical')
          .map((f) => f.message)
          .join('; ')}`,
      );
    }
    const updated: CreativeProjectDocument = {
      ...doc,
      approvedBy: approvedBy.trim() || 'Criador',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.saveDocument(updated);
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

  ipcMain.handle('creative:ingest-file', async (_ev, input: { sourcePath: string; kind: ManagedAssetRef['kind'] }) => {
    return service.ingestion.ingestFile(input);
  });

  ipcMain.handle('creative:ai-status', async () => {
    return {
      available: await service.imageAdapter.isAvailable(),
      provider: service.imageAdapter.id,
    };
  });
}
