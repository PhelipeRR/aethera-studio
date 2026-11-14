import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeetingSession, MeetingUtterance } from '@neuralbridge/shared';
import { SuggestionEngine, type SuggestionModelRequest } from '../src/meeting/suggestion-engine.js';
import { LocalWorkerClient, LocalWorkerError, resolveLocalWorkerCommand, type LocalWorkerCommand, type LocalWorkerOptions } from '../src/local-worker-client.js';

const script = resolve(import.meta.dirname, 'fixtures/fake-local-worker.mjs');
const workerRoot = resolve(import.meta.dirname, '../../local-worker');
const clients: LocalWorkerClient[] = [];
const temps: string[] = [];

function stateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'neura-worker-'));
  temps.push(dir);
  return join(dir, 'starts');
}
const starts = (file: string): { keys: string[] }[] => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { keys: string[] });
const fake = (mode: string, state?: string): LocalWorkerCommand => ({ executable: process.execPath, args: [script], cwd: import.meta.dirname, env: { FAKE_MODE: mode, ...(state ? { FAKE_STATE: state } : {}) } });
function client(command: LocalWorkerCommand | null, options: Partial<LocalWorkerOptions> = {}): LocalWorkerClient {
  const created = new LocalWorkerClient({ command, timeoutMs: 2_000, startupTimeoutMs: 2_000, killGraceMs: 50, ...options });
  clients.push(created);
  return created;
}
const code = (promise: Promise<unknown>): Promise<string> => promise.then(() => 'resolved', (error: unknown) => (error instanceof LocalWorkerError ? error.code : `other: ${String(error)}`));

afterEach(async () => {
  await Promise.all(clients.splice(0).map((item) => item.dispose()));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('LocalWorkerClient', () => {
  it('starts on demand, checks health and correlates responses', async () => {
    const worker = client(fake('uncorrelated'));
    const [long, short] = await Promise.all([worker.detectLanguage({ text: 'long enough text' }), worker.detectLanguage({ text: 'hi' })]);
    expect(long.confidence).toBe(0.9);
    expect(short.confidence).toBe(0.1);
  });

  it('reports unavailable without spawning when no interpreter is configured', async () => {
    const worker = client(null);
    expect(worker.available).toBe(false);
    expect(await code(worker.detectLanguage({ text: 'hello' }))).toBe('unavailable');
  });

  it('fails when the executable does not exist', async () => {
    const worker = client({ ...fake('ok'), executable: join(tmpdir(), 'no-such-python.exe') });
    expect(await code(worker.detectLanguage({ text: 'hello' }))).toBe('unavailable');
  });

  it('treats a health mismatch as unavailable after one restart', async () => {
    const state = stateFile();
    const worker = client(fake('bad_health', state));
    expect(await code(worker.detectLanguage({ text: 'hello' }))).toBe('unavailable');
    expect(starts(state)).toHaveLength(2);
    expect(worker.available).toBe(false);
  });

  it('restarts once after a crash and answers', async () => {
    const state = stateFile();
    const worker = client(fake('crash_once', state));
    expect((await worker.detectLanguage({ text: 'hello there' })).language).toBe('en');
    expect(starts(state)).toHaveLength(2);
  });

  it('retries every in-flight request after one crash with a single restart', async () => {
    const state = stateFile();
    const worker = client(fake('crash_once', state));
    const results = await Promise.all([worker.detectLanguage({ text: 'first text' }), worker.detectLanguage({ text: 'second text' })]);
    expect(results).toHaveLength(2);
    expect(starts(state)).toHaveLength(2);
  });

  it('stops restarting after the second crash so callers can use the model path', async () => {
    const state = stateFile();
    const worker = client(fake('always_crash', state));
    expect(await code(worker.detectLanguage({ text: 'hello there' }))).toBe('unavailable');
    expect(await code(worker.detectLanguage({ text: 'hello there' }))).toBe('unavailable');
    expect(starts(state)).toHaveLength(2);
    expect(worker.available).toBe(false);
  });

  it('times out, cancels the request and kills a worker that ignores it', async () => {
    const state = stateFile();
    const worker = client(fake('hang', state), { timeoutMs: 60 });
    expect(await code(worker.detectLanguage({ text: 'hello there' }))).toBe('timeout');
    await expect.poll(() => worker.running, { timeout: 2_000 }).toBe(false);
  });

  it('keeps a worker that honours the cancel', async () => {
    const worker = client(fake('polite_hang'));
    const controller = new AbortController();
    const pending = worker.detectLanguage({ text: 'hello there' }, { signal: controller.signal });
    await expect.poll(() => worker.running).toBe(true);
    setTimeout(() => controller.abort(), 20);
    expect(await code(pending)).toBe('cancelled');
    await new Promise((done) => { setTimeout(done, 120); });
    expect(worker.running).toBe(true);
  });

  it('rejects an already aborted signal without sending anything', async () => {
    const worker = client(fake('ok'));
    expect(await code(worker.detectLanguage({ text: 'hello' }, { signal: AbortSignal.abort() }))).toBe('cancelled');
    expect(worker.running).toBe(false);
  });

  it('validates the input before it reaches the process', async () => {
    const worker = client(fake('ok'));
    await expect(worker.detectLanguage({ text: 'x'.repeat(4_001) })).rejects.toThrow();
    expect(worker.running).toBe(false);
  });

  it('rejects results outside the contract', async () => {
    expect(await code(client(fake('wrong_shape')).detectLanguage({ text: 'hello' }))).toBe('protocol');
  });

  it('surfaces worker refusals as typed errors', async () => {
    const error = await client(fake('rejected')).detectLanguage({ text: 'hello' }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(LocalWorkerError);
    expect(error).toMatchObject({ code: 'rejected', workerCode: 'invalid_payload' });
  });

  it('treats garbage on stdout as a crash', async () => {
    expect(await code(client(fake('garbage'), { timeoutMs: 500 }).detectLanguage({ text: 'hello' }))).toBe('unavailable');
  });

  it('passes a sanitized environment', async () => {
    const state = stateFile();
    process.env.NEURA_TEST_SECRET = 'do-not-inherit';
    try {
      await client(fake('ok', state)).detectLanguage({ text: 'hello there' });
    } finally {
      delete process.env.NEURA_TEST_SECRET;
    }
    expect(starts(state)[0]?.keys).not.toContain('NEURA_TEST_SECRET');
    expect(starts(state)[0]?.keys).toContain('FAKE_MODE');
  });

  it('stops an idle worker and starts again on the next call', async () => {
    const worker = client(fake('ok'), { idleMs: 30 });
    await worker.detectLanguage({ text: 'hello there' });
    await expect.poll(() => worker.running, { timeout: 2_000 }).toBe(false);
    expect((await worker.detectLanguage({ text: 'hello there' })).language).toBe('en');
  });

  it('rejects pending work on dispose and refuses new work', async () => {
    const worker = client(fake('hang'));
    const pending = code(worker.detectLanguage({ text: 'hello there' }));
    await expect.poll(() => worker.running).toBe(true);
    await worker.dispose();
    expect(await pending).toBe('unavailable');
    expect(await code(worker.detectLanguage({ text: 'hello there' }))).toBe('unavailable');
  });
});

describe('resolveLocalWorkerCommand', () => {
  it('uses only the package venv, never the PATH', () => {
    expect(resolveLocalWorkerCommand({ workerRoot, platform: 'win32', exists: () => false })).toBeNull();
    const command = resolveLocalWorkerCommand({ workerRoot, platform: 'win32', exists: () => true, baseEnv: { SYSTEMROOT: 'C:\\Windows', SECRET: 'x' } });
    expect(command?.executable).toBe(join(workerRoot, '.venv', 'Scripts', 'python.exe'));
    expect(command?.args).toEqual(['-B', '-m', 'neura_worker']);
    expect(command?.env).toMatchObject({ PYTHONPATH: join(workerRoot, 'src'), PYTHONUTF8: '1', SYSTEMROOT: 'C:\\Windows' });
    expect(command?.env).not.toHaveProperty('SECRET');
    expect(resolveLocalWorkerCommand({ workerRoot, platform: 'linux', exists: () => true })?.executable).toBe(join(workerRoot, '.venv', 'bin', 'python'));
  });

  it('can keep the venv apart from read-only worker sources', () => {
    const venvDir = resolve(tmpdir(), 'neura-venv');
    const command = resolveLocalWorkerCommand({ workerRoot, venvDir, platform: 'win32', exists: () => true });
    expect(command?.executable).toBe(join(venvDir, 'Scripts', 'python.exe'));
    expect(command?.cwd).toBe(join(workerRoot, 'src'));
  });

  it('reports no worker when the sources are missing, even with an interpreter', () => {
    expect(resolveLocalWorkerCommand({ workerRoot, platform: 'win32', exists: (path) => path.endsWith('python.exe') })).toBeNull();
  });

  it('accepts a pinned interpreter only as an absolute path', () => {
    expect(resolveLocalWorkerCommand({ workerRoot, pythonPath: 'python', exists: () => true })).toBeNull();
    const pinned = resolve(tmpdir(), 'python.exe');
    expect(resolveLocalWorkerCommand({ workerRoot, pythonPath: pinned, exists: () => true })?.executable).toBe(pinned);
  });
});

const python = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
const pythonPath = python.status === 0 ? python.stdout.trim() : null;

describe.runIf(pythonPath)('real Python worker', () => {
  it('produces an English suggestion for an English meeting', async () => {
    const worker = client(resolveLocalWorkerCommand({ workerRoot, pythonPath: pythonPath ?? '' }));
    const requests: SuggestionModelRequest[] = [];
    const engine = new SuggestionEngine({ worker, model: { generate: (request) => { requests.push(request); return Promise.resolve({ text: 'We expect to ship by Friday.', translation: null, confidence: 0.8 }); } } });
    const at = '2026-11-02T12:00:00.000Z';
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const line = (text: string, n: number): MeetingUtterance => ({ utteranceId: `00000000-0000-4000-8000-00000000000${n}`, sessionId, speaker: 'Dana', text, language: null, languageConfidence: 0, startedAt: at, endedAt: at, final: true });
    const session: MeetingSession = { sessionId, sourceId: 'generic-transcript', platform: 'generic', status: 'degraded', consent: true, capabilities: { transcript: true, audio: false, diarization: false, nativeIntegration: false }, degradations: ['audio_unavailable', 'native_integration_unavailable'], meetingLanguage: null, meetingConfidence: 0, userPreferredLanguage: 'pt-BR', translationEnabled: false, startedAt: at, stoppedAt: null };
    const earlier = line('We should review the budget for this quarter with the team', 1);
    const heard = line('Could you share the timeline with the team?', 2);
    const suggestion = await engine.suggest({ session, utterance: heard, recent: [earlier, heard] });
    expect(suggestion).toMatchObject({ preprocessing: 'local-worker', delivery: 'manual', decision: { responseLanguage: 'en', meetingLanguage: 'en', userPreferredLanguage: 'pt-BR' } });
    expect(requests[0]?.responseLanguage).toBe('en');
  });

  it('runs the three preprocessing operations through the contract', async () => {
    const worker = client(resolveLocalWorkerCommand({ workerRoot, pythonPath: pythonPath ?? '' }));
    expect(await worker.detectLanguage({ text: 'Could you share the timeline with the team?' })).toMatchObject({ language: 'en', mixed: false });
    const segments = [
      { id: '1', speaker: 'Dana', text: '[silence]', startMs: 0, endMs: 10 },
      { id: '2', speaker: 'Dana', text: 'We should review the budget for this quarter', startMs: 10, endMs: 20 },
      { id: '3', speaker: 'Dana', text: 'Você pode revisar o prazo até amanhã?', startMs: 20, endMs: 30 },
    ];
    const window = await worker.filterTranscript({ segments, maxChars: 500, windowMs: 60_000 });
    expect(window.dropped.silence).toBe(1);
    const context = await worker.summarizeWindow({ segments: window.segments, maxRecent: 5 });
    expect(context.questions).toEqual(['Você pode revisar o prazo até amanhã?']);
    expect(await worker.detectSpeech({ pcm16Base64: Buffer.alloc(3_200).toString('base64'), sampleRate: 16_000 })).toMatchObject({ ranges: [], durationMs: 100 });
  });
});
