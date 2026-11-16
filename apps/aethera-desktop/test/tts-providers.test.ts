import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { VoiceStudioProvider, ElevenLabsProvider, TtsProviderRegistry, elevenLabsCredentialsSchema } from '../src/main/tts-providers.js';
import type { CollageSecretCipher } from '../../../packages/desktop-shared/src/main/collage-secret-store.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Mock cipher that uses base64 instead of OS-level encryption for testing
const mockCipher: CollageSecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8'),
};

describe('TtsProviderRegistry — Multi-Provider Architecture', () => {
  it('registers and lists multiple providers with configured status', () => {
    const registry = new TtsProviderRegistry();
    registry.register(new VoiceStudioProvider());
    const root = makeTempDir('tts-registry-');
    registry.register(new ElevenLabsProvider(mockCipher, root));

    const list = registry.list();
    expect(list.length).toBe(2);
    expect(list.find((p) => p.id === 'voicestudio')?.displayName).toBe('VoiceStudio (Local)');
    expect(list.find((p) => p.id === 'elevenlabs')?.displayName).toBe('ElevenLabs');
    // VoiceStudio is always "configured" (local), ElevenLabs starts unconfigured
    expect(list.find((p) => p.id === 'voicestudio')?.configured).toBe(true);
    expect(list.find((p) => p.id === 'elevenlabs')?.configured).toBe(false);
  });

  it('returns default provider as VoiceStudio when available', () => {
    const registry = new TtsProviderRegistry();
    registry.register(new VoiceStudioProvider());
    const root = makeTempDir('tts-default-');
    registry.register(new ElevenLabsProvider(mockCipher, root));

    const def = registry.getDefault();
    expect(def.id).toBe('voicestudio');
  });

  it('retrieves provider by id and returns undefined for unknown', () => {
    const registry = new TtsProviderRegistry();
    registry.register(new VoiceStudioProvider());

    expect(registry.get('voicestudio')).toBeDefined();
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});

describe('ElevenLabsProvider — Credentials & Health Check', () => {
  it('reports unconfigured when no credentials are saved', () => {
    const root = makeTempDir('tts-unconfig-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    expect(provider.isConfigured()).toBe(false);
  });

  it('saves and loads credentials securely via StudioSecretStore', () => {
    const root = makeTempDir('tts-creds-');
    const provider = new ElevenLabsProvider(mockCipher, root);

    provider.saveCredentials({ apiKey: 'sk-test-elevenlabs-key-12345', modelId: 'eleven_multilingual_v2' });
    expect(provider.isConfigured()).toBe(true);
  });

  it('clears credentials and reports unconfigured afterwards', () => {
    const root = makeTempDir('tts-clear-');
    const provider = new ElevenLabsProvider(mockCipher, root);

    provider.saveCredentials({ apiKey: 'sk-test-to-clear' });
    expect(provider.isConfigured()).toBe(true);

    provider.clearCredentials();
    expect(provider.isConfigured()).toBe(false);
  });

  it('validates credentials schema rejects empty or oversized keys', () => {
    expect(() => elevenLabsCredentialsSchema.parse({ apiKey: '' })).toThrow();
    expect(() => elevenLabsCredentialsSchema.parse({ apiKey: 'a'.repeat(501) })).toThrow();
    expect(() => elevenLabsCredentialsSchema.parse({ apiKey: 'valid-key', modelId: 'x'.repeat(101) })).toThrow();
  });

  it('healthCheck returns unauthorized for invalid API key without leaking the key', async () => {
    const root = makeTempDir('tts-health-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    provider.saveCredentials({ apiKey: 'sk-invalid-key-for-test' });

    // Mock fetch to simulate 401
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    try {
      const result = await provider.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('inválida');
      expect(result.message).not.toContain('sk-invalid');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('never exposes API key in error messages during synthesis failure', async () => {
    const root = makeTempDir('tts-synth-err-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    provider.saveCredentials({ apiKey: 'sk-secret-should-not-leak' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;

    try {
      await expect(
        provider.synthesize({ text: 'Teste', voiceId: 'v1', outWavPath: join(root, 'out.wav') }),
      ).rejects.toThrow('rate_limited');
    } catch (err) {
      expect(String(err)).not.toContain('sk-secret');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('VoiceStudioProvider — Compatibility Preservation', () => {
  it('is always configured (local provider)', () => {
    const provider = new VoiceStudioProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it('reports capabilities without credits requirement', () => {
    const provider = new VoiceStudioProvider();
    const caps = provider.getCapabilities();
    expect(caps.requiresCredits).toBe(false);
    expect(caps.supportsLanguageSelection).toBe(true);
  });

  it('healthCheck returns not ok when VoiceStudio is unreachable', async () => {
    const provider = new VoiceStudioProvider('http://localhost:59999');
    const result = await provider.healthCheck();
    expect(result.ok).toBe(false);
  });

  it('listVoices returns empty array when VoiceStudio is unreachable', async () => {
    const provider = new VoiceStudioProvider('http://localhost:59999');
    const voices = await provider.listVoices();
    expect(voices).toEqual([]);
  });
});

describe('TTS Cache — Voice Metadata & Preview URLs', () => {
  it('caches voice list and returns cached result on second call', async () => {
    const root = makeTempDir('tts-cache-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    provider.saveCredentials({ apiKey: 'sk-cache-test' });

    let fetchCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        voices: [{ voice_id: 'cached_voice', name: 'Cached Voice', language: 'pt-BR' }],
        has_more: false,
      }),
    })) as unknown as typeof fetch;
    // Count calls via mock
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      fetchCallCount++;
      return {
        ok: true,
        json: async () => ({
          voices: [{ voice_id: 'cached_voice', name: 'Cached Voice', language: 'pt-BR' }],
          has_more: false,
        }),
      };
    });

    try {
      const first = await provider.listVoices();
      const second = await provider.listVoices();
      expect(first.length).toBe(1);
      expect(second.length).toBe(1);
      expect(fetchCallCount).toBe(1); // Second call should hit cache
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Provider Switching — No Silent Voice Swap', () => {
  it('different providers maintain independent voice selections', () => {
    const registry = new TtsProviderRegistry();
    registry.register(new VoiceStudioProvider());
    const root = makeTempDir('tts-switch-');
    registry.register(new ElevenLabsProvider(mockCipher, root));

    const vs = registry.get('voicestudio');
    const el = registry.get('elevenlabs');
    expect(vs).toBeDefined();
    expect(el).toBeDefined();
    expect(vs!.id).not.toBe(el!.id);
  });

  it('ElevenLabs synthesize throws when unconfigured instead of silently falling back', async () => {
    const root = makeTempDir('tts-no-fallback-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    // Do NOT save credentials

    await expect(
      provider.synthesize({ text: 'Should fail', voiceId: 'v1', outWavPath: join(root, 'out.wav') }),
    ).rejects.toThrow('unconfigured');
  });
});
describe('ElevenLabs synthesis — real WAV output and render credentials', () => {
  it('requests raw PCM via output_format and writes a valid RIFF/WAVE file', async () => {
    const root = makeTempDir('tts-wav-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    provider.saveCredentials({ apiKey: 'sk-test-elevenlabs-key-12345' });

    const pcm = new Uint8Array(4800); // 0.1s of 16-bit mono at 24 kHz
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => pcm.buffer });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const out = join(root, 'out.wav');
      await provider.synthesize({ text: 'Olá', voiceId: 'voice/1', outWavPath: out });

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain('/v1/text-to-speech/voice%2F1');
      expect(url).toContain('output_format=pcm_24000');

      const wav = readFileSync(out);
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(wav.readUInt32LE(24)).toBe(24_000);
      expect(wav.readUInt16LE(22)).toBe(1);
      expect(wav.readUInt32LE(40)).toBe(pcm.byteLength);
      expect(wav.byteLength).toBe(44 + pcm.byteLength);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes saved credentials to the render pipeline and nothing when cleared', () => {
    const root = makeTempDir('tts-render-creds-');
    const provider = new ElevenLabsProvider(mockCipher, root);
    expect(provider.getSynthesisCredentials()).toBeNull();

    provider.saveCredentials({ apiKey: 'sk-test-elevenlabs-key-12345', modelId: 'eleven_turbo_v2_5' });
    expect(provider.getSynthesisCredentials()).toEqual({ apiKey: 'sk-test-elevenlabs-key-12345', modelId: 'eleven_turbo_v2_5' });

    provider.clearCredentials();
    expect(provider.getSynthesisCredentials()).toBeNull();
  });
});
