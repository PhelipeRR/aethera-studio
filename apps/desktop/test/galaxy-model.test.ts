import { describe, expect, it } from 'vitest';
import type { GalaxyMemory } from '@neuralbridge/shared/brain3d';
import { groupColour, linkPairs, matchesFilters, memoryEvents, NO_FILTERS, starColours, starSizes, starStates, TYPE_COLOUR, visibleCount } from '../src/renderer/src/features/galaxy/galaxy-model.js';

const now = new Date(2026, 10, 8, 20, 0);
const iso = (daysAgo: number, hour = 10) => new Date(2026, 10, 8 - daysAgo, hour, 0).toISOString();

function memory(id: string, overrides: Partial<GalaxyMemory> = {}): GalaxyMemory {
  return { id, title: `Memória ${id}`, type: 'decision', projectId: null, projectName: null, trust: 'unverified', confidence: 'unverified', sourceKind: 'user', tags: [], createdAt: iso(40), updatedAt: iso(40), ...overrides };
}

describe('galaxy model', () => {
  it('colours type arms with the type tokens and other arms from the warm palette', () => {
    expect(groupColour('type', { id: 'bug_fix', label: '', count: 1, angle: 0, center: [0, 0, 0] }, 0)).toBe(TYPE_COLOUR.bug_fix);
    expect(groupColour('semantic', { id: '__none', label: '', count: 1, angle: 0, center: [0, 0, 0] }, 3)).toBe('#8a9693');
    const colours = starColours(Uint16Array.from([0, 1]), [{ id: 'a', label: 'A', count: 1, angle: 0, center: [0, 0, 0] }, { id: 'b', label: 'B', count: 1, angle: 0, center: [0, 0, 0] }], 'project');
    expect(colours.length).toBe(6);
    for (const value of colours) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });

  it('sizes stars by recency and confidence', () => {
    const [old, recent, reviewed, rejected] = starSizes([memory('a'), memory('b', { updatedAt: iso(1) }), memory('c', { confidence: 'reviewed' }), memory('d', { trust: 'rejected' })], now);
    expect(recent).toBeGreaterThan(old ?? 0);
    expect(reviewed).toBeGreaterThan(old ?? 0);
    expect(rejected).toBeLessThan(old ?? 0);
  });

  it('filters by project, type and period', () => {
    const scoped = memory('a', { projectId: 'p', type: 'bug_fix', updatedAt: iso(3) });
    expect(matchesFilters(scoped, NO_FILTERS, now)).toBe(true);
    expect(matchesFilters(scoped, { ...NO_FILTERS, project: 'global' }, now)).toBe(false);
    expect(matchesFilters(scoped, { ...NO_FILTERS, project: 'p' }, now)).toBe(true);
    expect(matchesFilters(scoped, { ...NO_FILTERS, type: 'decision' }, now)).toBe(false);
    expect(matchesFilters(scoped, { ...NO_FILTERS, period: '7d' }, now)).toBe(true);
    expect(matchesFilters(memory('b'), { ...NO_FILTERS, period: '30d' }, now)).toBe(false);
  });

  it('dims non-matching stars, highlights search hits, and marks selection above all', () => {
    const memories = [memory('a'), memory('b'), memory('c', { type: 'learning' })];
    const states = starStates(memories, { filters: { ...NO_FILTERS, type: 'decision' }, hits: new Set(['a']), selected: 'c', hovered: 'b', now });
    expect(Array.from(states)).toEqual([1, -1, 2]);
    expect(visibleCount(states)).toBe(2);
    expect(Array.from(starStates(memories, { filters: NO_FILTERS, hits: null, selected: null, hovered: 'b', now }))).toEqual([0, 3, 0]);
  });

  it('lists only today\'s real memory events, linking back to the star', () => {
    const events = memoryEvents([memory('new', { createdAt: iso(0, 9), updatedAt: iso(0, 9) }), memory('edited', { updatedAt: iso(0, 11) }), memory('old')], now);
    expect(events.map((event) => event.detail)).toEqual(['Memória criada', 'Memória atualizada']);
    expect(events[0]?.href).toBe('/memory/galaxy?m=new');
  });

  it('turns stored links into index pairs and drops links outside the snapshot', () => {
    expect(linkPairs([memory('a'), memory('b')], [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'a', targetId: 'zz' }])).toEqual([[0, 1]]);
  });
});

describe('links to draw', () => {
  it('draws only the focused star links unless all are asked for', async () => {
    const { visibleLinks } = await import('../src/renderer/src/features/galaxy/galaxy-model.js');
    const pairs: [number, number][] = [[0, 1], [1, 2], [3, 4]];
    expect(visibleLinks(pairs, false, [null, null])).toEqual([]);
    expect(visibleLinks(pairs, false, [1, null])).toEqual([[0, 1], [1, 2]]);
    expect(visibleLinks(pairs, true, [null, null])).toHaveLength(3);
  });
});
