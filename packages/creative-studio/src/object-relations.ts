import sharp from 'sharp';

/**
 * Character ↔ object relations (CS10). The local CLIP evaluator cannot tell whether a thin weapon is present, let
 * alone held or raised, so this module checks the relation geometrically: the weapon is localized as a new straight
 * structure added by a repair, and grip/hand/orientation are judged against OpenPose wrists and shoulders. Every
 * check returns `uncertain` when evidence is missing; nothing here approves an image.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
  score?: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Fraction of the segment backed by new edges (0..1), when produced by the detector. */
  support?: number;
}

export type ObjectPlacement = 'in_hand' | 'on_shoulder' | 'on_back' | 'sheathed';
export type ObjectOrientation = 'raised' | 'guard' | 'lowered' | 'aimed';

export interface ObjectRelation {
  object: string;
  placement: ObjectPlacement | null;
  orientation: ObjectOrientation | null;
  hand: 'left' | 'right' | 'both' | null;
  /** Prompt clause the relation was read from. */
  clause: string;
}

/** Named OpenPose (COCO-18) body keypoints; the character's right side is image-left for a front-facing figure. */
export interface PoseKeypoints {
  nose?: Point | null;
  neck?: Point | null;
  rightShoulder?: Point | null;
  rightElbow?: Point | null;
  rightWrist?: Point | null;
  leftShoulder?: Point | null;
  leftElbow?: Point | null;
  leftWrist?: Point | null;
  rightHip?: Point | null;
  leftHip?: Point | null;
}

export type RelationCheck = 'satisfied' | 'violated' | 'uncertain' | 'not_required';

export interface ObjectRelationAssessment {
  /** `weak`: a new straight structure was found but it is too short to be the requested object. */
  presence: 'detected' | 'weak' | 'not_detected';
  grip: RelationCheck;
  hand: RelationCheck;
  orientation: RelationCheck;
  overall: 'satisfied' | 'violated' | 'uncertain';
  /** Segment judged as the object (the one nearest a wrist). */
  segment: Segment | null;
  holdingHand: 'left' | 'right' | null;
  reasons: string[];
}

const OBJECT_TERMS = ['katana', 'sword', 'blade', 'spear', 'lance', 'polearm', 'halberd', 'staff', 'rifle', 'gun', 'pistol', 'bow', 'axe'];

/** Reads explicit relations only; an object mentioned without grip/orientation wording gets nulls, never a guess. */
export function parseObjectRelations(prompt: string): ObjectRelation[] {
  const relations: ObjectRelation[] = [];
  for (const rawClause of prompt.toLocaleLowerCase().split(/[,;]|\band\b(?=\s+(?:a|an|the)?\s*\w+\s+(?:on|in|held|raised))/)) {
    const clause = rawClause.trim();
    for (const object of OBJECT_TERMS) {
      if (!new RegExp(`\\b${object}s?\\b`).test(clause)) continue;
      const hand = /\bboth hands\b|\btwo-handed\b/.test(clause) ? 'both' : /\bleft hand\b/.test(clause) ? 'left' : /\bright hand\b/.test(clause) ? 'right' : null;
      const orientation: ObjectOrientation | null = /\braised\b|\boverhead\b|\bheld high\b|\bpointing up\b/.test(clause)
        ? 'raised'
        : /\bguard\b|\bready stance\b|\bfighting stance\b/.test(clause)
          ? 'guard'
          : /\blowered\b|\bpointing down\b/.test(clause)
            ? 'lowered'
            : /\baim(?:ed|ing)\b/.test(clause)
              ? 'aimed'
              : null;
      const placement: ObjectPlacement | null = /\bon (?:the |his |her )?shoulder\b/.test(clause)
        ? 'on_shoulder'
        : /\bon (?:the |his |her )?back\b/.test(clause)
          ? 'on_back'
          : /\bsheathed\b|\bat (?:the |his |her )?(?:waist|hip)\b/.test(clause)
            ? 'sheathed'
            : hand || orientation || /\bheld\b|\bholding\b|\bwield(?:s|ing)?\b|\bgrip(?:s|ping)?\b|\bbrandish(?:es|ing)?\b|\bin hand\b/.test(clause)
              ? 'in_hand'
              : null;
      const candidate: ObjectRelation = { object, placement, orientation, hand, clause };
      const existing = relations.findIndex((relation) => relation.object === object);
      const detail = (relation: ObjectRelation) => [relation.placement, relation.orientation, relation.hand].filter(Boolean).length;
      // "spear warrior …, spear held in guard": keep the clause that states the relation.
      if (existing < 0) relations.push(candidate);
      else if (detail(candidate) > detail(relations[existing]!)) relations[existing] = candidate;
    }
  }
  return relations;
}

function distanceToSegment(point: Point, segment: Segment): number {
  const vx = segment.x2 - segment.x1;
  const vy = segment.y2 - segment.y1;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - segment.x1) * vx + (point.y - segment.y1) * vy) / lengthSq)) : 0;
  return Math.hypot(point.x - (segment.x1 + t * vx), point.y - (segment.y1 + t * vy));
}

const usable = (point: Point | null | undefined): point is Point => !!point && (point.score ?? 1) >= 0.1;

/** Grip tolerances as a fraction of figure height. */
const GRIP_HELD = 0.06;
const GRIP_AWAY = 0.15;

/**
 * Minimum visible length of each object as a share of the figure height. A shorter new edge (hair strand, arm, strap)
 * cannot stand for the weapon, so it neither confirms nor rejects the relation.
 */
const MIN_OBJECT_EXTENT: Record<string, number> = {
  katana: 0.3, sword: 0.3, blade: 0.3, spear: 0.45, lance: 0.45, polearm: 0.45, halberd: 0.45, staff: 0.45,
  rifle: 0.25, gun: 0.2, pistol: 0.08, bow: 0.3, axe: 0.2,
};

export function assessObjectRelation(input: { relation: ObjectRelation; segments: Segment[]; pose: PoseKeypoints | null; figure: Rect }): ObjectRelationAssessment {
  const { relation, pose, figure } = input;
  const reasons: string[] = [];
  const wrists = { right: usable(pose?.rightWrist) ? pose!.rightWrist! : null, left: usable(pose?.leftWrist) ? pose!.leftWrist! : null };
  const nearest = (segment: Segment) => Math.min(...[wrists.right, wrists.left].filter((wrist): wrist is Point => !!wrist).map((wrist) => distanceToSegment(wrist, segment)), Number.POSITIVE_INFINITY);
  // The object is the localized segment long enough to be it and closest to a hand; otherwise the longest one.
  const length = (candidate: Segment) => Math.hypot(candidate.x2 - candidate.x1, candidate.y2 - candidate.y1);
  const longEnough = (candidate: Segment) => length(candidate) >= (MIN_OBJECT_EXTENT[relation.object] ?? 0.2) * Math.max(1, figure.height);
  const segment = [...input.segments].sort((a, b) => Number(longEnough(b)) - Number(longEnough(a)) || nearest(a) - nearest(b) || length(b) - length(a))[0] ?? null;
  if (!segment) {
    return { presence: 'not_detected', grip: 'uncertain', hand: 'uncertain', orientation: 'uncertain', overall: 'uncertain', segment: null, holdingHand: null, reasons: ['object_not_localized'] };
  }
  const scale = Math.max(1, figure.height);
  const minExtent = MIN_OBJECT_EXTENT[relation.object] ?? 0.2;
  if (Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) < minExtent * scale) {
    return { presence: 'weak', grip: 'uncertain', hand: 'uncertain', orientation: 'uncertain', overall: 'uncertain', segment, holdingHand: null, reasons: ['object_extent_too_short'] };
  }
  const inHand = relation.placement === 'in_hand';
  const dRight = wrists.right ? distanceToSegment(wrists.right, segment) / scale : null;
  const dLeft = wrists.left ? distanceToSegment(wrists.left, segment) / scale : null;
  const distances = [dRight, dLeft].filter((value): value is number => value !== null);
  let grip: RelationCheck = 'not_required';
  let holdingHand: 'left' | 'right' | null = null;
  if (inHand) {
    if (distances.length === 0) {
      grip = 'uncertain';
      reasons.push('no_wrist_keypoints');
    } else if (Math.min(...distances) <= GRIP_HELD) {
      grip = 'satisfied';
      holdingHand = dRight !== null && (dLeft === null || dRight <= dLeft) ? 'right' : 'left';
    } else if (distances.length === 2 && Math.min(...distances) > GRIP_AWAY) {
      grip = 'violated';
      reasons.push('object_not_in_hand');
    } else {
      grip = 'uncertain';
      reasons.push('grip_ambiguous');
    }
  }

  let hand: RelationCheck = 'not_required';
  if (relation.hand) {
    const requested = relation.hand;
    if (requested === 'both') {
      hand = dRight !== null && dLeft !== null ? (dRight <= GRIP_HELD * 1.4 && dLeft <= GRIP_HELD * 1.4 ? 'satisfied' : Math.max(dRight, dLeft) > GRIP_AWAY ? 'violated' : 'uncertain') : 'uncertain';
    } else {
      const own = requested === 'right' ? dRight : dLeft;
      const other = requested === 'right' ? dLeft : dRight;
      hand = own === null ? 'uncertain' : own <= GRIP_HELD ? 'satisfied' : other !== null && other <= GRIP_HELD && own > GRIP_AWAY ? 'violated' : 'uncertain';
    }
    if (hand === 'violated') reasons.push(`object_not_in_${requested}_hand`);
  }

  // Tip: the endpoint farther from the holding wrist; without a grip, the upper endpoint.
  const holdingWrist = holdingHand ? wrists[holdingHand] : null;
  const [base, tip] = holdingWrist
    ? (Math.hypot(segment.x1 - holdingWrist.x, segment.y1 - holdingWrist.y) <= Math.hypot(segment.x2 - holdingWrist.x, segment.y2 - holdingWrist.y)
      ? [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]
      : [{ x: segment.x2, y: segment.y2 }, { x: segment.x1, y: segment.y1 }])
    : segment.y1 >= segment.y2
      ? [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }]
      : [{ x: segment.x2, y: segment.y2 }, { x: segment.x1, y: segment.y1 }];
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const fromVerticalUp = (Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI; // 0 = straight up, 180 = straight down
  const fromHorizontal = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0 = horizontal, 90 = upright
  const shoulderY = Math.min(...[pose?.rightShoulder, pose?.leftShoulder, pose?.neck].filter(usable).map((point) => point.y), figure.y + figure.height * 0.2);

  let orientation: RelationCheck = 'not_required';
  switch (relation.orientation) {
    case 'raised':
      if (dy > 0 && fromVerticalUp > 110) {
        orientation = 'violated';
        reasons.push('object_points_down_not_raised');
      } else if (tip.y < shoulderY && fromVerticalUp <= 50) orientation = 'satisfied';
      else {
        orientation = 'uncertain';
        reasons.push('raise_ambiguous');
      }
      break;
    case 'guard':
      if (fromHorizontal > 80) {
        orientation = 'violated';
        reasons.push('object_upright_not_in_guard');
      } else if (fromHorizontal >= 12 && fromHorizontal <= 70 && dy < 0) orientation = 'satisfied';
      else {
        orientation = 'uncertain';
        reasons.push('guard_ambiguous');
      }
      break;
    case 'lowered':
      orientation = dy > 0 && fromVerticalUp >= 110 ? 'satisfied' : dy < 0 && fromVerticalUp <= 50 ? 'violated' : 'uncertain';
      break;
    case 'aimed':
      orientation = fromHorizontal <= 30 ? 'satisfied' : fromHorizontal >= 70 ? 'violated' : 'uncertain';
      break;
    default:
      orientation = 'not_required';
  }

  const checks = [grip, hand, orientation];
  const overall = checks.includes('violated')
    ? 'violated'
    : checks.every((check) => check === 'satisfied' || check === 'not_required') && checks.some((check) => check === 'satisfied')
      ? 'satisfied'
      : 'uncertain';
  return { presence: 'detected', grip, hand, orientation, overall, segment, holdingHand, reasons };
}

async function gradientMagnitude(image: Buffer, crop: Rect): Promise<{ data: Float32Array; width: number; height: number }> {
  const meta = await sharp(image).metadata();
  const left = Math.max(0, Math.floor(crop.x));
  const top = Math.max(0, Math.floor(crop.y));
  const width = Math.max(1, Math.min((meta.width ?? 0) - left, Math.ceil(crop.width)));
  const height = Math.max(1, Math.min((meta.height ?? 0) - top, Math.ceil(crop.height)));
  const grey = await sharp(image).extract({ left, top, width, height }).greyscale().raw().toBuffer();
  const data = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (dx: number, dy: number) => grey[(y + dy) * width + x + dx] ?? 0;
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      data[y * width + x] = Math.hypot(gx, gy) / 4;
    }
  }
  return { data, width, height };
}

const EDGE_THRESHOLD = 28;

/**
 * Localizes straight structures that a repair ADDED inside `area` (new strong edges, Hough transform, longest
 * supported run). Existing edges are ignored, so scenery and the unchanged body do not count as the object.
 */
const DUPLICATE_SEGMENT_DISTANCE = 14;

/** True when most of `candidate` (sampled at 5 points) runs within `tolerance` px of `kept`. */
function overlapsAlong(kept: Segment, candidate: Segment, tolerance: number): boolean {
  let near = 0;
  for (let i = 0; i <= 4; i += 1) {
    const point = { x: candidate.x1 + ((candidate.x2 - candidate.x1) * i) / 4, y: candidate.y1 + ((candidate.y2 - candidate.y1) * i) / 4 };
    if (distanceToSegment(point, kept) <= tolerance) near += 1;
  }
  return near >= 4;
}

export async function detectNewLinearObjects(before: Buffer, after: Buffer, area: Rect, options: { minLength: number; maxSegments?: number }): Promise<Segment[]> {
  const [b, a] = await Promise.all([gradientMagnitude(before, area), gradientMagnitude(after, area)]);
  const { width, height } = a;
  const edge = new Uint8Array(width * height);
  const points: number[] = [];
  for (let i = 0; i < edge.length; i += 1) {
    if ((a.data[i] ?? 0) > EDGE_THRESHOLD && (a.data[i] ?? 0) - (b.data[i] ?? 0) > EDGE_THRESHOLD * 0.6) {
      edge[i] = 1;
      points.push(i);
    }
  }
  if (points.length < options.minLength) return [];
  const thetas = 180;
  const diag = Math.ceil(Math.hypot(width, height));
  const accumulator = new Uint32Array(thetas * (2 * diag + 1));
  const cos = Float64Array.from({ length: thetas }, (_, t) => Math.cos((t * Math.PI) / thetas));
  const sin = Float64Array.from({ length: thetas }, (_, t) => Math.sin((t * Math.PI) / thetas));
  for (const index of points) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let t = 0; t < thetas; t += 1) accumulator[t * (2 * diag + 1) + Math.round(x * cos[t]! + y * sin[t]!) + diag]! += 1;
  }
  const peaks: Array<{ t: number; rho: number; votes: number }> = [];
  for (let t = 0; t < thetas; t += 1) {
    for (let r = 0; r <= 2 * diag; r += 1) {
      const votes = accumulator[t * (2 * diag + 1) + r]!;
      if (votes >= options.minLength * 0.5) peaks.push({ t, rho: r - diag, votes });
    }
  }
  peaks.sort((p, q) => q.votes - p.votes);
  const segments: Segment[] = [];
  const kept: Array<{ t: number; rho: number }> = [];
  const hasEdge = (x: number, y: number) => {
    for (let oy = -2; oy <= 2; oy += 1) for (let ox = -2; ox <= 2; ox += 1) {
      const px = x + ox;
      const py = y + oy;
      if (px >= 0 && py >= 0 && px < width && py < height && edge[py * width + px]) return true;
    }
    return false;
  };
  for (const peak of peaks) {
    if (segments.length >= (options.maxSegments ?? 3)) break;
    // Parallel edges of the same blade and near-duplicate peaks collapse into one object.
    // (t, rho) and (t ± 180°, -rho) are the same line: compare across the wrap with the sign flipped.
    const duplicate = kept.some((other) => {
      const direct = Math.abs(other.t - peak.t);
      if (direct <= 6 && Math.abs(other.rho - peak.rho) <= 24) return true;
      return thetas - direct <= 6 && Math.abs(other.rho + peak.rho) <= 24;
    });
    if (duplicate) continue;
    kept.push(peak);
    const c = cos[peak.t]!;
    const s = sin[peak.t]!;
    // Walk the line and keep the longest run with gaps of at most 6 px.
    let best: { from: number; to: number } | null = null;
    let runStart: number | null = null;
    let lastHit: number | null = null;
    for (let u = -diag; u <= diag; u += 1) {
      const x = Math.round(peak.rho * c - u * s);
      const y = Math.round(peak.rho * s + u * c);
      const inside = x >= 0 && y >= 0 && x < width && y < height;
      if (inside && hasEdge(x, y)) {
        if (runStart === null || (lastHit !== null && u - lastHit > 6)) runStart = u;
        lastHit = u;
        if (!best || u - runStart > best.to - best.from) best = { from: runStart, to: u };
      }
    }
    if (!best || best.to - best.from < options.minLength) continue;
    const point = (u: number) => ({ x: peak.rho * c - u * s + area.x, y: peak.rho * s + u * c + area.y });
    const p1 = point(best.from);
    const p2 = point(best.to);
    const candidate = { x1: Math.round(p1.x), y1: Math.round(p1.y), x2: Math.round(p2.x), y2: Math.round(p2.y), support: Number(Math.min(1, peak.votes / (2 * (best.to - best.from))).toFixed(3)) };
    // A slightly tilted peak of the same blade traces a segment that lies along one already kept: drop it.
    if (segments.some((other) => overlapsAlong(other, candidate, DUPLICATE_SEGMENT_DISTANCE))) continue;
    segments.push(candidate);
  }
  return segments;
}

/** Fraction of points along `segment` that still sit on a strong edge (±4 px); used to detect a removed weapon. */
export async function segmentEdgeSupport(image: Buffer, segment: Segment): Promise<number> {
  const pad = 6;
  const area = {
    x: Math.max(0, Math.min(segment.x1, segment.x2) - pad),
    y: Math.max(0, Math.min(segment.y1, segment.y2) - pad),
    width: Math.abs(segment.x2 - segment.x1) + 2 * pad,
    height: Math.abs(segment.y2 - segment.y1) + 2 * pad,
  };
  const { data, width, height } = await gradientMagnitude(image, area);
  const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  if (length < 1) return 0;
  const nx = -(segment.y2 - segment.y1) / length;
  const ny = (segment.x2 - segment.x1) / length;
  let hits = 0;
  let samples = 0;
  for (let step = 0; step <= length; step += 2) {
    const cx = segment.x1 + ((segment.x2 - segment.x1) * step) / length - area.x;
    const cy = segment.y1 + ((segment.y2 - segment.y1) * step) / length - area.y;
    samples += 1;
    for (let offset = -4; offset <= 4; offset += 1) {
      const x = Math.round(cx + nx * offset);
      const y = Math.round(cy + ny * offset);
      if (x >= 0 && y >= 0 && x < width && y < height && (data[y * width + x] ?? 0) > EDGE_THRESHOLD) {
        hits += 1;
        break;
      }
    }
  }
  return samples > 0 ? hits / samples : 0;
}

function clampRect(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, rect.x);
  const y = Math.max(bounds.y, rect.y);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Plans the editable area for an object repair: both hands (grip), plus the space the requested orientation needs
 * (above the hands for a raised weapon, to the sides for a guard), clamped to the character's region. The face is
 * returned as a protected rectangle so a raised blade can pass beside the head without redrawing it.
 */
export function planObjectRepairMask(input: { relation: ObjectRelation; region: Rect; figure: Rect; pose: PoseKeypoints | null; face: Rect | null }): { bbox: Rect; protect: Rect[]; basis: 'pose' | 'figure' } {
  const { relation, region, figure, pose } = input;
  const h = figure.height;
  const wrists = [pose?.rightWrist, pose?.leftWrist].filter(usable);
  const protect: Rect[] = [];
  const face = input.face ?? (usable(pose?.nose) ? { x: pose!.nose!.x - h * 0.06, y: pose!.nose!.y - h * 0.07, width: h * 0.12, height: h * 0.12 } : null);
  if (face) protect.push({ x: face.x - face.width * 0.15, y: face.y - face.height * 0.15, width: face.width * 1.3, height: face.height * 1.3 });
  if (wrists.length === 0) {
    const bbox = clampRect({ x: figure.x - figure.width * 0.5, y: figure.y + h * 0.18, width: figure.width * 2, height: h * 0.67 }, region);
    return { bbox, protect, basis: 'figure' };
  }
  const handSize = h * 0.09;
  const parts: Rect[] = wrists.map((wrist) => ({ x: wrist.x - handSize, y: wrist.y - handSize, width: handSize * 2, height: handSize * 2 }));
  const minX = Math.min(...wrists.map((wrist) => wrist.x));
  const maxX = Math.max(...wrists.map((wrist) => wrist.x));
  const topWrist = Math.min(...wrists.map((wrist) => wrist.y));
  const bottomWrist = Math.max(...wrists.map((wrist) => wrist.y));
  if (relation.orientation === 'raised') {
    parts.push({ x: minX - h * 0.25, y: figure.y - h * 0.1, width: maxX - minX + h * 0.5, height: bottomWrist - (figure.y - h * 0.1) });
  } else if (relation.orientation === 'guard' || relation.orientation === 'aimed') {
    parts.push({ x: minX - h * 0.45, y: topWrist - h * 0.25, width: maxX - minX + h * 0.9, height: bottomWrist - topWrist + h * 0.5 });
  } else if (relation.orientation === 'lowered') {
    parts.push({ x: minX - h * 0.2, y: topWrist, width: maxX - minX + h * 0.4, height: figure.y + figure.height - topWrist });
  } else {
    parts.push({ x: minX - h * 0.3, y: topWrist - h * 0.2, width: maxX - minX + h * 0.6, height: h * 0.45 });
  }
  return { bbox: clampRect(union(parts), region), protect, basis: 'pose' };
}

export function buildObjectRepairPrompt(characterPrompt: string, relation: ObjectRelation): { prompt: string; negative: string } {
  const object = relation.object;
  const grip = relation.hand === 'both' ? `holding ${object} with both hands` : relation.hand ? `holding ${object} in ${relation.hand} hand` : `holding ${object}`;
  const pose = relation.orientation === 'raised'
    ? `${object} raised overhead, blade pointing up`
    : relation.orientation === 'guard'
      ? `${object} held diagonally across the body in guard stance, tip pointing forward`
      : relation.orientation === 'lowered'
        ? `${object} lowered, pointing down`
        : relation.orientation === 'aimed'
          ? `aiming ${object} forward`
          : '';
  const placement = relation.placement === 'on_shoulder' ? `${object} resting on shoulder` : relation.placement === 'on_back' ? `${object} on back` : relation.placement === 'sheathed' ? `sheathed ${object} at waist` : '';
  const action = relation.placement === 'in_hand' || relation.placement === null ? [grip, pose].filter(Boolean).join(', ') : placement;
  const negatives = ['from behind', 'back view', 'turned away', 'extra person', 'duplicate character', 'extra weapon'];
  if (relation.placement === 'in_hand' || relation.placement === null) negatives.push(`sheathed ${object}`, 'sheathed', 'empty hands', `${object} planted in the ground`, 'planted in the ground', `${object} lying on the ground`);
  if (relation.orientation === 'raised') negatives.push(`${object} pointing down`, 'lowered weapon');
  if (relation.orientation === 'guard') negatives.push('upright weapon', 'vertical weapon');
  return { prompt: `${characterPrompt}, ${action}, ${object} clearly visible`, negative: negatives.join(', ') };
}

/** Maps OpenPose COCO-18 keypoints (array order of character_gate_worker.py) to named joints. */
export function poseFromOpenPose(keypoints: Array<Point | null>): PoseKeypoints {
  const at = (index: number) => keypoints[index] ?? null;
  return {
    nose: at(0),
    neck: at(1),
    rightShoulder: at(2),
    rightElbow: at(3),
    rightWrist: at(4),
    leftShoulder: at(5),
    leftElbow: at(6),
    leftWrist: at(7),
    rightHip: at(8),
    leftHip: at(11),
  };
}
