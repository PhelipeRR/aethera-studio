import * as React from 'react';
import type { GalaxyGroup } from './galaxy-layout';
import { GalaxyScene, type SceneStats } from './galaxy-scene';

/*
 * The WebGL viewport of the Memory Galaxy (lote 50.06). It owns the three.js scene and the group labels; the page
 * owns the data and decisions. Keyboard: ←/→ step through the visible stars, Enter selects, + and - zoom,
 * Q/E rotate, R resets the view, Esc clears the selection.
 */

export interface GalaxyViewHandle {
  focusStar: (index: number) => void;
  focusPoint: (point: [number, number, number]) => void;
  resetView: () => void;
  zoom: (factor: number) => void;
  stats: () => SceneStats | null;
  /** Lights stars that were really retrieved (lote 50.07). */
  pulse: (indices: readonly number[]) => void;
}

interface GalaxyViewProps {
  positions: Float32Array;
  colours: Float32Array;
  sizes: Float32Array;
  states: Float32Array;
  links: readonly (readonly [number, number])[];
  showLinks: boolean;
  autoRotate: boolean;
  reducedMotion: boolean;
  groups: readonly GalaxyGroup[];
  groupColours: readonly string[];
  /** Visible stars in keyboard order. */
  keyboardOrder: readonly number[];
  activeIndex: number | null;
  label: string;
  onSelect: (index: number | null) => void;
  onHover: (index: number | null) => void;
  onKeyboardStep: (index: number) => void;
  onFirstStars: (at: number) => void;
}

export const GalaxyView = React.forwardRef<GalaxyViewHandle, GalaxyViewProps>(function GalaxyView(props, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sceneRef = React.useRef<GalaxyScene | null>(null);
  const labelRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const callbacks = React.useRef(props);
  React.useLayoutEffect(() => { callbacks.current = props; });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new GalaxyScene(canvas, {
      reducedMotion: callbacks.current.reducedMotion,
      onPick: (index) => callbacks.current.onSelect(index),
      onHover: (index) => callbacks.current.onHover(index),
      onFirstStars: (at) => callbacks.current.onFirstStars(at),
    });
    sceneRef.current = scene;
    return () => { scene.dispose(); sceneRef.current = null; };
  }, []);

  React.useEffect(() => { sceneRef.current?.setStars(props.positions, props.colours, props.sizes); }, [props.positions, props.colours, props.sizes]);
  React.useEffect(() => { sceneRef.current?.setStates(props.states); }, [props.states, props.positions]);
  React.useEffect(() => { sceneRef.current?.setLinks(props.links, props.showLinks); }, [props.links, props.showLinks, props.positions]);
  React.useEffect(() => { sceneRef.current?.setAutoRotate(props.autoRotate); }, [props.autoRotate]);
  React.useEffect(() => { sceneRef.current?.setReducedMotion(props.reducedMotion); }, [props.reducedMotion]);
  React.useEffect(() => {
    const anchors = props.groups.flatMap((group, i) => {
      const element = labelRefs.current[i];
      return element ? [{ point: group.center, element }] : [];
    });
    sceneRef.current?.setLabelAnchors(anchors);
  }, [props.groups]);

  React.useImperativeHandle(ref, () => ({
    focusStar: (index) => sceneRef.current?.focus(index),
    focusPoint: (point) => sceneRef.current?.focusPoint(point),
    resetView: () => sceneRef.current?.resetView(),
    zoom: (factor) => sceneRef.current?.zoom(factor),
    stats: () => sceneRef.current?.stats() ?? null,
    pulse: (indices) => sceneRef.current?.pulse(indices),
  }), []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const scene = sceneRef.current;
    const order = props.keyboardOrder;
    const step = (delta: number) => {
      if (order.length === 0) return;
      const at = props.activeIndex === null ? -1 : order.indexOf(props.activeIndex);
      const next = order[(at + delta + order.length) % order.length];
      if (next === undefined) return;
      props.onKeyboardStep(next);
      scene?.focus(next);
    };
    const keys: Record<string, () => void> = {
      ArrowRight: () => step(1),
      ArrowDown: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowUp: () => step(-1),
      Enter: () => { if (props.activeIndex !== null) props.onSelect(props.activeIndex); },
      '+': () => scene?.zoom(0.8),
      '=': () => scene?.zoom(0.8),
      '-': () => scene?.zoom(1.25),
      q: () => scene?.orbit(0.25),
      e: () => scene?.orbit(-0.25),
      r: () => scene?.resetView(),
      Escape: () => props.onSelect(null),
    };
    const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div
      role="application"
      aria-roledescription="galáxia 3D"
      aria-label={props.label}
      aria-describedby="galaxy-keyboard-help"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0" aria-hidden="false">
        {props.groups.map((group, i) => (
          <button
            key={group.id}
            ref={(element) => { labelRefs.current[i] = element; }}
            type="button"
            tabIndex={-1}
            onClick={() => sceneRef.current?.focusPoint(group.center)}
            className="pointer-events-auto absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--glass-border)] bg-[color-mix(in_srgb,#03100f_70%,transparent)] px-2.5 py-1 text-left whitespace-nowrap backdrop-blur-sm transition-opacity duration-[var(--motion-base)] hover:border-[var(--glass-border-strong)]"
            style={{ willChange: 'transform' }}
            title={`Ir para ${group.label}`}
          >
            <span className="flex items-center gap-1.5 text-[11px] text-[#ece7da]">
              <span className="size-1.5 rounded-full" style={{ background: props.groupColours[i] }} aria-hidden="true" />
              {group.label}
              <span className="text-[#a9b4b0] tabular-nums">{group.count.toLocaleString('pt-BR')}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
});
