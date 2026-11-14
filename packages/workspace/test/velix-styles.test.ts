import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_CHOICE } from '@neuralbridge/shared';
import { VELIX_DOSSIE_EXAMPLE, VELIX_DOSSIE_ID } from '../src/velix-dossie.js';
import { resolveStyleRender } from '../src/velix-styles.js';

describe('style render resolution', () => {
  it('keeps existing productions on the Dossiê with the data passed through untouched', () => {
    const data = JSON.stringify(VELIX_DOSSIE_EXAMPLE);
    // Same template id and the very same data string as before the registry: the renderer gets identical input.
    expect(resolveStyleRender(null, data)).toEqual({ styleId: 'dossie', template: VELIX_DOSSIE_ID, data });
    expect(resolveStyleRender(DEFAULT_STYLE_CHOICE, data).data).toBe(data);
  });

  it('refuses a choice the registry cannot render', () => {
    expect(() => resolveStyleRender({ ...DEFAULT_STYLE_CHOICE, styleId: 'nao-existe' }, '{}')).toThrow(/desconhecido/);
  });

  it('routes the Dossiê newspaper collage treatment through the Remotion compositor', () => {
    const data = JSON.stringify(VELIX_DOSSIE_EXAMPLE);
    const render = resolveStyleRender({ ...DEFAULT_STYLE_CHOICE, treatmentId: 'colagem-jornal' }, data);

    expect(render.engine).toBe('remotion');
    expect(render.template).toBe('velix-base');
    expect(JSON.parse(render.data).style.preset).toBe('colagem-jornal');
    expect(render.data).not.toBe(data);
  });
});
