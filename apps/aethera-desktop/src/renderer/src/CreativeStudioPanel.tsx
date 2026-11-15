import { useEffect, useState } from 'react';
import type {
  BrandKit,
  CreativeArtType,
  CreativeLayer,
  CreativeProjectDocument,
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
  }>;
  creativeThumbnailLab?: (input: Record<string, unknown>) => Promise<{
    availableEngines: string[];
    variants: Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale?: string;
      concept?: { archetype: string; focalSubject: string; visualNarrative: string };
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
  creativeAiStatus?: () => Promise<{ available: boolean; provider: string }>;
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
  const [aiAvailable, setAiAvailable] = useState<boolean>(false);
  const [labVariants, setLabVariants] = useState<
    Array<{
      label: 'A' | 'B' | 'C';
      styleTitle: string;
      editorialRationale?: string;
      concept?: { archetype: string; focalSubject: string; visualNarrative: string };
      document: CreativeProjectDocument;
      audit: QualityAuditReport;
      previewDataUrl: string;
    }>
  >([]);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const refreshLists = async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const [eng, kits, projs, ai] = await Promise.all([
      bridge.creativeEngines?.() ?? Promise.resolve([]),
      bridge.creativeListBrandKits?.() ?? Promise.resolve([]),
      bridge.creativeListProjects?.() ?? Promise.resolve([]),
      bridge.creativeAiStatus?.() ?? Promise.resolve({ available: false, provider: 'none' }),
    ]);
    setEngines(eng);
    setBrandKits(kits);
    setProjects(projs);
    setAiAvailable(ai.available);
  };

  useEffect(() => {
    void refreshLists();
  }, []);

  const handleCreate = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeCreateFromPrompt || !prompt.trim()) return;
    setStatusMsg('Gerando composição editável...');
    try {
      const res = await bridge.creativeCreateFromPrompt({
        artType,
        prompt: prompt.trim(),
        ...(headline.trim() ? { headline: headline.trim() } : {}),
        ...(selectedBrandKitId ? { brandKitId: selectedBrandKitId } : {}),
        ...(artType === 'avatar' ? { avatarBackdrop } : {}),
        useAiGeneration,
      });
      setActiveDoc(res.document);
      setPreviewUrl(res.previewDataUrl);
      setAudit(res.audit);
      setSelectedLayerId(res.document.layers[res.document.layers.length - 1]?.id ?? '');
      setStatusMsg(`Projeto criado (${res.document.width}×${res.document.height}) e salvo automaticamente.`);
      await refreshLists();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleThumbnailLab = async () => {
    const bridge = getBridge();
    if (!bridge?.creativeThumbnailLab || !prompt.trim()) return;
    setStatusMsg('Gerando 3 variações no Thumbnail Lab...');
    try {
      const res = await bridge.creativeThumbnailLab({
        prompt: prompt.trim(),
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
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#99f6e4' }}>
            Motores ativos: {engines.length > 0 ? engines.join(' • ') : 'Planejador Determinístico Local'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['thumbnail', 'banner', 'avatar', 'watermark'] as CreativeArtType[]).map((t) => (
            <button
              key={t}
              onClick={() => setArtType(t)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #134e4a',
                background: artType === t ? '#0f766e' : '#091917',
                color: '#ecfdf5',
                cursor: 'pointer',
              }}
            >
              {t === 'thumbnail' ? 'Thumbnail (1280×720)' : t === 'banner' ? 'Banner (2560×1440)' : t === 'avatar' ? 'Avatar (800×800)' : 'Marca d\'Água (150×150)'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: '#091917', border: '1px solid #134e4a', borderRadius: 8 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Descreva a arte desejada (ex.: Thumbnail Cyberpunk 2077 upgrades cibernéticos com alto contraste)..."
            rows={2}
            style={{ width: '100%', padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Título / Monograma curto"
              style={{ flex: 1, minWidth: 160, padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
            />
            {artType === 'thumbnail' && (
              <input
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                placeholder="Caminho opcional do vídeo (.mp4) para extrair frames"
                style={{ flex: 1.4, minWidth: 200, padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
              />
            )}
            {artType === 'avatar' && (
              <select
                value={avatarBackdrop}
                onChange={(e) => setAvatarBackdrop(e.target.value as 'dark' | 'light' | 'transparent')}
                style={{ padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
              >
                <option value="dark">Versão Escura</option>
                <option value="light">Versão Clara</option>
                <option value="transparent">Transparente</option>
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleCreate} style={{ padding: '8px 14px', background: '#14b8a6', color: '#042f2e', fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Gerar Arte Editável
            </button>
            {artType === 'thumbnail' && (
              <button onClick={handleThumbnailLab} style={{ padding: '8px 14px', background: '#f59e0b', color: '#1f2937', fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Thumbnail Lab (3 Variações)
              </button>
            )}
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: aiAvailable ? '#5eead4' : '#94a3b8' }}>
              <input type="checkbox" checked={useAiGeneration} onChange={(e) => setUseAiGeneration(e.target.checked)} />
              IA Local (SDXL-Turbo / rembg {aiAvailable ? 'Pronta' : 'Indisponível'})
            </label>
          </div>
          {statusMsg && <div style={{ fontSize: 12, color: '#5eead4' }}>{statusMsg}</div>}
        </div>

        <div style={{ padding: 14, background: '#091917', border: '1px solid #134e4a', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Brand Kit do Canal</strong>
          <select
            value={selectedBrandKitId}
            onChange={(e) => setSelectedBrandKitId(e.target.value)}
            style={{ padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
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
              style={{ flex: 1, padding: 6, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
            />
            <button onClick={handleCreateBrandKit} style={{ padding: '6px 10px', background: '#0f766e', color: '#ecfdf5', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
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
                style={{ textAlign: 'left', padding: '4px 8px', background: activeDoc?.id === p.id ? '#115e59' : '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
              >
                [{p.artType}] {p.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {labVariants.length > 0 && (
        <div style={{ padding: 14, background: '#091917', border: '1px solid #134e4a', borderRadius: 8 }}>
          <strong style={{ fontSize: 14 }}>Thumbnail Lab — Conceitos Narrativos Independentes (CS-8)</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 10 }}>
            {labVariants.map((v) => (
              <div key={v.document.id} style={{ background: '#071110', border: '1px solid #134e4a', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <img src={v.previewDataUrl} alt={v.styleTitle} style={{ width: '100%', borderRadius: 4 }} />
                <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{v.styleTitle}</strong>
                  <span>Score: {v.audit.scorecard.overall}/100</span>
                </div>
                {v.concept && (
                  <div style={{ fontSize: 11, color: '#99f6e4' }}>
                    <span>Arquétipo: {v.concept.archetype}</span>
                    <div>{v.concept.focalSubject}</div>
                  </div>
                )}
                {v.editorialRationale && (
                  <div style={{ fontSize: 11, color: '#cbd5e1' }}>{v.editorialRationale}</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      setActiveDoc(v.document);
                      setPreviewUrl(v.previewDataUrl);
                      setAudit(v.audit);
                    }}
                    style={{ flex: 1, padding: '6px 8px', background: '#0f766e', color: '#ecfdf5', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
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
                      style={{ padding: '6px 8px', background: '#1e293b', color: '#99f6e4', border: '1px solid #134e4a', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
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
          <div style={{ padding: 14, background: '#091917', border: '1px solid #134e4a', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>{activeDoc.title} ({activeDoc.width}×{activeDoc.height})</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                {activeDoc.artType === 'banner' && (
                  <select value={bannerPreviewMode} onChange={(e) => setBannerPreviewMode(e.target.value as 'desktop' | 'mobile' | 'tv')} style={{ background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 4, fontSize: 12 }}>
                    <option value="desktop">Prévia Desktop</option>
                    <option value="mobile">Prévia Mobile (Área Segura)</option>
                    <option value="tv">Prévia TV (Full)</option>
                  </select>
                )}
                <button disabled={!canUndo} onClick={() => void handleEditAction({ kind: 'undo' })} style={{ padding: '4px 8px', fontSize: 12 }}>Desfazer</button>
                <button disabled={!canRedo} onClick={() => void handleEditAction({ kind: 'redo' })} style={{ padding: '4px 8px', fontSize: 12 }}>Refazer</button>
              </div>
            </div>
            <div style={{ position: 'relative', background: 'repeating-conic-gradient(#1f2937 0% 25%, #111827 0% 50%) 50% / 20px 20px', borderRadius: 6, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
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
              <div style={{ marginTop: 8, padding: 8, background: '#071110', border: '1px solid #134e4a', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={previewUrl}
                  alt="Prévia Feed Mobile"
                  style={{ width: 224, height: 126, objectFit: 'cover', borderRadius: 4, border: '1px solid #134e4a' }}
                />
                <div style={{ fontSize: 12, color: '#99f6e4' }}>
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
                style={{ flex: 1, padding: 8, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 6 }}
              />
              <button
                onClick={() => {
                  void handleEditAction({ kind: 'promptEdit', instruction: promptEditInput });
                  setPromptEditInput('');
                }}
                style={{ padding: '8px 12px', background: '#0f766e', color: '#ecfdf5', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Aplicar Edição
              </button>
            </div>
          </div>

          <div style={{ padding: 14, background: '#091917', border: '1px solid #134e4a', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ fontSize: 13 }}>Camadas ({activeDoc.layers.length})</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...activeDoc.layers].sort((a, b) => b.zIndex - a.zIndex).map((layer) => (
                <div
                  key={layer.id}
                  onClick={() => setSelectedLayerId(layer.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: selectedLayerId === layer.id ? '#115e59' : '#071110',
                    border: '1px solid #134e4a',
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
              <div style={{ borderTop: '1px solid #134e4a', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong style={{ fontSize: 12 }}>Texto Editável</strong>
                <input
                  value={selectedLayer.text}
                  onChange={(e) => void handleEditAction({ kind: 'updateLayer', layerId: selectedLayer.id, patch: { text: e.target.value } })}
                  style={{ padding: 6, background: '#071110', color: '#ecfdf5', border: '1px solid #134e4a', borderRadius: 4 }}
                />
                <button
                  onClick={() => void handleEditAction({ kind: 'align', layerId: selectedLayer.id, align: 'safe-center' })}
                  style={{ padding: 6, background: '#0f766e', color: '#ecfdf5', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
                >
                  Centralizar na Área Segura
                </button>
              </div>
            )}

            {audit && (
              <div style={{ borderTop: '1px solid #134e4a', paddingTop: 8, fontSize: 12 }}>
                <strong>Quality Gate: {audit.passed ? 'APROVÁVEL' : 'BLOQUEADO'} ({audit.scorecard.overall}/100)</strong>
                <div style={{ color: '#99f6e4', marginTop: 4 }}>{audit.scorecard.disclaimer}</div>
                {audit.findings.map((f, i) => (
                  <div key={i} style={{ color: f.severity === 'critical' ? '#fca5a5' : '#fde68a', marginTop: 2 }}>
                    [{f.severity}] {f.message}
                  </div>
                ))}
                <button
                  disabled={!audit.passed}
                  onClick={async () => {
                    const approved = await getBridge()?.creativeApprove?.({ projectId: activeDoc.id, approvedBy: 'Criador' });
                    if (approved) {
                      setActiveDoc(approved);
                      setStatusMsg('Composição aprovada manualmente.');
                    }
                  }}
                  style={{ marginTop: 8, width: '100%', padding: '8px 10px', background: audit.passed ? '#14b8a6' : '#334155', color: '#042f2e', fontWeight: 700, border: 'none', borderRadius: 6, cursor: audit.passed ? 'pointer' : 'not-allowed' }}
                >
                  Aprovar Composição
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
