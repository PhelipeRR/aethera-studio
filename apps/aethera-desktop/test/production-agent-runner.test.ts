import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  captureCommand,
  readClaudeStreamLine,
  ClaudeStreamReader,
  runInstrumentedCommand,
  buildCommandPreview,
  clipLine,
  previewArguments,
} from '../src/main/production-agent-runner.js';
import { ProductionConsoleService } from '../src/main/production-console.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A real child process: node itself, printing to both streams. */
function nodeCommand(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ['-e', script] };
}

describe('captureCommand — streams reais de um processo', () => {
  it('forwards stdout and stderr lines while the process runs and returns the exit code', async () => {
    const lines: Array<{ stream: string; text: string }> = [];
    const script = [
      "process.stdout.write('linha um\\n');",
      "process.stderr.write('aviso real\\n');",
      "setTimeout(() => { process.stdout.write('linha dois\\n'); process.exit(3); }, 30);",
    ].join('');
    const { command, args } = nodeCommand(script);

    const result = await captureCommand({ command, args, onLine: (line) => lines.push({ stream: line.stream, text: line.text }) });

    expect(result.code).toBe(3);
    expect(result.stdout).toContain('linha um');
    expect(result.stdout).toContain('linha dois');
    expect(result.stderr).toContain('aviso real');
    expect(lines.map((line) => `${line.stream}:${line.text}`)).toEqual([
      'stdout:linha um',
      'stderr:aviso real',
      'stdout:linha dois',
    ]);
    expect(result.streamTruncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports timeout and kills the process', async () => {
    const { command, args } = nodeCommand('setTimeout(() => process.exit(0), 5000);');
    const result = await captureCommand({ command, args, timeoutMs: 120 });
    expect(result.timedOut).toBe(true);
    expect(result.code === null || result.code !== 0).toBe(true);
  });

  it('cancels a running process through the abort signal', async () => {
    const controller = new AbortController();
    const { command, args } = nodeCommand('setTimeout(() => process.exit(0), 5000);');
    const promise = captureCommand({ command, args, signal: controller.signal });
    setTimeout(() => controller.abort(), 80);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });

  it('caps streamed lines but keeps capturing the full output', async () => {
    const seen: string[] = [];
    const script = "for (let i = 0; i < 40; i += 1) process.stdout.write('linha ' + i + '\\n');";
    const { command, args } = nodeCommand(script);
    const result = await captureCommand({ command, args, maxStreamedLines: 5, onLine: (line) => seen.push(line.text) });

    expect(seen).toHaveLength(5);
    expect(result.streamTruncated).toBe(true);
    expect(result.lineCount).toBe(40);
    expect(result.stdout.split('\n').filter(Boolean)).toHaveLength(40);
  });

  it('reports a missing executable as a spawn error instead of throwing', async () => {
    const result = await captureCommand({ command: 'binario-que-nao-existe-xyz', args: [] });
    expect(result.spawnError).toBeTruthy();
    expect(result.code).toBeNull();
  });

  it('clips very long lines and previews long arguments', () => {
    expect(clipLine('x'.repeat(10), 4)).toBe('xxxx…(+6 chars)');
    expect(buildCommandPreview('claude', ['-p', 'y'.repeat(300)])).toContain('(+');
  });

  it('masks the value that follows a sensitive flag, with and without the inline form', () => {
    expect(previewArguments(['-p', 'roteiro', '--api-key', 'valor-qualquer', '--password=outro'])).toEqual([
      '-p',
      'roteiro',
      '--api-key',
      '[REDACTED]',
      '--password=[REDACTED]',
    ]);
  });
});

describe('runInstrumentedCommand — console com execução real', () => {
  it('records command, stdout, stderr and result with exit code and duration', async () => {
    const service = new ProductionConsoleService({ logsDir: join(makeTempDir('runner-'), 'logs') });
    const script = "process.stdout.write('saída real\\n'); process.stderr.write('erro real\\n'); process.exit(1);";
    const { command, args } = nodeCommand(script);

    await runInstrumentedCommand({
      console: service,
      projectId: 'job_real',
      jobId: 'job_real',
      runId: 'run_abc',
      stage: 'roteiro',
      origin: 'agent',
      source: 'claude-cli',
      label: 'Roteiro bloco 1',
      command,
      args,
    });

    const entries = service.list('job_real').entries;
    const channels = entries.map((entry) => entry.channel);
    expect(channels).toContain('command');
    expect(channels).toContain('stdout');
    expect(channels).toContain('stderr');
    expect(channels).toContain('result');

    const started = entries.find((entry) => entry.event === 'command_started');
    expect(started?.message).toContain('Roteiro bloco 1');
    expect(started?.runId).toBe('run_abc');
    expect(started?.details?.command).toBe(process.execPath);

    const stdout = entries.find((entry) => entry.channel === 'stdout');
    expect(stdout?.message).toBe('saída real');

    const stderr = entries.find((entry) => entry.channel === 'stderr');
    expect(stderr?.message).toBe('erro real');

    const result = entries.find((entry) => entry.channel === 'result');
    expect(result?.event).toBe('command_failed');
    expect(result?.severity).toBe('error');
    expect(result?.exitCode).toBe(1);
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(String(result?.details?.stderrTail)).toContain('erro real');
    expect(entries.every((entry) => entry.jobId === 'job_real')).toBe(true);
  });

  it('marks a zero exit as a completed command', async () => {
    const service = new ProductionConsoleService({ logsDir: join(makeTempDir('runner-ok-'), 'logs') });
    const { command, args } = nodeCommand("process.stdout.write('ok\\n');");
    await runInstrumentedCommand({
      console: service,
      projectId: 'job_ok',
      runId: 'run_ok',
      stage: 'pesquisa',
      origin: 'agent',
      source: 'codex-cli',
      label: 'Pesquisa editorial',
      command,
      args,
    });
    const result = service.list('job_ok').entries.find((entry) => entry.channel === 'result');
    expect(result?.event).toBe('command_completed');
    expect(result?.severity).toBe('info');
    expect(result?.exitCode).toBe(0);
  });

  it('hides transformed lines from the console without losing the capture', async () => {
    const service = new ProductionConsoleService({ logsDir: join(makeTempDir('runner-transform-'), 'logs') });
    const { command, args } = nodeCommand("process.stdout.write('linha crua\\n');");
    await runInstrumentedCommand({
      console: service,
      projectId: 'job_transform',
      runId: 'run_t',
      stage: 'roteiro',
      origin: 'agent',
      source: 'claude-cli',
      label: 'Roteiro',
      command,
      args,
      transformLine: () => 'linha resumida',
    });
    const messages = service.list('job_transform').entries.map((entry) => entry.message);
    expect(messages).toContain('linha resumida');
    expect(messages).not.toContain('linha crua');
  });
});

describe('leitura do stream-json do Claude Code', () => {
  it('extracts the final answer from the result event', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: '{"beats":[{"summary":"fala"}]}', is_error: false });
    const activity = readClaudeStreamLine(line);
    expect(activity?.finalText).toBe('{"beats":[{"summary":"fala"}]}');
    expect(activity?.text).toContain('resultado do agente');
  });

  it('summarizes tool calls and assistant text into readable lines', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Vou pesquisar o tema.' },
          { type: 'tool_use', name: 'WebSearch', input: { query: 'boss fight' } },
        ],
      },
    });
    const activity = readClaudeStreamLine(line);
    expect(activity?.text).toContain('texto: Vou pesquisar');
    expect(activity?.text).toContain('ferramenta WebSearch');
    expect(activity?.assistantText).toContain('Vou pesquisar o tema.');
  });

  it('returns null for lines that are not JSON events', () => {
    expect(readClaudeStreamLine('aviso do CLI')).toBeNull();
    expect(readClaudeStreamLine('{ nao eh json')).toBeNull();
  });

  it('falls back to assistant text when the run ends without a result event', () => {
    const reader = new ClaudeStreamReader();
    reader.handle(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'parcial' }] } }));
    expect(reader.hasResult).toBe(false);
    expect(reader.finalText('fallback')).toBe('parcial');
  });

  it('prefers the result event over assistant text', () => {
    const reader = new ClaudeStreamReader();
    reader.handle(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'rascunho' }] } }));
    reader.handle(JSON.stringify({ type: 'result', subtype: 'success', result: 'final' }));
    expect(reader.hasResult).toBe(true);
    expect(reader.finalText('fallback')).toBe('final');
  });
});
