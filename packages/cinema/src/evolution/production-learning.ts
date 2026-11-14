import type { AetheraEvolutionCore } from './evolution-core.js';

export interface ProductionCorrectionLessonInput {
  projectId: string;
  sceneId: string;
  genre?: string;
  issueKind: 'hud_overlap' | 'visual_repetition' | 'pacing' | 'audio_ducking' | 'typography';
  userCorrection: string;
  cause: string;
  ruleInstruction: string;
}

export interface LearnedSceneConstraints {
  avoidHudOverlap: boolean;
  preferDiscreteTypography: boolean;
  avoidActCards: boolean;
  appliedRuleIds: string[];
}

/**
 * Records a production correction in AetheraEvolutionCore so Academy knowledge
 * is actively enforced by directors in future scenes and projects.
 */
export function recordProductionCorrectionLesson(
  evolution: AetheraEvolutionCore,
  input: ProductionCorrectionLessonInput,
) {
  const feedback = evolution.ingestHumanFeedback(
    `${input.userCorrection} | Regra: ${input.ruleInstruction}`,
    {
      projectId: input.projectId,
      ...(input.genre ? { genre: input.genre } : {}),
    },
  );

  const ruleMemory = evolution.recordMemory({
    techniqueKey: `lesson_${input.issueKind}_${input.sceneId}`,
    directorId: input.issueKind === 'audio_ducking' ? 'sound_director' : 'vfx_director',
    kind: 'procedural',
    epistemicLevel: 'validated_rule',
    state: 'validated',
    title: `Lição de Produção (${input.issueKind}): ${input.userCorrection.slice(0, 60)}`,
    content: `${input.cause} -> ${input.ruleInstruction}`,
    tags: [input.issueKind, 'academy_lesson', ...(input.genre ? [input.genre] : [])],
    scope: {
      ...(input.genre ? { genre: input.genre } : {}),
    },
    confidence: 0.92,
    evidence: {
      sourceType: 'production',
      sourceId: `${input.projectId}:${input.sceneId}`,
      summary: input.ruleInstruction,
      recordedAt: new Date().toISOString(),
    },
  });

  const decision = evolution.recordDecision({
    projectId: input.projectId,
    directorId: input.issueKind === 'audio_ducking' ? 'sound_director' : 'vfx_director',
    action: `academy_lesson_${input.issueKind}`,
    rationale: `Causa: ${input.cause} -> Correção aplicada na cena ${input.sceneId}: ${input.ruleInstruction}`,
    consultedMemoryIds: [feedback.memory.memoryId, ruleMemory.memoryId],
    consultedAcademyIds: [input.issueKind],
    outcome: 'applied',
  });

  return {
    memoryIds: [feedback.memory.memoryId, ruleMemory.memoryId],
    decisionId: decision.decisionId,
  };
}

/**
 * Queries learned memories and translates them into concrete director constraints
 * tested before scene planning and rendering.
 */
export function resolveLearnedSceneConstraints(
  evolution: AetheraEvolutionCore,
  context: { prompt: string; genre?: string; hasGameplayHud?: boolean },
): LearnedSceneConstraints {
  const directives = evolution.resolveProductionDirectives({
    prompt: context.prompt,
    ...(context.genre ? { genre: context.genre } : {}),
  });

  const memories = evolution.retrieveRelevantMemories({
    text: `${context.prompt} hud overlay titulo legenda`,
    ...(context.genre ? { genre: context.genre } : {}),
    limit: 12,
  });

  const hudRuleMemories = memories.filter((m) =>
    /hud|cobrir|sobrepor|lower[- ]?third|overlay/i.test(`${m.title} ${m.content}`),
  );

  const appliedRuleIds = Array.from(
    new Set([
      ...directives.appliedMemoryIds,
      ...hudRuleMemories.map((m) => m.memoryId),
    ]),
  );

  return {
    avoidHudOverlap: Boolean(context.hasGameplayHud) && (hudRuleMemories.length > 0 || directives.discreteTypography),
    preferDiscreteTypography: directives.discreteTypography,
    avoidActCards: directives.suppressActCards,
    appliedRuleIds,
  };
}
