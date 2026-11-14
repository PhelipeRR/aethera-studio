import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess, type ProcessLine } from '../src/process-runner.js';

// The fake CLI lives in a folder with a space and an accent: paths like this must just work.
const dir = join(mkdtempSync(join(tmpdir(), 'nb-runner-')), 'pasta com ação');
mkdirSync(dir, { recursive: true });
const fakeCli = join(dir, 'fake-cli.mjs');
copyFileSync(resolve(import.meta.dirname, 'bin/fake-cli.mjs'), fakeCli);

const fake = (args: string[], extra: Partial<Parameters<typeof runProcess>[0]> = {}) =>
  runProcess({ command: process.execPath, args: [fakeCli, ...args], cwd: dir, ...extra });

async function collect(lines: AsyncIterable<ProcessLine>): Promise<ProcessLine[]> {
  const all: ProcessLine[] = [];
  for await (const line of lines) all.push(line);
  return all;
}

function alive(pid: number): boolean {
  const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
  return out.includes(String(pid));
}

describe('runProcess', () => {
  it('feeds the prompt through stdin and yields stdout and stderr lines', async () => {
    const run = fake(['echo-stdin'], { stdin: 'primeira linha\nsegunda — com acento\n' });
    const lines = await collect(run.lines);
    expect(lines.filter((line) => line.stream === 'stdout').map((line) => JSON.parse(line.line).line)).toEqual(['primeira linha', 'segunda — com acento']);
    expect(lines).toContainEqual({ stream: 'stderr', line: 'done reading' });
    expect(await run.result).toMatchObject({ exitCode: 0, timedOut: false, cancelled: false, spawnError: null });
  });

  it('reports the exit code and keeps the end of stderr', async () => {
    const run = fake(['echo-stdin', '3'], { stdin: '' });
    await collect(run.lines);
    expect(await run.result).toMatchObject({ exitCode: 3, stderrTail: 'done reading\n' });
  });

  it('kills the whole process tree on timeout', async () => {
    const run = fake(['tree'], { timeoutMs: 1500 });
    let pids: { pid: number; grandchild: number } | undefined;
    for await (const line of run.lines) pids ??= JSON.parse(line.line);
    const result = await run.result;
    expect(result.timedOut).toBe(true);
    expect(pids && [alive(pids.pid), alive(pids.grandchild)]).toEqual([false, false]);
  });

  it('kills the whole process tree when cancelled', async () => {
    const controller = new AbortController();
    const run = fake(['tree'], { signal: controller.signal });
    let pids: { pid: number; grandchild: number } | undefined;
    for await (const line of run.lines) {
      pids ??= JSON.parse(line.line);
      controller.abort();
    }
    expect(await run.result).toMatchObject({ cancelled: true, timedOut: false });
    expect(pids && [alive(pids.pid), alive(pids.grandchild)]).toEqual([false, false]);
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = fake(['tree'], { signal: controller.signal });
    expect(await collect(run.lines)).toEqual([]);
    expect(await run.result).toMatchObject({ cancelled: true, exitCode: null });
  });

  it('reports a missing executable instead of throwing', async () => {
    const run = runProcess({ command: join(dir, 'does-not-exist.exe'), args: [], cwd: dir });
    expect(await collect(run.lines)).toEqual([]);
    expect((await run.result).spawnError).toMatch(/ENOENT/);
  });

  it('streams 50 MB with a bounded queue and writes everything to the log file', { timeout: 60_000 }, async () => {
    const logFile = join(dir, 'logs', 'flood.log');
    const run = fake(['flood', '50'], { logFile, highWaterMark: 500 });
    let count = 0;
    let last = '';
    for await (const line of run.lines) {
      count++;
      last = line.line;
      if (count % 5000 === 0) await new Promise((r) => setTimeout(r, 5)); // a slow consumer
    }
    const result = await run.result;
    const expected = JSON.parse(last).lines as number;
    expect(count).toBe(expected + 1);
    expect(result.maxQueued).toBeLessThan(5000);
    expect(readFileSync(logFile, 'utf8').split('\n').filter(Boolean)).toHaveLength(count);
  });

  it('truncates absurdly long lines and keeps going', async () => {
    const run = fake(['giant-line'], { maxLineLength: 1024 * 1024 });
    const lines = await collect(run.lines);
    expect(lines.map((line) => line.line.length)).toEqual([1024 * 1024, '{"type":"after"}'.length]);
    expect((await run.result).truncatedLines).toBe(1);
  });

  it('never writes secrets to the log file', async () => {
    const logFile = join(dir, 'logs', 'secret.log');
    const run = fake(['secret'], { logFile });
    await collect(run.lines);
    await run.result;
    const log = readFileSync(logFile, 'utf8');
    expect(log).not.toMatch(/abcdefghijklmnopqrstuvwxyz/);
    expect(log).toContain('and plain text');
  });
});
