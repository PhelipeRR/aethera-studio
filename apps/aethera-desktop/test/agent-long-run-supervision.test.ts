import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  captureCommand,
  killAllTrackedProcessTrees,
  normalizeActivityKey,
  trackedProcessTreeCount,
  type AgentActivitySnapshot,
} from '../src/main/production-agent-runner.js';
import {
  detectDefinitiveFailure,
  listActiveAgentRuns,
  resetBackendFailureState,
  runProductionAgentCommand,
  runProductionAgentWithFallback,
  stopActiveAgentRun,
  type AgentExecutionPolicy,
  type ProductionAgentProvider,
  type ProductionAgentStreamFormat,
} from '../src/main/production-agent-providers.js';
import {
  AgentExecutionSettingsStore,
  normalizeAgentExecutionSettings,
  toExecutionPolicy,
} from '../src/main/agent-execution-settings.js';
import { ProductionConsoleService } from '../src/main/production-console.js';

/**
 * Long-run supervision with REAL child processes. Time is compressed (milliseconds stand for minutes) but the
 * mechanics are the production ones: spawn, streams, inactivity clock, tree kill.
 */

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  killAllTrackedProcessTrees();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => resetBackendFailureState());

function node(script: string) {
  return { command: process.execPath, args: ['-e', script] };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function fakeProvider(
  id: ProductionAgentProvider['id'],
  script: string,
  streamFormat: ProductionAgentStreamFormat = 'text',
): ProductionAgentProvider {
  return {
    id,
    label: `Fake ${id}`,
    streamFormat,
    locate: () => ({ command: process.execPath, prefixArgs: ['-e', script] }),
    buildArgs: () => [],
  };
}

function consoleService(): ProductionConsoleService {
  return new ProductionConsoleService({ logsDir: join(makeTempDir('long-run-'), 'logs') });
}

const FAST_POLICY: AgentExecutionPolicy = {
  inactivityTimeoutMs: 700,
  maxDurationMs: null,
  heartbeatIntervalMs: 100,
  silentAfterMs: 150,
  postResultGraceMs: 150,
  killGraceMs: 200,
};

describe('captureCommand — supervisão por atividade', () => {
  it('lets a long healthy run finish: total time far beyond the inactivity window and no fixed limit', async () => {
    // ~1.6 s of steady progress with a 400 ms inactivity window: the old fixed-total model would have killed it.
    const script =
      "let i=0; const t=setInterval(()=>{ process.stdout.write('fonte analisada '+ ['alfa','beta','gama','delta','epsilon','zeta','eta','teta','iota','kapa','lambda','mi','ni','xi','omicron','pi'][i] +'\\n'); if(++i>=16){ clearInterval(t); process.stdout.write('{\"ok\":true}\\n'); process.exit(0);} }, 100);";
    const { command, args } = node(script);
    const result = await captureCommand({ command, args, inactivityTimeoutMs: 400, killGraceMs: 200 });
    expect(result.code).toBe(0);
    expect(result.stalled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(1200);
    expect(result.lastActivity.state).toBe('completed');
    expect(result.stdout).toContain('{"ok":true}');
  });

  it('does not treat a silent period as a hang while it stays inside the inactivity window', async () => {
    const states: AgentActivitySnapshot['state'][] = [];
    const script =
      "process.stdout.write('pensando\\n'); setTimeout(()=>{ process.stdout.write('resposta final\\n'); process.exit(0); }, 700);";
    const { command, args } = node(script);
    const result = await captureCommand({
      command,
      args,
      inactivityTimeoutMs: 1500,
      silentAfterMs: 200,
      heartbeatIntervalMs: 50,
      onActivity: (snapshot) => states.push(snapshot.state),
    });
    expect(result.code).toBe(0);
    expect(result.stalled).toBe(false);
    // The UI saw the agent as "silent / reasoning", not as failed.
    expect(states).toContain('silent');
    expect(states).not.toContain('stalled');
    expect(result.stdout).toContain('resposta final');
  });

  it('confirms a hang when the process stays completely silent for the whole window, and ends it', async () => {
    const { command, args } = node("process.stdout.write('início\\n'); setTimeout(()=>{}, 60000);");
    const result = await captureCommand({ command, args, inactivityTimeoutMs: 500, killGraceMs: 200 });
    expect(result.stalled).toBe(true);
    expect(result.code === 0).toBe(false);
    expect(result.lastActivity.state).toBe('stalled');
    expect(result.durationMs).toBeLessThan(5000);
    expect(result.idleMsAtEnd).toBeGreaterThanOrEqual(450);
  });

  it('does not count repetitive messages without new content as progress', async () => {
    // Endless retry banner: plenty of output, zero progress.
    const script =
      "let n=0; setInterval(()=>{ n++; process.stderr.write('Retrying in '+(n%9)+'s (attempt '+n+')\\n'); }, 40);";
    const { command, args } = node(script);
    const result = await captureCommand({ command, args, inactivityTimeoutMs: 600, killGraceMs: 200 });
    expect(result.stalled).toBe(true);
    expect(result.lastActivity.repeatedEvents).toBeGreaterThan(5);
    expect(result.lastActivity.progressEvents).toBeLessThanOrEqual(1);
    expect(result.lastActivity.lastEventSummary).toContain('Retrying');
  });

  it('normalizes numbers, ids and spinners when comparing activity', () => {
    expect(normalizeActivityKey('⠋ Retrying in 5s (attempt 3)')).toBe(normalizeActivityKey('⠙ Retrying in 9s (attempt 4)'));
    expect(normalizeActivityKey('Lendo fonte A')).not.toBe(normalizeActivityKey('Lendo fonte B'));
  });

  it('applies the optional maximum duration only when it is configured', async () => {
    const script = "let i=0; setInterval(()=>{ process.stdout.write('passo '+String.fromCharCode(65+(i++%26))+'\\n'); }, 30);";
    const { command, args } = node(script);
    const result = await captureCommand({ command, args, inactivityTimeoutMs: 5000, maxDurationMs: 400, killGraceMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.lastActivity.state).toBe('timed_out');
  });

  it('ends the run at once on a definitive error line', async () => {
    const script = "process.stderr.write('API Error: 401 {\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}\\n'); setTimeout(()=>{}, 60000);";
    const { command, args } = node(script);
    const started = Date.now();
    const result = await captureCommand({
      command,
      args,
      inactivityTimeoutMs: 60_000,
      killGraceMs: 200,
      detectFatal: detectDefinitiveFailure,
    });
    expect(result.fatalReason).toContain('invalid x-api-key');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('keeps a run that delivered its result even if the process lingers afterwards (no redo for slowness)', async () => {
    const resultLine = JSON.stringify({ type: 'result', subtype: 'success', result: '{"workTitle":"X","entities":[1]}' });
    const script = `process.stdout.write(${JSON.stringify(resultLine + '\n')}); setTimeout(()=>{}, 60000);`;
    const { command, args } = node(script);
    const result = await captureCommand({
      command,
      args,
      inactivityTimeoutMs: 60_000,
      postResultGraceMs: 150,
      killGraceMs: 200,
      isCompletionLine: (line) => line.text.includes('"type":"result"'),
    });
    expect(result.resultReceived).toBe(true);
    expect(result.completedByResult).toBe(true);
    expect(result.stalled).toBe(false);
    expect(result.lastActivity.state).toBe('completed');
  });
});

describe('cancelamento e subprocessos', () => {
  const GRANDCHILD =
    "const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' }); process.stdout.write('neto ' + c.pid + '\\n'); setTimeout(()=>{}, 60000);";

  it('cancellation ends the process AND its subprocesses', async () => {
    const controller = new AbortController();
    let grandchildPid = 0;
    const { command, args } = node(GRANDCHILD);
    const promise = captureCommand({
      command,
      args,
      inactivityTimeoutMs: 60_000,
      killGraceMs: 300,
      signal: controller.signal,
      onLine: (line) => {
        const match = /neto (\d+)/.exec(line.text);
        if (match) {
          grandchildPid = Number(match[1]);
          controller.abort();
        }
      },
    });
    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(await waitFor(() => !isAlive(grandchildPid))).toBe(true);
    expect(trackedProcessTreeCount()).toBe(0);
  });

  it('a confirmed hang also ends the subprocesses (no orphans after failure)', async () => {
    let grandchildPid = 0;
    const { command, args } = node(GRANDCHILD);
    const result = await captureCommand({
      command,
      args,
      inactivityTimeoutMs: 600,
      killGraceMs: 300,
      onLine: (line) => {
        const match = /neto (\d+)/.exec(line.text);
        if (match) grandchildPid = Number(match[1]);
      },
    });
    expect(result.stalled).toBe(true);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(await waitFor(() => !isAlive(grandchildPid))).toBe(true);
  });

  it('killAllTrackedProcessTrees ends every live agent tree (app shutdown)', async () => {
    const { command, args } = node("process.stdout.write('vivo\\n'); setTimeout(()=>{}, 60000);");
    const promise = captureCommand({ command, args, inactivityTimeoutMs: 60_000, killGraceMs: 200 });
    expect(await waitFor(() => trackedProcessTreeCount() > 0)).toBe(true);
    expect(killAllTrackedProcessTrees()).toBeGreaterThan(0);
    const result = await promise;
    expect(result.code === 0).toBe(false);
  });
});

describe('fallback com agentes reais supervisionados', () => {
  const baseInput = (service: ProductionConsoleService) => ({
    console: service,
    projectId: 'proj_long',
    jobId: 'job_long',
    runId: `run_${Math.random().toString(36).slice(2, 8)}`,
    stage: 'pesquisa' as const,
    label: 'Pesquisa editorial',
    prompt: 'tema',
    execution: FAST_POLICY,
  });

  it('falls back immediately on a definitive auth error, without waiting for the inactivity window', async () => {
    const service = consoleService();
    const broken = fakeProvider('claude-cli', "process.stderr.write('Invalid API key · Please run /login\\n'); setTimeout(()=>{}, 60000);");
    const healthy = fakeProvider('codex-cli', "process.stdout.write('{\"ok\":true}\\n');");
    const started = Date.now();
    const result = await runProductionAgentWithFallback([broken, healthy], {
      ...baseInput(service),
      execution: { ...FAST_POLICY, inactivityTimeoutMs: 60_000 },
    });
    expect(result?.provider.id).toBe('codex-cli');
    expect(result?.outcome.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(8000);
    const retry = service.list('job_long').entries.find((entry) => entry.event === 'stage_retry');
    expect(retry?.details?.failureKind).toBe('auth_failed');
  });

  it('on a confirmed hang, falls back to the next provider', async () => {
    const service = consoleService();
    const hung = fakeProvider('claude-cli', "process.stdout.write('começando\\n'); setTimeout(()=>{}, 60000);");
    const healthy = fakeProvider('codex-cli', "process.stdout.write('{\"ok\":true}\\n');");
    const result = await runProductionAgentWithFallback([hung, healthy], baseInput(service));
    expect(result?.provider.id).toBe('codex-cli');
    const retry = service.list('job_long').entries.find((entry) => entry.event === 'stage_retry');
    expect(retry?.details?.failureKind).toBe('stalled');
  });

  it('on a confirmed hang AFTER a valid result, keeps the intermediate result instead of redoing the task', async () => {
    const service = consoleService();
    const partial = fakeProvider('claude-cli', "process.stdout.write('{\"workTitle\":\"Obra\",\"entities\":[{\"entityName\":\"A\"}]}\\n'); setTimeout(()=>{}, 60000);");
    let secondCalled = false;
    const second: ProductionAgentProvider = {
      ...fakeProvider('codex-cli', "process.stdout.write('outro\\n');"),
      buildArgs: () => {
        secondCalled = true;
        return [];
      },
    };
    const result = await runProductionAgentWithFallback([partial, second], {
      ...baseInput(service),
      acceptPartial: (text) => {
        try {
          return Array.isArray((JSON.parse(text.trim()) as { entities?: unknown[] }).entities);
        } catch {
          return false;
        }
      },
    });
    expect(result?.provider.id).toBe('claude-cli');
    expect(result?.outcome.ok).toBe(true);
    expect(result?.outcome.recoveredPartial).toBe(true);
    expect(secondCalled).toBe(false);
  });

  it('a manual skip ends the agent tree and moves the chain on, without penalizing the backend', async () => {
    const service = consoleService();
    const slow = fakeProvider('claude-cli', "setInterval(()=>process.stdout.write('trabalhando '+Date.now()+Math.random()+'\\n'), 50);");
    const healthy = fakeProvider('codex-cli', "process.stdout.write('{\"ok\":true}\\n');");
    const input = { ...baseInput(service), execution: { ...FAST_POLICY, inactivityTimeoutMs: 60_000 } };
    const promise = runProductionAgentWithFallback([slow, healthy], input);
    expect(await waitFor(() => listActiveAgentRuns('proj_long').some((run) => run.runId === input.runId))).toBe(true);
    expect(stopActiveAgentRun(input.runId, 'skip')).toBe(true);
    const result = await promise;
    expect(result?.provider.id).toBe('codex-cli');
    const retry = service.list('job_long').entries.find((entry) => entry.event === 'stage_retry');
    expect(retry?.details?.failureKind).toBe('skipped');
    expect(listActiveAgentRuns('proj_long')).toHaveLength(0);
  });

  it('cancelling the production stops the chain: no further agent is started', async () => {
    const service = consoleService();
    const controller = new AbortController();
    const slow = fakeProvider('claude-cli', "setInterval(()=>process.stdout.write('x'+Math.random()+'\\n'), 50);");
    let secondCalled = false;
    const second: ProductionAgentProvider = {
      ...fakeProvider('codex-cli', "process.stdout.write('{}\\n');"),
      buildArgs: () => {
        secondCalled = true;
        return [];
      },
    };
    setTimeout(() => controller.abort(), 400);
    const result = await runProductionAgentWithFallback([slow, second], {
      ...baseInput(service),
      execution: { ...FAST_POLICY, inactivityTimeoutMs: 60_000 },
      signal: controller.signal,
    });
    expect(result?.outcome.ok).toBe(false);
    expect(result?.outcome.failureKind).toBe('cancelled');
    expect(secondCalled).toBe(false);
  });

  it('records heartbeats with elapsed time, last event and state in the console', async () => {
    const service = consoleService();
    const provider = fakeProvider(
      'claude-cli',
      "let i=0; const t=setInterval(()=>{ process.stdout.write('etapa '+'abcdefgh'[i]+'\\n'); if(++i>=8){clearInterval(t);process.exit(0);} }, 60);",
    );
    const outcome = await runProductionAgentCommand(provider, baseInput(service));
    expect(outcome.ok).toBe(true);
    const beats = service.list('job_long').entries.filter((entry) => entry.event === 'agent_heartbeat');
    expect(beats.length).toBeGreaterThan(0);
    const last = beats[beats.length - 1];
    expect(typeof last?.details?.elapsedMs).toBe('number');
    expect(last?.details?.state).toBe('completed');
    expect(String(last?.details?.lastEventSummary)).toContain('etapa');
  });

  it('critério de aceite: uma pesquisa de "20 min" saudável termina normalmente (escala 1 min = 60 ms)', async () => {
    const MIN = 60;
    const service = consoleService();
    // Claude stream-json: tool calls spread over 20 "minutes", including two silent 5-"minute" reasoning stretches,
    // then the final result. The old fixed 90 s limit (= 90 ms here) would have killed it in the first "1.5 min".
    const events = [
      { at: 0.5, line: { type: 'system', subtype: 'init', model: 'claude-opus-5-5' } },
      ...Array.from({ length: 6 }, (_, i) => ({
        at: 1 + i,
        line: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { q: `chefe ${i}` } }] } },
      })),
      // 7 → 12: silent reasoning (5 min)
      ...Array.from({ length: 4 }, (_, i) => ({
        at: 12 + i,
        line: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: `https://wiki/${i}` } }] } },
      })),
      // 15 → 19.5: silent reasoning (4.5 min)
      { at: 19.5, line: { type: 'assistant', message: { content: [{ type: 'text', text: 'dossiê pronto' }] } } },
      { at: 20, line: { type: 'result', subtype: 'success', result: '{"workTitle":"Obra","entities":[{"entityName":"A"}]}' } },
    ];
    const script = `const ev=${JSON.stringify(events)}; for (const e of ev) setTimeout(()=>process.stdout.write(JSON.stringify(e.line)+'\\n'), e.at*${MIN}); setTimeout(()=>process.exit(0), 20*${MIN}+30);`;
    const provider = fakeProvider('claude-cli', script, 'claude-stream-json');
    const outcome = await runProductionAgentCommand(provider, {
      ...baseInput(service),
      execution: {
        inactivityTimeoutMs: 10 * MIN, // default 10 min, scaled
        maxDurationMs: null, // default: disabled for editorial work
        heartbeatIntervalMs: MIN,
        silentAfterMs: MIN / 2,
        postResultGraceMs: MIN / 2,
        killGraceMs: 200,
      },
    });
    expect(outcome.failureReason).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(19 * MIN);
    expect(JSON.parse(outcome.text)).toMatchObject({ workTitle: 'Obra' });
    expect(outcome.finalState).toBe('completed');
    const states = service
      .list('job_long')
      .entries.filter((entry) => entry.event === 'agent_heartbeat')
      .map((entry) => entry.details?.state);
    expect(states).toContain('silent');
    expect(states).not.toContain('stalled');
  });

  it('runs without any fixed total limit by default (editorial policy)', async () => {
    const service = consoleService();
    const provider = fakeProvider('codex-cli', "process.stdout.write('ok\\n');");
    const input = { ...baseInput(service) } as Partial<ReturnType<typeof baseInput>>;
    delete input.execution;
    const outcome = await runProductionAgentCommand(provider, input as ReturnType<typeof baseInput>);
    expect(outcome.ok).toBe(true);
    const beat = service.list('job_long').entries.find((entry) => entry.event === 'agent_heartbeat');
    expect(beat?.details?.maxDurationMs).toBeNull();
    expect(beat?.details?.inactivityTimeoutMs).toBe(10 * 60_000);
  });
});

describe('detectDefinitiveFailure', () => {
  it('flags auth, quota and configuration errors on stderr', () => {
    expect(detectDefinitiveFailure({ stream: 'stderr', text: 'Invalid API key · Please run /login' })).toBeTruthy();
    expect(detectDefinitiveFailure({ stream: 'stderr', text: 'Credit balance is too low' })).toBeTruthy();
    expect(detectDefinitiveFailure({ stream: 'stderr', text: "error: unknown option '--foo'" })).toBeTruthy();
  });

  it('ignores the agent answer talking about quota/billing and transient rate limits', () => {
    expect(detectDefinitiveFailure({ stream: 'stdout', text: 'O chefe drena sua quota de mana e billing do jogo' })).toBeNull();
    expect(detectDefinitiveFailure({ stream: 'stderr', text: '429 Too Many Requests, retrying' })).toBeNull();
    expect(detectDefinitiveFailure({ stream: 'stderr', text: 'processando linha 401 do arquivo' })).toBeNull();
  });

  it('reads structured api errors of Claude stream-json', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error_status: 401, error: 'authentication_error' });
    expect(detectDefinitiveFailure({ stream: 'stdout', text: line })).toContain('401');
  });
});

describe('configurações de execução longa', () => {
  it('defaults: 10 min inactivity, no maximum', () => {
    const store = new AgentExecutionSettingsStore(join(makeTempDir('agent-exec-'), 'settings.json'));
    expect(store.load()).toEqual({ inactivityTimeoutMinutes: 10, editorialMaxDurationMinutes: null });
    expect(store.policy().maxDurationMs).toBeNull();
    expect(store.policy().inactivityTimeoutMs).toBe(600_000);
  });

  it('persists, validates and converts to a policy', () => {
    const file = join(makeTempDir('agent-exec-'), 'settings.json');
    const store = new AgentExecutionSettingsStore(file);
    store.save({ inactivityTimeoutMinutes: 15, editorialMaxDurationMinutes: 45 });
    const reloaded = new AgentExecutionSettingsStore(file);
    expect(reloaded.load()).toEqual({ inactivityTimeoutMinutes: 15, editorialMaxDurationMinutes: 45 });
    expect(toExecutionPolicy(reloaded.load())).toMatchObject({ inactivityTimeoutMs: 900_000, maxDurationMs: 2_700_000 });
    expect(normalizeAgentExecutionSettings({ editorialMaxDurationMinutes: '' }).editorialMaxDurationMinutes).toBeNull();
    expect(() => normalizeAgentExecutionSettings({ inactivityTimeoutMinutes: -3 })).toThrow();
  });
});
