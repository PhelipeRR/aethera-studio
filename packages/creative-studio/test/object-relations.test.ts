import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  assessObjectRelation,
  buildObjectRepairPrompt,
  detectNewLinearObjects,
  parseObjectRelations,
  planObjectRepairMask,
  segmentEdgeSupport,
  type PoseKeypoints,
} from '../src/object-relations.js';

// Figure of a front-facing character (image-left is the character's right side).
const FIGURE = { x: 400, y: 100, width: 200, height: 600 };
const POSE: PoseKeypoints = {
  nose: { x: 500, y: 150, score: 0.9 },
  neck: { x: 500, y: 200, score: 0.9 },
  rightShoulder: { x: 450, y: 210, score: 0.9 },
  rightElbow: { x: 440, y: 290, score: 0.9 },
  rightWrist: { x: 445, y: 360, score: 0.9 },
  leftShoulder: { x: 550, y: 210, score: 0.9 },
  leftElbow: { x: 560, y: 290, score: 0.9 },
  leftWrist: { x: 555, y: 360, score: 0.9 },
  rightHip: { x: 470, y: 420, score: 0.9 },
  leftHip: { x: 530, y: 420, score: 0.9 },
};

async function canvas(lines: Array<[number, number, number, number]> = [], width = 1000, height = 800): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#405060"/>${lines.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e8e8f0" stroke-width="6"/>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('parseObjectRelations', () => {
  it('reads grip, orientation and hand from the original character prompt', () => {
    expect(parseObjectRelations('young swordswoman with long silver hair and red scarf, white and crimson armor, katana raised')).toEqual([
      expect.objectContaining({ object: 'katana', placement: 'in_hand', orientation: 'raised', hand: null }),
    ]);
    expect(parseObjectRelations('tall spear warrior with short black hair, dark blue plated armor, spear held in guard')).toEqual([
      expect.objectContaining({ object: 'spear', placement: 'in_hand', orientation: 'guard', hand: null }),
    ]);
    expect(parseObjectRelations('knight, sword in left hand, shield')).toEqual(expect.arrayContaining([
      expect.objectContaining({ object: 'sword', placement: 'in_hand', hand: 'left' }),
    ]));
    expect(parseObjectRelations('female sniper with pink bob hair, long white coat and rifle on shoulder')).toEqual([
      expect.objectContaining({ object: 'rifle', placement: 'on_shoulder' }),
    ]);
  });

  it('does not invent a relation for an object mentioned without one', () => {
    expect(parseObjectRelations('warrior with katana and armor')).toEqual([
      expect.objectContaining({ object: 'katana', placement: null, orientation: null, hand: null }),
    ]);
  });
});

describe('assessObjectRelation', () => {
  const katanaRaised = parseObjectRelations('katana raised')[0]!;
  const spearGuard = parseObjectRelations('spear held in guard')[0]!;
  const swordLeft = parseObjectRelations('sword in left hand')[0]!;

  it('separates object presence from grip: a weapon away from both hands is present but not held', () => {
    const result = assessObjectRelation({ relation: katanaRaised, segments: [{ x1: 700, y1: 300, x2: 720, y2: 650 }], pose: POSE, figure: FIGURE });
    expect(result.presence).toBe('detected');
    expect(result.grip).toBe('violated');
    expect(result.overall).toBe('violated');
  });

  it('confirms a katana gripped and raised above the shoulders', () => {
    const result = assessObjectRelation({ relation: katanaRaised, segments: [{ x1: 445, y1: 365, x2: 470, y2: 60 }], pose: POSE, figure: FIGURE });
    expect(result).toMatchObject({ presence: 'detected', grip: 'satisfied', orientation: 'satisfied', overall: 'satisfied' });
  });

  it('rejects a held katana pointing down when the prompt asks for it raised', () => {
    const result = assessObjectRelation({ relation: katanaRaised, segments: [{ x1: 445, y1: 355, x2: 430, y2: 680 }], pose: POSE, figure: FIGURE });
    expect(result).toMatchObject({ grip: 'satisfied', orientation: 'violated', overall: 'violated' });
  });

  it('rejects a weapon held in the wrong hand when the prompt names the hand', () => {
    // The character's right wrist is on image-left; the prompt asks for the left hand.
    const result = assessObjectRelation({ relation: swordLeft, segments: [{ x1: 445, y1: 360, x2: 350, y2: 120 }], pose: POSE, figure: FIGURE });
    expect(result).toMatchObject({ grip: 'satisfied', hand: 'violated', overall: 'violated' });
  });

  it('confirms a spear held diagonally in guard and rejects a spear planted upright beside the character', () => {
    const guard = assessObjectRelation({ relation: spearGuard, segments: [{ x1: 380, y1: 470, x2: 760, y2: 200 }], pose: POSE, figure: FIGURE });
    expect(guard).toMatchObject({ grip: 'satisfied', orientation: 'satisfied', overall: 'satisfied' });
    const planted = assessObjectRelation({ relation: spearGuard, segments: [{ x1: 640, y1: 690, x2: 645, y2: 180 }], pose: POSE, figure: FIGURE });
    expect(planted.overall).toBe('violated');
  });

  it('does not judge a segment too short to be the requested weapon (hair or arm edge near the hand)', () => {
    // 113 px on a 546 px figure: the real-run false positive (hair edge next to clasped hands).
    const short = assessObjectRelation({ relation: katanaRaised, segments: [{ x1: 450, y1: 365, x2: 470, y2: 250 }], pose: POSE, figure: FIGURE });
    expect(short).toMatchObject({ presence: 'weak', overall: 'uncertain', reasons: expect.arrayContaining(['object_extent_too_short']) });
    const shortSpear = assessObjectRelation({ relation: spearGuard, segments: [{ x1: 445, y1: 360, x2: 440, y2: 160 }], pose: POSE, figure: FIGURE });
    expect(shortSpear).toMatchObject({ presence: 'weak', overall: 'uncertain' });
  });

  it('stays uncertain without pose evidence or without a localized object', () => {
    expect(assessObjectRelation({ relation: katanaRaised, segments: [{ x1: 445, y1: 365, x2: 470, y2: 60 }], pose: null, figure: FIGURE }).overall).toBe('uncertain');
    expect(assessObjectRelation({ relation: katanaRaised, segments: [], pose: POSE, figure: FIGURE })).toMatchObject({ presence: 'not_detected', overall: 'uncertain' });
  });
});

describe('weapon localization by new straight edges', () => {
  it('finds a straight object that the repair added and ignores edges that already existed', async () => {
    const before = await canvas([[100, 700, 900, 700]]);
    const after = await canvas([[100, 700, 900, 700], [450, 360, 480, 80]]);
    const segments = await detectNewLinearObjects(before, after, { x: 300, y: 50, width: 400, height: 700 }, { minLength: 150 });
    expect(segments).toHaveLength(1);
    const [segment] = segments;
    const top = Math.min(segment!.y1, segment!.y2);
    const bottom = Math.max(segment!.y1, segment!.y2);
    expect(top).toBeLessThan(110);
    expect(bottom).toBeGreaterThan(330);
  });

  it('measures whether an earlier weapon survives a later operation', async () => {
    const withSword = await canvas([[450, 360, 480, 80]]);
    const swordRemoved = await canvas([]);
    const segment = { x1: 450, y1: 360, x2: 480, y2: 80 };
    expect(await segmentEdgeSupport(withSword, segment)).toBeGreaterThan(0.8);
    expect(await segmentEdgeSupport(swordRemoved, segment)).toBeLessThan(0.2);
  });
});

describe('relation-aware repair planning', () => {
  const region = { x: 300, y: 20, width: 400, height: 760 };
  const face = { x: 470, y: 120, width: 60, height: 70 };

  it('covers the hands and the space above them for a raised weapon while protecting the face', () => {
    const plan = planObjectRepairMask({ relation: parseObjectRelations('katana raised')[0]!, region, figure: FIGURE, pose: POSE, face });
    expect(plan.bbox.y).toBeLessThanOrEqual(FIGURE.y);
    expect(plan.bbox.y + plan.bbox.height).toBeGreaterThanOrEqual(POSE.rightWrist!.y + 30);
    expect(plan.bbox.x).toBeLessThanOrEqual(POSE.rightWrist!.x - 30);
    expect(plan.protect).toContainEqual(expect.objectContaining({ x: expect.any(Number) }));
    const protectedFace = plan.protect[0]!;
    expect(protectedFace.x).toBeLessThanOrEqual(face.x);
    expect(protectedFace.y + protectedFace.height).toBeGreaterThanOrEqual(face.y + face.height);
  });

  it('extends sideways around the hands for a guard stance', () => {
    const plan = planObjectRepairMask({ relation: parseObjectRelations('spear held in guard')[0]!, region, figure: FIGURE, pose: POSE, face });
    expect(plan.bbox.width).toBeGreaterThan(FIGURE.width * 1.4);
    expect(plan.bbox.y).toBeGreaterThan(FIGURE.y + FIGURE.height * 0.1);
  });

  it('turns the relation into explicit prompt wording and negatives', () => {
    const katana = buildObjectRepairPrompt('young swordswoman, red scarf', parseObjectRelations('katana raised')[0]!);
    expect(katana.prompt).toMatch(/holding katana/);
    expect(katana.prompt).toMatch(/raised overhead/);
    expect(katana.negative).toMatch(/sheathed/);
    const spear = buildObjectRepairPrompt('spear warrior', parseObjectRelations('spear held in guard')[0]!);
    expect(spear.prompt).toMatch(/guard stance/);
    expect(spear.negative).toMatch(/planted in the ground/);
  });
});

describe('weapon localization near vertical', () => {
  it('reports a near-vertical line once even when its Hough peaks straddle the 0/180 degree wrap', async () => {
    const before = await canvas([]);
    const after = await canvas([[500, 700, 503, 120]]);
    const segments = await detectNewLinearObjects(before, after, { x: 300, y: 50, width: 400, height: 700 }, { minLength: 150 });
    expect(segments).toHaveLength(1);
  });
});
