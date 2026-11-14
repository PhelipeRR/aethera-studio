import { describe, expect, it } from 'vitest';
import { TOUR_VERSION, normalizeTourSteps, reduceTourState, type TourState } from '../src/renderer/src/app/guided-tours-core.js';
import { getTourForPath, TOUR_DEFINITIONS } from '../src/renderer/src/app/guided-tours-config';

describe('Guided Tours', () => {
  it('provides specific steps for every primary route and drops unavailable targets', () => {
    const tour = { id: 'chat', route: '/chat', title: 'Chat', summary: 'Agentes', steps: [{ id: 'tour-chat-input', target: '[data-tour="tour-chat-input"]', title: 'Entrada', description: 'Descreva a tarefa e o agente.' }] };
    expect(tour.steps[0]?.description).toContain('agente');
    expect(normalizeTourSteps(tour, new Set(['tour-chat-input']))).toHaveLength(1);
  });

  it('keeps completion and skip isolated by version', () => {
    const state: TourState = { route: '/chat', tourId: 'chat', version: TOUR_VERSION, index: 0, status: 'running' };
    expect(reduceTourState(state, { type: 'skip' })).toMatchObject({ status: 'skipped', version: TOUR_VERSION });
    expect(reduceTourState(state, { type: 'finish' })).toMatchObject({ status: 'completed', route: '/chat' });
  });

  it('maps every primary route to stable contextual targets', () => {
    const routes = ['/', '/chat', '/runs', '/memory', '/skills', '/projects', '/git-intelligence', '/agents', '/mcp', '/analytics', '/workflows', '/mission-control', '/video', '/settings'];
    expect(TOUR_DEFINITIONS).toHaveLength(routes.length);
    for (const route of routes) {
      const tour = getTourForPath(route);
      expect(tour?.route).toBe(route);
      expect(tour?.steps.length).toBeGreaterThan(0);
      for (const step of tour?.steps ?? []) expect(step.target).toMatch(/^\[data-tour="[^"]+"\]$/);
    }
    expect(getTourForPath('/memory/explore')?.id).toBe('memory');
  });

  it('does not expose a primary-page tour on incompatible detail routes', () => {
    expect(getTourForPath('/projects/project-1')).toBeUndefined();
    expect(getTourForPath('/runs/run-1')).toBeUndefined();
    expect(getTourForPath('/memory/abc123')?.id).toBe('memory');
  });
});
