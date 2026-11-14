import { describe, expect, it } from 'vitest';
import { planAetheraProductionCommand } from '../src/index.js';

describe('Aethera AP-11 production planner', () => {
  it('turns a sufficiently specific command into a resumable chain with approval boundaries', () => {
    const plan = planAetheraProductionCommand({ command: 'Crie um vídeo de 5 minutos sobre os 5 jogos mais aguardados, em tom documental.' });
    expect(plan.status).toBe('ready');
    expect(plan.questions.length).toBeLessThanOrEqual(3);
    expect(plan.steps.map((step) => step.kind)).toEqual(['research', 'script', 'storyboard', 'narration', 'sync', 'composition', 'quality', 'preview']);
    expect(plan.approvals).toEqual(expect.arrayContaining(['sources', 'editorial-preview']));
    expect(plan.voice.scope).toBe('noncommercial');
  });

  it('asks for the missing topic instead of inventing one', () => {
    const plan = planAetheraProductionCommand({ command: 'Crie um vídeo documental.' });
    expect(plan.status).toBe('needs_questions');
    expect(plan.questions[0]?.id).toBe('topic');
    expect(plan.steps).toEqual([]);
  });
});
