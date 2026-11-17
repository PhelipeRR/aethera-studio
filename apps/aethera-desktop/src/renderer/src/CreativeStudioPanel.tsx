import { useEffect, useState } from 'react';
import { ProductionConsoleAccordion } from '@/features/video/ProductionConsoleAccordion';
import type {
  BrandKit,
  CreativeArtType,
  CreativeLayer,
  CreativeProjectDocument,
  ProfessionalPresetId,
  QualityAuditReport,
} from '@neuralbridge/creative-studio';

interface CreativeBridge {
  creativeEngines?: () => Promise<string[]>;
  creativeListBrandKits?: () => Promise<BrandKit[]>;
  creativeSaveBrandKit?: (input: Record<string, unknown>) => Promise<BrandKit>;
  creativeListProjects?: (artType?: string) => Promise<CreativeProjectDocument[]>;
  creativeLoadProject?: (projectId: string) => Promise<{
    document: CreativeProjectDocument;
    previewDataUrl: string;
    audit: QualityAuditReport;
  } | null>;
  creativeCreateFromPrompt?: (input: Record<string, unknown>) => Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
    availableEngines: string[];
    generation?: {
      status: 'generated' | 'disabled' | 'unavailable' | 'failed' | 'skipped_existing_background';
      engineId: string;
      message: string;
      durationMs?: number;
      recipe?: { preset: string; seed: number; source: 'deterministic' | 'reasoning_engine'; stylization?: number };
      referenceStrength?: number;
      attempts?: number;
      lora?: { model: string; strengthModel: number; strengthClip: number };
      controlNet?: { model: string; strength: number; imagePath: string };
      ipAdapter?: { model: string; clipVisionModel: string; weight: number; referenceImagePath?: string };
      faceDetailer?: { detectorModel: string; denoise?: number; guideSize?: number; maxSize?: number };
      qualityAudit?: { passed: boolean; metrics: { lumaStdDev: number }; findings: Array<{ message: string }> };
      generationRunId?: string;
    };
  }>;
  creativeGenerateBatch?: (input: Record<string, unknown>) => Promise<Array<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
    generation?: {
      status: 'generated' | 'disabled' | 'unavailable' | 'failed' | 'skipped_existing_background';
      engineId: string;
      message: string;
      durationMs?: number;
      recipe?: { preset: string; seed: number; source: 'deterministic' | 'reasoning_engine'; stylization?: number };
      referenceStrength?: number;
      attempts?: number;
      lora?: { model: string; strengthModel: number; strengthClip: number };
      controlNet?: { model: string; strength: number; imagePath: string };
      ipAdapter?: { model: string; clipVisionModel: string; weight: number; referenceImagePath?: string };
      faceDetailer?: { detectorModel: string; denoise?: number; guideSize?: number; maxSize?: number };
      qualityAudit?: { passed: boolean; metrics: { lumaStdDev: number }; findings: Array<{ message: string }> };
      generationRunId?: string;
    };
  }>>;
  creativeGenerationHistory?: (limit?: number) => Promise<Array<{
    id: string;
    projectId: string | null;
    artType: string;
    prompt: string;
    status: string;
    createdAt: string;
    report: { status: string; engineId: string; message: string; durationMs?: number; recipe?: { preset: string; seed: number } };
  }>>;
  creativeRegenerate?: (id: string) => Promise<Awaited<ReturnType<NonNullable<CreativeBridge['creativeCreateFromPrompt']>>>>;
  creativeThumbnailLab?: (input: Record<string, unknown>) => Promise<{
    availableEngines: string[];
    variants: Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale?: string;
      concept?: {
        archetype: string;
        focalSubject: string;
        visualNarrative: string;
        fidelityMode?: 'conceptual_art' | 'content_faithful' | 'authentic_gameplay';
        curiosityHook?: string;
      };
      postRenderCritique?: { semanticScore?: number; passed: boolean };
      document: CreativeProjectDocument;
      audit: QualityAuditReport;
      previewDataUrl: string;
    }>;
  }>;
  creativeCombineConcepts?: (input: {
    baseProjectId: string;
    donorProjectId: string;
    takeFromDonor: Array<'typography' | 'vfx' | 'watermark' | 'background'>;
  }) => Promise<{
    document: CreativeProjectDocument;
    previewDataUrl: string;
    audit: QualityAuditReport;
  }>;
  creativeEditLayer?: (input: Record<string, unknown>) => Promise<{
    document: CreativeProjectDocument;
    previewDataUrl: string;
    audit: QualityAuditReport;
    canUndo: boolean;
    canRedo: boolean;
    promptSummary?: string;
  }>;
  creativeApprove?: (input: { projectId: string; approvedBy: string }) => Promise<CreativeProjectDocument>;
  creativeAestheticDecision?: (input: {
    projectId: string;
    decision: 'approved' | 'rejected';
    reviewer: string;
    notes?: string;
  }) => Promise<{ document: CreativeProjectDocument; readiness: { ready: boolean; blockers: string[] } }>;
  creativeAiStatus?: () => Promise<{ available: boolean; provider: string }>;
  creativeImageEngineStatus?: () => Promise<{
    comfyUi: {
      state: 'ready' | 'misconfigured' | 'offline' | 'not_installed';
      endpoint?: string;
      version?: string;
      reason?: string;
      models: { checkpoints: string[]; loras: string[]; controlnet: string[]; ipadapter: string[]; clip_vision: string[]; upscale_models: string[]; faceDetectors: string[] };
      capabilities: { nativeTxt2Img: boolean; nativeImg2Img: boolean; inpaint: boolean; controlNet: boolean; ipAdapter: boolean; faceDetailer: boolean; upscale: boolean; lora: boolean };
    };
    localAvailable: boolean;
    activeProvider: string;
  }>;
  creativeImageEngineSettings?: () => Promise<{
    settings: { endpoint: string; checkpoint: string; preferredPreset: ProfessionalPresetId; releaseMemoryAfterGeneration: boolean };
    availableCheckpoints: string[];
    status: NonNullable<Awaited<ReturnType<NonNullable<CreativeBridge['creativeImageEngineStatus']>>>>;
  }>;
  creativeSaveImageEngineSettings?: (input: Record<string, unknown>) => Promise<{
    settings: { endpoint: string; checkpoint: string; preferredPreset: ProfessionalPresetId; releaseMemoryAfterGeneration: boolean };
    availableCheckpoints: string[];
    status: NonNullable<Awaited<ReturnType<NonNullable<CreativeBridge['creativeImageEngineStatus']>>>>;
    requiresRestart: boolean;
  }>;
  creativeCancelGeneration?: () => Promise<boolean>;
  creativeReleaseImageMemory?: () => Promise<boolean>;
  creativeUpscaleProjectBackground?: (input: { projectId: string; model: string }) => Promise<{
    document: CreativeProjectDocument;
    audit: QualityAuditReport;
    previewDataUrl: string;
  }>;
}

function getBridge(): CreativeBridge | undefined {
  return (window as unknown as { aetheraBridge?: CreativeBridge }).aetheraBridge;
}

export function CreativeStudioPanel() {
  const [artType, setArtType] = useState<CreativeArtType>('thumbnail');
  const [prompt, setPrompt] = useState('');
  const [headline, setHeadline] = useState('');
  const [referencePath, setReferencePath] = useState('');
  const [referenceStrength, setReferenceStrength] = useState(0.55);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [characterCount, setCharacterCount] = useState(1);
  const [generationSeed, setGenerationSeed] = useState('');
  const [maxSide, setMaxSide] = useState(1024);
  const [stylization, setStylization] = useState(0.7);
  const [batchSize, setBatchSize] = useState(1);
  const [videoPath, setVideoPath] = useState('');
  const [engines, setEngines] = useState<string[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string>('');
  const [newKitName, setNewKitName] = useState('');
  const [projects, setProjects] = useState<CreativeProjectDocument[]>([]);
  const [generationHistory, setGenerationHistory] = useState<Awaited<ReturnType<NonNullable<CreativeBridge['creativeGenerationHistory']>>>>([]);
  const [activeDoc, setActiveDoc] = useState<CreativeProjectDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [audit, setAudit] = useState<QualityAuditReport | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [promptEditInput, setPromptEditInput] = useState('');
  const [bannerPreviewMode, setBannerPreviewMode] = useState<'desktop' | 'mobile' | 'tv'>('desktop');
  const [avatarBackdrop, setAvatarBackdrop] = useState<'dark' | 'light' | 'transparent'>('dark');
  const [useAiGeneration, setUseAiGeneration] = useState<boolean>(true);
  const [professionalPreset, setProfessionalPreset] = useState<ProfessionalPresetId>('youtube_thumbnail_1280x720');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('');
  const [selectedLora, setSelectedLora] = useState('');
  const [loraStrength, setLoraStrength] = useState(0.8);
  const [selectedControlNet, setSelectedControlNet] = useState('');
  const [controlNetImagePath, setControlNetImagePath] = useState('');
  const [controlNetStrength, setControlNetStrength] = useState(0.65);
  const [selectedIpAdapter, setSelectedIpAdapter] = useState('');
  const [selectedClipVision, setSelectedClipVision] = useState('');
  const [ipAdapterWeight, setIpAdapterWeight] = useState(0.8);
  const [selectedFaceDetector, setSelectedFaceDetector] = useState('');
  const [selectedUpscaleModel, setSelectedUpscaleModel] = useState('');
  const [releaseMemoryAfterGeneration, setReleaseMemoryAfterGeneration] = useState(false);
  const [fidelityMode, setFidelityMode] = useState<'conceptual_art' | 'content_faithful' | 'authentic_gameplay'>(
    'conceptual_art',
  );
  const [videoSourceType, setVideoSourceType] = useState<'authentic_gameplay' | 'synthetic_ai_clip' | 'unknown'>(
    'unknown',
  );
  const [aiAvailable, setAiAvailable] = useState<boolean>(false);
  const [labVariants, setLabVariants] = useState<
    Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale?: string;
      concept?: {
        archetype: string;
        focalSubject: string;
        visualNarrative: string;
        fidelityMode?: 'conceptual_art' | 'content_faithful' | 'authentic_gameplay';
        curiosityHook?: string;
      };
      postRenderCritique?: { semanticScore?: number; passed: boolean };
      document: CreativeProjectDocument;
      audit: QualityAuditReport;
      previewDataUrl: string;
    }>
  >([]);
  const [statusMsg, setStatusMsg] = useState<string>('');
  /** CF-1: AI fallback is never silent — this warning explains why the art used only the palette. */
  const [generationWarning, setGenerationWarning] = useState<string>('');
  const [generationReport, setGenerationReport] = useState<{
    status: 'generated' | 'disabled' | 'unavailable' | 'failed' | 'skipped_existing_background';
    engineId: string;
    message: string;
    durationMs?: number;
    recipe?: { preset: string; seed: number; source: 'deterministic' | 'reasoning_engine'; stylization?: number };
    referenceStrength?: number;
    attempts?: number;
    lora?: { model: string; strengthModel: number; strengthClip: number };
    controlNet?: { model: string; strength: number; imagePath: string };
    ipAdapter?: { model: string; clipVisionModel: string; weight: number; referenceImagePath?: string };
    faceDetailer?: { detectorModel: string; denoise?: number; guideSize?: number; maxSize?: number };
    qualityAudit?: { passed: boolean; metrics: { lumaStdDev: number }; findings: Array<{ message: string }> };
  } | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [batchPreviews, setBatchPreviews] = useState<Array<{ id: string; previewDataUrl: string }>>([]);
  const [engineStatus, setEngineStatus] = useState<Awaited<ReturnType<NonNullable<CreativeBridge['creativeImageEngineStatus']>>> | null>(null);

  const refreshLists = async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const [eng, kits, projs, ai, imageEngine, persistedImageEngine, history] = await Promise.all([
      bridge.creativeEngines?.() ?? Promise.resolve([]),
      bridge.creativeListBrandKits?.() ?? Promise.resolve([]),
      bridge.creativeListProjects?.() ?? Promise.resolve([]),
      bridge.creativeAiStatus?.() ?? Promise.resolve({ available: false, provider: 'none' }),
      bridge.creativeImageEngineStatus?.() ?? Promise.resolve(null),
      bridge.creativeImageEngineSettings?.() ?? Promise.resolve(null),
      bridge.creativeGenerationHistory?.(20) ?? Promise.resolve([]),
    ]);
    setEngines(eng);
    setBrandKits(kits);
    setProjects(projs);
    setGenerationHistory(history);
    setAiAvailable(ai.available);
    if (persistedImageEngine) {
      setEngineStatus(persistedImageEngine.status);
      setSelectedCheckpoint(persistedImageEngine.settings.checkpoint);
      setProfessionalPreset(persistedImageEngine.settings.preferredPreset);
      setReleaseMemoryAfterGeneration(persistedImageEngine.settings.releaseMemoryAfterGeneration);
      setSelectedUpscaleModel(persistedImageEngine.status.comfyUi.models.upscale_models[0] ?? '');
    } else if (imageEngine) {
      setEngineStatus(imageEngine);
      setSelectedUpscaleModel(imageEngine.comfyUi.models.upscale_models[0] ?? '');
    }
  };

  useEffect(() => {
    void refreshLists();
  }, []);

  const handleCreate = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeCreateFromPrompt || !prompt.trim()) return;
    setStatusMsg('Gerando composição editável...');
    setGenerationWarning('');
    setGenerationReport(null);
    setBatchPreviews([]);
    setGenerationBusy(true);
    try {
      const request: Record<string, unknown> = {
        artType,
        prompt: prompt.trim(),
        ...(headline.trim() ? { headline: headline.trim() } : {}),
        ...(selectedBrandKitId ? { brandKitId: selectedBrandKitId } : {}),
        ...(artType === 'avatar' ? { avatarBackdrop } : {}),
        useAiGeneration,
        professionalPreset,
        ...(referencePath.trim() ? { referenceImagePaths: [referencePath.trim()] } : {}),
        ...(referencePath.trim() ? { referenceStrength } : {}),
        ...(selectedLora ? { lora: { model: selectedLora, strengthModel: loraStrength, strengthClip: loraStrength } } : {}),
        ...(selectedControlNet && controlNetImagePath.trim()
          ? { controlNet: { model: selectedControlNet, imagePath: controlNetImagePath.trim(), strength: controlNetStrength } }
          : {}),
        ...(selectedIpAdapter && selectedClipVision && referencePath.trim()
          ? { ipAdapter: { model: selectedIpAdapter, clipVisionModel: selectedClipVision, referenceImagePath: referencePath.trim(), weight: ipAdapterWeight } }
          : {}),
        ...(engineStatus?.comfyUi.capabilities.faceDetailer && engineStatus.comfyUi.models.faceDetectors.includes(selectedFaceDetector)
          ? { faceDetailer: { detectorModel: selectedFaceDetector, denoise: 0.35, guideSize: 512, maxSize: 1024 } }
          : {}),
        maxAttempts,
        characterCount,
        maxSide,
        stylization,
        ...(generationSeed.trim() ? { seed: Number(generationSeed) } : {}),
      };
      const results = batchSize > 1 && bridge.creativeGenerateBatch
        ? await bridge.creativeGenerateBatch({ ...request, batchSize })
        : [await bridge.creativeCreateFromPrompt(request)];
      const res = results[0];
      if (!res) throw new Error('O lote de geração não retornou nenhum resultado.');
      setActiveDoc(res.document);
      setPreviewUrl(res.previewDataUrl);
      setAudit(res.audit);
      setSelectedLayerId(res.document.layers[res.document.layers.length - 1]?.id ?? '');
      const gen = res.generation;
      setGenerationReport(gen ?? null);
      setBatchPreviews(results.map((result) => ({ id: result.document.id, previewDataUrl: result.previewDataUrl })));
      setStatusMsg(
        `Projeto criado (${res.document.width}×${res.document.height}) e salvo automaticamente.` +
          (gen?.status === 'generated' && gen.recipe
            ? ` Fundo por IA: preset ${gen.recipe.preset}, seed ${gen.recipe.seed}.`
            : ''),
      );
      if (gen && useAiGeneration && (gen.status === 'unavailable' || gen.status === 'failed')) {
        setGenerationWarning(gen.message);
      }
      await refreshLists();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerationBusy(false);
    }
  };

  const handleCancelGeneration = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeCancelGeneration) return;
    const cancelled = await bridge.creativeCancelGeneration();
    setStatusMsg(cancelled ? 'Cancelamento solicitado ao motor de imagem.' : 'Nenhuma geração ComfyUI ativa para cancelar.');
  };

  const handleUpscale = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeUpscaleProjectBackground || !activeDoc || !selectedUpscaleModel) return;
    setGenerationBusy(true);
    setStatusMsg('Executando upscale no ComfyUI...');
    try {
      const res = await bridge.creativeUpscaleProjectBackground({ projectId: activeDoc.id, model: selectedUpscaleModel });
      setActiveDoc(res.document);
      setPreviewUrl(res.previewDataUrl);
      setAudit(res.audit);
      setStatusMsg(`Upscale concluído com ${selectedUpscaleModel}.`);
      await refreshLists();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerationBusy(false);
    }
  };

  const handleRegenerate = async (id: string) => {
    const bridge = getBridge();
    if (!bridge?.creativeRegenerate) return;
    setGenerationBusy(true);
    setStatusMsg('Regenerando a partir do histórico...');
    try {
      const res = await bridge.creativeRegenerate(id);
      setActiveDoc(res.document);
      setPreviewUrl(res.previewDataUrl);
      setAudit(res.audit);
      setGenerationReport(res.generation ?? null);
      setSelectedLayerId(res.document.layers[res.document.layers.length - 1]?.id ?? '');
      setStatusMsg('Regeneração concluída e salva como novo projeto.');
      await refreshLists();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerationBusy(false);
    }
  };

  const saveImageEngineSettings = async (patch: Record<string, unknown>) => {
    const saved = await getBridge()?.creativeSaveImageEngineSettings?.(patch);
    if (!saved) return;
    setEngineStatus(saved.status);
    setSelectedCheckpoint(saved.settings.checkpoint);
    setProfessionalPreset(saved.settings.preferredPreset);
    setReleaseMemoryAfterGeneration(saved.settings.releaseMemoryAfterGeneration);
    setStatusMsg(saved.requiresRestart ? 'Configuração salva; reinicie o Aethera para aplicar o endpoint.' : 'Configuração do engine salva.');
  };

  const handleThumbnailLab = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeThumbnailLab || !prompt.trim()) return;
    setStatusMsg('Gerando 3 variações no Thumbnail Lab...');
    try {
      const res = await bridge.creativeThumbnailLab({
        prompt: prompt.trim(),
        fidelityMode,
        ...(videoPath.trim() ? { videoSourceType } : {}),
        ...(headline.trim() ? { headline: headline.trim() } : {}),
        ...(videoPath.trim() ? { videoPath: videoPath.trim() } : {}),
        ...(selectedBrandKitId ? { brandKitId: selectedBrandKitId } : {}),
      });
      setLabVariants(res.variants);
      if (res.variants[0]) {
        setActiveDoc(res.variants[0].document);
        setPreviewUrl(res.variants[0].previewDataUrl);
        setAudit(res.variants[0].audit);
        setSelectedLayerId(res.variants[0].document.layers[res.variants[0].document.layers.length - 1]?.id ?? '');
      }
      setStatusMsg(`Thumbnail Lab pronto: ${res.variants.length} variações geradas.`);
      await refreshLists();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEditAction = async (action: Record<string, unknown>) => {
    const bridge = getBridge();
    if (!bridge?.creativeEditLayer || !activeDoc) return;
    const res = await bridge.creativeEditLayer({ projectId: activeDoc.id, action });
    setActiveDoc(res.document);
    setPreviewUrl(res.previewDataUrl);
    setAudit(res.audit);
    setCanUndo(res.canUndo);
    setCanRedo(res.canRedo);
    if (res.promptSummary) setStatusMsg(res.promptSummary);
  };

  const handleCreateBrandKit = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeSaveBrandKit || !newKitName.trim()) return;
    const kit = await bridge.creativeSaveBrandKit({ channelName: newKitName.trim() });
    setNewKitName('');
    setSelectedBrandKitId(kit.id);
    await refreshLists();
  };

  const selectedLayer: CreativeLayer | undefined = activeDoc?.layers.find((l) => l.id === selectedLayerId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Aethera Creative Studio</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted-foreground)' }}>
            Motores ativos: {engines.length > 0 ? engines.join(' • ') : 'Planejador Determinístico Local'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['thumbnail', 'banner', 'avatar', 'watermark'] as CreativeArtType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setArtType(t);
                if (t === 'banner') setProfessionalPreset('banner_2560x1440');
                else if (t === 'thumbnail' && professionalPreset === 'banner_2560x1440') setProfessionalPreset('youtube_thumbnail_1280x720');
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: artType === t ? 'var(--primary)' : 'var(--card)',
                color: artType === t ? 'var(--primary-foreground)' : 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              {t === 'thumbnail' ? 'Thumbnail (1280×720)' : t === 'banner' ? 'Banner (2560×1440)' : t === 'avatar' ? 'Avatar (800×800)' : 'Marca d\'Água (150×150)'}
            </button>
          ))}
        </div>
      </div>

      <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}>
        <div>
          <strong>Engine de imagem</strong>{' '}
          <span style={{ color: engineStatus?.comfyUi.state === 'ready' ? 'var(--success)' : 'var(--warning)' }}>
            {engineStatus?.comfyUi.state ?? 'verificando'}
          </span>
          <span style={{ color: 'var(--muted-foreground)', marginLeft: 8 }}>
            ativo: {engineStatus?.activeProvider ?? '—'}
          </span>
        </div>
        {engineStatus?.comfyUi.reason && (
          <span style={{ color: 'var(--muted-foreground)', maxWidth: 620 }}>{engineStatus.comfyUi.reason}</span>
        )}
        {engineStatus && (
          <span style={{ color: 'var(--muted-foreground)' }}>
            recursos: {[
              engineStatus.comfyUi.capabilities.inpaint && 'inpaint',
              engineStatus.comfyUi.capabilities.controlNet && 'ControlNet',
              engineStatus.comfyUi.capabilities.ipAdapter && 'IP-Adapter',
              engineStatus.comfyUi.capabilities.faceDetailer && 'FaceDetailer',
              engineStatus.comfyUi.capabilities.upscale && 'upscale',
              engineStatus.comfyUi.capabilities.lora && 'LoRA',
            ].filter(Boolean).join(' · ') || 'somente nodes básicos'}
          </span>
        )}
        {engineStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted-foreground)' }}>
            <span>checkpoints: {engineStatus.comfyUi.models.checkpoints.length} · LoRAs: {engineStatus.comfyUi.models.loras.length}</span>
            {engineStatus.comfyUi.models.checkpoints.length > 0 && (
              <select
                aria-label="Checkpoint ComfyUI"
                value={selectedCheckpoint}
                onChange={(e) => void saveImageEngineSettings({ checkpoint: e.target.value })}
                style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }}
              >
                {engineStatus.comfyUi.models.checkpoints.map((checkpoint) => <option key={checkpoint} value={checkpoint}>{checkpoint}</option>)}
              </select>
            )}
            {engineStatus.comfyUi.models.loras.length > 0 && (
              <>
                <select
                  aria-label="LoRA ComfyUI"
                  value={selectedLora}
                  onChange={(e) => setSelectedLora(e.target.value)}
                  style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
                >
                  <option value="">Sem LoRA</option>
                  {engineStatus.comfyUi.models.loras.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }} title="Força aplicada ao modelo e ao CLIP">
                  força LoRA
                  <input aria-label="Força da LoRA" type="number" min={-1} max={2} step={0.05} value={loraStrength} onChange={(e) => setLoraStrength(Number(e.target.value))} style={{ width: 52, padding: '3px 4px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }} />
                </label>
              </>
            )}
            {engineStatus.comfyUi.models.controlnet.length > 0 && (
              <select
                aria-label="Modelo ControlNet ComfyUI"
                value={selectedControlNet}
                onChange={(e) => setSelectedControlNet(e.target.value)}
                style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
              >
                <option value="">Sem ControlNet</option>
                {engineStatus.comfyUi.models.controlnet.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            )}
            {engineStatus.comfyUi.models.ipadapter.length > 0 && engineStatus.comfyUi.models.clip_vision.length > 0 && (
              <>
                <select
                  aria-label="Modelo IP-Adapter ComfyUI"
                  value={selectedIpAdapter}
                  onChange={(e) => setSelectedIpAdapter(e.target.value)}
                  style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
                >
                  <option value="">Sem IP-Adapter</option>
                  {engineStatus.comfyUi.models.ipadapter.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <select
                  aria-label="Encoder CLIP Vision ComfyUI"
                  value={selectedClipVision}
                  onChange={(e) => setSelectedClipVision(e.target.value)}
                  style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
                >
                  <option value="">Sem encoder</option>
                  {engineStatus.comfyUi.models.clip_vision.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }} title="Peso da identidade visual; exige imagem de referência">
                  peso IP
                  <input aria-label="Peso do IP-Adapter" type="number" min={-1} max={5} step={0.05} value={ipAdapterWeight} onChange={(e) => setIpAdapterWeight(Number(e.target.value))} style={{ width: 52, padding: '3px 4px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }} />
                </label>
              </>
            )}
            {engineStatus.comfyUi.capabilities.faceDetailer && engineStatus.comfyUi.models.faceDetectors.length > 0 && (
              <select
                aria-label="Detector do FaceDetailer ComfyUI"
                value={selectedFaceDetector}
                onChange={(e) => setSelectedFaceDetector(e.target.value)}
                style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
              >
                <option value="">Sem FaceDetailer</option>
                {engineStatus.comfyUi.models.faceDetectors.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            )}
            {engineStatus.comfyUi.models.upscale_models.length > 0 && (
              <select
                aria-label="Modelo de upscale ComfyUI"
                value={selectedUpscaleModel}
                onChange={(e) => setSelectedUpscaleModel(e.target.value)}
                style={{ padding: '4px 6px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, maxWidth: 220 }}
              >
                {engineStatus.comfyUi.models.upscale_models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={releaseMemoryAfterGeneration}
                onChange={(e) => void saveImageEngineSettings({ releaseMemoryAfterGeneration: e.target.checked })}
              />
              liberar após gerar
            </label>
            {getBridge()?.creativeReleaseImageMemory && (
              <button
                onClick={async () => {
                  const released = await getBridge()?.creativeReleaseImageMemory?.();
                  setStatusMsg(released ? 'Memória do ComfyUI liberada.' : 'O gateway ComfyUI não expõe liberação de memória.');
                }}
                style={{ padding: '4px 8px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', fontSize: 11 }}
              >
                Liberar VRAM
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Descreva a arte desejada (ex.: Thumbnail Cyberpunk 2077 upgrades cibernéticos com alto contraste)..."
            rows={2}
            style={{ width: '100%', padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Título / Monograma curto"
              style={{ flex: 1, minWidth: 160, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            {artType === 'thumbnail' && (
              <input
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                placeholder="Caminho opcional do vídeo (.mp4) para extrair frames"
                style={{ flex: 1.4, minWidth: 200, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
              />
            )}
            {artType === 'avatar' && (
              <select
                value={avatarBackdrop}
                onChange={(e) => setAvatarBackdrop(e.target.value as 'dark' | 'light' | 'transparent')}
                style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <option value="dark">Versão Escura</option>
                <option value="light">Versão Clara</option>
                <option value="transparent">Transparente</option>
              </select>
            )}
            <input
              value={referencePath}
              onChange={(e) => setReferencePath(e.target.value)}
              placeholder="Referência local opcional (.png/.jpg)"
              aria-label="Caminho da imagem de referência"
              style={{ flex: 1.2, minWidth: 220, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            {engineStatus?.comfyUi.models.controlnet.length && selectedControlNet ? (
              <>
                <input
                  aria-label="Imagem de condicionamento ControlNet"
                  value={controlNetImagePath}
                  onChange={(e) => setControlNetImagePath(e.target.value)}
                  placeholder="Imagem de controle (canny/pose/depth)"
                  style={{ flex: 1.2, minWidth: 220, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }} title="Força da condição ControlNet">
                  força CN
                  <input aria-label="Força do ControlNet" type="number" min={0} max={2} step={0.05} value={controlNetStrength} onChange={(e) => setControlNetStrength(Number(e.target.value))} style={{ width: 52, padding: '3px 4px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }} />
                </label>
              </>
            ) : null}
            {referencePath.trim() && (
              <select
                aria-label="Preservação da referência"
                value={referenceStrength}
                onChange={(e) => setReferenceStrength(Number(e.target.value))}
                title="Denoise img2img: valores menores preservam mais a referência"
                style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <option value={0.32}>Referência alta (mais fiel)</option>
                <option value={0.55}>Referência equilibrada</option>
                <option value={0.75}>Interpretação criativa</option>
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              aria-label="Preset profissional"
              value={professionalPreset}
              onChange={(e) => void saveImageEngineSettings({ preferredPreset: e.target.value as ProfessionalPresetId })}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              <option value="youtube_thumbnail_1280x720">YouTube Thumbnail 1280×720</option>
              <option value="anime_premium_cinematic">Anime Premium</option>
              <option value="anime_cinematic">Anime Cinematic</option>
              <option value="gaming_cinematic">Gaming Cinematic</option>
              <option value="cyberpunk_neon">Cyberpunk Neon</option>
              <option value="banner_2560x1440">Banner 2560×1440</option>
            </select>
            <select
              aria-label="Quantidade de personagens"
              value={characterCount}
              onChange={(e) => setCharacterCount(Number(e.target.value))}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} personagem{count === 1 ? '' : 'ns'}</option>)}
            </select>
            <select
              aria-label="Resolução da geração IA"
              value={maxSide}
              onChange={(e) => setMaxSide(Number(e.target.value))}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              <option value={768}>IA 768 px (mais leve)</option>
              <option value={1024}>IA 1024 px (qualidade)</option>
            </select>
            <select
              aria-label="Intensidade de estilização"
              value={stylization}
              onChange={(e) => setStylization(Number(e.target.value))}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              <option value={0.3}>Estilo contido</option>
              <option value={0.7}>Estilo equilibrado</option>
              <option value={0.95}>Estilo intenso</option>
            </select>
            <input
              aria-label="Seed da geração IA"
              value={generationSeed}
              onChange={(e) => setGenerationSeed(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
              placeholder="Seed (opcional)"
              inputMode="numeric"
              style={{ width: 120, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <select
              aria-label="Tamanho do lote de geração"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              {[1, 2, 3, 4].map((count) => <option key={count} value={count}>Lote {count}</option>)}
            </select>
            <select
              aria-label="Tentativas máximas de geração IA"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              title="Limite de novas gerações quando a auditoria estrutural reprovar a saída"
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              {[1, 2, 3].map((count) => <option key={count} value={count}>{count} tentativa{count === 1 ? '' : 's'} IA</option>)}
            </select>
            <button disabled={generationBusy} onClick={handleCreate} style={{ padding: '8px 14px', background: generationBusy ? 'var(--muted)' : 'var(--brand-lime)', color: 'var(--brand-ink)', fontWeight: 700, border: 'none', borderRadius: 6, cursor: generationBusy ? 'wait' : 'pointer' }}>
              {generationBusy ? 'Gerando…' : 'Gerar Arte Editável'}
            </button>
            {generationBusy && (
              <button onClick={() => void handleCancelGeneration()} style={{ padding: '8px 12px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                Cancelar geração
              </button>
            )}
            <button
              disabled={generationBusy || !activeDoc || !selectedUpscaleModel || !engineStatus?.comfyUi.capabilities.upscale}
              onClick={() => void handleUpscale()}
              title={!selectedUpscaleModel ? 'Instale um modelo em ComfyUI/models/upscale_models' : 'Executar upscale no fundo do projeto ativo'}
              style={{ padding: '8px 12px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6, cursor: generationBusy ? 'wait' : 'pointer', opacity: !activeDoc || !selectedUpscaleModel || !engineStatus?.comfyUi.capabilities.upscale ? 0.55 : 1 }}
            >
              Upscale do fundo
            </button>
            {artType === 'thumbnail' && (
              <>
                <select
                  value={fidelityMode}
                  onChange={(e) =>
                    setFidelityMode(e.target.value as 'conceptual_art' | 'content_faithful' | 'authentic_gameplay')
                  }
                  style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
                  title="Modo de fidelidade da direção criativa"
                >
                  <option value="conceptual_art">Fidelidade: Arte Conceitual (Liberdade IA)</option>
                  <option value="content_faithful">Fidelidade: Fiel ao Conteúdo / Jogo</option>
                  <option value="authentic_gameplay">Fidelidade: Gameplay Autêntico (Frames Reais)</option>
                </select>
                {videoPath.trim() && (
                  <select
                    value={videoSourceType}
                    onChange={(e) =>
                      setVideoSourceType(e.target.value as 'authentic_gameplay' | 'synthetic_ai_clip' | 'unknown')
                    }
                    style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
                    title="Proveniência do arquivo de vídeo"
                  >
                    <option value="authentic_gameplay">Vídeo: Gameplay Autêntico</option>
                    <option value="synthetic_ai_clip">Vídeo: Clipe Sintético / IA</option>
                    <option value="unknown">Vídeo: Origem Desconhecida</option>
                  </select>
                )}
                <button onClick={handleThumbnailLab} style={{ padding: '8px 14px', background: 'var(--brand-lavender)', color: 'var(--brand-ink)', fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  Thumbnail Lab (3 Variações)
                </button>
              </>
            )}
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: aiAvailable ? 'var(--success)' : 'var(--muted-foreground)' }}>
              <input type="checkbox" checked={useAiGeneration} onChange={(e) => setUseAiGeneration(e.target.checked)} />
              IA Local (SDXL-Turbo / rembg {aiAvailable ? 'Pronta' : 'Indisponível'})
            </label>
          </div>
          {statusMsg && <div style={{ fontSize: 12, color: 'var(--success)' }}>{statusMsg}</div>}
          {generationWarning && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
              Atenção: {generationWarning}
            </div>
          )}
          {generationReport && (
            <div style={{ fontSize: 12, padding: 10, background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <strong>Relatório de geração</strong>
              <div style={{ marginTop: 4 }}>
                {generationReport.status} · {generationReport.engineId}
                {generationReport.durationMs !== undefined ? ` · ${generationReport.durationMs} ms` : ''}
              </div>
              <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>{generationReport.message}</div>
              {generationReport.recipe && (
                <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>
                  preset {generationReport.recipe.preset} · seed {generationReport.recipe.seed} · estilização {generationReport.recipe.stylization !== undefined ? Math.round(generationReport.recipe.stylization * 100) : '—'}% · origem {generationReport.recipe.source}
                  {generationReport.referenceStrength !== undefined ? ` · referência ${Math.round((1 - generationReport.referenceStrength) * 100)}% preservada` : ''}
                  {generationReport.attempts !== undefined ? ` · ${generationReport.attempts} tentativa${generationReport.attempts === 1 ? '' : 's'}` : ''}
                  {generationReport.lora ? ` · LoRA ${generationReport.lora.model} (${generationReport.lora.strengthModel})` : ''}
                  {generationReport.controlNet ? ` · ControlNet ${generationReport.controlNet.model} (${generationReport.controlNet.strength})` : ''}
                  {generationReport.ipAdapter ? ` · IP-Adapter ${generationReport.ipAdapter.model} (${generationReport.ipAdapter.weight})` : ''}
                  {generationReport.faceDetailer ? ` · FaceDetailer ${generationReport.faceDetailer.detectorModel}` : ''}
                </div>
              )}
              {generationReport.qualityAudit && (
                <div style={{ color: generationReport.qualityAudit.passed ? 'var(--success)' : 'var(--destructive)', marginTop: 4 }}>
                  Auditoria estrutural: {generationReport.qualityAudit.passed ? 'aprovada' : 'rejeitada'} · σ luminância {generationReport.qualityAudit.metrics.lumaStdDev.toFixed(2)}
                  {generationReport.qualityAudit.findings.length > 0 ? ` · ${generationReport.qualityAudit.findings.map((finding) => finding.message).join(' ')}` : ''}
                </div>
              )}
            </div>
          )}
          {batchPreviews.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {batchPreviews.map((preview, index) => <button key={preview.id} onClick={() => setPreviewUrl(preview.previewDataUrl)} title={`Abrir variação ${index + 1}`} style={{ padding: 2, border: '1px solid var(--border)', background: 'var(--secondary)', cursor: 'pointer' }}><img src={preview.previewDataUrl} alt={`Variação ${index + 1}`} style={{ width: '100%', display: 'block' }} /></button>)}
            </div>
          )}
        </div>

        <div style={{ padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Brand Kit do Canal</strong>
          <select
            value={selectedBrandKitId}
            onChange={(e) => setSelectedBrandKitId(e.target.value)}
            style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
          >
            <option value="">Padrão Aethera</option>
            {brandKits.map((k) => (
              <option key={k.id} value={k.id}>{k.channelName}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newKitName}
              onChange={(e) => setNewKitName(e.target.value)}
              placeholder="Novo Brand Kit..."
              style={{ flex: 1, padding: 6, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            />
            <button onClick={handleCreateBrandKit} style={{ padding: '6px 10px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Salvar
            </button>
          </div>
          <strong style={{ fontSize: 13, marginTop: 6 }}>Projetos Salvos ({projects.length})</strong>
          <div style={{ maxHeight: 110, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projects.slice(0, 8).map((p) => (
              <button
                key={p.id}
                onClick={async () => {
                  const loaded = await getBridge()?.creativeLoadProject?.(p.id);
                  if (loaded) {
                    setActiveDoc(loaded.document);
                    setPreviewUrl(loaded.previewDataUrl);
                    setAudit(loaded.audit);
                    setSelectedLayerId(loaded.document.layers[0]?.id ?? '');
                  }
                }}
                style={{ textAlign: 'left', padding: '4px 8px', background: activeDoc?.id === p.id ? 'var(--brand-lavender)' : 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
              >
                [{p.artType}] {p.title}
              </button>
            ))}
          </div>
          <strong style={{ fontSize: 13, marginTop: 6 }}>Histórico de Gerações ({generationHistory.length})</strong>
          <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {generationHistory.slice(0, 8).map((run) => (
              <button
                key={run.id}
                onClick={() => void handleRegenerate(run.id)}
                title={`Regenerar: ${run.prompt}`}
                style={{ textAlign: 'left', padding: '5px 8px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
              >
                ↻ {run.artType} · {run.report.recipe?.preset ?? 'sem preset'} · {run.status}
              </button>
            ))}
            {generationHistory.length === 0 && <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Nenhuma geração persistida.</span>}
          </div>
        </div>
      </div>

      {labVariants.length > 0 && (
        <div style={{ padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24 }}>
          <strong style={{ fontSize: 14 }}>Thumbnail Lab — Conceitos Narrativos Independentes (CS-8)</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 10 }}>
            {labVariants.map((v) => (
              <div key={v.document.id} style={{ background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <img src={v.previewDataUrl} alt={v.styleTitle} style={{ width: '100%', borderRadius: 4 }} />
                <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{v.styleTitle}</strong>
                  <span>Score: {v.audit.scorecard.overall}/100</span>
                </div>
                {v.concept && (
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                    <span>
                      Arquétipo: {v.concept.archetype}
                      {v.concept.fidelityMode ? ` • ${v.concept.fidelityMode}` : ''}
                      {v.postRenderCritique?.semanticScore !== undefined
                        ? ` • CLIP: ${v.postRenderCritique.semanticScore}%`
                        : ''}
                    </span>
                    <div>{v.concept.focalSubject}</div>
                  </div>
                )}
                {v.editorialRationale && (
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{v.editorialRationale}</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      setActiveDoc(v.document);
                      setPreviewUrl(v.previewDataUrl);
                      setAudit(v.audit);
                    }}
                    style={{ flex: 1, padding: '6px 8px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                  >
                    Editar no Canvas
                  </button>
                  {activeDoc && activeDoc.id !== v.document.id && (
                    <button
                      onClick={async () => {
                        const combined = await getBridge()?.creativeCombineConcepts?.({
                          baseProjectId: activeDoc.id,
                          donorProjectId: v.document.id,
                          takeFromDonor: ['typography', 'vfx'],
                        });
                        if (combined) {
                          setActiveDoc(combined.document);
                          setPreviewUrl(combined.previewDataUrl);
                          setAudit(combined.audit);
                          setStatusMsg(`Elementos de ${v.label} combinados no projeto ativo.`);
                        }
                      }}
                      style={{ padding: '6px 8px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                    >
                      + Combinar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeDoc && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
          <div style={{ padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>{activeDoc.title} ({activeDoc.width}×{activeDoc.height})</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                {activeDoc.artType === 'banner' && (
                  <select value={bannerPreviewMode} onChange={(e) => setBannerPreviewMode(e.target.value as 'desktop' | 'mobile' | 'tv')} style={{ background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
                    <option value="desktop">Prévia Desktop</option>
                    <option value="mobile">Prévia Mobile (Área Segura)</option>
                    <option value="tv">Prévia TV (Full)</option>
                  </select>
                )}
                <button disabled={!canUndo} onClick={() => void handleEditAction({ kind: 'undo' })} style={{ padding: '4px 8px', fontSize: 12 }}>Desfazer</button>
                <button disabled={!canRedo} onClick={() => void handleEditAction({ kind: 'redo' })} style={{ padding: '4px 8px', fontSize: 12 }}>Refazer</button>
              </div>
            </div>
            <div style={{ position: 'relative', background: 'repeating-conic-gradient(#e4e4e8 0% 25%, #f4f4f6 0% 50%) 50% / 20px 20px', borderRadius: 6, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt={activeDoc.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 420,
                    borderRadius: activeDoc.artType === 'avatar' ? '50%' : 0,
                    outline: activeDoc.artType === 'banner' && bannerPreviewMode === 'mobile' ? '2px dashed #facc15' : 'none',
                  }}
                />
              )}
            </div>
            {previewUrl && activeDoc.artType === 'thumbnail' && (
              <div style={{ marginTop: 8, padding: 8, background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={previewUrl}
                  alt="Prévia Feed Mobile"
                  style={{ width: 224, height: 126, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }}
                />
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  <strong>Prévia em Tamanho de Celular (224×126)</strong>
                  <p style={{ margin: '4px 0 0', opacity: 0.85 }}>
                    Validação rápida de legibilidade do título, contraste do sujeito e ausência de cortes em feeds mobile.
                  </p>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                value={promptEditInput}
                onChange={(e) => setPromptEditInput(e.target.value)}
                placeholder='Edição localizada por prompt (ex.: Mude o título para "CYBERPUNK" na cor #00F0FF)'
                style={{ flex: 1, padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
              />
              <button
                onClick={() => {
                  void handleEditAction({ kind: 'promptEdit', instruction: promptEditInput });
                  setPromptEditInput('');
                }}
                style={{ padding: '8px 12px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Aplicar Edição
              </button>
            </div>
          </div>

          <div style={{ padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ fontSize: 13 }}>Camadas ({activeDoc.layers.length})</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...activeDoc.layers].sort((a, b) => b.zIndex - a.zIndex).map((layer) => (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: selectedLayerId === layer.id ? 'var(--brand-lavender)' : 'var(--secondary)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <span>{layer.visible ? '👁' : '🚫'} {layer.name}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={(e) => { e.stopPropagation(); void handleEditAction({ kind: 'updateLayer', layerId: layer.id, patch: { visible: !layer.visible } }); }}>Ocultar</button>
                    <button onClick={(e) => { e.stopPropagation(); void handleEditAction({ kind: 'reorder', layerId: layer.id, direction: 'up' }); }}>↑</button>
                    <button onClick={(e) => { e.stopPropagation(); void handleEditAction({ kind: 'reorder', layerId: layer.id, direction: 'down' }); }}>↓</button>
                  </div>
                </div>
              ))}
            </div>

            {selectedLayer && selectedLayer.type === 'text' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong style={{ fontSize: 12 }}>Texto Editável</strong>
                <input
                  value={selectedLayer.text}
                  onChange={(e) => void handleEditAction({ kind: 'updateLayer', layerId: selectedLayer.id, patch: { text: e.target.value } })}
                  style={{ padding: 6, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 4 }}
                />
                <button
                  onClick={() => void handleEditAction({ kind: 'align', layerId: selectedLayer.id, align: 'safe-center' })}
                  style={{ padding: 6, background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
                >
                  Centralizar na Área Segura
                </button>
              </div>
            )}

            {audit && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>
                <strong>Quality Gate: {audit.passed ? 'APROVÁVEL' : 'BLOQUEADO'} ({audit.scorecard.overall}/100)</strong>
                <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>{audit.scorecard.disclaimer}</div>
                {audit.findings.map((f, i) => (
                  <div key={i} style={{ color: f.severity === 'critical' ? 'var(--destructive)' : 'var(--warning)', marginTop: 2 }}>
                    [{f.severity}] {f.message}
                  </div>
                ))}
                <ApprovalStatesView doc={activeDoc} />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {(['approved', 'rejected'] as const).map((decision) => (
                    <button
                      key={decision}
                      onClick={async () => {
                        const result = await getBridge()?.creativeAestheticDecision?.({
                          projectId: activeDoc.id,
                          decision,
                          reviewer: 'Criador',
                        });
                        if (result) {
                          setActiveDoc(result.document);
                          setStatusMsg(
                            result.readiness.ready
                              ? 'Peça pronta: técnica, fidelidade semântica e estética aprovadas.'
                              : `Decisão estética registrada. Pendências: ${result.readiness.blockers.join(' ')}`,
                          );
                        }
                      }}
                      style={{ flex: 1, padding: '8px 10px', background: decision === 'approved' ? 'var(--brand-lime)' : 'var(--destructive)', color: decision === 'approved' ? 'var(--brand-ink)' : 'var(--destructive-foreground)', fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >
                      {decision === 'approved' ? 'Aprovar estética (humano)' : 'Rejeitar estética'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ProductionConsoleAccordion scope="all" kind="thumbnail" title="Console de Thumbnails" />
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = {
  not_evaluated: 'não avaliada',
  passed: 'aprovada',
  failed: 'reprovada',
  confirmed: 'confirmada',
  rejected: 'rejeitada',
  unverified: 'não verificada',
  pending: 'pendente',
  approved: 'aprovada',
};

/** CS-9: the three approval states are shown separately; none implies another. */
function ApprovalStatesView({ doc }: { doc: CreativeProjectDocument }) {
  const states = doc.approvalStates;
  const rows: Array<[string, string, string | undefined]> = [
    ['Técnica (automática)', states?.technical.status ?? 'not_evaluated', states?.technical.criticalCodes.join(', ') || undefined],
    [
      'Fidelidade semântica',
      states?.semanticFidelity.status ?? 'not_evaluated',
      states?.semanticFidelity.identity
        ? `identidade "${states.semanticFidelity.identity.subject}": ${states.semanticFidelity.identity.status}`
        : undefined,
    ],
    ['Estética (humana)', states?.humanAesthetic.status ?? 'pending', states?.humanAesthetic.reviewer],
  ];
  return (
    <dl aria-label="Estados de aprovação" style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px' }}>
      {rows.map(([label, status, detail]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--muted-foreground)' }}>{label}</dt>
          <dd style={{ margin: 0 }}>
            {APPROVAL_LABELS[status] ?? status}
            {detail ? ` — ${detail}` : ''}
          </dd>
        </div>
      ))}
    </dl>
  );
}
