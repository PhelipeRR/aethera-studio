import { createElement, type SVGProps } from 'react';

/**
 * R1: the Aethera mark as a menu icon, on the 24 grid like the Lucide icons (stroke 2, currentColor): gold ring, black
 * core and the eclipse bead reduced to line work, so it takes the menu's active and hover colours. Plain TypeScript (no
 * JSX) because routes.ts, which uses it, is also compiled by the Node-side tests.
 */
export function AetheraNavIcon(props: SVGProps<SVGSVGElement>) {
  return createElement(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'data-icon': 'aethera', ...props },
    // The ring opens where the bead sits (upper right), so the eclipse's last light stays legible at 16 px.
    createElement('path', { d: 'M 19.99 9.09 A 8.5 8.5 0 1 1 14.91 4.01' }),
    createElement('circle', { cx: 12, cy: 12, r: 3, fill: 'currentColor', stroke: 'none' }),
    createElement('circle', { cx: 18.01, cy: 5.99, r: 1.9, fill: 'currentColor', stroke: 'none' }),
  );
}
