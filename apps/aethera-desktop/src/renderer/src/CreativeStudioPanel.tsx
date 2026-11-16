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
      recipe?: { preset: string; seed: number; source: 'deterministic' | 'reasoning_engine' };
    };
  }>;
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
      models: { checkpoints: string[]; loras: string[]; controlnet: string[] };
    };
    localAvailable: boolean;
    activeProvider: string;
  }>;
  creativeCancelGeneration?: () => Promise<boolean>;
}

function getBridge(): CreativeBridge | undefined {
  return (window as unknown as { aetheraBridge?: CreativeBridge }).aetheraBridge;
}

export function CreativeStudioPanel() {
  const [artType, setArtType] = useState<CreativeArtType>('thumbnail');
  const [prompt, setPrompt] = useState('');
  const [headline, setHeadline] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [engines, setEngines] = useState<string[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [selectedBrandKitId, setSelectedBrandKitId] = useState<string>('');
  const [newKitName, setNewKitName] = useState('');
  const [projects, setProjects] = useState<CreativeProjectDocument[]>([]);
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
    recipe?: { preset: string; seed: number; source: 'deterministic' | 'reasoning_engine' };
  } | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [engineStatus, setEngineStatus] = useState<Awaited<ReturnType<NonNullable<CreativeBridge['creativeImageEngineStatus']>>> | null>(null);

  const refreshLists = async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const [eng, kits, projs, ai, imageEngine] = await Promise.all([
      bridge.creativeEngines?.() ?? Promise.resolve([]),
      bridge.creativeListBrandKits?.() ?? Promise.resolve([]),
      bridge.creativeListProjects?.() ?? Promise.resolve([]),
      bridge.creativeAiStatus?.() ?? Promise.resolve({ available: false, provider: 'none' }),
      bridge.creativeImageEngineStatus?.() ?? Promise.resolve(null),
    ]);
    setEngines(eng);
    setBrandKits(kits);
    setProjects(projs);
    setAiAvailable(ai.available);
    if (imageEngine) setEngineStatus(imageEngine);
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
    setGenerationBusy(true);
    try {
      const res = await bridge.creativeCreateFromPrompt({
        artType,
        prompt: prompt.trim(),
        ...(headline.trim() ? { headline: headline.trim() } : {}),
        ...(selectedBrandKitId ? { brandKitId: selectedBrandKitId } : {}),
        ...(artType === 'avatar' ? { avatarBackdrop } : {}),
        useAiGeneration,
        professionalPreset,
      });
      setActiveDoc(res.document);
      setPreviewUrl(res.previewDataUrl);
      setAudit(res.audit);
      setSelectedLayerId(res.document.layers[res.document.layers.length - 1]?.id ?? '');
      const gen = res.generation;
      setGenerationReport(gen ?? null);
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
            checkpoints: {engineStatus.comfyUi.models.checkpoints.length} · LoRAs: {engineStatus.comfyUi.models.loras.length}
          </span>
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
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              aria-label="Preset profissional"
              value={professionalPreset}
              onChange={(e) => setProfessionalPreset(e.target.value as ProfessionalPresetId)}
              style={{ padding: 8, background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6 }}
            >
              <option value="youtube_thumbnail_1280x720">YouTube Thumbnail 1280×720</option>
              <option value="anime_premium_cinematic">Anime Premium / Cinematic</option>
              <option value="gaming_cinematic">Gaming Cinematic</option>
              <option value="cyberpunk_neon">Cyberpunk Neon</option>
              <option value="banner_2560x1440">Banner 2560×1440</option>
            </select>
            <button disabled={generationBusy} onClick={handleCreate} style={{ padding: '8px 14px', background: generationBusy ? 'var(--muted)' : 'var(--brand-lime)', color: 'var(--brand-ink)', fontWeight: 700, border: 'none', borderRadius: 6, cursor: generationBusy ? 'wait' : 'pointer' }}>
              {generationBusy ? 'Gerando…' : 'Gerar Arte Editável'}
            </button>
            {generationBusy && (
              <button onClick={() => void handleCancelGeneration()} style={{ padding: '8px 12px', background: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>
                Cancelar geração
              </button>
            )}
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
                  preset {generationReport.recipe.preset} · seed {generationReport.recipe.seed} · origem {generationReport.recipe.source}
                </div>
              )}
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
