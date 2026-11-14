import { editPlanSchema, type Storyboard } from '@neuralbridge/shared';

/** Structured output contract sent to the read-only agent. It has no edit, shell or file tool. */
export const SEMANTIC_EDIT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    command: { type: 'string', minLength: 1, maxLength: 500 },
    status: { type: 'string', enum: ['ready', 'needs_confirmation'] },
    confirmation: { type: 'object', additionalProperties: false, properties: { required: { type: 'boolean' }, question: { type: ['string', 'null'], maxLength: 500 } }, required: ['required', 'question'] },
    planner: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', const: 'read-only' }, provider: { type: 'string', enum: ['claude', 'codex'] }, model: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['mode', 'provider', 'model'] },
    operations: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: ['replace_subject_visual', 'update_scene', 'move_scene'] }, subjectId: { type: 'string', minLength: 1 }, requestedKind: { type: 'string', enum: ['combat', 'exploration', 'cinematic', 'presentation', 'menu_ui'] }, sceneId: { type: 'string', minLength: 1 }, toIndex: { type: 'integer', minimum: 0 }, patch: { type: 'object' } }, required: ['op'] } },
  },
  required: ['schemaVersion', 'command', 'status', 'confirmation', 'planner', 'operations'],
} as const;

export function semanticEditPrompt(input: { command: string; storyboard: Storyboard }): string {
  const scenes = input.storyboard.scenes.map((scene) => ({ id: scene.id, subjectId: scene.subjectId ?? null, narration: scene.narration, startMs: scene.startMs, endMs: scene.endMs, sceneType: scene.sceneType, searchTerms: scene.searchTerms, visualObjective: scene.visualObjective, locked: scene.locked }));
  const command = input.command.replace(/[<>]/gu, '').trim().slice(0, 500);
  const storyboard = JSON.stringify(scenes).replace(/[<>]/gu, '');
  return [
    'Você é um planejador editorial somente leitura do Aethera.',
    'Não edite arquivos, não chame ferramentas, não pesquise, não gere narração e não faça sync.',
    'Converta o comando em um único JSON que siga exatamente o schema recebido.',
    'Use replace_subject_visual para trocar o tipo visual de todas as cenas de um jogo identificado por subjectId.',
    'Se o jogo, a operação ou o tipo visual estiver ambíguo, retorne status needs_confirmation, operations vazias e uma pergunta curta.',
    'Nunca invente subjectId; use apenas os IDs listados no storyboard.',
    `<command>${command}</command>`,
    `<storyboard>${storyboard}</storyboard>`,
  ].join('\n');
}

export interface SemanticEditReadOnlyAgent {
  runStructuredReadOnly(input: { projectId: string; agent: 'claude' | 'codex'; prompt: string; outputSchema: object; origin: 'neura'; signal: AbortSignal }): Promise<{ structured: unknown }>;
}

/** Adapts the TaskEngine structured read-only boundary to StoryboardService. */
export function createSemanticEditPlanner(agent: SemanticEditReadOnlyAgent) {
  return async (input: { projectId: string; command: string; storyboard: Storyboard; signal: AbortSignal }): Promise<unknown> => {
    const result = await agent.runStructuredReadOnly({ projectId: input.projectId, agent: 'claude', prompt: semanticEditPrompt({ command: input.command, storyboard: input.storyboard }), outputSchema: SEMANTIC_EDIT_JSON_SCHEMA, origin: 'neura', signal: input.signal });
    return editPlanSchema.parse(result.structured);
  };
}
