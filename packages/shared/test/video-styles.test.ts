import { describe, expect, it } from 'vitest';
import { commonScript, DEFAULT_STYLE_CHOICE, validateStyleChoice, VIDEO_STYLES, videoStyle, videoStyleSchema } from '../src/video-styles.js';

describe('video style registry', () => {
  it('starts with the Dossiê as a valid default style', () => {
    expect(VIDEO_STYLES[0]?.id).toBe('dossie');
    expect(VIDEO_STYLES.filter((style) => style.kind === 'video').map((style) => style.id)).toEqual(['dossie', 'explicativo', 'tipografia-cinetica', 'motion-cenas-base', 'motion-cenas-editorial', 'one-take', 'swiss-motion-graphics', 'whiteboard-explainer', 'data-storytelling', 'dark-tech-keynote', 'caption-news', 'halftone-dossier', 'drawn-book', 'drawn-watercolor']);
    for (const style of VIDEO_STYLES) expect(videoStyleSchema.parse(style)).toEqual(style);
    expect(videoStyle('dossie')).toMatchObject({ engine: 'kit-html', template: 'dossie', license: { noncommercial: false } });
    expect(() => videoStyle('nao-existe')).toThrow(/desconhecido/);
  });

  it('accepts only choices the registry can render', () => {
    expect(validateStyleChoice(DEFAULT_STYLE_CHOICE)).toEqual(DEFAULT_STYLE_CHOICE);
    expect(() => validateStyleChoice({ ...DEFAULT_STYLE_CHOICE, styleId: 'nao-existe' })).toThrow(/desconhecido/);
    expect(() => validateStyleChoice({ ...DEFAULT_STYLE_CHOICE, styleVersion: 2 })).toThrow(/não está instalado/);
    expect(validateStyleChoice({ ...DEFAULT_STYLE_CHOICE, treatmentId: 'colagem-jornal' })).toMatchObject({ treatmentId: 'colagem-jornal' });
    expect(() => validateStyleChoice({ ...DEFAULT_STYLE_CHOICE, scenes: { 'cena-1': { styleId: 'nao-existe' } } })).toThrow(/desconhecido/);
    expect(() => validateStyleChoice({ ...DEFAULT_STYLE_CHOICE, extra: true })).toThrow();
  });
});

describe('common script', () => {
  it('reads the Dossiê script into style-neutral scenes with start, end, chapter, source and blocks', () => {
    const script = commonScript({
      serie: 'Série', rodape: 'Rodapé', duracao: 30,
      cenas: [
        { at: 0, capitulo: { n: 1, titulo: 'Abertura', cor: 'amarelo' }, blocos: [{ tipo: 'lead', texto: 'Olá', at: 0.5 }, { semTipo: true }, null] },
        { at: 12, fonte: 'IBGE 2025', blocos: [{ tipo: 'barras', titulo: 'Dados', itens: [] }] },
        { fonte: '  ', blocos: 'inválido' },
      ],
    });
    expect(script).toMatchObject({ series: 'Série', footer: 'Rodapé', duration: 30 });
    expect(script.scenes.map((scene) => [scene.id, scene.at, scene.end])).toEqual([['cena-1', 0, 12], ['cena-2', 12, 30], ['cena-3', 0, 30]]);
    expect(script.scenes[0]?.chapter).toEqual({ n: 1, title: 'Abertura', color: 'amarelo' });
    expect(script.scenes[0]?.blocks).toEqual([{ tipo: 'lead', texto: 'Olá', at: 0.5 }]);
    expect(script.scenes[1]?.source).toBe('IBGE 2025');
    expect(script.scenes[2]?.source).toBeNull();
    expect(script.scenes[2]?.blocks).toEqual([]);
    expect(commonScript(null)).toEqual({ series: '', footer: '', duration: 0, scenes: [] });
  });
});

describe('style recommendation', () => {
  it('puts first the styles whose recommended niches appear in the text', async () => {
    const { recommendVideoStyles, videoStyleSchema: schema } = await import('../src/video-styles.js');
    const style = (id: string, recommendedFor: string[]) => schema.parse({ ...VIDEO_STYLES[0], id, recommendedFor });
    const styles = [style('a', ['games']), style('b', ['finanças', 'notícia']), style('c', ['notícia'])];
    expect(recommendVideoStyles(styles, 'Notícia sobre finanças pessoais')).toEqual(['b', 'c']);
    expect(recommendVideoStyles(styles, 'receitas')).toEqual([]);
  });
});
