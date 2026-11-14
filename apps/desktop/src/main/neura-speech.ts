import type { NeuraSpeechInput, NeuraSpeechResult, VoiceStudioStatus } from '@neuralbridge/shared';
import type { VoiceStudioClient } from '@neuralbridge/workspace';

const MAX_VOICE_ID = 200;
const DEFAULT_NEURA_VOICE = 'nova';
const STATUS_CACHE_TTL_MS = 30_000;

/**
 * Voice profile for Neura's spoken replies.
 *
 * VoiceStudio owns the actual model/voice. The profile deliberately does not
 * pretend to clone a voice: a cloned or custom voice must first be installed
 * in VoiceStudio and its license must be handled there.
 */
export const NEURA_VOICE_PROFILE = {
  name: 'Neura Lumen',
  description: 'voz feminina adulta, natural, acolhedora, clara, conversacional e profissional; PT-BR e English; emoção discreta e sem imitar uma pessoa real',
  // OmniVoice currently applies canonical design tags. Language-specific pronunciation is explicit because a Portuguese catalog label alone does not prevent a foreign accent.
  instructions: {
    portuguese: 'female, adult, moderate pitch, native Brazilian Portuguese pronunciation, no foreign accent',
    english: 'female, adult, moderate pitch, natural English pronunciation, neutral international accent',
    default: 'female, adult, moderate pitch, clear natural pronunciation',
  },
  speed: 0.96,
} as const;

export interface NeuraSpeechOutput {
  speak(input: NeuraSpeechInput): Promise<NeuraSpeechResult>;
}

export interface VoiceStudioNeuraSpeechOptions {
  modelId?: string | null;
  voiceId?: string | null;
  speed?: number;
}

function configured(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_VOICE_ID) : null;
}

function selectVoice(status: { voices: readonly { id: string; label: string }[] }, configuredVoiceId: string | null | undefined): string {
  const explicit = configured(configuredVoiceId);
  if (explicit) return explicit;
  // Nova is a non-personal feminine preset. Prefer it over a designed profile because a profile's own instruct overrides request-level pronunciation hints.
  const preset = status.voices.find((voice) => voice.id.trim().toLowerCase() === DEFAULT_NEURA_VOICE);
  if (preset) return preset.id;
  // This is the dedicated synthetic profile created for Neura. Never fall back to an arbitrary profile: it could be personal.
  return status.voices.find((voice) => voice.label.trim().toLowerCase() === NEURA_VOICE_PROFILE.name.toLowerCase())?.id ?? 'default';
}

function instructionsForLanguage(language: string): string {
  const base = language.toLowerCase().split('-')[0];
  if (base === 'pt') return NEURA_VOICE_PROFILE.instructions.portuguese;
  if (base === 'en') return NEURA_VOICE_PROFILE.instructions.english;
  return NEURA_VOICE_PROFILE.instructions.default;
}

/** Main-process-only TTS adapter. The workspace adapter enforces loopback access. */
export class VoiceStudioNeuraSpeech implements NeuraSpeechOutput {
  private statusCache: { value: VoiceStudioStatus; expiresAt: number } | null = null;
  private statusRequest: Promise<VoiceStudioStatus> | null = null;

  constructor(private readonly client: VoiceStudioClient, private readonly options: VoiceStudioNeuraSpeechOptions = {}) {}

  async speak(input: NeuraSpeechInput): Promise<NeuraSpeechResult> {
    const status = await this.getStatus();
    if (!status.available || !status.compatible) throw new Error(status.error ?? 'VoiceStudio indisponível ou incompatível.');

    const preferredModel = configured(this.options.modelId);
    const model = (preferredModel ? status.models.find((item) => item.id === preferredModel && item.installed) : undefined)
      ?? status.models.find((item) => item.installed);
    if (!model) throw new Error('VoiceStudio não tem um modelo TTS instalado para a Neura.');

    const voiceId = selectVoice(status, this.options.voiceId);

    try {
      const response = await this.client.speech({
        text: input.text,
        language: input.language,
        format: 'wav',
        modelId: model.id,
        voiceId,
        instructions: instructionsForLanguage(input.language),
        speed: this.options.speed ?? NEURA_VOICE_PROFILE.speed,
      });
      return {
        provider: 'voicestudio',
        modelId: model.id,
        voiceId,
        audio: `data:audio/wav;base64,${response.bytes.toString('base64')}`,
      };
    } catch (error) {
      this.statusCache = null;
      throw error;
    }
  }

  private getStatus(): Promise<VoiceStudioStatus> {
    const now = Date.now();
    if (this.statusCache && this.statusCache.expiresAt > now) return Promise.resolve(this.statusCache.value);
    if (this.statusRequest) return this.statusRequest;

    const request = this.client.status().then((value) => {
      if (value.available && value.compatible) this.statusCache = { value, expiresAt: Date.now() + STATUS_CACHE_TTL_MS };
      return value;
    });
    this.statusRequest = request;
    void request.then(() => {
      if (this.statusRequest === request) this.statusRequest = null;
    }, () => {
      if (this.statusRequest === request) this.statusRequest = null;
    });
    return request;
  }
}

