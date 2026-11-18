import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { ELEVENLABS_PCM_FORMAT, synthesizeElevenLabsWav } from '@neuralbridge/cinema';
import { join } from 'node:path';
import { z } from 'zod';
import { StudioSecretStore } from '../../../../packages/desktop-shared/src/main/studio-secret-store.js';
import type { CollageSecretCipher } from '../../../../packages/desktop-shared/src/main/collage-secret-store.js';

// ─── Contrato TTS Provider ────────────────────────────────────────────────────

export interface TtsVoiceBase {
  id: string;
  name: string;
}

export type TtsVoice = TtsVoiceBase & {
  language?: string;
  previewUrl?: string;
  labels?: Record<string, string>;
};

export interface TtsSynthesizeOptions {
  text: string;
  voiceId: string;
  modelId?: string;
  language?: string;
  outWavPath: string;
  signal?: AbortSignal;
}

export interface TtsCapabilities {
  supportsPreview: boolean;
  supportsLanguageSelection: boolean;
  requiresCredits: boolean;
  maxCharactersPerRequest?: number;
}

export interface TtsProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  healthCheck(signal?: AbortSignal): Promise<{ ok: boolean; message?: string }>;
  listVoices(signal?: AbortSignal): Promise<TtsVoice[]>;
  getVoicePreviewUrl(voiceId: string): Promise<string | null>;
  synthesize(options: TtsSynthesizeOptions): Promise<{ mode: string; cached: boolean }>;
  getCapabilities(): TtsCapabilities;
}

// ─── ElevenLabs Credentials ───────────────────────────────────────────────────

export const elevenLabsCredentialsSchema = z.strictObject({
  apiKey: z.string().trim().min(1).max(500),
  modelId: z.string().trim().min(1).max(100).optional(),
});

export type ElevenLabsCredentials = z.infer<typeof elevenLabsCredentialsSchema>;

// ─── Cache de vozes e prévias ─────────────────────────────────────────────────

class TtsCache {
  constructor(private readonly cacheDir: string, private readonly ttlMs: number) {
    mkdirSync(cacheDir, { recursive: true });
  }

  private key(provider: string, kind: string, id: string): string {
    return join(this.cacheDir, `${provider}_${kind}_${createHash('sha256').update(id).digest('hex').slice(0, 16)}.json`);
  }

  get(provider: string, kind: string, id: string): unknown | null {
    const file = this.key(provider, kind, id);
    if (!existsSync(file)) return null;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { ts: number; value: unknown };
      if (Date.now() - data.ts > this.ttlMs) return null;
      return data.value;
    } catch {
      return null;
    }
  }

  set(provider: string, kind: string, id: string, value: unknown): void {
    const file = this.key(provider, kind, id);
    try {
      writeFileSync(file, JSON.stringify({ ts: Date.now(), value }), 'utf8');
    } catch {
      // cache write failure is non-fatal
    }
  }

  delete(provider: string, kind: string, id: string): void {
    const file = this.key(provider, kind, id);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // cache invalidation failure is non-fatal
    }
  }
}

// ─── VoiceStudio Provider ─────────────────────────────────────────────────────

export class VoiceStudioProvider implements TtsProvider {
  readonly id = 'voicestudio';
  readonly displayName = 'VoiceStudio (Local)';

  constructor(private readonly baseUrl: string = 'http://localhost:3900') {}

  isConfigured(): boolean {
    return true; // VoiceStudio é local, sempre disponível conceitualmente
  }

  async healthCheck(signal?: AbortSignal): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: signal ?? AbortSignal.timeout(3_000) });
      if (res.ok) return { ok: true };
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listVoices(signal?: AbortSignal): Promise<TtsVoice[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/audio/voices`, { signal: signal ?? AbortSignal.timeout(5_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as { voices?: Array<{ voice_id?: string; id?: string; name?: string; type?: string }> };
      return (data.voices ?? [])
        .map((v) => {
          const base: TtsVoice = {
            id: v.voice_id ?? v.id ?? '',
            name: v.name ?? v.voice_id ?? v.id ?? 'Sem nome',
          };
          if (v.type) base.labels = { type: v.type };
          return base;
        })
        .filter((v) => v.id);
    } catch {
      return [];
    }
  }

  async getVoicePreviewUrl(_voiceId: string): Promise<string | null> {
    return null; // VoiceStudio não expõe preview_url nativo
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<{ mode: string; cached: boolean }> {
    const res = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: options.text,
        model: options.modelId ?? 'omnivoice',
        voice: options.voiceId,
        response_format: 'wav',
        language: options.language ?? 'pt',
      }),
      signal: options.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`VoiceStudio TTS falhou: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) throw new Error('VoiceStudio TTS retornou áudio vazio.');
    writeFileSync(options.outWavPath, buf);
    return { mode: 'voicestudio_tts', cached: false };
  }

  getCapabilities(): TtsCapabilities {
    return {
      supportsPreview: false,
      supportsLanguageSelection: true,
      requiresCredits: false,
    };
  }
}

// ─── ElevenLabs Provider ──────────────────────────────────────────────────────

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

export class ElevenLabsProvider implements TtsProvider {
  readonly id = 'elevenlabs';
  readonly displayName = 'ElevenLabs';
  private readonly secretStore: StudioSecretStore<ElevenLabsCredentials>;
  private readonly cache: TtsCache;

  constructor(cipher: CollageSecretCipher, userDataDir: string) {
    this.secretStore = new StudioSecretStore<ElevenLabsCredentials>(
      join(userDataDir, 'elevenlabs-credentials.bin'),
      cipher,
      elevenLabsCredentialsSchema,
      'as credenciais do ElevenLabs',
    );
    this.cache = new TtsCache(join(userDataDir, 'tts-cache'), 30 * 60 * 1000); // 30 min TTL
  }

  isConfigured(): boolean {
    const creds = this.secretStore.load();
    return Boolean(creds?.apiKey);
  }

  private getApiKey(): string {
    const creds = this.secretStore.load();
    if (!creds?.apiKey) throw new Error('unconfigured: API Key do ElevenLabs não configurada.');
    return creds.apiKey;
  }

  private getModelId(): string {
    return this.secretStore.load()?.modelId || 'eleven_multilingual_v2';
  }

  /**
   * Credentials for the render pipeline (main process only). Never send this to the renderer.
   */
  getSynthesisCredentials(): { apiKey: string; modelId: string } | null {
    const creds = this.secretStore.load();
    if (!creds?.apiKey) return null;
    return { apiKey: creds.apiKey, modelId: creds.modelId || 'eleven_multilingual_v2' };
  }

  saveCredentials(credentials: ElevenLabsCredentials): void {
    this.secretStore.save(credentials);
    this.cache.delete('elevenlabs', 'voices', 'all');
  }

  clearCredentials(): void {
    this.secretStore.clear();
    this.cache.delete('elevenlabs', 'voices', 'all');
  }

  async healthCheck(signal?: AbortSignal): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(`${ELEVENLABS_BASE}/v1/user`, {
        headers: { 'xi-api-key': this.getApiKey() },
        signal: signal ?? AbortSignal.timeout(5_000),
      });
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, message: 'API Key inválida ou revogada.' };
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listVoices(signal?: AbortSignal): Promise<TtsVoice[]> {
    const cached = this.cache.get('elevenlabs', 'voices', 'all') as TtsVoice[] | null;
    if (cached) return cached;

    const allVoices: TtsVoice[] = [];
    let page = 1;
    const maxPages = 5;

    while (page <= maxPages) {
      const url = `${ELEVENLABS_BASE}/v2/voices?page_size=100&page=${page}`;
      const res = await fetch(url, {
        headers: { 'xi-api-key': this.getApiKey() },
        signal: signal ?? AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        if (res.status === 429) throw new Error('rate_limited: Limite de requisições do ElevenLabs atingido. Aguarde e tente novamente.');
        throw new Error(`ElevenLabs listVoices falhou: HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        voices?: Array<{
          voice_id?: string;
          name?: string;
          language?: string;
          preview_url?: string;
          labels?: Record<string, string>;
        }>;
        has_more?: boolean;
      };
      for (const v of data.voices ?? []) {
        if (!v.voice_id) continue;
        const voice: TtsVoice = {
          id: v.voice_id,
          name: v.name ?? v.voice_id,
        };
        if (v.language) voice.language = v.language;
        if (v.preview_url) voice.previewUrl = v.preview_url;
        if (v.labels) voice.labels = v.labels;
        allVoices.push(voice);
      }
      if (!data.has_more) break;
      page++;
    }

    this.cache.set('elevenlabs', 'voices', 'all', allVoices);
    return allVoices;
  }

  async getVoicePreviewUrl(voiceId: string): Promise<string | null> {
    const cached = this.cache.get('elevenlabs', 'preview', voiceId) as string | null;
    if (cached) return cached;

    const voices = await this.listVoices();
    const voice = voices.find((v) => v.id === voiceId);
    if (voice?.previewUrl) {
      this.cache.set('elevenlabs', 'preview', voiceId, voice.previewUrl);
      return voice.previewUrl;
    }
    return null;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<{ mode: string; cached: boolean }> {
    const modelId = options.modelId || this.getModelId();
    const cacheKey = createHash('sha256')
      .update(`${ELEVENLABS_PCM_FORMAT}:${options.voiceId}:${modelId}:${options.language ?? 'pt'}:${options.text}`)
      .digest('hex')
      .slice(0, 24);
    const cachedPath = join(join(options.outWavPath, '..'), `_cache_${cacheKey}.wav`);
    if (existsSync(cachedPath)) {
      copyFileSync(cachedPath, options.outWavPath);
      return { mode: 'elevenlabs_tts', cached: true };
    }

    await synthesizeElevenLabsWav({
      apiKey: this.getApiKey(),
      voiceId: options.voiceId,
      text: options.text,
      outWavPath: options.outWavPath,
      modelId,
      ...(options.language ? { languageCode: options.language } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    try {
      copyFileSync(options.outWavPath, cachedPath);
    } catch {
      // cache write failure is non-fatal
    }
    return { mode: 'elevenlabs_tts', cached: false };
  }

  getCapabilities(): TtsCapabilities {
    return {
      supportsPreview: true,
      supportsLanguageSelection: true,
      requiresCredits: true,
      maxCharactersPerRequest: 5000,
    };
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class TtsProviderRegistry {
  private readonly providers = new Map<string, TtsProvider>();

  register(provider: TtsProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): TtsProvider | undefined {
    return this.providers.get(id);
  }

  list(): Array<{ id: string; displayName: string; configured: boolean }> {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      configured: p.isConfigured(),
    }));
  }

  getDefault(): TtsProvider {
    return this.providers.get('voicestudio') ?? Array.from(this.providers.values())[0]!;
  }
}