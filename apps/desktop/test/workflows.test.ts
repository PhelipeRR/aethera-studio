import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, tasks, workflowRuns, type DatabaseHandle } from '@neuralbridge/database';
import { getWorkflowTemplate } from '@neuralbridge/shared';
import { gitDiff, isAllowedValidation, runValidation } from '@neuralbridge/workspace';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowService } from '../src/main/workflows.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;

beforeEach(() => { handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-workflows-')), 'brain.db'), { migrationsFolder: MIGRATIONS }); });
afterEach(() => handle.close());

const definition = { name: 'build', projectId: null, maxParallel: 2, steps: [{ id: 'build', title: 'Build', prompt: 'build', agent: 'auto' as const, mode: 'auto' as const, dependsOn: [], requiresApproval: false }, { id: 'test', title: 'Test', prompt: 'test', agent: 'auto' as const, mode: 'auto' as const, dependsOn: ['build'], requiresApproval: false }] };

/** A service whose tasks finish at once, or stay open, as the engine's would. */
function bound(status: 'completed' | 'running' = 'completed') {
  const service = createWorkflowService({ handle });
  const started: string[] = [];
  const cancelled: string[] = [];
  service.bind({
    startTask: async (input) => {
      const id = `task-${started.length}`;
      started.push(input.prompt);
      handle.db.insert(tasks).values({ id, prompt: input.prompt, projectId: null, mode: input.mode, status }).run();
      return { id };
    },
    cancelTask: (id) => cancelled.push(id),
  });
  return { service, started, cancelled };
}

describe('workflow service', () => {
  it('requires approval and runs dependency layers through the task callback', async () => {
    const { service, started } = bound();
    const saved = service.save(undefined, definition);
    await expect(service.run(saved.id, false)).rejects.toThrow(/aprovação/);
    const run = await service.run(saved.id, true);
    expect(service.runs(saved.id)[0]).toMatchObject({ status: 'completed', currentLayer: 2 });
    expect(handle.db.select({ snapshot: workflowRuns.definitionSnapshot }).from(workflowRuns).where(eq(workflowRuns.id, run.runId)).get()?.snapshot).toContain('schemaVersion');
    expect(started).toEqual(['build', 'test']);
  });

  it('persists pause and resume state without losing the run', async () => {
    const { service, cancelled } = bound('running');
    const first = definition.steps[0];
    if (!first) throw new Error('fixture step missing');
    const saved = service.save(undefined, { ...definition, steps: [first] });
    const run = await service.run(saved.id, true);
    await service.pause(run.runId);
    expect(service.runs(saved.id)[0]?.status).toBe('paused');
    await service.resume(run.runId);
    expect(service.runs(saved.id)[0]?.status).toBe('running');
    await service.cancel(run.runId);
    expect(service.runs(saved.id)[0]?.status).toBe('cancelled');
    expect(cancelled).toEqual(['task-0']);
  });

  it('rejects unknown controls and makes cancellation idempotent', async () => {
    const { service } = bound();
    await expect(service.pause('missing')).rejects.toThrow(/não encontrada/);
    const saved = service.save(undefined, definition);
    handle.db.insert(workflowRuns).values({ id: 'cancelled', workflowId: saved.id, status: 'cancelled', approved: true }).run();
    await expect(service.cancel('cancelled')).resolves.toEqual({ ok: true });
    expect(service.runs(saved.id)[0]?.status).toBe('cancelled');
  });

  it('waits for and records approval per step before starting it', async () => {
    const { service, started } = bound();
    const saved = service.save(undefined, { ...definition, steps: [{ id: 'build', title: 'Build', prompt: 'build', agent: 'auto' as const, mode: 'auto' as const, dependsOn: [], requiresApproval: true }] });
    const run = await service.run(saved.id, true);
    expect(service.runs(saved.id)[0]?.status).toBe('waiting_approval');
    expect(service.steps(run.runId)[0]?.status).toBe('awaiting_approval');
    await service.approveStep(run.runId, 'build');
    expect(started).toEqual(['build']);
    expect(service.runs(saved.id)[0]?.status).toBe('completed');
  });

  it('continues an interrupted execution after a restart', async () => {
    const first = bound('running');
    const saved = first.service.save(undefined, definition);
    const run = await first.service.run(saved.id, true);
    handle.db.update(tasks).set({ status: 'completed', summary: 'pronto' }).where(eq(tasks.id, 'task-0')).run();
    const second = createWorkflowService({ handle });
    const started: string[] = [];
    second.bind({ startTask: async (input) => { started.push(input.prompt); handle.db.insert(tasks).values({ id: 'next', prompt: input.prompt, projectId: null, mode: input.mode, status: 'completed' }).run(); return { id: 'next' }; } });
    await expect(second.recover()).resolves.toBe(1);
    expect(started).toEqual(['test']);
    expect(second.runs(saved.id).find((item) => item.id === run.runId)?.status).toBe('completed');
  });

  it('lists built-in templates and instantiates a validated definition', () => {
    const { service } = bound();
    expect(service.templates().map((template) => template.id)).toHaveLength(9);
    const created = service.instantiateTemplate('bug-fix', null);
    expect(created.definition.schemaVersion).toBe(2);
    expect(created.templateId).toBe('bug-fix');
  });

  it('executes the Automated QA Pipeline with real allow-listed validation commands', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'nb-template-3-')), 'project');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'template-3-fixture', private: true, scripts: { test: 'node -e "console.log(\'unit-ok\')"', 'test:integration': 'node -e "console.log(\'integration-ok\')"', 'test:e2e': 'node -e "console.log(\'e2e-ok\')"' } }));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=template', '-c', 'user.email=template@example.test', 'add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=template', '-c', 'user.email=template@example.test', 'commit', '-q', '-m', 'fixture'], { cwd: root });
    handle.db.insert(projects).values({ id: 'qa', name: 'QA fixture', rootPath: root, rules: '' }).run();
    const template = getWorkflowTemplate('automated-qa');
    if (!template) throw new Error('Template 3 ausente');
    const service = createWorkflowService({ handle });
    const started: string[] = [];
    const native: string[] = [];
    service.bind({
      startTask: async (input) => {
        const id = `qa-task-${started.length}`;
        started.push(input.prompt);
        handle.db.insert(tasks).values({ id, prompt: input.prompt, projectId: input.projectId, mode: input.mode, status: 'completed', summary: 'relatório gerado' }).run();
        return { id };
      },
      executeNative: async (step) => {
        if (step.kind === 'git') { native.push(`git:${step.action}`); return (await gitDiff(root)).text; }
        if (step.kind === 'validation') {
          native.push(step.command);
          if (!isAllowedValidation(step.command)) throw new Error(`comando não permitido: ${step.command}`);
          const result = await runValidation(root, step.command, { timeoutMs: 30_000 });
          if (!result.ok) throw new Error(result.output);
          return result.output;
        }
        throw new Error(`etapa nativa inesperada: ${step.kind}`);
      },
    });
    const saved = service.save(undefined, service.instantiateTemplate('automated-qa', 'qa').definition);
    const run = await service.run(saved.id, true);
    for (let attempt = 0; attempt < 100 && service.runs(saved.id).find((item) => item.id === run.runId)?.status === 'running'; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.runs(saved.id).find((item) => item.id === run.runId)).toMatchObject({ status: 'completed', currentLayer: 5 });
    expect(native).toEqual(['git:diff', 'npm test', 'npm run test:integration', 'npm run test:e2e']);
    expect(started[0]).toContain('unit-ok');
    expect(started[0]).toContain('integration-ok');
    expect(started[0]).toContain('e2e-ok');
    expect(service.steps(run.runId).every((step) => step.status === 'completed')).toBe(true);
  });
});
