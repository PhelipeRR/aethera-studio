import { describe, expect, it } from 'vitest';
import { applyDirectorRules, defaultAetheraPresets, type TimelineDocument } from '../src/index.js';

const timeline: TimelineDocument = {
  schemaVersion: 1, id: 'timeline-director', runId: 'run-director', version: 1,
  basedOn: { storyboardVersion: 1, directorPlanVersion: 1, presetId: 'top-10-dynamic', presetVersion: 1 },
  format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, fps: 30, durationMs: 6_000,
  tracks: [
    { id: 'video', kind: 'video', label: 'Vídeo', locked: false, muted: false, hidden: false, items: [{ id: 'video:scene-1', startMs: 0, durationMs: 3_000, sceneIds: ['scene-1'], label: 'Gameplay', source: { kind: 'media', assetId: 'asset-1', inMs: 1_000, outMs: 4_000, speed: 1, volume: 0 }, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [], intent: { reason: 'Mostrar gameplay' } }, { id: 'video:scene-2', startMs: 3_000, durationMs: 3_000, sceneIds: ['scene-2'], label: 'Gameplay 2', source: { kind: 'media', assetId: 'asset-2', inMs: 2_000, outMs: 5_000, speed: 1, volume: 0 }, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [], intent: { reason: 'Mostrar gameplay 2' } }] },
    { id: 'graphics', kind: 'graphics', label: 'Gráficos', locked: false, muted: false, hidden: false, items: [] },
    { id: 'text', kind: 'text', label: 'Texto', locked: false, muted: false, hidden: false, items: [] },
    { id: 'captions', kind: 'captions', label: 'Legendas', locked: false, muted: false, hidden: false, items: [] },
    { id: 'narration', kind: 'narration', label: 'Narração', locked: false, muted: false, hidden: false, items: [] },
    { id: 'music', kind: 'music', label: 'Música', locked: false, muted: false, hidden: false, items: [] },
    { id: 'sfx', kind: 'sfx', label: 'SFX', locked: false, muted: false, hidden: false, items: [] },
  ], markers: [], audio: { targetLufs: -14, truePeakDb: -1, musicDuckDb: -12, duck: { attackMs: 80, releaseMs: 250 }, stems: { narration: 0, music: -12, sfx: 0 } },
};

describe('Aethera AP-06 DirectorRules', () => {
  it('ships eight deterministic preset grammars and produces the same plan twice', () => {
    expect(defaultAetheraPresets).toHaveLength(8);
    const preset = defaultAetheraPresets.find((item) => item.id === 'top-10-dynamic');
    if (!preset) throw new Error('preset missing');
    const first = applyDirectorRules({ timeline, preset });
    const second = applyDirectorRules({ timeline, preset });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.sceneDirections).toHaveLength(2);
    expect(first.sceneDirections[0]?.shotPlan).toContain('push-in');
    expect(first.sceneDirections.every((direction) => direction.shotPlan.length > 0)).toBe(true);
  });

  it('never exceeds transition, effect or SFX budgets', () => {
    const preset = defaultAetheraPresets.find((item) => item.id === 'top-10-dynamic');
    if (!preset) throw new Error('preset missing');
    const plan = applyDirectorRules({ timeline, preset });
    expect(plan.budgets.transitionsPerMinute).toBe(preset.transitions.maxPerMinute);
    expect(plan.sceneDirections.flatMap((direction) => direction.sound).filter((item) => item === 'sfx-transition').length).toBeLessThanOrEqual(preset.sound.maxSfxPerMinute);
    expect(plan.sceneDirections.flatMap((direction) => direction.shotPlan).filter((item) => item === 'push-in').length).toBeLessThanOrEqual(preset.camera.maxEffectsPerMinute);
    expect(plan.sceneDirections.every((direction) => !!direction.intent)).toBe(true);
  });
});
