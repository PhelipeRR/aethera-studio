import { describe, expect, it } from 'vitest';
import { type StoryboardScene, dependentOpening, derivativeScenes, shortCandidates } from '../src/index.js';

let clock = 0;
const scene = (id: string, narration: string, seconds: number, extra: Partial<StoryboardScene> = {}): StoryboardScene => {
  const startMs = clock;
  clock += seconds * 1_000;
  return { id, chapter: 1, narration, startMs, endMs: clock, claimIds: [], visualObjective: '', sceneType: 'broll', searchTerms: [], visual: { type: 'fallback', kind: 'typography', reason: '' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending', audio: { relativePath: `c/${id}.wav`, durationMs: seconds * 1_000, key: id, words: [] }, ...extra };
};

describe('Short candidates', () => {
  it('opens only where the Short stands on its own and never carries an unsupported fact', () => {
    clock = 0;
    const scenes = [
      scene('a', 'Por que a conta de luz caiu em 2025?', 10),
      scene('b', 'Os painéis solares chegaram a 30 gigawatts no país.', 12, { claimIds: ['fato-ok'] }),
      scene('c', 'Por isso a conta caiu para muitas famílias.', 10),
      scene('d', 'Mas a rede ainda não acompanha esse ritmo.', 12),
      scene('e', 'Ninguém sabe quanto custa a bateria de cada casa.', 12, { claimIds: ['fato-sem-fonte'] }),
      scene('f', 'O preço das baterias também caiu bastante', 12),
    ];
    const candidates = shortCandidates(scenes, [{ id: 'fato-ok', kind: 'fact', supported: true }, { id: 'fato-sem-fonte', kind: 'fact', supported: false }]);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]).toMatchObject({ sceneIds: ['a', 'b', 'c'], startMs: 0, endMs: 32_000, title: 'Por que a conta de luz caiu em 2025?', claimIds: ['fato-ok'] });
    expect(candidates[0]?.breakdown.hook).toBeGreaterThanOrEqual(0.5);
    // Nothing starts on "Mas", nothing carries the unsupported fact, nothing ends without punctuation, nothing overlaps.
    for (const candidate of candidates) {
      expect(candidate.sceneIds[0]).not.toBe('d');
      expect(candidate.sceneIds).not.toContain('e');
      expect(candidate.sceneIds.at(-1)).not.toBe('f');
      expect(candidate.endMs - candidate.startMs).toBeGreaterThanOrEqual(15_000);
      expect(candidate.endMs - candidate.startMs).toBeLessThanOrEqual(59_000);
    }
    candidates.slice(1).forEach((candidate, index) => expect(candidate.startMs).toBeGreaterThanOrEqual(candidates[index]?.endMs ?? 0));
    expect(dependentOpening({ narration: 'Isso mudou tudo.' })).toMatch(/Isso/);
    expect(dependentOpening({ narration: 'Como funciona um painel?' })).toBeNull();
  });

  it('builds the Short from zero with the title first and the channel name closing, keeping scene ids and clips', () => {
    clock = 0;
    const scenes = [scene('a', 'Uma pergunta.', 10), scene('b', 'Uma resposta.', 8), scene('c', 'Um fim.', 7)];
    const short = derivativeScenes(scenes, { sceneIds: ['b', 'c'], title: 'O título' }, 'Canal Solar');
    expect(short.map((item) => [item.id, item.startMs, item.endMs, item.onScreenText])).toEqual([['b', 0, 8_000, 'O título'], ['c', 8_000, 15_000, 'Canal Solar']]);
    expect(short[0]?.audio?.relativePath).toBe('c/b.wav');
    expect(() => derivativeScenes(scenes, { sceneIds: ['x'], title: 't' })).toThrow(/origem mudou/);
  });
});
