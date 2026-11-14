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

export const MIN_NEGATIVE_EXAMPLE_CONFIDENCE = 0.70;

export type NegativeExampleOrigin = 'automatic' | 'human_review' | 'confirmed_correction';

export interface SceneGroundingNegativeExampleInput {
  projectId: string;
  segmentId: string;
  mediaTitle: string;
  mediaSha256?: string;
  workScope?: string;
  eventScope?: string;
  expectedContext: string;
  observedVisualSummary: string;
  mismatchReason: string;
  visualConfidence?: number;
  origin?: NegativeExampleOrigin;
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
): { recorded: boolean; promotedToBlocking?: boolean; origin?: NegativeExampleOrigin; memoryId?: string; decisionId?: string; skippedReason?: string } {
  const origin: NegativeExampleOrigin = input.origin ?? 'automatic';
  const confidence = input.visualConfidence ?? (origin === 'automatic' ? 0.8 : 0.95);
  if (origin === 'automatic' && confidence < MIN_NEGATIVE_EXAMPLE_CONFIDENCE) {
    return {
      recorded: false,
      skippedReason: `Confiança visual (${confidence.toFixed(2)}) abaixo do mínimo (${MIN_NEGATIVE_EXAMPLE_CONFIDENCE}) para registrar hipótese negativa.`,
    };
  }

  const normTitle = normalizeNegativeKeyText(input.mediaTitle);
  const normExpected = normalizeNegativeKeyText(input.expectedContext);
  const normWork = normalizeNegativeKeyText(input.workScope ?? '');
  const normEvent = normalizeNegativeKeyText(input.eventScope ?? input.expectedContext);
  const keyHash = createHash('sha256')
    .update(`${input.mediaSha256 ?? normTitle}|${normWork}|${normEvent}`)
    .digest('hex')
    .slice(0, 16);
  const techniqueKey = `sg_neg_${keyHash}`;

  const existing = evolution.getSnapshot().memories.find((m) => m.techniqueKey === techniqueKey);
  const nextEvidenceCount = (existing?.evidence.length ?? 0) + 1;
  // Supervised learning guard: a single automatic classification only creates a 'proposed' hypothesis;
  // blocking requires human_review, confirmed_correction, or >= 2 independent automatic evidences.
  const shouldPromoteToValidated =
    origin === 'human_review' || origin === 'confirmed_correction' || nextEvidenceCount >= 2;

  const memory = evolution.recordMemory({
    techniqueKey,
    directorId: 'narrative_director',
    kind: 'procedural',
    epistemicLevel: shouldPromoteToValidated ? 'validated_rule' : 'hypothesis',
    state: shouldPromoteToValidated ? 'validated' : 'proposed',
    title: `Exemplo Negativo Scene Grounding: "${input.mediaTitle.slice(0, 50)}" ≠ "${input.expectedContext.slice(0, 40)}"`,
    content: [
      `MIDIA=${normTitle}`,
      `OBRA=${normWork || 'geral'}`,
      `EVENTO=${normEvent}`,
      `ORIGEM=${origin}`,
      `ESPERADO=${normExpected}`,
      `OBSERVADO=${input.observedVisualSummary.slice(0, 220)}`,
      `MOTIVO=${input.mismatchReason}`,
    ].join(' | '),
    tags: [
      'scene_grounding_negative',
      'negative_example',
      `origin:${origin}`,
      ...(normWork ? [`work:${normWork}`] : []),
      ...(input.mediaSha256 ? [`sha256:${input.mediaSha256}`] : []),
      ...(input.genre ? [input.genre] : []),
    ],
    scope: {
      ...(input.genre ? { genre: input.genre } : {}),
    },
    confidence: Math.min(0.96, Math.max(MIN_NEGATIVE_EXAMPLE_CONFIDENCE, confidence)),
    evidence: {
      sourceType: origin === 'automatic' ? 'production' : 'human_feedback',
      sourceId: `${input.projectId}:${input.segmentId}`,
      summary: `[${origin}] ${input.mediaTitle} rejeitado para ${input.expectedContext}: ${input.mismatchReason}`,
      recordedAt: new Date().toISOString(),
    },
    reasonForUpdate: shouldPromoteToValidated
      ? `Promovido para regra bloqueante (${origin}, evidências=${nextEvidenceCount})`
      : 'Hipótese inicial automática (não bloqueante)',
  });

  const decision = evolution.recordDecision({
    projectId: input.projectId,
    directorId: 'narrative_director',
    action: 'record_scene_grounding_negative_example',
    rationale: `Registrado exemplo negativo [${origin}] (${input.segmentId}, obra=${normWork || 'geral'}, conf=${confidence.toFixed(2)}, estado=${memory.state}): "${input.mediaTitle}" ≠ "${input.expectedContext}".`,
    consultedMemoryIds: [memory.memoryId],
    consultedAcademyIds: ['scene_grounding'],
    outcome: shouldPromoteToValidated ? 'blocked' : 'applied',
  });

  return {
    recorded: true,
    promotedToBlocking: shouldPromoteToValidated,
    origin,
    memoryId: memory.memoryId,
    decisionId: decision.decisionId,
  };
}

/**
 * Reverts/disables a previously recorded Scene Grounding negative example so it no longer blocks media.
 */
export function undoSceneGroundingNegativeExample(
  evolution: AetheraEvolutionCore,
  input: { memoryId: string; projectId?: string; reason?: string },
): { undone: boolean; memoryId: string; state: string } {
  const reason = input.reason ?? 'Reversão manual/auditoria de exemplo negativo de Scene Grounding.';
  const updated = evolution.disableMemory(input.memoryId, reason);
  evolution.recordDecision({
    projectId: input.projectId ?? 'academy_audit',
    directorId: 'narrative_director',
    action: 'undo_scene_grounding_negative_example',
    rationale: `Exemplo negativo ${input.memoryId} revertido: ${reason}`,
    consultedMemoryIds: [input.memoryId],
    consultedAcademyIds: ['scene_grounding'],
    outcome: 'overridden',
  });
  return {
    undone: true,
    memoryId: updated.memoryId,
    state: updated.state,
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
    workScope?: string;
    eventScope?: string;
    expectedContext: string;
    genre?: string;
  },
): { matched: true; memoryId: string; reason: string } | { matched: false } {
  const snapshot = evolution.getSnapshot();
  const negMemories = snapshot.memories.filter(
    (m) =>
      m.state === 'validated' &&
      m.epistemicLevel === 'validated_rule' &&
      m.confidence >= MIN_NEGATIVE_EXAMPLE_CONFIDENCE &&
      m.tags.includes('scene_grounding_negative'),
  );
  if (negMemories.length === 0) return { matched: false };

  const normTitle = normalizeNegativeKeyText(input.mediaTitle ?? '');
  const titleTokens = new Set(negativeTokens(input.mediaTitle ?? ''));
  const normWork = normalizeNegativeKeyText(input.workScope ?? '');
  const expectedTokens = new Set(negativeTokens(input.eventScope ?? input.expectedContext));

  for (const mem of negMemories) {
    const shaMatched = Boolean(input.mediaSha256 && mem.tags.includes(`sha256:${input.mediaSha256}`));
    const memMediaMatch = mem.content.match(/MIDIA=([^|]+)/);
    const memWorkMatch = mem.content.match(/OBRA=([^|]+)/);
    const memEventMatch = mem.content.match(/EVENTO=([^|]+)/);
    const memExpectedMatch = mem.content.match(/ESPERADO=([^|]+)/);
    const memMotivoMatch = mem.content.match(/MOTIVO=(.+)$/);
    const memMedia = (memMediaMatch?.[1] ?? '').trim();
    const memWork = (memWorkMatch?.[1] ?? '').trim();
    const memEvent = (memEventMatch?.[1] ?? memExpectedMatch?.[1] ?? '').trim();

    if (memWork && memWork !== 'geral' && normWork) {
      const workTokens = new Set(negativeTokens(normWork));
      const memWorkTokens = negativeTokens(memWork);
      const workOverlap = memWorkTokens.filter((t) => workTokens.has(t)).length;
      if (!normWork.includes(memWork) && !memWork.includes(normWork) && (memWorkTokens.length === 0 || workOverlap / memWorkTokens.length < 0.65)) {
        continue;
      }
    }

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

    const memEventTokens = negativeTokens(memEvent);
    const expectedOverlap = memEventTokens.filter((t) => expectedTokens.has(t)).length;
    if (
      normalizeNegativeKeyText(input.eventScope ?? input.expectedContext) === memEvent ||
      (memEventTokens.length > 0 && expectedOverlap / memEventTokens.length >= 0.65)
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
