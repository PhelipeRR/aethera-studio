import { describe, expect, it } from 'vitest';
import {
  AUDIOVISUAL_FORMATS,
  CONTENT_CATEGORIES,
  DEFAULT_CREATIVE_SELECTION,
  DELIVERY_PRESETS,
  composeDirectionProfile,
  detectCreativeSelection,
  detectDeliveryPreset,
  groupFormatsByCategory,
  migrateLegacyCreativeSelection,
  planDeliveryExports,
  resolveDeliveryProfile,
  searchAudiovisualFormats,
  synchronizeProductionCreativeContract,
  validateCustomDeliveryPreset,
} from '../src/index.js';

describe('Aethera audiovisual format catalog', () => {
  it('contains at least 60 searchable formats across every requested category', () => {
    expect(AUDIOVISUAL_FORMATS.length).toBeGreaterThanOrEqual(60);
    const grouped = groupFormatsByCategory(AUDIOVISUAL_FORMATS);
    for (const category of CONTENT_CATEGORIES) {
      expect(grouped[category.id]?.length, category.label).toBeGreaterThan(0);
    }
    expect(AUDIOVISUAL_FORMATS.every((format) => format.description.length > 20)).toBe(true);
    expect(AUDIOVISUAL_FORMATS.every((format) => format.profile.qualityCriteria.length >= 3)).toBe(true);
  });

  it('searches by label, description and aliases without losing category grouping', () => {
    const results = searchAudiovisualFormats('boss fight', { categoryId: 'games' });
    expect(results.some((format) => format.id === 'boss-analysis')).toBe(true);
    expect(searchAudiovisualFormats('apresentação executiva', { categoryId: 'professional-production' }).length).toBeGreaterThan(0);
  });

  it('detects independent narrative, content and aesthetic dimensions from a prompt', () => {
    const resolved = detectCreativeSelection('Faça um documentário sobre anime e mangá com linguagem cinematográfica para um podcast em vídeo.');
    expect(resolved.narrativeFormatId).toBe('documentary');
    expect(resolved.contentCategoryId).toBe('anime-manga');
    expect(resolved.aestheticDirectionId).toBe('cinematic');
  });

  it('composes a hybrid direction profile instead of forcing a single preset', () => {
    const profile = composeDirectionProfile({
      ...DEFAULT_CREATIVE_SELECTION,
      narrativeFormatId: 'documentary',
      contentCategoryId: 'anime-manga',
      aestheticDirectionId: 'cinematic',
    });
    expect(profile.structure.length).toBeGreaterThan(2);
    expect(profile.researchMedia.strategy).toMatch(/obra|fonte|visual/i);
    expect(profile.motionGraphics).toMatchObject({ language: expect.any(String) });
    expect(profile.soundMix.music).toMatch(/cinem/i);
  });

  it('resolves professional delivery presets with independent preview and master targets', () => {
    expect(DELIVERY_PRESETS.some((preset) => preset.id === 'youtube-4k')).toBe(true);
    expect(DELIVERY_PRESETS.some((preset) => preset.id === 'feed-4-5')).toBe(true);
    expect(DELIVERY_PRESETS.some((preset) => preset.id === 'cinema-scope')).toBe(true);
    const resolved = resolveDeliveryProfile({ presetId: 'youtube-4k', previewProfile: 'review_720p' });
    expect(resolved.master.width).toBe(3840);
    expect(resolved.master.height).toBe(2160);
    expect(resolved.preview.width).toBe(1280);
    expect(resolved.preview.height).toBe(720);
    expect(resolved.audio.integratedLufs).toBe(-14);
  });

  it('rejects invalid custom delivery dimensions and unsupported codecs', () => {
    const result = validateCustomDeliveryPreset({
      id: 'custom-invalid',
      label: 'Inválido',
      platform: 'custom',
      aspectRatio: '4:5',
      width: 1920,
      height: 1080,
      fps: 60,
      videoCodec: 'prores',
      audioCodec: 'aac',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/proporção|codec/i);
  });

  it('keeps manual values, reports conflicts, and migrates legacy controls', () => {
    const migrated = migrateLegacyCreativeSelection({ genre: 'top_list', format: 'shorts_9_16' });
    expect(migrated.creativeSelection.narrativeFormatId).toBe('top-list');
    expect(migrated.deliveryPresetId).toBe('shorts');
    const contract = synchronizeProductionCreativeContract({
      prompt: 'Documentário cinematográfico sobre anime em 4K.',
      selection: { ...DEFAULT_CREATIVE_SELECTION, narrativeFormatId: 'trailer' },
      deliveryPresetId: 'shorts',
      manualFields: ['narrativeFormatId', 'deliveryPresetId'],
    });
    expect(contract.effectiveSelection.narrativeFormatId).toBe('trailer');
    expect(contract.effectiveDeliveryPresetId).toBe('shorts');
    expect(contract.conflicts.map((conflict) => conflict.field)).toEqual(expect.arrayContaining(['narrativeFormatId', 'deliveryPresetId']));
  });

  it('plans multiple exports while declaring reusable material and cache compatibility', () => {
    const plan = planDeliveryExports({ presetIds: ['youtube-1080p', 'youtube-1080p', 'shorts'], previewProfile: 'review_720p' });
    expect(plan).toHaveLength(3);
    expect(plan[0]?.reuseSourceMaterial).toBe(true);
    expect(plan[0]?.reuseTimeline).toBe(true);
    expect(plan[1]?.reuseSceneRender).toBe(true);
    expect(plan[2]?.reuseSceneRender).toBe(false);
    expect(plan[2]?.cacheCompatibilityKey).toContain('1080x1920@30');
  });
});
