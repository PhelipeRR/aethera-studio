import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, RotateCcw } from 'lucide-react';

interface VisionPriorityAgentItem {
  id: string;
  label: string;
}

interface VisionPriorityView {
  priority: string[];
  defaultPriority: string[];
  agents: VisionPriorityAgentItem[];
  updatedAtIso: string | null;
}

interface VisionPriorityBridge {
  visionPriorityGet?: () => Promise<VisionPriorityView>;
  visionPrioritySave?: (input: { priority: string[] }) => Promise<VisionPriorityView>;
  visionPriorityReset?: () => Promise<VisionPriorityView>;
}

const DEFAULT_AGENTS: VisionPriorityAgentItem[] = [
  { id: 'codex', label: 'Codex CLI' },
  { id: 'antigravity', label: 'Antigravity CLI' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'claude-gateway', label: 'Claude Gateway (Claude Opus 5.5)' },
];

const LABELS_BY_ID: Record<string, string> = Object.fromEntries(DEFAULT_AGENTS.map((a) => [a.id, a.label]));

const bridge = (): VisionPriorityBridge =>
  (window as unknown as { aetheraBridge?: VisionPriorityBridge }).aetheraBridge ?? {};

export function AgentPrioritySettings() {
  const [priority, setPriority] = useState<string[]>(DEFAULT_AGENTS.map((a) => a.id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const available = Boolean(bridge().visionPriorityGet);

  useEffect(() => {
    const b = bridge();
    if (!b.visionPriorityGet) {
      setLoading(false);
      return;
    }
    void b
      .visionPriorityGet()
      .then((view) => {
        if (Array.isArray(view?.priority) && view.priority.length > 0) {
          setPriority(view.priority);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (!available) return null;

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= priority.length) return;
    setPriority((prev) => {
      const next = [...prev];
      const current = next[index]!;
      next[index] = next[target]!;
      next[target] = current;
      return next;
    });
    setStatus(null);
  };

  const handleSave = async () => {
    const b = bridge();
    if (!b.visionPrioritySave) return;
    setSaving(true);
    setStatus(null);
    try {
      const view = await b.visionPrioritySave({ priority });
      setPriority(view.priority);
      setStatus({ tone: 'ok', text: 'Prioridade dos agentes salva e persistida.' });
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : String(error);
      setStatus({ tone: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const b = bridge();
    if (!b.visionPriorityReset) return;
    setSaving(true);
    setStatus(null);
    try {
      const view = await b.visionPriorityReset();
      setPriority(view.priority);
      setStatus({ tone: 'ok', text: 'Ordem padrão restaurada (Claude Gateway como último fallback).' });
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : String(error);
      setStatus({ tone: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-white/5 p-4"
      data-agent-priority-settings
      aria-labelledby="agent-priority-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListOrdered className="size-4 text-primary" aria-hidden />
          <h3 id="agent-priority-heading" className="text-sm font-semibold">
            Prioridade dos agentes
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        >
          <RotateCcw className="size-3" aria-hidden />
          Restaurar padrão
        </button>
      </div>

      <p className="text-muted-foreground">
        Define a ordem de seleção e fallback dos agentes multimodais no VisionRouter. Somente agentes com suporte
        multimodal real, autenticação válida e quota disponível recebem imagens.
      </p>

      <ol className="space-y-2" aria-label="Ordem de prioridade dos agentes multimodais">
        {priority.map((id, index) => {
          const isLast = index === priority.length - 1;
          const label = LABELS_BY_ID[id] ?? id;
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-[#0d0d17] px-3 py-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-[11px] font-semibold text-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{id}</div>
                </div>
                {index === 0 && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Principal
                  </span>
                )}
                {isLast && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    Último fallback
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={loading || saving || index === 0}
                  aria-label={`Mover ${label} para cima`}
                  className="inline-flex size-7 items-center justify-center rounded-lg border border-border bg-white/5 text-foreground hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-35"
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={loading || saving || isLast}
                  aria-label={`Mover ${label} para baixo`}
                  className="inline-flex size-7 items-center justify-center rounded-lg border border-border bg-white/5 text-foreground hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-35"
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar prioridade'}
        </button>
        {status && (
          <span role="status" className={status.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>
            {status.text}
          </span>
        )}
      </div>
    </section>
  );
}
