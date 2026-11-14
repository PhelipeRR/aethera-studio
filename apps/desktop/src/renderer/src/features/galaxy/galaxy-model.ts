// Pure helpers between the galaxy snapshot and the scene (lote 50.06): colours, sizes, filter states and
// timeline events. No React, no three.js, so they are unit-tested in node.
import type { GalaxyMemory } from '@neuralbridge/shared/brain3d';
import type { MemoryType } from '@neuralbridge/shared/domain';
import type { TimelineEvent } from '../../components/shell/timeline-model';
import type { GalaxyGroup, GroupMode } from './galaxy-layout';

/** Dark-theme --type-* tokens (styles.css). The galaxy viewport is always dark space, in both themes. */
export const TYPE_COLOUR: Record<MemoryType, string> = {
  decision: '#7f9fe0',
  code_pattern: '#8fc07a',
  project_context: '#ad94e0',
  bug_fix: '#e58896',
  learning: '#d9b875',
  preference: '#6fbfd6',
  documentation: '#a3aeb4',
  execution_summary: '#e39a68',
};

/** Arms by project or meaning: gold, sea-glass and warm neutrals, no saturated purple or blue. */
export const GROUP_PALETTE = ['#d9b875', '#86c5a4', '#e39a68', '#9fd0c9', '#f1e6c8', '#c9a86a', '#7fb3a8', '#e8c48f', '#b8c7b0', '#d79a7c'] as const;

export function groupColour(mode: GroupMode, group: GalaxyGroup, index: number): string {
  if (mode === 'type' && group.id in TYPE_COLOUR) return TYPE_COLOUR[group.id as MemoryType];
  if (group.id === '__none' || group.id === '__other') return '#8a9693';
  return GROUP_PALETTE[index % GROUP_PALETTE.length] ?? GROUP_PALETTE[0];
}

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Star colours: the group colour lifted towards warm white, so the galaxy reads as one body of light. */
export function starColours(group: Uint16Array, groups: readonly GalaxyGroup[], mode: GroupMode): Float32Array {
  const palette = groups.map((entry, index) => rgb(groupColour(mode, entry, index)));
  const warm = rgb('#fff1d6');
  const out = new Float32Array(group.length * 3);
  for (let i = 0; i < group.length; i++) {
    const base = palette[(group[i] ?? 0)] ?? warm;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = (base[c] ?? 0) * 0.62 + (warm[c] ?? 0) * 0.38;
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;

/** Brighter when recent or validated, dimmer when stale or rejected. Size in pixels. */
export function starSizes(memories: readonly GalaxyMemory[], now: Date): Float32Array {
  const out = new Float32Array(memories.length);
  memories.forEach((memory, i) => {
    let size = 4.6;
    const age = now.getTime() - new Date(memory.updatedAt).getTime();
    if (Number.isFinite(age) && age <= 7 * DAY) size += 1.8;
    if (memory.confidence === 'reviewed') size += 0.6;
    if (memory.confidence === 'stale') size -= 0.7;
    if (memory.trust === 'rejected') size = 2.8;
    out[i] = size;
  });
  return out;
}

export type Period = 'all' | '7d' | '30d' | '90d';
export const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface GalaxyFilters {
  project: 'all' | 'global' | (string & {});
  type: MemoryType | 'all';
  period: Period;
}

export const NO_FILTERS: GalaxyFilters = { project: 'all', type: 'all', period: 'all' };

export function matchesFilters(memory: GalaxyMemory, filters: GalaxyFilters, now: Date): boolean {
  if (filters.project === 'global' && memory.projectId !== null) return false;
  if (filters.project !== 'all' && filters.project !== 'global' && memory.projectId !== filters.project) return false;
  if (filters.type !== 'all' && memory.type !== filters.type) return false;
  if (filters.period !== 'all') {
    const age = now.getTime() - new Date(memory.updatedAt).getTime();
    if (!(age <= PERIOD_DAYS[filters.period] * DAY)) return false;
  }
  return true;
}

/**
 * Per-star state for the shader: dimmed when filtered out (or not a search hit while searching), match for search
 * hits, then selected and hovered on top.
 */
export function starStates(memories: readonly GalaxyMemory[], input: { filters: GalaxyFilters; hits: ReadonlySet<string> | null; selected: string | null; hovered: string | null; now: Date }): Float32Array {
  const out = new Float32Array(memories.length);
  memories.forEach((memory, i) => {
    let state = 0;
    if (!matchesFilters(memory, input.filters, input.now)) state = -1;
    else if (input.hits) state = input.hits.has(memory.id) ? 1 : -1;
    if (memory.id === input.selected) state = 2;
    else if (memory.id === input.hovered && state !== -1) state = 3;
    out[i] = state;
  });
  return out;
}

export function visibleCount(states: Float32Array): number {
  let count = 0;
  for (const state of states) if (state > -0.5) count++;
  return count;
}

/** Today's memory events: created, or updated after being created on another day. Real timestamps only. */
export function memoryEvents(memories: readonly GalaxyMemory[], now: Date): TimelineEvent[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = (iso: string) => { const time = new Date(iso).getTime(); return time >= start.getTime() && time < start.getTime() + DAY; };
  const events: TimelineEvent[] = [];
  for (const memory of memories) {
    if (today(memory.createdAt)) events.push({ id: `created-${memory.id}`, at: memory.createdAt, label: memory.title, detail: 'Memória criada', tone: 'ok', href: `/memory/galaxy?m=${encodeURIComponent(memory.id)}` });
    else if (today(memory.updatedAt)) events.push({ id: `updated-${memory.id}`, at: memory.updatedAt, label: memory.title, detail: 'Memória atualizada', tone: 'unknown', href: `/memory/galaxy?m=${encodeURIComponent(memory.id)}` });
  }
  return events;
}

/** Stored links as index pairs of the snapshot. */
export function linkPairs(memories: readonly GalaxyMemory[], links: readonly { sourceId: string; targetId: string }[]): [number, number][] {
  const index = new Map(memories.map((memory, i) => [memory.id, i]));
  return links.flatMap((link) => {
    const a = index.get(link.sourceId);
    const b = index.get(link.targetId);
    return a === undefined || b === undefined ? [] : [[a, b] as [number, number]];
  });
}

/** Links to draw: all stored links when asked for, else only those touching the focused star (selected or hovered). */
export function visibleLinks(pairs: readonly [number, number][], showAll: boolean, focus: readonly (number | null)[]): [number, number][] {
  if (showAll) return [...pairs];
  const wanted = new Set(focus.filter((index): index is number => index !== null));
  if (wanted.size === 0) return [];
  return pairs.filter(([a, b]) => wanted.has(a) || wanted.has(b));
}
