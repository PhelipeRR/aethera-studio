import { writeFileSync } from 'node:fs';

export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';
export const ELEVENLABS_DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

/**
 * Raw 16-bit mono PCM at 24 kHz. Available on every ElevenLabs tier
 * (pcm_44100 requires Pro). The `accept` header does not select the format:
 * without `output_format` the API answers with MP3.
 */
export const ELEVENLABS_PCM_FORMAT = 'pcm_24000';
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

export interface ElevenLabsSynthesisInput {
  apiKey: string;
  voiceId: string;
  text: string;
  outWavPath: string;
  modelId?: string;
  languageCode?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface ElevenLabsCharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface ElevenLabsWordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ElevenLabsTimestampedSynthesis {
  words: ElevenLabsWordTimestamp[];
  alignment: ElevenLabsCharacterAlignment;
}

/** Wraps raw little-endian PCM samples in a RIFF/WAVE header. */
export function wrapPcm16AsWav(
  pcm: Buffer,
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
): Buffer {
  const blockAlign = channels * (PCM_BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Synthesizes `text` with ElevenLabs and writes a real WAV file.
 * Throws with a typed prefix (`unauthorized:`, `rate_limited:` ...) on failure;
 * the API key never appears in error messages.
 */
export async function synthesizeElevenLabsWav(input: ElevenLabsSynthesisInput): Promise<void> {
  const url =
    `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}` +
    `?output_format=${ELEVENLABS_PCM_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': input.apiKey,
      'content-type': 'application/json',
      accept: 'audio/pcm',
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.modelId || ELEVENLABS_DEFAULT_MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      ...(input.languageCode ? { language_code: input.languageCode } : {}),
    }),
    signal: input.signal ?? AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized: API Key do ElevenLabs inválida.');
    if (res.status === 403) throw new Error('forbidden: Conta ElevenLabs sem acesso ao modelo ou formato solicitado.');
    if (res.status === 422) throw new Error('validation: Texto ou parâmetros inválidos para o ElevenLabs.');
    if (res.status === 429) throw new Error('rate_limited: Limite de caracteres/requisições do ElevenLabs atingido.');
    throw new Error(`ElevenLabs TTS falhou: HTTP ${res.status}`);
  }

  const pcm = Buffer.from(await res.arrayBuffer());
  if (pcm.byteLength < 1024) throw new Error('ElevenLabs TTS retornou áudio vazio.');
  writeFileSync(input.outWavPath, wrapPcm16AsWav(pcm));
}

function parseAlignment(value: unknown): ElevenLabsCharacterAlignment {
  if (!value || typeof value !== 'object') throw new Error('ElevenLabs não retornou alinhamento de caracteres.');
  const candidate = value as Record<string, unknown>;
  const characters = candidate.characters;
  const starts = candidate.character_start_times_seconds;
  const ends = candidate.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends) || characters.length === 0 || characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error('ElevenLabs retornou alinhamento de caracteres inválido.');
  }
  const parsedCharacters = characters.map((character) => {
    if (typeof character !== 'string') throw new Error('ElevenLabs retornou caractere inválido no alinhamento.');
    return character;
  });
  const parsedStarts = starts.map((time) => Number(time));
  const parsedEnds = ends.map((time) => Number(time));
  if (parsedStarts.some((time) => !Number.isFinite(time) || time < 0) || parsedEnds.some((time) => !Number.isFinite(time) || time <= 0)) {
    throw new Error('ElevenLabs retornou tempos inválidos no alinhamento.');
  }
  return {
    characters: parsedCharacters,
    character_start_times_seconds: parsedStarts,
    character_end_times_seconds: parsedEnds,
  };
}

/** Converts the provider's character alignment into real word timings without estimating cadence. */
export function wordsFromElevenLabsAlignment(alignment: ElevenLabsCharacterAlignment): ElevenLabsWordTimestamp[] {
  const words: ElevenLabsWordTimestamp[] = [];
  let index = 0;
  while (index < alignment.characters.length) {
    while (index < alignment.characters.length && /\s/u.test(alignment.characters[index] ?? '')) index += 1;
    const startIndex = index;
    while (index < alignment.characters.length && !/\s/u.test(alignment.characters[index] ?? '')) index += 1;
    const endIndex = index;
    if (endIndex <= startIndex) continue;
    const startSeconds = alignment.character_start_times_seconds[startIndex] ?? -1;
    const endSeconds = alignment.character_end_times_seconds[endIndex - 1] ?? -1;
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue;
    words.push({
      text: alignment.characters.slice(startIndex, endIndex).join(''),
      startMs: Math.round(startSeconds * 1_000),
      endMs: Math.round(endSeconds * 1_000),
    });
  }
  if (words.length === 0) throw new Error('ElevenLabs não retornou palavras com duração positiva.');
  return words;
}

/** Synthesizes PCM and returns the provider's character-accurate alignment for caption compilation. */
export async function synthesizeElevenLabsWavWithTimestamps(input: ElevenLabsSynthesisInput): Promise<ElevenLabsTimestampedSynthesis> {
  const url =
    `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps` +
    `?output_format=${ELEVENLABS_PCM_FORMAT}`;
  const send = input.fetch ?? fetch;
  const res = await send(url, {
    method: 'POST',
    headers: {
      'xi-api-key': input.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.modelId || ELEVENLABS_DEFAULT_MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      ...(input.languageCode ? { language_code: input.languageCode } : {}),
    }),
    signal: input.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthorized: API Key do ElevenLabs inválida.');
    if (res.status === 403) throw new Error('forbidden: Conta ElevenLabs sem acesso ao alinhamento.');
    if (res.status === 422) throw new Error('validation: Texto ou parâmetros inválidos para o ElevenLabs.');
    if (res.status === 429) throw new Error('rate_limited: Limite de caracteres/requisições do ElevenLabs atingido.');
    throw new Error(`ElevenLabs TTS com alinhamento falhou: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as Record<string, unknown>;
  const audioBase64 = typeof payload.audio_base64 === 'string' ? payload.audio_base64 : '';
  if (!audioBase64) throw new Error('ElevenLabs TTS com alinhamento retornou áudio vazio.');
  const alignment = parseAlignment(payload.alignment ?? payload.normalized_alignment);
  const pcm = Buffer.from(audioBase64, 'base64');
  if (pcm.byteLength < 1_024) throw new Error('ElevenLabs TTS com alinhamento retornou áudio vazio.');
  writeFileSync(input.outWavPath, wrapPcm16AsWav(pcm));
  return { alignment, words: wordsFromElevenLabsAlignment(alignment) };
}
