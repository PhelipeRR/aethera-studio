import { describe, expect, it } from 'vitest';
import { aetheraProductionRoute, aetheraStageTone, aetheraWorkspaceProgress } from '../src/aethera-workspace.js';
import type { ProductionState } from '../src/velix-production.js';

const state = (statuses: Array<ProductionState['stages'][number]['status']>): ProductionState => ({
  run: { id: 'run-1', projectId: 'project-1', status: 'running', topic: 'Tema', formatId: 'youtube-long', agent: 'codex', estimatedCostUsd: 0, actualCostUsd: 0, createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z' },
  brief: { schemaVersion: 1, projectId: 'project-1', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'documentary', topic: 'Tema', targetDurationSeconds: 60, language: 'pt-BR', audience: 'geral', tone: 'claro', narrativeStyle: 'explicativo', researchDepth: 'light', sourceCount: 0, pace: 'standard', budgetUsd: 0 },
  stages: statuses.map((status, index) => ({ id: `stage-${index}`, kind: 'briefing', status, progress: status === 'completed' ? 1 : 0, retryCount: 0, costEstimateUsd: 0, actualCostUsd: 0, taskId: null, error: null, outputArtifactIds: [], updatedAt: '2026-11-11T00:00:00Z' })),
  artifacts: [],
  budget: { currency: 'USD', limitUsd: 0, reserveUsd: 0, consumedUsd: 0, policy: 'none' },
  approvals: [],
  qualityReports: [],
});

describe('Aethera AP-07 workspace model', () => {
  it('builds a stable deep-link and reports only persisted stage progress', () => {
    expect(aetheraProductionRoute('run/1')).toBe('/aethera/productions/run%2F1');
    expect(aetheraWorkspaceProgress(state(['completed', 'running', 'pending']))).toEqual({ completed: 1, total: 3, ratio: 1 / 3 });
    expect(aetheraWorkspaceProgress(state([]))).toEqual({ completed: 0, total: 0, ratio: 0 });
  });

  it('assigns accessible tones to stage states', () => {
    expect(aetheraStageTone('completed')).toBe('done');
    expect(aetheraStageTone('running')).toBe('active');
    expect(aetheraStageTone('awaiting_approval')).toBe('attention');
    expect(aetheraStageTone('pending')).toBe('quiet');
  });
});
