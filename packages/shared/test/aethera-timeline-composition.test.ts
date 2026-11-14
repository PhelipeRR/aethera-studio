import { describe, expect, it } from 'vitest';
import { AETHERA_COMPOSITION_VERSION, aetheraTimelineSegmentKey, aetheraTimelineSegments, applyTimelineOps, assembleTimeline, avoidableFlatBackgroundSceneIds, captionCuesSrt, compileAetheraTimeline, timelineCaptionCues, type Storyboard } from '../src/index.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1,
  timing: 'measured',
  narrationKey: 'narration-v1',
  scenes: [
    {
      id: 'scene-1', chapter: 1, narration: 'Uma cena de jogo.', startMs: 0, endMs: 2_000, claimIds: [],
      visualObjective: 'Mostrar combate', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['combate'],
      visual: { type: 'asset', referenceId: 'asset-1', title: 'Combate', kind: 'video', score: 0.95, reason: 'match', match: {
        sceneId: 'scene-1', sentenceIds: ['scene-1'], segmentId: 'segment-1', assetId: 'asset-1', sourceStartMs: 10_000, sourceEndMs: 12_000,
        confidence: 0.95, confidenceBand: 'automatic', score: 0.95, breakdown: { semantic: 0.95, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'cena correta',
      } },
      onScreenText: 'Combate', transition: 'fade', camera: 'push-in', locked: false, reviewStatus: 'approved',
      audio: { relativePath: 'audio/scene-1.wav', durationMs: 2_000, key: 'narration-1', words: [{ w: 'Uma', startMs: 0, endMs: 300 }, { w: 'cena', startMs: 300, endMs: 700 }] },
    },
    {
      id: 'scene-2', chapter: 1, narration: 'Uma composição gráfica.', startMs: 2_000, endMs: 4_000, claimIds: [],
      visualObjective: 'Destacar o contexto', subjectId: 'game-1', sceneType: 'animation', searchTerms: ['contexto'],
      visual: { type: 'fallback', kind: 'animation', reason: 'sem mídia aprovada' },
      onScreenText: 'Contexto', transition: 'slide', camera: 'pan', locked: false, reviewStatus: 'approved',
      audio: { relativePath: 'audio/scene-2.wav', durationMs: 2_000, key: 'narration-2', words: [{ w: 'Uma', startMs: 0, endMs: 250 }, { w: 'composição', startMs: 250, endMs: 800 }] },
    },
  ],
});

const format = { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } as const;

describe('Aethera AP-04 timeline composition', () => {
  it('compiles the same deterministic multilayer props for preview and render', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const preview = compileAetheraTimeline(timeline, { fromMs: 0, durationMs: 4_000 });
    const render = compileAetheraTimeline(timeline, { fromMs: 0, durationMs: 4_000 });

    expect(JSON.stringify(preview)).toBe(JSON.stringify(render));
    expect(preview.compositionId).toBe('aethera-timeline');
    expect(preview.layers.map((layer) => layer.trackKind)).toEqual(expect.arrayContaining(['video', 'graphics', 'text', 'captions', 'narration']));
    const video = preview.layers.find((layer) => layer.clipId === 'video:scene-1');
    expect(video).toMatchObject({ source: { kind: 'media', assetId: 'asset-1', inMs: 10_000, outMs: 12_000 } });
    expect(video?.keyframes.some((keyframe) => keyframe.property === 'scale' && keyframe.value === 1.08)).toBe(true);
    expect(preview.layers.find((layer) => layer.clipId === 'captions:scene-1')?.words).toEqual([{ text: 'Uma', startMs: 0, endMs: 300 }, { text: 'cena', startMs: 300, endMs: 700 }]);
    expect(preview.layers.find((layer) => layer.clipId === 'graphics:scene-2')).toMatchObject({ exit: { id: 'slide' }, source: { kind: 'graphic' } });
    expect(preview.background.kind).toBe('gradient');
    expect(preview.layers.every((layer) => layer.durationInFrames > 0)).toBe(true);
  });

  it('compiles only the requested render window with stable source cuts', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const window = compileAetheraTimeline(timeline, { fromMs: 1_000, durationMs: 2_000 });
    const video = window.layers.find((layer) => layer.clipId === 'video:scene-1');
    expect(video).toMatchObject({ startFrame: 0, durationInFrames: 30, source: { kind: 'media', inMs: 11_000, outMs: 12_000 } });
    expect(window.layers.some((layer) => layer.clipId === 'graphics:scene-2')).toBe(true);
  });

  it('creates cacheable narration segments and invalidates only when the window or proxy changes', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const segments = aetheraTimelineSegments(timeline);
    expect(segments.map(({ fromMs, durationMs }) => [fromMs, durationMs])).toEqual([[0, 2_000], [2_000, 2_000]]);
    const firstWindow = { fromMs: segments[0]?.fromMs ?? 0, durationMs: segments[0]?.durationMs ?? 0 };
    expect(aetheraTimelineSegmentKey(timeline, firstWindow, new Map([['asset-1', 'proxy-a']]))).not.toBe(aetheraTimelineSegmentKey(timeline, firstWindow, new Map([['asset-1', 'proxy-b']])));
    expect(segments[0]?.key).not.toBe(segments[1]?.key);
  });

  it('keeps the key of an untouched window when another window is edited', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const before = aetheraTimelineSegments(timeline);
    const edited = applyTimelineOps(timeline, [{ op: 'setText', selector: { clipIds: ['text:scene-2'] }, text: 'Contexto revisto' }], { author: 'user' }).document;
    const after = aetheraTimelineSegments(edited);
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[1]?.key).not.toBe(before[1]?.key);
    const proxyOnlyForSceneOne = new Map([['asset-other', 'proxy-x']]);
    expect(aetheraTimelineSegmentKey(timeline, { fromMs: 0, durationMs: 2_000 }, proxyOnlyForSceneOne)).toBe(aetheraTimelineSegmentKey(timeline, { fromMs: 0, durationMs: 2_000 }));
    // renderAetheraTimelineSegments passes the whole segment (index, key) as the window.
    const segment = before[0];
    if (!segment) throw new Error('fixture');
    expect(aetheraTimelineSegmentKey(timeline, segment)).toBe(segment.key);
  });

  it('puts on-screen text over blurred footage of the same subject instead of a flat background (D-AP-17)', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const backdrop = timeline.tracks.find((track) => track.kind === 'video')?.items.find((clip) => clip.id === 'video:backdrop:scene-2');
    expect(backdrop).toMatchObject({ startMs: 2_000, durationMs: 2_000, sceneIds: ['scene-2'], subjectId: 'game-1', source: { kind: 'media', assetId: 'asset-1', inMs: 10_000, outMs: 12_000, volume: 0 } });
    expect(backdrop?.effects.map((effect) => effect.id)).toEqual(['blur', 'color']);
    expect(backdrop?.intent?.reason).toMatch(/mesmo assunto/iu);
    expect(avoidableFlatBackgroundSceneIds(timeline)).toEqual([]);

    const unrelated = storyboard();
    const second = unrelated.scenes[1];
    if (!second) throw new Error('fixture');
    unrelated.scenes[1] = { ...second, subjectId: 'game-2' };
    const flat = assembleTimeline({ runId: 'run-ap04', storyboard: unrelated, format });
    expect(flat.tracks.find((track) => track.kind === 'video')?.items.some((clip) => clip.id === 'video:backdrop:scene-2')).toBe(false);
    expect(avoidableFlatBackgroundSceneIds(flat)).toEqual([]);

    const removed = applyTimelineOps(timeline, [{ op: 'delete', selector: { clipIds: ['video:backdrop:scene-2'] } }], { author: 'user' }).document;
    expect(avoidableFlatBackgroundSceneIds(removed)).toEqual(['scene-2']);
  });

  it('backs a scene without subject (opening, closing) with the nearest footage of the video and never shows internal reasons on screen', () => {
    const general = storyboard();
    const second = general.scenes[1];
    if (!second) throw new Error('fixture');
    const withoutSubject = { ...second };
    delete withoutSubject.subjectId;
    general.scenes[1] = { ...withoutSubject, visual: { type: 'fallback', kind: 'animation', reason: 'Nenhum trecho com identidade verificada e confiança calibrada combina com a cena.' } };
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: general, format });
    const backdrop = timeline.tracks.find((track) => track.kind === 'video')?.items.find((clip) => clip.id === 'video:backdrop:scene-2');
    expect(backdrop).toMatchObject({ source: { kind: 'media', assetId: 'asset-1' } });
    expect(backdrop).not.toHaveProperty('subjectId');
    expect(backdrop?.intent?.reason).toMatch(/tema do vídeo/iu);
    const graphic = timeline.tracks.find((track) => track.kind === 'graphics')?.items.find((clip) => clip.sceneIds.includes('scene-2'));
    expect(JSON.stringify(graphic?.source)).not.toMatch(/identidade verificada/iu);
    const removed = applyTimelineOps(timeline, [{ op: 'delete', selector: { clipIds: ['video:backdrop:scene-2'] } }], { author: 'user' }).document;
    expect(avoidableFlatBackgroundSceneIds(removed)).toEqual(['scene-2']);
  });

  it('marks illustrative or reconstructed footage manually and carries the badge into the composition', () => {
    const timeline = assembleTimeline({ runId: 'run-ap04', storyboard: storyboard(), format });
    const result = applyTimelineOps(timeline, [{ op: 'setDepiction', selector: { clipIds: ['video:scene-1'] }, depiction: 'illustrative' }], { author: 'user' });
    expect(result.change.affectedClipIds).toEqual(['video:scene-1']);
    const layer = compileAetheraTimeline(result.document, { fromMs: 0, durationMs: 2_000 }).layers.find((item) => item.clipId === 'video:scene-1');
    expect(layer?.depiction).toBe('illustrative');
    const cleared = applyTimelineOps(result.document, [{ op: 'setDepiction', selector: { clipIds: ['video:scene-1'] }, depiction: 'real_record' }], { author: 'user' }).document;
    expect(compileAetheraTimeline(cleared, { fromMs: 0, durationMs: 2_000 }).layers.find((item) => item.clipId === 'video:scene-1')?.depiction).toBe('real_record');
    expect(compileAetheraTimeline(timeline, { fromMs: 0, durationMs: 2_000 }).layers.find((item) => item.clipId === 'video:scene-1')).not.toHaveProperty('depiction');
  });

  it('keys rendered segments by the composition version too, so a visual fix never reuses old frames', () => {
    const timeline = assembleTimeline({ runId: 'run-key', storyboard: storyboard(), format });
    const key = aetheraTimelineSegmentKey(timeline, { fromMs: 0, durationMs: 2_000 });
    expect(AETHERA_COMPOSITION_VERSION).toBeGreaterThanOrEqual(2);
    expect(key).toMatch(/^[0-9a-f]{16}$/u);
    // Deterministic for the same timeline and version.
    expect(aetheraTimelineSegmentKey(timeline, { fromMs: 0, durationMs: 2_000 })).toBe(key);
  });

  it('gives each caption layer only the reading cues of its clip, the same ones exported as SubRip, and nothing for a pause (E3)', () => {
    const base = storyboard();
    // Scene 1 (0–2 s): "Três jogos." then a 600 ms pause, then the rest; scene 2 keeps its own words from 2 s.
    const spoken = (text: string, gapAt: number) => text.split(' ').map((w, index) => ({ w, startMs: index * 200 + (index >= gapAt ? 600 : 0), endMs: index * 200 + 160 + (index >= gapAt ? 600 : 0) }));
    const scenes = base.scenes.map((scene, index) => ({ ...scene, narration: index === 0 ? 'Três jogos. Três jeitos de prender você.' : scene.narration, ...(index === 0 && scene.audio ? { audio: { ...scene.audio, words: spoken('Três jogos. Três jeitos de prender você.', 2) } } : {}) }));
    const timeline = assembleTimeline({ runId: 'run-e3', storyboard: { ...base, scenes }, format });
    const all = timelineCaptionCues(timeline);
    const props = compileAetheraTimeline(timeline, { fromMs: 0, durationMs: 2_000 });
    const layer = props.layers.find((item) => item.clipId === 'captions:scene-1');
    expect(layer?.cues?.map((cue) => cue.lines.join(' '))).toEqual(['Três jogos.', 'Três jeitos de prender você.']);
    expect(layer?.cues).toEqual(all.filter((cue) => cue.startMs < 2_000).map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs, lines: cue.lines })));
    // The window of scene 2 draws scene 2's cue on its own clock (starting at 0), not scene 1's text.
    const later = compileAetheraTimeline(timeline, { fromMs: 2_000, durationMs: 2_000 }).layers.find((item) => item.clipId === 'captions:scene-2');
    expect(later?.cues?.[0]).toMatchObject({ startMs: 0, lines: ['Uma composição'] });
    // The pause after "jogos." keeps the first cue only for its reading time, then shows nothing: never the paragraph.
    const first = layer?.cues?.[0];
    const second = layer?.cues?.[1];
    expect(first && second && second.startMs - first.endMs).toBeGreaterThanOrEqual(80);
    expect(captionCuesSrt(all).split('\n\n')).toHaveLength(all.length);
    expect(props.layers.filter((item) => item.trackKind !== 'captions').every((item) => item.cues === undefined)).toBe(true);
  });
});
