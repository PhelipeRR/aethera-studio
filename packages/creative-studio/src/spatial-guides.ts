import sharp from 'sharp';

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpenPoseGuideOptions {
  /** Deterministic pose variation for one region; 0 preserves the original standing guide. */
  variant?: number;
  /** Optional per-region variants for a multi-character guide. */
  variants?: number[];
}

/** COCO-18 standing pose in a unit box: nose, neck, R shoulder/elbow/wrist, L shoulder/elbow/wrist, hips, knees, ankles, eyes, ears. */
const STANDING_POSE: Array<[number, number]> = [
  [0.5, 0.08], [0.5, 0.18], [0.38, 0.19], [0.33, 0.34], [0.31, 0.48], [0.62, 0.19], [0.67, 0.34], [0.69, 0.48],
  [0.43, 0.5], [0.42, 0.72], [0.41, 0.94], [0.57, 0.5], [0.58, 0.72], [0.59, 0.94], [0.47, 0.065], [0.53, 0.065], [0.44, 0.08], [0.56, 0.08],
];
const LIMBS: Array<[number, number]> = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
/** Canonical OpenPose rendering colours, which the SDXL OpenPose ControlNet was trained on. */
const COLORS: Array<[number, number, number]> = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170],
  [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85],
];

/** Figure box inside a character region: full region height, body width about half the height, centred. */
export function figureBox(region: GuideRect): GuideRect {
  const width = Math.min(region.width, region.height * 0.5);
  return { x: region.x + (region.width - width) / 2, y: region.y, width, height: region.height };
}

function rgb([r, g, b]: [number, number, number], scale = 1): string {
  return `rgb(${Math.round(r * scale)},${Math.round(g * scale)},${Math.round(b * scale)})`;
}

/**
 * One synthetic OpenPose skeleton per character region. The skeleton count is what makes the character count a hard
 * spatial constraint; area prompts alone only bias the sampler and lost or added figures in the CS9 experiments.
 */
function posePoints(box: GuideRect, variant: number): Array<readonly [number, number]> {
  const normalized = ((Math.round(variant) % 4) + 4) % 4;
  return STANDING_POSE.map(([px, py], index) => {
    let x = px;
    let y = py;
    if (normalized === 1) {
      if ([2, 3, 4].includes(index)) { x += 0.04 + (index - 2) * 0.05; y -= (index - 1) * 0.04; }
      if ([5, 6, 7].includes(index)) { x -= 0.03; y += (index - 4) * 0.025; }
      if ([9, 10].includes(index)) x -= 0.035;
      if ([12, 13].includes(index)) x += 0.025;
    } else if (normalized === 2) {
      if ([2, 3, 4].includes(index)) { x -= 0.05; y += (index - 1) * 0.04; }
      if ([5, 6, 7].includes(index)) { x += 0.06 + (index - 5) * 0.035; y -= (index - 4) * 0.055; }
      if ([9, 10].includes(index)) { x += 0.04; y += 0.02; }
      if ([12, 13].includes(index)) { x -= 0.03; y -= 0.015; }
    } else if (normalized === 3) {
      if ([2, 3, 4].includes(index)) { x -= 0.025; y -= 0.055; }
      if ([5, 6, 7].includes(index)) { x += 0.025; y += 0.065; }
      if ([9, 10].includes(index)) { x -= 0.02; y -= 0.03; }
      if ([12, 13].includes(index)) { x += 0.02; y += 0.03; }
    }
    return [box.x + Math.max(0.08, Math.min(0.92, x)) * box.width, box.y + Math.max(0.04, Math.min(0.96, y)) * box.height] as const;
  });
}

export function buildOpenPoseGuideSvg(width: number, height: number, regions: GuideRect[], options: OpenPoseGuideOptions = {}): string {
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="black"/>`];
  for (const [index, region] of regions.entries()) {
    const box = figureBox(region);
    const points = posePoints(box, options.variants?.[index] ?? options.variant ?? 0);
    const stroke = Math.max(3, Math.round(box.height / 60));
    LIMBS.forEach(([a, b], index) => {
      const from = points[a];
      const to = points[b];
      const color = COLORS[index];
      if (!from || !to || !color) return;
      parts.push(`<line x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${to[0].toFixed(1)}" y2="${to[1].toFixed(1)}" stroke="${rgb(color, 0.6)}" stroke-width="${stroke}" stroke-linecap="round"/>`);
    });
    points.forEach(([x, y], index) => {
      const color = COLORS[index];
      if (color) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${stroke}" fill="${rgb(color)}"/>`);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

export async function renderOpenPoseGuide(width: number, height: number, regions: GuideRect[], options: OpenPoseGuideOptions = {}): Promise<Buffer> {
  return sharp(Buffer.from(buildOpenPoseGuideSvg(width, height, regions, options))).png().toBuffer();
}

/**
 * Soft mask PNG (white = conditioned area). `invert` paints everything except the rects, which is how the background
 * prompt is kept off the character figures.
 */
export async function renderZoneMask(width: number, height: number, rects: GuideRect[], options: { invert?: boolean; blur?: number; padX?: number } = {}): Promise<Buffer> {
  const base = options.invert ? 'white' : 'black';
  const zone = options.invert ? 'black' : 'white';
  const padX = options.padX ?? 0;
  const shapes = rects
    .map((rect) => `<rect x="${(rect.x - rect.width * padX).toFixed(1)}" y="${rect.y.toFixed(1)}" width="${(rect.width * (1 + 2 * padX)).toFixed(1)}" height="${rect.height.toFixed(1)}" fill="${zone}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${base}"/>${shapes}</svg>`;
  const image = sharp(Buffer.from(svg));
  return (options.blur ? image.blur(options.blur) : image).png().toBuffer();
}
