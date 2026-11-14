import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVoiceStudioClient, generateVoiceStudioNarration, loadNarrationSidecar, previewNarration, saveNarrationTimeline, selectNarrationAsset } from '../src/velix-narration.js';

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00', 'binary');
const servers: Server[] = [];

async function localVoiceStudio() {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ version: '0.5.0', status: 'ok' })); return;
    }
    if (request.url === '/models') {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ models: [{ id: 'kitten', name: 'Kitten', installed: true }] })); return;
    }
    if (request.url === '/v1/audio/voices') {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ voices: [{ id: 'voice-1', name: 'Voice 1', source: 'local' }] })); return;
    }
    if (request.method === 'POST' && request.url === '/v1/audio/speech') {
      response.setHeader('content-type', 'audio/wav'); response.end(WAV); return;
    }
    response.statusCode = 404; response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('VoiceStudio narration adapter', () => {
  it('selects only the ready sidecar asset by id', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-narration-select-'));
    const asset = { id: '00000000-0000-4000-8000-000000000001', provider: 'voicestudio' as const, relativePath: 'narracao/voice.mp3', format: 'mp3' as const, modelId: 'm', voiceId: 'v', textHash: 'a'.repeat(64), durationMs: 1000, license: { provider: 'reviewed' as const, model: 'reviewed' as const, voice: 'reviewed' as const, output: 'reviewed' as const, userConfirmed: true }, status: 'ready' as const, createdAt: '2026-11-03T00:00:00.000Z' };
    mkdirSync(join(root, 'demo', 'narracao'), { recursive: true });
    writeFileSync(join(root, 'demo', 'narracao', 'neuralbridge-narration.json'), JSON.stringify({ schemaVersion: 1, asset, timeline: null }));
    expect(selectNarrationAsset(root, 'demo', asset.id)).toEqual(asset);
    expect(() => selectNarrationAsset(root, 'demo', '00000000-0000-4000-8000-000000000002')).toThrow(/não pertence/);
  });
  it('sends the bare language code, because the voice model rejects a region and falls back to its own accent', async () => {
    const bodies: Array<{ language?: string }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => { bodies.push(JSON.parse(body) as { language?: string }); response.writeHead(200, { 'content-type': 'audio/wav' }); response.end(Buffer.from('RIFF')); });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const client = createVoiceStudioClient({ baseUrl: `http://127.0.0.1:${port}` });
    for (const language of ['pt-BR', 'en-US', 'pt']) await client.speech({ text: 'Oi', modelId: 'm', voiceId: 'v', format: 'wav', language });
    server.close();
    expect(bodies.map((body) => body.language)).toEqual(['pt', 'en', 'pt']);
  });

  it('speaks a designed voice by attributes and seed, without a voice id, and reads the model licence the provider declares', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const license = { registry_digest: 'fae1', license: 'CC-BY-NC', review_status: 'noncommercial', commercial_inference: 'restricted', license_category: 'noncommercial' };
    const server = createServer((request, response) => {
      if (request.url === '/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ models: [{ id: 'whisper', role: 'STT', license_info: license }, { id: 'omnivoice', role: 'TTS', license_info: license }, { id: 'kitten', role: 'TTS' }] })); return; }
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => { bodies.push(JSON.parse(body) as Record<string, unknown>); response.writeHead(200, { 'content-type': 'audio/wav' }); response.end(Buffer.from('RIFF')); });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const client = createVoiceStudioClient({ baseUrl: `http://127.0.0.1:${port}` });
    await client.speech({ text: 'Oi', modelId: 'omnivoice', format: 'wav', language: 'pt-BR', instruct: 'male, young adult, moderate pitch', seed: 303, numStep: 32, speed: 1.12 });
    expect(bodies[0]).toEqual({ input: 'Oi', model: 'omnivoice', response_format: 'wav', language: 'pt', speed: 1.12, instruct: 'male, young adult, moderate pitch', seed: 303, num_step: 32 });
    expect(await client.modelLicense('omnivoice')).toEqual({ registryDigest: 'fae1', license: 'CC-BY-NC', reviewStatus: 'noncommercial', commercialInference: 'restricted', licenseCategory: 'noncommercial' });
    expect(await client.modelLicense('kitten')).toBeNull();
    server.close();
  });

  it('releases the voice model on request', async () => {
    const seen: string[] = [];
    const server = createServer((request, response) => { seen.push(`${request.method} ${request.url}`); response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    await createVoiceStudioClient({ baseUrl: `http://127.0.0.1:${port}` }).releaseVoiceMemory();
    server.close();
    expect(seen).toEqual(['POST /system/flush-memory?unload_model=true']);
  });

  it('rejects non-loopback endpoints before making a request', () => {
    expect(() => createVoiceStudioClient({ baseUrl: 'https://example.com' })).toThrow(/loopback/i);
  });

  it('reads the models and voices in the shape of the real 0.5.7 API', async () => {
    const real = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/health') return void response.end(JSON.stringify({ status: 'ok', version: '0.5.7' }));
      if (request.url === '/models') return void response.end(JSON.stringify({ models: [{ repo_id: 'k2-fsa/OmniVoice', label: 'OmniVoice', role: 'TTS', engines: ['omnivoice'], installed: true, license_info: { license: 'CC-BY-NC', commercial_inference: 'restricted' } }, { repo_id: 'whisper', role: 'ASR', engines: ['whisperx'], installed: true }] }));
      return void response.end(JSON.stringify({ voices: [{ voice_id: 'alloy', id: 'alloy', name: 'Alloy', type: 'openai_alias' }, { voice_id: 'fb0291d2', id: 'fb0291d2', name: 'Minha voz', type: 'profile' }] }));
    });
    await new Promise<void>((done) => real.listen(0, '127.0.0.1', done));
    const { port } = real.address() as AddressInfo;
    const status = await createVoiceStudioClient({ baseUrl: `http://127.0.0.1:${port}` }).status();
    await new Promise((done) => real.close(done));
    expect(status).toMatchObject({ compatible: true, apiVersion: '0.5.7', models: [{ id: 'omnivoice', installed: true, licenseNote: 'CC-BY-NC — uso comercial restrito' }], voices: [{ id: 'fb0291d2', label: 'Minha voz', source: 'profile' }] });
    expect(status.models).toHaveLength(1);
    expect(status.voices).toHaveLength(1);
  });

  it('discovers the local API contract, models and voices', async () => {
    const client = createVoiceStudioClient({ baseUrl: await localVoiceStudio() });
    await expect(client.status()).resolves.toMatchObject({ available: true, compatible: true, apiVersion: '0.5.0' });
    await expect(client.models()).resolves.toEqual([expect.objectContaining({ id: 'kitten', installed: true })]);
    await expect(client.voices()).resolves.toEqual([expect.objectContaining({ id: 'voice-1' })]);
  });

  it('surfaces VoiceStudio license blocks instead of hiding them as a generic HTTP error', async () => {
    const blocked = createServer((_request, response) => {
      response.statusCode = 403;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { code: 'model_licence_required', message: 'Review and accept it in Model Catalogue.' } }));
    });
    await new Promise<void>((done) => blocked.listen(0, '127.0.0.1', done));
    servers.push(blocked);
    const { port } = blocked.address() as AddressInfo;
    const client = createVoiceStudioClient({ baseUrl: `http://127.0.0.1:${port}` });
    await expect(client.speech({ text: 'Olá', modelId: 'omnivoice', voiceId: 'voice-1', format: 'wav' })).rejects.toThrow(/license_required.*Review and accept/i);
  });

  it('requires independent license confirmation and persists generated audio atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-voice-'));
    const client = createVoiceStudioClient({ baseUrl: await localVoiceStudio() });
    const license = { provider: 'reviewed' as const, model: 'reviewed' as const, voice: 'reviewed' as const, output: 'reviewed' as const, userConfirmed: true };
    await expect(generateVoiceStudioNarration({ root, video: 'demo', client, text: 'Olá NeuralBridge', modelId: 'kitten', voiceId: 'voice-1', format: 'wav', license, probeAudio: async () => ({ durationMs: 320 }) })).resolves.toMatchObject({ provider: 'voicestudio', format: 'wav', durationMs: 320, status: 'ready' });
    const sidecar = loadNarrationSidecar(root, 'demo');
    const asset = sidecar.asset;
    if (!asset) throw new Error('asset missing');
    expect(asset.relativePath).toMatch(/^demo\/narracao\/voice-/);
    expect(existsSync(join(root, asset.relativePath))).toBe(true);
    expect(readFileSync(join(root, asset.relativePath))).toEqual(WAV);
    await expect(previewNarration(root, 'demo', asset.id)).resolves.toBe(`data:audio/wav;base64,${WAV.toString('base64')}`);
  });

  it('does not generate when any license dimension is unverified', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-voice-'));
    const client = createVoiceStudioClient({ baseUrl: await localVoiceStudio() });
    await expect(generateVoiceStudioNarration({ root, video: 'demo', client, text: 'Olá', modelId: 'kitten', voiceId: 'voice-1', format: 'wav', license: { provider: 'reviewed', model: 'unknown', voice: 'reviewed', output: 'reviewed', userConfirmed: false }, probeAudio: async () => ({ durationMs: 1 }) })).rejects.toThrow(/licenças/i);
  });

  it('refuses to overwrite a sidecar while another writer holds its lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-voice-'));
    const client = createVoiceStudioClient({ baseUrl: await localVoiceStudio() });
    const license = { provider: 'reviewed' as const, model: 'reviewed' as const, voice: 'reviewed' as const, output: 'reviewed' as const, userConfirmed: true };
    await generateVoiceStudioNarration({ root, video: 'demo', client, text: 'Olá NeuralBridge', modelId: 'kitten', voiceId: 'voice-1', format: 'wav', license, probeAudio: async () => ({ durationMs: 320 }) });
    const sidecarPath = join(root, 'demo', 'narracao', 'neuralbridge-narration.json');
    writeFileSync(`${sidecarPath}.lock`, 'another-writer');
    const sidecar = loadNarrationSidecar(root, 'demo');
    if (!sidecar.timeline) throw new Error('timeline missing');
    await expect(saveNarrationTimeline(root, 'demo', { ...sidecar.timeline, syncStatus: 'synced' })).rejects.toThrow(/concorrente/i);
  });
});
