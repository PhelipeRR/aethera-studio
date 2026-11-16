import { describe, expect, it } from 'vitest';
import {
  buildSceneDiagnosticRows,
  safeThumbnailUrl,
  summarizeSceneRows,
  type SceneMediaDiagnosticView,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/scene-media-diagnostics-model.js';

const diag = (segmentId: string, overrides: Partial<SceneMediaDiagnosticView> = {}): SceneMediaDiagnosticView => ({
  segmentId,
  subject: segmentId,
  queries: ['Mashle anime fight scene'],
  sourcesConsulted: ['yt_dlp'],
  candidatesFound: 6,
  acquired: 2,
  approved: [],
  rejected: [],
  failedDownloads: [],
  coveredSec: 0,
  expectedSec: 40,
  pendingRights: 0,
  ...overrides,
});

describe('scene media diagnostics view model', () => {
  it('uses assembled seconds when available and classifies covered / partial / missing', () => {
    const rows = buildSceneDiagnosticRows(
      [
        diag('a', { coveredSec: 40 }),
        diag('b', { coveredSec: 12, bestAlternative: { kind: 'manual_import', detail: 'Importe um clipe de Mashle' } }),
        diag('c', { bestAlternative: { kind: 'graphic_recovery', detail: 'tipografia' } }),
      ],
      [
        { sceneId: 'a', timelineSec: 42, realFootageSec: 42, graphicRecoverySec: 0, status: 'real_footage' },
        { sceneId: 'b', timelineSec: 30, realFootageSec: 12, graphicRecoverySec: 18, status: 'partial', pendingReason: 'restante gráfico' },
      ],
    );
    expect(rows.map((r) => r.status)).toEqual(['covered', 'partial', 'missing']);
    expect(rows[0]).toMatchObject({ realSec: 42, neededSec: 42 });
    expect(rows[0]?.bestAlternative).toBeUndefined();
    expect(rows[1]).toMatchObject({ realSec: 12, neededSec: 30, graphicRecoverySec: 18, pendingReason: 'restante gráfico' });
    expect(rows[1]?.bestAlternative).toMatch(/Importar mídia manualmente/);
    expect(rows[2]).toMatchObject({ realSec: 0, neededSec: 40 });
    expect(summarizeSceneRows(rows)).toMatchObject({ covered: 1, partial: 1, missing: 1, realSec: 54, neededSec: 112 });
  });

  it('only renders http(s) thumbnails', () => {
    expect(safeThumbnailUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
    expect(safeThumbnailUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeThumbnailUrl('file:///C:/x.jpg')).toBeUndefined();
  });
});
