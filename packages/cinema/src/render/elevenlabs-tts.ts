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
