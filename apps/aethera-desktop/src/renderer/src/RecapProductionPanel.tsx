import { useCallback, useEffect, useState, type CSSProperties } from 'react';

export interface RecapProviderReadinessView {
  providerId: string;
  label: string;
  status: 'available' | 'circuit_open' | 'unavailable';
  code?: string;
  reason?: string;
  resetAtText?: string;
}

export interface RecapReadinessView {
  ready: boolean;
  operationalProviders: string[];
  providers: RecapProviderReadinessView[];
  checkpoint: {
    exists: boolean;
    chapterId: string | null;
    completedPanels: number;
    totalPanels: number;
    pendingPanels: number;
    canResume: boolean;
    lastUpdatedAtIso: string | null;
  };
  autoResumeRecommended: boolean;
  summaryMessage: string;
  checkedAtIso: string;
}

interface RecapRevisionPlanView {
  prompt: string;
  understood: boolean;
  affectedSceneIds: string[];
  reprocessStages: string[];
  reusedStages: string[];
  estimatedVideoReworkRatio: number;
  summary: string;
  actions: Array<{ kind: string; description: string }>;
}

interface EditableSceneRow {
  sceneId: string;
  panelId: string;
  narrationText: string;
  motionStyle: string;
  estimatedDurationSec: number;
}

interface SelectedArchiveFile {
  path: string;
  name: string;
  sizeBytes: number;
}

interface RecapBridge {
  recapGetReadiness?: (input?: { chapterId?: string }) => Promise<RecapReadinessView>;
  recapPlanRevision?: (input: { prompt: string; script: unknown; availablePanelIds?: string[] }) => Promise<RecapRevisionPlanView>;
  recapSelectArchives?: () => Promise<{ canceled: boolean; files: SelectedArchiveFile[] }>;
  recapImportAnalyze?: (input: { url: string }) => Promise<{
    sourceUrl: string;
    adapterName: string;
    meta: { workTitle: string; chapterNumber: string };
    pages: Array<{ pageNumber: number; imageUrl: string }>;
    availableChapters: Array<{ chapterNumber: string; title: string; url: string }>;
    alreadyImported: { cbzPath: string } | null;
  }>;
  recapImportCreateJob?: (input: { urls: string[]; forceReimport?: boolean }) => Promise<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  }>;
  recapImportGetJob?: (id: string) => Promise<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  } | null>;
  recapImportCancelJob?: (id: string) => Promise<unknown>;
  recapImportRetryJob?: (id: string) => Promise<unknown>;
  recapStartProduction?: (input: {
    archivePath: string;
    workTitle: string;
    language: string;
    scriptStyle: string;
    aspectRatio: '16:9' | '9:16';
    ttsProvider: string;
    enableOcr: boolean;
    resumeCheckpoint: boolean;
  }) => Promise<{ ok: boolean; message: string; previewMp4Path?: string }>;
}

function getRecapBridge(): RecapBridge | undefined {
  return (window as unknown as { aetheraBridge?: RecapBridge }).aetheraBridge;
}

const CARD_STYLE: CSSProperties = {
  background: 'var(--card, #ffffff)',
  border: '1px solid rgba(17, 17, 17, 0.06)',
  borderRadius: 24,
  padding: 20,
  boxShadow: 'var(--elevation-1, 0 1px 2px rgba(17, 17, 17, 0.03), 0 8px 24px -14px rgba(17, 17, 17, 0.08))',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 14,
  border: '1px solid var(--border, #e2e2e7)',
  background: 'var(--secondary, #f4f4f6)',
  color: '#111111',
  fontSize: 13,
  boxSizing: 'border-box',
};

const PIPELINE_STAGES = [
  'Importação CBZ/PDF',
  'Gate F (Integridade)',
  'Visão Multimodal',
  'Continuidade & Pesquisa',
  'Roteiro & Gate G',
  'Humanize (PT-BR)',
  'Fase 3 (Motion/Áudio/MP4)',
  'Gate H (Qualidade)',
];

const DEFAULT_READINESS: RecapReadinessView = {
  ready: false,
  operationalProviders: [],
  providers: [
    { providerId: 'claude', label: 'Claude CLI', status: 'unavailable', code: 'PROVIDER_UNAVAILABLE', reason: 'Aguardando verificação de prontidão no host.' },
    { providerId: 'claude-gateway', label: 'Claude Gateway', status: 'unavailable', code: 'PROVIDER_UNAVAILABLE', reason: 'Configure o token/URL nas configurações.' },
    { providerId: 'codex', label: 'Codex CLI', status: 'unavailable', code: 'PROVIDER_UNAVAILABLE', reason: 'Aguardando verificação de prontidão no host.' },
    { providerId: 'antigravity', label: 'Antigravity CLI (agy)', status: 'unavailable', code: 'PROVIDER_UNAVAILABLE', reason: 'Aguardando verificação de prontidão no host.' },
  ],
  checkpoint: {
    exists: false,
    chapterId: null,
    completedPanels: 0,
    totalPanels: 0,
    pendingPanels: 0,
    canResume: false,
    lastUpdatedAtIso: null,
  },
  autoResumeRecommended: false,
  summaryMessage: 'Clique em "Verificar Prontidão" para consultar os circuit breakers e checkpoints duráveis.',
  checkedAtIso: new Date().toISOString(),
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function RecapProductionPanel() {
  // Fase 4.1 — Criação de projeto
  const [origin, setOrigin] = useState<'cbz' | 'link'>('cbz');
  const [selectedFiles, setSelectedFiles] = useState<SelectedArchiveFile[]>([]);
  const [linkInputs, setLinkInputs] = useState<string[]>(['']);
  const [analyzedLinks, setAnalyzedLinks] = useState<Array<{
    url: string;
    adapterName: string;
    meta: { workTitle: string; chapterNumber: string };
    pagesCount: number;
    alreadyImported: { cbzPath: string } | null;
  }>>([]);
  const [importJob, setImportJob] = useState<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [productionMode, setProductionMode] = useState<'single' | 'individual'>('single');
  const [startState, setStartState] = useState<'idle' | 'validating' | 'analyzing' | 'downloading' | 'generating-cbz' | 'preparing' | 'producing'>('idle');
  const [workTitle, setWorkTitle] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [scriptStyle, setScriptStyle] = useState('cinematic_recap');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [ttsProvider, setTtsProvider] = useState('voicestudio_tts');
  const [enableOcr, setEnableOcr] = useState(false);

  // Fase 4.2 — Painel de produção (circuit breakers + checkpoints)
  const [readiness, setReadiness] = useState<RecapReadinessView>(DEFAULT_READINESS);
  const [loading, setLoading] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Fase 4.3 — Editor de Cenas
  const [scenes, setScenes] = useState<EditableSceneRow[]>([]);

  // Fase 4.4 — Revisão por Prompt com Plano de Impacto
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [impactPlan, setImpactPlan] = useState<RecapRevisionPlanView | null>(null);

  const handlePlanRevision = async (promptText?: string) => {
    const text = (promptText ?? revisionPrompt).trim();
    if (!text) return;
    setRevisionPrompt(text);
    const bridge = getRecapBridge();
    const scriptPayload = {
      chapterId: workTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: workTitle,
      style: scriptStyle,
      totalEstimatedDurationSec: scenes.reduce((s, r) => s + r.estimatedDurationSec, 0),
      generatedAtIso: new Date().toISOString(),
      generatedBy: 'ui-editor',
      scenes: scenes.map((s) => ({
        sceneId: s.sceneId,
        narrationText: s.narrationText,
        characters: [],
        eventDescription: s.narrationText,
        panelIds: [s.panelId],
        croppedImagePaths: [],
        estimatedDurationSec: s.estimatedDurationSec,
        emotion: 'tension',
        narrativeIntent: 'rising_action',
        confidence: 1,
        reviewStatus: 'needs_review',
      })),
    };
    if (bridge?.recapPlanRevision) {
      const planRes = await bridge.recapPlanRevision({
        prompt: text,
        script: scriptPayload,
        availablePanelIds: ['panel-001', 'panel-002', 'panel-003', 'panel-004'],
      });
      setImpactPlan(planRes);
    } else {
      setStatusNote('IPC recapPlanRevision indisponível fora do Electron.');
    }
  };

  const refreshReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const bridge = getRecapBridge();
      if (bridge?.recapGetReadiness) {
        const res = await bridge.recapGetReadiness();
        setReadiness(res);
      } else {
        setStatusNote('Bridge IPC recapGetReadiness ainda não conectado neste build; exibindo estado local.');
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshReadiness();
  }, [refreshReadiness]);


  const handleSelectFiles = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapSelectArchives) {
      setImportError('Seletor de arquivos disponível apenas no Aethera Desktop.');
      return;
    }
    const result = await bridge.recapSelectArchives();
    if (!result.canceled && result.files.length > 0) {
      setSelectedFiles(result.files);
      setImportError(null);
      if (!workTitle && result.files.length === 1) {
        setWorkTitle(result.files[0].name.replace(/\.(cbz|pdf)$/i, ''));
      }
    }
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const next = [...selectedFiles];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedFiles(next);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  const addLinkInput = () => setLinkInputs([...linkInputs, '']);
  const updateLinkInput = (index: number, value: string) => {
    const next = [...linkInputs];
    next[index] = value;
    setLinkInputs(next);
  };
  const removeLinkInput = (index: number) => {
    setLinkInputs(linkInputs.filter((_, i) => i !== index));
  };
  const moveLink = (index: number, direction: -1 | 1) => {
    const next = [...linkInputs];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLinkInputs(next);
  };

  const handleAnalyzeAllLinks = async () => {
    setImportError(null);
    const bridge = getRecapBridge();
    if (!bridge?.recapImportAnalyze) {
      setImportError('Bridge IPC de importação por link disponível apenas no Aethera Desktop.');
      return;
    }
    const validUrls = linkInputs.map((u) => u.trim()).filter(Boolean);
    if (validUrls.length === 0) {
      setImportError('Adicione pelo menos um link válido.');
      return;
    }
    setStartState('analyzing');
    const results: typeof analyzedLinks = [];
    for (const url of validUrls) {
      try {
        const res = await bridge.recapImportAnalyze({ url });
        results.push({
          url: res.sourceUrl,
          adapterName: res.adapterName,
          meta: res.meta,
          pagesCount: res.pages.length,
          alreadyImported: res.alreadyImported,
        });
        if (!workTitle && res.meta.workTitle) setWorkTitle(res.meta.workTitle);
      } catch (err) {
        setImportError(`Falha ao analisar ${url}: ${err instanceof Error ? err.message : String(err)}`);
        setStartState('idle');
        return;
      }
    }
    setAnalyzedLinks(results);
    setStartState('idle');
  };

  const handleStart = async (resumeCheckpoint: boolean) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapStartProduction) {
      setStatusNote('Orquestração direta via UI aguardando conexão IPC recap:start-production.');
      return;
    }
    setImportError(null);

    if (origin === 'cbz') {
      if (selectedFiles.length === 0) {
        setImportError('Selecione pelo menos um arquivo CBZ ou PDF.');
        return;
      }
      setStartState('validating');
      const archivePath = selectedFiles[0].path;
      setStartState('preparing');
      try {
        const res = await bridge.recapStartProduction({
          archivePath,
          workTitle: workTitle || selectedFiles[0].name.replace(/\.(cbz|pdf)$/i, ''),
          language,
          scriptStyle,
          aspectRatio,
          ttsProvider,
          enableOcr,
          resumeCheckpoint,
          productionMode,
          allArchives: selectedFiles.map((f) => f.path),
        });
        setStartState('producing');
        setStatusNote(res.message);
      } catch (err) {
        setStartState('idle');
        setStatusNote(err instanceof Error ? err.message : String(err));
      }
    } else {
      const validUrls = linkInputs.map((u) => u.trim()).filter(Boolean);
      if (validUrls.length === 0) {
        setImportError('Adicione pelo menos um link válido.');
        return;
      }
      if (!bridge.recapImportCreateJob || !bridge.recapImportGetJob) {
        setImportError('Bridge IPC de importação indisponível.');
        return;
      }
      setStartState('downloading');
      try {
        const job = await bridge.recapImportCreateJob({ urls: validUrls });
        setImportJob(job);
        const pollRef = { current: null as ReturnType<typeof setInterval> | null };
        pollRef.current = setInterval(async () => {
          const snap = await bridge.recapImportGetJob?.(job.id);
          if (snap) {
            setImportJob(snap);
            if (snap.status === 'completed') {
              if (pollRef.current) clearInterval(pollRef.current);
              setStartState('generating-cbz');
              const cbzPaths = snap.items
                .map((i) => i.libraryEntry?.cbzPath)
                .filter((p): p is string => Boolean(p));
              if (cbzPaths.length === 0) {
                setImportError('Importação concluída mas nenhum CBZ foi gerado.');
                setStartState('idle');
                return;
              }
              setStartState('preparing');
              try {
                const res = await bridge.recapStartProduction({
                  archivePath: cbzPaths[0],
                  workTitle: workTitle || 'Recap',
                  language,
                  scriptStyle,
                  aspectRatio,
                  ttsProvider,
                  enableOcr,
                  resumeCheckpoint: false,
                  productionMode,
                  allArchives: cbzPaths,
                });
                setStartState('producing');
                setStatusNote(res.message);
              } catch (startErr) {
                setStartState('idle');
                setStatusNote(startErr instanceof Error ? startErr.message : String(startErr));
              }
            } else if (snap.status === 'failed' || snap.status === 'cancelled') {
              if (pollRef.current) clearInterval(pollRef.current);
              setStartState('idle');
              const failedItem = snap.items.find((i) => i.error);
              setImportError(failedItem?.error ?? `Importação ${snap.status}.`);
            }
          }
        }, 600);
      } catch (err) {
        setStartState('idle');
        setImportError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const startLabel = (): string => {
    switch (startState) {
      case 'validating': return 'Validando arquivos…';
      case 'analyzing': return 'Analisando links…';
      case 'downloading': return 'Baixando capítulos…';
      case 'generating-cbz': return 'Gerando CBZ…';
      case 'preparing': return 'Preparando Recap…';
      case 'producing': return 'Produzindo…';
      default: return 'Iniciar Produção Recap';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Fase 4.1 — Criação do Projeto */}
      <section style={CARD_STYLE}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#6a46d8' }}>
              AETHERA RECAP • FASE 4.1
            </span>
            <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, color: '#111111' }}>
              Novo Projeto de Mangá / Manhwa Recap
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void refreshReadiness()}
            disabled={loading}
            style={{
              padding: '8px 14px',
              borderRadius: 9999,
              border: '1px solid #d4d4dc',
              background: '#ffffff',
              color: '#111111',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {loading ? 'Verificando…' : 'Verificar Prontidão'}
          </button>
        </div>

        {/* Origem dos capítulos */}
        <label style={{ fontSize: 12, color: '#555562', marginBottom: 10, display: 'block' }}>
          Origem dos capítulos
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as 'cbz' | 'link')}
            style={{ ...INPUT_STYLE, marginTop: 4 }}
          >
            <option value="cbz">CBZ / PDF</option>
            <option value="link">Link</option>
          </select>
        </label>

        {origin === 'cbz' && (
          <div style={{ padding: 14, borderRadius: 16, background: '#f8f8fb', border: '1px solid #e4e4ec', marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => void handleSelectFiles()}
              style={{
                padding: '10px 18px',
                borderRadius: 9999,
                border: '1px dashed #c4c4cc',
                background: '#ffffff',
                color: '#111111',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'center',
              }}
            >
              Selecionar arquivos (.cbz, .pdf)
            </button>
            {selectedFiles.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedFiles.map((file, idx) => (
                  <div
                    key={file.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 12,
                      background: '#ffffff',
                      border: '1px solid #e4e4ec',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {idx + 1}. {file.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#636370', whiteSpace: 'nowrap' }}>{formatBytes(file.sizeBytes)}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" onClick={() => moveFile(idx, -1)} disabled={idx === 0} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid #d4d4dc', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: 11 }}>↑</button>
                      <button type="button" onClick={() => moveFile(idx, 1)} disabled={idx === selectedFiles.length - 1} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid #d4d4dc', background: '#fff', cursor: idx === selectedFiles.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11 }}>↓</button>
                      <button type="button" onClick={() => removeFile(idx)} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#991b1b', cursor: 'pointer', fontSize: 11 }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {origin === 'link' && (
          <div style={{ padding: 14, borderRadius: 16, background: '#f8f8fb', border: '1px solid #e4e4ec', marginBottom: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {linkInputs.map((url, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={url}
                    onChange={(e) => updateLinkInput(idx, e.target.value)}
                    placeholder="https://exemplo.com/manga/capitulo/1"
                    style={{ ...INPUT_STYLE, flex: 1 }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => moveLink(idx, -1)} disabled={idx === 0} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #d4d4dc', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: 11 }}>↑</button>
                    <button type="button" onClick={() => moveLink(idx, 1)} disabled={idx === linkInputs.length - 1} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #d4d4dc', background: '#fff', cursor: idx === linkInputs.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11 }}>↓</button>
                    <button type="button" onClick={() => removeLinkInput(idx)} disabled={linkInputs.length <= 1} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #fca5a5', background: linkInputs.length <= 1 ? '#f5f5f5' : '#fef2f2', color: '#991b1b', cursor: linkInputs.length <= 1 ? 'not-allowed' : 'pointer', fontSize: 11 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={addLinkInput} style={{ padding: '7px 14px', borderRadius: 9999, border: '1px solid #d4d4dc', background: '#ffffff', color: '#111111', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                + Adicionar link
              </button>
              <button
                type="button"
                disabled={startState !== 'idle'}
                onClick={() => void handleAnalyzeAllLinks()}
                style={{
                  padding: '7px 14px',
                  borderRadius: 9999,
                  border: 0,
                  background: '#111111',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Analisar todos
              </button>
            </div>
            {analyzedLinks.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#111111' }}>
                {analyzedLinks.map((link) => (
                  <div key={link.url} style={{ padding: '6px 0', borderBottom: '1px solid #e4e4ec' }}>
                    <strong>{link.meta.workTitle}</strong> — Cap. {link.meta.chapterNumber} ({link.adapterName}) · {link.pagesCount} págs.
                    {link.alreadyImported && <span style={{ marginLeft: 6, fontSize: 11, color: '#16a34a' }}>✓ Já importado</span>}
                  </div>
                ))}
              </div>
            )}
            {importJob && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: '#ffffff', border: '1px solid #e4e4ec', fontSize: 12 }}>
                <strong>Status:</strong> {importJob.status}
                {importJob.items.map((it) => (
                  <div key={it.url} style={{ marginTop: 4 }}>
                    {it.status} — {it.pagesDone}/{it.pagesTotal} páginas {it.error ? `⚠ ${it.error}` : ''}
                  </div>
                ))}
                {importJob.status === 'failed' && (
                  <button type="button" onClick={() => void getRecapBridge()?.recapImportRetryJob?.(importJob.id)} style={{ marginTop: 8, fontSize: 11, padding: '5px 10px', borderRadius: 9999, border: '1px solid #d4d4dc', cursor: 'pointer' }}>
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {importError && (
          <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12, fontWeight: 500, marginBottom: 14 }}>
            {importError}
          </div>
        )}

        {/* Modalidade de produção */}
        <label style={{ fontSize: 12, color: '#555562', marginBottom: 10, display: 'block' }}>
          Modalidade
          <select
            value={productionMode}
            onChange={(e) => setProductionMode(e.target.value as 'single' | 'individual')}
            style={{ ...INPUT_STYLE, marginTop: 4 }}
          >
            <option value="single">Recap único (combinar capítulos)</option>
            <option value="individual">Recaps individuais (um por capítulo)</option>
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Obra
            <input value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} placeholder="Nome da obra" style={{ ...INPUT_STYLE, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Estilo Narrativo
            <select value={scriptStyle} onChange={(e) => setScriptStyle(e.target.value)} style={{ ...INPUT_STYLE, marginTop: 4 }}>
              <option value="cinematic_recap">Cinematográfico</option>
              <option value="narrative_recap">Narrativo Clássico</option>
              <option value="suspense">Suspense</option>
              <option value="mystery">Mistério</option>
              <option value="documentary">Documental</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Formato de Vídeo
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')} style={{ ...INPUT_STYLE, marginTop: 4 }}>
              <option value="16:9">16:9 Horizontal (YouTube)</option>
              <option value="9:16">9:16 Vertical (Shorts / Reels)</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Provedor de Voz (TTS)
            <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} style={{ ...INPUT_STYLE, marginTop: 4 }}>
              <option value="voicestudio_tts">VoiceStudio Local</option>
              <option value="elevenlabs_tts">ElevenLabs</option>
              <option value="windows_sapi_tts">Windows SAPI</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Idioma
            <input value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...INPUT_STYLE, marginTop: 4 }} />
          </label>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: '#33333d' }}>
          <input type="checkbox" checked={enableOcr} onChange={(e) => setEnableOcr(e.target.checked)} />
          Executar OCR (Tesseract) na extração para evidências textuais no Gate F
        </label>
      </section>

      {/* Fase 4.2 — Painel de Produção (Circuit Breakers & Checkpoints) */}
      <section style={CARD_STYLE}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#6a46d8' }}>
          PAINEL DE PRODUÇÃO • FASE 4.2
        </span>
        <h3 style={{ margin: '4px 0 10px', fontSize: 17, fontWeight: 700, color: '#111111' }}>
          Circuit Breakers, Quotas e Checkpoints
        </h3>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 16,
            marginBottom: 14,
            background: readiness.ready ? '#ecfdf3' : '#fff4e5',
            color: readiness.ready ? '#0f5132' : '#8a4b08',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {readiness.summaryMessage}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 16 }}>
          {readiness.providers.map((p) => {
            const isOk = p.status === 'available';
            const isOpen = p.status === 'circuit_open';
            return (
              <div
                key={p.providerId}
                style={{
                  padding: 12,
                  borderRadius: 16,
                  background: '#f8f8fb',
                  border: `1px solid ${isOk ? '#b7ebcc' : isOpen ? '#f5c2c7' : '#e4e4ec'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontSize: 13, color: '#111111' }}>{p.label}</strong>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: isOk ? '#d1fae5' : isOpen ? '#fee2e2' : '#e5e7eb',
                      color: isOk ? '#065f46' : isOpen ? '#991b1b' : '#374151',
                    }}
                  >
                    {isOk ? 'ONLINE' : p.code ?? 'INDISPONÍVEL'}
                  </span>
                </div>
                {p.resetAtText && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#991b1b', fontWeight: 600 }}>
                    Reset previsto: {p.resetAtText}
                  </p>
                )}
                {p.reason && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#636370', lineHeight: 1.35 }}>
                    {p.reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Etapas do Pipeline */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {PIPELINE_STAGES.map((stage, idx) => (
            <span
              key={stage}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '5px 10px',
                borderRadius: 9999,
                background: '#f1f1f6',
                color: '#32323d',
              }}
            >
              {idx + 1}. {stage}
            </span>
          ))}
        </div>

        {/* Ações de Produção / Retomada */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={!readiness.ready || loading || startState !== 'idle'}
            onClick={() => void handleStart(false)}
            style={{
              padding: '10px 18px',
              borderRadius: 9999,
              border: 0,
              background: readiness.ready && startState === 'idle' ? '#d8fb4f' : startState !== 'idle' ? '#fef3c7' : '#e5e7eb',
              color: '#111111',
              fontWeight: 700,
              fontSize: 13,
              cursor: readiness.ready && startState === 'idle' ? 'pointer' : 'not-allowed',
              transition: 'background 200ms ease-out',
            }}
          >
            {startLabel()}
          </button>

          {readiness.checkpoint.canResume && (
            <button
              type="button"
              disabled={!readiness.ready || loading}
              onClick={() => void handleStart(true)}
              style={{
                padding: '10px 18px',
                borderRadius: 9999,
                border: 0,
                background: readiness.ready ? '#111111' : '#d1d5db',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                cursor: readiness.ready ? 'pointer' : 'not-allowed',
              }}
            >
              Retomar Checkpoint ({readiness.checkpoint.completedPanels}/{readiness.checkpoint.totalPanels} painéis)
            </button>
          )}
        </div>

        {statusNote && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#555562' }}>{statusNote}</p>
        )}
      </section>

      {/* Fase 4.3 — Editor de Cenas */}
      <section style={CARD_STYLE}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#6a46d8' }}>
          EDITOR DE CENAS • FASE 4.3
        </span>
        <h3 style={{ margin: '4px 0 12px', fontSize: 17, fontWeight: 700, color: '#111111' }}>
          Painéis, Narração, Câmera e Duração
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {scenes.map((row, idx) => (
            <div
              key={row.sceneId}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 110px 1fr 140px 80px',
                gap: 8,
                alignItems: 'center',
                padding: 10,
                borderRadius: 14,
                background: '#f8f8fb',
                border: '1px solid #e4e4ec',
              }}
            >
              <strong style={{ fontSize: 12, color: '#111111' }}>{row.sceneId}</strong>
              <input
                value={row.panelId}
                onChange={(e) => {
                  const next = [...scenes];
                  next[idx] = { ...row, panelId: e.target.value };
                  setScenes(next);
                }}
                style={{ ...INPUT_STYLE, padding: '6px 10px', fontSize: 12 }}
              />
              <input
                value={row.narrationText}
                onChange={(e) => {
                  const next = [...scenes];
                  next[idx] = { ...row, narrationText: e.target.value };
                  setScenes(next);
                }}
                style={{ ...INPUT_STYLE, padding: '6px 10px', fontSize: 12 }}
              />
              <select
                value={row.motionStyle}
                onChange={(e) => {
                  const next = [...scenes];
                  next[idx] = { ...row, motionStyle: e.target.value };
                  setScenes(next);
                }}
                style={{ ...INPUT_STYLE, padding: '6px 10px', fontSize: 12 }}
              >
                <option value="ken_burns_in">Ken Burns In</option>
                <option value="ken_burns_out">Ken Burns Out</option>
                <option value="parallax">Parallax</option>
                <option value="pan_vertical">Pan Vertical</option>
                <option value="static_focus">Foco Balão</option>
                <option value="impact_push">Impact Push</option>
              </select>
              <input
                type="number"
                step="0.5"
                min="1"
                value={row.estimatedDurationSec}
                onChange={(e) => {
                  const next = [...scenes];
                  next[idx] = { ...row, estimatedDurationSec: Number(e.target.value) || 2 };
                  setScenes(next);
                }}
                style={{ ...INPUT_STYLE, padding: '6px 8px', fontSize: 12 }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Fase 4.4 — Revisão por Prompt com Plano de Impacto */}
      <section style={CARD_STYLE}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#6a46d8' }}>
          REVISÃO POR PROMPT • FASE 4.4 & 5.4
        </span>
        <h3 style={{ margin: '4px 0 10px', fontSize: 17, fontWeight: 700, color: '#111111' }}>
          Edição Incremental com Plano de Impacto
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {[
            'Deixe a cena 2 mais dramática',
            'Reduza a música e destaque a narração',
            'Troque o painel da cena 1',
            'Corrija a pronúncia de "Cheon" para "Tchon"',
          ].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => void handlePlanRevision(ex)}
              style={{
                padding: '5px 10px',
                borderRadius: 9999,
                border: '1px solid #d4d4dc',
                background: '#ffffff',
                color: '#32323d',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {ex}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={revisionPrompt}
            onChange={(e) => setRevisionPrompt(e.target.value)}
            placeholder="Ex: Reduza a música e destaque a narração na cena 2..."
            style={INPUT_STYLE}
          />
          <button
            type="button"
            onClick={() => void handlePlanRevision()}
            style={{
              padding: '10px 16px',
              borderRadius: 9999,
              border: 0,
              background: '#111111',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Simular Impacto
          </button>
        </div>

        {impactPlan && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: '#f4f4f8', fontSize: 12, color: '#111111' }}>
            <strong>{impactPlan.summary}</strong>
            <div style={{ marginTop: 6, color: '#4b5563' }}>
              Reprocessar: <code>{impactPlan.reprocessStages.join(', ') || 'nenhuma'}</code> · Reaproveitar:{' '}
              <code>{impactPlan.reusedStages.join(', ')}</code>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
