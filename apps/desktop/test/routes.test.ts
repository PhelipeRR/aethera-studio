import { describe, expect, it } from 'vitest';
import { ROUTES, visibleRoutes } from '../src/renderer/src/app/routes';

describe('information architecture routes', () => {
  it('uses the four navigation groups and preserves deep-link paths', () => {
    expect(new Set(ROUTES.map((route) => route.group))).toEqual(new Set(['Trabalho', 'Conhecimento', 'Integrações', 'Configurações']));
    expect(ROUTES.map((route) => route.path)).toEqual(expect.arrayContaining(['/chat', '/runs', '/projects', '/memory', '/settings', '/video', '/extensions']));
  });

  it('shows Velix only when its extension is enabled', () => {
    const noVelix = visibleRoutes([]);
    expect(noVelix.some((route) => route.path === '/video')).toBe(false);
    expect(visibleRoutes([{ manifest: { id: 'velix' }, state: 'disabled' }]).some((route) => route.path === '/video')).toBe(false);
    expect(visibleRoutes([{ manifest: { id: 'velix' }, state: 'enabled' }]).some((route) => route.path === '/video')).toBe(true);
  });
});
