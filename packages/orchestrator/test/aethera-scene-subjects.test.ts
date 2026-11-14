import { describe, expect, it } from 'vitest';
import type { StoryboardScene } from '@neuralbridge/shared';
import { inferSceneSubjects } from '../src/aethera/scene-subjects.js';

// Synthetic scenes; the titles are real games but nothing here is a real source.
const subjects = [
  { id: 'cp', title: 'Cyberpunk 2077', aliases: [] },
  { id: 'er', title: 'Elden Ring', aliases: [] },
  { id: 'nr', title: 'Elden Ring Nightreign', aliases: [] },
  { id: 'hk', title: 'Hollow Knight: Silksong', aliases: ['Silksong'] },
];
const scene = (id: string, chapter: number | null, narration: string, subjectId?: string): StoryboardScene => ({ id, chapter, narration, startMs: 0, endMs: 1, claimIds: [], visualObjective: '', ...(subjectId ? { subjectId } : {}), sceneType: 'broll', searchTerms: [], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' });

describe('inferSceneSubjects (AP-02)', () => {
  it('takes the game a scene names and spreads a chapter’s single game to its other scenes', () => {
    const result = inferSceneSubjects([
      scene('a', 1, 'Em Cyberpunk 2077, Night City muda a cada escolha.'),
      scene('b', 1, 'As gangues reagem ao que você faz.'),
      scene('c', 2, 'Hollow Knight Silksong leva a Hornet a um reino novo.'),
      scene('d', 2, 'O combate exige precisão.'),
    ], subjects);
    expect(result.scenes.map((item) => item.subjectId)).toEqual(['cp', 'cp', 'hk', 'hk']);
    expect(result.decisions.find((item) => item.sceneId === 'b')).toMatchObject({ subjectId: 'cp', reason: expect.stringContaining('capítulo') });
  });

  it('prefers the longer title over its prefix (franchise entries are different games)', () => {
    expect(inferSceneSubjects([scene('a', null, 'Elden Ring Nightreign é cooperativo.')], subjects).scenes[0]?.subjectId).toBe('nr');
  });

  it('leaves a scene that names two games, or none in an unnamed chapter, without a game for a person to decide', () => {
    const result = inferSceneSubjects([
      scene('a', 1, 'Cyberpunk 2077 e Elden Ring dividem o topo.'),
      scene('b', null, 'Uma abertura sem nome de jogo.'),
    ], subjects);
    expect(result.scenes.map((item) => item.subjectId)).toEqual([undefined, undefined]);
    expect(result.decisions.map((item) => item.reason)).toEqual([expect.stringContaining('mais de um jogo'), expect.stringContaining('nenhum jogo')]);
  });

  it('never overrides a game a person already chose', () => {
    expect(inferSceneSubjects([scene('a', 1, 'Em Cyberpunk 2077…', 'er')], subjects).scenes[0]?.subjectId).toBe('er');
  });

  it('recognizes a title the narration spells out for the voice ("Cyberpunk dois mil e setenta e sete")', () => {
    expect(inferSceneSubjects([scene('a', null, 'Em Cyberpunk dois mil e setenta e sete, preste atenção na cidade.')], subjects).scenes[0]?.subjectId).toBe('cp');
  });
});
