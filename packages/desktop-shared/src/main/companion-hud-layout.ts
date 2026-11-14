import type { CompanionHudLayout, CompanionHudMode } from '@neuralbridge/shared/companion';

/** Window sizes in DIPs. They include the margin the glow and the mascot's overhang need; that margin is click-through. */
export const HUD_SIZES = { mascot: { width: 132, height: 124 }, compact: { width: 430, height: 116 }, expanded: { width: 820, height: 440 } } as const satisfies Record<CompanionHudMode, Size>;

/** Clicking outside the expanded panel returns the Companion to its mascot. */
export function shouldCollapseOnBlur(mode: CompanionHudMode): boolean {
  return mode === 'expanded';
}

const SCREEN_MARGIN = 24;
const SNAP_DISTANCE = 16;

export interface Size { width: number; height: number; }
export interface Point { x: number; y: number; }
export interface Rect extends Point, Size {}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function distanceSquared(point: Point, area: Rect): number {
  const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
  const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
  return dx * dx + dy * dy;
}

/** The monitor holding most of the rectangle, or the nearest one when it is off every monitor (say, one was unplugged). */
export function workAreaFor(rect: Rect, areas: readonly Rect[]): Rect {
  const [first] = areas;
  if (!first) throw new Error('No display available');
  let best = first; let bestOverlap = -1; let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    const covered = overlap(rect, area); const distance = distanceSquared(rect, area);
    if (covered > bestOverlap || (covered === 0 && bestOverlap === 0 && distance < bestDistance)) { best = area; bestOverlap = covered; bestDistance = distance; }
  }
  return best;
}

export function clampToArea(position: Point, size: Size, area: Rect): Point {
  return {
    x: Math.round(Math.min(Math.max(position.x, area.x), Math.max(area.x, area.x + area.width - size.width))),
    y: Math.round(Math.min(Math.max(position.y, area.y), Math.max(area.y, area.y + area.height - size.height))),
  };
}

/** Pulls a dropped window onto a screen edge it landed close to, then keeps it inside the monitor. */
export function snapToArea(position: Point, size: Size, area: Rect): Point {
  const right = area.x + area.width - size.width; const bottom = area.y + area.height - size.height;
  const x = Math.abs(position.x - area.x) <= SNAP_DISTANCE ? area.x : Math.abs(position.x - right) <= SNAP_DISTANCE ? right : position.x;
  const y = Math.abs(position.y - area.y) <= SNAP_DISTANCE ? area.y : Math.abs(position.y - bottom) <= SNAP_DISTANCE ? bottom : position.y;
  return clampToArea({ x, y }, size, area);
}

export function defaultAnchor(primary: Rect): Point {
  return { x: primary.x + primary.width - HUD_SIZES.mascot.width - SCREEN_MARGIN, y: primary.y + primary.height - HUD_SIZES.mascot.height - SCREEN_MARGIN };
}

/**
 * The anchor is where the mascot lives. Every mode grows from it, and a mode that would leave the monitor is pushed back
 * in without moving the anchor, so collapsing returns the mascot to the exact spot the user left it.
 */
export function boundsForMode(anchor: Point | null, mode: CompanionHudMode, areas: readonly Rect[], primary: Rect): Rect {
  const start = anchor ?? defaultAnchor(primary);
  const size = HUD_SIZES[mode];
  const area = workAreaFor({ ...start, ...HUD_SIZES.mascot }, areas);
  return { ...clampToArea(start, size, area), ...size };
}

export type HudSide = CompanionHudLayout['side'];
export interface HudStage { bounds: Rect; layout: Omit<CompanionHudLayout, 'origin'>; }

/**
 * The window never changes with the mode: it is a click-through stage the size of the panel, and every shape animates
 * inside it. Moving a window and repainting it are not atomic, which is what made the mascot teleport at a screen edge.
 */
export function hudStage(anchor: Point | null, areas: readonly Rect[], primary: Rect, align: HudSide = 'left'): HudStage {
  const start = anchor ?? defaultAnchor(primary);
  const inset = HUD_SIZES.expanded.width - HUD_SIZES.mascot.width;
  const area = workAreaFor({ ...start, ...HUD_SIZES.mascot }, areas);
  const bounds = { ...clampToArea(align === 'right' ? { x: start.x - inset, y: start.y } : start, HUD_SIZES.expanded, area), ...HUD_SIZES.expanded };
  const placed = clampToArea(start, HUD_SIZES.mascot, area);
  const mascot = { x: placed.x - bounds.x, y: placed.y - bounds.y };
  const reach = HUD_SIZES.compact.width - HUD_SIZES.mascot.width;
  const roomRight = mascot.x + HUD_SIZES.compact.width <= HUD_SIZES.expanded.width; const roomLeft = mascot.x >= reach;
  const side = align === 'right' ? (roomLeft ? 'right' : 'left') : (roomRight ? 'left' : 'right');
  const compactX = side === 'right' ? mascot.x - reach : mascot.x;
  return { bounds, layout: { mascot, compact: { x: Math.min(Math.max(compactX, 0), HUD_SIZES.expanded.width - HUD_SIZES.compact.width), y: mascot.y }, side } };
}

/** The anchor whose stage is exactly where the panel was dropped, with the mascot still at the end it was on. */
export function anchorForDrop(dropped: Point, align: HudSide): Point {
  return { x: align === 'right' ? dropped.x + HUD_SIZES.expanded.width - HUD_SIZES.mascot.width : dropped.x, y: dropped.y };
}
