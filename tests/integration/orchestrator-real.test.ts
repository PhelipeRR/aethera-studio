import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { openDatabase, projects, taskEvents, tasks, taskSteps } from '@neuralbridge/database';
import { TaskEngine } from '@neuralbridge/orchestrator';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

// Spec acceptance "executar uma tarefa colaborativa" with the real, logged-in CLIs (several requests).
const enabled = process.env['NB_REAL_CLI'] === '1';
const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electron = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;

describe.skipIf(!enabled)('collaborative task with Claude Code and Codex', () => {
  it('Claude plans, Codex implements, Claude reviews, and everything is recorded', { timeout: 1_200_000 }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-orch-real-'));
    const root = join(dataDir, 'calculadora');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), '# Calculadora\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');

    const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: join(desktopDir, 'out/main/migrations') });
    handle.db.insert(projects).values({ id: 'calculadora', name: 'Calculadora', rootPath: root, rules: 'JavaScript CommonJS, sem dependências externas.' }).run();

    const engine = new TaskEngine({
      handle,
      adapters: { claude: new ClaudeCliAdapter(), codex: new CodexCliAdapter() },
      availability: async () => ({ claude: true, codex: true }),
      mcp: (projectId) => ({
        command: electron,
        args: [join(desktopDir, 'out/main/mcp-server.js'), ...(projectId ? ['--project', projectId] : [])],
        env: { ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: dataDir },
        tools: ['brain_search', 'brain_recall', 'brain_links'],
      }),
      limits: { maxIterations: 2, stepTimeoutMs: 8 * 60_000 },
    });
    const statuses: string[] = [];
    engine.on('task', (update) => update.kind === 'status' && statuses.push(update.status));

    const started = Date.now();
    const id = await engine.start({
      prompt:
        'Crie o arquivo math.js exportando a função add(a, b) com module.exports, e um teste math.test.js que usa node:assert para verificar que add(2, 3) é 5 e roda com "node math.test.js". Não instale dependências.',
      projectId: 'calculadora',
      mode: 'collab',
    });
    await engine.idle();

    const task = handle.db.select().from(tasks).where(eq(tasks.id, id)).get();
    const steps = handle.db.select().from(taskSteps).where(eq(taskSteps.taskId, id)).orderBy(asc(taskSteps.position)).all();
    const events = handle.db.select({ kind: taskEvents.kind }).from(taskEvents).where(eq(taskEvents.taskId, id)).all();
    const evidence = {
      status: task?.status,
      error: task?.error,
      durationMs: Date.now() - started,
      statuses,
      steps: steps.map((step) => ({ agent: step.agent, kind: step.kind, status: step.status, inputTokens: step.inputTokens, outputTokens: step.outputTokens, files: step.filesChanged })),
      eventKinds: [...new Set(events.map((event) => event.kind))],
    };
    mkdirSync(resolve(import.meta.dirname, '../.cache'), { recursive: true });
    writeFileSync(resolve(import.meta.dirname, '../.cache/orchestrator-real.json'), JSON.stringify(evidence, null, 2));
    handle.close();

    expect(task?.status, task?.error ?? '').toBe('completed');
    expect(steps.slice(0, 3).map((step) => [step.agent, step.kind])).toEqual([
      ['claude', 'plan'],
      ['codex', 'implement'],
      ['claude', 'review'],
    ]);
    expect(statuses.slice(0, 3)).toEqual(['planning', 'running', 'validating']);
    expect(existsSync(join(root, 'math.js'))).toBe(true);
    expect(execFileSync(process.execPath, ['-e', "console.log(require('./math.js').add(2, 3))"], { cwd: root, encoding: 'utf8' }).trim()).toBe('5');
    expect(evidence.eventKinds).toEqual(expect.arrayContaining(['routed', 'plan', 'session', 'usage', 'diff']));
  });
});
