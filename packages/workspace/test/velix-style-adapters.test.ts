import { describe, expect, it } from 'vitest';
import { commonScript, DEFAULT_STYLE_CHOICE } from '@neuralbridge/shared';
import { appShowcase, blockText, brandSting, giantText, kidsCaption, kineticExplainer, kineticType, kitText, podcastCuts, premiumCaption, splitLines, talkingHeadOverlay } from '../src/velix-style-adapters.js';
import { renderStyle, resolveStyleRender } from '../src/velix-styles.js';

const dossie = {
  serie: 'Dados & Fatos', rodape: 'Siga o canal', duracao: 24,
  cenas: [
    { at: 0, capitulo: { n: 1, titulo: 'A pergunta', cor: 'amarelo' }, blocos: [{ tipo: 'lead', texto: 'Quanto custa <script>alert(1)</script> viver?' }, { tipo: 'grande', texto: 'Inflação alta' }] },
    { at: 8, fonte: 'IBGE 2025', blocos: [{ tipo: 'contador', rotulo: 'IPCA no ano', de: 0, para: 4.8, sufixo: '%' }, { tipo: 'barras', titulo: 'Por item', itens: [{ nome: 'Comida', valor: 7 }, { nome: 'Casa', valor: 5 }] }, { tipo: 'cards', itens: [{ titulo: 'Juros' }, { titulo: 'Câmbio' }] }, { tipo: 'citacao', texto: 'Ninguém ganha', autor: 'Economista' }] },
    { at: 16, blocos: [{ tipo: 'foto', src: 'prints/tela.png', etiqueta: 'O app' }, { tipo: 'pontos', titulo: 'Famílias', total: 10, destaque: 7 }] },
  ],
};
const script = commonScript(dossie);
const total = (beats: Array<Record<string, unknown>>) => Math.round(beats.reduce((sum, beat) => sum + Number(beat['dur']), 0) * 100) / 100;

describe('style adapters', () => {
  it('escapes untrusted script text for templates that use innerHTML, keeping the *highlight* marker', () => {
    expect(kitText('a <b> & "c" \'d\' *e*')).toBe('a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; *e*');
    expect(blockText({ tipo: 'citacao', texto: 'Frase', autor: 'Fulano' })).toBe('Frase — Fulano');
    expect(splitLines('uma frase bem comprida que precisa quebrar em linhas curtas', 18, 3)).toHaveLength(3);
  });

  it('explainer: one beat per block (max 3 per scene), sources visible and the total equals the script', () => {
    const data = kineticExplainer(script, { handle: '@canal <x>', theme: 'inexistente' });
    expect(data.theme).toBe('t-dark-laranja');
    // Plain fields drop angle brackets, so they stay harmless whatever the template does with them.
    expect(data.handle).toBe('@canal x');
    expect(total(data.beats)).toBe(24);
    expect(data.beats.map((beat) => beat['type'])).toEqual(['text', 'text', 'counter', 'list', 'chips', 'text', 'counter']);
    expect(JSON.stringify(data.beats[0])).toContain('&lt;script&gt;');
    expect(JSON.stringify(data.beats)).not.toContain('<script>');
    expect(data.beats[0]).toMatchObject({ kicker: 'A pergunta' });
    expect(data.beats[2]).toMatchObject({ type: 'counter', label: 'IPCA no ano', to: 4.8, suffix: '%', caption: 'Fonte: IBGE 2025' });
    expect(data.beats[3]).toMatchObject({ type: 'list', title: 'Por item', items: ['Comida 7', 'Casa 5'] });
    expect(data.beats[6]).toMatchObject({ type: 'counter', to: 7, suffix: ' de 10' });
  });

  it('shows a source that already says "Fonte:" without repeating the label', () => {
    const labelled = commonScript({ duracao: 4, cenas: [{ at: 0, fonte: 'Fonte: veículo, data', blocos: [{ tipo: 'lead', texto: 'Oi' }] }] });
    expect(kineticExplainer(labelled).beats[0]).toMatchObject({ kicker: 'Fonte: veículo, data' });
  });

  it('giant text: one word per scene covering the whole script, as plain text', () => {
    const data = giantText(script);
    expect(data.dur).toBe(24);
    // Whole words only: the pair when it fits, otherwise the first word.
    expect(data.palavras.map((word) => word.t)).toEqual(['INFLAÇÃO', 'IPCA NO', 'O APP']);
    expect(data.palavras.map((word) => [word.at, word.dur])).toEqual([[-0.1, 8.1], [8, 8], [16, 8]]);
  });

  it('kinetic type: real word timings win; otherwise each scene shares its time among its words', () => {
    const synthetic = kineticType(script);
    expect(synthetic.dur).toBe(24);
    expect(synthetic.words.every((word) => word.s >= 0 && word.e <= 24 && word.e > word.s)).toBe(true);
    expect(synthetic.words.find((word) => word.s >= 8)?.w).toBe('IPCA');
    const timed = kineticType(script, { words: [{ w: 'Olá', s: 0.2, e: 0.6 }] });
    expect(timed.words).toEqual([{ w: 'Olá', s: 0.2, e: 0.6 }]);
  });

  it('app showcase and stings take photos, series and footer', () => {
    expect(appShowcase(script).scenes).toMatchObject([{ img: 'prints/tela.png', head: 'O app' }]);
    expect(brandSting(script, 'logo-reveal')).toMatchObject({ brand: 'Dados & Fatos', tagline: 'Siga o canal' });
    expect(brandSting(script, 'showreel-bauhaus')).toMatchObject({ title: 'DADOS &amp; FATOS', chapters: ['01 — A PERGUNTA', '02 — IPCA NO ANO 4.8', '03 — O APP'] });
  });

  it('renders each style from the same script; the Dossiê passes through and stings cannot be a whole video', () => {
    const data = JSON.stringify(dossie);
    expect(renderStyle('dossie', data).data).toBe(data);
    expect(renderStyle('explicativo', data)).toMatchObject({ template: 'kinetic-explainer' });
    expect(() => renderStyle('texto-gigante', data)).toThrow(/vídeo base/);
    expect(renderStyle('texto-gigante', data, { baseVideo: 'gravacao.mp4', duration: 12 })).toMatchObject({ template: 'texto-gigante', baseVideo: 'gravacao.mp4' });
    expect(renderStyle('logo-reveal', data).template).toBe('logo-reveal');
    expect(renderStyle('one-take', data)).toMatchObject({ template: 'one-take', engine: 'remotion' });
    expect(() => resolveStyleRender({ ...DEFAULT_STYLE_CHOICE, styleId: 'logo-reveal' }, data)).toThrow(/é uma vinheta/);
    expect(JSON.parse(resolveStyleRender({ ...DEFAULT_STYLE_CHOICE, styleId: 'explicativo', options: { theme: 't-azul-profundo' } }, data).data)).toMatchObject({ theme: 't-azul-profundo' });
    expect(() => renderStyle('explicativo', 'não é json')).toThrow(/JSON válido/);
  });

  it('layers over filmed footage: spoken words drive the captions and scenes stretch over the recording', () => {
    const words = [{ w: 'A', s: 0.2, e: 0.4 }, { w: 'inflação', s: 0.5, e: 1 }, { w: '<b>subiu</b>', s: 1.1, e: 1.5 }, { w: 'muito', s: 2.4, e: 2.8 }, { w: 'neste', s: 2.9, e: 3.2 }, { w: 'ano', s: 3.3, e: 3.6 }, { w: 'todo', s: 3.7, e: 4 }];
    const premium = premiumCaption(script, { words, duration: 12 });
    expect(premium).toMatchObject({ dur: 12, estilo: 'claro', maxWords: 3 });
    expect(premium.words[2]?.w).toBe('&lt;b&gt;subiu&lt;/b&gt;');
    expect(premium.keywords).toContain('inflação');
    // A pause over 0.6 s or 3 words closes a line of the kids caption.
    const kids = kidsCaption(script, { words, duration: 12 });
    expect(kids.words.map((word) => word.l)).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(kids.lines).toHaveLength(3);
    const talking = talkingHeadOverlay(script, { words, duration: 12 });
    // The 24 s script is stretched over 12 s of footage: its second scene (at 8 s) lands at 4 s.
    expect(talking.heads.map((head) => head.at)).toEqual([0]);
    expect(talking.stickers).toMatchObject([{ at: 4.6, text: '4.8% IPCA no ano' }]);
    const podcast = podcastCuts(script, { words, duration: 12 });
    expect(podcast.cenas.map((cena) => [cena.a, cena.els[0]?.t])).toEqual([[0, 'INFLAÇÃO ALTA'], [4, '4.8%']]);
    expect(podcast.credit).toBe('Dados & Fatos');
  });
});
