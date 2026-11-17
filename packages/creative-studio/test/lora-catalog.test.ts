import { describe, expect, it } from 'vitest';
import {
  buildLoraCatalog,
  filterLoraCatalog,
  normalizeLoraStack,
  parseSafetensorsLoraMetadata,
  selectLorasForPrompt,
} from '../src/lora-catalog.js';

describe('LoRA catalog and compatibility', () => {
  it('keeps filename-only entries unverified and refuses automatic selection', () => {
    const catalog = buildLoraCatalog(['character/goku.safetensors'], 'animagine-xl-3.1.safetensors');

    expect(catalog[0]).toMatchObject({
      model: 'character/goku.safetensors',
      architecture: 'unknown',
      compatibility: 'unknown',
      metadataVerified: false,
    });
    expect(selectLorasForPrompt('Goku dramatic anime battle', catalog)).toMatchObject({ selected: [] });
  });

  it('selects only verified compatible metadata matches with conservative strengths', () => {
    const catalog = buildLoraCatalog(
      ['styles/cyberpunk.safetensors', 'styles/sd15-only.safetensors'],
      'animagine-xl-3.1.safetensors',
      {
        'styles/cyberpunk.safetensors': { architecture: 'sdxl', category: 'effects', triggerWords: ['cyberpunk', 'neon'] },
        'styles/sd15-only.safetensors': { architecture: 'sd15', category: 'style', triggerWords: ['anime'] },
      },
    );

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'styles/cyberpunk.safetensors', compatibility: 'compatible', metadataVerified: true, priority: 'optional', purpose: expect.stringContaining('efeitos') }),
      expect.objectContaining({ model: 'styles/sd15-only.safetensors', compatibility: 'incompatible', priority: 'medium' }),
    ]));
    expect(selectLorasForPrompt('cinematic cyberpunk neon thumbnail', catalog)).toMatchObject({
      selected: [{ model: 'styles/cyberpunk.safetensors', strengthModel: 0.45, strengthClip: 0.35 }],
    });
  });

  it('filters by model name, tags, and activation words without inventing entries', () => {
    const catalog = buildLoraCatalog(
      ['characters/hero.safetensors', 'styles/soft-light.safetensors'],
      'animagine-xl-3.1.safetensors',
      {
        'characters/hero.safetensors': { architecture: 'sdxl', category: 'character', triggerWords: ['silver hero'] },
        'styles/soft-light.safetensors': { architecture: 'sdxl', category: 'lighting', triggerWords: ['soft light'] },
      },
    );

    expect(filterLoraCatalog(catalog, 'silver hero')).toHaveLength(1);
    expect(filterLoraCatalog(catalog, 'not-installed')).toEqual([]);
  });

  it('parses safetensors metadata without claiming architecture when absent', () => {
    expect(parseSafetensorsLoraMetadata(JSON.stringify({ __metadata__: {
      ss_base_model_version: 'sdxl_base_v1-0',
      ss_trigger_words: 'cyberpunk, neon',
    } }))).toMatchObject({ architecture: 'sdxl', triggerWords: ['cyberpunk', 'neon'], metadataVerified: true });
    expect(parseSafetensorsLoraMetadata(JSON.stringify({ __metadata__: { ss_network_dim: '32' } }))).toMatchObject({ architecture: 'unknown', metadataVerified: false });
  });

  it('bounds and deduplicates a manual LoRA stack', () => {
    expect(normalizeLoraStack([
      { model: 'a.safetensors', strengthModel: 0.5, strengthClip: 0.4 },
      { model: 'a.safetensors', strengthModel: 0.9, strengthClip: 0.9 },
      { model: 'b.safetensors', strengthModel: 2, strengthClip: -2 },
      { model: 'c.safetensors', strengthModel: 0.8, strengthClip: 0.8 },
    ], 2)).toEqual([
      { model: 'a.safetensors', strengthModel: 0.5, strengthClip: 0.4 },
      { model: 'b.safetensors', strengthModel: 2, strengthClip: -2 },
    ]);
    expect(() => normalizeLoraStack([{ model: '../outside.safetensors' }])).toThrow(/relativo/);
    expect(() => normalizeLoraStack([{ model: 'C:/outside.safetensors' }])).toThrow(/relativo/);
  });
});
