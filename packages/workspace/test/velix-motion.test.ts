import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignMotionCaptions, alignMotionScenes, contrastRatio, convertMotionScene, generateMotionCaptions, motionFontFamily, motionProjectSchema, motionTimeline, parseCaptionJson, parseSrt, readableTextColor, shiftCaptions, upgradeMotionProject, type MotionProject } from '@neuralbridge/shared/motion';
import { alignVelixMotionVoice, resolveMotionAsset, syncVelixMotionNarration, validateMotionImageAsset, validateMotionProject } from '../src/velix-motion.js';

const project: MotionProject = { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 1280, height: 720, fps: 30, captions: [], scenes: [{ id: 'a', kind: 'title', text: 'Oi', durationInFrames: 30, transition: 'cut' }, { id: 'b', kind: 'bars', title: 'Dados', source: 'IBGE', items: [{ label: 'A', value: 1 }], durationInFrames: 60, transition: 'fade' }] };

describe('motion contract', () => {
  it('confines Motion assets to the project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-asset-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets', 'foto.png'), 'not-an-image');
    expect(resolveMotionAsset(root, 'assets/foto.png')).toBe(join(root, 'assets', 'foto.png'));
    expect(() => resolveMotionAsset(root, '../outside.png')).toThrow(/fora do projeto/);
    expect(() => validateMotionImageAsset(root, 'assets/foto.png')).toThrow(/PNG\/JPEG/);
    writeFileSync(join(root, 'assets', 'ok.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(validateMotionImageAsset(root, 'assets/ok.png')).toContain('ok.png');
  });
  it('upgrades v1 in memory and converts a scene without losing its text', () => {
    const upgraded = upgradeMotionProject(project);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.style.background).toEqual({ kind: 'solid', color: '#000000' });
    expect(upgraded.licenses).toEqual([]);
    const first = upgraded.scenes[0];
    if (!first) throw new Error('fixture missing scene');
    const converted = convertMotionScene(first, 'card');
    expect(converted.kind).toBe('card');
    expect(converted).toMatchObject({ body: expect.stringContaining('Oi') });
    expect(motionProjectSchema.parse(upgraded).schemaVersion).toBe(2);
  });

  it('aligns unlocked scene durations and reports missing segments', () => {
    const firstScene = project.scenes[0]; const secondScene = project.scenes[1];
    expect(firstScene).toBeDefined(); expect(secondScene).toBeDefined();
    if (!firstScene || !secondScene) return;
    const input = upgradeMotionProject({ ...project, scenes: [{ ...firstScene, segment: { text: 'Oi', startChar: 0, endChar: 2 } }, { ...secondScene, segment: { text: 'ausente', startChar: 3, endChar: 10 } }] });
    const result = alignMotionScenes(input, [{ text: 'Oi', startMs: 100, endMs: 1_100, timestampMs: 100, confidence: 1 }]);
    expect(result.project.scenes[0]?.durationInFrames).toBe(30);
    expect(result.missed).toEqual(['b']);
  });
  it('generates captions from the script and real word timestamps', () => {
    const result = generateMotionCaptions('Olá mundo. Segunda frase.', [{ w: 'Olá', s: 0, e: 0.4 }, { w: 'mundo', s: 0.5, e: 0.9 }, { w: 'Segunda', s: 1.2, e: 1.6 }, { w: 'frase', s: 1.7, e: 2.1 }]);
    expect(result.missed).toEqual([]);
    expect(result.captions).toMatchObject([{ text: 'Olá mundo.', startMs: 0, endMs: 900 }, { text: 'Segunda frase.', startMs: 1200, endMs: 2100 }]);
  });
  it('chooses readable text with measurable contrast', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(contrastRatio('#ffffff', '#000000')).toBeGreaterThanOrEqual(4.5);
  });
  it('resolves only allow-listed font families', () => {
    expect(motionFontFamily('ibm-plex-mono')).toContain('IBM Plex Mono');
  });

  it('reads JSON captions, shifts them to meet the voice and refuses going before zero', () => {
    const captions = parseCaptionJson('[{"text":"Oi","startMs":100,"endMs":900,"timestampMs":null,"confidence":null}]');
    expect(shiftCaptions(captions, 200)[0]).toMatchObject({ startMs: 300, endMs: 1100 });
    expect(() => shiftCaptions(captions, -500)).toThrow(/antes do início/);
    expect(() => parseCaptionJson('{')).toThrow(/inválido/);
    expect(() => parseCaptionJson('[{"text":"x"}]')).toThrow(/contrato/);
  });

  it('lays scenes out in sequence', () => {
    expect(motionTimeline(project).map((item) => item.from)).toEqual([0, 30]);
  });
  it('refuses unknown scenes, extra fields and a chart without a source', () => {
    expect(() => validateMotionProject({ ...project, scenes: [{ id: 'x', kind: 'script', durationInFrames: 10, transition: 'cut' }] })).toThrow();
    expect(() => validateMotionProject({ ...project, code: 'alert(1)' })).toThrow();
    expect(() => validateMotionProject({ ...project, scenes: [{ id: 'b', kind: 'bars', title: 'x', source: '', items: [{ label: 'A', value: 1 }], durationInFrames: 10, transition: 'cut' }] })).toThrow();
    expect(() => validateMotionProject({ ...project, scenes: [{ id: 'b', kind: 'bars', title: 'x', source: 's', items: [{ label: 'A', value: -1 }], durationInFrames: 10, transition: 'cut' }] })).toThrow();
  });
  it('refuses captions that overlap or run past the video', () => {
    const caption = (startMs: number, endMs: number) => ({ text: 'x', startMs, endMs, timestampMs: null, confidence: null });
    expect(validateMotionProject({ ...project, captions: [caption(0, 1000), caption(1000, 2000)] }).captions).toHaveLength(2);
    expect(() => validateMotionProject({ ...project, captions: [caption(0, 1000), caption(500, 1500)] })).toThrow(/sobrepõe/);
    expect(() => validateMotionProject({ ...project, captions: [caption(0, 9000)] })).toThrow(/duração/);
  });
  it('reads SRT and refuses a malformed block', () => {
    expect(parseSrt('1\n00:00:01,000 --> 00:00:02,500\nOlá\nmundo\n\n2\n00:00:03,000 --> 00:00:04,000\nFim')).toEqual([{ text: 'Olá mundo', startMs: 1000, endMs: 2500, timestampMs: null, confidence: null }, { text: 'Fim', startMs: 3000, endMs: 4000, timestampMs: null, confidence: null }]);
    expect(() => parseSrt('1\nsem tempo\nTexto')).toThrow(/bloco 1/);
  });

  it('aligns caption intervals to the actual spoken words without executing caption content', () => {
    const result = alignMotionCaptions([
      { text: 'Olá mundo', startMs: 0, endMs: 2_000, timestampMs: null, confidence: null },
      { text: 'segunda frase', startMs: 2_000, endMs: 4_000, timestampMs: null, confidence: null },
    ], [
      { w: 'Olá', s: 1.2, e: 1.5 }, { w: 'mundo', s: 1.6, e: 2.1 }, { w: 'segunda', s: 3.4, e: 3.8 }, { w: 'frase', s: 3.9, e: 4.2 },
    ]);
    expect(result.missed).toBe(0);
    expect(result.captions).toMatchObject([{ startMs: 1200, endMs: 2100, timestampMs: 1200, confidence: 1 }, { startMs: 3400, endMs: 4200, timestampMs: 3400, confidence: 1 }]);
  });

  it('finds a caption when the transcription splits a name and still reports different text as missed', () => {
    const spoken = [{ w: 'o', s: 0, e: 0.2 }, { w: 'Neural', s: 0.3, e: 0.6 }, { w: 'Bridge', s: 0.6, e: 1 }, { w: 'fala', s: 1.1, e: 1.4 }];
    const line = (text: string) => ({ text, startMs: 9_000, endMs: 9_500, timestampMs: null, confidence: null });
    expect(alignMotionCaptions([line('O NeuralBridge fala.')], spoken)).toMatchObject({ missed: 0, captions: [{ startMs: 0, endMs: 1400 }] });
    expect(alignMotionCaptions([line('O NeuralBridge canta.')], spoken)).toMatchObject({ missed: 1, captions: [{ startMs: 9000 }] });
  });

  it('accepts a misheard name in a long caption with its real confidence, and never an unrelated sentence', () => {
    const spoken = 'Este é um teste real da narração local do narrow bridge gerada com a voz clonada'.split(' ').map((w, index) => ({ w, s: index, e: index + 0.5 }));
    const line = (text: string) => ({ text, startMs: 90_000, endMs: 90_500, timestampMs: null, confidence: null });
    const { captions, missed } = alignMotionCaptions([line('Este é um teste real da narração local do NeuralBridge, gerada com a voz clonada.')], spoken);
    expect(missed).toBe(0);
    expect(captions[0]).toMatchObject({ startMs: 0, endMs: 15_500 });
    expect(captions[0]?.confidence).toBeGreaterThan(0.85);
    expect(captions[0]?.confidence).toBeLessThan(1);
    expect(alignMotionCaptions([line('Uma frase completamente diferente sobre outro assunto qualquer.')], spoken).missed).toBe(1);
  });

  it('uses the existing transcription kit for a real voice-alignment boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-align-'));
    const kit = mkdtempSync(join(tmpdir(), 'nb-motion-kit-'));
    mkdirSync(join(kit, 'scripts'));
    writeFileSync(join(root, 'voz.mp3'), 'audio');
    writeFileSync(join(kit, 'scripts', 'transcrever.py'), `require('fs').writeFileSync(process.argv[3], ${JSON.stringify(JSON.stringify({ words: [{ w: 'Olá', s: 0.4, e: 0.7 }] }))});`);
    const result = await alignVelixMotionVoice(root, 'voz.mp3', [{ text: 'Olá', startMs: 0, endMs: 1000, timestampMs: null, confidence: null }], { kitPath: kit, python: process.execPath });
    expect(result).toMatchObject({ missed: 0, captions: [{ startMs: 400, endMs: 700, confidence: 1 }] });
  });
  it('chains synced scenes back to back so they fill the narration', () => {
    const scene = (id: string, text: string, lockedDuration = false) => ({ id, kind: 'title' as const, text: id, durationInFrames: 45, transition: 'cut' as const, segment: { text, startChar: 0, endChar: text.length }, lockedDuration });
    const input = upgradeMotionProject({ ...project, scenes: [scene('a', 'Primeira frase.'), scene('b', 'Segunda frase.'), scene('c', 'Travada.', true)] });
    const captions = [{ text: 'Primeira frase.', startMs: 300, endMs: 1_200, timestampMs: 300, confidence: 1 }, { text: 'Segunda frase.', startMs: 1_500, endMs: 2_400, timestampMs: 1_500, confidence: 1 }];
    const result = alignMotionScenes(input, captions, 3_000);
    // a starts at 0 (absorbs the silence before the voice) and lasts until b starts; b runs to the end of the audio; c is locked.
    expect(result.project.scenes.map((item) => item.durationInFrames)).toEqual([45, 45, 45]);
    expect(alignMotionScenes(input, captions, 4_000).project.scenes.map((item) => item.durationInFrames)).toEqual([45, 75, 45]);
    expect(result.missed).toEqual([]);
  });

  it('syncs captions and scenes to the narration and reports what the voice did not say', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-sync-'));
    const kit = mkdtempSync(join(tmpdir(), 'nb-motion-kit-'));
    mkdirSync(join(kit, 'scripts'));
    writeFileSync(join(root, 'voz.mp3'), 'audio');
    const words = [{ w: 'Olá', s: 0.2, e: 0.5 }, { w: 'mundo', s: 0.6, e: 1.0 }, { w: 'Segunda', s: 1.4, e: 1.8 }, { w: 'frase', s: 1.9, e: 2.3 }];
    writeFileSync(join(kit, 'scripts', 'transcrever.py'), `require('fs').writeFileSync(process.argv[3], ${JSON.stringify(JSON.stringify({ words }))});`);
    const draft = upgradeMotionProject({ ...project, scenes: [
      { id: 'a', kind: 'title', text: 'Abertura', durationInFrames: 30, transition: 'cut', segment: { text: 'Olá mundo.', startChar: 0, endChar: 10 } },
      { id: 'b', kind: 'title', text: 'Meio', durationInFrames: 30, transition: 'cut', segment: { text: 'Segunda frase.', startChar: 11, endChar: 25 } },
      { id: 'c', kind: 'title', text: 'Fim', durationInFrames: 30, transition: 'cut', segment: { text: 'Nunca falada.', startChar: 26, endChar: 39 } },
    ] });
    const result = await syncVelixMotionNarration(root, 'voz.mp3', draft, 'Olá mundo. Segunda frase. Nunca falada.', { kitPath: kit, python: process.execPath, audioDurationMs: 3_000 });
    expect(result.project.captions.map((caption) => caption.text)).toEqual(['Olá mundo.', 'Segunda frase.']);
    expect(result.missedCaptions).toEqual(['caption-3']);
    expect(result.missedScenes).toEqual(['c']);
    // a: 0 → 1.4 s; b: 1.4 → 3.0 s; c keeps its own duration for review.
    expect(result.project.scenes.map((scene) => scene.durationInFrames)).toEqual([42, 48, 30]);
    expect(validateMotionProject(result.project).schemaVersion).toBe(2);
  });
});
