import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	runNarrativeAnalyzer,
	runStoryEngine,
	saveCheckpoint,
	loadCheckpoint,
	computePanelCacheKey,
	invalidateCheckpointCache,
	RECAP_ANALYZER_VERSION,
	createRecapVisionAdapter,
	formatVisionRoutingSummary,
	createMultiAgentVideoResearchPortAdapter,
	buildGateGDivergenceReport,
	runNarrativeHumanizer,
	AgentCircuitBreaker,
	AllVisionProvidersUnavailableError,
	classifyVisionError,
	detectProviderErrorInText,
	sanitizeErrorMessage,
	type ExtractedPanel,
	type VisionAdapter,
	type RecapVisualAnalysisPort,
	type TextEnhancementPort,
	type ResearchAgentAdapterPort,
	type RecapScript,
} from '../../src/recap/index.js';

function makePanel(id: string, pageNumber: number, imagePath: string, imageHash: string): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'ch-test',
			pageNumber,
			panelIndex: pageNumber,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: pageNumber * 100, w: 800, h: 600 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash,
		width: 800,
		height: 600,
	};
}

function makeSuccessProvider(id: string, onCall?: () => void, delayMs = 0): RecapVisualAnalysisPort {
	return {
		id,
		model: `${id}-model-v1`,
		async detect() {
			return { available: true };
		},
		async analyze({ frames }) {
			onCall?.();
			if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
			return {
				nature: 'action',
				natureConfidence: 0.9,
				description: `Painel analisado por ${id} (${frames[0]?.path ?? ''})`,
				frames: frames.map((f) => ({ atMs: f.atMs ?? 0, observed: 'Cena visível', visibleText: [] })),
				entities: [{ name: 'Cheon Yeo-Woon', type: 'character', basis: 'observed', evidence: 'visível', confidence: 0.9 }],
				actions: [{ description: 'Avança no pátio', basis: 'observed', confidence: 0.9 }],
				environment: { description: 'Pátio', basis: 'observed', confidence: 0.9 },
				overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
				limitations: [],
				confidence: 0.88,
			};
		},
	};
}

describe('Phase 2.2.4 Enhancements (Quota, Circuit Breaker, Vision Fallback, Durable Checkpoints, Gate G)', () => {
	const REAL_CLAUDE_QUOTA_MSG =
		"You've hit your weekly limit · resets Nov 22, 3pm (America/Sao_Paulo) · out of usage credits";

	it('1. classifies Claude weekly limit / out of usage credits as QUOTA_EXCEEDED (never JSON parse error) and sanitizes secrets', () => {
		const detected = detectProviderErrorInText(REAL_CLAUDE_QUOTA_MSG, 'claude');
		expect(detected).not.toBeNull();
		expect(detected?.code).toBe('QUOTA_EXCEEDED');
		expect(detected?.retryable).toBe(false);
		expect(detected?.resetAtText).toContain('Nov 22, 3pm');

		const leaked = 'Authorization: Bearer sk-ant-secret1234567890 api_key=supersecret999';
		const clean = sanitizeErrorMessage(leaked);
		expect(clean).not.toContain('sk-ant-secret1234567890');
		expect(clean).not.toContain('supersecret999');
	});

	it('2 & 3 & 4 & 5. trips circuit breaker on Claude QUOTA_EXCEEDED, stops sending new panels to Claude, falls back to next agent with zero loss/duplication and preserved narrative order', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-failover-'));
		try {
			const panels: ExtractedPanel[] = [];
			for (let i = 0; i < 6; i++) {
				const img = join(dir, `p-${i}.png`);
				writeFileSync(img, `panel-bytes-${i}`);
				panels.push(makePanel(`p-${i}`, i, img, `hash-${i}`));
			}

			let claudeCalls = 0;
			let codexCalls = 0;
			const circuitBreaker = new AgentCircuitBreaker();

			const claudeProvider: RecapVisualAnalysisPort = {
				id: 'claude',
				model: 'claude-sonnet',
				async detect() {
					return { available: true };
				},
				async analyze() {
					claudeCalls++;
					throw classifyVisionError(REAL_CLAUDE_QUOTA_MSG, 'claude');
				},
			};
			const codexProvider = makeSuccessProvider('codex', () => {
				codexCalls++;
			});

			const adapter = createRecapVisionAdapter({
				root: dir,
				providers: [claudeProvider, codexProvider],
				circuitBreaker,
				throwOnAllUnavailable: true,
			});

			const res = await runNarrativeAnalyzer({
				panels,
				visionAdapter: adapter,
				analyzedBy: adapter.name,
				concurrency: 1,
			});

			// 2. Claude called only once, then circuit breaker prevented all subsequent calls
			expect(claudeCalls).toBe(1);
			expect(circuitBreaker.isAvailable('claude')).toBe(false);
			expect(circuitBreaker.getState('claude')?.code).toBe('QUOTA_EXCEEDED');
			expect(circuitBreaker.getState('claude')?.resetAtText).toContain('Nov 22');

			// 3. Codex assumed all 6 panels
			expect(codexCalls).toBe(6);

			// 4 & 5. Zero panels lost or duplicated, narrative order preserved
			expect(res.analyses).toHaveLength(6);
			expect(res.analyses.map((a) => a.panelId)).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('6 & 7. durable checkpoint stores ONLY valid analyses (filters failures) and resume skips completed panels via composite hash+model+version cache', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-durable-ckpt-'));
		const ckptDir = join(dir, 'persistent-checkpoints');
		try {
			const img1 = join(dir, 'p1.png');
			const img2 = join(dir, 'p2.png');
			writeFileSync(img1, 'img1');
			writeFileSync(img2, 'img2');

			const panels = [makePanel('p-1', 0, img1, 'hash-1'), makePanel('p-2', 1, img2, 'hash-2')];

			// Attempt to save one valid and one zero-confidence failed analysis
			saveCheckpoint(ckptDir, {
				chapterId: 'ch-durable',
				completedStages: ['import', 'extraction'],
				lastUpdatedAtIso: new Date().toISOString(),
				sourceHash: 'hash-1',
				extractedPanels: panels,
				panelAnalyses: [
					{
						panelId: 'p-1',
						characters: ['Cheon Yeo-Woon'],
						dialogues: [],
						actions: [{ type: 'observation', description: 'Olha ao redor' }],
						emotions: ['tension'],
						evidence: [],
						analysisConfidence: 0.85,
						analyzedBy: 'test-vision',
						analyzedAtIso: new Date().toISOString(),
					},
					{
						panelId: 'p-2',
						characters: [],
						dialogues: [],
						actions: [{ type: 'none', description: 'Failed' }],
						emotions: ['unknown'],
						evidence: [],
						analysisConfidence: 0, // MUST BE FILTERED OUT
						analyzedBy: 'test-vision',
						analyzedAtIso: new Date().toISOString(),
					},
				],
			});

			const loaded = loadCheckpoint(ckptDir);
			expect(loaded?.panelAnalyses).toHaveLength(1);
			expect(loaded?.panelAnalyses?.[0]?.panelId).toBe('p-1');

			// Resume: only p-2 should be analyzed fresh
			let freshCalls = 0;
			const visionAdapter: VisionAdapter = {
				name: 'test-vision',
				async analyze() {
					freshCalls++;
					return {
						characters: ['Cheon Yeo-Woon'],
						actions: [{ type: 'combat', description: 'Defende golpe' }],
						emotions: ['determination'],
						setting: 'Pátio',
						confidence: 0.9,
					};
				},
			};

			await runStoryEngine({
				chapterId: 'ch-durable',
				panels,
				outputDir: join(dir, 'out'),
				checkpointDir: ckptDir,
				visionAdapter,
			});
			expect(freshCalls).toBe(1);

			// Second full run: 0 fresh calls because composite key (hash+model+version) hits cache
			await runStoryEngine({
				chapterId: 'ch-durable',
				panels,
				outputDir: join(dir, 'out'),
				checkpointDir: ckptDir,
				visionAdapter,
			});
			expect(freshCalls).toBe(1);

			// Safe cache invalidation works without deleting extractedPanels
			const key = computePanelCacheKey({ imageHash: 'hash-1', model: 'test-vision', analyzerVersion: RECAP_ANALYZER_VERSION });
			expect(loadCheckpoint(ckptDir)?.analysisCacheByHash?.[key]).toBeDefined();
			expect(invalidateCheckpointCache(ckptDir)).toBe(true);
			expect(loadCheckpoint(ckptDir)?.panelAnalyses).toHaveLength(0);
			expect(loadCheckpoint(ckptDir)?.extractedPanels).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('8. throws structured AllVisionProvidersUnavailableError when all multimodal agents are unavailable or quota-exhausted', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-all-down-'));
		try {
			const img = join(dir, 'p0.png');
			writeFileSync(img, 'bytes');
			const panels = [makePanel('p-0', 0, img, 'hash-0')];

			const claudeQuota: RecapVisualAnalysisPort = {
				id: 'claude',
				model: 'claude-sonnet',
				async detect() { return { available: true }; },
				async analyze() { throw classifyVisionError(REAL_CLAUDE_QUOTA_MSG, 'claude'); },
			};
			const agyUnavailable: RecapVisualAnalysisPort = {
				id: 'antigravity',
				model: 'agy',
				async detect() { return { available: false, reason: 'Antigravity CLI not installed' }; },
				async analyze() { throw new Error('should not run'); },
			};

			const adapter = createRecapVisionAdapter({
				root: dir,
				providers: [claudeQuota, agyUnavailable],
				throwOnAllUnavailable: true,
			});

			await expect(
				runNarrativeAnalyzer({ panels, visionAdapter: adapter, analyzedBy: adapter.name }),
			).rejects.toBeInstanceOf(AllVisionProvidersUnavailableError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('9. distinguishes genuine JSON parsing failure (INVALID_MODEL_RESPONSE) from QUOTA_EXCEEDED', () => {
		const malformedText = 'Aqui está a análise sem json válido: { quebrado';
		expect(detectProviderErrorInText(malformedText, 'claude')).toBeNull();

		const classified = classifyVisionError('Failed to parse JSON after 1200ms. Preview: { quebrado', 'claude');
		expect(classified.code).toBe('INVALID_MODEL_RESPONSE');
		expect(classified.code).not.toBe('QUOTA_EXCEEDED');
	});

	it('10. bounded concurrency respects circuit breaker and stops unstarted tasks without duplicating results', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-conc-cb-'));
		try {
			const panels: ExtractedPanel[] = [];
			for (let i = 0; i < 8; i++) {
				const img = join(dir, `p-${i}.png`);
				writeFileSync(img, `bytes-${i}`);
				panels.push(makePanel(`p-${i}`, i, img, `hash-c-${i}`));
			}

			let claudeCalls = 0;
			let codexCalls = 0;
			const circuitBreaker = new AgentCircuitBreaker();

			const claudeProvider: RecapVisualAnalysisPort = {
				id: 'claude',
				model: 'claude-sonnet',
				async detect() { return { available: true }; },
				async analyze() {
					claudeCalls++;
					await new Promise((r) => setTimeout(r, 10));
					throw classifyVisionError(REAL_CLAUDE_QUOTA_MSG, 'claude');
				},
			};
			const codexProvider = makeSuccessProvider('codex', () => { codexCalls++; }, 5);

			const adapter = createRecapVisionAdapter({
				root: dir,
				providers: [claudeProvider, codexProvider],
				circuitBreaker,
				throwOnAllUnavailable: true,
			});

			const res = await runNarrativeAnalyzer({
				panels,
				visionAdapter: adapter,
				analyzedBy: adapter.name,
				concurrency: 2,
			});

			// At most concurrency (2) in-flight calls could hit Claude before circuit opened; never 8
			expect(claudeCalls).toBeLessThanOrEqual(2);
			expect(codexCalls).toBe(8);
			expect(res.analyses).toHaveLength(8);
			expect(new Set(res.analyses.map((a) => a.panelId)).size).toBe(8);
			expect(res.analyses.map((a) => a.panelId)).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('falls back across compatible agents in createMultiAgentVideoResearchPortAdapter', async () => {
		const codexAdapter: ResearchAgentAdapterPort = {
			id: 'codex',
			async detect() { return { installed: true, authenticated: true, problems: [] }; },
			async *run() {},
		};
		const claudeAdapter: ResearchAgentAdapterPort = {
			id: 'claude',
			async detect() { return { installed: true, authenticated: true, problems: [] }; },
			async *run() {},
		};

		const port = createMultiAgentVideoResearchPortAdapter({
			adapters: [codexAdapter, claudeAdapter],
			cwd: '.',
			async runVideoResearchFn(adapter) {
				if (adapter.id === 'codex') throw new Error('Codex usage limit reached until 2026-11-23');
				return {
					references: [
						{
							kind: 'texto',
							title: 'Nano Machine Cap 1',
							url: 'https://www.webtoons.com/nano-machine',
							license: 'citação',
							note: 'Referência oficial capítulo 1.',
						},
					],
					rejected: 0,
					generation: { executionId: 'exec-claude-1', model: 'claude-sonnet' },
				};
			},
		});

		const res = await port.research({ topic: 'Nano Machine' });
		expect(res.ok).toBe(true);
		expect(res.agentId).toBe('claude');
		expect(res.references).toHaveLength(1);
	});

	it('reverts humanized scene when named character is omitted and builds divergence report', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-hum-test-'));
		try {
			const img1 = join(dir, 'p1.png');
			writeFileSync(img1, 'img1');
			const panels = [makePanel('p-1', 0, img1, 'hash-h1')];
			const script: RecapScript = {
				chapterId: 'ch-hum',
				title: 'Teste',
				style: 'narrative_recap',
				generatedAtIso: new Date().toISOString(),
				generatedBy: 'story-engine',
				totalEstimatedDurationSec: 5,
				scenes: [
					{
						sceneId: 'scene-1',
						narrationText: 'Cheon Yeo-Woon encara os guardas no pátio.',
						characters: ['Cheon Yeo-Woon'],
						eventDescription: 'Cheon Yeo-Woon encara os guardas.',
						panelIds: ['p-1'],
						croppedImagePaths: [img1],
						estimatedDurationSec: 5,
						emotion: 'tension',
						narrativeIntent: 'exposition',
						confidence: 0.9,
						reviewStatus: 'approved',
					},
				],
			};

			const port: TextEnhancementPort = {
				name: 'omitting-port',
				async enhance() {
					return {
						ok: true,
						agentId: 'claude',
						model: 'claude-sonnet',
						text: JSON.stringify({ humanizedText: 'O jovem encara os guardas no pátio em silêncio.' }),
					};
				},
			};

			const hum = await runNarrativeHumanizer({
				script,
				panels,
				options: { enabled: true, style: 'narrative_recap', maxDurationDeviation: 0.25, port },
			});

			expect(hum.diffs[0]?.reverted).toBe(true);
			expect(hum.diffs[0]?.revertReason).toContain('Cheon Yeo-Woon');
			expect(hum.script.scenes[0]?.narrationText).toBe(script.scenes[0]?.narrationText);

			const div = buildGateGDivergenceReport(hum.postHumanizeGateG, hum.postHumanizeGateG, hum.diffs);
			expect(div.revertedScenes).toBe(1);
			expect(div.evidencePreserved).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('regression (Antigravity): RESOURCE_EXHAUSTED 429 opens circuit breaker as QUOTA_EXCEEDED without retries and strips prompts/schemas', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-agy-reg-'));
		try {
			const img = join(dir, 'p0.png');
			writeFileSync(img, 'img-bytes');
			const panels = [makePanel('p-0', 0, img, 'hash-agy-0'), makePanel('p-1', 1, img, 'hash-agy-1')];

			const rawAgyError =
				'Command failed: agy --output-format json --mode plan --print Analyze the local video frame images... Respond ONLY with valid JSON matching this JSON Schema: {"type":"object","properties":{"description":{"type":"string"}}} | exit code 1 — API error 429 RESOURCE_EXHAUSTED: insufficient credits';

			let agyCalls = 0;
			let gwCalls = 0;
			const circuitBreaker = new AgentCircuitBreaker();

			const agyProvider: RecapVisualAnalysisPort = {
				id: 'antigravity',
				model: 'agy-1.5.13',
				async detect() { return { available: true }; },
				async analyze() {
					agyCalls++;
					throw new Error(rawAgyError);
				},
			};
			const gwProvider = makeSuccessProvider('claude-gateway', () => { gwCalls++; });

			const adapter = createRecapVisionAdapter({
				root: dir,
				providers: [agyProvider, gwProvider],
				circuitBreaker,
				throwOnAllUnavailable: true,
			});

			const res = await runNarrativeAnalyzer({ panels, visionAdapter: adapter, analyzedBy: adapter.name });
			expect(agyCalls).toBe(1);
			expect(gwCalls).toBe(2);
			expect(circuitBreaker.isAvailable('antigravity')).toBe(false);
			expect(circuitBreaker.getState('antigravity')?.code).toBe('QUOTA_EXCEEDED');
			expect(circuitBreaker.getState('antigravity')?.reason).not.toContain('JSON Schema');
			expect(circuitBreaker.getState('antigravity')?.reason).not.toContain('--print Analyze');
			expect(res.analyses).toHaveLength(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('regression (Codex): preserves original exit code and stderr as UNKNOWN_PROVIDER_ERROR (not generic PROVIDER_UNAVAILABLE) and trips circuit breaker on Codex quota', async () => {
		const rawUnknown = 'codex visual run failed: exit code 1 — stderr: unsupported image format or sandbox error';
		const unknownErr = classifyVisionError(rawUnknown, 'codex');
		expect(unknownErr.code).toBe('UNKNOWN_PROVIDER_ERROR');
		expect(unknownErr.exitCode).toBe(1);
		expect(unknownErr.message).toContain('unsupported image format');

		const rawCodexQuota = 'codex visual run failed: exit code 1 — You have reached your usage limit until 2026-11-23';
		const quotaErr = classifyVisionError(rawCodexQuota, 'codex');
		expect(quotaErr.code).toBe('QUOTA_EXCEEDED');
		expect(quotaErr.resetAtText).toContain('2026-11-23');

		const cb = new AgentCircuitBreaker();
		cb.recordError('codex', quotaErr);
		expect(cb.isAvailable('codex')).toBe(false);

		const summary = formatVisionRoutingSummary([
			{ provider: 'claude', outcome: 'error', detail: REAL_CLAUDE_QUOTA_MSG },
			{ provider: 'codex', outcome: 'error', detail: rawUnknown },
			{ provider: 'antigravity', outcome: 'error', detail: '429 RESOURCE_EXHAUSTED: insufficient credits' },
			{ provider: 'claude-gateway', outcome: 'ok' },
		]);
		expect(summary).toEqual([
			expect.objectContaining({ provider: 'claude', code: 'QUOTA_EXCEEDED', fallbackTo: 'codex' }),
			expect.objectContaining({ provider: 'codex', code: 'UNKNOWN_PROVIDER_ERROR', fallbackTo: 'antigravity' }),
			expect.objectContaining({ provider: 'antigravity', code: 'QUOTA_EXCEEDED', fallbackTo: 'claude-gateway' }),
			{ provider: 'claude-gateway', outcome: 'ok' },
		]);
	});

	it('regression (incremental checkpoint): preserves completed valid panels on disk even when run aborts with AllVisionProvidersUnavailableError', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-inc-abort-'));
		const ckptDir = join(dir, 'checkpoints');
		try {
			const panels: ExtractedPanel[] = [];
			for (let i = 0; i < 4; i++) {
				const img = join(dir, `p-${i}.png`);
				writeFileSync(img, `panel-${i}`);
				panels.push(makePanel(`p-${i}`, i, img, `hash-inc-${i}`));
			}

			let calls = 0;
			const flakyProvider: RecapVisualAnalysisPort = {
				id: 'claude',
				model: 'claude-sonnet',
				async detect() { return { available: true }; },
				async analyze({ frames }) {
					calls++;
					if (calls <= 2) {
						return makeSuccessProvider('claude').analyze!({ frames });
					}
					throw classifyVisionError(REAL_CLAUDE_QUOTA_MSG, 'claude');
				},
			};

			const adapter = createRecapVisionAdapter({
				root: dir,
				providers: [flakyProvider],
				throwOnAllUnavailable: true,
			});

			await expect(
				runStoryEngine({
					chapterId: 'ch-abort',
					panels,
					outputDir: join(dir, 'out'),
					checkpointDir: ckptDir,
					visionAdapter: adapter,
					analysisConcurrency: 1,
				}),
			).rejects.toBeInstanceOf(AllVisionProvidersUnavailableError);

			// Panels 0 and 1 MUST remain persisted on disk despite abort on panel 2
			const saved = loadCheckpoint(ckptDir);
			expect(saved?.panelAnalyses).toHaveLength(2);
			expect(saved?.panelAnalyses?.map((a) => a.panelId)).toEqual(['p-0', 'p-1']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
