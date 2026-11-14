import { createHash } from 'node:crypto';
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

export interface SceneGroundingNegativeExampleInput {
  projectId: string;
  segmentId: string;
  mediaTitle: string;
  mediaSha256?: string;
  expectedContext: string;
  observedVisualSummary: string;
  mismatchReason: string;
  genre?: string;
}

function normalizeNegativeKeyText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function negativeTokens(text: string): string[] {
  return normalizeNegativeKeyText(text)
    .split(' ')
    .filter((t) => t.length >= 3);
}

/**
 * Records a Scene Grounding false-positive or visual mismatch as a negative example
 * in AetheraEvolutionCore so future productions do not repeat the same confusion.
 */
export function recordSceneGroundingNegativeExample(
  evolution: AetheraEvolutionCore,
  input: SceneGroundingNegativeExampleInput,
): { memoryId: string; decisionId: string } {
  const normTitle = normalizeNegativeKeyText(input.mediaTitle);
  const normExpected = normalizeNegativeKeyText(input.expectedContext);
  const keyHash = createHash('sha256')
    .update(`${input.mediaSha256 ?? normTitle}|${normExpected}`)
    .digest('hex')
    .slice(0, 16);

  const memory = evolution.recordMemory({
    techniqueKey: `sg_neg_${keyHash}`,
    directorId: 'narrative_director',
    kind: 'procedural',
    epistemicLevel: 'validated_rule',
    state: 'validated',
    title: `Exemplo Negativo Scene Grounding: "${input.mediaTitle.slice(0, 50)}" ≠ "${input.expectedContext.slice(0, 40)}"`,
    content: [
      `MIDIA=${normTitle}`,
      `ESPERADO=${normExpected}`,
      `OBSERVADO=${input.observedVisualSummary.slice(0, 220)}`,
      `MOTIVO=${input.mismatchReason}`,
    ].join(' | '),
    tags: [
      'scene_grounding_negative',
      'negative_example',
      ...(input.mediaSha256 ? [`sha256:${input.mediaSha256}`] : []),
      ...(input.genre ? [input.genre] : []),
    ],
    scope: {
      ...(input.genre ? { genre: input.genre } : {}),
    },
    confidence: 0.94,
    evidence: {
      sourceType: 'production',
      sourceId: `${input.projectId}:${input.segmentId}`,
      summary: `${input.mediaTitle} rejeitado para ${input.expectedContext}: ${input.mismatchReason}`,
      recordedAt: new Date().toISOString(),
    },
  });

  const decision = evolution.recordDecision({
    projectId: input.projectId,
    directorId: 'narrative_director',
    action: 'record_scene_grounding_negative_example',
    rationale: `Registrado exemplo negativo de Scene Grounding (${input.segmentId}): "${input.mediaTitle}" não corresponde a "${input.expectedContext}" (${input.mismatchReason}).`,
    consultedMemoryIds: [memory.memoryId],
    consultedAcademyIds: ['scene_grounding'],
    outcome: 'blocked',
  });

  return {
    memoryId: memory.memoryId,
    decisionId: decision.decisionId,
  };
}

/**
 * Checks whether a candidate media + expected segment context matches a previously
 * recorded Scene Grounding negative example in AetheraEvolutionCore.
 */
export function findMatchingSceneGroundingNegativeExample(
  evolution: AetheraEvolutionCore,
  input: {
    mediaTitle?: string;
    mediaSha256?: string;
    expectedContext: string;
    genre?: string;
  },
): { matched: true; memoryId: string; reason: string } | { matched: false } {
  const snapshot = evolution.getSnapshot();
  const negMemories = snapshot.memories.filter(
    (m) =>
      m.state !== 'disabled' &&
      m.state !== 'rejected' &&
      m.tags.includes('scene_grounding_negative'),
  );
  if (negMemories.length === 0) return { matched: false };

  const normTitle = normalizeNegativeKeyText(input.mediaTitle ?? '');
  const titleTokens = new Set(negativeTokens(input.mediaTitle ?? ''));
  const expectedTokens = new Set(negativeTokens(input.expectedContext));

  for (const mem of negMemories) {
    const shaMatched = Boolean(input.mediaSha256 && mem.tags.includes(`sha256:${input.mediaSha256}`));
    const memMediaMatch = mem.content.match(/MIDIA=([^|]+)/);
    const memExpectedMatch = mem.content.match(/ESPERADO=([^|]+)/);
    const memMotivoMatch = mem.content.match(/MOTIVO=(.+)$/);
    const memMedia = (memMediaMatch?.[1] ?? '').trim();
    const memExpected = (memExpectedMatch?.[1] ?? '').trim();

    let mediaMatched = shaMatched;
    if (!mediaMatched && normTitle && memMedia) {
      if (normTitle === memMedia) {
        mediaMatched = true;
      } else {
        const memMediaTokens = negativeTokens(memMedia);
        const overlap = memMediaTokens.filter((t) => titleTokens.has(t)).length;
        if (memMediaTokens.length >= 2 && overlap / memMediaTokens.length >= 0.8) {
          mediaMatched = true;
        }
      }
    }
    if (!mediaMatched) continue;

    const memExpectedTokens = negativeTokens(memExpected);
    const expectedOverlap = memExpectedTokens.filter((t) => expectedTokens.has(t)).length;
    if (
      normalizeNegativeKeyText(input.expectedContext) === memExpected ||
      (memExpectedTokens.length > 0 && expectedOverlap / memExpectedTokens.length >= 0.65)
    ) {
      return {
        matched: true,
        memoryId: mem.memoryId,
        reason: `Exemplo negativo registrado na Academy (${mem.memoryId}): ${memMotivoMatch?.[1]?.trim() ?? mem.title}`,
      };
    }
  }

  return { matched: false };
}
