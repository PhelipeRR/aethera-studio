import { describe, expect, it } from 'vitest';
import { type StoryboardScene, applyStoryboardEdit, buildTimeline, clipSplitPoint, retimeFromAudio } from '../src/index.js';

const scene = (id: string, narration: string, durationMs?: number, extra: Partial<StoryboardScene> = {}): StoryboardScene => ({
  id, chapter: null, narration, startMs: 0, endMs: 1, claimIds: [], visualObjective: '', sceneType: 'broll', searchTerms: [], visual: { type: 'fallback', kind: 'typography', reason: '' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending',
  ...(durationMs ? { audio: { relativePath: `c/${id}.wav`, durationMs, key: id, words: narration.split(' ').map((w, index) => ({ w, startMs: index * 300, endMs: index * 300 + 250 })) } } : {}),
  ...extra,
});

describe('measured clock without speaking again', () => {
  it('retimes from clip durations and cuts between words', () => {
    const timed = retimeFromAudio([scene('a', 'Um dois.', 1_000), scene('b', 'Três quatro.', 1_500)]);
    expect(timed?.map((item) => [item.startMs, item.endMs])).toEqual([[0, 1_000], [1_000, 2_500]]);
    expect(retimeFromAudio([scene('a', 'Um.', 1_000), scene('b', 'Dois.')])).toBeNull();
    const audio = scene('a', 'Um dois três quatro', 1_200).audio;
    if (!audio) throw new Error('sem áudio');
    expect(clipSplitPoint(audio, 2)).toBe(Math.round((550 + 600) / 2));
    expect(clipSplitPoint(audio, 4)).toBeNull();
  });

  it('keeps a move on the measured clock and re-keys the narration', () => {
    const storyboard = { schemaVersion: 1 as const, timing: 'measured' as const, narrationKey: 'old', scenes: retimeFromAudio([scene('a', 'Um dois.', 1_000), scene('b', 'Três quatro.', 1_500)]) ?? [] };
    const moved = applyStoryboardEdit(storyboard, { op: 'move', sceneId: 'a', toIndex: 1 }, { pace: 'standard', candidates: [], makeId: () => 'x' });
    expect(moved).toMatchObject({ timing: 'measured' });
    expect(moved.narrationKey).not.toBe('old');
    expect(moved.scenes.map((item) => [item.id, item.startMs, item.endMs])).toEqual([['b', 0, 1_500], ['a', 1_500, 2_500]]);
    // A split without the audio port cannot keep the clip: estimated until the service cuts it or a new sync.
    const split = applyStoryboardEdit({ ...storyboard, scenes: retimeFromAudio([scene('c', 'Um dois. Três quatro.', 2_000)]) ?? [] }, { op: 'duplicate', sceneId: 'c' }, { pace: 'standard', candidates: [], makeId: () => 'd' });
    expect(split.timing).toBe('estimated');
    expect(split.scenes.every((item) => !item.audio)).toBe(true);
  });
});

describe('multitrack timeline', () => {
  it('lays scenes on tracks with rights, claim and lock markers and captions from clip words', () => {
    const scenes = retimeFromAudio([
      scene('a', 'Primeira frase. Segunda frase.', 2_000, { onScreenText: 'Título', locked: true }),
      scene('b', 'Com mídia.', 1_000, { visual: { type: 'asset', referenceId: 'r', title: 'Vídeo do acervo', kind: 'video', score: 1, reason: '' } }),
    ]) ?? [];
    const timeline = buildTimeline({ scenes, issues: [{ sceneId: 'b', code: 'unauthorized_asset', message: '' }, { sceneId: 'a', code: 'unsupported_claim', message: '' }], timing: 'measured' });
    const track = (id: string) => timeline.tracks.find((item) => item.id === id);
    expect(timeline.durationMs).toBe(3_000);
    expect(track('video')?.items.map((item) => [item.label, item.markers])).toEqual([['Vídeo do acervo', ['rights']]]);
    expect(track('graphics')?.items[0]?.markers).toEqual(['claim', 'locked']);
    expect(track('text')?.items.map((item) => item.label)).toEqual(['Título']);
    expect(track('captions')?.items.map((item) => [item.label, item.startMs])).toEqual([['Primeira frase.', 0], ['Segunda frase.', 600], ['Com mídia.', 2_000]]);
    expect(track('music')).toMatchObject({ planned: true, items: [] });
  });
});
