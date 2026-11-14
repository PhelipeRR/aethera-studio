import { describe, expect, it } from 'vitest';
import type { DirectorSegment } from '@neuralbridge/shared';
import { directorPrompt, directProduction } from '../src/aethera/smart-director.js';

const segments: DirectorSegment[] = [
  { id: 'a', sceneId: 's', text: 'Tudo começa com uma estrela.', words: 'Tudo começa com uma estrela.'.split(' ').map((w, index) => ({ w, startMs: index * 400, endMs: index * 400 + 350 })), startMs: 0, endMs: 2_400 },
  { id: 'b', sceneId: 's', text: 'Ela colapsa.', words: [{ w: 'Ela', startMs: 2_400, endMs: 2_700 }, { w: 'colapsa.', startMs: 2_800, endMs: 3_300 }], startMs: 2_400, endMs: 3_600 },
];
const reading = { story: 'A origem de um buraco negro.', purpose: 'explicar', audience: 'geral', tone: 'didático', arc: [{ role: 'opening', segmentIds: ['a', 'b'], intent: 'apresentar o processo' }], keyInformation: ['colapso'] };
const concept = { summary: 'Didático e calmo', visualLanguage: 'cartões simples', pacing: 'segue a fala', continuity: 'um conceito por vez', typography: 'títulos curtos', audio: 'narração', avoid: ['efeitos de impacto'], rationale: 'O roteiro explica um processo em passos; cada passo precisa de tempo para ser entendido.' };
const decision = (segmentId: string, composition: object) => ({ segmentId, communicates: 'o passo', viewerEffect: 'entender', emotion: 'curiosidade', intensity: 0.4, importance: 'normal', composition, transitionIn: { kind: 'cut', motivation: 'novo passo' }, representation: 'illustrative', justification: 'O passo é uma ideia isolada que precisa ser fixada antes do próximo.', confidence: 0.7, alerts: [] });

describe('Smart Director: the AI director (SD-1)', () => {
  it('gives the model the whole script with numbered words, the catalogue as knowledge and the declared material', () => {
    const { system, prompt } = directorPrompt({ productionId: 'p', context: 'YouTube 16:9', segments, subjects: [], material: [] });
    expect(prompt).toContain('[a] (2.4 s) 0:Tudo 1:começa 2:com 3:uma 4:estrela.');
    expect(prompt).toContain('multi_panel');
    // The director decides the ideal direction; what the renderer can do today is not shown to it (it biased v1 plans).
    expect(prompt).toContain('- diagram: ');
    expect(prompt).not.toContain('não executável');
    expect(system).toContain('como se todas as técnicas do catálogo estivessem disponíveis');
    expect(prompt).toContain('nenhum assunto com material próprio');
    // Direction by intent, never by topic; a plain cut is a valid decision.
    expect(system).toContain('nunca do tema');
    expect(system).toContain('continue_previous');
  });

  it('asks again with the problems when the first answer breaks the contract or a hard rule, then accepts a valid plan', async () => {
    const prompts: string[] = [];
    const answers = [
      { reading, concept, segments: [decision('a', { kind: 'continue_previous' }), decision('b', { kind: 'typographic_card', lines: ['Colapso'], revealAtWords: [5] })] },
      { reading, concept, segments: [decision('a', { kind: 'typographic_card', lines: ['Uma estrela'], revealAtWords: null }), decision('b', { kind: 'continue_previous' })] },
    ];
    const result = await directProduction({ productionId: 'p', context: 'x', segments, subjects: [], material: [] }, async ({ prompt }) => { prompts.push(prompt); return answers[prompts.length - 1]; });
    expect(result.attempts).toBe(2);
    expect(prompts[1]).toContain('O primeiro trecho não tem imagem anterior para continuar');
    expect(prompts[1]).toContain('Âncora na palavra 5');
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('never invents a plan: an unavailable model is an error for the caller', async () => {
    await expect(directProduction({ productionId: 'p', context: 'x', segments, subjects: [], material: [] }, async () => { throw new Error('Claude Code falhou: limite de uso'); })).rejects.toThrow(/limite de uso/u);
  });
});
