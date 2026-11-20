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

interface RecapBridge {
  recapGetReadiness?: (input?: { chapterId?: string }) => Promise<RecapReadinessView>;
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
  const [archivePath, setArchivePath] = useState('tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz');
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
    </div>
  );
}
