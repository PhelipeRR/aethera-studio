import { describe, expect, it } from 'vitest';
import { motionProjectFromScript } from '../src/velix-motion-adapter.js';

describe('motion script adapter', () => {
  it('maps the approved Dossiê scenes to valid Remotion scenes with stable timing', () => {
    const project = motionProjectFromScript({ duracao: 4, cenas: [
      { at: 0, capitulo: { titulo: 'Abertura' }, blocos: [{ tipo: 'grande', texto: 'Começo' }] },
      { at: 2, blocos: [{ tipo: 'contador', rotulo: 'Crescimento', para: 4.8 }], fonte: 'IBGE' },
    ] });
    expect(project.templateId).toBe('velix-base');
    expect(project.scenes).toMatchObject([{ kind: 'title', text: 'Abertura' }, { kind: 'stat', value: '4.8', source: 'IBGE' }]);
    expect(project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0)).toBe(120);
  });

  it('produces a genuinely different template choice without changing scene content', () => {
    const script = { duracao: 2, cenas: [{ at: 0, blocos: [{ tipo: 'lead', texto: 'Olá' }] }] };
    const base = motionProjectFromScript(script, { templateId: 'velix-base' });
    const editorial = motionProjectFromScript(script, { templateId: 'velix-editorial' });
    expect(editorial.templateId).toBe('velix-editorial');
    expect(editorial.scenes).toEqual(base.scenes);
    expect(motionProjectFromScript(script, { templateId: 'one-take' }).templateId).toBe('one-take');
    expect(JSON.parse(JSON.stringify(motionProjectFromScript(script, { templateId: 'one-take', preset: 'one-take' }))).style.preset).toBe('one-take');
  });

  it('supports the two local drawn presets without a canvas or external provider', () => {
    const script = { duracao: 2, cenas: [{ at: 0, blocos: [{ tipo: 'lead', texto: 'Olá' }] }] };
    expect(JSON.parse(JSON.stringify(motionProjectFromScript(script, { preset: 'drawn-book' }))).style.preset).toBe('drawn-book');
    expect(JSON.parse(JSON.stringify(motionProjectFromScript(script, { preset: 'drawn-watercolor' }))).style.preset).toBe('drawn-watercolor');
  });
});
