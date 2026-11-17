/**
 * Character Composition Gate: combines local detector evidence into a composition verdict for multi-character art.
 *
 * Detectors are imperfect on stylized anime (calibrated on CS9 images: YOLO person missed a back-view character and
 * every stylized banner hero; the anime face detector misses back views; OpenPose misses glitchy figures). So the gate
 * only REJECTS on evidence that independent detectors agree on, and returns `needs_review` whenever the count cannot be
 * determined with confidence. It never approves: the best verdict is `passed_pending_human_review`.
 */

export interface GateRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GateBox extends GateRect {
  confidence: number;
}

export interface GateKeypoint {
  x: number;
  y: number;
  score: number;
}

/** Raw evidence for one image, as printed by scripts/character_gate_worker.py. */
export interface CharacterGateEvidence {
  width: number;
  height: number;
  detectors: {
    yolo_person?: { boxes?: GateBox[]; error?: string };
    yolo_face?: { boxes?: GateBox[]; error?: string };
    yolo_hand?: { boxes?: GateBox[]; error?: string };
    openpose?: { people?: Array<{ keypoints: Array<GateKeypoint | null>; score: number; parts: number }>; error?: string };
  };
}

export interface CharacterGateOptions {
  /** A figure is a main character when its full-body height reaches this fraction of the image height. */
  mainMinHeightRatio?: number;
  /** Background figures smaller than this fraction of the image height are ignored as not relevant. */
  backgroundMinHeightRatio?: number;
  /** Minimum YOLO confidence for a background figure to count as a confident rejection reason. */
  backgroundRejectConfidence?: number;
  /** Relevant background figures tolerated before rejecting (default 0). */
  maxBackgroundFigures?: number;
  personConfidence?: number;
  faceConfidence?: number;
  minFaceHeightRatio?: number;
}

export type CharacterGateVerdict = 'passed_pending_human_review' | 'needs_review' | 'rejected';
export type CharacterGateSeverity = 'reject' | 'review' | 'info';

export interface CharacterGateReason {
  code:
    | 'extra_main_characters'
    | 'background_figures'
    | 'possible_background_figures'
    | 'possible_missing_characters'
    | 'characters_not_detected'
    | 'low_detector_agreement'
    | 'detector_error'
    | 'multiple_faces_in_one_figure'
    | 'possible_fused_bodies'
    | 'extra_hands'
    | 'overlapping_characters'
    | 'empty_region'
    | 'crowded_region'
    | 'undersized_character'
    | 'safe_area_violation'
    | 'partial_skeleton';
  severity: CharacterGateSeverity;
  message: string;
  detectors?: string[];
  confidence?: number;
}

export interface CharacterGateFigure extends GateRect {
  role: 'main' | 'background';
  sources: Array<'yolo_person' | 'openpose' | 'yolo_face'>;
  confidence: number;
  faces: number;
  skeletonParts: number | null;
  regionIndex: number | null;
}

export interface CharacterGateResult {
  verdict: CharacterGateVerdict;
  expectedCount: number;
  /** Fused main-character count, or null when no detector produced usable evidence. */
  mainCount: number | null;
  backgroundCount: number;
  /** Main-character count per detector (null = detector failed). */
  countsByDetector: { yolo_person: number | null; openpose: number | null; yolo_face: number | null };
  /** 0..1: share of working detectors whose main count equals the fused count. */
  agreement: number;
  figures: CharacterGateFigure[];
  reasons: CharacterGateReason[];
  /** Short failure class used by the retry strategy. */
  failureClass: 'none' | 'extras' | 'missing' | 'placement' | 'anatomy' | 'uncertain';
}

const DEFAULTS: Required<CharacterGateOptions> = {
  mainMinHeightRatio: 0.3,
  backgroundMinHeightRatio: 0.08,
  backgroundRejectConfidence: 0.6,
  maxBackgroundFigures: 0,
  personConfidence: 0.5,
  faceConfidence: 0.5,
  minFaceHeightRatio: 0.035,
};

// OpenPose skeletons stop at the ankles/nose: about 0.83 of the YOLO full-body height in CS9 calibration.
const SKELETON_TO_BODY = 1 / 0.83;

function skeletonBox(keypoints: Array<GateKeypoint | null>): GateRect | null {
  const points = keypoints.filter((point): point is GateKeypoint => point !== null);
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const height = (Math.max(...ys) - Math.min(...ys)) * SKELETON_TO_BODY;
  const width = Math.max(Math.max(...xs) - Math.min(...xs), height * 0.25);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  return { x: centerX - width / 2, y: Math.min(...ys) - height * 0.08, width, height };
}

function center(rect: GateRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function contains(rect: GateRect, point: { x: number; y: number }, pad = 0): boolean {
  return point.x >= rect.x - pad && point.x <= rect.x + rect.width + pad && point.y >= rect.y - pad && point.y <= rect.y + rect.height + pad;
}

function horizontalOverlap(a: GateRect, b: GateRect): number {
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return overlap <= 0 ? 0 : overlap / Math.min(a.width, b.width);
}

function intersectionArea(a: GateRect, b: GateRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function iou(a: GateRect, b: GateRect): number {
  const inter = intersectionArea(a, b);
  return inter / (a.width * a.height + b.width * b.height - inter);
}

export function evaluateCharacterComposition(input: {
  evidence: CharacterGateEvidence;
  expectedCount: number;
  /** Planned character regions, in the evidence image's pixel space. */
  regions?: GateRect[];
  /** Areas that must stay free of characters (banner title safe area). */
  calmZones?: GateRect[];
  options?: CharacterGateOptions;
}): CharacterGateResult {
  const options = { ...DEFAULTS, ...(input.options ?? {}) };
  const { width, height, detectors } = input.evidence;
  const reasons: CharacterGateReason[] = [];
  const mainHeight = options.mainMinHeightRatio * height;
  const backgroundHeight = options.backgroundMinHeightRatio * height;

  for (const [name, detector] of Object.entries(detectors)) {
    if (detector?.error) reasons.push({ code: 'detector_error', severity: 'review', message: `${name} failed: ${detector.error}`, detectors: [name] });
  }

  const persons = (detectors.yolo_person?.boxes ?? []).filter((box) => box.confidence >= Math.min(options.personConfidence, 0.3));
  const skeletons = (detectors.openpose?.people ?? [])
    .filter((person) => person.parts >= 6)
    .map((person) => ({ box: skeletonBox(person.keypoints), parts: person.parts }))
    .filter((item): item is { box: GateRect; parts: number } => item.box !== null);
  const faces = (detectors.yolo_face?.boxes ?? []).filter((box) => box.confidence >= options.faceConfidence && box.height >= options.minFaceHeightRatio * height);

  // 1. Fuse YOLO bodies and OpenPose skeletons into figures (same figure: strong horizontal overlap, similar size).
  type Draft = CharacterGateFigure & { personConfidence: number };
  const figures: Draft[] = [];
  for (const box of persons) {
    figures.push({ ...box, role: 'background', sources: ['yolo_person'], confidence: box.confidence, personConfidence: box.confidence, faces: 0, skeletonParts: null, regionIndex: null });
  }
  for (const skeleton of skeletons) {
    const match = figures.find((figure) =>
      figure.sources.includes('yolo_person') &&
      !figure.sources.includes('openpose') &&
      horizontalOverlap(figure, skeleton.box) >= 0.5 &&
      figure.height / skeleton.box.height >= 0.6 && figure.height / skeleton.box.height <= 1.6);
    if (match) {
      match.sources.push('openpose');
      match.skeletonParts = skeleton.parts;
      match.confidence = Math.min(1, match.confidence + 0.15);
    } else {
      figures.push({ ...skeleton.box, role: 'background', sources: ['openpose'], confidence: Math.min(0.9, skeleton.parts / 18), personConfidence: 0, faces: 0, skeletonParts: skeleton.parts, regionIndex: null });
    }
  }
  // 2. Faces: attach to the figure whose upper half contains them; otherwise a face-only figure (anime back-up signal).
  for (const face of faces) {
    const faceCenter = center(face);
    const owner = figures.find((figure) => contains({ ...figure, height: figure.height * 0.55 }, faceCenter, face.width * 0.5));
    if (owner) {
      owner.faces += 1;
      if (!owner.sources.includes('yolo_face')) owner.sources.push('yolo_face');
    } else {
      // A standing anime character's head is roughly 1/6–1/8 of the body; estimate the body to classify the role.
      const estimatedHeight = face.height * 7;
      figures.push({
        x: face.x - face.width,
        y: face.y,
        width: face.width * 3,
        height: estimatedHeight,
        role: 'background',
        sources: ['yolo_face'],
        confidence: face.confidence * 0.8,
        personConfidence: 0,
        faces: 1,
        skeletonParts: null,
        regionIndex: null,
      });
    }
  }
  for (const figure of figures) figure.role = figure.height >= mainHeight ? 'main' : 'background';

  const main = figures.filter((figure) => figure.role === 'main');
  const background = figures.filter((figure) => figure.role === 'background' && figure.height >= backgroundHeight);

  // 3. Per-detector main counts (independent opinions).
  const countsByDetector = {
    yolo_person: detectors.yolo_person?.error ? null : persons.filter((box) => box.confidence >= options.personConfidence && box.height >= mainHeight).length,
    openpose: detectors.openpose?.error ? null : skeletons.filter((skeleton) => skeleton.box.height >= mainHeight).length,
    yolo_face: detectors.yolo_face?.error ? null : faces.filter((face) => face.height * 7 >= mainHeight).length,
  };
  const working = Object.entries(countsByDetector).filter((entry): entry is [string, number] => entry[1] !== null);
  const expected = input.expectedCount;
  const mainCount = working.length === 0 ? null : main.length;
  const agreeing = working.filter(([, count]) => count === mainCount).map(([name]) => name);
  const agreement = working.length === 0 ? 0 : agreeing.length / working.length;
  const over = working.filter(([, count]) => count > expected).map(([name]) => name);

  // 4. Count verdict.
  if (mainCount === null || main.length === 0) {
    reasons.push({ code: 'characters_not_detected', severity: 'review', message: `No detector found a main character (expected ${expected}); the figures may be illegible or too stylized for the detectors.` });
  } else if (mainCount > expected) {
    if (over.length >= 2) {
      reasons.push({ code: 'extra_main_characters', severity: 'reject', message: `${mainCount} main characters detected, ${expected} requested.`, detectors: over });
    } else {
      reasons.push({ code: 'extra_main_characters', severity: 'review', message: `Fused evidence suggests ${mainCount} main characters (${expected} requested) but only ${over.length} detector confirms it.`, detectors: over });
    }
  } else if (mainCount < expected) {
    // Detectors miss back views and stylized figures (CS9 calibration), so a low count alone is never a rejection.
    reasons.push({ code: 'possible_missing_characters', severity: 'review', message: `${mainCount} of ${expected} main characters detected; a character may be missing or undetectable (back view, stylization).` });
  } else if (agreeing.length < 2) {
    reasons.push({ code: 'low_detector_agreement', severity: 'review', message: `Count matches (${expected}) but only ${agreeing.join(', ') || 'the fused evidence'} supports it.`, detectors: agreeing });
  }

  // 5. Background figures not attached to a main character.
  const confidentBackground = background.filter((figure) => figure.personConfidence >= options.backgroundRejectConfidence || figure.sources.length >= 2);
  if (confidentBackground.length > options.maxBackgroundFigures) {
    reasons.push({
      code: 'background_figures',
      severity: 'reject',
      message: `${confidentBackground.length} relevant background figure(s) detected (max ${options.maxBackgroundFigures}).`,
      confidence: Math.max(...confidentBackground.map((figure) => figure.confidence)),
    });
  }
  const weakBackground = background.length - confidentBackground.length;
  if (weakBackground > 0) {
    reasons.push({ code: 'possible_background_figures', severity: 'review', message: `${weakBackground} low-confidence background figure(s) need a human check.` });
  }

  // 6. Anatomy / fusion heuristics (OpenPose cannot see extra limbs reliably: these only ask for review).
  for (const figure of main) {
    if (figure.faces > 1) reasons.push({ code: 'multiple_faces_in_one_figure', severity: 'review', message: `A main figure contains ${figure.faces} faces (possible fusion or duplicated head).` });
    if (figure.skeletonParts !== null && figure.skeletonParts < 10) reasons.push({ code: 'partial_skeleton', severity: 'info', message: `A main figure has only ${figure.skeletonParts}/18 pose keypoints.` });
    const inside = skeletons.filter((skeleton) => figure.sources.includes('yolo_person') && contains(figure, center(skeleton.box)) && skeleton.box.height >= mainHeight);
    if (inside.length >= 2) reasons.push({ code: 'possible_fused_bodies', severity: 'review', message: `${inside.length} pose skeletons fall inside one detected body.` });
  }
  const hands = (detectors.yolo_hand?.boxes ?? []).filter((box) => box.confidence >= 0.5).length;
  if (main.length > 0 && hands > main.length * 2 + 1) {
    reasons.push({ code: 'extra_hands', severity: 'review', message: `${hands} hands detected for ${main.length} main character(s).` });
  }
  for (let a = 0; a < main.length; a += 1) {
    for (let b = a + 1; b < main.length; b += 1) {
      const overlap = iou(main[a]!, main[b]!);
      if (overlap > 0.3) reasons.push({ code: 'overlapping_characters', severity: 'review', message: `Two main characters overlap (IoU ${overlap.toFixed(2)}).` });
    }
  }

  // 7. Placement against the planned regions and the calm (title) zones.
  const regions = input.regions ?? [];
  if (regions.length > 0) {
    const perRegion = regions.map(() => 0);
    for (const figure of main) {
      const figureCenter = center(figure);
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      regions.forEach((region, index) => {
        if (!contains(region, figureCenter, region.width * 0.25)) return;
        const distance = Math.abs(center(region).x - figureCenter.x);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });
      figure.regionIndex = best >= 0 ? best : null;
      if (best >= 0) perRegion[best] = (perRegion[best] ?? 0) + 1;
    }
    const empty = perRegion.filter((count) => count === 0).length;
    if (empty > 0 && main.length > 0) reasons.push({ code: 'empty_region', severity: 'review', message: `${empty} planned character region(s) have no detected main character.` });
    // Scale: a character far smaller than its planned region reads as a background figure next to the others.
    const undersized = main.filter((figure) => figure.regionIndex !== null && figure.height < 0.55 * regions[figure.regionIndex]!.height);
    if (undersized.length > 0) {
      reasons.push({ code: 'undersized_character', severity: 'review', message: `${undersized.length} main character(s) fill less than 55% of their planned region height.` });
    }
    const crowded = perRegion.filter((count) => count > 1).length;
    if (crowded > 0) reasons.push({ code: 'crowded_region', severity: 'review', message: `${crowded} planned region(s) hold more than one main character.` });
  }
  for (const zone of input.calmZones ?? []) {
    const intruders = main.filter((figure) => intersectionArea(figure, zone) > 0.25 * figure.width * figure.height);
    if (intruders.length > 0) reasons.push({ code: 'safe_area_violation', severity: 'reject', message: `${intruders.length} main character(s) intrude into the title safe area.` });
  }

  const verdict: CharacterGateVerdict = reasons.some((reason) => reason.severity === 'reject')
    ? 'rejected'
    : reasons.some((reason) => reason.severity === 'review')
      ? 'needs_review'
      : 'passed_pending_human_review';
  const codes = new Set(reasons.filter((reason) => reason.severity !== 'info').map((reason) => reason.code));
  const failureClass: CharacterGateResult['failureClass'] = verdict === 'passed_pending_human_review'
    ? 'none'
    : codes.has('extra_main_characters') || codes.has('background_figures')
      ? 'extras'
      : codes.has('safe_area_violation') || codes.has('crowded_region') || codes.has('undersized_character')
        ? 'placement'
        : codes.has('possible_missing_characters') || codes.has('characters_not_detected') || codes.has('empty_region')
          ? 'missing'
          : codes.has('possible_fused_bodies') || codes.has('multiple_faces_in_one_figure') || codes.has('extra_hands') || codes.has('overlapping_characters')
            ? 'anatomy'
            : 'uncertain';

  return {
    verdict,
    expectedCount: expected,
    mainCount,
    backgroundCount: background.length,
    countsByDetector,
    agreement,
    figures: figures.map(({ personConfidence: _ignored, ...figure }) => figure),
    reasons,
    failureClass,
  };
}

/** Ranks gate results so the best attempt is kept when no attempt passes (passed > needs_review > rejected). */
export function characterGateRank(result: CharacterGateResult): number {
  const base = result.verdict === 'passed_pending_human_review' ? 2000 : result.verdict === 'needs_review' ? 1000 : 0;
  const countPenalty = result.mainCount === null ? 50 : Math.abs(result.mainCount - result.expectedCount) * 20;
  return base - countPenalty - result.backgroundCount * 5 + Math.round(result.agreement * 10)
    - result.reasons.filter((reason) => reason.severity !== 'info').length;
}
