import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createRecapPilotProvider, RECAP_PILOT_PROVIDER_CONFIG } from '../src/aethera/recap-pilot-config.js';

test('configuração experimental é explícita e não altera defaults globais', () => {
  const result = createRecapPilotProvider({ jobId: 'pilot-config', cacheDir: mkdtempSync(join(tmpdir(), 'recap-pilot-config-')), vramSampler: async () => 0 });
  assert.equal(result.provider.model, RECAP_PILOT_PROVIDER_CONFIG.model);
  assert.equal(result.provider.limits.maxImagesPerCall, 1);
  assert.equal(result.budget.limits.maxPanels, 40);
  assert.equal(result.budget.limits.maxBlocks, 64);
  assert.equal(result.budget.limits.maxCalls, 80);
  assert.equal(result.budget.limits.maxOcrCalls, 12);
  assert.equal(result.budget.limits.maxCpuFallbacks, 2);
  assert.equal(result.budget.limits.workerCount, 1);
});
