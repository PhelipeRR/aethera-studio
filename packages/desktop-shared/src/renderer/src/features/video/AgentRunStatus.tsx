import { useEffect, useState } from 'react';
import {
  AGENT_STATE_COLORS,
  AGENT_STATE_LABELS,
  STAGE_LABELS,
  formatDuration,
  type LiveAgentRun,
} from './production-console-view.js';

interface AgentRunBridge {
  agentRunStop?: (input: { runId: string; mode?: 'skip' | 'cancel' }) => Promise<{ stopped: boolean }>;
  cinemaCancelProduction?: (projectId: string) => Promise<unknown>;
}

function getBridge(): AgentRunBridge | undefined {
  return (window as unknown as { aetheraBridge?: AgentRunBridge }).aetheraBridge;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--console-run-border, #115e59)',
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: 8,
  background: 'var(--console-run-bg, rgba(17, 94, 89, 0.12))',
  fontSize: 11,
  display: 'grid',
  gap: 4,
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--console-run-border, #115e59)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--console-run-accent, #99f6e4)',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = { ...buttonStyle, borderColor: 'var(--console-danger-border, #7f1d1d)', color: 'var(--console-red-text, #fca5a5)' };

/**
 * Live status of the agents running for a production: elapsed time, last event received and state. A long run is
 * expected (research may take many minutes); silence is shown as "raciocinando", not as an error.
 */
export function AgentRunStatus({ runs, projectId }: { runs: LiveAgentRun[]; projectId: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!runs.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runs.length]);

  if (!runs.length) return null;
  const bridge = getBridge();

  const skip = async (run: LiveAgentRun) => {
    if (!bridge?.agentRunStop) return;
    setBusy(run.runId);
    try {
      const res = await bridge.agentRunStop({ runId: run.runId, mode: 'skip' });
      setMessage(res.stopped ? 'Agente encerrado; o próximo provedor da cadeia assume.' : 'O agente já tinha terminado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelProduction = async () => {
    if (!bridge?.cinemaCancelProduction || !projectId) return;
    setBusy('production');
    try {
      await bridge.cinemaCancelProduction(projectId);
      setMessage('Produção cancelada; os processos dos agentes foram encerrados.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-agent-run-status aria-live="polite">
      {runs.map((run) => {
        const elapsed = now - Date.parse(run.startedAt);
        const lastEventAgo = run.lastEventAt ? now - Date.parse(run.lastEventAt) : null;
        const color = AGENT_STATE_COLORS[run.state];
        return (
          <div key={`${run.runId}:${run.source}`} style={cardStyle} data-agent-run={run.runId} data-agent-state={run.state}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color }} aria-hidden>
                ●
              </span>
              <strong style={{ color: 'var(--console-run-title, #ecfdf5)' }}>{run.label}</strong>
              <span style={{ color: 'var(--console-slate, #94a3b8)' }}>{STAGE_LABELS[run.stage] ?? run.stage}</span>
              <span style={{ color, fontWeight: 600 }} data-agent-state-label>
                {AGENT_STATE_LABELS[run.state]}
              </span>
              <span style={{ fontFamily: 'monospace', color: 'var(--console-run-accent, #99f6e4)' }} data-agent-elapsed>
                {formatDuration(elapsed)} decorridos
              </span>
            </div>
            <div style={{ color: 'var(--console-text-soft, #cbd5e1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Último evento:{' '}
              {run.lastEventAt ? (
                <>
                  <span style={{ fontFamily: 'monospace' }}>há {formatDuration(lastEventAgo ?? 0)}</span> —{' '}
                  {run.lastEventSummary ?? '—'}
                </>
              ) : (
                'nenhum evento ainda (agente pode estar raciocinando)'
              )}
            </div>
            <div style={{ color: 'var(--console-slate-dim, #64748b)' }}>
              Encerra só após{' '}
              {run.inactivityTimeoutMs ? formatDuration(run.inactivityTimeoutMs) : '—'} sem progresso real
              {run.maxDurationMs ? ` · limite máximo ${formatDuration(run.maxDurationMs)}` : ' · sem limite máximo'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {bridge?.agentRunStop && (
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={busy !== null}
                  onClick={() => void skip(run)}
                  title="Encerra este agente e seus subprocessos; o próximo provedor da cadeia assume."
                >
                  Pular para o próximo agente
                </button>
              )}
              {bridge?.cinemaCancelProduction && projectId && (
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={busy !== null}
                  onClick={() => void cancelProduction()}
                  title="Cancela a produção e encerra todos os processos dos agentes."
                >
                  Cancelar produção
                </button>
              )}
            </div>
          </div>
        );
      })}
      {message && (
        <div role="status" style={{ fontSize: 11, color: 'var(--console-run-accent, #99f6e4)', marginBottom: 8 }}>
          {message}
        </div>
      )}
    </div>
  );
}
