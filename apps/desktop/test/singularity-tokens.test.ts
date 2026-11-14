import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio as contrast } from '../src/renderer/src/lib/contrast.js';

// Lote 50.02: the Singularity tokens must meet WCAG 2.2 AA in both themes. Text pairs need 4.5:1; UI parts
// (focus ring, input border, status dots, agent/type hues used as marks) need 3:1 against their surface.
const css = readFileSync(join(__dirname, '../src/renderer/src/styles.css'), 'utf8');

function block(source: string, start: number): string {
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error('unbalanced block');
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9_-]+):\s*(#[0-9a-f]{6})\s*;/gi)) if (name && value) out[name] = value.toLowerCase();
  return out;
}

const dark = tokens(block(css, css.indexOf(':root')));
const lightMedia = css.indexOf('@media (prefers-color-scheme: light)');
const light = { ...dark, ...tokens(block(block(css, lightMedia), 0)) };

const SURFACES = ['background', 'sidebar', 'card', 'popover', 'secondary', 'accent'] as const;
const TEXT_ON_SURFACES = ['foreground', 'muted-foreground', 'primary', 'destructive', 'warning', 'success', 'info'] as const;
const MARKS = ['ring', 'input', 'agent-claude', 'agent-codex', 'type-decision', 'type-code_pattern', 'type-project_context', 'type-bug_fix', 'type-learning', 'type-preference', 'type-documentation', 'type-execution_summary'] as const;
const OWN_PAIRS = [
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['accent-foreground', 'accent'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['secondary-foreground', 'secondary'],
] as const;

describe.each([
  ['dark', dark],
  ['light', light],
])('Singularity tokens (%s)', (_theme, palette) => {
  const get = (name: string) => {
    const value = palette[name];
    if (!value) throw new Error(`token --${name} is missing`);
    return value;
  };

  it.each(OWN_PAIRS)('%s on %s reaches 4.5:1', (text, surface) => {
    expect(contrast(get(text), get(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_ON_SURFACES.flatMap((text) => SURFACES.map((surface) => [text, surface] as const)))('%s text on %s reaches 4.5:1', (text, surface) => {
    expect(contrast(get(text), get(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS.flatMap((mark) => ['background', 'card'].map((surface) => [mark, surface] as const)))('%s mark on %s reaches 3:1', (mark, surface) => {
    expect(contrast(get(mark), get(surface))).toBeGreaterThanOrEqual(3);
  });
});

describe('Singularity token sanity', () => {
  it('keeps every colour token of the dark theme in the light theme', () => {
    const lightOnly = tokens(block(block(css, lightMedia), 0));
    expect(Object.keys(dark).filter((name) => !(name in lightOnly))).toEqual([]);
  });

  it('uses the Singularity identity: petrol background, gold primary, Inter as the interface font', () => {
    const background = dark['background'] ?? '';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16)) as [number, number, number];
    expect(Math.max(r, g, b)).toBeLessThan(0x20);
    expect(g).toBeGreaterThan(r);
    expect(dark['primary']).toBe('#d9b875');
    expect(css).toMatch(/--font-sans:\s*'Inter Variable'/);
  });
});
