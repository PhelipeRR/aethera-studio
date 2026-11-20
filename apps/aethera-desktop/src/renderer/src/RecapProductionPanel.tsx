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

interface RecapBridge {
  recapGetReadiness?: (input?: { chapterId?: string }) => Promise<RecapReadinessView>;
  recapPlanRevision?: (input: { prompt: string; script: unknown; availablePanelIds?: string[] }) => Promise<RecapRevisionPlanView>;
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

export function RecapProductionPanel() {
  // Fase 4.1 — Criação de projeto
  const [importMode, setImportMode] = useState<'local' | 'url'>('local');
  const [archivePath, setArchivePath] = useState('tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz');
  const [chapterUrl, setChapterUrl] = useState('https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1');
  const [analyzedLink, setAnalyzedLink] = useState<{
    sourceUrl: string;
    adapterName: string;
    meta: { workTitle: string; chapterNumber: string };
    pages: Array<{ pageNumber: number; imageUrl: string }>;
    availableChapters: Array<{ chapterNumber: string; title: string; url: string }>;
    alreadyImported: { cbzPath: string } | null;
  } | null>(null);
  const [selectedBatchUrls, setSelectedBatchUrls] = useState<string[]>([]);
  const [importJob, setImportJob] = useState<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [workTitle, setWorkTitle] = useState('Nano Machine');
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
  const [scenes, setScenes] = useState<EditableSceneRow[]>([
    { sceneId: 'scene-1', panelId: 'panel-001', narrationText: 'Abertura cinematográfica no pátio sombrio.', motionStyle: 'ken_burns_out', estimatedDurationSec: 3.5 },
    { sceneId: 'scene-2', panelId: 'panel-002', narrationText: 'O protagonista encara o rival antes do confronto.', motionStyle: 'static_focus', estimatedDurationSec: 4.0 },
    { sceneId: 'scene-3', panelId: 'panel-003', narrationText: 'O golpe decide o ritmo do capítulo.', motionStyle: 'impact_push', estimatedDurationSec: 3.5 },
  ]);

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


  const handleAnalyzeLink = async () => {
    setImportError(null);
    const bridge = getRecapBridge();
    if (!bridge?.recapImportAnalyze) {
      setImportError('Bridge IPC de importação por link disponível apenas no Aethera Desktop / Remote Host.');
      return;
    }
    setLoading(true);
    try {
      const res = await bridge.recapImportAnalyze({ url: chapterUrl });
      setAnalyzedLink(res);
      setWorkTitle(res.meta.workTitle);
      setSelectedBatchUrls([res.sourceUrl]);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleImportByUrl = async () => {
    setImportError(null);
    const bridge = getRecapBridge();
    if (!bridge?.recapImportCreateJob || !bridge.recapImportGetJob) return;
    const urls = selectedBatchUrls.length > 0 ? selectedBatchUrls : [chapterUrl];
    const job = await bridge.recapImportCreateJob({ urls });
    setImportJob(job);
    const poll = setInterval(async () => {
      const snap = await bridge.recapImportGetJob?.(job.id);
      if (snap) {
        setImportJob(snap);
        if (snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled') {
          clearInterval(poll);
          const firstCbz = snap.items.find((i) => i.libraryEntry?.cbzPath)?.libraryEntry?.cbzPath;
          if (firstCbz) setArchivePath(firstCbz);
        }
      }
    }, 600);
  };

  const handleStart = async (resumeCheckpoint: boolean) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapStartProduction) {
      setStatusNote('Orquestração direta via UI aguardando conexão IPC recap:start-production. Use os scripts CLI da Fase 2.2.4 / Fase 3 enquanto isso.');
      return;
    }
    setLoading(true);
    try {
      const res = await bridge.recapStartProduction({
        archivePath,
        workTitle,
        language,
        scriptStyle,
        aspectRatio,
        ttsProvider,
        enableOcr,
        resumeCheckpoint,
      });
      setStatusNote(res.message);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

        {/* Seletor: CBZ Local vs Importar por link */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setImportMode('local')}
            style={{
              padding: '7px 14px',
              borderRadius: 9999,
              border: '1px solid #d4d4dc',
              background: importMode === 'local' ? '#111111' : '#ffffff',
              color: importMode === 'local' ? '#ffffff' : '#111111',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            CBZ / PDF Local
          </button>
          <button
            type="button"
            onClick={() => setImportMode('url')}
            style={{
              padding: '7px 14px',
              borderRadius: 9999,
              border: '1px solid #d4d4dc',
              background: importMode === 'url' ? '#111111' : '#ffffff',
              color: importMode === 'url' ? '#ffffff' : '#111111',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Importar por link
          </button>
        </div>

        {importMode === 'url' && (
          <div style={{ padding: 14, borderRadius: 16, background: '#f8f8fb', border: '1px solid #e4e4ec', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                value={chapterUrl}
                onChange={(e) => setChapterUrl(e.target.value)}
                placeholder="https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1"
                style={INPUT_STYLE}
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleAnalyzeLink()}
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
                Analisar link
              </button>
            </div>

            {importError && (
              <p style={{ margin: '6px 0', fontSize: 12, color: '#b42840', fontWeight: 500 }}>{importError}</p>
            )}

            {analyzedLink && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#111111' }}>
                <div>
                  <strong>{analyzedLink.meta.workTitle}</strong> — Capítulo {analyzedLink.meta.chapterNumber} ({analyzedLink.adapterName}) ·{' '}
                  <strong>{analyzedLink.pages.length}</strong> páginas detectadas
                </div>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 0' }}>
                  {analyzedLink.pages.slice(0, 8).map((pg) => (
                    <span
                      key={pg.pageNumber}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 10, background: '#ffffff', border: '1px solid #e2e2ea', whiteSpace: 'nowrap' }}
                    >
                      Pág. {pg.pageNumber}
                    </span>
                  ))}
                  {analyzedLink.pages.length > 8 && <span style={{ fontSize: 11, color: '#636370' }}>+{analyzedLink.pages.length - 8} páginas</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => void handleImportByUrl()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9999,
                      border: 0,
                      background: '#d8fb4f',
                      color: '#111111',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Importar ({selectedBatchUrls.length || 1} cap.)
                  </button>
                </div>
              </div>
            )}

            {importJob && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: '#ffffff', border: '1px solid #e4e4ec', fontSize: 12 }}>
                <strong>Status da Importação:</strong> {importJob.status}
                {importJob.items.map((it) => (
                  <div key={it.url} style={{ marginTop: 4 }}>
                    {it.status} — {it.pagesDone}/{it.pagesTotal} páginas {it.error ? `(${it.error})` : ''}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {importJob.status === 'failed' && (
                    <button type="button" onClick={() => void getRecapBridge()?.recapImportRetryJob?.(importJob.id)} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 9999, border: '1px solid #d4d4dc', cursor: 'pointer' }}>
                      Tentar novamente
                    </button>
                  )}
                  {importJob.status === 'completed' && (
                    <button
                      type="button"
                      onClick={() => void handleStart(false)}
                      style={{ fontSize: 11, padding: '6px 12px', borderRadius: 9999, border: 0, background: '#111111', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Criar Recap
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Capítulo (CBZ, PDF ou pasta)
            <input value={archivePath} onChange={(e) => setArchivePath(e.target.value)} style={{ ...INPUT_STYLE, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: '#555562' }}>
            Obra
            <input value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} style={{ ...INPUT_STYLE, marginTop: 4 }} />
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
            disabled={!readiness.ready || loading}
            onClick={() => void handleStart(false)}
            style={{
              padding: '10px 18px',
              borderRadius: 9999,
              border: 0,
              background: readiness.ready ? '#d8fb4f' : '#e5e7eb',
              color: '#111111',
              fontWeight: 700,
              fontSize: 13,
              cursor: readiness.ready ? 'pointer' : 'not-allowed',
            }}
          >
            Iniciar Produção Recap
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
