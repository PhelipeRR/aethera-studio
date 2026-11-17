import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreativeImageEngineSettingsStore,
  DEFAULT_CREATIVE_IMAGE_ENGINE_SETTINGS,
  normalizeCreativeImageEngineSettings,
} from '../src/main/creative-image-engine-settings.js';

describe('CreativeImageEngineSettingsStore', () => {
  it('persists validated local engine settings and preserves defaults for missing fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'aethera-image-settings-'));
    try {
      const store = new CreativeImageEngineSettingsStore(join(root, 'image-engine.json'));
      expect(store.load()).toEqual(DEFAULT_CREATIVE_IMAGE_ENGINE_SETTINGS);
      const saved = store.save({ checkpoint: 'models/sdxl.safetensors', preferredPreset: 'cyberpunk_neon', releaseMemoryAfterGeneration: true, autoStartComfyUi: true });
      expect(saved).toMatchObject({ checkpoint: 'models/sdxl.safetensors', preferredPreset: 'cyberpunk_neon', releaseMemoryAfterGeneration: true, autoStartComfyUi: true });
      expect(new CreativeImageEngineSettingsStore(join(root, 'image-engine.json')).load()).toEqual(saved);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects non-loopback endpoints and unknown presets', () => {
    expect(() => normalizeCreativeImageEngineSettings({ endpoint: 'http://192.168.1.5:8188' })).toThrow(/loopback/i);
    expect(() => normalizeCreativeImageEngineSettings({ preferredPreset: 'unknown' })).toThrow(/preset/i);
    expect(() => normalizeCreativeImageEngineSettings({ autoStartComfyUi: 'yes' })).toThrow(/iniciar.*booleana/i);
  });
});
