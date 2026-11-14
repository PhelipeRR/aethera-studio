import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, taskSteps, tasks, workflowRuns, workflowRunSteps, workflows, workflowStepAttempts, type DatabaseHandle } from '@neuralbridge/database';
import type { WorkflowDefinitionV2, WorkflowStep } from '@neuralbridge/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowCoordinator, type WorkflowCoordinatorPorts } from '../src/workflow-runner.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-runner-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
});
afterEach(() => handle.close());

const agent = (id: string, dependsOn: string[] = [], extra: Partial<Extract<WorkflowStep, { kind: 'agent' }>> = {}): WorkflowStep => ({ id, title: id, kind: 'agent', prompt: `faça ${id}`, agent: 'auto', mode: 'auto', access: 'read-only', dependsOn, requiresApproval: false, ...extra });
const definition = (steps: WorkflowStep[], extra: Partial<WorkflowDefinitionV2> = {}): WorkflowDefinitionV2 => ({ schemaVersion: 2, name: 'teste', projectId: null, maxParallel: 2, inputs: [], steps, ...extra });

/** A host whose tasks stay open until the test finishes them, as the real engine's do. */
function host(extra: Partial<WorkflowCoordinatorPorts> = {}) {
  const started: { id: string; prompt: string; mode: string; access: string | undefined }[] = [];
  const cancelled: string[] = [];
  const paused: string[] = [];
  const timers: (() => void)[] = [];
  const coordinator = createWorkflowCoordinator({
    handle,
    startTask: async (input) => {
      const id = `task-${started.length + 1}`;
      started.push({ id, prompt: input.prompt, mode: input.mode, access: input.access });
      handle.db.insert(tasks).values({ id, prompt: input.prompt, projectId: null, mode: input.mode, status: 'running' }).run();
      return { id };
    },
    cancelTask: (id) => cancelled.push(id),
    pauseTask: (id) => paused.push(id),
    delay: (_ms, run) => timers.push(run),
    random: () => 0.5,
    ...extra,
  });
  const finish = async (id: string, status: 'completed' | 'failed' | 'cancelled', text: string | null = null, files: string[] = []) => {
    handle.db.update(tasks).set({ status, summary: status === 'completed' ? text : null, error: status === 'failed' ? text : null }).where(eq(tasks.id, id)).run();
    handle.db.insert(taskSteps).values({ id: `${id}-step`, taskId: id, position: 0, agent: 'claude', kind: 'implement', status, filesChanged: JSON.stringify(files) }).run();
    await coordinator.onTask(id, status, status === 'failed' ? text : null);
  };
  return { coordinator, started, cancelled, paused, timers, finish };
}

function start(coordinator: ReturnType<typeof createWorkflowCoordinator>, value: WorkflowDefinitionV2, options: Parameters<ReturnType<typeof createWorkflowCoordinator>['start']>[3] = {}) {
  const id = `wf-${Math.random()}`;
  handle.db.insert(workflows).values({ id, name: value.name, projectId: null, definition: JSON.stringify(value) }).run();
  return coordinator.start(id, value, 1, options);
}
const run = (id: string) => handle.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
const steps = (id: string) => Object.fromEntries(handle.db.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, id)).all().map((row) => [row.stepId, row]));

describe('workflow coordinator', () => {
  it('runs a step only after its dependencies, passing the earlier output on', async () => {
    const { coordinator, started, finish } = host();
    const id = await start(coordinator, definition([agent('a'), agent('b', ['a'], { prompt: 'use {{steps.a.output}}' })]));
    expect(started.map((task) => task.prompt)).toEqual(['faça a']);
    await finish('task-1', 'completed', 'resultado de a');
    expect(started[1]?.prompt).toContain('resultado de a');
    await finish('task-2', 'completed', 'fim');
    expect(run(id)).toMatchObject({ status: 'completed' });
  });

  it('does not lose a task that finished before its id was recorded', async () => {
    const { coordinator, started } = host({
      startTask: async (input) => {
        const id = `fast-${started.length}`;
        started.push({ id, prompt: input.prompt, mode: input.mode, access: input.access });
        handle.db.insert(tasks).values({ id, prompt: input.prompt, projectId: null, mode: input.mode, status: 'completed', summary: 'pronto' }).run();
        return { id };
      },
    });
    const id = await start(coordinator, definition([agent('a')]));
    expect(run(id)?.status).toBe('completed');
    expect(steps(id)['a']?.output).toBe('pronto');
  });

  it('approves only the step that was approved', async () => {
    const { coordinator, started } = host();
    const id = await start(coordinator, definition([agent('a', [], { requiresApproval: true }), agent('b', [], { requiresApproval: true })]));
    expect(run(id)?.status).toBe('waiting_approval');
    await coordinator.approve(id, 'b');
    expect(started.map((task) => task.prompt)).toEqual(['faça b']);
    expect(steps(id)['a']?.status).toBe('awaiting_approval');
    expect(run(id)?.status).toBe('waiting_approval');
  });

  it('treats an approval step as done once approved, and cancels the run when rejected', async () => {
    const { coordinator, started } = host();
    const approved = await start(coordinator, definition([{ id: 'ok', title: 'ok', kind: 'approval', message: 'Segue?', dependsOn: [], requiresApproval: false }, agent('a', ['ok'])]));
    await coordinator.approve(approved, 'ok');
    expect(started).toHaveLength(1);
    const rejected = await start(coordinator, definition([{ id: 'no', title: 'no', kind: 'approval', message: 'Segue?', dependsOn: [], requiresApproval: false }]));
    await coordinator.reject(rejected, 'no');
    expect(run(rejected)?.status).toBe('cancelled');
  });

  it('stops the run when the reported tokens pass the limit, without starting the next step', async () => {
    const { coordinator, started, finish } = host();
    const id = await start(coordinator, definition([agent('a'), agent('b', ['a'])], { limits: { maxTokens: 100 } }));
    handle.db.insert(taskSteps).values({ id: 'usage', taskId: 'task-1', position: 1, agent: 'claude', kind: 'implement', status: 'completed', inputTokens: 90, outputTokens: 20 }).run();
    await finish('task-1', 'completed', 'ok');
    expect(run(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('limite de tokens') });
    expect(started).toHaveLength(1);
  });

  it('keeps going when the provider reports no usage or stays under the limit', async () => {
    const { coordinator, started, finish } = host();
    await start(coordinator, definition([agent('a'), agent('b', ['a'])], { limits: { maxTokens: 100 } }));
    await finish('task-1', 'completed', 'ok');
    expect(started).toHaveLength(2);
  });

  it('stops a step whose required skill is missing, and never treats an unknown state as available', async () => {
    const step = agent('a', [], { requiredSkillIds: ['falta'], skillIds: ['opcional'] });
    const missing = host({ missingSkills: async (ids) => [...ids] });
    const stopped = await start(missing.coordinator, definition([step]));
    expect(missing.started).toHaveLength(0);
    expect(run(stopped)?.status).toBe('failed');
    const unknown = host();
    await start(unknown.coordinator, definition([step]));
    expect(unknown.started).toHaveLength(0);
  });

  it('runs with required and optional skills when they are available', async () => {
    const available = host({ missingSkills: async () => [] });

    await start(available.coordinator, definition([agent('a', [], { requiredSkillIds: ['base'], skillIds: ['opcional'] })]));
    expect(available.started).toHaveLength(1);
  });

  it('never times out while waiting for a person', async () => {
    const { coordinator } = host();
    const id = await start(coordinator, definition([agent('a', [], { requiresApproval: true })], { limits: { maxDurationMs: 1 } }));
    await new Promise((done) => setTimeout(done, 5));
    await coordinator.advance(id);
    expect(run(id)?.status).toBe('waiting_approval');
  });

  it('cancels and pauses the tasks of the run, not only its record', async () => {
    const { coordinator, cancelled, paused } = host();
    const id = await start(coordinator, definition([agent('a'), agent('b')]));
    await coordinator.pause(id);
    expect(paused).toEqual(['task-1', 'task-2']);
    await coordinator.cancel(id);
    expect(cancelled).toEqual(['task-1', 'task-2']);
    expect(run(id)?.status).toBe('cancelled');
  });

  it('stops the others when a step fails for good', async () => {
    const { coordinator, cancelled, finish } = host();
    const id = await start(coordinator, definition([agent('a'), agent('b')]));
    await finish('task-1', 'failed', 'erro de execução');
    expect(run(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('erro de execução') });
    expect(cancelled).toEqual(['task-2']);
  });

  it('retries a temporary failure with backoff, recording the attempt', async () => {
    const { coordinator, started, timers, finish } = host();
    const id = await start(coordinator, definition([agent('a')]));
    await finish('task-1', 'failed', 'API Error: 529 Overloaded.');
    expect(run(id)?.status).toBe('retrying');
    expect(started).toHaveLength(1);
    timers[0]?.();
    await coordinator.advance(id);
    expect(started).toHaveLength(2);
    const attempts = handle.db.select().from(workflowStepAttempts).where(eq(workflowStepAttempts.runId, id)).all();
    expect(attempts.map((attempt) => [attempt.attempt, attempt.failureKind, attempt.decision])).toEqual([[1, 'provider_overloaded', 'retry'], [2, null, 'started']]);
  });

  it('falls back to the other agent when the policy says so', async () => {
    const { coordinator, started, finish } = host();
    const recovery = { fallback: { to: 'codex' as const, on: ['usage_limit' as const], allowEdit: false } };
    await start(coordinator, definition([agent('a', [], { agent: 'claude', recovery })]));
    await finish('task-1', 'failed', 'usage limit reached');
    expect(started.map((task) => task.mode)).toEqual(['claude', 'codex']);
  });

  it('asks a person instead of repeating an edit that changed files', async () => {
    const { coordinator, started, timers, finish } = host();
    const id = await start(coordinator, definition([agent('a', [], { access: 'edit' })], { projectId: 'p' }));
    await finish('task-1', 'failed', 'API Error: 529 Overloaded.', ['src/a.ts']);
    expect(run(id)?.status).toBe('interrupted');
    expect(steps(id)['a']?.status).toBe('needs_decision');
    expect(timers).toHaveLength(0);
    await coordinator.decide(id, 'a', 'retry');
    expect(started).toHaveLength(2);
  });

  it('skips the branch of a false condition and finishes', async () => {
    const { coordinator, started, finish } = host();
    const id = await start(coordinator, definition([agent('a'), { id: 'c', title: 'c', kind: 'condition', when: { step: 'a', contains: 'NAO' }, dependsOn: ['a'], requiresApproval: false }, agent('b', ['c'])]));
    await finish('task-1', 'completed', 'tudo certo');
    expect(steps(id)['c']?.status).toBe('skipped');
    expect(steps(id)['b']?.status).toBe('skipped');
    expect(started).toHaveLength(1);
    expect(run(id)?.status).toBe('completed');
  });

  it('asks before any editing step of a run started by an automation', async () => {
    const { coordinator, started } = host();
    const id = await start(coordinator, definition([agent('a', [], { access: 'edit' })], { projectId: 'p' }), { trigger: { kind: 'commit', ref: 'refs/heads/main', hash: 'abc' } });
    expect(started).toHaveLength(0);
    expect(steps(id)['a']?.status).toBe('awaiting_approval');
  });

  it('runs native steps through the host with the outputs so far', async () => {
    const seen: string[] = [];
    const { coordinator, finish } = host({ executeNative: async (step, context) => { seen.push(`${step.kind}:${context.outputs['a'] as string}`); return 'relatório'; } });
    const id = await start(coordinator, definition([agent('a'), { id: 'v', title: 'v', kind: 'validation', command: 'npm test', dependsOn: ['a'], requiresApproval: false }]));
    await finish('task-1', 'completed', 'feito');
    await coordinator.settled(id);
    expect(seen).toEqual(['validation:feito']);
    expect(steps(id)['v']?.output).toBe('relatório');
    expect(run(id)?.status).toBe('completed');
  });

  it('fails instead of pretending when a native step has no executor', async () => {
    const { coordinator } = host();
    const id = await start(coordinator, definition([{ id: 'r', title: 'r', kind: 'rag', query: 'x', topK: 3, dependsOn: [], requiresApproval: false }]));
    await coordinator.settled(id);
    expect(run(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('rag') });
  });

  describe('after a restart', () => {
    const interrupted = async (value: WorkflowDefinitionV2) => {
      const first = host();
      const id = await start(first.coordinator, value);
      return { id, first };
    };

    it('continues the next step of a finished one, without repeating it', async () => {
      const { id } = await interrupted(definition([agent('a'), agent('b', ['a'])]));
      handle.db.update(tasks).set({ status: 'completed', summary: 'antes de fechar' }).where(eq(tasks.id, 'task-1')).run();
      const second = host({ startTask: async (input) => { second.started.push({ id: 'novo', prompt: input.prompt, mode: input.mode, access: input.access }); handle.db.insert(tasks).values({ id: 'novo', prompt: input.prompt, projectId: null, mode: input.mode, status: 'running' }).run(); return { id: 'novo' }; } });
      expect(await second.coordinator.recover()).toBe(1);
      expect(second.started.map((task) => task.prompt)).toEqual([expect.stringContaining('faça b')]);
      expect(steps(id)['a']?.output).toBe('antes de fechar');
    });

    it('repeats an interrupted read-only step when the workflow allows it', async () => {
      const { id } = await interrupted(definition([agent('a')], { recovery: { autoResume: true } }));
      handle.db.update(tasks).set({ status: 'failed' }).where(eq(tasks.id, 'task-1')).run();
      const second = host({ startTask: async () => ({ id: 'repetida' }) });
      await second.coordinator.recover();
      expect(run(id)?.status).toBe('running');
      expect(steps(id)['a']?.taskId).toBe('repetida');
    });

    it('asks before touching an interrupted edit', async () => {
      const { id } = await interrupted(definition([agent('a', [], { access: 'edit' })], { projectId: 'p', recovery: { autoResume: true } }));
      handle.db.update(tasks).set({ status: 'failed' }).where(eq(tasks.id, 'task-1')).run();
      const second = host();
      await second.coordinator.recover();
      expect(run(id)?.status).toBe('interrupted');
      expect(steps(id)['a']?.status).toBe('needs_decision');
      expect(second.started).toHaveLength(0);
    });

    it('keeps a pending approval and uses the definition of when it started', async () => {
      const { id } = await interrupted(definition([agent('a', [], { requiresApproval: true })]));
      const second = host();
      await second.coordinator.recover();
      expect(run(id)?.status).toBe('waiting_approval');
      await second.coordinator.approve(id, 'a');
      expect(second.started.map((task) => task.prompt)).toEqual(['faça a']);
    });

    it('starts a step once even when asked twice at the same time', async () => {
      const { id } = await interrupted(definition([agent('a'), agent('b', ['a'])]));
      handle.db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, 'task-1')).run();
      const second = host();
      await Promise.all([second.coordinator.recover(), second.coordinator.advance(id), second.coordinator.advance(id)]);
      expect(second.started).toHaveLength(1);
    });
  });
});
