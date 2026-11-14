import { describe, expect, it } from 'vitest';
import type { SkillSummary, TaskDetail, TaskEvent, TaskStep } from '@neuralbridge/shared';
import {
  changeSummary,
  elapsedLabel,
  outputKind,
  sessionConnectors,
  sessionContext,
  sessionSkills,
  taskOutputs,
} from '../src/renderer/src/features/tasks/panel-model.js';

let nextEvent = 1;
const event = (kind: string, data: Record<string, unknown>, stepId: string | null = null, at = '2026-10-29T10:00:00.000Z'): TaskEvent => ({ id: nextEvent++, stepId, at, kind, data });
const step = (id: string, agent: 'claude' | 'codex'): TaskStep => ({
  id,
  position: 0,
  agent,
  kind: 'implement',
  status: 'completed',
  tokens: { input: null, output: null, cached: null, costUsd: null },
  filesChanged: [],
  error: null,
  startedAt: null,
  finishedAt: null,
});

function task(id: string, steps: TaskStep[], events: TaskEvent[], extra: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id,
    prompt: `pedido ${id}`,
    projectId: 'p',
    projectName: 'P',
    mode: 'auto',
    status: 'completed',
    parentTaskId: null,
    threadId: 't',
    threadTitle: null,
    model: null,
    summary: null,
    error: null,
    createdAt: '2026-10-29T09:59:00.000Z',
    startedAt: '2026-10-29T10:00:00.000Z',
    finishedAt: '2026-10-29T10:01:00.000Z',
    agents: [...new Set(steps.map((entry) => entry.agent))],
    tokens: { input: 100, output: 20, cached: null, costUsd: null },
    filesChanged: 0,
    images: [],
    steps,
    events,
    executionSnapshot: null,
    ...extra,
  };
}

const skill = (name: string, source: SkillSummary['source'], description = `sobre ${name}`): SkillSummary => ({
  id: `${source}:${name}:${name}`,
  name,
  description,
  valid: true,
  root: `/skills/${source}`,
  path: `/skills/${source}/${name}/SKILL.md`,
  source,
  conflict: false,
  scripts: [],
});

describe('sessionSkills', () => {
  it('never shows an installed or available skill as used', () => {
    const tasks = [task('a', [step('s1', 'claude')], [event('capabilities', { mcpServers: [], skills: ['frontend-design', 'docx'] }, 's1')])];
    const view = sessionSkills(tasks, [skill('frontend-design', 'claude'), skill('playwright', 'codex')]);
    expect(view.active).toEqual([]);
    expect(view.available.map((row) => [row.name, row.agent, row.state])).toEqual([
      ['docx', 'claude', 'available'],
      ['frontend-design', 'claude', 'available'],
    ]);
  });

  // Claude's Read is reported when called, not when it succeeds; the Skill call is its skill evidence.
  it('never takes a use from what the answer says, nor from an unconfirmed Claude Read of a SKILL.md', () => {
    const tasks = [task('a', [step('s1', 'claude')], [event('text', { text: 'Usei a skill frontend-design para isso.' }, 's1'), event('tool', { name: 'Read', summary: 'C:/skills/frontend-design/SKILL.md' }, 's1')])];
    expect(sessionSkills(tasks, [skill('frontend-design', 'claude')]).active).toEqual([]);
  });

  it('counts used activations per agent, with the run, the time and the Skills Manager metadata', () => {
    const tasks = [
      task('a', [step('s1', 'claude')], [event('skill', { name: 'frontend-design', status: 'used', evidence: 'Launching skill: frontend-design' }, 's1', '2026-10-29T10:00:05.000Z')]),
      task('b', [step('s2', 'claude')], [event('skill', { name: 'frontend-design', status: 'used', evidence: 'Launching skill: frontend-design' }, 's2', '2026-10-29T11:00:00.000Z')]),
    ];
    const [row] = sessionSkills(tasks, [skill('frontend-design', 'claude', 'Direção visual')]).active;
    expect(row).toMatchObject({ name: 'frontend-design', agent: 'claude', state: 'used', activations: 2, failures: 0, lastAt: '2026-10-29T11:00:00.000Z', taskId: 'b' });
    expect(row?.listing?.description).toBe('Direção visual');
  });

  it('matches plugin skill names and keeps failures and loads apart from uses', () => {
    const tasks = [
      task(
        'a',
        [step('s1', 'claude'), step('s2', 'codex')],
        [
          event('skill', { name: 'anthropic-skills:docx', status: 'failed', evidence: 'erro' }, 's1'),
          event('skill', { name: 'playwright', status: 'loaded', evidence: 'cat .../SKILL.md' }, 's2'),
        ],
      ),
    ];
    const view = sessionSkills(tasks, [skill('docx', 'plugin'), skill('playwright', 'codex')]);
    expect(view.active.map((row) => [row.name, row.agent, row.state, row.activations, row.failures, row.listing?.name])).toEqual([
      ['anthropic-skills:docx', 'claude', 'failed', 0, 1, 'docx'],
      ['playwright', 'codex', 'loaded', 0, 0, 'playwright'],
    ]);
  });

  it('marks skills NeuralBridge injected into the prompt as loaded for the agents that ran', () => {
    const tasks = [task('a', [step('s1', 'codex')], [event('skills_context', { skills: ['skill://codex:playwright:playwright'], estimatedTokens: 50 })])];
    const [row] = sessionSkills(tasks, [skill('playwright', 'codex')]).active;
    expect(row).toMatchObject({ name: 'playwright', agent: 'codex', state: 'loaded', activations: 0 });
  });

  it('lists installed Codex skills with their use as unknown, since Codex does not report skill use', () => {
    const tasks = [task('a', [step('s1', 'codex')], [])];
    const view = sessionSkills(tasks, [skill('playwright', 'codex'), skill('shared', 'agents'), skill('only-claude', 'claude')]);
    expect(view.available.map((row) => [row.name, row.agent, row.state])).toEqual([
      ['playwright', 'codex', 'unknown'],
      ['shared', 'codex', 'unknown'],
    ]);
    expect(view.unobservable).toEqual(['codex']);
  });
});

describe('sessionContext', () => {
  it('takes the last reported window use per agent and never invents a limit', () => {
    const tasks = [
      task('a', [step('s1', 'claude')], [event('context', { usedTokens: 1000, windowTokens: 200000 }, 's1'), event('context', { usedTokens: 4000, windowTokens: 200000 }, 's1')]),
      task('b', [step('s2', 'codex')], []),
    ];
    expect(sessionContext(tasks)).toEqual({
      agents: [
        { agent: 'claude', usedTokens: 4000, windowTokens: 200000, percent: 2 },
        { agent: 'codex', usedTokens: null, windowTokens: null, percent: null },
      ],
      totalTokens: 240,
      budget: null,
      remaining: null,
    });
  });

  it('gives no percentage when the window is unknown', () => {
    const tasks = [task('a', [step('s1', 'claude')], [event('context', { usedTokens: 1000, windowTokens: null }, 's1')], { tokens: { input: null, output: null, cached: null, costUsd: null } })];
    expect(sessionContext(tasks)).toEqual({ agents: [{ agent: 'claude', usedTokens: 1000, windowTokens: null, percent: null }], totalTokens: null, budget: null, remaining: null });
  });
});

describe('sessionConnectors', () => {
  it('merges the servers a session started with and the MCP tools each agent called', () => {
    const tasks = [
      task(
        'a',
        [step('s1', 'claude'), step('s2', 'codex')],
        [
          event('capabilities', { mcpServers: [{ name: 'neuralbridge', status: 'connected' }], skills: [] }, 's1'),
          event('tool', { name: 'mcp__neuralbridge__brain_search', summary: 'checkout' }, 's1'),
          event('tool', { name: 'mcp__neuralbridge__brain_recall', summary: '' }, 's1'),
          event('tool', { name: 'neuralbridge.brain_search', summary: 'completed' }, 's2'),
          event('tool', { name: 'shell', summary: 'npm test' }, 's2'),
          event('tool', { name: 'Grep', summary: 'TODO' }, 's1'),
        ],
      ),
    ];
    expect(sessionConnectors(tasks)).toEqual([
      { agent: 'claude', name: 'neuralbridge', status: 'connected', calls: 2, tools: ['brain_recall', 'brain_search'] },
      { agent: 'codex', name: 'neuralbridge', status: null, calls: 1, tools: ['brain_search'] },
    ]);
  });
});

describe('taskOutputs', () => {
  it('lists each confirmed file once, with its latest change, relative to the project', () => {
    const t = task('a', [step('s1', 'codex')], [
      event('file_change', { path: 'C:\\proj\\docs\\notes.md', change: 'add' }, 's1'),
      event('file_change', { path: 'C:\\proj\\docs\\notes.md', change: 'update' }, 's1'),
      event('file_change', { path: 'C:\\proj\\src\\app.ts', change: 'update' }, 's1'),
    ]);
    expect(taskOutputs(t, 'C:\\proj')).toEqual([
      { path: 'docs/notes.md', change: 'update', kind: 'markdown' },
      { path: 'src/app.ts', change: 'update', kind: 'code' },
    ]);
  });

  it('keeps a path outside the project absolute', () => {
    const t = task('a', [step('s1', 'claude')], [event('file_change', { path: 'D:\\elsewhere\\x.png', change: 'write' }, 's1')]);
    expect(taskOutputs(t, 'C:\\proj')).toEqual([{ path: 'D:\\elsewhere\\x.png', change: 'write', kind: 'image' }]);
  });

  it('sorts files by kind', () => {
    expect(['a.md', 'b.tsx', 'c.pdf', 'd.webp', 'e.mp4', 'f.bin'].map(outputKind)).toEqual(['markdown', 'code', 'report', 'image', 'video', 'other']);
  });
});

describe('changeSummary', () => {
  it('counts the repository and the files this run changed', () => {
    const summary = changeSummary(
      [
        { path: 'src/app.ts', status: 'modified' },
        { path: 'docs/new.md', status: 'untracked' },
        { path: 'old.txt', status: 'deleted' },
        { path: 'src/other.ts', status: 'added' },
      ],
      [
        { path: 'src/app.ts', added: 10, removed: 2 },
        { path: 'old.txt', added: 0, removed: 5 },
        { path: 'src/other.ts', added: 3, removed: 0 },
      ],
      ['src/app.ts', 'docs/new.md'],
    );
    expect(summary.repository).toEqual({ files: 4, added: 13, removed: 7, created: 2, deleted: 1 });
    expect(summary.run).toEqual({ files: 2, added: 10, removed: 2, created: 1, deleted: 0 });
  });
});

describe('elapsedLabel', () => {
  it('shows the running time of a task from its own timestamps', () => {
    expect(elapsedLabel('2026-10-29T10:00:00.000Z', null, new Date('2026-10-29T10:01:05.000Z'))).toBe('1 min 5 s');
    expect(elapsedLabel('2026-10-29T10:00:00.000Z', '2026-10-29T10:00:09.000Z', new Date())).toBe('9 s');
    expect(elapsedLabel(null, null, new Date())).toBeNull();
  });
});
