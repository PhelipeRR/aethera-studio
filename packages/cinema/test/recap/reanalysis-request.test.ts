import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadCheckpoint, saveCheckpoint } from '../../src/recap/checkpoint-persistence.js';
import {
	applyRecapReanalysisRequest,
	excludeReanalysisPanels,
	recapReanalysisRequestSchema,
} from '../../src/recap/recap-reanalysis-request.js';

function analysis(panelId: string, analyzedAtIso: string) {
	return { panelId, visualDescription: panelId, characters: [], dialogues: [], actions: [], emotions: [], evidence: [], analysisConfidence: 0.8, analyzedBy: 'local-vlm', analyzedAtIso };
}

function setup() {
	const dir = mkdtempSync(join(tmpdir(), 'recap-reanalysis-'));
	saveCheckpoint(dir, {
		chapterId: 'ch',
		completedStages: [],
		lastUpdatedAtIso: '2026-11-24T00:00:00.000Z',
		sourceHash: 'src',
		panelAnalyses: [analysis('p1', '2026-11-24T10:00:00.000Z'), analysis('p2', '2026-11-24T10:00:00.000Z')],
		analysisCacheByHash: { k1: analysis('p1', '2026-11-24T10:00:00.000Z'), k2: analysis('p2', '2026-11-24T10:00:00.000Z') },
		panelAnalysisImageHashes: { p1: 'h1', p2: 'h2' },
		warnings: [],
	});
	return dir;
}

const request = recapReanalysisRequestSchema.parse({ schemaVersion: 1, chapterId: 'ch', requestedAtIso: '2026-11-24T12:00:00.000Z', reason: 'fidelity', panelIds: ['p2'] });

test('only the requested panel loses its cached analysis', () => {
	const dir = setup();
	try {
		const result = applyRecapReanalysisRequest(dir, request);
		assert.deepEqual(result.invalidatedPanelIds, ['p2']);
		assert.equal(result.removedCacheEntries, 1);
		const checkpoint = loadCheckpoint(dir)!;
		assert.deepEqual((checkpoint.panelAnalyses as Array<{ panelId: string }>).map((item) => item.panelId), ['p1']);
		assert.deepEqual(Object.keys(checkpoint.analysisCacheByHash ?? {}), ['k1']);
		assert.deepEqual(checkpoint.panelAnalysisImageHashes, { p1: 'h1' });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('re-applying after the panel was re-analysed is a no-op (no inference loop)', () => {
	const dir = setup();
	try {
		applyRecapReanalysisRequest(dir, request);
		const checkpoint = loadCheckpoint(dir)!;
		saveCheckpoint(dir, { ...checkpoint, panelAnalyses: [...(checkpoint.panelAnalyses ?? []), analysis('p2', '2026-11-24T13:00:00.000Z')] });
		const again = applyRecapReanalysisRequest(dir, request);
		assert.deepEqual(again.invalidatedPanelIds, []);
		assert.deepEqual(again.alreadyReanalysedPanelIds, ['p2']);
		assert.equal((loadCheckpoint(dir)!.panelAnalyses ?? []).length, 2);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects a request for another chapter and repeated ids; historical analyses are excluded', () => {
	const dir = setup();
	try {
		assert.throws(() => applyRecapReanalysisRequest(dir, { ...request, chapterId: 'other' }), /CHAPTER_MISMATCH/);
		assert.throws(() => recapReanalysisRequestSchema.parse({ ...request, panelIds: ['p1', 'p1'] }));
		assert.deepEqual(excludeReanalysisPanels([{ panelId: 'p1' }, { panelId: 'p2' }], request).map((item) => item.panelId), ['p1']);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vision context presents prior labels as same-person-only, never as a roster to pick from', async () => {
	const { buildRecapVisionContextString } = await import('../../src/recap/recap-vision-adapter.js');
	const compact = buildRecapVisionContextString({ narrativeMemory: { characters: ['jovem de cabelo escuro despenteado'], recentEvents: [], openQuestions: [] } } as never);
	const full = buildRecapVisionContextString({ knownCharacters: ['jovem de cabelo escuro despenteado', 'figura encapuzada'] } as never);
	for (const text of [compact, full]) {
		assert.match(text, /Rótulos visuais já usados \(reutilize só para a mesma pessoa, com a mesma roupa\)/);
		assert.doesNotMatch(text, /Memória narrativa compacta|Personagens já observados/);
	}
});

test('router prompt version moved past recap-v1 so the new prompt cannot replay cached answers', async () => {
	const { RECAP_VISION_PROMPT_VERSION } = await import('../../src/recap/recap-vision-adapter.js');
	assert.notEqual(RECAP_VISION_PROMPT_VERSION, 'recap-v1');
	assert.match(RECAP_VISION_PROMPT_VERSION, /identity-sfx/);
});

test('a request naming panels absent from the checkpoint fails instead of silently doing nothing', () => {
	const dir = setup();
	try {
		assert.throws(() => applyRecapReanalysisRequest(dir, { ...request, panelIds: ['p2', 'p9_9'] }), /RECAP_REANALYSIS_UNKNOWN_PANEL/);
		assert.equal((loadCheckpoint(dir)!.panelAnalyses ?? []).length, 2);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
