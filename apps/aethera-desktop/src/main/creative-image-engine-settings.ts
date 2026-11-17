import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeComfyUiBaseUrl } from '@neuralbridge/creative-studio';
import { getProfessionalPreset, type ProfessionalPresetId } from '@neuralbridge/creative-studio';

export interface CreativeImageEngineSettings {
  endpoint: string;
  checkpoint: string;
  preferredPreset: ProfessionalPresetId;
  releaseMemoryAfterGeneration: boolean;
  autoStartComfyUi: boolean;
}

export const DEFAULT_CREATIVE_IMAGE_ENGINE_SETTINGS: CreativeImageEngineSettings = {
  endpoint: 'http://127.0.0.1:8000',
  checkpoint: 'sd_xl_base_1.0.safetensors',
  preferredPreset: 'youtube_thumbnail_1280x720',
  releaseMemoryAfterGeneration: false,
  autoStartComfyUi: false,
};

function isProfessionalPreset(value: unknown): value is ProfessionalPresetId {
  if (typeof value !== 'string') return false;
  try {
    return Boolean(getProfessionalPreset(value as ProfessionalPresetId));
  } catch {
    return false;
  }
}

export function normalizeCreativeImageEngineSettings(
  input: unknown,
  base: CreativeImageEngineSettings = DEFAULT_CREATIVE_IMAGE_ENGINE_SETTINGS,
): CreativeImageEngineSettings {
  if (!input || typeof input !== 'object') return { ...base };
  const raw = input as Record<string, unknown>;
  const next = { ...base };
  if ('endpoint' in raw) {
    if (typeof raw['endpoint'] !== 'string') throw new Error('Endpoint do ComfyUI deve ser uma URL.');
    next.endpoint = normalizeComfyUiBaseUrl(raw['endpoint']);
  }
  if ('checkpoint' in raw) {
    if (typeof raw['checkpoint'] !== 'string' || !raw['checkpoint'].trim() || raw['checkpoint'].includes('..') || raw['checkpoint'].includes('\\')) {
      throw new Error('Checkpoint inválido: use apenas o nome relativo reportado pelo ComfyUI.');
    }
    next.checkpoint = raw['checkpoint'].trim().slice(0, 240);
  }
  if ('preferredPreset' in raw) {
    if (!isProfessionalPreset(raw['preferredPreset'])) throw new Error('Preset profissional desconhecido.');
    next.preferredPreset = raw['preferredPreset'];
  }
  if ('releaseMemoryAfterGeneration' in raw) {
    if (typeof raw['releaseMemoryAfterGeneration'] !== 'boolean') throw new Error('A opção de liberar VRAM deve ser booleana.');
    next.releaseMemoryAfterGeneration = raw['releaseMemoryAfterGeneration'];
  }
  if ('autoStartComfyUi' in raw) {
    if (typeof raw['autoStartComfyUi'] !== 'boolean') throw new Error('A opção de iniciar o ComfyUI automaticamente deve ser booleana.');
    next.autoStartComfyUi = raw['autoStartComfyUi'];
  }
  return next;
}

export class CreativeImageEngineSettingsStore {
  private cached: CreativeImageEngineSettings | null = null;

  constructor(private readonly file: string) {}

  load(): CreativeImageEngineSettings {
    if (this.cached) return { ...this.cached };
    let settings = { ...DEFAULT_CREATIVE_IMAGE_ENGINE_SETTINGS };
    if (existsSync(this.file)) {
      try {
        settings = normalizeCreativeImageEngineSettings(JSON.parse(readFileSync(this.file, 'utf8')));
      } catch {
        // Corrupt hand-edited settings fall back to safe loopback defaults until saved again.
      }
    }
    this.cached = settings;
    return { ...settings };
  }

  save(input: unknown): CreativeImageEngineSettings {
    const next = normalizeCreativeImageEngineSettings(input, this.load());
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8');
    this.cached = next;
    return { ...next };
  }
}
