import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, taskEvents, tasks, taskSteps, tokenAnalytics, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenReport } from '../src/token-intelligence.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-tokens-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values([{ id: 'loja', name: 'Loja', rootPath: 'C:\\loja' }, { id: 'blog', name: 'Blog', rootPath: 'C:\\blog' }]).run();
});
afterEach(() => handle.close());

const NOW = new Date('2026-10-29T12:00:00.000Z');
let n = 0;

/** A task as the engine records it: steps, provider-reported usage per step, the context estimate and events. */
function task(input: {
  prompt: string;
  projectId?: string | null;
  status?: 'completed' | 'failed';
  at?: string;
  steps: { agent: 'claude' | 'codex'; kind: 'plan' | 'implement' | 'review' | 'fix'; input: number | null; output: number | null; cached?: number | null }[];
  contextEstimate?: number;
  budget?: number;
  events?: { kind: string; data: Record<string, unknown>; stepIndex?: number }[];
}) {
  const id = `t${++n}`;
  const at = input.at ?? '2026-10-29T10:00:00.000Z';
  handle.db.insert(tasks).values({ id, prompt: input.prompt, projectId: input.projectId ?? null, mode: 'auto', status: input.status ?? 'completed', createdAt: at }).run();
  const stepIds = input.steps.map((step, position) => {
    const stepId = `${id}-s${position}`;
    handle.db.insert(taskSteps).values({ id: stepId, taskId: id, position, agent: step.agent, kind: step.kind, status: 'completed' }).run();
    const reported = step.input !== null || step.output !== null;
    handle.db.insert(tokenAnalytics).values({ taskId: id, stepId, agent: step.agent, reportedInputTokens: reported ? step.input : null, reportedOutputTokens: reported ? step.output : null, cachedTokens: reported ? (step.cached ?? 0) : null, source: 'provider-result', createdAt: at }).run();
    return stepId;
  });
  if (input.contextEstimate !== undefined) handle.db.insert(tokenAnalytics).values({ taskId: id, estimatedContextTokens: input.contextEstimate, source: 'neuralbridge-context', createdAt: at }).run();
  if (input.budget !== undefined) handle.db.insert(taskEvents).values({ taskId: id, kind: 'token_budget', data: JSON.stringify({ configured: input.budget }), at }).run();
  for (const event of input.events ?? []) handle.db.insert(taskEvents).values({ taskId: id, stepId: event.stepIndex === undefined ? null : stepIds[event.stepIndex], kind: event.kind, data: JSON.stringify(event.data), at }).run();
  return id;
}

describe('tokenReport', () => {
  it('adds up what the providers reported per agent, step and project, apart from NeuralBridge estimates', () => {
    task({ prompt: 'Implemente o carrinho', projectId: 'loja', steps: [{ agent: 'claude', kind: 'plan', input: 1000, output: 100, cached: 600 }, { agent: 'codex', kind: 'implement', input: 3000, output: 400 }, { agent: 'claude', kind: 'review', input: 2000, output: 50, cached: 1500 }], contextEstimate: 250 });
    task({ prompt: 'Explique o blog', projectId: 'blog', steps: [{ agent: 'claude', kind: 'plan', input: 500, output: 80, cached: 0 }] });
    task({ prompt: 'Sem métrica', steps: [{ agent: 'codex', kind: 'implement', input: null, output: null }] });
    const report = tokenReport(handle, { since: '2026-10-28T00:00:00.000Z', now: NOW });
    expect(report.totals).toEqual({ input: 6500, output: 630, cached: 2100, estimatedContext: 250, tasks: 3, tasksWithData: 2, tasksWithoutData: 1 });
    expect(report.cacheRate).toBeCloseTo(2100 / 6500);
    expect(report.byAgent).toEqual([
      { key: 'claude', label: 'Claude Code', input: 3500, output: 230, cached: 2100, steps: 3 },
      { key: 'codex', label: 'Codex CLI', input: 3000, output: 400, cached: 0, steps: 1 },
    ]);
    expect(report.byStep.map((row) => [row.key, row.input + row.output, row.steps])).toEqual([
      ['implement', 3400, 1],
      ['review', 2050, 1],
      ['plan', 1680, 2],
    ]);
    expect(report.byProject.map((row) => [row.label, row.input + row.output])).toEqual([
      ['Loja', 6550],
      ['Blog', 580],
    ]);
  });

  it('only counts the period asked for, and says when there is nothing reported', () => {
    task({ prompt: 'Antiga', at: '2026-10-01T10:00:00.000Z', steps: [{ agent: 'claude', kind: 'plan', input: 999, output: 1 }] });
    const report = tokenReport(handle, { since: '2026-10-28T00:00:00.000Z', now: NOW });
    expect(report.totals).toMatchObject({ input: 0, tasks: 0 });
    expect(report.cacheRate).toBeNull();
    expect(report.alerts).toEqual([]);
  });

  it('raises reproducible alerts from real numbers, each with a recommendation', () => {
    // Close to its budget: 1.7M of 2M.
    task({ prompt: 'Refatore tudo', projectId: 'loja', budget: 2_000_000, steps: [{ agent: 'codex', kind: 'implement', input: 1_600_000, output: 100_000, cached: 0 }] });
    // The same request three times: a loop or retries.
    for (let i = 0; i < 3; i++) task({ prompt: '  Corrija o build  ', status: i < 2 ? 'failed' : 'completed', steps: [{ agent: 'claude', kind: 'plan', input: 100, output: 10, cached: 50 }] });
    // A full context window.
    task({ prompt: 'Analise o monorepo', steps: [{ agent: 'claude', kind: 'plan', input: 900, output: 10, cached: 800 }], events: [{ kind: 'context', data: { usedTokens: 180_000, windowTokens: 200_000 }, stepIndex: 0 }] });
    // Reviews rejected twice in a row.
    task({ prompt: 'Implemente o checkout', steps: [{ agent: 'claude', kind: 'review', input: 100, output: 10, cached: 50 }], events: [{ kind: 'review_rejected', data: { round: 1 } }, { kind: 'review_rejected', data: { round: 2 } }] });

    const alerts = tokenReport(handle, { since: '2026-10-28T00:00:00.000Z', now: NOW }).alerts;
    expect(alerts.map((alert) => alert.kind).sort()).toEqual(['budget', 'cache', 'context', 'repeated', 'review_loop']);
    expect(alerts.find((alert) => alert.kind === 'budget')).toMatchObject({ severity: 'warning', message: expect.stringContaining('85%') });
    expect(alerts.find((alert) => alert.kind === 'repeated')).toMatchObject({ message: expect.stringContaining('3 vezes'), taskIds: expect.arrayContaining([expect.any(String)]) });
    expect(alerts.find((alert) => alert.kind === 'context')).toMatchObject({ message: expect.stringContaining('90%') });
    expect(alerts.find((alert) => alert.kind === 'cache')).toMatchObject({ message: expect.stringContaining('Codex CLI') });
    for (const alert of alerts) expect(alert.recommendation.length).toBeGreaterThan(20);
    // Same data, same report.
    expect(tokenReport(handle, { since: '2026-10-28T00:00:00.000Z', now: NOW }).alerts).toEqual(alerts);
  });
});
