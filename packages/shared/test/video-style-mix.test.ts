import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_CHOICE, commonScript, planStyleMix, type ProductionStyleChoice } from '../src/video-styles.js';

const script = commonScript({ duracao: 9, cenas: [{ at: 0, blocos: [{ tipo: 'lead', texto: 'A' }] }, { at: 3, blocos: [{ tipo: 'lead', texto: 'B' }] }, { at: 6, blocos: [{ tipo: 'lead', texto: 'C' }] }] });

describe('style mix plan', () => {
  it('groups adjacent scenes and emits a bridge transition when the treatment changes', () => {
    const choice: ProductionStyleChoice = { ...DEFAULT_STYLE_CHOICE, treatmentId: 'colagem-jornal', scenes: { 'cena-2': { treatmentId: null }, 'cena-3': { treatmentId: null } } };
    const plan = planStyleMix(script, choice);
    expect(plan.problems).toEqual([]);
    expect(plan.segments).toMatchObject([{ fromScene: 0, toScene: 0, treatmentId: 'colagem-jornal' }, { fromScene: 1, toScene: 2, treatmentId: null }]);
    expect(plan.transitions).toEqual([{ afterScene: 0, kind: 'cut' }]);
  });

  it('reports an incompatible treatment and more than three styles without rendering', () => {
    const choice: ProductionStyleChoice = { ...DEFAULT_STYLE_CHOICE, scenes: { 'cena-1': { styleId: 'motion-cenas-base' }, 'cena-2': { styleId: 'motion-cenas-editorial' }, 'cena-3': { styleId: 'one-take' } } };
    const plan = planStyleMix(script, { ...choice, treatmentId: 'colagem-jornal' });
    expect(plan.problems).toEqual(expect.arrayContaining([expect.stringContaining('não aceita'), expect.stringContaining('limite')]));
  });
});
