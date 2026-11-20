import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { AetheraMark } from './AetheraMark.js';
import { CreativeStudioPanel } from './CreativeStudioPanel.js';
import { RecapProductionPanel } from './RecapProductionPanel.js';
import { ProductionConsoleAccordion } from '@/features/video/ProductionConsoleAccordion';
import { TtsProviderSelector } from '@/features/aethera/TtsProviderSelector';

const BENTO_CARD_STYLE: CSSProperties = {
  background: 'var(--card, #ffffff)',
  border: '1px solid rgba(17, 17, 17, 0.05)',
  borderRadius: 28,
  padding: 24,
  boxShadow: 'var(--elevation-1, 0 1px 2px rgba(17, 17, 17, 0.03), 0 8px 24px -14px rgba(17, 17, 17, 0.08))',
};

const BENTO_INPUT_STYLE: CSSProperties = {
  flex: 1,
  padding: '12px 16px',
  borderRadius: 16,
  border: '1px solid var(--border, #e2e2e7)',
  background: 'var(--secondary, #f4f4f6)',
  color: 'var(--foreground, #111111)',
  fontSize: 13,
  outline: 'none',
};

const BENTO_PRIMARY_BTN_STYLE: CSSProperties = {
  padding: '11px 20px',
  borderRadius: 9999,
  border: 0,
  background: '#111111',
  color: '#ffffff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const BENTO_LIME_BTN_STYLE: CSSProperties = {
  padding: '11px 20px',
  borderRadius: 9999,
  border: 0,
  background: 'var(--brand-lime, #d8fb4f)',
  color: 'var(--brand-ink, #111111)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

interface StagedJobSummary {
  jobId?: string;
  projectId: string;
  prompt: string;
  state: string;
  progressPct: number;
  message: string;
  genre?: string;
  startedAt?: string;
  updatedAt: string;
  error?: string;
}

interface AetheraBridgeExtended {
  cinemaListStagedJobs?: () => Promise<StagedJobSummary[]>;
  onCinemaProductionProgress?: (listener: (job: unknown) => void) => () => void;
}

function getExtendedBridge(): AetheraBridgeExtended | undefined {
  return (window as unknown as { aetheraBridge?: AetheraBridgeExtended }).aetheraBridge;
}

interface AetheraStatus {
  appId: 'aethera';
  dbPath: string;
  baseUrl: string;
  agents: string[];
  runs: Array<{ id: string; topic: string; status: string; agent: string | null; createdAt: string }>;
  channels: Array<{ id: string; name: string; platform: string; language: string }>;
  tools: { ffmpeg: boolean; ffprobe: boolean; ytdlp: boolean };
  peers: Array<{ appId: string; pid: number; baseUrl: string }>;
}

type Tab = 'produce' | 'recap' | 'creative' | 'runs' | 'review' | 'calendar' | 'ecosystem';

declare global {
  interface Window {
    aetheraBridge?: {
      getStatus: () => Promise<AetheraStatus>;
      produceFromPrompt: (prompt: string) => Promise<{
        runId: string;
        agent: string;
        dagStages: number;
        dagNames: string[];
        metadata: { title: string; description: string; tags: string[] };
      }>;
      planCalendar: (prompt: string) => Promise<{
        items: Array<{ id: string; title: string; scheduledAtIso: string; status: string }>;
        conflicts: number;
      }>;
      planRevisionCommand: (instruction: string) => Promise<{ summary: string; affectedStages: string[] }>;
      pairPeer: (targetApp: 'orchestrator' | 'void') => Promise<{ tokenId: string; secret: string }>;
    };
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('produce');
  const [status, setStatus] = useState<AetheraStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [produced, setProduced] = useState<{
    runId: string;
    agent: string;
    dagStages: number;
    dagNames: string[];
    metadata: { title: string; description: string; tags: string[] };
  } | null>(null);
  const [revInput, setRevInput] = useState('');
  const [revPlan, setRevPlan] = useState<{ summary: string; affectedStages: string[] } | null>(null);
  const [calendarPrompt, setCalendarPrompt] = useState('');
  const [calendarResult, setCalendarResult] = useState<{
    items: Array<{ id: string; title: string; scheduledAtIso: string; status: string }>;
    conflicts: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ttsProviderId, setTtsProviderId] = useState<string>('voicestudio');
  const [ttsVoiceId, setTtsVoiceId] = useState<string>('');

  const refresh = async () => {
    if (!window.aetheraBridge) return;
    setStatus(await window.aetheraBridge.getStatus());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleProduce = async () => {
    if (!window.aetheraBridge || !prompt.trim()) return;
    setError(null);
    try {
      const res = await window.aetheraBridge.produceFromPrompt(prompt.trim());
      setProduced(res);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRevision = async () => {
    if (!window.aetheraBridge || !revInput.trim()) return;
    setRevPlan(await window.aetheraBridge.planRevisionCommand(revInput.trim()));
  };

  const handleCalendar = async () => {
    if (!window.aetheraBridge || !calendarPrompt.trim()) return;
    setCalendarResult(await window.aetheraBridge.planCalendar(calendarPrompt.trim()));
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'produce', label: 'Produção por Prompt' },
    { id: 'creative', label: 'Creative Studio' },
    { id: 'runs', label: 'Produções & Pipeline' },
    { id: 'review', label: 'Revisão por Prompt' },
    { id: 'calendar', label: 'Canais & Calendário' },
    { id: 'ecosystem', label: 'Mídia & Ecossistema' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--background, #ececee)',
        color: 'var(--foreground, #111111)',
        fontFamily: 'var(--font-sans, "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif)',
      }}
    >
      <aside
        style={{
          width: 248,
          padding: '20px 16px',
          background: 'var(--background, #ececee)',
          borderRight: '1px solid var(--border, #e2e2e7)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 24,
            background: 'var(--card, #ffffff)',
            border: '1px solid rgba(17, 17, 17, 0.05)',
            boxShadow: 'var(--elevation-1)',
          }}
        >
          <AetheraMark size={30} />
          <p style={{ fontSize: 11, color: 'var(--muted-foreground, #72727d)', margin: '8px 0 0', fontWeight: 500 }}>
            AI Cinematic Studio • RF-07
          </p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  borderRadius: 16,
                  border: active ? '1px solid #111111' : '1px solid transparent',
                  cursor: 'pointer',
                  background: active ? '#111111' : 'var(--card, #ffffff)',
                  color: active ? '#ffffff' : 'var(--foreground, #111111)',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? '0 8px 20px -10px rgba(17, 17, 17, 0.35)' : '0 1px 2px rgba(17, 17, 17, 0.03)',
                  transition: 'background-color 140ms ease, color 140ms ease',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main style={{ flex: 1, padding: 24, maxWidth: tab === 'creative' ? 1480 : 1080, width: '100%' }}>
        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              marginBottom: 16,
              background: '#fde7f3',
              color: '#b42840',
              border: '1px solid rgba(180, 40, 64, 0.18)',
              borderRadius: 18,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        {tab === 'recap' && <RecapProductionPanel />}

        {tab === 'produce' && (
          <section style={BENTO_CARD_STYLE}>
            <div style={{ marginBottom: 16 }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: '#6a46d8',
                  marginBottom: 6,
                }}
              >
                AETHERA-AUTO-01
              </span>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', color: '#111111' }}>
                Produção Autônoma por Prompt
              </h2>
              <p style={{ fontSize: 12, color: 'var(--muted-foreground, #72727d)', margin: '6px 0 0' }}>
                SQLite: <span style={{ fontFamily: 'var(--font-mono)' }}>{status?.dbPath ?? '—'}</span> • Agentes:{' '}
                <strong style={{ color: '#111111' }}>{status?.agents.join(', ') || 'Nenhum'}</strong>
              </p>
            </div>
            <div style={{ marginBottom: 16, maxWidth: 480 }}>
              <TtsProviderSelector
                selectedProviderId={ttsProviderId}
                selectedVoiceId={ttsVoiceId}
                onProviderChange={(id) => {
                  setTtsProviderId(id);
                  setTtsVoiceId(''); // Reset voice on provider switch to prevent stale selection
                }}
                onVoiceChange={setTtsVoiceId}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Crie um vídeo cinematográfico de 12 minutos sobre os 10 chefes mais difíceis de Elden Ring..."
                style={BENTO_INPUT_STYLE}
              />
              <button type="button" onClick={() => void handleProduce()} style={BENTO_LIME_BTN_STYLE}>
                Gerar Vídeo
              </button>
            </div>
            {produced && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 20,
                  background: 'var(--secondary, #f4f4f6)',
                  border: '1px solid var(--border, #e2e2e7)',
                  fontSize: 13,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  color: '#111111',
                }}
              >
                <div>
                  <strong>Run:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{produced.runId}</span> •{' '}
                  <strong>Agente:</strong> {produced.agent}
                </div>
                <div>
                  <strong>Pipeline ({produced.dagStages} etapas):</strong> {produced.dagNames.join(' → ')}
                </div>
                <div>
                  <strong>Título sugerido:</strong> {produced.metadata.title}
                </div>
                <div>
                  <strong>Tags:</strong> {produced.metadata.tags.join(', ')}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'runs' && <ProductionJobsPanel />}

        {tab === 'review' && (
          <section style={BENTO_CARD_STYLE}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#6a46d8',
                marginBottom: 6,
              }}
            >
              EDIÇÃO CIRÚRGICA
            </span>
            <h2 style={{ margin: '0 0 14px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', color: '#111111' }}>
              Revisão Cirúrgica por Prompt
            </h2>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                value={revInput}
                onChange={(e) => setRevInput(e.target.value)}
                placeholder="Ex: Troque a música da cena 3 para algo mais épico e reduza o ritmo..."
                style={BENTO_INPUT_STYLE}
              />
              <button type="button" onClick={() => void handleRevision()} style={BENTO_PRIMARY_BTN_STYLE}>
                Planejar Alteração
              </button>
            </div>
            {revPlan && (
              <div
                style={{
                  fontSize: 13,
                  padding: 16,
                  borderRadius: 20,
                  background: 'var(--secondary, #f4f4f6)',
                  border: '1px solid var(--border, #e2e2e7)',
                  color: '#111111',
                }}
              >
                <p style={{ margin: '0 0 6px' }}>{revPlan.summary}</p>
                <p style={{ margin: 0, color: 'var(--muted-foreground, #72727d)' }}>
                  Operações: <strong style={{ color: '#111111' }}>{revPlan.affectedStages.join(', ') || 'nenhuma'}</strong>
                </p>
              </div>
            )}
          </section>
        )}

        {tab === 'calendar' && (
          <section style={BENTO_CARD_STYLE}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#6a46d8',
                marginBottom: 6,
              }}
            >
              AETHERA-CHANNEL-01
            </span>
            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', color: '#111111' }}>
              Canais &amp; Calendário Editorial
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #72727d)', margin: '0 0 16px' }}>
              Canais configurados:{' '}
              <strong style={{ color: '#111111' }}>
                {(status?.channels ?? []).map((c) => `${c.name} (${c.platform})`).join(', ') || 'Nenhum'}
              </strong>
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                value={calendarPrompt}
                onChange={(e) => setCalendarPrompt(e.target.value)}
                placeholder="Ex: Planejar 3 vídeos semanais sobre RPGs e Soulslike..."
                style={BENTO_INPUT_STYLE}
              />
              <button type="button" onClick={() => void handleCalendar()} style={BENTO_PRIMARY_BTN_STYLE}>
                Planejar Semana
              </button>
            </div>
            {calendarResult && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 20,
                  background: 'var(--secondary, #f4f4f6)',
                  border: '1px solid var(--border, #e2e2e7)',
                }}
              >
                <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: '#111111' }}>
                  Conflitos detectados: {calendarResult.conflicts}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {calendarResult.items.map((item) => (
                    <li key={item.id} style={{ fontSize: 13, marginBottom: 6, color: '#111111' }}>
                      <span style={{ fontWeight: 600 }}>[{item.status}]</span> {item.title} —{' '}
                      <span style={{ color: 'var(--muted-foreground, #72727d)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {item.scheduledAtIso}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'creative' && <CreativeStudioPanel />}

        {tab === 'ecosystem' && (
          <section style={BENTO_CARD_STYLE}>
            <span
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#6a46d8',
                marginBottom: 6,
              }}
            >
              ECOSSISTEMA LOCAL
            </span>
            <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', color: '#111111' }}>
              Ferramentas de Mídia &amp; Ecossistema
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { label: 'FFmpeg', ok: status?.tools.ffmpeg },
                { label: 'FFprobe', ok: status?.tools.ffprobe },
                { label: 'yt-dlp', ok: status?.tools.ytdlp },
              ].map((tool) => (
                <span
                  key={tool.label}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: tool.ok ? '#eaf7df' : '#fde7f3',
                    color: tool.ok ? '#15803d' : '#b42840',
                  }}
                >
                  {tool.label}: {tool.ok ? 'OK' : 'ausente'}
                </span>
              ))}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #72727d)', margin: '0 0 16px' }}>
              Loopback API:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: '#111111' }}>{status?.baseUrl ?? '—'}</span>
            </p>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#111111' }}>
              Peers Descobertos ({status?.peers.length ?? 0})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(status?.peers ?? []).map((p) => (
                <div
                  key={p.appId}
                  style={{
                    fontSize: 13,
                    padding: '10px 14px',
                    borderRadius: 16,
                    background: 'var(--secondary, #f4f4f6)',
                    color: '#111111',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {p.appId} (PID {p.pid}) — {p.baseUrl}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ProductionJobsPanel() {
  const [jobs, setJobs] = useState<StagedJobSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshJobs = useCallback(async () => {
    const bridge = getExtendedBridge();
    if (!bridge?.cinemaListStagedJobs) return;
    setLoading(true);
    try {
      const list = await bridge.cinemaListStagedJobs();
      setJobs(list);
    } catch {
      // silent — panel is observational
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
    const bridge = getExtendedBridge();
    if (!bridge?.onCinemaProductionProgress) return;
    const unsub = bridge.onCinemaProductionProgress((raw) => {
      const job = raw as StagedJobSummary;
      if (!job?.projectId) return;
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.projectId === job.projectId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = job;
          return next;
        }
        return [job, ...prev];
      });
    });
    return unsub;
  }, [refreshJobs]);

  const stateBadge = (state: string): { bg: string; fg: string; bar: string } => {
    if (state === 'error') return { bg: '#fde7f3', fg: '#b42840', bar: '#dc2626' };
    if (state === 'cancelled') return { bg: '#fef3c7', fg: '#b45309', bar: '#d97706' };
    if (state === 'editor' || state === 'previa') return { bg: '#eaf7df', fg: '#15803d', bar: '#16a34a' };
    if (state.startsWith('paused')) return { bg: '#fef3c7', fg: '#b45309', bar: '#d97706' };
    return { bg: '#ede9fe', fg: '#6a46d8', bar: '#111111' };
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          ...BENTO_CARD_STYLE,
          padding: '18px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <span
            style={{
              display: 'inline-block',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#6a46d8',
              marginBottom: 4,
            }}
          >
            PIPELINE &amp; FILA
          </span>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#111111' }}>
            Projetos em Produção com IA ({jobs.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshJobs()}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: 9999,
            border: '1px solid var(--border, #e2e2e7)',
            background: 'var(--secondary, #f4f4f6)',
            color: '#111111',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {jobs.length === 0 && !loading && (
        <div style={{ ...BENTO_CARD_STYLE, fontSize: 13, color: 'var(--muted-foreground, #72727d)' }}>
          Nenhuma produção em andamento.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch' }}>
        {jobs.map((job) => {
          const palette = stateBadge(job.state);
          return (
            <div
              key={job.projectId}
              style={{
                ...BENTO_CARD_STYLE,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                alignSelf: 'stretch',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111111', wordBreak: 'break-word' }}>
                {job.prompt.slice(0, 120)}
                {job.prompt.length > 120 ? '…' : ''}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground, #72727d)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    background: palette.bg,
                    color: palette.fg,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 9999,
                    fontSize: 10,
                    letterSpacing: '0.04em',
                  }}
                >
                  {job.state.toUpperCase()}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#111111' }}>
                  {job.progressPct}% concluído
                </span>
                {job.genre ? <span>• {job.genre}</span> : null}
                {job.startedAt ? <span>• Início: {new Date(job.startedAt).toLocaleTimeString()}</span> : null}
                {job.updatedAt ? <span>• Atualizado: {new Date(job.updatedAt).toLocaleTimeString()}</span> : null}
                {job.jobId ? (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>• Job: {job.jobId.slice(-8)}</span>
                ) : null}
              </div>
              {job.message && <div style={{ fontSize: 12, color: '#4c4c55' }}>{job.message}</div>}
              {job.error && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#b42840',
                    background: '#fde7f3',
                    padding: '8px 12px',
                    borderRadius: 12,
                  }}
                >
                  ⚠ {job.error}
                </div>
              )}

              {/* Progress bar */}
              <div style={{ height: 6, borderRadius: 9999, background: '#f4f4f6', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, job.progressPct))}%`,
                    background: palette.bar,
                    borderRadius: 9999,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              <ProductionConsoleAccordion jobId={job.jobId ?? job.projectId} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default App;

