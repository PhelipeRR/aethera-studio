import { describe, expect, it } from 'vitest';
import { applyShotFootage, assembleTimeline, captionFit, footageRejection, mentionedSubjects, natureHints, planShotFootage, subjectAliases, SUBJECT_LABEL_STYLE, VIDEO_FORMATS, type FootageCandidate, type FootageSubject, type ShotSpan, type Storyboard } from '../src/index.js';

const subjects: FootageSubject[] = [{ id: 'cp', title: 'Cyberpunk 2077' }, { id: 'er', title: 'Elden Ring' }, { id: 'hk', title: 'Hollow Knight Silksong' }];
const clean = (nature: 'action' | 'exploration' | 'text_card' | 'interface' = 'action') => ({ nature, overlays: { burnedText: false, watermark: false, webcam: false }, frames: [{ atMs: 0, observed: 'cena', visibleText: [] }] });
const segment = (id: string, subjectId: string, startMs: number, endMs: number, extra: Partial<FootageCandidate> = {}): FootageCandidate => ({ assetId: `${subjectId}-trailer`, segmentId: id, subjectId, startMs, endMs, source: 'official', assetDurationMs: 120_000, analysis: clean(), ...extra });
const shot = (id: string, text: string, startMs: number, endMs: number, sceneId = 's1'): ShotSpan => ({ id, sceneId, wordStart: 0, wordEnd: 0, startMs, endMs, text });
const none = new Map<string, string | null>();

describe('shot footage (E4/E5 after the E3 review)', () => {
  it('recognizes a subject however the narration names it, in order of mention', () => {
    expect(subjectAliases(subjects[0] as FootageSubject)).toEqual(expect.arrayContaining(['cyberpunk 2077', 'cyberpunk dois mil e setenta e sete', 'cyberpunk']));
    expect(subjectAliases(subjects[2] as FootageSubject)).toContain('silksong');
    expect(mentionedSubjects('Em Silksong, nos corredores. Em Cyberpunk dois mil e setenta e sete, a cidade.', subjects)).toEqual(['hk', 'cp']);
    expect(mentionedSubjects('Um jogo respeita você quando suas decisões mudam alguma coisa.', subjects)).toEqual([]);
  });

  it('never illustrates a subject with another subject’s footage: no eligible footage gives an identity card', () => {
    const plans = planShotFootage({ shots: [shot('a', 'Em Cyberpunk dois mil e setenta e sete, preste atenção na cidade.', 0, 3_000)], sceneSubjects: none, subjects, candidates: [segment('er-1', 'er', 30_000, 40_000)] });
    expect(plans[0]).toMatchObject({ kind: 'identity_card', subjectIds: ['cp'], cuts: [] });
    expect(plans[0]?.reason).toContain('Cyberpunk 2077');
  });

  it('rejects webcam, third-party and divergent sources, and handles burned-in text against the captions', () => {
    expect(footageRejection(segment('w', 'er', 0, 5_000, { analysis: { ...clean(), overlays: { burnedText: false, watermark: false, webcam: true } } }))).toBe('webcam na imagem');
    expect(footageRejection(segment('t', 'er', 0, 5_000, { source: 'third_party' }))).toBe('comentário de terceiro');
    expect(footageRejection(segment('d', 'cp', 0, 5_000, { source: 'divergent' }))).toBe('fonte divergente');
    const bottomText = { ...clean(), overlays: { burnedText: true, burnedTextRegion: 'bottom' as const, watermark: false, webcam: false } };
    expect(captionFit(bottomText)).toEqual({ fits: true, placement: 'top' });
    expect(captionFit({ ...clean(), frames: [{ atMs: 0, observed: 'título', visibleText: [{ text: 'RTX ON', region: 'center' }] }] })).toMatchObject({ fits: false });
    // Moving the captions is the fallback: with only subtitled footage the captions go up...
    const plans = planShotFootage({ shots: [shot('a', 'Em Elden Ring, na paisagem.', 0, 2_000)], sceneSubjects: none, subjects, candidates: [segment('er-text', 'er', 10_000, 14_000, { analysis: bottomText })] });
    expect(plans[0]).toMatchObject({ kind: 'footage', captionPlacement: 'top' });
    // ...but a clean shot of the same subject is preferred over subtitled footage, even a better-ranked nature.
    const clean2 = planShotFootage({ shots: [shot('a', 'Em Elden Ring, na paisagem.', 0, 2_000)], sceneSubjects: none, subjects, candidates: [segment('er-text', 'er', 10_000, 14_000, { analysis: bottomText }), segment('er-clean', 'er', 30_000, 34_000, { analysis: clean('exploration') })] });
    expect(clean2[0]).toMatchObject({ captionPlacement: 'bottom', cuts: [{ segmentId: 'er-clean' }] });
  });

  it('rejects a fade or black frame and prefers the kind of shot the sentence describes (v2 contact sheet review)', () => {
    expect(footageRejection(segment('dark', 'er', 0, 5_000, { minBrightness: 0.02 }))).toBe('quadro escuro ou fade');
    expect(natureHints('Em Elden Ring, na paisagem.')).toEqual(expect.arrayContaining(['landscape']));
    expect(natureHints('Compare como os três tratam o erro do jogador no combate.')).toContain('action');
    expect(natureHints('Mas aqui vai um aviso honesto.')).toEqual([]);
    const crowd = { ...clean(), nature: 'crowd' as const };
    const plans = planShotFootage({ shots: [shot('a', 'Em Elden Ring, na paisagem.', 0, 2_000)], sceneSubjects: none, subjects,
      candidates: [segment('er-dark', 'er', 0, 5_000, { analysis: clean('exploration'), minBrightness: 0.01 }), segment('er-crowd', 'er', 10_000, 15_000, { analysis: crowd }), segment('er-land', 'er', 20_000, 25_000, { analysis: { ...clean(), nature: 'landscape' } })] });
    expect(plans[0]?.cuts.map((cut) => cut.segmentId)).toEqual(['er-land']);
  });

  it('fills a long shot with plain cuts of different segments, never reusing one, and prefers action over title cards', () => {
    const candidates = [segment('er-card', 'er', 0, 6_000, { analysis: clean('text_card') }), segment('er-1', 'er', 30_000, 32_500), segment('er-2', 'er', 50_000, 52_500), segment('er-3', 'er', 70_000, 72_500)];
    const plans = planShotFootage({ shots: [shot('a', 'Em Elden Ring, na paisagem e no combate.', 0, 5_000), shot('b', 'Em Elden Ring de novo.', 5_000, 7_000)], sceneSubjects: none, subjects, candidates });
    const segments = plans.flatMap((plan) => plan.cuts.map((cut) => cut.segmentId));
    expect(new Set(segments).size).toBe(segments.length);
    expect(plans[0]?.cuts.map((cut) => cut.segmentId)).toEqual(['er-1', 'er-2']);
    expect(plans[0]?.cuts.reduce((total, cut) => total + cut.endMs - cut.startMs, 0)).toBe(5_000);
    expect(plans.every((plan) => plan.cuts.every((cut) => cut.outMs - cut.inMs === cut.endMs - cut.startMs))).toBe(true);
  });

  it('gives a sentence comparing subjects a comparison card, rotates general statements between subjects and labels subject changes', () => {
    const candidates = ['er', 'hk'].flatMap((id) => [segment(`${id}-1`, id, 20_000, 26_000), segment(`${id}-2`, id, 40_000, 46_000), segment(`${id}-3`, id, 60_000, 66_000)]);
    const plans = planShotFootage({
      shots: [shot('a', 'Três jogos.', 0, 1_500), shot('b', 'Três jeitos de prender você.', 1_500, 4_000), shot('c', 'Cyberpunk dois mil e setenta e sete, Elden Ring e Hollow Knight Silksong.', 4_000, 8_000), shot('d', 'Em Silksong, nos corredores.', 8_000, 10_000, 's2'), shot('e', 'Eles são estreitos.', 10_000, 12_000, 's2')],
      sceneSubjects: none, subjects, candidates,
    });
    expect(plans.map((plan) => plan.kind)).toEqual(['footage', 'footage', 'comparison_card', 'footage', 'footage']);
    // The comparison card lists one subject per line instead of a joined title that wraps inside a name.
    const timeline = assembleTimeline({ runId: 'r', storyboard: { schemaVersion: 1, timing: 'measured', narrationKey: 'n', scenes: [] }, format: VIDEO_FORMATS['youtube-long'] });
    const card = applyShotFootage(timeline, plans, { subjects, proxyPaths: new Map() }).tracks.find((track) => track.kind === 'graphics')?.items[0];
    expect(card?.source.kind === 'graphic' ? card.source.props['items'] : null).toEqual(['Cyberpunk 2077', 'Elden Ring', 'Hollow Knight Silksong']);
    // Inside a scene a general statement stays with the subject on screen (no label on every sentence); the follow-up
    // sentence of a scene keeps the subject just named.
    expect(plans[0]?.cuts[0]?.assetId).toBe(plans[1]?.cuts[0]?.assetId);
    expect(plans[4]?.subjectIds).toEqual(['hk']);
    expect(plans.map((plan) => plan.label)).toEqual(['Elden Ring', null, null, 'Hollow Knight Silksong', null]);
  });

  it('gives a sentence that names a subject first claim on its footage, before general sentences (Cyberpunk regression)', () => {
    // Only one Cyberpunk shot exists; the general opening comes first in the script but must not take it.
    const candidates = [segment('cp-1', 'cp', 20_000, 26_000), segment('er-1', 'er', 20_000, 26_000), segment('hk-1', 'hk', 20_000, 26_000)];
    const plans = planShotFootage({ shots: [shot('a', 'Três jogos.', 0, 2_000, 's1'), shot('b', 'Em Cyberpunk dois mil e setenta e sete, a cidade.', 2_000, 4_000, 's2')], sceneSubjects: none, subjects, candidates });
    expect(plans[1]).toMatchObject({ kind: 'footage', cuts: [{ segmentId: 'cp-1' }], label: 'Cyberpunk 2077' });
    expect(plans[0]?.cuts[0]?.segmentId).not.toBe('cp-1');
  });

  it('rotates general statements between subjects from one scene to the next', () => {
    const candidates = ['er', 'hk'].flatMap((id) => [segment(`${id}-1`, id, 20_000, 26_000), segment(`${id}-2`, id, 40_000, 46_000)]);
    const plans = planShotFootage({ shots: [shot('a', 'Mas aqui vai um aviso.', 0, 2_000, 's1'), shot('b', 'Então vamos montar um método.', 2_000, 4_000, 's2'), shot('c', 'A pergunta é simples.', 4_000, 6_000, 's3')], sceneSubjects: none, subjects, candidates });
    expect(plans.map((plan) => plan.label)).toEqual(['Elden Ring', 'Hollow Knight Silksong', 'Elden Ring']);
  });

  it('applies the plan to the timeline: cuts without effects, cards, labels and captions per shot with their placement', () => {
    const storyboard: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'n', scenes: [{
      id: 's1', chapter: 1, narration: 'Em Elden Ring, na paisagem. Em Cyberpunk, a cidade.', startMs: 0, endMs: 4_000, claimIds: [], visualObjective: 'x', subjectId: 'er', sceneType: 'broll', searchTerms: [],
      visual: { type: 'fallback', kind: 'animation', reason: 'x' }, onScreenText: '', transition: 'fade', camera: 'push-in', locked: false, reviewStatus: 'approved',
      audio: { relativePath: 'a.wav', durationMs: 4_000, key: 'k', words: 'Em Elden Ring, na paisagem. Em Cyberpunk, a cidade.'.split(' ').map((w, index) => ({ w, startMs: index * 450, endMs: index * 450 + 400 })) },
    }] };
    const timeline = assembleTimeline({ runId: 'r', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const plans = planShotFootage({ shots: [shot('a', 'Em Elden Ring, na paisagem.', 0, 2_250), shot('b', 'Em Cyberpunk, a cidade.', 2_250, 4_000)], sceneSubjects: new Map([['s1', 'er']]), subjects,
      candidates: [segment('er-1', 'er', 30_000, 35_000, { analysis: { ...clean(), overlays: { burnedText: true, burnedTextRegion: 'bottom', watermark: false, webcam: false } } })] });
    const applied = applyShotFootage(timeline, plans, { subjects, proxyPaths: new Map([['er-trailer', 'media/er.mp4']]) });
    const track = (kind: string) => applied.tracks.find((item) => item.kind === kind)?.items ?? [];
    expect(track('video')).toHaveLength(1);
    expect(track('video')[0]).toMatchObject({ startMs: 0, durationMs: 2_250, keyframes: [], effects: [], source: { kind: 'media', proxyPath: 'media/er.mp4' } });
    expect(track('video')[0]).not.toHaveProperty('exit');
    expect(track('graphics').map((item) => item.source.kind === 'graphic' ? item.source.props['title'] : null)).toEqual(['Cyberpunk 2077']);
    expect(track('text').filter((item) => item.source.kind === 'text' && item.source.styleId === SUBJECT_LABEL_STYLE).map((item) => item.label)).toEqual(['Elden Ring']);
    const captions = track('captions');
    expect(captions.map((item) => item.source.kind === 'text' ? [item.startMs, item.source.captionPlacement, item.source.words?.map((word) => word.text).join(' ')] : null)).toEqual([[0, 'top', 'Em Elden Ring, na paisagem.'], [2_250, 'bottom', 'Em Cyberpunk, a cidade.']]);
    expect(captions[1]?.source.kind === 'text' ? captions[1].source.words?.[0]?.startMs : null).toBe(0);
  });
});
