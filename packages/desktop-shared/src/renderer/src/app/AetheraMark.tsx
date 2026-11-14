import { useId } from 'react';

/*
 * R1 — the Aethera mark, drawn to match the approved reference screen (docs/assets/aethera/reference-aethera-screen.webp):
 * a cinematic aperture whose six gold blades swirl around a large dark centre (the Void's horizon black), with shaded
 * wedges between them and a thin gold ring. Colours are the Singularity gold and black, not a second design system.
 *
 * - `full`: 32 px and up (page signature).
 * - `small`: below 32 px: the blades drop out; gold ring and black core remain.
 * - `mono`: one colour, `currentColor` (menus, tray, embossing).
 * - The menu icon (line work, 24 grid) is `aethera-nav-icon.ts`.
 */

const C = 32;
const GOLD = '#d9b875';
const HORIZON = '#010304';
const INNER = 14.5;
const OUTER = 26.6;

const point = (radius: number, degrees: number) => {
  const rad = (degrees * Math.PI) / 180;
  return `${(C + radius * Math.cos(rad)).toFixed(2)} ${(C + radius * Math.sin(rad)).toFixed(2)}`;
};

// Each blade is a curved ribbon: it leaves the dark centre and sweeps clockwise out to the rim.
export const AETHERA_BLADES = Array.from({ length: 6 }, (_, index) => {
  const a = index * 60 - 80;
  return `M ${point(INNER, a)} A ${INNER} ${INNER} 0 0 1 ${point(INNER, a + 34)} Q ${point(OUTER * 0.8, a + 62)} ${point(OUTER, a + 104)} A ${OUTER} ${OUTER} 0 0 0 ${point(OUTER, a + 78)} Q ${point(OUTER * 0.7, a + 30)} ${point(INNER, a)} Z`;
});

type MarkVariant = 'full' | 'small' | 'mono';

export function AetheraMark({ variant = 'full', className, label }: { variant?: MarkVariant; className?: string; label?: string }) {
  // Gradient ids must be unique per instance: several marks can be on screen at once.
  const id = useId().replace(/:/g, '');
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  if (variant === 'mono') {
    return (
      <svg viewBox="0 0 64 64" className={className} data-variant="mono" {...a11y}>
        <circle cx={C} cy={C} r="27" fill="none" stroke="currentColor" strokeWidth="6" />
        <circle cx={C} cy={C} r="12" fill="currentColor" />
      </svg>
    );
  }
  const defs = (
    <defs>
      <linearGradient id={`${id}-ring`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#f7dc98" />
        <stop offset="0.5" stopColor={GOLD} />
        <stop offset="1" stopColor="#9a6d27" />
      </linearGradient>
      <linearGradient id={`${id}-blade`} x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#f6d896" />
        <stop offset="0.45" stopColor={GOLD} />
        <stop offset="1" stopColor="#9b6f2a" />
      </linearGradient>
      <radialGradient id={`${id}-wedge`}>
        <stop offset="0.4" stopColor={HORIZON} />
        <stop offset="1" stopColor="#3a3016" />
      </radialGradient>
    </defs>
  );
  if (variant === 'small') {
    return (
      <svg viewBox="0 0 64 64" className={className} data-variant="small" {...a11y}>
        {defs}
        <circle cx={C} cy={C} r="13" fill={HORIZON} />
        <circle cx={C} cy={C} r="27" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" className={className} data-variant="full" {...a11y}>
      {defs}
      <circle cx={C} cy={C} r="28" fill={`url(#${id}-wedge)`} />
      {AETHERA_BLADES.map((d, index) => (
        <path key={index} d={d} fill={`url(#${id}-blade)`} stroke="#2b2410" strokeWidth="0.6" strokeLinejoin="round" />
      ))}
      <circle cx={C} cy={C} r={INNER} fill={HORIZON} />
      <circle cx={C} cy={C} r="28.6" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="2.2" />
    </svg>
  );
}

/**
 * Signature: mark + AETHERA + "AI Cinematic Studio", on the same typographic rule as SINGULARITY / AI ORCHESTRATOR.
 * The heading keeps its accessible name "Aethera"; the capitals are only visual.
 */
export function AetheraSignature({ as: Heading = 'h1' }: { as?: 'h1' | 'h2' | 'p' }) {
  return (
    <div className="flex items-center gap-4">
      <AetheraMark className="size-14 shrink-0 sm:size-20" />
      <div className="min-w-0 [text-shadow:0_1px_10px_rgb(1_3_4/0.95)]">
        <Heading className="text-[1.75rem] font-light uppercase leading-none tracking-[0.32em] text-foreground sm:text-[2.25rem]">Aethera</Heading>
        <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.42em] text-primary sm:text-xs">AI Cinematic Studio</p>
      </div>
    </div>
  );
}
