import { describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  CompositionPlanner,
  QualityGateService,
  SharpSvgCompositionEngine,
} from '../src/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('QualityGateService visual focus', () => {
  it('blocks a palette-and-text-only thumbnail instead of treating it as a real composition', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'quality-gate-focus-'));
    const ingestion = new AssetIngestionService({ storageRoot });
    const planner = new CompositionPlanner();
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);
    const document = planner.buildDocument({
      artType: 'thumbnail',
      prompt: 'NextWorth anime e games',
      headline: 'NEXTWORTH',
      visualFocusRequired: true,
    });

    const audit = await gate.auditProject(document);

    expect(audit.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'THUMBNAIL_NO_VISUAL_FOCUS',
          severity: 'critical',
        }),
      ]),
    );
    expect(audit.passed).toBe(false);
  });
});
