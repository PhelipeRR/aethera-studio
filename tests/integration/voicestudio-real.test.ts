import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignVelixMotionVoice, createVoiceStudioClient, generateVoiceStudioNarration } from '@neuralbridge/workspace';

describe.skipIf(process.env['NB_VOICESTUDIO'] !== '1')('VoiceStudio real local API', () => {
  it('discovers installed assets, generates audio, validates it and persists the sidecar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-voicestudio-real-'));
    const client = createVoiceStudioClient({ baseUrl: process.env['NB_VOICESTUDIO_BASE_URL'] ?? 'http://localhost:3900' });
    const status = await client.status();
    if (!status.available || !status.compatible) throw new Error(status.error ?? 'VoiceStudio local indisponível.');
    if (process.env['NB_VOICESTUDIO_LICENSE_CONFIRMED'] !== '1') throw new Error('Defina NB_VOICESTUDIO_LICENSE_CONFIRMED=1 somente após revisar as licenças do modelo, voz e saída.');
    const model = status.models.find((item) => item.installed);
    const wanted = process.env['NB_VOICESTUDIO_VOICE'];
    const voice = wanted ? status.voices.find((item) => item.label === wanted) : status.voices[0];
    if (!model || !voice) throw new Error('VoiceStudio não expôs um modelo instalado e uma voz disponível.');
    const text = 'Este é um teste real da narração local do NeuralBridge, gerada com a voz clonada no VoiceStudio.';
    const started = Date.now();
    const asset = await generateVoiceStudioNarration({ root, video: 'real', client, text, language: 'pt', modelId: model.id, voiceId: voice.id, format: 'wav', license: { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true } });
    console.log(`voicestudio real: api=${status.apiVersion} model=${model.id} note=${model.licenseNote} voice=${voice.label} ms=${Date.now() - started} ${asset.relativePath} durationMs=${asset.durationMs}`);
    expect(asset).toMatchObject({ provider: 'voicestudio', status: 'ready', durationMs: expect.any(Number) });
    const { captions, missed } = await alignVelixMotionVoice(root, asset.relativePath, [{ text, startMs: 60_000, endMs: 61_000, timestampMs: null, confidence: null }]);
    console.log(`voicestudio align: missed=${missed} ${JSON.stringify(captions.map(({ startMs, endMs }) => [startMs, endMs]))}`);
    expect(missed).toBe(0);
  }, 600_000);
});
