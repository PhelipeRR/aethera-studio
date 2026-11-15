import { useEffect, useState } from 'react';
import { CreativeStudioPanel } from './CreativeStudioPanel.js';

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

type Tab = 'produce' | 'creative' | 'runs' | 'review' | 'calendar' | 'ecosystem';

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
    <div style={{ display: 'flex', minHeight: '100vh', background: '#071110', color: '#ecfdf5' }}>
      <aside style={{ width: 220, padding: 16, borderRight: '1px solid #134e4a', background: '#091917' }}>
        <h1 style={{ fontSize: 16, margin: '0 0 4px' }}>Aethera Studio</h1>
        <p style={{ fontSize: 11, color: '#5eead4', margin: '0 0 16px' }}>AI Cinematic Studio • RF-07</p>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 6,
                border: 0,
                cursor: 'pointer',
                background: tab === t.id ? '#0d9488' : 'transparent',
                color: tab === t.id ? '#fff' : '#ccfbf1',
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, padding: 24, maxWidth: 980 }}>
        {error && <div style={{ padding: 10, marginBottom: 12, background: '#450a0a', borderRadius: 8 }}>{error}</div>}

        {tab === 'produce' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Produção Autônoma por Prompt (AETHERA-AUTO-01)</h2>
            <p style={{ fontSize: 12, color: '#99f6e4' }}>
              SQLite: {status?.dbPath} • Agentes: {status?.agents.join(', ') || 'Nenhum'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Crie um vídeo cinematográfico de 12 minutos sobre os 10 chefes mais difíceis de Elden Ring..."
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #115e59', background: '#042f2e', color: '#fff' }}
              />
              <button type="button" onClick={() => void handleProduce()} style={{ padding: '10px 16px', borderRadius: 8, border: 0, background: '#14b8a6', color: '#042f2e', fontWeight: 600 }}>
                Gerar Vídeo
              </button>
            </div>
            {produced && (
              <div style={{ padding: 14, borderRadius: 8, background: '#042f2e', border: '1px solid #0f766e', fontSize: 13 }}>
                <div><strong>Run:</strong> {produced.runId} • <strong>Agente:</strong> {produced.agent}</div>
                <div><strong>Pipeline ({produced.dagStages} etapas):</strong> {produced.dagNames.join(' → ')}</div>
                <div><strong>Título sugerido:</strong> {produced.metadata.title}</div>
                <div><strong>Tags:</strong> {produced.metadata.tags.join(', ')}</div>
              </div>
            )}
          </section>
        )}

        {tab === 'runs' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Produções Registradas ({status?.runs.length ?? 0})</h2>
            <ul>
              {(status?.runs ?? []).map((r) => (
                <li key={r.id} style={{ fontSize: 13, marginBottom: 6 }}>
                  [{r.status}] {r.topic} — agente: {r.agent ?? 'n/a'}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'review' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Revisão Cirúrgica por Prompt</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={revInput} onChange={(e) => setRevInput(e.target.value)} placeholder="Ex: Troque a música da cena 3 para algo mais épico e reduza o ritmo..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #115e59', background: '#042f2e', color: '#fff' }} />
              <button type="button" onClick={() => void handleRevision()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0d9488', color: '#fff' }}>
                Planejar Alteração
              </button>
            </div>
            {revPlan && (
              <div style={{ fontSize: 13 }}>
                <p>{revPlan.summary}</p>
                <p>Operações: {revPlan.affectedStages.join(', ') || 'nenhuma'}</p>
              </div>
            )}
          </section>
        )}

        {tab === 'calendar' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Canais &amp; Calendário Editorial (AETHERA-CHANNEL-01)</h2>
            <p style={{ fontSize: 13, color: '#99f6e4' }}>
              Canais configurados: {(status?.channels ?? []).map((c) => `${c.name} (${c.platform})`).join(', ')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={calendarPrompt} onChange={(e) => setCalendarPrompt(e.target.value)} placeholder="Ex: Planejar 3 vídeos semanais sobre RPGs e Soulslike..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #115e59', background: '#042f2e', color: '#fff' }} />
              <button type="button" onClick={() => void handleCalendar()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#0d9488', color: '#fff' }}>
                Planejar Semana
              </button>
            </div>
            {calendarResult && (
              <div>
                <p style={{ fontSize: 12 }}>Conflitos detectados: {calendarResult.conflicts}</p>
                <ul>
                  {calendarResult.items.map((item) => (
                    <li key={item.id} style={{ fontSize: 13, marginBottom: 4 }}>
                      [{item.status}] {item.title} — {item.scheduledAtIso}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'creative' && <CreativeStudioPanel />}

        {tab === 'ecosystem' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Ferramentas de Mídia &amp; Ecossistema</h2>
            <p style={{ fontSize: 13 }}>
              FFmpeg: {status?.tools.ffmpeg ? 'OK' : 'ausente'} • FFprobe: {status?.tools.ffprobe ? 'OK' : 'ausente'} • yt-dlp:{' '}
              {status?.tools.ytdlp ? 'OK' : 'ausente'}
            </p>
            <p style={{ fontSize: 13, color: '#99f6e4' }}>Loopback API: {status?.baseUrl}</p>
            <h3>Peers Descobertos ({status?.peers.length ?? 0})</h3>
            <ul>
              {(status?.peers ?? []).map((p) => (
                <li key={p.appId} style={{ fontSize: 13 }}>
                  {p.appId} (PID {p.pid}) — {p.baseUrl}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
