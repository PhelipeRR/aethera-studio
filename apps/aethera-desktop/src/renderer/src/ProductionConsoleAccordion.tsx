import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ProductionLogEntry {
  id: string;
  timestamp: string;
  projectId: string;
  stage: string;
  severity: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface ConsoleBridge {
  cinemaConsoleList?: (input: {
    projectId: string;
    limit?: number;
    offset?: number;
    severity?: 'info' | 'warn' | 'error' | 'debug';
    stage?: string;
    search?: string;
  }) => Promise<{ entries: ProductionLogEntry[]; total: number }>;
  cinemaConsoleExport?: (input: { projectId: string; format: 'json' | 'txt' }) => Promise<string>;
  cinemaConsoleClear?: (projectId: string) => Promise<{ cleared: boolean; projectId: string }>;
  onCinemaConsoleLog?: (listener: (entry: unknown) => void) => () => void;
}

function getBridge(): ConsoleBridge | undefined {
  return (window as unknown as { aetheraBridge?: ConsoleBridge }).aetheraBridge;
}

type Tab = 'terminal' | 'events' | 'errors';

const SEVERITY_COLORS: Record<string, string> = {
  info: '#5eead4',
  warn: '#fbbf24',
  error: '#f87171',
  debug: '#94a3b8',
};

const STAGE_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  interpretacao: 'Interpretação',
  pesquisa: 'Pesquisa',
  roteiro: 'Roteiro',
  decupagem: 'Decupagem',
  aquisicao: 'Aquisição',
  validacao_visual: 'Validação Visual',
  planejamento: 'Planejamento',
  montagem: 'Montagem',
  audio_sfx_vfx: 'Áudio/SFX/VFX',
  qc: 'Quality Gate',
  previa: 'Prévia',
  renderizacao: 'Renderização',
  editor: 'Editor',
  agent: 'Agente',
  tool: 'Ferramenta',
  download: 'Download',
  narration: 'Narração',
  fallback: 'Fallback',
  system: 'Sistema',
};

export function ProductionConsoleAccordion({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('terminal');
  const [entries, setEntries] = useState<ProductionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 100;

  const loadEntries = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.cinemaConsoleList) return;
    setLoading(true);
    try {
      const severityFilter = tab === 'errors' ? 'error' : undefined;
      const res = await bridge.cinemaConsoleList({
        projectId,
        limit: PAGE_SIZE,
        offset: 0,
        severity: severityFilter,
        search: search.trim() || undefined,
      });
      setEntries(res.entries);
      setTotal(res.total);
    } catch {
      // silent fail — console is observational only
    } finally {
      setLoading(false);
    }
  }, [projectId, tab, search]);

  useEffect(() => {
    if (!open) return;
    void loadEntries();
    const bridge = getBridge();
    if (!bridge?.onCinemaConsoleLog) return;
    const unsub = bridge.onCinemaConsoleLog((raw) => {
      const entry = raw as ProductionLogEntry;
      if (entry.projectId !== projectId) return;
      setEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > PAGE_SIZE) next.splice(0, next.length - PAGE_SIZE);
        return next;
      });
      setTotal((t) => t + 1);
    });
    return unsub;
  }, [open, projectId, loadEntries]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll, open]);

  const filteredEntries = useMemo(() => {
    if (tab === 'events') {
      return entries.filter((e) => ['agent', 'tool', 'download', 'narration', 'fallback'].includes(e.stage));
    }
    return entries;
  }, [entries, tab]);

  const handleCopy = async () => {
    const text = filteredEntries
      .map((e) => `[${e.timestamp}] [${e.severity.toUpperCase()}] [${STAGE_LABELS[e.stage] ?? e.stage}] ${e.source}: ${e.message}${e.durationMs !== undefined ? ` (${e.durationMs}ms)` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard may be blocked
    }
  };

  const handleExport = async (format: 'json' | 'txt') => {
    const bridge = getBridge();
    if (!bridge?.cinemaConsoleExport) return;
    const content = await bridge.cinemaConsoleExport({ projectId, format });
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-${projectId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    const bridge = getBridge();
    if (!bridge?.cinemaConsoleClear) return;
    await bridge.cinemaConsoleClear(projectId);
    setEntries([]);
    setTotal(0);
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'events', label: 'Eventos' },
    { id: 'errors', label: 'Erros' },
  ];

  return (
    <div style={{ marginTop: 8, borderRadius: 6, border: '1px solid #134e4a', background: '#042f2e', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '8px 12px',
          background: open ? '#0d9488' : '#0f3d3a',
          color: '#ecfdf5',
          border: 0,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>🖥️ Console de Produção</span>
        <span style={{ fontSize: 10, opacity: 0.8 }}>{open ? '▲ Fechar' : '▼ Abrir'}</span>
      </button>

      {open && (
        <div style={{ padding: 8 }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: tab === t.id ? 700 : 400,
                  background: tab === t.id ? '#14b8a6' : '#0f3d3a',
                  color: tab === t.id ? '#042f2e' : '#99f6e4',
                }}
              >
                {t.label}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar logs..."
              style={{
                flex: 1,
                minWidth: 120,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #115e59',
                background: '#071110',
                color: '#ecfdf5',
                fontSize: 11,
              }}
            />
            <label style={{ fontSize: 11, color: '#99f6e4', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
            <button type="button" onClick={() => void handleCopy()} style={toolbarBtnStyle}>Copiar</button>
            <button type="button" onClick={() => void handleExport('txt')} style={toolbarBtnStyle}>TXT</button>
            <button type="button" onClick={() => void handleExport('json')} style={toolbarBtnStyle}>JSON</button>
            <button type="button" onClick={() => void handleClear()} style={{ ...toolbarBtnStyle, color: '#f87171' }}>Limpar</button>
          </div>

          {/* Log area */}
          <div
            ref={scrollRef}
            style={{
              height: 260,
              overflowY: 'auto',
              overflowX: 'hidden',
              background: '#071110',
              borderRadius: 4,
              padding: 8,
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {loading && <div style={{ color: '#94a3b8', padding: 4 }}>Carregando logs...</div>}
            {!loading && filteredEntries.length === 0 && (
              <div style={{ color: '#94a3b8', padding: 4 }}>Nenhum log registrado.</div>
            )}
            {filteredEntries.map((entry) => (
              <div key={entry.id} style={{ wordBreak: 'break-word', marginBottom: 2 }}>
                <span style={{ color: '#64748b', marginRight: 6 }}>{entry.timestamp.slice(11, 23)}</span>
                <span
                  style={{
                    color: SEVERITY_COLORS[entry.severity] ?? '#5eead4',
                    fontWeight: 600,
                    marginRight: 6,
                    minWidth: 48,
                    display: 'inline-block',
                  }}
                >
                  [{entry.severity.toUpperCase()}]
                </span>
                <span style={{ color: '#2dd4bf', marginRight: 6 }}>
                  [{STAGE_LABELS[entry.stage] ?? entry.stage}]
                </span>
                <span style={{ color: '#94a3b8', marginRight: 6 }}>{entry.source}:</span>
                <span style={{ color: '#ecfdf5' }}>{entry.message}</span>
                {entry.durationMs !== undefined && (
                  <span style={{ color: '#64748b', marginLeft: 6 }}>({entry.durationMs}ms)</span>
                )}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
            {filteredEntries.length}/{total} entradas • Projeto: {projectId}
          </div>
        </div>
      )}
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #115e59',
  background: '#0f3d3a',
  color: '#99f6e4',
  cursor: 'pointer',
  fontSize: 11,
};