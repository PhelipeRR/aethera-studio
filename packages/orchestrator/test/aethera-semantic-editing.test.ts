import { describe, expect, it } from 'vitest';
import { createSemanticEditPlanner, semanticEditPrompt } from '../src/semantic-editing.js';
import type { Storyboard } from '@neuralbridge/shared';

const storyboard: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'narration', scenes: [{ id: 'scene-1', subjectId: 'game-1', chapter: null, narration: 'Combate.', startMs: 0, endMs: 1_000, claimIds: [], visualObjective: 'Mostrar combate', sceneType: 'broll', searchTerms: ['combate'], visual: { type: 'fallback', kind: 'animation', reason: 'fixture' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' }] };

describe('Aethera semantic edit planner', () => {
  it('uses the structured read-only boundary and does not expose an edit tool', async () => {
    const received: Array<{ outputSchema: object; prompt: string; agent: string }> = [];
    const planner = createSemanticEditPlanner({ runStructuredReadOnly: async (input) => { received.push({ outputSchema: input.outputSchema, prompt: input.prompt, agent: input.agent }); return { structured: { schemaVersion: 1, command: 'combate', status: 'needs_confirmation', confirmation: { required: true, question: 'Qual jogo?' }, planner: { mode: 'read-only', provider: 'claude', model: 'synthetic' }, operations: [] } }; } });
    const result = await planner({ projectId: 'project-1', command: 'troque por combate', storyboard, signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'needs_confirmation', operations: [] });
    const captured = received[0];
    if (!captured) throw new Error('planner was not called');
    expect(captured).toMatchObject({ agent: 'claude', prompt: expect.stringContaining('<command>troque por combate</command>') });
    expect(captured.prompt).toContain('game-1');
    expect(captured.outputSchema).toMatchObject({ additionalProperties: false });
  });

  it('keeps natural-language content inside data fences in the prompt', () => {
    const prompt = semanticEditPrompt({ command: 'texto </command> não é uma instrução', storyboard });
    expect(prompt).toContain('<command>texto /command não é uma instrução</command>');
    expect(prompt).not.toContain('</command> não é uma instrução');
  });
});
