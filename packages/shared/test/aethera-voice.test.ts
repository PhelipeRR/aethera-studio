import { describe, expect, it } from 'vitest';
import { narrationDirectionSchema, planDirectedSegments, voiceAuthorizationStatus, voicePresetSchema, type VoiceAuthorization, type VoiceLicenseFingerprint } from '../src/index.js';

// Synthetic records; the licence values mirror what VoiceStudio declares for OmniVoice, nothing here calls it.
const license: VoiceLicenseFingerprint = { registryDigest: 'fae13ec3', license: 'CC-BY-NC (version unspecified); Higgs Audio 2; Meta Llama 3', reviewStatus: 'noncommercial', commercialInference: 'restricted', licenseCategory: 'noncommercial' };
const authorization: VoiceAuthorization = { schemaVersion: 1, id: 'auth-1', presetId: 'voz-c', projectId: 'vp', provider: 'voicestudio', modelId: 'omnivoice', license, scope: 'noncommercial', note: 'Canal sem monetização; uso não comercial', grantedBy: 'user', grantedAt: '2026-11-11T12:00:00.000Z', revokedAt: null };

describe('voice preset (Aethera vocal identity)', () => {
  it('describes an original synthetic voice by design attributes and seed, never by a person', () => {
    const preset = voicePresetSchema.parse({ schemaVersion: 1, id: 'voz-c', projectId: 'vp', name: 'Aethera — dinâmica', provider: 'voicestudio', modelId: 'omnivoice', origin: 'synthetic_design', design: { instruct: 'male, young adult, moderate pitch', seed: 303, numStep: 32 }, speed: 1.12, language: 'pt-BR', sample: { relativePath: 'vozes/amostras-aethera/aethera-voz-C-dinamico.wav', sha256: 'a'.repeat(64) }, createdAt: '2026-11-11T12:00:00.000Z' });
    expect(preset.design.seed).toBe(303);
    expect(() => voicePresetSchema.parse({ ...preset, origin: 'clone' })).toThrow();
    expect(() => voicePresetSchema.parse({ ...preset, speed: 3 })).toThrow();
  });
});

describe('persistent voice authorization', () => {
  it('stays valid while the provider declares the same licence, and never for another preset or project', () => {
    expect(voiceAuthorizationStatus(authorization, { presetId: 'voz-c', projectId: 'vp', modelId: 'omnivoice', license })).toEqual({ valid: true, reason: expect.stringContaining('não comercial') });
    expect(voiceAuthorizationStatus(authorization, { presetId: 'outra', projectId: 'vp', modelId: 'omnivoice', license }).valid).toBe(false);
    expect(voiceAuthorizationStatus(authorization, { presetId: 'voz-c', projectId: 'outro', modelId: 'omnivoice', license }).valid).toBe(false);
  });

  it('expires by itself when the provider changes the licence, and when revoked', () => {
    expect(voiceAuthorizationStatus(authorization, { presetId: 'voz-c', projectId: 'vp', modelId: 'omnivoice', license: { ...license, registryDigest: 'novo' } })).toEqual({ valid: false, reason: expect.stringContaining('licença do modelo mudou') });
    expect(voiceAuthorizationStatus({ ...authorization, revokedAt: '2026-11-12T00:00:00.000Z' }, { presetId: 'voz-c', projectId: 'vp', modelId: 'omnivoice', license }).valid).toBe(false);
    expect(voiceAuthorizationStatus(null, { presetId: 'voz-c', projectId: 'vp', modelId: 'omnivoice', license })).toEqual({ valid: false, reason: expect.stringContaining('Autorize') });
    expect(voiceAuthorizationStatus(authorization, { presetId: 'voz-c', projectId: 'vp', modelId: 'omnivoice', license: null }).valid).toBe(false);
  });
});

describe('per-scene narration direction', () => {
  const scenes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  it('cuts the narration where speed changes or a pause is asked, and keeps undirected scenes together', () => {
    const directions = [narrationDirectionSchema.parse({ sceneId: 'b', pauseAfterMs: 600 }), narrationDirectionSchema.parse({ sceneId: 'd', speed: 1.2 })];
    expect(planDirectedSegments(scenes, directions, 1.12)).toEqual([
      { sceneIds: ['a', 'b'], speed: 1.12, pauseAfterMs: 600 },
      { sceneIds: ['c'], speed: 1.12, pauseAfterMs: 0 },
      { sceneIds: ['d'], speed: 1.2, pauseAfterMs: 0 },
      { sceneIds: ['e'], speed: 1.12, pauseAfterMs: 0 },
    ]);
    expect(planDirectedSegments(scenes, [], 1)).toEqual([{ sceneIds: ['a', 'b', 'c', 'd', 'e'], speed: 1, pauseAfterMs: 0 }]);
  });

  it('bounds speed and pause to what the voice engine and the edit can honour', () => {
    expect(() => narrationDirectionSchema.parse({ sceneId: 'a', speed: 2 })).toThrow();
    expect(() => narrationDirectionSchema.parse({ sceneId: 'a', pauseAfterMs: 5_000 })).toThrow();
  });
});
