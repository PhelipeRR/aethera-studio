import { describe, expect, it } from 'vitest';
import { captionCues, captionCuesSrt, captionFontPx, captionLineCharsFor, sceneCaptionCues, editorialGate, editorialReportMarkdown, splitSceneIntoShots, type EditorialShot, type FootageVisual, type SceneWords } from '../src/index.js';

const words = (text: string, startMs = 0, msPerWord = 350, gapAfterSentenceMs = 0) => {
  let at = startMs;
  return text.split(' ').map((w) => { const word = { w, startMs: at, endMs: at + msPerWord - 40 }; at += msPerWord + (/[.!?]$/u.test(w) ? gapAfterSentenceMs : 0); return word; });
};

describe('phrase captions (E3)', () => {
  it('groups words into short phrases of at most two lines, breaking at sentences and long pauses', () => {
    const cues = captionCues(words('Três jogos. Três jeitos diferentes de prender você na tela. Cyberpunk dois mil e setenta e sete, Elden Ring e Hollow Knight Silksong.', 0, 330, 400));
    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(42);
      expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(6_000);
    }
    expect(cues[0]?.lines.join(' ')).toBe('Três jogos.');
    expect(cues.every((cue, index) => index === 0 || cue.startMs >= (cues[index - 1]?.endMs ?? 0))).toBe(true);
  });

  it('holds a short phrase on screen for the minimum reading time when the next one allows it', () => {
    const cues = captionCues([{ w: 'Sim.', startMs: 0, endMs: 300 }, { w: 'Depois', startMs: 2_000, endMs: 2_400 }, { w: 'disso.', startMs: 2_400, endMs: 2_800 }]);
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 1_200 });
  });

  it('keeps a fast cue on screen into the following pause until it reads at 17 characters per second, never into the next cue', () => {
    // 47 characters spoken in 2 s (≈ 23/s): it borrows the 900 ms pause after it, up to 80 ms before the next cue.
    const fast = words('Esse lugar existe só como cenário ou ele conta.', 0, 250).concat(words('Depois.', 2_900, 300));
    const cues = captionCues(fast);
    expect(cues[0]?.lines.join(' ')).toBe('Esse lugar existe só como cenário ou ele conta.');
    expect(cues[0]?.endMs).toBe(Math.ceil((47 / 17) * 1_000));
    // When the next cue comes sooner, the reading time is cut 80 ms before it rather than overlap.
    const tight = captionCues(words('Esse lugar existe só como cenário ou ele conta.', 0, 250).concat(words('Depois.', 2_300, 300)));
    expect(tight[0]?.endMs).toBe(2_220);
    expect((tight[1]?.startMs ?? 0) - (tight[0]?.endMs ?? 0)).toBe(80);
  });

  it('breaks a long sentence after a comma, never cuts a word and never ends a line on a function word', () => {
    const text = 'Um jogo respeita você quando suas decisões mudam alguma coisa, e quando ele não tenta te empurrar para gastar mais, nem te prender com truques de interface.';
    const cues = captionCues(words(text, 0, 300));
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.map((cue) => cue.lines.join(' ')).join(' ')).toBe(text);
    expect(cues[0]?.lines.join(' ').endsWith('coisa,')).toBe(true);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(line.length).toBeLessThanOrEqual(42);
        expect(['de', 'a', 'o', 'e', 'para', 'com', 'que', 'em'].includes(line.split(' ').at(-1) ?? '')).toBe(false);
      }
    }
  });

  it('sizes captions for comfortable reading in 1080p and on small screens, and two full lines still fit the safe width', () => {
    const wide = { width: 1920, height: 1080, safeArea: { left: 96, right: 96 } };
    const tall = { width: 1080, height: 1920, safeArea: { left: 54, right: 54 } };
    // At least 5% of the height in 16:9 (the E3 sample used 4.5% and read small); vertical limited by the width.
    expect(captionFontPx(wide)).toBeGreaterThanOrEqual(56);
    expect(captionFontPx(tall)).toBeLessThanOrEqual(Math.round(tall.width * 0.06));
    for (const format of [wide, tall]) {
      const chars = captionLineCharsFor(format);
      expect(chars).toBeGreaterThanOrEqual(18);
      // A full line at the average glyph width stays inside the safe width.
      expect(chars * captionFontPx(format) * 0.52).toBeLessThanOrEqual(format.width - format.safeArea.left - format.safeArea.right);
    }
    expect(captionLineCharsFor(wide)).toBe(42);
  });

  it('cues each scene on its own clock, places it on the run clock and writes the same cues as SubRip', () => {
    const cues = sceneCaptionCues([{ startMs: 0, words: words('Três jogos.', 0, 300) }, { startMs: 1_000, words: words('Mas aqui vai um aviso.', 0, 300) }]);
    expect(cues.map((cue) => [cue.startMs, cue.lines.join(' ')])).toEqual([[0, 'Três jogos.'], [1_000, 'Mas aqui vai um aviso.']]);
    // The first cue would hold for 1.2 s; it ends 80 ms before the next scene's cue instead.
    expect(cues[0]?.endMs).toBe(920);
    expect(captionCuesSrt(cues)).toBe('1\n00:00:00,000 --> 00:00:00,920\nTrês jogos.\n\n2\n00:00:01,000 --> 00:00:02,460\nMas aqui vai um aviso.\n');
  });
});

describe('shots inside a scene (E4)', () => {
  it('splits a scene at sentence boundaries with word ranges and real times, merging fragments shorter than the minimum', () => {
    const scene: SceneWords = { id: 'scene-5', startMs: 28_574, words: words('Em Cyberpunk, preste atenção na cidade. Em Elden Ring, na paisagem. Em Silksong, nos corredores.', 0, 300) };
    const shots = splitSceneIntoShots(scene);
    expect(shots.map((shot) => shot.text)).toEqual(['Em Cyberpunk, preste atenção na cidade.', 'Em Elden Ring, na paisagem.', 'Em Silksong, nos corredores.']);
    expect(shots[0]).toMatchObject({ id: 'scene-5:0', sceneId: 'scene-5', wordStart: 0, wordEnd: 5, startMs: 28_574 });
    expect(shots[2]?.endMs).toBe(28_574 + (scene.words.at(-1)?.endMs ?? 0));
    const tiny = splitSceneIntoShots({ id: 's', startMs: 0, words: words('Sim. Isso mesmo, e continua aqui.', 0, 200) });
    expect(tiny).toHaveLength(1);
  });

  it('keeps each item of an enumeration as its own shot even when a sentence is short (fast pace)', () => {
    // 300 ms per word: the last item lasts 1.16 s of speech, below the 1.2 s minimum, and still names its own subject.
    const shots = splitSceneIntoShots({ id: 'scene-5', startMs: 0, words: words('Em Cyberpunk, preste atenção na cidade. Em Elden Ring, na paisagem. Em Silksong, nos corredores.', 0, 300) });
    expect(shots).toHaveLength(3);
    expect(shots[2]?.text).toBe('Em Silksong, nos corredores.');
  });

  it('measures screen time: each shot lasts until the next one starts, and the last until the scene ends', () => {
    const scene: SceneWords = { id: 'scene-x', startMs: 10_000, endMs: 16_000, words: words('Primeira frase aqui. Segunda frase com pausa.', 0, 360, 700) };
    const shots = splitSceneIntoShots(scene);
    expect(shots[0]).toMatchObject({ startMs: 10_000, endMs: 10_000 + (scene.words[3]?.startMs ?? 0) });
    expect(shots[1]).toMatchObject({ startMs: 10_000 + (scene.words[3]?.startMs ?? 0), endMs: 16_000 });
  });

  it('merges only content-free fragments, before or after their neighbour', () => {
    expect(splitSceneIntoShots({ id: 'a', startMs: 0, words: words('Sim. A cidade inteira muda à noite.', 0, 360) }).map((shot) => shot.text)).toEqual(['Sim. A cidade inteira muda à noite.']);
    expect(splitSceneIntoShots({ id: 'b', startMs: 0, words: words('A cidade inteira muda à noite. Pois é.', 0, 360) }).map((shot) => shot.text)).toEqual(['A cidade inteira muda à noite. Pois é.']);
  });
});

const footageVisual = (overrides: Partial<FootageVisual> = {}): FootageVisual => ({ type: 'footage', assetId: 'elden-trailer', inMs: 160_000, outMs: 163_091, nature: 'action', overlays: { burnedText: false, watermark: false, webcam: false }, sourceMismatch: false, ...overrides });

const footage = (overrides: Partial<EditorialShot> = {}): EditorialShot => ({
  shotId: 'scene-6:0', sceneId: 'scene-6', startMs: 33_909, endMs: 37_000, narration: 'Segundo eixo: o combate.',
  intent: { kind: 'subject_footage', subjectIds: ['elden'], natures: ['action'], wants: 'combate de perto', onScreenText: null },
  visual: footageVisual(),
  relevance: { decision: 'accept', reason: 'combate: luta observada' }, evidence: ['luta de espadas observada nos 3 quadros'], captionPlacement: 'bottom', themeId: 'graphite', humanDecision: null, ...overrides,
});

describe('editorial gate (E1)', () => {
  const base = { productionThemeId: 'graphite', pacing: { minWpm: 145, maxWpm: 170, blockWpm: 185 }, scenes: [{ sceneId: 'scene-6', words: 20, speechMs: 7_500 }], captions: captionCues(words('Segundo eixo: o combate. Aqui a régua é o controle.', 0, 380, 300)) };

  it('is ready for a human only when every shot is backed by evidence; it never approves by itself', () => {
    const gate = editorialGate({ ...base, shots: [footage()] });
    expect(gate.status).toBe('ready_for_human');
    expect(gate.shots[0]?.checks.every((check) => check.passed)).toBe(true);
    expect(editorialGate({ ...base, shots: [footage()], humanApproval: { approvedBy: 'user', at: '2026-11-12T12:00:00.000Z' } }).status).toBe('approved');
  });

  it('blocks webcam footage, mislabeled sources, repeated cuts, empty fillers and captions over burned-in text', () => {
    const gate = editorialGate({ ...base, shots: [
      footage({ visual: footageVisual({ overlays: { burnedText: false, watermark: false, webcam: true } }) }),
      footage({ shotId: 'b', visual: footageVisual({ sourceMismatch: true }) }),
      footage({ shotId: 'c' }),
      footage({ shotId: 'd', visual: { type: 'none' }, relevance: null }),
      footage({ shotId: 'e', visual: footageVisual({ assetId: 'other', overlays: { burnedText: true, burnedTextRegion: 'bottom', watermark: false, webcam: false } }) }),
    ] });
    expect(gate.status).toBe('blocked');
    const failed = (shotId: string) => gate.shots.find((shot) => shot.shotId === shotId)?.checks.filter((check) => !check.passed).map((check) => check.id);
    expect(failed('scene-6:0')).toContain('webcam');
    expect(failed('b')).toContain('source-mismatch');
    expect(failed('c')).toContain('repetition');
    expect(failed('d')).toContain('visual-present');
    expect(failed('e')).toContain('caption-collision');
  });

  it('sends partial or uncertain matches to a person and never accepts footage only because it is related', () => {
    const review = editorialGate({ ...base, shots: [footage({ relevance: { decision: 'review', reason: 'A única ligação é o nome do assunto.' } })] });
    expect(review.status).toBe('awaiting_review');
    const approved = editorialGate({ ...base, shots: [footage({ relevance: { decision: 'review', reason: 'parcial' }, humanDecision: { decision: 'approved', note: 'serve como contexto', at: '2026-11-12T12:00:00.000Z' } })] });
    expect(approved.status).toBe('ready_for_human');
    const rejected = editorialGate({ ...base, shots: [footage({ relevance: { decision: 'reject', reason: 'mostra menu' } })] });
    expect(rejected.status).toBe('blocked');
  });

  it('checks pace, caption legibility, composition legibility and visual coherence, not only semantics', () => {
    const fast = editorialGate({ ...base, scenes: [{ sceneId: 'scene-6', words: 28, speechMs: 7_000 }], shots: [footage()] });
    expect(fast.checks.find((check) => check.id === 'pace:scene-6')).toMatchObject({ passed: false, severity: 'blocking' });
    const slowish = editorialGate({ ...base, scenes: [{ sceneId: 'scene-6', words: 22, speechMs: 7_500 }], shots: [footage()] });
    expect(slowish.checks.find((check) => check.id === 'pace:scene-6')).toMatchObject({ passed: false, severity: 'warning' });
    const crammed = editorialGate({ ...base, captions: [{ startMs: 0, endMs: 900, lines: ['uma legenda muito longa que não dá para ler', 'em menos de um segundo na tela'] }], shots: [footage()] });
    expect(crammed.checks.filter((check) => check.id.startsWith('caption') && !check.passed).length).toBeGreaterThan(0);
    const card = footage({ shotId: 'card', visual: { type: 'composition', component: 'axis-card', themeId: 'aethera-ui' }, relevance: null, intent: { kind: 'concept', subjectIds: [], natures: [], wants: 'eixo', onScreenText: 'Um cartão com texto longo demais para ser lido em pouco mais de um segundo na tela' }, endMs: 35_200 });
    const coherence = editorialGate({ ...base, shots: [card] });
    const cardChecks = coherence.shots[0]?.checks.filter((check) => !check.passed).map((check) => check.id);
    expect(cardChecks).toEqual(expect.arrayContaining(['theme', 'text-legibility']));
  });

  it('writes a per-shot report a person can read', () => {
    const markdown = editorialReportMarkdown(editorialGate({ ...base, shots: [footage()] }));
    expect(markdown).toContain('Segundo eixo: o combate.');
    expect(markdown).toContain('luta de espadas observada');
    expect(markdown).toMatch(/aguardando aprovação humana/iu);
  });
});
