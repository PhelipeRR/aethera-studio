import * as React from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';
import { dragTilt } from './companion-motion';

const DRAG_THRESHOLD_PX = 4;
const NOT_DRAGGABLE = 'button:not([data-hud-drag]), a, input, ol, [data-hud-scroll]';

/**
 * Keeps the transparent margins of the window click-through: the main process ignores the mouse by default and
 * forwards moves, and this reports whether the pointer is over something solid. Reports only on change, so a
 * pointer moving across the HUD costs no IPC.
 */
export function useHudClickThrough(locked: React.RefObject<boolean>): () => void {
  const recheck = React.useRef<() => void>(() => undefined);
  React.useEffect(() => {
    let interactive = false;
    const report = (next: boolean) => {
      if (next === interactive) return;
      interactive = next;
      void window.neuralbridge.companion.setHudInteractive(next);
    };
    let pointer: { x: number; y: number } | null = null;
    const check = () => { if (pointer && !locked.current) report(document.elementFromPoint(pointer.x, pointer.y)?.closest('[data-hud-hit]') != null); };
    recheck.current = check;
    const onMove = (event: MouseEvent) => { pointer = { x: event.clientX, y: event.clientY }; check(); };
    const onLeave = () => { pointer = null; if (!locked.current) report(false); };
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      report(false);
    };
  }, [locked]);
  /** A shape that shrank away from a still pointer has to let go of it too: no mouse move will say so. */
  return React.useCallback(() => recheck.current(), []);
}

/**
 * Custom drag instead of -webkit-app-region: a native drag region swallows the click that opens the HUD, and the mascot
 * must do both. Only phases cross the IPC boundary; the main process reads the cursor, which also keeps this DPI-safe.
 */
export function useHudDrag(): { dragging: React.RefObject<boolean>; held: boolean; tilt: MotionValue<number>; handlers: Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture'> } {
  const origin = React.useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragging = React.useRef(false);
  const suppressClick = React.useRef(false);
  const frame = React.useRef<number | undefined>(undefined);
  const lastMove = React.useRef<{ x: number; at: number } | null>(null);
  const tilt = useMotionValue(0);
  const [held, setHeld] = React.useState(false);

  const finish = React.useCallback(() => {
    origin.current = null;
    if (frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined; }
    lastMove.current = null;
    tilt.set(0);
    if (dragging.current) { dragging.current = false; setHeld(false); void window.neuralbridge.companion.dragHud('end'); }
  }, [tilt]);
  React.useEffect(() => finish, [finish]);

  return { dragging, held, tilt, handlers: {
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as Element).closest(NOT_DRAGGABLE)) return;
      origin.current = { x: event.screenX, y: event.screenY, pointerId: event.pointerId };
      suppressClick.current = false;
    },
    onPointerMove: (event) => {
      const start = origin.current;
      if (!start) return;
      if (!dragging.current) {
        if (Math.hypot(event.screenX - start.x, event.screenY - start.y) < DRAG_THRESHOLD_PX) return;
        dragging.current = true;
        setHeld(true);
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(start.pointerId);
        void window.neuralbridge.companion.dragHud('start');
      }
      const last = lastMove.current;
      if (last && event.timeStamp > last.at) tilt.set(dragTilt((event.screenX - last.x) / (event.timeStamp - last.at) * 1000));
      lastMove.current = { x: event.screenX, at: event.timeStamp };
      frame.current ??= requestAnimationFrame(() => { frame.current = undefined; void window.neuralbridge.companion.dragHud('move'); });
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onClickCapture: (event) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  } };
}
