export const TOUR_VERSION = '2026-11-01.v1';
export type TourStatus = 'idle' | 'running' | 'completed' | 'skipped';
export type TourStep = { id: string; target: string; title: string; description: string; route?: string };
export type TourDefinition = { id: string; route: string; title: string; summary: string; steps: TourStep[] };
export type TourState = { route: string; tourId: string; version: string; index: number; status: TourStatus };
type Action = { type: 'start' } | { type: 'next' } | { type: 'previous' } | { type: 'skip' } | { type: 'finish' };
export function normalizeTourSteps(tour: TourDefinition, available: Set<string>): TourStep[] { return tour.steps.filter((item) => available.has(item.id)); }
export function reduceTourState(state: TourState, action: Action): TourState { if (action.type === 'start') return { ...state, status: 'running', index: 0 }; if (action.type === 'next') return { ...state, index: state.index + 1 }; if (action.type === 'previous') return { ...state, index: Math.max(0, state.index - 1) }; if (action.type === 'skip') return { ...state, status: 'skipped' }; return { ...state, status: 'completed' }; }
