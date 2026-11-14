import { describe, expect, it } from 'vitest';
import { activeContextTab, CONTEXT_TABS, contextTabName, systemStatus } from '../src/renderer/src/app/shell-model.js';
import { donutArcs, formatCount, meterState, percentLabel } from '../src/renderer/src/components/ui/glass-model.js';
import { taskEvents, timelineModel } from '../src/renderer/src/components/shell/timeline-model.js';
import { ROUTES } from '../src/renderer/src/app/routes.js';

describe('context tabs', () => {
  it('only point at routes that exist', () => {
    const paths = new Set(ROUTES.map((route) => route.path));
    for (const tab of CONTEXT_TABS) expect(paths.has(`/${tab.to.split('/')[1] ?? ''}`) || paths.has(tab.to), tab.to).toBe(true);
  });

  it('marks the current tab from the path, RAG winning over Memórias on the explorer', () => {
    expect(activeContextTab('/chat')).toBe('orchestrator');
    expect(activeContextTab('/runs/abc')).toBe('orchestrator');
    expect(activeContextTab('/memory')).toBe('memories');
    expect(activeContextTab('/memory/graph')).toBe('memories');
    expect(activeContextTab('/memory/explore')).toBe('rag');
    expect(activeContextTab('/projects/1')).toBe('projects');
    expect(activeContextTab('/mcp')).toBe('mcp');
    expect(activeContextTab('/settings')).toBeNull();
    expect(activeContextTab('/memoryx')).toBeNull();
  });

  it('names each tab with its visible label inside, distinct from the sidebar link', () => {
    for (const tab of CONTEXT_TABS) {
      expect(contextTabName(tab)).toContain(tab.label);
      expect(contextTabName(tab)).not.toBe(tab.label);
    }
  });
});

describe('system status', () => {
  it('reports unknown instead of a number while nothing is loaded', () => {
    const items = systemStatus({ agents: null, mcpClients: null, databaseOk: null, memories: null });
    expect(items.map((item) => item.tone)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(items.map((item) => item.value)).toEqual(['verificando', 'verificando', 'verificando', '—']);
  });

  it('counts only real, usable agents and connected MCP clients', () => {
    const items = systemStatus({
      agents: [{ installed: true, authenticated: true }, { installed: true, authenticated: null }, { installed: false, authenticated: null }],
      mcpClients: [
        { installed: true, registered: true, matches: true, error: null },
        { installed: true, registered: false, matches: false, error: null },
        { installed: false, registered: false, matches: false, error: null },
      ],
      databaseOk: false,
      memories: 1234,
    });
    expect(items[0]).toMatchObject({ value: '2 / 3', tone: 'warning' });
    expect(items[1]).toMatchObject({ value: '1 / 2', tone: 'warning' });
    expect(items[2]).toMatchObject({ value: 'falha', tone: 'error' });
    expect(items[3]).toMatchObject({ value: '1.234', tone: 'ok' });
  });

  it('treats unregistered MCP clients as pending setup and client errors as failures', () => {
    const pending = systemStatus({ agents: [], mcpClients: [{ installed: true, registered: false, matches: false, error: null }], databaseOk: true, memories: 0 })[1];
    expect(pending).toMatchObject({ value: '0 / 1', tone: 'warning' });
    const broken = systemStatus({ agents: [], mcpClients: [{ installed: true, registered: true, matches: true, error: 'config ilegível' }], databaseOk: true, memories: 0 })[1];
    expect(broken?.tone).toBe('error');
  });

  it('says "sem clientes" when no MCP client is installed', () => {
    const [, mcp] = systemStatus({ agents: [], mcpClients: [], databaseOk: true, memories: 0 });
    expect(mcp).toMatchObject({ value: 'sem clientes', tone: 'unknown' });
  });
});

describe('glass model', () => {
  it('never invents a meter value', () => {
    expect(meterState(null)).toEqual({ available: false, percent: 0, label: 'indisponível' });
    expect(meterState(Number.NaN).available).toBe(false);
    expect(meterState(140)).toMatchObject({ available: true, percent: 100, label: '100%' });
    expect(meterState(-3).percent).toBe(0);
    expect(meterState(null, undefined, 'iniciando').label).toBe('iniciando');
  });

  it('draws donut arcs that add up to the circle and skips empty segments', () => {
    const arcs = donutArcs([{ id: 'a', label: 'A', value: 3, color: 'x' }, { id: 'b', label: 'B', value: 1, color: 'y' }, { id: 'c', label: 'C', value: 0, color: 'z' }], 100);
    expect(arcs.map((arc) => arc.id)).toEqual(['a', 'b']);
    expect(arcs[0]?.share).toBe(0.75);
    expect(arcs[1]?.offset).toBe(-75);
    expect(donutArcs([{ id: 'a', label: 'A', value: 0, color: 'x' }], 100)).toEqual([]);
    expect(percentLabel(0.004)).toBe('<1%');
    expect(percentLabel(0.364)).toBe('36%');
  });

  it('formats real counts and shows a dash for missing ones', () => {
    expect(formatCount(1438260)).toBe('1.438.260');
    expect(formatCount(null)).toBe('—');
  });
});

describe('timeline model', () => {
  const now = new Date(2026, 10, 8, 20, 35);

  it('keeps only the day, sorted, and places "now"', () => {
    const model = timelineModel(
      [
        { id: 'late', at: new Date(2026, 10, 8, 18, 0).toISOString(), label: 'B' },
        { id: 'early', at: new Date(2026, 10, 8, 8, 0).toISOString(), label: 'A' },
        { id: 'yesterday', at: new Date(2026, 10, 7, 23, 0).toISOString(), label: 'X' },
        { id: 'broken', at: 'not a date', label: 'Y' },
      ],
      now,
    );
    expect(model.events.map((event) => event.id)).toEqual(['early', 'late']);
    expect(model.events[0]?.time).toBe('08:00');
    expect(model.events[0]?.position).toBeCloseTo(8 / 24);
    expect(model.now).toBeCloseTo((20 * 60 + 35) / (24 * 60));
    expect(model.nowLabel).toBe('20:35');
  });

  it('has no "now" for a past day', () => {
    expect(timelineModel([], now, new Date(2026, 10, 7)).now).toBeNull();
  });

  it('maps tasks to events at their latest real moment', () => {
    const [event] = taskEvents([{ id: 't1', prompt: '  Corrigir   o login  ', status: 'completed', projectName: 'Portal', createdAt: '2026-11-08T10:00:00Z', startedAt: '2026-11-08T10:01:00Z', finishedAt: '2026-11-08T10:05:00Z' }]);
    expect(event).toMatchObject({ id: 't1', at: '2026-11-08T10:05:00Z', label: 'Corrigir o login', detail: 'Portal', tone: 'ok', href: '/runs/t1' });
  });
});

describe('timeline labels', () => {
  it('hides labels that would overlap the previous one', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 8, h, m).toISOString();
    const model = timelineModel([{ id: 'a', at: at(9, 0), label: 'A' }, { id: 'b', at: at(9, 20), label: 'B' }, { id: 'c', at: at(12, 0), label: 'C' }], new Date(2026, 10, 8, 13, 0));
    expect(model.events.map((event) => event.compact)).toEqual([false, true, false]);
  });
});
