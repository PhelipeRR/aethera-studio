import { useEffect, useState } from 'react';

interface OrchestratorStatus {
  appId: 'orchestrator';
  dbPath: string;
  baseUrl: string;
  agents: string[];
  tasks: Array<{ id: string; prompt: string; agent: string; status: string; createdAt: string }>;
  memories: Array<{ id: string; title: string; type: string; updatedAt: string }>;
  skills: Array<{ id: string; name: string; source: string; description: string }>;
  projects: Array<{ id: string; name: string; rootPath: string }>;
  workflows: Array<{ id: string; goal: string; status: string; createdAt: string }>;
  telemetry: { platform: string; cpus: number; freeMemMb: number; totalMemMb: number; uptimeSec: number; rssMb: number };
  peers: Array<{ appId: string; pid: number; baseUrl: string; capabilities: readonly string[] }>;
}

type Tab = 'dashboard' | 'tasks' | 'memory' | 'skills' | 'workflows' | 'monitoring' | 'ecosystem';

declare global {
  interface Window {
    orchestratorBridge?: {
      getStatus: () => Promise<OrchestratorStatus>;
      createTask: (input: { prompt: string }) => Promise<{ id: string; agent: string; status: string }>;
      rememberMemory: (input: { title: string; content: string }) => Promise<{ id: string; title: string }>;
      searchMemory: (query: string) => Promise<Array<{ id: string; title: string; snippet: string }>>;
      createWorkflow: (goal: string) => Promise<{ id: string; goal: string; status: string }>;
      pairPeer: (targetApp: 'aethera' | 'void') => Promise<{ tokenId: string; secret: string }>;
    };
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [memTitle, setMemTitle] = useState('');
  const [memContent, setMemContent] = useState('');
  const [memQuery, setMemQuery] = useState('');
  const [searchHits, setSearchHits] = useState<Array<{ id: string; title: string; snippet: string }>>([]);
  const [workflowGoal, setWorkflowGoal] = useState('');
  const [pairInfo, setPairInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!window.orchestratorBridge) return;
    setStatus(await window.orchestratorBridge.getStatus());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tasks', label: 'Tarefas & Agentes' },
    { id: 'memory', label: 'Brain / RAG' },
    { id: 'skills', label: 'Skills & Projetos' },
    { id: 'workflows', label: 'Workflows' },
    { id: 'monitoring', label: 'Monitoramento' },
    { id: 'ecosystem', label: 'Ecossistema & MCP' },
  ];

  const handleCreateTask = async () => {
    if (!window.orchestratorBridge || !taskPrompt.trim()) return;
    setError(null);
    try {
      await window.orchestratorBridge.createTask({ prompt: taskPrompt.trim() });
      setTaskPrompt('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemember = async () => {
    if (!window.orchestratorBridge || !memTitle.trim() || !memContent.trim()) return;
    await window.orchestratorBridge.rememberMemory({ title: memTitle.trim(), content: memContent.trim() });
    setMemTitle('');
    setMemContent('');
    await refresh();
  };

  const handleSearchMem = async () => {
    if (!window.orchestratorBridge || !memQuery.trim()) return;
    setSearchHits(await window.orchestratorBridge.searchMemory(memQuery.trim()));
  };

  const handleCreateWorkflow = async () => {
    if (!window.orchestratorBridge || !workflowGoal.trim()) return;
    await window.orchestratorBridge.createWorkflow(workflowGoal.trim());
    setWorkflowGoal('');
    await refresh();
  };

  const handlePair = async (target: 'aethera' | 'void') => {
    if (!window.orchestratorBridge) return;
    const tok = await window.orchestratorBridge.pairPeer(target);
    setPairInfo(`Token emitido para ${target}: ${tok.tokenId}`);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#090d16', color: '#e2e8f0' }}>
      <aside style={{ width: 220, padding: 16, borderRight: '1px solid #1e293b', background: '#0d1320' }}>
        <h1 style={{ fontSize: 16, margin: '0 0 4px' }}>Singularity Orchestrator</h1>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 16px' }}>Standalone Core • RF-07</p>
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
                background: tab === t.id ? '#1d4ed8' : 'transparent',
                color: tab === t.id ? '#fff' : '#cbd5e1',
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

        {tab === 'dashboard' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Dashboard Operacional</h2>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>SQLite privado: {status?.dbPath}</p>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Agentes ativos (RF-07): {status?.agents.length ? status.agents.join(', ') : 'Nenhum detectado'}
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Memórias no Brain: {status?.memories.length ?? 0} • Skills: {status?.skills.length ?? 0} • Workflows:{' '}
              {status?.workflows.length ?? 0}
            </p>
          </section>
        )}

        {tab === 'tasks' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Tarefas &amp; Roteamento RF-07</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                placeholder="Descreva a tarefa para o orquestrador..."
                style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <button type="button" onClick={() => void handleCreateTask()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff' }}>
                Criar Tarefa
              </button>
            </div>
            <ul>
              {(status?.tasks ?? []).map((t) => (
                <li key={t.id} style={{ marginBottom: 6, fontSize: 13 }}>
                  [{t.agent}] ({t.status}) {t.prompt}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'memory' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Neural Brain &amp; RAG</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <input value={memTitle} onChange={(e) => setMemTitle(e.target.value)} placeholder="Título da memória" style={{ padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#fff' }} />
              <textarea value={memContent} onChange={(e) => setMemContent(e.target.value)} placeholder="Conteúdo técnico ou decisão..." rows={3} style={{ padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#fff' }} />
              <button type="button" onClick={() => void handleRemember()} style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff' }}>
                Salvar no Brain
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={memQuery} onChange={(e) => setMemQuery(e.target.value)} placeholder="Buscar memórias (FTS5)..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#fff' }} />
              <button type="button" onClick={() => void handleSearchMem()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#334155', color: '#fff' }}>
                Buscar
              </button>
            </div>
            {searchHits.length > 0 && (
              <ul>
                {searchHits.map((h) => (
                  <li key={h.id} style={{ fontSize: 13, marginBottom: 4 }}>
                    <strong>{h.title}</strong>: {h.snippet}
                  </li>
                ))}
              </ul>
            )}
            <ul>
              {(status?.memories ?? []).map((m) => (
                <li key={m.id} style={{ fontSize: 13, marginBottom: 4 }}>
                  [{m.type}] {m.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'skills' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Skills ({status?.skills.length ?? 0}) &amp; Projetos ({status?.projects.length ?? 0})</h2>
            <ul>
              {(status?.skills ?? []).map((s) => (
                <li key={s.id} style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{s.name}</strong> ({s.source}) — {s.description}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'workflows' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Workflows &amp; Missões Autônomas</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={workflowGoal} onChange={(e) => setWorkflowGoal(e.target.value)} placeholder="Objetivo do workflow..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#fff' }} />
              <button type="button" onClick={() => void handleCreateWorkflow()} style={{ padding: '8px 14px', borderRadius: 6, border: 0, background: '#2563eb', color: '#fff' }}>
                Registrar Workflow
              </button>
            </div>
            <ul>
              {(status?.workflows ?? []).map((w) => (
                <li key={w.id} style={{ fontSize: 13, marginBottom: 6 }}>
                  [{w.status}] {w.goal}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'monitoring' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Monitoramento em Tempo Real</h2>
            <p style={{ fontSize: 13 }}>Plataforma: {status?.telemetry.platform}</p>
            <p style={{ fontSize: 13 }}>CPUs: {status?.telemetry.cpus}</p>
            <p style={{ fontSize: 13 }}>
              RAM livre / total: {status?.telemetry.freeMemMb} MB / {status?.telemetry.totalMemMb} MB
            </p>
            <p style={{ fontSize: 13 }}>RSS do processo: {status?.telemetry.rssMb} MB • Uptime: {status?.telemetry.uptimeSec}s</p>
          </section>
        )}

        {tab === 'ecosystem' && (
          <section>
            <h2 style={{ marginTop: 0 }}>Ecossistema, MCP &amp; Pareamento</h2>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>Endpoint loopback: {status?.baseUrl}</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" onClick={() => void handlePair('aethera')} style={{ padding: '8px 12px', borderRadius: 6, border: 0, background: '#0d9488', color: '#fff' }}>
                Parear Aethera Studio
              </button>
              <button type="button" onClick={() => void handlePair('void')} style={{ padding: '8px 12px', borderRadius: 6, border: 0, background: '#6366f1', color: '#fff' }}>
                Parear Void
              </button>
            </div>
            {pairInfo && <p style={{ fontSize: 13, color: '#34d399' }}>{pairInfo}</p>}
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
