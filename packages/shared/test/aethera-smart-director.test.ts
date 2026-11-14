import { describe, expect, it } from 'vitest';
import { applyEditorialPlan, defaultDiagramLinks, diagramPositions, diagramProps, DIAGRAM_LINK_DELAY_MS, executableComposition, assembleTimeline, calmCorner, calmPlacement, DISSOLVE_MS, MIN_READ_MS, panelProxyPaths, panelSpanAt, directorOutputSchema, editorialPlanHash, nextEditorialPlan, panelClipPath, panelShapes, TECHNIQUES, validateDirectorOutput, VIDEO_FORMATS, type DirectorOutput, type DirectorSegment, type FootageCandidate, type FootageSubject, type SegmentDirection, type Storyboard } from '../src/index.js';

const subjects: FootageSubject[] = [{ id: 'cp', title: 'Cyberpunk 2077' }, { id: 'er', title: 'Elden Ring' }, { id: 'hk', title: 'Hollow Knight Silksong' }];
const words = (text: string, startMs: number, step = 400) => text.split(' ').map((w, index) => ({ w, startMs: startMs + index * step, endMs: startMs + index * step + 350 }));
const segment = (id: string, text: string, startMs: number, endMs: number): DirectorSegment => ({ id, sceneId: 's1', text, words: words(text, startMs), startMs, endMs });
const segments = [
  segment('a', 'Três jogos. Três jeitos diferentes de prender você.', 0, 3_600),
  segment('b', 'Cyberpunk dois mil e setenta e sete, Elden Ring e Hollow Knight Silksong.', 3_600, 8_000),
  segment('c', 'Em Elden Ring, na paisagem.', 8_000, 10_000),
  segment('d', 'Repare no horizonte.', 10_000, 11_600),
];
const decision = (segmentId: string, composition: SegmentDirection['composition'], extra: Partial<SegmentDirection> = {}): SegmentDirection => ({
  segmentId, communicates: 'o que a fala diz', viewerEffect: 'entender', emotion: 'curiosidade', intensity: 0.5, importance: 'normal', composition,
  transitionIn: { kind: 'cut', motivation: 'mudança de assunto' }, representation: 'record', justification: 'A fala pede exatamente esta forma de mostrar a ideia.', confidence: 0.8, alerts: [], ...extra,
});
const output = (overrides: Partial<Record<string, SegmentDirection>> = {}): DirectorOutput => directorOutputSchema.parse({
  reading: { story: 'Um método para comparar três jogos.', purpose: 'analisar', audience: 'jogadores', tone: 'curioso', arc: [{ role: 'opening', segmentIds: ['a', 'b'], intent: 'apresentar' }, { role: 'development', segmentIds: ['c', 'd'], intent: 'mostrar' }], keyInformation: ['três jogos'] },
  concept: { summary: 'Análise calma', visualLanguage: 'tomadas longas', pacing: 'respira nas pausas', continuity: 'um jogo por vez', typography: 'só legendas', audio: 'narração à frente', avoid: ['efeitos sem motivo'], rationale: 'O roteiro compara com calma; a imagem acompanha a ordem da fala sem disputar atenção.' },
  segments: [
    overrides['a'] ?? decision('a', { kind: 'typographic_card', lines: ['Três jogos', 'Três jeitos'], revealAtWords: null }),
    overrides['b'] ?? decision('b', { kind: 'multi_panel', layout: 'diagonal', reveal: 'progressive', panels: [{ subjectId: 'cp', wants: 'a cidade', label: null, revealAtWord: 0 }, { subjectId: 'er', wants: 'a paisagem', label: null, revealAtWord: 7 }, { subjectId: 'hk', wants: 'a heroína', label: null, revealAtWord: 10 }] }),
    overrides['c'] ?? decision('c', { kind: 'single_shot', subjectId: 'er', wants: 'paisagem aberta', camera: 'still' }),
    overrides['d'] ?? decision('d', { kind: 'continue_previous' }, { transitionIn: { kind: 'none', motivation: 'a fala continua na mesma imagem' } }),
  ],
});

describe('Smart Director: plan validation (SD-1)', () => {
  it('accepts a coherent plan and keeps the catalogue descriptive, not prescriptive', () => {
    expect(validateDirectorOutput(output(), { segments, subjects }).filter((issue) => issue.severity === 'error')).toEqual([]);
    // The catalogue says what a technique does and costs; there is no topic in it.
    expect(Object.values(TECHNIQUES).every((entry) => !/game|jogo|história|ciência|terror/iu.test(entry.communicates))).toBe(true);
  });

  it('refuses footage of one subject over a sentence about another, panels out of speech order and anchors past the segment', () => {
    const wrong = output({
      c: decision('c', { kind: 'single_shot', subjectId: 'hk', wants: 'x', camera: 'still' }),
      b: decision('b', { kind: 'multi_panel', layout: 'diagonal', reveal: 'progressive', panels: [{ subjectId: 'cp', wants: 'a', label: null, revealAtWord: 7 }, { subjectId: 'er', wants: 'b', label: null, revealAtWord: 2 }, { subjectId: 'hk', wants: 'c', label: null, revealAtWord: 40 }] }),
    });
    const messages = validateDirectorOutput(wrong, { segments, subjects }).filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' | ');
    expect(messages).toContain('Imagem de um assunto sobre uma frase que fala de outro');
    expect(messages).toContain('ordem da fala');
    expect(messages).toContain('Âncora na palavra 40');
  });

  it('flags a missing segment, a duplicate and a technique that is not executable yet (with its fallback)', () => {
    const plan = output({ d: decision('c', { kind: 'diagram', description: 'mecanismo' }) });
    const issues = validateDirectorOutput(plan, { segments, subjects });
    expect(issues.some((issue) => issue.segmentId === 'd' && issue.message.includes('sem decisão'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('mais de uma decisão'))).toBe(true);
    expect(issues.some((issue) => issue.severity === 'warning' && issue.message.includes('diagram'))).toBe(true);
  });
});

describe('Smart Director: versions (SD-1)', () => {
  it('reuses identical decisions, makes a new draft for different ones and never touches an approved version', () => {
    const director = { provider: 'claude', model: 'sonnet', promptVersion: 'v1' };
    const first = nextEditorialPlan([], { productionId: 'p', scriptKey: 'k', director, output: output() });
    expect(first).toMatchObject({ version: 1, status: 'draft' });
    const approved = { ...first, status: 'approved' as const };
    expect(nextEditorialPlan([approved], { productionId: 'p', scriptKey: 'k', director, output: output() })).toBe(approved);
    const changed = nextEditorialPlan([approved], { productionId: 'p', scriptKey: 'k', director, output: output({ d: decision('d', { kind: 'single_shot', subjectId: 'er', wants: 'horizonte', camera: 'pan' }) }) });
    expect(changed).toMatchObject({ version: 2, status: 'draft' });
    expect(approved.status).toBe('approved');
    // The hash ignores key order: the same decisions written differently are the same plan.
    const plain = output();
    const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
    const reordered = reverseKeys(plain) as DirectorOutput;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(plain)[0]);
    expect(editorialPlanHash({ scriptKey: 'k', ...plain })).toBe(editorialPlanHash({ scriptKey: 'k', ...reordered }));
  });
});

describe('Smart Director: multi-panel geometry (SD-1)', () => {
  it('splits the frame into diagonal columns that share leaning edges and cover it without gaps', () => {
    const shapes = panelShapes('diagonal', 3, 0.14);
    expect(shapes).toHaveLength(3);
    // Panel 1's right edge is panel 2's left edge, leaning: top to the right of the bottom.
    expect(shapes[0]?.points[1]).toEqual(shapes[1]?.points[0]);
    expect(shapes[0]?.points[2]).toEqual(shapes[1]?.points[3]);
    expect(shapes[1]?.points[0]?.[0] ?? 0).toBeGreaterThan(shapes[1]?.points[3]?.[0] ?? 0);
    expect(shapes[0]?.points[0]?.[0] ?? 0).toBeLessThan(0);
    expect(shapes[2]?.points[1]?.[0] ?? 0).toBeGreaterThan(1);
    expect(panelShapes('horizontal', 2).map((shape) => shape.box)).toEqual([{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]);
  });

  it('places text on the visible span of a panel at its height, inside the frame (regression: diagonal labels cut by the edges)', () => {
    const shapes = panelShapes('diagonal', 3, 0.14);
    for (const shape of shapes) {
      const span = panelSpanAt(shape, 0.12);
      expect(span.left).toBeGreaterThanOrEqual(0);
      expect(span.right).toBeLessThanOrEqual(1);
      expect(span.width).toBeGreaterThan(0.25);
    }
    // The last panel's span stops at the frame edge, not at its overshooting corner.
    expect(panelSpanAt(shapes[2] as NonNullable<(typeof shapes)[2]>, 0.12).right).toBe(1);
    // On a leaning edge the span moves with the height: higher up, further to the right.
    expect(panelSpanAt(shapes[1] as NonNullable<(typeof shapes)[1]>, 0.1).left).toBeGreaterThan(panelSpanAt(shapes[1] as NonNullable<(typeof shapes)[1]>, 0.9).left);
  });

  it('reveals a panel as a wipe from its leading edge: nothing at 0, the whole polygon at 1', () => {
    const [shape] = panelShapes('vertical', 2);
    if (!shape) throw new Error('painel');
    expect(panelClipPath(shape, 0, 'vertical')).toBe('polygon(0.000% 0.000%, 0.000% 0.000%, 0.000% 100.000%, 0.000% 100.000%)');
    expect(panelClipPath(shape, 1, 'vertical')).toBe('polygon(0.000% 0.000%, 50.000% 0.000%, 50.000% 100.000%, 0.000% 100.000%)');
  });
});

describe('Smart Director: execution (SD-1)', () => {
  const clean = { nature: 'landscape' as const, overlays: { burnedText: false, watermark: false, webcam: false }, frames: [{ atMs: 0, observed: 'paisagem', visibleText: [] }] };
  const candidate = (id: string, subjectId: string, startMs: number): FootageCandidate => ({ assetId: `${subjectId}-a`, segmentId: id, subjectId, startMs, endMs: startMs + 6_000, source: 'official', assetDurationMs: 120_000, analysis: clean });
  const storyboard: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'n', scenes: [{
    id: 's1', chapter: 1, narration: segments.map((item) => item.text).join(' '), startMs: 0, endMs: 11_600, claimIds: [], visualObjective: 'x', sceneType: 'broll', searchTerms: [],
    visual: { type: 'fallback', kind: 'animation', reason: 'x' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved',
    audio: { relativePath: 'a.wav', durationMs: 11_600, key: 'k', words: segments.flatMap((item) => item.words) },
  }] };

  it('builds panels revealed on the spoken names, with each subject’s own footage or a declared gap, and lengthens a continued shot', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const executed = applyEditorialPlan(timeline, output(), { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000), candidate('hk-1', 'hk', 10_000)], proxyPaths: new Map([['er-a', 'media/er.mp4'], ['hk-a', 'media/hk.mp4']]) });
    const graphics = executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? [];
    const panels = graphics.find((item) => item.source.kind === 'graphic' && item.source.component === 'panels');
    const props = panels?.source.kind === 'graphic' ? panels.source.props as { panels: Array<{ label: string; revealAtMs: number; proxyPath?: string }> } : null;
    // Revealed on "Cyberpunk" (word 0), "Elden" (word 7) and "Hollow" (word 10), relative to the segment start.
    expect(props?.panels.map((panel) => panel.revealAtMs)).toEqual([0, 2_800, 4_000]);
    expect(props?.panels.map((panel) => [panel.label, panel.proxyPath ?? null])).toEqual([['Cyberpunk 2077', null], ['Elden Ring', 'media/er.mp4'], ['Hollow Knight Silksong', 'media/hk.mp4']]);
    // Panels claim their subjects' footage first; with all three shots taken, the general card has no image and says so.
    expect(executed.gaps.map((gap) => gap.message)).toEqual([expect.stringContaining('Cyberpunk 2077'), expect.stringContaining('texto do diretor sem imagem')]);
    // The props stored on the timeline (with the timeline's own `sceneId`) are still readable panels: the renderer and the
    // media server both read them back (regression: a strict schema made them unreadable and the render refused the media).
    expect(panelProxyPaths(panels?.source.kind === 'graphic' ? panels.source.props : {})).toEqual(['media/er.mp4', 'media/hk.mp4']);
    // "Repare no horizonte." continues the Elden Ring shot: one video clip from 8 s to 11.6 s.
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    expect(video.map((item) => [item.startMs, item.startMs + item.durationMs])).toEqual([[8_000, 11_600]]);
    // The card shows the director's own lines.
    expect(graphics.find((item) => item.source.kind === 'graphic' && item.source.component === 'title')?.source).toMatchObject({ props: { items: ['Três jogos', 'Três jeitos'] } });
  });

  it('draws a director card over footage, never over a bare background, when there is material (green-screen review)', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const executed = applyEditorialPlan(timeline, output(), { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000), candidate('hk-1', 'hk', 10_000), candidate('hk-2', 'hk', 50_000)], proxyPaths: new Map() });
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    const card = (executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? []).find((item) => item.source.kind === 'graphic' && item.source.component === 'title');
    // The card of segment "a" (0–3.6 s) has a video clip under it for its whole length.
    expect(card?.startMs).toBe(0);
    expect(video.some((item) => item.startMs === 0 && item.durationMs >= 3_000)).toBe(true);
    expect(executed.gaps.some((gap) => gap.message.includes('texto do diretor sem imagem'))).toBe(false);
  });

  it('continues the image after a card, but ends the card with its own sentence', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const plan = output({ b: decision('b', { kind: 'continue_previous' }) });
    const executed = applyEditorialPlan(timeline, plan, { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000)], proxyPaths: new Map() });
    const card = (executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? []).find((item) => item.source.kind === 'graphic' && item.source.component === 'title');
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    // The card of "a" ends at 3.6 s; the same footage carries on through "b" (3.6–8 s) with no card.
    expect(card ? card.startMs + card.durationMs : 0).toBe(3_600);
    expect(video.some((item) => item.startMs === 3_600 && item.startMs + item.durationMs === 8_000)).toBe(true);
  });

  it('never puts a director card over footage that has text of its own (three texts competing)', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const subtitled = { ...candidate('er-sub', 'er', 60_000), analysis: { ...clean, overlays: { burnedText: true, burnedTextRegion: 'bottom' as const, watermark: false, webcam: false } } };
    const executed = applyEditorialPlan(timeline, output(), { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000), candidate('hk-1', 'hk', 10_000), subtitled], proxyPaths: new Map() });
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    // The only footage left for the card is subtitled: the card goes without it (a declared gap) rather than on top of it.
    expect(video.some((item) => item.source.kind === 'media' && item.source.inMs >= 60_000)).toBe(false);
    expect(executed.gaps.some((gap) => gap.message.includes('texto do diretor sem imagem'))).toBe(true);
  });

  it('runs the declared fallback for a technique the executor cannot do yet, and reports it', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const executed = applyEditorialPlan(timeline, output({ a: decision('a', { kind: 'diagram', description: 'como funciona' }, { representation: 'illustrative' }) }), { segments, subjects, candidates: [candidate('er-1', 'er', 20_000)], proxyPaths: new Map() });
    expect(executed.fallbacks).toEqual([{ segmentId: 'a', from: 'diagram', to: 'typographic_card' }]);
  });

  it('keeps the intent in a fallback and never restates the caption (SD-1 review of the rendered sample)', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const plan = output({
      c: decision('c', { kind: 'kinetic_type', emphasizedWords: [2, 4] }),
      d: decision('d', { kind: 'diagram', description: 'o horizonte como linha' }, { representation: 'illustrative' }),
    });
    const executed = applyEditorialPlan(timeline, plan, { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000), candidate('er-3', 'er', 60_000), candidate('hk-1', 'hk', 10_000), candidate('hk-2', 'hk', 30_000), candidate('cp-1', 'cp', 30_000)], proxyPaths: new Map() });
    // SD-2: kinetic type is executed; the diagram (still not drawable) keeps the image on screen, no slide restating the
    // narration and no stack of loose words.
    expect(executed.fallbacks).toEqual([{ segmentId: 'd', from: 'diagram', to: 'continue_previous' }]);
    const graphics = executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? [];
    const kinetic = graphics.find((item) => item.source.kind === 'graphic' && item.source.component === 'kinetic');
    // "Ring" (word 2) from its pronunciation until "paisagem" (word 4), then "paisagem" to the end of the segment.
    expect(kinetic?.source.kind === 'graphic' ? kinetic.source.props['words'] : null).toEqual([{ text: 'Ring', atMs: 800, untilMs: 1_600 }, { text: 'paisagem', atMs: 1_600, untilMs: 2_000 }]);
    // Over footage: a video clip runs under the kinetic words.
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    expect(video.some((item) => item.startMs === 8_000)).toBe(true);
    const cards = graphics.flatMap((item) => item.source.kind === 'graphic' && item.source.component === 'title' ? [item] : []);
    expect(cards.every((item) => item.source.kind !== 'graphic' || (item.source.props['title'] !== segments[2]?.text && item.source.props['title'] !== segments[3]?.text))).toBe(true);
  });

  it('executes a picture-in-picture with the inset in the calm corner and a dissolve the director motivated; a cut stays a cut', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const busyTop = (id: string, at: number) => ({ ...candidate(id, 'er', at), zones: { top: 0.9, middle: 0.5, bottom: 0.1 } });
    const plan = output({
      a: decision('a', { kind: 'picture_in_picture', main: { subjectId: 'er', wants: 'paisagem', label: null, revealAtWord: null }, inset: { subjectId: 'hk', wants: 'heroína', label: null, revealAtWord: 3 } }),
      c: decision('c', { kind: 'single_shot', subjectId: 'er', wants: 'paisagem', camera: 'still' }),
      d: decision('d', { kind: 'single_shot', subjectId: 'er', wants: 'horizonte', camera: 'still' }, { transitionIn: { kind: 'dissolve', motivation: 'a mesma paisagem se transforma' } }),
    });
    const executed = applyEditorialPlan(timeline, plan, { segments, subjects, candidates: [busyTop('er-1', 20_000), busyTop('er-2', 40_000), busyTop('er-3', 60_000), busyTop('er-4', 80_000), candidate('hk-1', 'hk', 10_000), candidate('hk-2', 'hk', 30_000)], proxyPaths: new Map([['er-a', 'media/er.mp4'], ['hk-a', 'media/hk.mp4']]) });
    const pip = (executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? []).find((item) => item.source.kind === 'graphic' && item.source.component === 'panels' && item.startMs === 0);
    const props = pip?.source.kind === 'graphic' ? pip.source.props as { layout: string; corner: string; panels: Array<{ revealAtMs: number }> } : null;
    expect(props?.layout).toBe('pip');
    // The main image's top third is busy, the bottom calm: the inset goes to the bottom corner.
    expect(props?.corner).toBe('bottom-right');
    expect(props?.panels.map((panel) => panel.revealAtMs)).toEqual([0, 1_200]);
    // The dissolve into "d": the incoming clip fades in over the outgoing one.
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    const incoming = video.find((item) => item.startMs === 10_000);
    expect(incoming?.keyframes.filter((keyframe) => keyframe.property === 'opacity').map((keyframe) => [keyframe.atMs, keyframe.value])).toEqual([[0, 0], [DISSOLVE_MS, 1]]);
    expect(executed.transitions).toEqual([]);
    // Segments the director cut plainly have no fade at all.
    expect(video.filter((item) => item.startMs !== 10_000).every((item) => item.keyframes.every((keyframe) => keyframe.property !== 'opacity'))).toBe(true);
  });

  it('brings forward a card line anchored too late to be read (SD-2 review: "Um método" opened 1 ms before the end)', () => {
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    // Segment "c" lasts 2 s; anchoring the line on its last word (index 4, at 1.6 s) would leave 0.4 s to read.
    const plan = output({ c: decision('c', { kind: 'typographic_card', lines: ['Paisagem'], revealAtWords: [4] }) });
    const executed = applyEditorialPlan(timeline, plan, { segments, subjects, candidates: [candidate('er-1', 'er', 20_000), candidate('er-2', 'er', 40_000), candidate('er-3', 'er', 60_000), candidate('hk-1', 'hk', 10_000), candidate('cp-1', 'cp', 30_000)], proxyPaths: new Map() });
    const card = (executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? []).find((item) => item.source.kind === 'graphic' && item.source.props['title'] === 'Paisagem');
    expect(card?.source.kind === 'graphic' ? card.source.props['itemRevealMs'] : null).toEqual([2_000 - MIN_READ_MS]);
  });

  it('places the director’s text in the calm third, away from captions and from the shot’s own text', () => {
    expect(calmPlacement({ captionPlacement: 'bottom' })).toBe('upper');
    expect(calmPlacement({ zones: { top: 0.8, middle: 0.2, bottom: 0.1 }, captionPlacement: 'bottom' })).toBe('center');
    expect(calmPlacement({ zones: { top: 0.1, middle: 0.2, bottom: 0.0 }, textRegions: ['top'], captionPlacement: 'bottom' })).toBe('center');
    expect(calmPlacement({ zones: { top: 0.3, middle: 0.9, bottom: 0.1 }, captionPlacement: 'top' })).toBe('lower');
    expect(calmCorner({ textRegions: ['top'] })).toBe('bottom-right');
    // A HUD in the top-left corner: the top third's average is calm, but the cell the card would cover is not (SD-2 review:
    // "Eixo 1" sat on Silksong's health icons).
    const hud = { top: 0.05, middle: 0.12, bottom: 0.1, cells: [[0.6, 0.02, 0.02], [0.1, 0.12, 0.1], [0.1, 0.1, 0.1]] };
    expect(calmPlacement({ zones: hud, captionPlacement: 'bottom' })).toBe('center');
    // Thin HUD icons barely raise the edge grid, but they stay put across frames: the fixed-edge grid moves the card.
    const thinHud = { top: 0.03, middle: 0.1, bottom: 0.1, cells: [[0.05, 0.02, 0, 0, 0, 0], [0.04, 0, 0, 0, 0, 0], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]],
      staticCells: [[0.08, 0.03, 0, 0, 0, 0], [0.05, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] };
    expect(calmPlacement({ zones: thinHud, captionPlacement: 'bottom' })).toBe('center');
    const { staticCells: _fixed, ...withoutFixed } = thinHud;
    expect(_fixed.length).toBe(6);
    expect(calmPlacement({ zones: withoutFixed, captionPlacement: 'bottom' })).toBe('upper');
  });
});

describe('Smart Director: diagram (SD-2.1)', () => {
  const structure = { layout: 'sequence' as const, nodes: [{ label: 'Estrela', atWord: 1 }, { label: 'Colapso', atWord: 3 }, { label: 'Horizonte', atWord: null }], links: [] };
  const how = segment('h', 'A estrela gasta combustível, colapsa e forma um horizonte.', 0, 6_000);

  it('places each layout as the shape of its reasoning, inside the area', () => {
    const inside = (points: Array<{ x: number; y: number }>) => points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    for (const layout of ['sequence', 'cycle', 'hub', 'layers', 'contrast'] as const) for (const count of [2, 3, 4, 5, 6]) expect(inside(diagramPositions(layout, count))).toBe(true);
    expect(diagramPositions('sequence', 3).map((point) => point.y)).toEqual([0.5, 0.5, 0.5]);
    expect(new Set(diagramPositions('sequence', 6).map((point) => point.y)).size).toBe(2);
    expect(diagramPositions('hub', 4)[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(diagramPositions('contrast', 4).map((point) => point.x)).toEqual([0.28, 0.28, 0.72, 0.72]);
    expect(diagramPositions('contrast', 3).map((point) => point.x)).toEqual([0.28, 0.72, 0.72]);
    // Two steps stay close; a centre with two satellites keeps the line between them off the centre.
    expect(diagramPositions('sequence', 2).map((point) => point.x)).toEqual([0.35, 0.65]);
    const hub = diagramPositions('hub', 3);
    expect(hub[1]?.y).toBe(hub[2]?.y);
    expect((hub[1]?.y ?? 0) < (hub[0]?.y ?? 0)).toBe(true);
    expect(defaultDiagramLinks('cycle', 3)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }]);
    expect(defaultDiagramLinks('hub', 3)).toEqual([{ from: 0, to: 1 }, { from: 0, to: 2 }]);
    expect(defaultDiagramLinks('contrast', 4)).toEqual([]);
  });

  it('brings each element in on its word and draws a link once both ends are on screen, leaving time to read', () => {
    const props = diagramProps(structure, how, { illustrative: true });
    // "estrela" (word 1) at 400 ms, "colapsa" (word 3) at 1 200 ms; "Horizonte" is unanchored: spread at 0.6 × 6 s × 2/3.
    expect(props.nodes.map((node) => node.atMs)).toEqual([400, 1_200, 2_400]);
    expect(props.links.map((link) => [link.from, link.to, link.atMs])).toEqual([[0, 1, 1_200 + DIAGRAM_LINK_DELAY_MS], [1, 2, 2_400 + DIAGRAM_LINK_DELAY_MS]]);
    const late = diagramProps({ ...structure, nodes: [{ label: 'A', atWord: 0 }, { label: 'B', atWord: 8 }] }, how, { illustrative: false });
    expect(Math.max(...late.nodes.map((node) => node.atMs), ...late.links.map((link) => link.atMs))).toBeLessThanOrEqual(6_000 - MIN_READ_MS);
  });

  it('executes a diagram that declares its structure and keeps the fallback for one that does not', () => {
    const drawn = executableComposition(decision('h', { kind: 'diagram', description: 'o colapso', structure }), how);
    expect(drawn).toMatchObject({ fellBack: false, composition: { kind: 'diagram' } });
    expect(executableComposition(decision('h', { kind: 'diagram', description: 'o colapso' }), how, { first: false }).composition.kind).toBe('continue_previous');
    const plan = output({ d: decision('d', { kind: 'diagram', description: 'x', structure: { layout: 'sequence', nodes: [{ label: 'A', atWord: 0 }, { label: 'B', atWord: 1 }], links: [{ from: 0, to: 5, label: null }] } }) });
    expect(validateDirectorOutput(plan, { segments, subjects }).some((issue) => issue.severity === 'error' && issue.message.includes('0→5'))).toBe(true);
  });

  it('draws the diagram over clean footage, marked as illustration, and declares a gap without footage', () => {
    const clean = { nature: 'landscape' as const, overlays: { burnedText: false, watermark: false, webcam: false }, frames: [{ atMs: 0, observed: 'paisagem', visibleText: [] }] };
    const storyboard: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'n', scenes: [{ id: 's1', chapter: 1, narration: segments.map((item) => item.text).join(' '), startMs: 0, endMs: 11_600, claimIds: [], visualObjective: 'x', sceneType: 'broll', searchTerms: [], visual: { type: 'fallback', kind: 'animation', reason: 'x' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'a.wav', durationMs: 11_600, key: 'k', words: segments.flatMap((item) => item.words) } }] };
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const plan = output({ d: decision('d', { kind: 'diagram', description: 'o horizonte', structure: { layout: 'hub', nodes: [{ label: 'Horizonte', atWord: 2 }, { label: 'Luz', atWord: null }], links: [] } }, { representation: 'illustrative' }) });
    const candidates: FootageCandidate[] = ['er-1', 'er-2', 'hk-1', 'hk-2', 'er-3'].map((id, index) => ({ assetId: `${id.slice(0, 2)}-a`, segmentId: id, subjectId: id.slice(0, 2), startMs: index * 10_000, endMs: index * 10_000 + 6_000, source: 'official', assetDurationMs: 120_000, analysis: clean }));
    const executed = applyEditorialPlan(timeline, plan, { segments, subjects, candidates, proxyPaths: new Map() });
    const diagram = (executed.document.tracks.find((track) => track.kind === 'graphics')?.items ?? []).find((item) => item.source.kind === 'graphic' && item.source.component === 'diagram');
    expect(diagram?.startMs).toBe(10_000);
    expect(diagram?.source).toMatchObject({ props: { layout: 'hub', illustrative: true, nodes: [{ label: 'Horizonte' }, { label: 'Luz' }] } });
    expect(executed.fallbacks.some((item) => item.segmentId === 'd')).toBe(false);
    const video = executed.document.tracks.find((track) => track.kind === 'video')?.items ?? [];
    expect(video.some((item) => item.startMs === 10_000)).toBe(true);
    const bare = applyEditorialPlan(timeline, plan, { segments, subjects, candidates: [], proxyPaths: new Map() });
    expect(bare.gaps.some((gap) => gap.segmentId === 'd' && gap.message.includes('diagrama sem imagem'))).toBe(true);
  });
});
