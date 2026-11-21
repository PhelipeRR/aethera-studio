/**
 * Executa o pipeline audiovisual completo (TTS real + Motion Velix + Render MP4 + QA)
 * usando o roteiro natural_recap conversacional revisado sobre os 6 painéis reais de Nano Machine Cap. 01,
 * mantendo o Story Memory consolidado.
 */

import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import {
	loadCheckpoint,
	runStoryContinuityEngine,
	runScriptGenerator,
	runGateGNarrativeFidelity,
	runNarrativeHumanizer,
	createOrLoadStoryMemoryProject,
	consolidateChapterIntoStoryMemory,
	renderRecapVideo,
	resolveMotionVelixKit,
	createChainedRecapTtsPort,
	createVoiceStudioRecapTtsPort,
	createWindowsSapiRecapTtsPort,
	sanitizeErrorMessage,
	type RecapTtsSynthesisPort,
	type TextEnhancementPort,
} from '../packages/cinema/src/recap/index.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const SOURCE_CKPT_DIR = join(REPO_ROOT, '.aethera-recap-data', 'story-engine-e2e-real', 'checkpoints', 'nano-machine-cap-01');
const WORK_DIR = join(REPO_ROOT, '.aethera-recap-data', 'story-engine-natural-render');
const RENDER_DIR = join(WORK_DIR, 'render');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'recap-natural-render-qa-report.md');

function parseJsonLoose(raw: string): Record<string, unknown> | null {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function createAgyConversationalHumanizerPort(cwd: string): TextEnhancementPort {
	return {
		name: 'antigravity-natural-conversational',
		async enhance(req) {
			try {
				const prompt = [
					req.systemPrompt,
					'',
					'Deixe a narração ainda mais simples e conversacional, como um criador de conteúdo brasileiro contando a história diretamente ao espectador.',
					'Não descreva névoa, roupas, poeira, folhas ou expressões quando não forem essenciais para entender o que aconteceu.',
					'Priorize ações, acontecimentos, diálogos reais e continuidade — sem limite rígido de palavras, apenas sem enrolação.',
					'',
					`Texto base:\n${req.text}`,
					`Contexto:\n${JSON.stringify(req.context)}`,
				].join('\n');
				const { stdout } = await execFileAsync(
					'agy',
					['--output-format', 'text', '--mode', 'plan', '--print', prompt],
					{ cwd, timeout: 90_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
				);
				const parsed = parseJsonLoose(stdout);
				const outText = parsed && typeof parsed['humanizedText'] === 'string'
					? JSON.stringify({ humanizedText: parsed['humanizedText'] })
					: stdout.trim();
				return { ok: true, text: outText, agentId: 'antigravity', model: 'agy-cli' };
			} catch (err) {
				return {
					ok: false,
					text: '',
					agentId: 'antigravity',
					model: null,
					error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
				};
			}
		},
	};
}

async function probeMedia(mp4Path: string) {
	const { stdout } = await execFileAsync(
		'ffprobe',
		['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4Path],
		{ timeout: 20_000, windowsHide: true },
	);
	return JSON.parse(stdout) as {
		format: { duration?: string; size?: string; bit_rate?: string };
		streams: Array<{
			codec_type: string;
			codec_name: string;
			width?: number;
			height?: number;
			r_frame_rate?: string;
			sample_rate?: string;
			channels?: number;
		}>;
	};
}

async function measureAudioLoudness(mp4Path: string): Promise<{ integratedLufs: string; truePeakDbtp: string }> {
	try {
		const { stderr } = await execFileAsync(
			'ffmpeg',
			['-i', mp4Path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
			{ timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
		);
		const iMatch = /Integrated loudness:[\s\S]*?I:\s*([-\d.]+)\s*LUFS/.exec(stderr);
		const tpMatch = /True peak:[\s\S]*?Peak:\s*([-\d.]+)\s*dBFS/.exec(stderr);
		return {
			integratedLufs: iMatch?.[1] ? `${iMatch[1]} LUFS` : 'não medido',
			truePeakDbtp: tpMatch?.[1] ? `${tpMatch[1]} dBFS` : 'não medido',
		};
	} catch {
		return { integratedLufs: 'erro na medição', truePeakDbtp: 'erro na medição' };
	}
}

async function main() {
	mkdirSync(RENDER_DIR, { recursive: true });
	const ckpt = loadCheckpoint(SOURCE_CKPT_DIR);
	if (!ckpt?.extractedPanels || !ckpt?.panelAnalyses || ckpt.panelAnalyses.length === 0) {
		throw new Error(`Checkpoint real não encontrado em ${SOURCE_CKPT_DIR}`);
	}

	const panels = ckpt.extractedPanels;
	const analyses = ckpt.panelAnalyses;

	console.log('[1/4] Gerando roteiro natural_recap conversacional...');
	const continuity = runStoryContinuityEngine({
		chapterId: 'nano-machine-cap-01',
		analyses,
		readingOrder: 'vertical',
		maxPanelsPerBeat: 4,
	});
	const generated = runScriptGenerator({
		sequence: continuity.sequence,
		panels,
		style: 'natural_recap',
		language: 'pt-BR',
		humorVolume: 10,
		generatedBy: 'story-engine-natural_recap',
	});
	const humanized = await runNarrativeHumanizer({
		script: generated.script,
		panels,
		options: {
			enabled: true,
			style: 'natural_recap',
			port: createAgyConversationalHumanizerPort(WORK_DIR),
			maxDurationDeviation: 0.35,
		},
	});
	const finalScript = humanized.script;
	const gateG = humanized.postHumanizeGateG;
	console.log(`[1/4] Cenas: ${finalScript.scenes.length} · Gate G: ${gateG.verdict}`);

	console.log('[2/4] Consolidando Story Memory...');
	const series = createOrLoadStoryMemoryProject({
		workspaceDir: WORK_DIR,
		workTitle: 'Nano Machine',
		defaultScriptStyle: 'natural_recap',
	});
	const memRes = consolidateChapterIntoStoryMemory({
		workspaceDir: WORK_DIR,
		projectId: series.projectId,
		chapterNumber: 1,
		chapterId: 'nano-machine-cap-01',
		analyses,
		sequence: continuity.sequence,
		script: finalScript,
	});

	console.log('[3/4] Executando TTS real + Motion Velix + Render MP4 via FFmpeg...');
	const ttsPorts: RecapTtsSynthesisPort[] = [
		createVoiceStudioRecapTtsPort({ voiceId: process.env['NB_VOICESTUDIO_VOICE_ID'] ?? '9190edfa', pauseAfterMs: 350 }),
	];
	if (process.platform === 'win32') {
		ttsPorts.push(createWindowsSapiRecapTtsPort({ pauseAfterMs: 350 }));
	}
	const chainedTts = createChainedRecapTtsPort({
		ports: ttsPorts,
		allowDeterministicFallback: false,
	});
	const motionVelixKit = resolveMotionVelixKit();

	const renderRes = await renderRecapVideo({
		script: finalScript,
		panels,
		outputDir: RENDER_DIR,
		checkpointDir: join(WORK_DIR, 'phase3-ckpt'),
		ttsPort: chainedTts,
		...(motionVelixKit.sfxDir ? { sfxAssetsDir: motionVelixKit.sfxDir } : {}),
		plannerOptions: {
			aspectRatio: '16:9',
			renderTarget: 'preview',
		},
	});

	console.log('[4/4] Validando sincronização, áudio e efeitos visuais...');
	const mp4Path = renderRes.mp4Path;
	if (!mp4Path || !existsSync(mp4Path)) {
		throw new Error('MP4 final não foi gerado em disco.');
	}
	const probe = await probeMedia(mp4Path);
	const loudness = await measureAudioLoudness(mp4Path);
	const videoStream = probe.streams.find((s) => s.codec_type === 'video');
	const audioStream = probe.streams.find((s) => s.codec_type === 'audio');
	const fileSizeMb = (statSync(mp4Path).size / (1024 * 1024)).toFixed(2);
	const durationSec = Number(probe.format.duration ?? 0).toFixed(2);

	const totalWords = finalScript.scenes
		.map((s) => s.narrationText.trim().split(/\s+/).filter(Boolean).length)
		.reduce((a, b) => a + b, 0);

	const lines: string[] = [
		'# Relatório de Renderização & QA — `natural_recap` Conversacional (Nano Machine Cap. 01)',
		'',
		`- **Data:** ${new Date().toISOString()}`,
		`- **Vídeo final (MP4):** \`${mp4Path}\` (${fileSizeMb} MB · ${durationSec}s)`,
		`- **Story Memory:** projeto \`${memRes.project.projectId}\` (${memRes.project.characters.length} personagem, ${memRes.chapterRecord.events.length} eventos)`,
		`- **Gate G (Fidelidade):** \`${gateG.verdict}\``,
		`- **Gate H (Audiovisual):** \`${renderRes.gateHReport.verdict}\``,
		'',
		'## Roteiro Conversacional Renderizado',
		'',
		`- **Total:** ${finalScript.scenes.length} cenas · ${totalWords} palavras`,
		'',
	];

	for (let i = 0; i < finalScript.scenes.length; i++) {
		const sc = finalScript.scenes[i]!;
		const sceneShots = renderRes.plan.shots.filter((s) => s.sceneId === sc.sceneId);
		const sceneRealSec = (sceneShots.reduce((acc, s) => acc + s.durationMs, 0) / 1000).toFixed(1);
		lines.push(`### Cena ${String(i + 1).padStart(2, '0')} (${sc.panelIds.length} painéis · real ${sceneRealSec}s · est. ${sc.estimatedDurationSec}s)`);
		lines.push(`> ${sc.narrationText}`);
		lines.push('');
		lines.push('**Sincronização de painéis (shots):**');
		for (const sh of sceneShots) {
			lines.push(`- \`${sh.shotId}\` (\`${sh.panelId}\`): ${(sh.startMs / 1000).toFixed(1)}s → ${(sh.endMs / 1000).toFixed(1)}s (${(sh.durationMs / 1000).toFixed(1)}s) · Motion: \`${sh.motionStyle}\` · Transição: \`${sh.transitionIn}\``);
		}
		lines.push('');
	}

	lines.push('## Validação Técnica Pós-Render');
	lines.push('');
	lines.push(`- **Vídeo:** ${videoStream?.codec_name ?? 'n/a'} · ${videoStream?.width}×${videoStream?.height} · FPS ${videoStream?.r_frame_rate ?? 'n/a'}`);
	lines.push(`- **Áudio:** ${audioStream?.codec_name ?? 'n/a'} · ${audioStream?.sample_rate ?? 'n/a'} Hz · ${audioStream?.channels ?? 'n/a'} canais`);
	lines.push(`- **Loudness real:** ${loudness.integratedLufs} · **True Peak:** ${loudness.truePeakDbtp}`);
	lines.push(`- **Sincronização Audio-First:** narração medida=${(renderRes.plan.durationAudit.measuredNarrationDurationMs / 1000).toFixed(1)}s · timeline=${(renderRes.plan.totalDurationMs / 1000).toFixed(1)}s · narração completa preservada=${renderRes.plan.durationAudit.completeNarrationPreserved}`);
	lines.push(`- **Motion Velix:** engine=\`${renderRes.motionVelix.engine}\` · SFX=${renderRes.motionVelix.sfxApplied}/${renderRes.motionVelix.sfxPlanned} (${renderRes.motionVelix.sfxKindsApplied.join(', ')}) · VFX shots=${renderRes.motionVelix.vfxAppliedShots} · Transições=${renderRes.motionVelix.transitionsApplied}`);
	lines.push('');

	writeFileSync(REPORT_PATH, lines.join('\n'), 'utf-8');
	console.log(lines.join('\n'));
}

main().catch((err) => {
	console.error('[NATURAL-RENDER-QA] Erro:', err);
	process.exit(1);
});
