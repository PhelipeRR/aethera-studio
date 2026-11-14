import { describe, expect, it } from 'vitest';
import { buildProductionScenes } from '../src/velix-production-scenes.js';

describe('buildProductionScenes', () => {
  it('adds supported commentary attribution blocks without replacing the timeline', () => {
    const result = buildProductionScenes({ duracao: 4, cenas: [{ at: 0, blocos: [{ tipo: 'texto', texto: 'A' }] }] }, 'commentary', ['Fonte autorizada']);
    expect(result.cenas).toHaveLength(1);
    expect(result.cenas?.[0]?.blocos).toEqual(expect.arrayContaining([expect.objectContaining({ tipo: 'nota', titulo: 'Compilação comentada' })]));
    expect(result.cenas?.[0]?.fonte).toBe('Fonte autorizada');
  });

  it('marks news scenes with traceable references and does not add media blocks', () => {
    const result = buildProductionScenes({ cenas: [{ at: 2, blocos: [] }] }, 'news', ['https://news.example/item']);
    expect(result.cenas?.[0]?.blocos).toEqual([expect.objectContaining({ tipo: 'nota', titulo: 'Noticiário verificável', texto: 'https://news.example/item' })]);
    expect(result.cenas?.[0]?.blocos).not.toEqual(expect.arrayContaining([expect.objectContaining({ tipo: 'foto' })]));
  });
});
