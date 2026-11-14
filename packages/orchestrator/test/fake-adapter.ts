import type { AgentAdapter, AgentRunRequest } from '@neuralbridge/agents';
import type { AgentEvent, AgentId, AgentStatus } from '@neuralbridge/shared';

export interface Turn {
  /** Events before the final done (session and usage are added automatically). */
  events?: AgentEvent[];
  /** Structured result (for plan and review steps). */
  structured?: unknown;
  text?: string;
  ok?: boolean;
  /** What a failed run left on stderr; Claude Code leaves nothing for API errors. */
  errorOutput?: string | null;
  /** Side effect in the working folder, e.g. writing a file. */
  act?: (request: AgentRunRequest) => void;
  /** Wait for this many ms (or until cancelled) before finishing. */
  delayMs?: number;
  tokens?: number;
}

/** Scripted agent: each run consumes the next turn; records every request it received. */
export class FakeAdapter implements AgentAdapter {
  readonly requests: AgentRunRequest[] = [];
  readonly signals: AbortSignal[] = [];
  private runs = 0;

  constructor(
    readonly id: AgentId,
    private readonly turns: Turn[] | ((request: AgentRunRequest, index: number) => Turn),
  ) {}

  async detect(): Promise<AgentStatus> {
    throw new Error('not used');
  }

  async *run(request: AgentRunRequest, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const index = this.runs++;
    this.requests.push(request);
    if (signal) this.signals.push(signal);
    const turn = typeof this.turns === 'function' ? this.turns(request, index) : (this.turns[index] ?? { text: 'ok' });
    const sessionId = `${this.id}-session-${index}`;
    yield { kind: 'session', sessionId, model: null };
    for (const event of turn.events ?? []) yield event;
    if (turn.delayMs && !signal?.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, turn.delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (signal?.aborted) {
      yield { kind: 'done', ok: false, exitCode: null, timedOut: false, cancelled: true, sessionId, result: null, errorOutput: null };
      return;
    }
    turn.act?.(request);
    const ok = turn.ok ?? true;
    yield { kind: 'usage', inputTokens: turn.tokens ?? 100, outputTokens: 10, cachedTokens: 0, costUsd: null };
    yield { kind: 'result', text: turn.text ?? JSON.stringify(turn.structured ?? 'ok'), ok, ...(turn.structured !== undefined ? { structured: turn.structured } : {}) };
    yield { kind: 'done', ok, exitCode: ok ? 0 : 1, timedOut: false, cancelled: false, sessionId, result: turn.text ?? null, errorOutput: ok ? null : turn.errorOutput === undefined ? 'agent failed' : turn.errorOutput };
  }
}
