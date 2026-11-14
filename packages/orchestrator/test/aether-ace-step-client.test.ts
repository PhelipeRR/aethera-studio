import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AceStepLocalClient, aceStepCacheKey, aceStepInstrumentalRequest, defaultAceStepConfig } from '../src/aether/ace-step-client.js';

const roots: string[] = [];
const request = { prompt: 'cinematic electronic tension, instrumental, dynamic drums', durationMs: 10_000, bpm: 120, seed: 42, audioFormat: 'wav' as const };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ACE-Step local adapter', () => {
  it('keeps the cache key stable when prompt whitespace changes', () => {
    const config = defaultAceStepConfig();
    expect(aceStepCacheKey(config, request)).toBe(aceStepCacheKey(config, { ...request, prompt: '  cinematic   electronic tension, instrumental, dynamic drums  ' }));
    expect(aceStepCacheKey(config, request)).not.toBe(aceStepCacheKey(config, { ...request, seed: 43 }));
  });

  it('rejects remote endpoints because generation is local-only', () => {
    expect(() => new AceStepLocalClient({ baseUrl: 'https://example.com' })).toThrow(/somente uma API local/iu);
  });

  it('derives genre, emotion and intensity from existing timeline intent', () => {
    const timeline = {
      durationMs: 20_000,
      tracks: [{ items: [{ sceneIds: ['scene-1'], label: 'Combate contra chefe', intent: { reason: 'revelação do chefe' } }] }],
    } as never;
    const generated = aceStepInstrumentalRequest({ timeline, sceneIds: ['scene-1'], genre: 'synthwave', emotion: 'tensão', intensity: 'high', durationMs: 20_000, seed: 7 });
    expect(generated.prompt).toContain('synthwave');
    expect(generated.prompt).toContain('revelação do chefe');
    expect(generated.prompt).toContain('no vocals');
    expect(generated.bpm).toBe(135);
  });

  it('probes, generates, records a manifest and reuses the immutable local cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-ace-step-')); roots.push(root);
    const calls: string[] = [];
    let polls = 0;
    const http = {
      request: async (url: string): Promise<Response> => {
        calls.push(url);
        if (url.endsWith('/health')) return response({ data: { status: 'ok', version: '1.5.0' } });
        if (url.endsWith('/v1/models')) return response({ data: { data: [{ id: 'acestep-v15-turbo' }] } });
        if (url.endsWith('/release_task')) return response({ data: { task_id: 'task-1', status: 'queued' } });
        if (url.endsWith('/query_result')) {
          polls += 1;
          return polls === 1
            ? response({ data: [{ task_id: 'task-1', status: 0, result: '[]' }] })
            : response({ data: [{ task_id: 'task-1', status: 1, result: JSON.stringify([{ file: '/v1/audio?path=generated.wav', metas: { duration: 10, bpm: 120 }, dit_model: 'acestep-v15-turbo', lm_model: 'acestep-5Hz-lm-0.6B' }]) }] });
        }
        if (url.includes('/v1/audio?')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
        return response({ error: 'unexpected' }, 404);
      },
    };
    const client = new AceStepLocalClient({ pollIntervalMs: 1, timeoutMs: 1_000 }, http);
    const generated = await client.generate({ projectRoot: root, timelineId: 'timeline-1', sceneIds: ['scene-1'], request, mood: ['cinematic', 'tension'] });
    expect(generated.cacheHit).toBe(false);
    expect(generated.track.generation).toMatchObject({ providerId: 'ace-step-local', modelId: 'acestep-v15-turbo', lmModelId: 'acestep-5Hz-lm-0.6B', origin: 'local-only', timelineId: 'timeline-1' });
    expect(generated.track.license.scope).toContain('não comercial');
    await expect(stat(generated.path)).resolves.toBeTruthy();
    const manifest = JSON.parse(await readFile(generated.manifestPath, 'utf8')) as { generation: { outputSha256: string }; track: { sha256: string } };
    expect(manifest.generation.outputSha256).toBe(manifest.track.sha256);

    const beforeReuse = calls.length;
    const reused = await client.generate({ projectRoot: root, timelineId: 'timeline-1', sceneIds: ['scene-1'], request, mood: ['cinematic', 'tension'] });
    expect(reused.cacheHit).toBe(true);
    expect(calls.length).toBe(beforeReuse);
  });

  it('accepts a lazily loaded server whose configured model is reported by /health before /v1/models lists it', async () => {
    const http = {
      request: async (url: string): Promise<Response> => url.endsWith('/health')
        ? response({ data: { status: 'ok', models_initialized: false, loaded_model: 'acestep-v15-turbo', loaded_lm_model: null } })
        : response({ object: 'list', data: [] }),
    };
    await expect(new AceStepLocalClient({}, http).probe()).resolves.toMatchObject({ configuredModelAvailable: true, modelIds: [] });
    const other = { request: async (url: string): Promise<Response> => url.endsWith('/health') ? response({ data: { status: 'ok', loaded_model: 'acestep-v15-sft' } }) : response({ object: 'list', data: [] }) };
    await expect(new AceStepLocalClient({}, other).probe()).resolves.toMatchObject({ configuredModelAvailable: false });
  });

  it('blocks traversal and does not write outside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-ace-step-')); roots.push(root);
    const client = new AceStepLocalClient({}, { request: async () => response({}) });
    await expect(client.generate({ projectRoot: root, timelineId: 'timeline-1', sceneIds: [], request, outputRelativePath: '../outside.wav' })).rejects.toThrow(/dentro do projeto/iu);
  });
});
