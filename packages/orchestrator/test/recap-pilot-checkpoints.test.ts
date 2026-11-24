import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentAnalysisSchema } from '@neuralbridge/shared';
import { buildRecapPilotPanelResult, recapPilotPanelCacheKey, RecapPilotPanelCheckpointStore, type RecapPilotPanelIdentity, type RecapPilotPanelManifestEntry } from '../src/aethera/recap-pilot-checkpoints.js';

const root = () => mkdtempSync(join(process.env['TEMP'] ?? 'C:/Windows/Temp', 'recap-pilot-checkpoint-'));
const panel = (sha256 = 'a'.repeat(64)): RecapPilotPanelManifestEntry => ({
  panelId: 'chapter_p3_1', pagePath: 'page_0003.webp', cropPath: 'panel.png', pageNumber: 3, panelIndex: 1, readingOrder: 'vertical', classification: 'dialogue', boundingBox: { x: 10, y: 20, w: 800, h: 900 }, width: 800, height: 900, sha256, sourceKind: 'panel_crop', origin: 'manga_scan',
});
const identity = (): RecapPilotPanelIdentity => ({
  provider: 'local-vlm', model: 'qwen3.5:4b-q4_K_M', promptVersion: 'local-panel-v3', schemaVersion: 1, preprocessingVersion: 'crop-v1', cacheVersion: 'cache-v1', contextFingerprint: 'b'.repeat(64),
  settings: { think: false, structuredOutput: true, temperature: 0.2, panelNames: 'visual-only', sfxFilter: true, maxImagesPerCall: 1, stream: false, contextTokens: 4096, maxOutputTokens: 560, ocrPass: 'off', ocrEnabled: true, maxTileAspect: 2 },
});
const analysis = segmentAnalysisSchema.parse({
  schemaVersion: 1, nature: 'dialogue', natureConfidence: 0.8, description: 'Uma pessoa observa o ambiente.',
  frames: [{ atMs: 0, observed: 'Uma pessoa observa o ambiente.', visibleText: [{ text: 'Onde estou?', region: 'center' }] }],
  entities: [{ name: 'pessoa de capa', type: 'character', basis: 'observed', evidence: 'Capa visível no quadro.', confidence: 0.8 }],
  actions: [{ description: 'Observa o ambiente.', basis: 'observed', confidence: 0.8 }], environment: null,
  overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false }, limitations: [], confidence: 0.8,
});

test('persiste painel direto atomicamente e recupera após recriar o store', () => {
  const dir = root();
  const store = new RecapPilotPanelCheckpointStore(dir);
  const item = panel();
  const result = buildRecapPilotPanelResult({ panel: item, identity: identity(), reportedModel: item.panelId, analysis, blocks: [{ index: 0, y0: 0, y1: 900, cacheKey: 'block-direct', tilePath: item.cropPath, cacheHit: false, status: 'complete', inputTokens: 100, outputTokens: 20, wallMs: 50, ocrCompleted: false, ocrLines: [], ocrSfxFiltered: null, ocrError: null }], ocr: [], usages: [{ inputTokens: 100, outputTokens: 20, cachedTokens: null, cacheWriteTokens: null, effectiveApiCostUsd: null, estimatedCostUsd: null, quotaUnits: null }], wallMs: 50, vramMb: 5000 });
  const path = store.write(result);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).analysis.frames[0].visibleText[0].text, 'Onde estou?');
  assert.deepEqual(new RecapPilotPanelCheckpointStore(dir).read(item, identity())?.panel.panelId, item.panelId);
  assert.equal(readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
});

test('preserva blocos, OCR e proveniência de painel dividido', () => {
  const item = panel('c'.repeat(64));
  const result = buildRecapPilotPanelResult({ panel: item, identity: identity(), reportedModel: 'qwen3.5:4b-q4_K_M', analysis, blocks: [0, 1].map((index) => ({ index, y0: index * 500, y1: index === 0 ? 660 : 900, cacheKey: `block-${index}`, tilePath: `tile-${index}.png`, cacheHit: index === 0, status: 'complete' as const, inputTokens: index ? 90 : 0, outputTokens: index ? 18 : 0, wallMs: index ? 20 : 0, ocrCompleted: index === 1, ocrLines: index === 1 ? [{ text: 'Onde estou?', region: 'center' }] : [], ocrSfxFiltered: 1, ocrError: null })), ocr: [{ blockIndex: 1, status: 'completed', rawLinesPersisted: true, lines: [{ text: 'Onde estou?', region: 'center' }], sfxFiltered: 1, inputTokens: 80, outputTokens: 5, error: null }], usages: [{ inputTokens: 90, outputTokens: 18 }], wallMs: 20, vramMb: 5100 });
  assert.equal(result.blocks.length, 2);
  assert.equal(result.ocr[0]?.lines[0]?.text, 'Onde estou?');
  assert.equal(result.provenance.find((entry) => entry.kind === 'dialogue')?.blockIndex, 0);
});

test('invalida por conteúdo/configuração e ignora checkpoint corrompido', () => {
  const dir = root();
  const store = new RecapPilotPanelCheckpointStore(dir);
  const item = panel();
  const result = buildRecapPilotPanelResult({ panel: item, identity: identity(), reportedModel: null, analysis, blocks: [{ index: 0, y0: 0, y1: 900, cacheKey: 'block', tilePath: null, cacheHit: false, status: 'complete', inputTokens: null, outputTokens: null, wallMs: null, ocrCompleted: false, ocrLines: [], ocrSfxFiltered: null, ocrError: null }], ocr: [], usages: [], wallMs: null, vramMb: null });
  const path = store.write(result);
  assert.equal(new RecapPilotPanelCheckpointStore(dir).read(panel('d'.repeat(64)), identity()), null);
  const changedIdentity = { ...identity(), promptVersion: 'local-panel-v4' };
  assert.notEqual(recapPilotPanelCacheKey(item, identity()), recapPilotPanelCacheKey(item, changedIdentity));
  writeFileSync(path, '{not-json');
  assert.equal(new RecapPilotPanelCheckpointStore(dir).read(item, identity()), null);
});
