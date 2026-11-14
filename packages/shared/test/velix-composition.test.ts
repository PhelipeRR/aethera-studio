import { describe, expect, it } from 'vitest';
import {
  type LocalMedia,
  type Storyboard,
  type StoryboardScene,
  type VideoProbe,
  VIDEO_FORMATS,
  captionLines,
  compositionPlan,
  frameBounds,
  qualityChecks,
  qualityExportable,
  selectMotionBackgroundCandidates,
  segmentKey,
  subtitlesSrt,
} from '../src/index.js';

const format = (id: keyof typeof VIDEO_FORMATS) => { const { id: formatId, width, height, fps, aspectRatio, safeArea } = VIDEO_FORMATS[id]; return { id: formatId, width, height, fps, aspectRatio, safeArea }; };
const scene = (id: string, startMs: number, endMs: number, visual: StoryboardScene['visual'] = { type: 'fallback', kind: 'typography', reason: '' }): StoryboardScene => ({ id, chapter: null, narration: `Narração da cena ${id}.`, startMs, endMs, claimIds: [], visualObjective: 'Mostrar: algo', sceneType: 'broll', searchTerms: [], visual, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' });
const board = (scenes: StoryboardScene[], timing: Storyboard['timing'] = 'measured'): Storyboard => ({ schemaVersion: 1, scenes, timing, narrationKey: 'k' });
const photo: StoryboardScene['visual'] = { type: 'asset', referenceId: 'img', title: 'Foto', kind: 'image', score: 1, reason: '' };

describe('composition plan', () => {
  it('groups fallback scenes into Remotion segments and gives each local asset its own FFmpeg segment', () => {
    const media = new Map<string, LocalMedia>([['img', { referenceId: 'img', relativePath: 'midia/foto.png', kind: 'image', rightsStatus: 'verified_allowed' }]]);
    const { segments, issues } = compositionPlan(board([scene('a', 0, 2_000), scene('b', 2_000, 4_100), scene('c', 4_100, 6_000, photo), scene('d', 6_000, 9_033)]), format('youtube-long'), media);
    expect(issues).toEqual([]);
    expect(segments.map((segment) => [segment.kind, segment.sceneIds])).toEqual([['motion', ['a', 'b']], ['asset', ['c']], ['motion', ['d']]]);
    const first = segments[0];
    if (first?.kind !== 'motion') throw new Error('segmento motion esperado');
    expect(first.project).toMatchObject({ width: 1920, height: 1080, fps: 30, captions: [] });
    expect(segments.reduce((sum, segment) => sum + segment.frames, 0)).toBe(Math.round(9_033 * 30 / 1_000));
    expect(segmentKey(first, format('youtube-long'))).not.toBe(segmentKey(first, format('youtube-short')));
  });

  it('never drifts from the narration however many scenes', () => {
    const scenes = Array.from({ length: 200 }, (_, index) => scene(`s${index}`, index * 3_333, (index + 1) * 3_333));
    const bounds = frameBounds(scenes, 30);
    expect(bounds.reduce((sum, item) => sum + item.frames, 0)).toBe(Math.round(200 * 3_333 * 30 / 1_000));
    expect(compositionPlan(board(scenes), format('youtube-long'), new Map()).segments.every((segment) => segment.sceneIds.length <= 30)).toBe(true);
  });

  it('refuses to render estimated times, media without a local file and media without rights', () => {
    const media = new Map<string, LocalMedia>([['img', { referenceId: 'img', relativePath: 'midia/foto.png', kind: 'image', rightsStatus: 'blocked' }]]);
    const codes = compositionPlan(board([scene('a', 0, 1_000, photo), scene('b', 1_000, 2_000, { ...photo, referenceId: 'remota' })], 'estimated'), format('square'), media).issues.map((issue) => issue.code);
    expect(codes).toEqual(['not_measured', 'unauthorized_media', 'missing_media_file']);
  });

  it('selects only already-used allowed media as fallback backgrounds, preferring the same subject', () => {
    const gameplay = (id: string, subjectId: string, referenceId: string, sourceStartMs: number) => ({ ...scene(id, sourceStartMs, sourceStartMs + 4_000, {
      type: 'asset', referenceId, title: referenceId, kind: 'video', score: 1, reason: 'aceito', match: {
        sceneId: id, sentenceIds: [id], segmentId: `${referenceId}-${sourceStartMs}`, sourceStartMs, sourceEndMs: sourceStartMs + 4_000, subjectId,
        score: 1, breakdown: { semantic: 1, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'aceito',
      },
    }), subjectId });
    const scenes = [gameplay('elden', 'elden-ring', 'elden-clip', 104_000), { ...scene('silksong-text', 110_000, 114_000), subjectId: 'silksong' }, gameplay('silksong', 'silksong', 'silksong-clip', 23_000), scene('other-text', 39_000, 43_000)];
    const media = new Map<string, LocalMedia>([
      ['elden-clip', { referenceId: 'elden-clip', relativePath: 'midia/elden.mp4', kind: 'video', rightsStatus: 'verified_allowed' }],
      ['silksong-clip', { referenceId: 'silksong-clip', relativePath: 'midia/silksong.mp4', kind: 'video', rightsStatus: 'verified_allowed' }],
      ['unseen', { referenceId: 'unseen', relativePath: 'midia/unseen.mp4', kind: 'video', rightsStatus: 'verified_allowed' }],
    ]);
    const candidates = selectMotionBackgroundCandidates(board(scenes), media, 'final');
    expect(candidates.get('silksong-text')).toMatchObject({ referenceId: 'silksong-clip', source: { startMs: 23_000, endMs: 27_000 } });
    expect(candidates.get('other-text')).toMatchObject({ referenceId: 'silksong-clip' });
    expect([...candidates.values()].some((candidate) => candidate.referenceId === 'unseen')).toBe(false);
  });

  it('refuses preview-only and not-allowed media as final fallback backgrounds', () => {
    const asset = scene('asset', 0, 4_000, { ...photo, referenceId: 'asset', kind: 'video', match: { sceneId: 'asset', sentenceIds: ['asset'], segmentId: 'asset-0', sourceStartMs: 0, sourceEndMs: 4_000, score: 1, breakdown: { semantic: 1, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'aceito' } });
    const fallback = scene('text', 4_000, 8_000);
    for (const basis of ['preview_only', 'not_allowed'] as const) {
      const media = new Map<string, LocalMedia>([['asset', { referenceId: 'asset', relativePath: 'midia/asset.mp4', kind: 'video', rightsStatus: 'unverified', basis }]]);
      expect(selectMotionBackgroundCandidates(board([asset, fallback]), media, 'final').has('text')).toBe(false);
    }
  });

  it('injects an image background into a Motion fallback and never uses a solid black scene background', () => {
    const media = new Map<string, LocalMedia>([['img', { referenceId: 'img', relativePath: 'midia/foto.png', kind: 'image', rightsStatus: 'verified_allowed' }]]);
    const background = new Map([['a', { referenceId: 'img', assetRef: 'data:image/jpeg;base64,fixture' }]]);
    const plan = compositionPlan(board([scene('a', 0, 2_000)]), format('youtube-long'), media, null, { motionBackgrounds: background });
    const motion = plan.segments[0];
    if (motion?.kind !== 'motion') throw new Error('segmento motion esperado');
    expect(motion.project.scenes[0]).toMatchObject({ background: { kind: 'image', assetRef: 'data:image/jpeg;base64,fixture' } });
    expect(motion.project).toMatchObject({ style: { background: { kind: 'gradient', from: expect.not.stringMatching(/^#000000$/iu) } } });
  });
});

describe('AP-02: matched source range and render use basis', () => {
  const match = { sceneId: 'a', sentenceIds: ['a:0'], segmentId: 'asset-1:12000-20000', sourceStartMs: 12_000, sourceEndMs: 20_000, score: 0.8, breakdown: { semantic: 1, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'combate' };
  const clip: StoryboardScene['visual'] = { type: 'asset', referenceId: 'vid', title: 'Gameplay', kind: 'video', score: 1, reason: '' };
  const legacy = new Map<string, LocalMedia>([['vid', { referenceId: 'vid', relativePath: 'media/gameplay.mp4', kind: 'video', rightsStatus: 'verified_allowed' }]]);
  const acquired = (basis: NonNullable<LocalMedia['basis']>) => new Map<string, LocalMedia>([['vid', { referenceId: 'vid', relativePath: 'media/gameplay.mp4', kind: 'video', rightsStatus: 'unverified', basis }]]);

  it('keeps the segment key of a legacy asset segment exactly as before (renders already on disk are reused)', () => {
    const { segments } = compositionPlan(board([scene('a', 0, 4_000, clip)]), format('youtube-long'), legacy);
    expect(segments[0]).not.toHaveProperty('source');
    expect(segmentKey(segments[0] as NonNullable<typeof segments[0]>, format('youtube-long'))).toBe('f5623c334958042a');
  });

  it('cuts the matched range of the source and puts the range in the cache key', () => {
    const plan = compositionPlan(board([scene('a', 0, 4_000, { ...clip, match })]), format('youtube-long'), legacy);
    expect(plan.issues).toEqual([]);
    expect(plan.segments[0]).toMatchObject({ kind: 'asset', source: { startMs: 12_000, endMs: 20_000 } });
    const moved = compositionPlan(board([scene('a', 0, 4_000, { ...clip, match: { ...match, sourceStartMs: 30_000, sourceEndMs: 38_000 } })]), format('youtube-long'), legacy);
    const key = (segments: typeof plan.segments) => segmentKey(segments[0] as NonNullable<typeof segments[0]>, format('youtube-long'));
    expect(key(plan.segments)).not.toBe('f5623c334958042a');
    expect(key(moved.segments)).not.toBe(key(plan.segments));
  });

  it('renders acquired media only on an allowed basis, and preview_only only in drafts', () => {
    const scenes = board([scene('a', 0, 4_000, { ...clip, match })]);
    expect(compositionPlan(scenes, format('youtube-long'), acquired('editorial_use')).issues).toEqual([]);
    expect(compositionPlan(scenes, format('youtube-long'), acquired('not_allowed')).issues.map((issue) => issue.code)).toEqual(['unauthorized_media']);
    expect(compositionPlan(scenes, format('youtube-long'), acquired('preview_only')).issues.map((issue) => issue.code)).toEqual(['unauthorized_media']);
    expect(compositionPlan(scenes, format('youtube-long'), acquired('preview_only'), null, { mode: 'draft' }).issues).toEqual([]);
    expect(compositionPlan(scenes, format('youtube-long'), acquired('preview_only'), null, { mode: 'draft' }).segments[0]).toMatchObject({ basis: 'preview_only' });
  });
});

describe('captions and quality', () => {
  it('writes SubRip cues in up to two lines inside the safe width and counts phrases without time', () => {
    const { srt, cues, skipped } = subtitlesSrt([{ sceneId: 'a', text: 'Uma frase curta.', startMs: 0, endMs: 1_500 }, { sceneId: 'a', text: 'Sem tempo.', startMs: null, endMs: null }], format('youtube-short'));
    expect(cues).toBe(1);
    expect(skipped).toBe(1);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nUma frase curta.\n');
    expect(captionLines('palavra '.repeat(20).trim(), 20).every((cue) => cue.length <= 2 && cue.every((line) => line.length <= 20))).toBe(true);
  });

  const probe: VideoProbe = { width: 1080, height: 1920, fps: 30, durationMs: 10_000, hasVideo: true, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac' };
  const base = { format: format('youtube-short'), probe: probe as VideoProbe | null, narrationDurationMs: 10_050, storyboardIssues: [], unsupportedFacts: 0, scenes: [scene('a', 0, 10_000)], rights: new Map(), captions: { cues: 3, skipped: 0, burned: true }, silences: [], budget: { limitUsd: 5, consumedUsd: 1 } };

  it('passes a correct MP4 and blocks on format, audio, duration, rights, claims and budget', () => {
    expect(qualityExportable(qualityChecks(base))).toBe(true);
    const failing = (input: Partial<typeof base>) => qualityChecks({ ...base, ...input }).filter((check) => check.severity === 'blocking' && !check.passed).map((check) => check.id);
    expect(failing({ probe: { ...probe, width: 1920, height: 1080 } })).toEqual(['resolution', 'aspect']);
    expect(failing({ probe: { ...probe, hasAudio: false } })).toEqual(['audio']);
    expect(failing({ narrationDurationMs: 12_000 })).toEqual(['duration']);
    expect(failing({ scenes: [scene('a', 0, 1, photo)] })).toEqual(['rights']);
    expect(failing({ unsupportedFacts: 2 })).toEqual(['claims']);
    expect(failing({ budget: { limitUsd: 1, consumedUsd: 2 } })).toEqual(['budget']);
    expect(failing({ probe: null })).toEqual(['file']);
    expect(qualityChecks({ ...base, captions: { cues: 3, skipped: 0, burned: false } }).find((check) => check.id === 'captions-burned')).toMatchObject({ severity: 'warning', passed: false });
  });

  it('accepts editorial use as a valid basis for the rights check, shows it apart, and never treats it as a licence', () => {
    const editorial = new Map([['img', { basis: 'editorial_use' as const, legalClearance: 'unknown' as const, publisher: 'Fixture Publishing', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }]]);
    const checks = qualityChecks({ ...base, scenes: [scene('a', 0, 1, photo)], useBasis: editorial });
    expect(checks.find((check) => check.id === 'rights')).toMatchObject({ severity: 'blocking', passed: true, evidence: expect.stringContaining('uso editorial') });
    expect(checks.find((check) => check.id === 'editorial-use')).toMatchObject({ severity: 'warning', passed: false, evidence: expect.stringContaining('legalClearance: unknown') });
    const preview = new Map([['img', { basis: 'preview_only' as const, legalClearance: 'unknown' as const, publisher: 'X', url: 'https://example.com/v' }]]);
    expect(qualityChecks({ ...base, scenes: [scene('a', 0, 1, photo)], useBasis: preview }).find((check) => check.id === 'rights')).toMatchObject({ passed: false });
    expect(qualityChecks(base).find((check) => check.id === 'editorial-use')).toBeUndefined();
  });
});
