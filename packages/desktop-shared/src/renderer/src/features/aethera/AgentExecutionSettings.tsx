import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';

/**
 * Configurações → Agentes e IA → Execução longa.
 *
 * Editorial agents (research, script, planning) have no fixed total timeout: they run while healthy and are ended only
 * after `inactivityTimeoutMinutes` without real progress. An optional ceiling can be set; empty means disabled.
 */
interface AgentExecutionSettingsView {
  inactivityTimeoutMinutes: number;
  editorialMaxDurationMinutes: number | null;
}

interface AgentExecutionBridge {
  agentExecutionGetSettings?: () => Promise<AgentExecutionSettingsView>;
  agentExecutionSaveSettings?: (input: Partial<AgentExecutionSettingsView>) => Promise<AgentExecutionSettingsView>;
}

const bridge = (): AgentExecutionBridge =>
  (window as unknown as { aetheraBridge?: AgentExecutionBridge }).aetheraBridge ?? {};

export function AgentExecutionSettings() {
  const [inactivity, setInactivity] = useState('10');
  const [maxDuration, setMaxDuration] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const available = Boolean(bridge().agentExecutionGetSettings);

  useEffect(() => {
    const b = bridge();
    if (!b.agentExecutionGetSettings) return;
    void b
      .agentExecutionGetSettings()
      .then((view) => {
        setInactivity(String(view.inactivityTimeoutMinutes));
        setMaxDuration(view.editorialMaxDurationMinutes === null ? '' : String(view.editorialMaxDurationMinutes));
      })
      .catch(() => undefined);
  }, []);

  if (!available) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const b = bridge();
    if (!b.agentExecutionSaveSettings) return;
    setSaving(true);
    try {
      const view = await b.agentExecutionSaveSettings({
        inactivityTimeoutMinutes: Number(inactivity),
        editorialMaxDurationMinutes: maxDuration.trim() === '' ? null : Number(maxDuration),
      });
      setInactivity(String(view.inactivityTimeoutMinutes));
      setMaxDuration(view.editorialMaxDurationMinutes === null ? '' : String(view.editorialMaxDurationMinutes));
      setStatus({ tone: 'ok', text: 'Salvo. Vale para as próximas execuções de agentes.' });
    } catch (error) {
      const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : String(error);
      setStatus({ tone: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="space-y-3 rounded-2xl border border-border bg-white/5 p-4"
      data-agent-execution-settings
    >
      <div className="flex items-center gap-2">
        <Timer className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">Execução longa de agentes</h3>
      </div>
      <p className="text-muted-foreground">
        Pesquisa, roteiro e planejamento não têm tempo total fixo: o agente roda enquanto estiver saudável. Ele só é
        encerrado após o período sem progresso real abaixo (silêncio enquanto raciocina não conta como travamento;
        mensagens repetidas sem conteúdo novo também não contam como progresso).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-medium">Timeout de inatividade (minutos)</span>
          <input
            type="number"
            min={1}
            max={180}
            step={1}
            required
            value={inactivity}
            onChange={(event) => setInactivity(event.target.value)}
            className="w-full rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Limite máximo de execução (minutos)</span>
          <input
            type="number"
            min={5}
            max={1440}
            step={1}
            placeholder="Desativado"
            value={maxDuration}
            onChange={(event) => setMaxDuration(event.target.value)}
            className="w-full rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="text-muted-foreground">Vazio = sem limite (padrão para tarefas editoriais).</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar execução longa'}
        </button>
        {status && (
          <span role="status" className={status.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
