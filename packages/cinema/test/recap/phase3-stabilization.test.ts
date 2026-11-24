import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import sharp from 'sharp';
import {
	computeAudioCheckpointKey,
	getMandatoryRecapGateFailures,
	hasMandatoryRecapGateReview,
	buildMangaVisionAnalystPrompt,
	importChapter,
	createDeterministicFallbackTtsPort,
	renderRecapVideo,
	runGateHAudiovisualQuality,
	sortPageFiles,
	type ExtractedPanel,
	type RecapScript,
} from '../../src/recap/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

async function fixtureDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `aethera-recap-${prefix}-`));
	tempDirs.push(dir);
	return dir;
}

function makeScript(): RecapScript {
	return {
		chapterId: 'phase3-fixture',
		title: 'Fixture',
		style: 'natural_recap',
		scenes: [{
			sceneId: 'scene-1',
			narrationText: 'O protagonista atravessa a ponte.',
			characters: ['protagonista'],
			eventDescription: 'Travessia da ponte.',
			panelIds: ['panel-1'],
			croppedImagePaths: ['panel-1.png'],
			estimatedDurationSec: 1,
			emotion: 'neutral',
			narrativeIntent: 'rising_action',
			confidence: 0.9,
			reviewStatus: 'approved',
		}],
		totalEstimatedDurationSec: 1,
		generatedAtIso: new Date(0).toISOString(),
		generatedBy: 'fixture',
	};
}

describe('Recap Fase 3 — estabilização audiovisual', () => {
	it('ordena páginas deterministicamente e respeita RTL/vertical explícitos', async () => {
		assert.deepEqual(sortPageFiles(['page_10.png', 'page_2.png', 'page_1.png']), ['page_1.png', 'page_2.png', 'page_10.png']);
		const dir = await fixtureDir('order');
		for (const name of ['page_10.png', 'page_2.png', 'page_1.png']) {
			await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#ffffff' } }).png().toFile(join(dir, name));
		}
		const rtl = await importChapter({ chapterId: 'rtl', archivePath: dir, outputDir: join(dir, 'out-rtl'), readingOrder: 'rtl' });
		const vertical = await importChapter({ chapterId: 'vertical', archivePath: dir, outputDir: join(dir, 'out-vertical'), readingOrder: 'vertical' });
		assert.equal(rtl.readingOrder, 'rtl');
		assert.equal(vertical.readingOrder, 'vertical');
		assert.deepEqual(rtl.pages.map((page) => page.filePath.split(/[\\/]/).pop()), ['page_1.png', 'page_2.png', 'page_10.png']);
	});

	it('detecta somente tiras verticais de alta confiança sem impor vertical a páginas comuns', async () => {
		const stripDir = await fixtureDir('strip');
		const regularDir = await fixtureDir('regular');
		for (let i = 0; i < 3; i++) {
			await sharp({ create: { width: 800, height: 2400, channels: 3, background: '#ffffff' } }).png().toFile(join(stripDir, `page_${i + 1}.png`));
			await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#ffffff' } }).png().toFile(join(regularDir, `page_${i + 1}.png`));
		}
		const strip = await importChapter({ chapterId: 'strip', archivePath: stripDir, outputDir: join(stripDir, 'out') });
		const regular = await importChapter({ chapterId: 'regular', archivePath: regularDir, outputDir: join(regularDir, 'out') });
		assert.equal(strip.readingOrder, 'vertical');
		assert.equal(regular.readingOrder, 'rtl');
	});

	it('propaga a ordem configurada para a interpretação visual sem default vertical implícito', () => {
		assert.match(buildMangaVisionAnalystPrompt(), /Direita para esquerda/);
		assert.match(buildMangaVisionAnalystPrompt({ readingOrder: 'ltr' }), /Esquerda para direita/);
		assert.match(buildMangaVisionAnalystPrompt({ readingOrder: 'vertical' }), /cima para baixo/);
	});

	it('invalida o checkpoint de áudio quando roteiro, provedor ou modo mudam', () => {
		const script = makeScript();
		const base = computeAudioCheckpointKey({ script, ttsProviderIdentity: 'provider|voice|model-a', preferContinuous: true });
		const changedText = { ...script, scenes: [{ ...script.scenes[0]!, narrationText: 'Texto alterado.' }] };
		assert.notEqual(base, computeAudioCheckpointKey({ script: changedText, ttsProviderIdentity: 'provider|voice|model-a', preferContinuous: true }));
		assert.notEqual(base, computeAudioCheckpointKey({ script, ttsProviderIdentity: 'provider|voice|model-b', preferContinuous: true }));
		assert.notEqual(base, computeAudioCheckpointKey({ script, ttsProviderIdentity: 'provider|voice|model-a', preferContinuous: false }));
	});

	it('retoma o checkpoint de áudio válido sem chamar novamente o TTS', async () => {
		const dir = await fixtureDir('audio-checkpoint');
		const script = makeScript();
		const panel: ExtractedPanel = {
			panelId: 'panel-1',
			pagePath: join(dir, 'panel.png'),
			croppedImagePath: join(dir, 'panel.png'),
			metadata: {
				sourceKind: 'panel_crop', origin: 'manga_scan', chapterId: script.chapterId, pageNumber: 1, panelIndex: 0,
				readingOrder: 'rtl', boundingBox: { x: 0, y: 0, w: 100, h: 100 }, classification: 'action', ocrStatus: 'not_run', ocrConfidence: 0,
			},
			imageHash: 'panel-hash', width: 100, height: 100,
		};
		const basePort = createDeterministicFallbackTtsPort();
		let calls = 0;
		const port = {
			...basePort,
			synthesizeScene: async (input: Parameters<typeof basePort.synthesizeScene>[0]) => {
				calls++;
				return basePort.synthesizeScene(input);
			},
		};
		await renderRecapVideo({ script, panels: [panel], outputDir: dir, checkpointDir: join(dir, 'checkpoints'), ttsPort: port, dryRunRender: true });
		assert.equal(calls, 1);
		calls = 0;
		await renderRecapVideo({ script, panels: [panel], outputDir: dir, checkpointDir: join(dir, 'checkpoints'), ttsPort: port, dryRunRender: true });
		assert.equal(calls, 0);
	});

	it('classifica Gate H como fail para áudio truncado, silêncio e erro de decodificação', () => {
		const script = makeScript();
		const report = runGateHAudiovisualQuality({
			plan: {
				schemaVersion: 1,
				chapterId: script.chapterId,
				scriptTitle: script.title,
				isSyntheticFixture: false,
				approvalStatus: 'approved_editorial',
				renderTarget: 'preview',
				aspectRatio: '16:9',
				width: 1920,
				height: 1080,
				fps: 30,
				totalDurationMs: 1000,
				shots: [{
					shotId: 'shot-1', sceneId: 'scene-1', sceneIndex: 0, panelId: 'panel-1', pageNumber: 1,
					imagePath: 'fixture.png', startMs: 0, endMs: 1000, durationMs: 1000,
					motionStyle: 'static_focus', focalStart: { x: 0.5, y: 0.5, zoom: 1 }, focalEnd: { x: 0.5, y: 0.5, zoom: 1 },
					transitionIn: 'cut', balloonSafeZoneProtected: true, framingCropRisk: { atRisk: false }, emotion: 'neutral', narrativeIntent: 'rising_action',
				}],
				sfxCues: [], vfxSpecs: [], ducking: {} as never,
				captions: {} as never,
				durationAudit: {
					plannedDurationMs: 1000, measuredNarrationDurationMs: 1000, finalTimelineDurationMs: 1000,
					narrationEndMs: 1000, durationToleranceMs: 250, completeNarrationPreserved: true, adjustments: [],
				},
				createdAtIso: new Date(0).toISOString(),
			},
			script,
			panels: [],
			verifyImageFilesOnDisk: false,
			synthesizedSegments: [{ sceneId: 'scene-1', speechDurationMs: 1000, provider: 'fixture', isFallback: false }],
			narrationAudits: [{ sceneId: 'scene-1', durationMs: 1000, silenceRatio: 0.8, clippedSamples: 0, ok: false, issues: ['Silêncio excessivo'] }],
			mp4Probe: { hasVideo: true, hasAudio: true, durationMs: 1000, width: 1920, height: 1080, videoDurationMs: 1000, audioDurationMs: 600, formatDurationMs: 1000, decodeOk: false, decodeError: 'fixture decode error' },
		});
		assert.equal(report.verdict, 'fail');
		assert.ok(report.findings.some((finding) => finding.code === 'audio_truncated'));
		assert.ok(report.findings.some((finding) => finding.code === 'unexpected_audio_silence'));
		assert.ok(report.findings.some((finding) => finding.code === 'mp4_decode_error'));
	});

	it('mantém pass, needs_review e fail distintos nos gates obrigatórios', () => {
		assert.deepEqual(getMandatoryRecapGateFailures([
			{ gate: 'H', verdict: 'pass' }, { gate: 'I', verdict: 'needs_review' }, { gate: 'J', verdict: 'fail' },
		]), ['J']);
		assert.equal(hasMandatoryRecapGateReview([{ gate: 'I', verdict: 'needs_review' }]), true);
		assert.equal(hasMandatoryRecapGateReview([{ gate: 'H', verdict: 'pass' }]), false);
	});
});
