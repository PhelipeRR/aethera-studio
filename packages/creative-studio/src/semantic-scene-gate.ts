import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import type { CharacterGateEvidence, GateRect } from './character-gate.js';
import type { SemanticEvaluationRequest, SemanticEvaluationResult } from './image-generation-adapter.js';
import type { VisualRecipe } from './visual-recipe.js';

export type SemanticCriterionKind = 'character' | 'object' | 'wardrobe' | 'accessory' | 'pose' | 'action' | 'scene';
export type SemanticCriterionStatus = 'confirmed' | 'uncertain' | 'failed';

export interface SemanticEvaluationAdapter {
  evaluateImageSemantics(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult>;
}

export interface SemanticSceneGateOptions {
  /** Positive CLIP score and margin required before evidence is confirmed. */
  confirmScore?: number;
  confirmMargin?: number;
  /** A contradiction must clear both thresholds; weak/ambiguous scores stay in review. */
  failureScore?: number;
  failureMargin?: number;
}

export interface SemanticCriterion {
  id: string;
  scope: 'scene' | 'character';
  regionIndex: number | null;
  kind: SemanticCriterionKind;
  requirement: string;
  sourcePrompt: string;
  positiveConcepts: string[];
  negativeConcepts: string[];
  status: SemanticCriterionStatus;
  score: number | null;
  negativeScore: number | null;
  margin: number | null;
  evaluatorId: string | null;
  matchedLabel: string | null;
  rationale: string;
  reason: string;
  bbox: GateRect | null;
  evidenceBbox: GateRect | null;
  evidenceScope: 'localized' | 'generic' | 'unavailable';
}

export interface SemanticRepairCandidate {
  criterionId: string;
  bbox: GateRect;
  prompt: string;
  reason: string;
}

export interface SemanticSceneGateResult {
  verdict: 'passed_pending_human_review' | 'needs_review' | 'rejected';
  criteria: SemanticCriterion[];
  semanticScore: number | null;
  failureCategories: {
    semantic: string[];
    visualQuality: string[];
  };
  repairCandidates: SemanticRepairCandidate[];
  observations: Array<{
    code: 'translucent_character' | 'duplicate_character' | 'incomplete_character' | 'possible_fused_characters';
    status: 'confirmed' | 'uncertain';
    message: string;
    bbox?: GateRect;
  }>;
}

interface CriterionDraft extends Omit<SemanticCriterion, 'status' | 'score' | 'negativeScore' | 'margin' | 'evaluatorId' | 'matchedLabel' | 'rationale' | 'reason' | 'bbox' | 'evidenceBbox' | 'evidenceScope'> {
  bbox: GateRect | null;
  evidenceBbox: GateRect | null;
}

const DEFAULTS: Required<SemanticSceneGateOptions> = {
  confirmScore: 0.6,
  confirmMargin: 0.06,
  failureScore: 0.16,
  failureMargin: -0.08,
};

const TERM_GROUPS: Array<{ kind: Exclude<SemanticCriterionKind, 'character' | 'scene'>; terms: string[] }> = [
  {
    kind: 'object',
    terms: ['katana', 'sword', 'spear', 'rifle', 'sniper rifle', 'gun', 'shield', 'bow', 'staff', 'weapon', 'mecha', 'robot'],
  },
  {
    kind: 'wardrobe',
    terms: ['armor', 'armour', 'jacket', 'coat', 'scarf', 'cape', 'cloak', 'bodysuit', 'techwear', 'vest', 'raincoat', 'uniform', 'robe', 'dress'],
  },
  {
    kind: 'accessory',
    terms: ['visor', 'helmet', 'goggles', 'glasses', 'mask', 'cybernetic arms', 'twin buns', 'mohawk', 'beard'],
  },
  {
    kind: 'pose',
    terms: ['standing', 'sitting', 'crouching', 'kneeling', 'raised', 'held in guard', 'aiming', 'facing each other', 'team lineup'],
  },
  {
    kind: 'action',
    terms: ['fighting', 'fight', 'duel', 'battle', 'running', 'shooting', 'holding', 'guarding', 'transforming', 'standing together'],
  },
];

const ATTRIBUTE_NEGATIVES: Record<Exclude<SemanticCriterionKind, 'character' | 'scene'>, string[]> = {
  object: ['empty hands', 'no visible weapon', 'background only'],
  wardrobe: ['plain clothing', 'wrong outfit', 'no required garment'],
  accessory: ['plain head', 'no visible accessory', 'generic hairstyle'],
  pose: ['neutral pose', 'unposed character', 'wrong body position'],
  action: ['static character', 'no visible action', 'inactive scene'],
};

function uniqueMatches(text: string, terms: string[]): string[] {
  const lower = text.toLocaleLowerCase();
  return terms.filter((term) => lower.includes(term.toLocaleLowerCase()));
}

function regionRect(recipe: VisualRecipe, index: number): GateRect {
  const region = recipe.characterRegions[index];
  return region
    ? { x: region.x, y: region.y, width: region.width, height: region.height }
    : { x: 0, y: 0, width: recipe.width, height: recipe.height };
}

function boundedRect(rect: GateRect, x: number, y: number, width: number, height: number): GateRect {
  const left = Math.max(rect.x, Math.min(rect.x + rect.width, rect.x + x));
  const top = Math.max(rect.y, Math.min(rect.y + rect.height, rect.y + y));
  const right = Math.max(left + 1, Math.min(rect.x + rect.width, left + width));
  const bottom = Math.max(top + 1, Math.min(rect.y + rect.height, top + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function attributeEvidenceRect(recipe: VisualRecipe, index: number, kind: Exclude<SemanticCriterionKind, 'character' | 'scene'>): GateRect {
  const region = regionRect(recipe, index);
  switch (kind) {
    case 'accessory':
      return boundedRect(region, region.width * 0.08, region.height * 0.02, region.width * 0.84, region.height * 0.42);
    case 'wardrobe':
      return boundedRect(region, region.width * 0.06, region.height * 0.22, region.width * 0.88, region.height * 0.58);
    case 'object':
    case 'pose':
    case 'action':
      return boundedRect(region, region.width * 0.03, region.height * 0.08, region.width * 0.94, region.height * 0.86);
  }
}

/**
 * Builds only requirements that are actually present in the generated recipe's prompts. It deliberately does not
 * manufacture object/weapon expectations from a character count or a generic character role.
 */
export function buildSemanticCriteria(recipe: VisualRecipe): Array<Omit<SemanticCriterion, 'status' | 'score' | 'negativeScore' | 'margin' | 'evaluatorId' | 'matchedLabel' | 'rationale' | 'reason' | 'evidenceScope'>> {
  const criteria: CriterionDraft[] = [];
  const scenePrompt = recipe.scenePrompt?.trim() || recipe.positivePrompt;
  criteria.push({
    id: 'scene',
    scope: 'scene',
    regionIndex: null,
    kind: 'scene',
    requirement: scenePrompt,
    sourcePrompt: scenePrompt,
    positiveConcepts: [scenePrompt],
    negativeConcepts: [],
    bbox: null,
    evidenceBbox: null,
  });

  recipe.characterRegions.forEach((region, index) => {
    const sourcePrompt = region.prompt?.trim() || `character ${index + 1} in the planned region`;
    const bbox = regionRect(recipe, index);
    criteria.push({
      id: `character-${index + 1}`,
      scope: 'character',
      regionIndex: index,
      kind: 'character',
      requirement: sourcePrompt,
      sourcePrompt,
      positiveConcepts: [sourcePrompt],
      negativeConcepts: [],
      bbox,
      evidenceBbox: bbox,
    });

    for (const group of TERM_GROUPS) {
      for (const term of uniqueMatches(sourcePrompt, group.terms)) {
        const evidenceBbox = attributeEvidenceRect(recipe, index, group.kind);
        criteria.push({
          id: `character-${index + 1}-${group.kind}-${term.replace(/\s+/g, '-')}`,
          scope: 'character',
          regionIndex: index,
          kind: group.kind,
          requirement: term,
          sourcePrompt,
          positiveConcepts: [term],
          negativeConcepts: ATTRIBUTE_NEGATIVES[group.kind],
          bbox: evidenceBbox,
          evidenceBbox,
        });
      }
    }
  });
  return criteria;
}

async function cropBuffer(imageBuffer: Buffer, bbox: GateRect, width: number, height: number): Promise<Buffer> {
  const left = Math.max(0, Math.min(width - 1, Math.round(bbox.x)));
  const top = Math.max(0, Math.min(height - 1, Math.round(bbox.y)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(bbox.width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(bbox.height)));
  return sharp(imageBuffer).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
}

export async function cropSemanticEvidence(imageBuffer: Buffer, bbox: GateRect): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  return cropBuffer(imageBuffer, bbox, metadata.width ?? bbox.x + bbox.width, metadata.height ?? bbox.y + bbox.height);
}

function classify(
  evaluation: SemanticEvaluationResult,
  options: Required<SemanticSceneGateOptions>,
  criterion: CriterionDraft,
): { status: SemanticCriterionStatus; reason: string } {
  if (evaluation.isOffTopic && evaluation.positiveScore <= options.failureScore && evaluation.margin <= options.failureMargin) {
    return { status: 'failed', reason: 'Local evaluator returned a strong explicit contradiction to the prompt criterion.' };
  }
  if (!evaluation.isOffTopic && evaluation.positiveScore >= options.confirmScore && evaluation.margin >= options.confirmMargin) {
    const isAttribute = criterion.kind !== 'character' && criterion.kind !== 'scene';
    const label = evaluation.matchedLabel.toLocaleLowerCase();
    const localizedLabel = criterion.positiveConcepts.some((concept) => label.includes(concept.toLocaleLowerCase()));
    if (isAttribute && (evaluation.evidenceScope !== 'localized' || !localizedLabel)) {
      return { status: 'uncertain', reason: 'Localized attribute evidence was not confirmed by a matching evaluator label.' };
    }
    return { status: 'confirmed', reason: 'Local evaluator returned positive evidence above the confirmation thresholds.' };
  }
  return { status: 'uncertain', reason: 'Local evidence is ambiguous; absence of detection is not treated as absence.' };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observationFromEvidence(evidence: CharacterGateEvidence | undefined): SemanticSceneGateResult['observations'] {
  if (!evidence) return [];
  const observations: SemanticSceneGateResult['observations'] = [];
  const boxes = evidence.detectors.yolo_person?.boxes ?? [];
  for (const box of boxes) {
    if (box.x <= 0 || box.y <= 0 || box.x + box.width >= evidence.width || box.y + box.height >= evidence.height) {
      observations.push({
        code: 'incomplete_character',
        status: 'uncertain',
        message: 'A detected character touches the image boundary; clipping is possible and needs human review.',
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
  }
  if (evidence.detectors.openpose?.people && boxes.length > 0 && evidence.detectors.openpose.people.length > boxes.length) {
    observations.push({
      code: 'possible_fused_characters',
      status: 'uncertain',
      message: 'OpenPose found more skeletons than person boxes; possible visual fusion requires human review.',
    });
  }
  return observations;
}

async function imageObservations(imageBuffer: Buffer, evidence: CharacterGateEvidence | undefined): Promise<SemanticSceneGateResult['observations']> {
  if (!evidence) return [];
  const boxes = (evidence.detectors.yolo_person?.boxes ?? []).filter((box) => box.height >= evidence.height * 0.3 && box.confidence >= 0.3);
  if (boxes.length === 0) return [];
  let metadata: Metadata;
  try {
    metadata = await sharp(imageBuffer).metadata();
  } catch {
    return [];
  }
  const observations: SemanticSceneGateResult['observations'] = [];
  if (metadata.channels === 4) {
    const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const box of boxes) {
      const left = Math.max(0, Math.min(info.width - 1, Math.round(box.x)));
      const top = Math.max(0, Math.min(info.height - 1, Math.round(box.y)));
      const width = Math.max(1, Math.min(info.width - left, Math.round(box.width)));
      const height = Math.max(1, Math.min(info.height - top, Math.round(box.height)));
      let semi = 0;
      let opaque = 0;
      for (let y = top; y < top + height; y += 1) {
        for (let x = left; x < left + width; x += 1) {
          const alpha = data[(y * info.width + x) * 4 + 3] ?? 0;
          if (alpha > 20 && alpha < 225) semi += 1;
          if (alpha >= 225) opaque += 1;
        }
      }
      const total = width * height;
      if (semi / total >= 0.2 && opaque / total < 0.75) {
        observations.push({
          code: 'translucent_character',
          status: 'confirmed',
          message: `A character mask contains ${(semi / total * 100).toFixed(1)}% semi-transparent pixels with insufficient opaque support; possible ghost/translucent figure.`,
          bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      }
    }
  }

  if (boxes.length > 1) {
    const hashes = await Promise.all(boxes.map(async (box) => {
      try {
        const crop = await cropBuffer(imageBuffer, { x: box.x, y: box.y, width: box.width, height: box.height }, evidence.width, evidence.height);
        const normalized = await sharp(crop).resize(32, 64, { fit: 'fill' }).grayscale().raw().toBuffer();
        let min = 255;
        let max = 0;
        for (const value of normalized) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        // A flat/fixture crop has no subject evidence. Do not call it a duplicate: that would turn an evaluator or
        // test image with a uniform background into a false rejection.
        if (max - min < 12) return null;
        return createHash('sha256').update(normalized).digest('hex');
      } catch {
        return null;
      }
    }));
    if (new Set(hashes.filter((hash): hash is string => hash !== null)).size < hashes.filter((hash) => hash !== null).length) {
      observations.push({ code: 'duplicate_character', status: 'confirmed', message: 'Two main-character crops are pixel-identical after normalization; duplicate visual evidence is proven.' });
    }
  }
  return observations;
}

/** Evaluates prompt criteria with existing local multimodal evidence and never invents absent-object failures. */
export async function evaluateSemanticSceneGate(input: {
  imageBuffer: Buffer;
  recipe: VisualRecipe;
  adapter: SemanticEvaluationAdapter | null;
  evidence?: CharacterGateEvidence;
  options?: SemanticSceneGateOptions;
}): Promise<SemanticSceneGateResult> {
  const options = { ...DEFAULTS, ...(input.options ?? {}) };
  const drafts = buildSemanticCriteria(input.recipe);
  let metadata: { width: number; height: number };
  try {
    const dimensions = await sharp(input.imageBuffer).metadata();
    metadata = { width: dimensions.width ?? input.recipe.width, height: dimensions.height ?? input.recipe.height };
  } catch {
    metadata = { width: input.recipe.width, height: input.recipe.height };
  }

  const criteria: SemanticCriterion[] = [];
  for (const draft of drafts) {
    const target = draft.bbox ? await cropBuffer(input.imageBuffer, draft.bbox, metadata.width, metadata.height) : input.imageBuffer;
    if (!input.adapter) {
      criteria.push({
        ...draft,
        status: 'uncertain',
        score: null,
        negativeScore: null,
        margin: null,
        evaluatorId: null,
        matchedLabel: null,
        rationale: 'No local semantic evaluator was available.',
        reason: 'No local semantic evaluator was available; the criterion cannot be approved or rejected automatically.',
        bbox: draft.bbox,
        evidenceBbox: draft.evidenceBbox,
        evidenceScope: 'unavailable',
      });
      continue;
    }
    try {
      const evaluation = await input.adapter.evaluateImageSemantics({
        imageBuffer: target,
        positiveConcepts: draft.positiveConcepts,
        negativeConcepts: draft.negativeConcepts,
        criterionId: draft.id,
        criterionKind: draft.kind,
        regionIndex: draft.regionIndex,
        ...(draft.evidenceBbox ? { evidenceBbox: draft.evidenceBbox } : {}),
      });
      const classified = classify(evaluation, options, draft);
      criteria.push({
        ...draft,
        status: classified.status,
        score: evaluation.positiveScore,
        negativeScore: evaluation.negativeScore,
        margin: evaluation.margin,
        evaluatorId: evaluation.evaluatorId,
        matchedLabel: evaluation.matchedLabel,
        rationale: evaluation.rationale,
        reason: classified.reason,
        bbox: draft.bbox,
        evidenceBbox: draft.evidenceBbox,
        evidenceScope: evaluation.evidenceScope ?? (draft.kind === 'character' || draft.kind === 'scene' ? 'generic' : 'generic'),
      });
    } catch (error) {
      criteria.push({
        ...draft,
        status: 'uncertain',
        score: null,
        negativeScore: null,
        margin: null,
        evaluatorId: null,
        matchedLabel: null,
        rationale: 'The local semantic evaluator failed.',
        reason: `The local semantic evaluator failed: ${errorReason(error)}`,
        bbox: draft.bbox,
        evidenceBbox: draft.evidenceBbox,
        evidenceScope: 'unavailable',
      });
    }
  }

  const observations = [...observationFromEvidence(input.evidence), ...(await imageObservations(input.imageBuffer, input.evidence))];
  const failed = criteria.filter((criterion) => criterion.status === 'failed');
  const uncertain = criteria.filter((criterion) => criterion.status === 'uncertain');
  const confirmedVisualFailures = observations.filter((observation) => observation.status === 'confirmed');
  const uncertainVisualFailures = observations.filter((observation) => observation.status === 'uncertain');
  const scores = criteria.map((criterion) => criterion.score).filter((score): score is number => score !== null);
  const repairCandidates = criteria
    .filter((criterion): criterion is SemanticCriterion & { bbox: GateRect } => criterion.bbox !== null && (
      criterion.status === 'failed'
      || (criterion.status === 'uncertain' && criterion.kind !== 'character' && criterion.kind !== 'scene')
    ))
    .map((criterion) => ({
      criterionId: criterion.id,
      bbox: criterion.bbox,
      prompt: `Repair only this region so it clearly shows: ${criterion.requirement}. Preserve the character identity, lighting and surrounding composition.`,
      reason: criterion.reason,
    }));
  const semanticFailures = [
    ...(failed.length > 0 ? ['contradictory_prompt_evidence'] : []),
    ...(uncertain.length > 0 ? ['insufficient_semantic_evidence'] : []),
    ...(confirmedVisualFailures.length > 0 ? ['visual_composition_contradiction'] : []),
    ...(uncertainVisualFailures.length > 0 ? ['insufficient_visual_evidence'] : []),
  ];
  return {
    verdict: failed.length > 0 || confirmedVisualFailures.length > 0 ? 'rejected' : uncertain.length > 0 || uncertainVisualFailures.length > 0 ? 'needs_review' : 'passed_pending_human_review',
    criteria,
    semanticScore: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    failureCategories: { semantic: semanticFailures, visualQuality: [] },
    repairCandidates,
    observations,
  };
}
