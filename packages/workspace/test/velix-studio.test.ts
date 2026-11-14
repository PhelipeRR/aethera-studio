import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendVelixClipScenes, estimateVelixWords, listVelixVideos, loadVelixVideo, saveVelixVideo, syncVelixScenes, syncVelixVoice } from '../src/velix-studio.js';

const root = () => mkdtempSync(join(tmpdir(), 'velix-studio-'));
const scenes = JSON.stringify({ cenas: [
  { blocos: [{ tipo: 'lead', texto: 'Pergunta', frase: 'a esquerda é corrupta' }] },
  { blocos: [{ tipo: 'barras', frase: 'na lista de Fachin' }, { tipo: 'tarja', frase: 'investigado não é condenado' }] },
] });
const spoken = 'A esquerda é corrupta? Depende. Na lista de Fachin, o PT liderava. Investigado não é condenado.'.split(' ').map((w, index) => ({ w, s: index, e: index + 0.8 }));

describe('syncVelixScenes', () => {
  it('moves scenes and blocks to the spoken words', () => {
    const result = syncVelixScenes(scenes, spoken);
    const data = JSON.parse(result.data) as { duracao: number; cenas: Array<{ at: number; blocos: Array<{ at: number }> }> };
    expect(result.missed).toBe(0);
    expect(data.cenas[0]?.at).toBe(0);
    expect(data.cenas[1]?.blocos[0]?.at).toBe(5);
    expect(data.cenas[1]?.at).toBe(4.85);
    expect(data.cenas[1]?.blocos[1]?.at).toBe(12);
    expect(data.duracao).toBe(15 + 0.8 + 1.2);
  });

  it('survives what the voice changed, and counts a phrase it cannot find', () => {
    const changed = spoken.map((word) => (word.w === 'Fachin,' ? { ...word, w: 'Faquim' } : word));
    const result = syncVelixScenes(JSON.stringify({ cenas: [{ blocos: [{ frase: 'na lista de Fachin' }, { frase: 'isto nunca foi dito aqui' }] }] }), changed);
    const data = JSON.parse(result.data) as { cenas: Array<{ blocos: Array<{ at: number }> }> };
    expect(data.cenas[0]?.blocos[0]?.at).toBe(5);
    expect(result.missed).toBe(1);
  });

  it('spreads what it cannot find between the phrases around it', () => {
    const lost = JSON.stringify({ cenas: [{ blocos: [{ frase: 'a esquerda é corrupta' }, { frase: 'nunca dito antes aqui' }, { frase: 'nunca dito depois aqui' }, { frase: 'investigado não é condenado' }] }] });
    const data = JSON.parse(syncVelixScenes(lost, spoken).data) as { cenas: Array<{ blocos: Array<{ at: number }> }> };
    expect(data.cenas[0]?.blocos.map((block) => block.at)).toEqual([0, 4, 8, 12]);
  });

  it('keeps time moving forward when words repeat', () => {
    const data = JSON.parse(syncVelixScenes(JSON.stringify({ cenas: [{ blocos: [{ frase: 'um dois' }, { frase: 'um dois' }] }] }), 'um dois tres um dois'.split(' ').map((w, s) => ({ w, s, e: s + 1 }))).data) as { cenas: Array<{ blocos: Array<{ at: number }> }> };
    expect(data.cenas[0]?.blocos[0]?.at).toBeLessThanOrEqual(data.cenas[0]?.blocos[1]?.at ?? 0);
  });
});

describe('estimateVelixWords', () => {
  it('assumes a natural reading pace', () => {
    expect(estimateVelixWords('um dois tres quatro cinco').at(-1)?.e).toBe(2);
  });
});

describe('appendVelixClipScenes', () => {
  it('keeps approved source intervals in the existing timeline order', () => {
    const data = JSON.parse(appendVelixClipScenes('{"cenas":[],"duracao":0}', [
      { source: 'imports/a.mp4', start: 1, end: 3, rights: 'verified_allowed' },
      { source: 'imports/a.mp4', start: 5, end: 6.5, rights: 'verified_allowed' },
    ])) as { duracao: number; cenas: Array<{ at?: number; blocos?: Array<{ in?: number; out?: number }> }> };
    expect(data.duracao).toBe(3.5);
    expect(data.cenas.map((scene) => scene.at)).toEqual([0, 2]);
    expect(data.cenas[1]?.blocos?.[0]?.in).toBe(5);
  });
  it('rejects unverified material', () => expect(() => appendVelixClipScenes('{"cenas":[]}', [{ source: 'x', start: 0, end: 1, rights: 'unverified' }])).toThrow(/forbidden/));
});

describe('video files', () => {
  it('saves, lists and reloads a video, finding the voice in any case', () => {
    const dir = root();
    saveVelixVideo(dir, 'Meu Vídeo', { narration: 'texto', data: '{"cenas":[]}' });
    mkdirSync(join(dir, 'meu-video', 'pesquisa'));
    writeFileSync(join(dir, 'meu-video', 'pesquisa', 'imagem-01.jpg'), 'x');
    writeFileSync(join(dir, 'meu-video', 'pesquisa', 'fontes.md'), 'x');
    expect(listVelixVideos(dir)).toEqual(['meu-video']);
    expect(loadVelixVideo(dir, 'meu-video')).toMatchObject({ narration: 'texto', audio: null, synced: false, images: ['../pesquisa/imagem-01.jpg'] });
    writeFileSync(join(dir, 'meu-video', 'narracao', 'Voz.mp3'), 'x');
    expect(loadVelixVideo(dir, 'meu-video').audio).toBe('Voz.mp3');
  });

  it('refuses invalid scene data', () => {
    expect(() => saveVelixVideo(root(), 'v', { data: '{' })).toThrow(/invalid/);
  });
});

describe('syncVelixVoice', () => {
  it('asks for the voice first', async () => {
    const dir = root();
    saveVelixVideo(dir, 'v', { data: scenes });
    await expect(syncVelixVoice(dir, 'v')).rejects.toThrow(/narracao\/voz\.mp3/);
  });

  it('transcribes with the kit and saves the new times', async () => {
    const dir = root();
    const kit = root();
    mkdirSync(join(kit, 'scripts'));
    writeFileSync(join(kit, 'scripts', 'transcrever.py'), 'x');
    saveVelixVideo(dir, 'v', { data: scenes, narration: 'texto' });
    writeFileSync(join(dir, 'v', 'narracao', 'voz.mp3'), 'x');
    writeFileSync(join(dir, 'v', 'narracao', 'neuralbridge-narration.json'), JSON.stringify({ schemaVersion: 1, asset: { id: '11111111-1111-4111-8111-111111111111', provider: 'voicestudio', relativePath: 'v/narracao/voz.mp3', format: 'mp3', modelId: 'model', voiceId: 'voice', textHash: 'a'.repeat(64), durationMs: 1, license: { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true }, status: 'ready', createdAt: new Date().toISOString() }, timeline: null }));
    const fake = join(kit, 'fake.cjs');
    writeFileSync(fake, `require('fs').writeFileSync(process.argv[3], ${JSON.stringify(JSON.stringify({ words: spoken }))});`);
    writeFileSync(join(kit, 'scripts', 'transcrever.py'), readFileSync(fake));
    await syncVelixVoice(dir, 'v', { kitPath: kit, python: process.execPath });
    expect(loadVelixVideo(dir, 'v').synced).toBe(true);
    expect(JSON.parse(loadVelixVideo(dir, 'v').data).duracao).toBeGreaterThan(10);
    expect(JSON.parse(readFileSync(join(dir, 'v', 'narracao', 'neuralbridge-narration.json'), 'utf8')).timeline.syncStatus).toBe('synced');
  });
});
