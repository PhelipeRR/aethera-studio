import type { Transition } from 'motion/react';
import type { CompanionHudLayout, CompanionHudMode } from '@neuralbridge/shared/companion';

/** The one place the HUD's movement is tuned. Springs carry anything that travels; times carry what only appears. */
export const HUD_SPRING = {
  expand: { stiffness: 260, damping: 28, mass: 1 },
  collapse: { stiffness: 300, damping: 32, mass: 1 },
  impulse: { stiffness: 420, damping: 18, mass: .8 },
} as const;
export const HUD_MS = { hover: 180, micro: 150, content: 220, session: 280, face: 140 } as const;

export interface HudTargets {
  shell: { x: number; y: number; width: number; height: number; radius: number; surface: number };
  mascot: { x: number; y: number; scale: number };
}

export interface BubblePlacement { opens: 'up' | 'down'; side: CompanionHudLayout['side']; vertical: number; horizontal: number; }

const MODE_ORDER: Record<CompanionHudMode, number> = { mascot: 0, compact: 1, expanded: 2 };
const MASCOT_WIDTH = 104;
const PANEL_MASCOT_WIDTH = 84;
const COMPACT_WIDTH = 430;
const STAGE_WIDTH = 820;
const MAX_TILT_DEGREES = 3;
const TILT_PER_VELOCITY = .0015;
const MAX_GLIDE_MS = 2000;
const STAGE_HEIGHT = 440;
const MASCOT_BOX_WIDTH = 132;
const MASCOT_BOX_HEIGHT = 124;
const BUBBLE_ROOM = 180;
const BUBBLE_MARGIN = 8;

/** Where every mode sits on the stage. The insets leave the margin the glow and the mascot's overhang need. */
export function hudTargets(layout: CompanionHudLayout, mode: CompanionHudMode): HudTargets {
  const right = layout.side === 'right';
  if (mode === 'mascot') return {
    shell: { x: layout.mascot.x + 10, y: layout.mascot.y + 10, width: 112, height: 104, radius: 52, surface: 0 },
    mascot: { x: layout.mascot.x + 14, y: layout.mascot.y + 12, scale: 1 },
  };
  if (mode === 'compact') return {
    shell: { x: layout.compact.x + 12, y: layout.compact.y + 24, width: 406, height: 80, radius: 40, surface: 1 },
    mascot: { x: layout.compact.x + (right ? COMPACT_WIDTH - 18 - MASCOT_WIDTH : 18), y: layout.compact.y + 16, scale: 1 },
  };
  return {
    shell: { x: 12, y: 12, width: 796, height: 416, radius: 26, surface: 1 },
    mascot: { x: right ? STAGE_WIDTH - 28 - PANEL_MASCOT_WIDTH : 28, y: 22, scale: PANEL_MASCOT_WIDTH / MASCOT_WIDTH },
  };
}

export function hudTransition(from: CompanionHudMode, to: CompanionHudMode, reduced: boolean): Transition {
  if (reduced) return { duration: 0 };
  return { type: 'spring', ...(MODE_ORDER[to] >= MODE_ORDER[from] ? HUD_SPRING.expand : HUD_SPRING.collapse) };
}

/** The bubble grows out of the mascot: up when there is room above it, from the edge of the stage the mascot is on. */
export function bubblePlacement({ mascot, side }: CompanionHudLayout): BubblePlacement {
  const up = mascot.y >= BUBBLE_ROOM;
  const fromEdge = side === 'right' ? STAGE_WIDTH - mascot.x - MASCOT_BOX_WIDTH : mascot.x;
  return { opens: up ? 'up' : 'down', side, vertical: up ? STAGE_HEIGHT - mascot.y : mascot.y + MASCOT_BOX_HEIGHT, horizontal: Math.max(BUBBLE_MARGIN, fromEdge) };
}

/** Degrees of lean for a horizontal speed in px/s. The window itself never lags the cursor; only the mascot leans. */
export function dragTilt(velocityX: number): number {
  return Math.max(-MAX_TILT_DEGREES, Math.min(MAX_TILT_DEGREES, velocityX * TILT_PER_VELOCITY));
}

/** A seek or a track change must land at once: only the steady passing of time may glide. */
export function followsPlayback(previousMs: number, nextMs: number, isPlaying: boolean): boolean {
  return isPlaying && nextMs >= previousMs && nextMs - previousMs <= MAX_GLIDE_MS;
}

/** In viewBox units: the head is 220 wide, so this is a glance, not a roll. */
const GAZE_X = 8;
const GAZE_Y = 5;
const GAZE_REACH_PX = 240;

/** Where the face looks: toward the pointer, at full reach only once the pointer is well away from the mascot. */
export function gazeOffset(center: { x: number; y: number }, cursor: { x: number; y: number }): { x: number; y: number } {
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  const reach = Math.min(1, distance / GAZE_REACH_PX);
  return { x: Math.round((dx / distance) * reach * GAZE_X * 10) / 10, y: Math.round((dy / distance) * reach * GAZE_Y * 10) / 10 };
}

/** One bounce per beat, started so the bounce lands where the track is now. Null when the tempo is unknown. */
export function danceTiming(playback: { tempoBpm?: number | null | undefined; progressMs: number; sampledAt: number } | null, nowMs: number): { beatMs: number; delayMs: number } | null {
  if (!playback?.tempoBpm) return null;
  const beatMs = Math.round(60_000 / playback.tempoBpm);
  const position = playback.progressMs + Math.max(0, nowMs - playback.sampledAt);
  return { beatMs, delayMs: -(position % beatMs) };
}

export function nextBlinkDelay(random: number): number { return 2400 + random * 4600; }

/** RMS of an analyser's time-domain bytes, where 128 is silence. */
export function speechLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length));
}
