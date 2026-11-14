import * as React from 'react';
import { AnimatePresence, m } from 'motion/react';
import voidDisk from '@/assets/void/void-disk-480.webp';
import { subscribeSpeech } from '../neura/useNeura';
import { danceTiming, HUD_MS } from './companion-motion';
import { MASCOT_LABELS, type MascotState } from './companion-state';
import { useMascotLife, useMascotWake } from './useMascotLife';

/*
 * Void, the Singularity companion (lote 50.04). The accretion disk is the artwork of the user's reference sheet
 * (docs/assets/singularity/reference-void-mascot.webp), extracted by scripts/extract-void-mascot.mjs with the painted
 * face removed. Layers: an opaque black event horizon, the disk artwork (whose near side crosses in front of the
 * horizon), and a glowing vector face that changes with the Companion's real state. Class names (figure, head,
 * face, eye, blink, mouth, accent) are the ones the motion hooks and CSS animate.
 */

const GLOW = '#ffcf6a';
const SLEEP = '#5eead4';
const ALERT = '#ffb199';

/** Filled crescent eye (◠), the reference's look. `lift` bends it; the right eye is smaller for the 3D tilt. */
function crescent(cx: number, cy: number, w: number, lift: number, color = GLOW) {
  return <path className="nb-mascot__eye" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} d={`M${cx - w} ${cy} Q${cx} ${cy - lift * 2.9} ${cx + w} ${cy} Q${cx} ${cy - lift * 1.3} ${cx - w} ${cy} Z`} fill={color} />;
}
/** Closed sleeping eye (◡). */
function closed(cx: number, cy: number, w: number, color = SLEEP) {
  return <path d={`M${cx - w} ${cy} Q${cx} ${cy + w * 0.55} ${cx + w} ${cy}`} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" />;
}
/** Narrow slanted eye: focused (inner end lower) or angry (inner end higher). */
function slant(cx: number, cy: number, w: number, tilt: number, color = GLOW) {
  return <path className="nb-mascot__eye" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} d={`M${cx - w} ${cy - tilt} Q${cx} ${cy - 16} ${cx + w} ${cy + tilt} Q${cx} ${cy + 10} ${cx - w} ${cy - tilt} Z`} fill={color} />;
}
const dot = (cx: number, cy: number, r: number, color = GLOW) => <circle className="nb-mascot__eye" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} cx={cx} cy={cy} r={r} fill={color} />;
const smile = (color = GLOW) => <path d="M398 328 Q422 352 452 326 Q424 340 398 328 Z" fill={color} />;

// Eye centres on the horizon, matched to the reference (left eye larger, right eye higher and smaller).
const L = { x: 345, y: 286 };
const R = { x: 494, y: 252 };

function Face({ state }: { state: MascotState }) {
  switch (state) {
    case 'voiceListening': return <>{dot(L.x, L.y - 8, 20)}{dot(R.x, R.y - 6, 16)}</>;
    case 'speaking': return <>{crescent(L.x, L.y, 46, 22)}{crescent(R.x, R.y, 34, 18)}<g className="nb-mascot__mouth" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}><ellipse cx="424" cy="336" rx="20" ry="13" fill={GLOW} /></g></>;
    case 'listening': return <>{crescent(L.x, L.y, 46, 24)}{crescent(R.x, R.y, 34, 19)}{smile()}</>;
    case 'musicPaused': return <>{closed(L.x, L.y - 8, 40, GLOW)}{closed(R.x, R.y - 8, 30, GLOW)}</>;
    case 'running': return <>{slant(L.x, L.y - 6, 44, 9)}{slant(R.x, R.y - 6, 32, -9)}</>;
    case 'thinking': return <>{crescent(L.x, L.y, 44, 16)}{dot(R.x, R.y - 6, 15)}</>;
    case 'resting': return <>{closed(L.x, L.y - 8, 40)}{closed(R.x, R.y - 8, 30)}</>;
    case 'waiting': return <>{dot(L.x, L.y - 10, 22)}{dot(R.x, R.y - 8, 18)}</>;
    case 'success': return <>{crescent(L.x, L.y, 46, 24)}{crescent(R.x, R.y, 34, 19)}{smile()}</>;
    case 'error': return <>{slant(L.x, L.y - 6, 44, -12, ALERT)}{slant(R.x, R.y - 6, 32, 12, ALERT)}</>;
    case 'disconnected': return <><path d={`M${L.x - 40} ${L.y - 8} H${L.x + 40} M${R.x - 30} ${R.y - 6} H${R.x + 30}`} stroke="#9aa9a5" strokeWidth="10" strokeLinecap="round" /></>;
    case 'degraded': return <>{dot(L.x, L.y - 8, 14, '#d9b875')}<path d={`M${R.x - 30} ${R.y - 6} H${R.x + 30}`} stroke="#d9b875" strokeWidth="10" strokeLinecap="round" /></>;
    default: return <><g className="nb-mascot__blink"><g className="nb-mascot__eye-open">{crescent(L.x, L.y, 46, 22)}{crescent(R.x, R.y, 34, 18)}</g></g><g className="nb-mascot__eye-wink">{crescent(L.x, L.y, 46, 22)}{closed(R.x, R.y - 8, 30, GLOW)}</g></>;
  }
}

/** Accents in the corner, as in the reference sheet: "?", "zZ", alert, check, notes, waves, work panels. */
function Accent({ state }: { state: MascotState }) {
  const stroke = (color: string, d: string, width = 6) => <path d={d} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={width} />;
  switch (state) {
    case 'voiceListening': return <g className="nb-mascot__accent nb-mascot__accent--pulse">{stroke('#5eead4', 'M196 84 Q206 104 196 124 M206 76 Q220 104 206 132', 4)}</g>;
    case 'listening': return <g className="nb-mascot__accent nb-mascot__accent--notes">{stroke(GLOW, 'M180 40 V16 L204 10 V34', 5)}<ellipse cx="174" cy="41" rx="7" ry="6" fill={GLOW} /><ellipse cx="198" cy="35" rx="7" ry="6" fill={GLOW} /></g>;
    case 'running': return <g className="nb-mascot__accent nb-mascot__accent--pulse">{stroke('#5eead4', 'M176 24 h18 M184 34 h18 M176 44 h12', 4)}<rect x="168" y="16" width="40" height="36" rx="6" fill="none" stroke="#5eead4" strokeOpacity=".7" strokeWidth="2" /></g>;
    case 'thinking': return <g className="nb-mascot__accent nb-mascot__accent--pulse">{stroke('#5eead4', 'M178 24 Q180 10 192 12 Q204 16 196 28 Q188 34 188 42', 6)}<circle cx="188" cy="54" r="4" fill="#5eead4" /></g>;
    case 'resting': return <g className="nb-mascot__accent nb-mascot__accent--drift">{stroke(SLEEP, 'M170 40 H180 L170 50 H180', 4)}{stroke(SLEEP, 'M186 22 H198 L186 34 H198', 4.5)}</g>;
    case 'waiting': return <g className="nb-mascot__accent nb-mascot__accent--pulse">{stroke(GLOW, 'M30 28 L42 42 M54 12 L57 30 M10 46 L28 50', 6)}</g>;
    case 'success': return <g className="nb-mascot__accent nb-mascot__accent--pop">{stroke('#34d399', 'M172 30 L182 42 L204 16', 7)}</g>;
    case 'error': return <g className="nb-mascot__accent nb-mascot__accent--pop"><path d="M186 10 L208 48 H164 Z" fill="none" stroke="#f87171" strokeLinejoin="round" strokeWidth="5" />{stroke('#f87171', 'M186 24 V34', 5)}<circle cx="186" cy="41" r="3" fill="#f87171" /></g>;
    case 'disconnected': return <g className="nb-mascot__accent">{stroke('#94a3b8', 'M162 40 Q186 16 210 40 M172 50 Q186 36 200 50', 5)}<circle cx="186" cy="60" r="4" fill="#94a3b8" />{stroke('#cbd5e1', 'M168 66 L206 18', 4)}</g>;
    case 'degraded': return <path className="nb-mascot__accent nb-mascot__accent--drip" d="M178 64 C170 78 166 84 166 90 a12 12 0 0 0 24 0 C190 84 186 78 178 64 Z" fill="#7dd3fc" stroke="#38bdf8" strokeWidth="2" />;
    default: return null;
  }
}

const FADE = { duration: HUD_MS.face / 1000 };

export function NeuralBridgeMascot({ state, label = 'Void', beat, active = true, wakes = 0, rhythm = null }: { state: MascotState; label?: string; beat?: string | null; active?: boolean; wakes?: number; rhythm?: { tempoBpm?: number | null | undefined; progressMs: number; sampledAt: number } | null }) {
  const svg = React.useRef<SVGSVGElement>(null);
  useMascotLife(svg, state, active);
  useMascotWake(svg, wakes, active);
  React.useEffect(() => {
    if (state !== 'speaking' || !active) return;
    // A style, not state: the voice changes every frame, and only the mouth has to follow it.
    return subscribeSpeech((level) => svg.current?.style.setProperty('--nb-mouth', String(level ?? 0)));
  }, [state, active]);
  // Computed when the track or tempo changes, not every render: a CSS animation restarted mid-beat would stutter.
  const tempoBpm = rhythm?.tempoBpm ?? null;
  const root = React.useRef<HTMLDivElement>(null);
  const progress = React.useRef(rhythm);
  React.useEffect(() => { progress.current = rhythm; });
  React.useEffect(() => {
    const node = root.current;
    if (!node) return;
    const dance = state === 'listening' && active ? danceTiming(progress.current ? { ...progress.current, tempoBpm } : null, Date.now()) : null;
    node.classList.toggle('nb-mascot--dancing', dance !== null);
    if (dance) { node.style.setProperty('--nb-beat', `${dance.beatMs}ms`); node.style.setProperty('--nb-beat-delay', `${dance.delayMs}ms`); }
  }, [state, active, tempoBpm, beat]);
  const id = React.useId().replaceAll(':', '');
  return <div ref={root} className={`nb-mascot nb-mascot--void nb-mascot--${state}`} data-mascot-state={state} role="img" aria-label={`${label}: ${MASCOT_LABELS[state]}`}>
    <svg ref={svg} viewBox="0 0 725 515" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        {/* The orbiting layer only shows the disk band, minus the part that passes behind the horizon. */}
        <clipPath id={`${id}-near`}><rect x="0" y="268" width="725" height="300" transform="rotate(-14 381 268)" /></clipPath>
        <mask id={`${id}-band`} maskUnits="userSpaceOnUse" x="0" y="0" width="725" height="515">
          <ellipse cx="381" cy="268" rx="372" ry="118" transform="rotate(-14 381 268)" fill="#fff" />
          <ellipse cx="381" cy="284" rx="178" ry="190" fill="#000" />
          <ellipse cx="381" cy="268" rx="372" ry="118" transform="rotate(-14 381 268)" fill="#fff" clipPath={`url(#${id}-near)`} />
        </mask>
      </defs>
      <g className="nb-mascot__figure">
        <g className="nb-mascot__head">
          {/* The event horizon: opaque, slightly smaller than the bright rim of the artwork. */}
          <ellipse className="nb-mascot__body" cx="381" cy="284" rx="174" ry="186" fill="#010304" />
          <image className="nb-void__art" href={voidDisk} x="0" y="0" width="725" height="515" preserveAspectRatio="xMidYMid meet" />
          {/* A copy of the disk turns in the disk's own tilted plane, so the plasma streaks travel along the orbit. */}
          <g mask={`url(#${id}-band)`}><image className="nb-void__orbit" href={voidDisk} x="0" y="0" width="725" height="515" preserveAspectRatio="xMidYMid meet" /></g>
          <g className="nb-mascot__face" filter={`url(#${id}-glow)`}><AnimatePresence initial={false}><m.g key={state} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}><Face state={state} /></m.g></AnimatePresence></g>
        </g>
      </g>
      {/* Accents use the Companion's original 220x190 grid, pinned to the top-right corner of the artwork. */}
      <svg x="0" y="0" width="725" height="515" viewBox="0 0 220 190" preserveAspectRatio="xMaxYMin meet" overflow="visible">
        {/* The key restarts the accent's entrance, which is how a real track change shows. */}
        <AnimatePresence initial={false}><m.g key={`${state}-${beat ?? ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}><Accent state={state} /></m.g></AnimatePresence>
      </svg>
    </svg>
  </div>;
}
