import { describe, expect, it } from 'vitest';
import type { SegmentAnalysis } from '@neuralbridge/shared';
import { applyLocalCutCorrections, captionSyncIssues, foreignTexts, reviewAndCorrect, reviewRender, type PostRenderDeps, type PostRenderReport } from '../src/aethera/post-render-review.js';

const analysis = (texts: Array<{ text: string; region: 'top' | 'center' | 'bottom' | 'full' | 'overlay' }>): SegmentAnalysis => ({
  schemaVersion: 1, nature: 'action', natureConfidence: 0.9, description: 'um personagem corre por uma rua', confidence: 0.9,
  frames: [{ atMs: 0, observed: 'rua noturna', visibleText: texts }], entities: [], actions: [], environment: null,
  overlays: { burnedText: texts.length > 0, watermark: false, webcam: false }, limitations: [],
});

const deps = (overrides: Partial<PostRenderDeps> = {}): PostRenderDeps => ({
  extractFrame: async (atMs) => `quadro-${atMs}.png`,
  frameStats: async () => ({ mean: 0.3, spread: 0.2 }),
  loudness: async () => ({ lufs: -16.2, truePeakDb: -1.4 }),
  silences: async () => [],
  durationMs: async () => 10_000,
  ...overrides,
});

const base = {
  segments: [{ segmentId: 's1', startMs: 0, endMs: 5_000, narration: 'Ele corre pela cidade.', wants: 'personagem correndo', composition: 'single_shot', expectedTexts: ['Ele corre pela cidade.'] }],
  captions: [{ startMs: 100, endMs: 1_500, lines: ['Ele corre pela cidade.'] }],
  words: [{ w: 'Ele', startMs: 120 }, { w: 'corre', startMs: 400 }],
  narrationDurationMs: 10_050,
};

describe('post-render review', () => {
  it('separates the production’s own text (read partially) from the media’s text', () => {
    const found = foreignTexts(analysis([{ text: 'corre pela', region: 'bottom' }, { text: 'NIGHT CITY WIRE', region: 'top' }]), ['Ele corre pela cidade.']);
    expect(found).toEqual([{ text: 'NIGHT CITY WIRE', region: 'top' }]);
  });

  it('flags captions that start off their word or overlap the next one', () => {
    expect(captionSyncIssues(base.captions, base.words)).toEqual([]);
    const issues = captionSyncIssues([{ startMs: 600, endMs: 2_000, lines: ['Ele corre'] }, { startMs: 1_900, endMs: 3_000, lines: ['corre'] }], base.words);
    expect(issues.some((issue) => issue.includes('não começa'))).toBe(true);
    expect(issues.some((issue) => issue.includes('sobrepõe'))).toBe(true);
  });

  it('passes a clean render and reports the semantic checks as not run without vision', async () => {
    const report = await reviewRender(base, deps());
    expect(report.summary.fail).toBe(0);
    expect(report.checks.find((check) => check.id === 'image-narration')?.verdict).toBe('not_run');
    expect(report.limitations.some((item) => item.includes('G3'))).toBe(true);
  });

  it('fails black frames, loud peaks, foreign text and rejected images, proposing corrections', async () => {
    const report = await reviewRender(base, deps({
      frameStats: async () => ({ mean: 0.01, spread: 0.005 }),
      loudness: async () => ({ lufs: -11, truePeakDb: 0.4 }),
      silences: async () => [{ startMs: 4_000, durationMs: 2_000 }],
      analyze: async () => analysis([{ text: 'SUBSCRIBE NOW', region: 'center' }]),
      judge: async () => ({ judgement: null, decision: { decision: 'reject', reason: 'mostra um menu' } }),
    }));
    const verdict = (id: string) => report.checks.find((check) => check.id === id)?.verdict;
    expect([verdict('not-empty'), verdict('true-peak'), verdict('text-conflict'), verdict('image-narration')]).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect([verdict('loudness'), verdict('audio-continuity')]).toEqual(['warn', 'warn']);
    expect(report.corrections.map((item) => item.action)).toEqual(['replace_footage', 'replace_footage', 'human_review']);
  });

  it('reports a weak image over a known fallback as a warning without proposing to swap footage', async () => {
    const first = base.segments[0];
    if (!first) throw new Error('missing base segment');
    const segments = [{ ...first, composition: 'continue_previous', fellBackFrom: 'diagram' }];
    const report = await reviewRender({ ...base, segments }, deps({ analyze: async () => analysis([]), judge: async () => ({ judgement: null, decision: { decision: 'reject', reason: 'falta o esquema' } }) }));
    expect(report.checks.find((check) => check.id === 'image-narration')).toMatchObject({ verdict: 'warn', evidence: expect.stringContaining('diagram') });
    expect(report.corrections).toEqual([]);
  });

  it('applies only objective corrections, stays bounded and keeps the best version', async () => {
    const report = (fail: number, corrections: Array<[string, 'replace_footage' | 'human_review']>): PostRenderReport => ({ schemaVersion: 1, checks: [], corrections: corrections.map(([segmentId, action]) => ({ segmentId, action, reason: 'x' })), summary: { pass: 0, warn: 0, fail, notRun: 0 }, limitations: [] });
    const renders: number[] = [];
    const bounded = await reviewAndCorrect({ maxAttempts: 2, render: async (attempt) => { renders.push(attempt); return attempt; }, review: async (attempt) => report(3 - attempt, [[`s${attempt}`, 'replace_footage']]) });
    expect(renders).toEqual([1, 2]);
    expect(bounded.final).toBe(2);
    const judged = await reviewAndCorrect({ maxAttempts: 3, render: async (attempt) => attempt, review: async () => report(1, [['s1', 'human_review']]) });
    expect(judged.attempts).toHaveLength(1);
    const regressed = await reviewAndCorrect({ maxAttempts: 3, render: async (attempt) => attempt, review: async (attempt) => report(attempt === 1 ? 2 : 4, [[`s${attempt}`, 'replace_footage']]) });
    expect(regressed.attempts).toHaveLength(2);
    expect(regressed.final).toBe(1);
  });

  it('patches only failing segments locally without replanning the whole timeline (SD-4)', () => {
    const timeline = {
      version: 3,
      tracks: [{
        kind: 'video',
        items: [
          { id: 'c1', sceneIds: ['s1'], source: { kind: 'media', assetId: 'old-1', proxyPath: '/old1.mp4', inMs: 0, outMs: 3000 } },
          { id: 'c2', sceneIds: ['s2'], source: { kind: 'media', assetId: 'keep-2', proxyPath: '/keep2.mp4', inMs: 0, outMs: 3000 } },
        ],
      }],
    };
    const report: PostRenderReport = {
      schemaVersion: 1,
      checks: [],
      corrections: [
        { segmentId: 's1', action: 'replace_footage', reason: 'texto estranho' },
        { segmentId: 's2', action: 'human_review', reason: 'subjetivo' },
      ],
      summary: { pass: 1, warn: 0, fail: 1, notRun: 0 },
      limitations: [],
    };
    const patched = applyLocalCutCorrections(timeline, report, (c) =>
      c.segmentId === 's1' ? { segmentId: 's1', assetId: 'new-1', proxyPath: '/new1.mp4', inMs: 500, outMs: 3500 } : null,
    );
    expect(patched.patchedSegmentIds).toEqual(['s1']);
    expect(patched.timeline.version).toBe(4);
    expect(patched.timeline.tracks[0]?.items[0]?.source).toMatchObject({ assetId: 'new-1', proxyPath: '/new1.mp4', inMs: 500 });
    expect(patched.timeline.tracks[0]?.items[1]?.source).toMatchObject({ assetId: 'keep-2', proxyPath: '/keep2.mp4' });
  });
});
