import { describe, expect, it, vi } from 'vitest';
import type { VoiceStudioClient } from '@neuralbridge/workspace';
import type { VoiceStudioStatus } from '@neuralbridge/shared';
import { VoiceStudioNeuraSpeech } from '../src/main/neura-speech.js';

function client(): VoiceStudioClient {
  const status: VoiceStudioStatus = {
    available: true,
    compatible: true,
    baseUrl: 'http://localhost:3900',
    apiVersion: '0.5.7',
    error: null,
    models: [{ id: 'neura-model', label: 'Neura', installed: true, license: { provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false }, licenseNote: null }],
    voices: [{ id: 'neura-voice', label: 'Neura', source: 'preset', license: { provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false } }],
  };
  return {
    baseUrl: 'http://localhost:3900',
    releaseVoiceMemory: vi.fn(() => Promise.resolve()),
    modelLicense: vi.fn(async () => null),
  status: vi.fn(async () => status),
    models: vi.fn(async () => []),
    voices: vi.fn(async () => []),
    speech: vi.fn(async () => ({ bytes: Buffer.from('wav'), contentType: 'audio/wav' })),
  };
}

describe('VoiceStudioNeuraSpeech', () => {
  it('uses the Neura profile and preserves the detected response language', async () => {
    const fake = client();
    const output = new VoiceStudioNeuraSpeech(fake);

    const result = await output.speak({ text: 'Hello, how can I help?', language: 'en-US' });

    expect(result).toMatchObject({ provider: 'voicestudio', modelId: 'neura-model', voiceId: 'default', audio: 'data:audio/wav;base64,d2F2' });
    expect(fake.speech).toHaveBeenCalledWith({ text: 'Hello, how can I help?', language: 'en-US', format: 'wav', modelId: 'neura-model', voiceId: 'default', instructions: 'female, adult, moderate pitch, natural English pronunciation, neutral international accent', speed: 0.96 });
  });

  it('asks VoiceStudio for native Brazilian Portuguese pronunciation', async () => {
    const fake = client();

    await new VoiceStudioNeuraSpeech(fake).speak({ text: 'Posso ajudar?', language: 'pt-BR' });

    expect(fake.speech).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'female, adult, moderate pitch, native Brazilian Portuguese pronunciation, no foreign accent' }));
  });

  it('honors an explicitly installed model and voice', async () => {
    const fake = client();
    const output = new VoiceStudioNeuraSpeech(fake, { modelId: 'neura-model', voiceId: 'neura-voice', speed: 1 });

    await output.speak({ text: 'Olá', language: 'pt-BR' });

    expect(fake.speech).toHaveBeenCalledWith(expect.objectContaining({ language: 'pt-BR', voiceId: 'neura-voice', speed: 1 }));
  });

  it('does not select a personal profile when the catalog has no dedicated Neura voice', async () => {
    const fake = client();
    vi.mocked(fake.status).mockResolvedValueOnce({ ...(await fake.status()), voices: [] });

    await expect(new VoiceStudioNeuraSpeech(fake).speak({ text: 'Olá', language: 'pt-BR' })).resolves.toMatchObject({ voiceId: 'default' });
    expect(fake.speech).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'default' }));
  });

  it('selects the dedicated Neura Lumen profile without selecting a personal voice', async () => {
    const fake = client();
    vi.mocked(fake.status).mockResolvedValueOnce({ ...(await fake.status()), voices: [{ id: 'lumen-id', label: 'Neura Lumen', source: 'profile', license: { provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false } }] });

    await new VoiceStudioNeuraSpeech(fake).speak({ text: 'Olá', language: 'pt-BR' });

    expect(fake.speech).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'lumen-id', language: 'pt-BR' }));
  });

  it('prefers the non-personal Nova preset when it is available', async () => {
    const fake = client();
    vi.mocked(fake.status).mockResolvedValueOnce({ ...(await fake.status()), voices: [
      { id: 'lumen-id', label: 'Neura Lumen', source: 'profile', license: { provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false } },
      { id: 'nova', label: 'Nova', source: 'preset', license: { provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false } },
    ] });

    await new VoiceStudioNeuraSpeech(fake).speak({ text: 'Olá', language: 'pt-BR' });

    expect(fake.speech).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'nova' }));
  });

  it('reuses the VoiceStudio catalog during consecutive replies', async () => {
    const fake = client();
    const output = new VoiceStudioNeuraSpeech(fake);

    await output.speak({ text: 'Primeira resposta', language: 'pt-BR' });
    await output.speak({ text: 'Segunda resposta', language: 'pt-BR' });

    expect(fake.status).toHaveBeenCalledTimes(1);
  });

  it('refreshes the catalog after VoiceStudio rejects speech', async () => {
    const fake = client();
    vi.mocked(fake.speech).mockRejectedValueOnce(new Error('model unloading'));
    const output = new VoiceStudioNeuraSpeech(fake);

    await expect(output.speak({ text: 'Primeira resposta', language: 'pt-BR' })).rejects.toThrow('model unloading');
    await output.speak({ text: 'Segunda resposta', language: 'pt-BR' });

    expect(fake.status).toHaveBeenCalledTimes(2);
  });
});

