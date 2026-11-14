import * as React from 'react';
import { animate } from 'motion/react';
import type { MascotState } from './companion-state';
import { gazeOffset, HUD_SPRING, nextBlinkDelay } from './companion-motion';

const DOUBLE_BLINK_CHANCE = .12;
const BLINK_MS = 150;
const GLANCE_PX = 2;
const GLANCE_MS = 520;
const GLANCE_PAUSE_MIN_MS = 800;
const GLANCE_PAUSE_SPAN_MS = 1400;
const IMPULSE_VELOCITY = 220;

/** Faces with open eyes; the others draw closed or squinting eyes, which have nowhere to look. */
const GAZING = new Set<MascotState>(['idle', 'voiceListening', 'speaking', 'waiting']);
const GAZE_REST_MS = 2_500;
const WAKE_JUMP_VELOCITY = 320;
const WAKE_FRAMES = [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }];
const WAKE_MS = 420;

const BLINK_FRAMES = [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.08)' }, { transform: 'scaleY(1)' }];

/**
 * What a loop of keyframes cannot do: blinks and glances at irregular moments, and a single push for a reaction. It stops
 * entirely while the HUD is hidden or motion is reduced, so an unseen mascot costs no timer.
 */
export function useMascotLife(ref: React.RefObject<SVGSVGElement | null>, state: MascotState, active: boolean): void {
  React.useEffect(() => {
    const svg = ref.current;
    if (!svg || !active) return;
    let timer: number | undefined;
    const blink = () => { for (const eye of svg.querySelectorAll('.nb-mascot__eye')) eye.animate(BLINK_FRAMES, { duration: BLINK_MS, easing: 'ease-in-out' }); };
    const schedule = () => {
      timer = window.setTimeout(() => {
        blink();
        if (Math.random() < DOUBLE_BLINK_CHANCE) window.setTimeout(blink, BLINK_MS * 1.6);
        schedule();
      }, nextBlinkDelay(Math.random()));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [ref, active]);

  React.useEffect(() => {
    const face = ref.current?.querySelector('.nb-mascot__face');
    if (!face || !active || state !== 'thinking') return;
    let timer: number | undefined;
    let side = 1;
    const glance = () => {
      side = -side;
      face.animate([{ transform: `translateX(${-side * GLANCE_PX}px)` }, { transform: `translateX(${side * GLANCE_PX}px)` }], { duration: GLANCE_MS, easing: 'ease-in-out', fill: 'forwards' });
      timer = window.setTimeout(glance, GLANCE_MS + GLANCE_PAUSE_MIN_MS + Math.random() * GLANCE_PAUSE_SPAN_MS);
    };
    glance();
    return () => { window.clearTimeout(timer); for (const animation of face.getAnimations()) animation.cancel(); };
  }, [ref, state, active]);

  React.useEffect(() => {
    const figure = ref.current?.querySelector<SVGGElement>('.nb-mascot__figure');
    if (!figure || !active || (state !== 'success' && state !== 'error')) return;
    const axis = state === 'success' ? 'Y' : 'X';
    const controls = animate(0, 0, { type: 'spring', ...HUD_SPRING.impulse, velocity: -IMPULSE_VELOCITY, onUpdate: (value) => { figure.style.transform = `translate${axis}(${value}px)`; }, onComplete: () => { figure.style.transform = ''; } });
    return () => { controls.stop(); figure.style.transform = ''; };
  }, [ref, state, active]);

  React.useEffect(() => {
    const svg = ref.current;
    const face = svg?.querySelector<SVGGElement>('.nb-mascot__face');
    if (!svg || !face || !active || !GAZING.has(state)) return;
    let rest: number | undefined;
    const stop = window.neuralbridge.companion.onCursor((cursor) => {
      const box = svg.getBoundingClientRect();
      const { x, y } = gazeOffset({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, cursor);
      face.style.translate = `${x}px ${y}px`;
      window.clearTimeout(rest);
      rest = window.setTimeout(() => { face.style.translate = ''; }, GAZE_REST_MS);
    });
    return () => { stop(); window.clearTimeout(rest); face.style.translate = ''; };
  }, [ref, state, active]);
}

/** Being called gets a little jump and wide eyes, so the wake word reads at a glance as well as by ear. */
export function useMascotWake(ref: React.RefObject<SVGSVGElement | null>, wakes: number, active: boolean): void {
  React.useEffect(() => {
    const figure = ref.current?.querySelector<SVGGElement>('.nb-mascot__figure');
    const face = ref.current?.querySelector('.nb-mascot__face');
    if (!wakes || !figure || !face || !active) return;
    face.animate(WAKE_FRAMES, { duration: WAKE_MS, easing: 'ease-out' });
    const controls = animate(0, 0, { type: 'spring', ...HUD_SPRING.impulse, velocity: -WAKE_JUMP_VELOCITY, onUpdate: (value) => { figure.style.transform = `translateY(${value}px)`; }, onComplete: () => { figure.style.transform = ''; } });
    return () => { controls.stop(); figure.style.transform = ''; };
  }, [ref, wakes, active]);
}
