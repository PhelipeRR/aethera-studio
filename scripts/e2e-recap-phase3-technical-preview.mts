/**
 * Aethera Recap — Phase 3 Technical Preview Runner (Non-Approved Test Script + Real Panels)
 *
 * Produces a short real MP4 video (~12s) using:
 * - REAL panels extracted from tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz
 * - EXPLICITLY NON-APPROVED technical test script (`isSyntheticFixture: true`)
 * - ZERO dependency on Claude, Codex, or Antigravity
 * - FFmpeg Ken Burns motion, Audio-First sync, sidechain ducking, loudnorm EBU R128, ASS captions, Gate H audit
 *
 * Execucao:
 *   npx tsx scripts/e2e-recap-phase3-technical-preview.mts
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	importChapter,
	extractPanels,
	renderRecapVideo,
	type RecapScript,
} from '@neuralbridge/cinema';

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const CBZ_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'real-manga', 'Nano-Machine-Capitulo-01.cbz');
const WORK_DIR = process.env['NB_RECAP_PHASE3_DIR'] ?? join(REPO_ROOT, '.aethera-recap-data', 'phase3-technical-preview');
const IMPORT_DIR = join(WORK_DIR, 'import');
const RENDER_DIR = join(WORK_DIR, 'render');
const CHECKPOINT_DIR = join(WORK_DIR, 'checkpoints');

async function main() {
	if (!existsSync(CBZ_PATH)) {
		throw new Error(`CBZ nao encontrado: ${CBZ_PATH}`);
	}
	mkdirSync(IMPORT_DIR, { recursive: true });
	mkdirSync(RENDER_DIR, { recursive: true });
	mkdirSync(CHECKPOINT_DIR, { recursive: true });

	console.log(`[PHASE-3] Importando CBZ real: ${CBZ_PATH}`);
	const imported = await importChapter({
		chapterId: 'nano-machine-cap-01-tech-preview',
		archivePath: CBZ_PATH,
		outputDir: IMPORT_DIR,
		readingOrder: 'vertical',
	});

	const extracted = await extractPanels({
		chapter: imported,
		outputDir: IMPORT_DIR,
	});
	const samplePanels = extracted.panels.slice(0, 4);
	console.log(`[PHASE-3] ${extracted.panels.length} paineis extraidos; usando 4 paineis reais para previa tecnica.`);

	// Roteiro tecnico NAO HOMOLOGADO (apenas para validacao do pipeline audiovisual da Fase 3)
	const technicalScript: RecapScript = {
		chapterId: 'nano-machine-cap-01-tech-preview',
		title: '[PREVIA TECNICA NAO HOMOLOGADA] Nano Machine Cap. 01',
		style: 'cinematic_recap',
		totalEstimatedDurationSec: 12,
		generatedAtIso: new Date().toISOString(),
		generatedBy: 'phase3-technical-fixture-unapproved',
		scenes: [
			{
				sceneId: 'tech-scene-1',
				narrationText: 'Teste técnico de abertura cinematográfica com movimento suave sobre o primeiro painel extraído.',
				characters: [],
				eventDescription: 'Abertura técnica sobre painel real 1.',
				panelIds: [samplePanels[0]!.panelId],
				croppedImagePaths: [samplePanels[0]!.croppedImagePath ?? samplePanels[0]!.pagePath],
				estimatedDurationSec: 3.0,
				emotion: 'tension',
				narrativeIntent: 'exposition',
				confidence: 1.0,
				reviewStatus: 'needs_review',
				reviewNotes: 'Roteiro técnico não homologado — apenas validação audiovisual Fase 3.',
			},
			{
				sceneId: 'tech-scene-2',
				narrationText: 'Transição para o segundo painel com proteção da área de leitura e legendas sincronizadas.',
				characters: [],
				eventDescription: 'Continuidade técnica sobre painel real 2.',
				panelIds: [samplePanels[1]!.panelId],
				croppedImagePaths: [samplePanels[1]!.croppedImagePath ?? samplePanels[1]!.pagePath],
				estimatedDurationSec: 3.0,
				emotion: 'determination',
				narrativeIntent: 'rising_action',
				confidence: 1.0,
				reviewStatus: 'needs_review',
				reviewNotes: 'Roteiro técnico não homologado — apenas validação audiovisual Fase 3.',
			},
			{
				sceneId: 'tech-scene-3',
				narrationText: 'Terceiro painel em ritmo crescente com trilha de fundo reduzida automaticamente durante a narração.',
				characters: [],
				eventDescription: 'Ritmo crescente sobre painel real 3.',
				panelIds: [samplePanels[2]!.panelId],
				croppedImagePaths: [samplePanels[2]!.croppedImagePath ?? samplePanels[2]!.pagePath],
				estimatedDurationSec: 3.0,
				emotion: 'tension',
				narrativeIntent: 'rising_action',
				confidence: 1.0,
				reviewStatus: 'needs_review',
				reviewNotes: 'Roteiro técnico não homologado — apenas validação audiovisual Fase 3.',
			},
			{
				sceneId: 'tech-scene-4',
				narrationText: 'Encerramento da prévia técnica validando áudio completo, ordem visual e auditoria do Gate H.',
				characters: [],
				eventDescription: 'Fechamento técnico sobre painel real 4.',
				panelIds: [samplePanels[3]!.panelId],
				croppedImagePaths: [samplePanels[3]!.croppedImagePath ?? samplePanels[3]!.pagePath],
				estimatedDurationSec: 3.0,
				emotion: 'anger',
				narrativeIntent: 'climax',
				confidence: 1.0,
				reviewStatus: 'needs_review',
				reviewNotes: 'Roteiro técnico não homologado — apenas validação audiovisual Fase 3.',
			},
		],
	};

	const result = await renderRecapVideo({
		script: technicalScript,
		panels: samplePanels,
		outputDir: RENDER_DIR,
		checkpointDir: CHECKPOINT_DIR,
		sfxAssetsDir: join(REPO_ROOT, '.agents', 'skills', 'motionvelix', 'assets', 'sfx'),
		burnSubtitles: process.env['NB_RECAP_BURN_SUBTITLES'] === '1',
		plannerOptions: {
			renderTarget: 'preview',
			isSyntheticFixture: true,
			approvalStatus: 'technical_fixture_unapproved',
		},
	});

	console.log('[PHASE-3] Previa tecnica concluida:');
	console.log(
		JSON.stringify(
			{
				mp4Path: result.mp4Path,
				mp4Probe: result.mp4Probe,
				captionsPath: result.captionsPath,
				planPath: result.planPath,
				gateHVerdict: result.gateHReport.verdict,
				gateHMetrics: result.gateHReport.metrics,
				completedStages: result.checkpoint.completedStages,
			},
			null,
			2,
		),
	);
}

main().catch((err) => {
	console.error('[PHASE-3 FATAL]', err);
	process.exit(1);
});
