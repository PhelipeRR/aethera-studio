import { useEffect, useState } from 'react';

interface VoidStatus {
  appId: 'void';
  dbPath: string;
  baseUrl: string;
  agents: string[];
  peers: Array<{ appId: string; pid: number; baseUrl: string }>;
  notifications: Array<{ id: string; priority: string; channel: string; title: string; readAt?: string; createdAt: string }>;
  automations: Array<{ id: string; intervalMs: number; state: string; action?: { kind: string; title?: string } }>;
  accounts: Array<{ id: string; provider: string; email: string; status: string }>;
}

type Tab = 'assistant' | 'notifications' | 'automations' | 'integrations';

declare global {
  interface Window {
    voidBridge?: {
      getStatus: () => Promise<VoidStatus>;
      pushNotification: (input: { title: string; channel?: string }) => Promise<unknown>;
      markRead: (id: string) => Promise<boolean>;
      createAutomation: (input: { title: string; intervalMs?: number }) => Promise<unknown>;
      ask: (input: { prompt: string }) => Promise<{ agent: string; reply: string }>;
    };
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('assistant');
  const [status, setStatus] = useState<VoidStatus | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!window.voidBridge) return;
    setStatus(await window.voidBridge.getStatus());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAddNote = async () => {
    if (!window.voidBridge || !noteTitle.trim()) return;
    await window.voidBridge.pushNotification({ title: noteTitle.trim(), channel: 'reminder' });
    setNoteTitle('');
    await refresh();
  };

  const handleAddAutomation = async () => {
    if (!window.voidBridge || !autoTitle.trim()) return;
    await window.voidBridge.createAutomation({ title: autoTitle.trim() });
    setAutoTitle('');
    await refresh();
  };

  const handleAsk = async () => {
    if (!window.voidBridge || !prompt.trim()) return;
    setError(null);
    try {
      const res = await window.voidBridge.ask({ prompt: prompt.trim() });
      setReply(`[${res.agent}] ${res.reply}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'assistant', label: 'Assistente & Voz' },
    { id: 'notifications', label: 'Memória & Lembretes' },
    { id: 'automations', label: 'Automações' },
    { id: 'integrations', label: 'Integrações & Peers' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0b10', color: '#eef2ff' }}>
      <aside style={{ width: 220, padding: 16, borderRight: '1px solid #1e293b', background: '#0f111a' }}>
        <h1 style={{ fontSize: 16, margin: '0 0 4px' }}>Void</h1>
        <p style={{ fontSize: 11, color: '#a5b4fc', margin: '0 0 16px' }}>Assistente Pessoal • SEP-05</p>
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
                background: tab === t.id ? '#4f46e5' : 'transparent',
                color: tab === t.id ? '#fff' : '#cbd5e1',
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, padding: 24, maxWidth: 920 }}>
        {tab === 'assistant' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Assistente Pessoal (RF-07)</h2>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>
              SQLite: {status?.dbPath} • Agentes: {status?.agents.join(', ') || 'Nenhum'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Pergunte algo ao Void..." style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334155', background: '#111420', color: '#fff' }} />
              <button type="button" onClick={() => void handleAsk()} style={{ padding: '10px 16px', borderRadius: 8, border: 0, background: '#6366f1', color: '#fff' }}>
                Enviar
              </button>
            </div>
            {reply && <p style={{ fontSize: 13, color: '#c7d2fe' }}>{reply}</p>}
            {error && <p style={{ fontSize: 13, color: '#f87171' }}>{error}</p>}
          </section>
        )}

        {tab === 'notifications' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Memória &amp; Lembretes ({status?.notifications.length ?? 0})</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Adicionar lembrete local..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#111420', color: '#fff' }} />
              <button type="button" onClick={() => void handleAddNote()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#4f46e5', color: '#fff' }}>
                Salvar
              </button>
            </div>
            <ul>
              {(status?.notifications ?? []).map((n) => (
                <li key={n.id} style={{ fontSize: 13, marginBottom: 6 }}>
                  [{n.channel}] {n.title} — <em>{n.readAt ? 'lida' : 'não lida'}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'automations' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Automações Pessoais ({status?.automations.length ?? 0})</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={autoTitle} onChange={(e) => setAutoTitle(e.target.value)} placeholder="Ex: Resumir lembretes diários" style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#111420', color: '#fff' }} />
              <button type="button" onClick={() => void handleAddAutomation()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#4f46e5', color: '#fff' }}>
                Criar Regra
              </button>
            </div>
            <ul>
              {(status?.automations ?? []).map((a) => (
                <li key={a.id} style={{ fontSize: 13, marginBottom: 6 }}>
                  [{a.state}] {a.action?.title ?? a.id} ({Math.round(a.intervalMs / 1000)}s)
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'integrations' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Integrações Pessoais &amp; Ecossistema</h2>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Contas OAuth conectadas: {status?.accounts.length ?? 0} (Gmail / Agenda / Spotify via reautenticação explícita)
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>Loopback API: {status?.baseUrl}</p>
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
