/**
 * Fase 10 — Teste End-to-End Real do Story Engine (Nano Machine Cap. 01)
 *
 * Sem mocks e sem textos fictícios. Executa:
 *   1. Importação real do CBZ + extração de painéis + Gate F
 *   2. Visão multimodal real com fallback (Claude CLI → Codex CLI → Antigravity CLI)
 *   3. Extração estruturada de diálogos/balões (VLM + OCR opcional)
 *   4. Continuidade narrativa + Geração de roteiro grounded + Gate G inicial
 *   5. Humanizer real (via Claude/Codex CLI) + comparação pré vs pós + Gate G final
 *   6. TTS real (VoiceStudio / Windows SAPI — sem fallback sintético)
 *   7. Motion Velix + Renderização MP4 real via FFmpeg + Gate H
 *   8. Relatório markdown com evidências por cena em docs/recap-story-engine-e2e-report.md
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';

import {
	importChapter,
	extractPanels,
	runGateFPanelIntegrity,
	createRecapVisionAdapter,
	runStoryEngine,
	renderRecapVideo,
	resolveMotionVelixKit,
	createChainedRecapTtsPort,
	createVoiceStudioRecapTtsPort,
	createWindowsSapiRecapTtsPort,
	AgentCircuitBreaker,
	sanitizeErrorMessage,
	classifyVisionError,
	detectProviderErrorInText,
	type RecapVisualAnalysisPort,
	type RecapTtsSynthesisPort,
	type TextEnhancementPort,
} from '../packages/cinema/src/recap/index.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const CBZ_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'real-manga', 'Nano-Machine-Capitulo-01.cbz');
const WORK_DIR = join(REPO_ROOT, '.aethera-recap-data', 'story-engine-e2e-real');
const OUTPUT_DIR = join(WORK_DIR, 'output');
const CHECKPOINT_DIR = join(WORK_DIR, 'checkpoints', 'nano-machine-cap-01');
const RENDER_DIR = join(WORK_DIR, 'render');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'recap-story-engine-e2e-report.md');

const MAX_PANELS = Number(process.env['NB_RECAP_E2E_MAX_PANELS'] ?? '6');
const CHAPTER_ID = 'nano-machine-cap-01';

const MANGA_VISION_PROMPT = `Analise este painel de mangá/manhwa em português brasileiro. Responda APENAS JSON válido sem markdown:
{
  "nature": "dialogue|action|combat|movement|reaction|observation|establishing|transformation",
  "description": "descrição visual concreta e fiel do que acontece no painel em PT-BR",
  "characters": ["identificador consistente do personagem"],
  "actions": ["ação observável concreta"],
  "emotions": ["neutral|joy|sadness|anger|fear|surprise|determination|tension|relief|confusion"],
  "expressions": ["expressão observada"],
  "relevantObjects": ["objeto relevante visível"],
  "setting": "cenário e localização observáveis",
  "speechBubbles": [
    {
      "originalText": "texto exato do balão/caixa",
      "translatedText": "tradução fiel em PT-BR",
      "speaker": "personagem que fala ou null",
      "kind": "dialogue|thought|narration|sfx",
      "readingOrder": 0
    }
  ],
  "uncertainties": [],
  "confidence": 0.85
}
NUNCA invente ações ou falas que não estejam visíveis na imagem.`;

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

function mapRawVisionJson(parsed: Record<string, unknown>) {
	const description = typeof parsed['description'] === 'string' ? parsed['description'] : '';
	const nature = typeof parsed['nature'] === 'string' ? parsed['nature'] : 'observation';
	const confidence = typeof parsed['confidence'] === 'number' ? Math.max(0, Math.min(1, parsed['confidence'])) : 0.7;
	const characters = Array.isArray(parsed['characters']) ? parsed['characters'].filter((c): c is string => typeof c === 'string' && c.trim().length > 0) : [];
	const actionsRaw = Array.isArray(parsed['actions']) ? parsed['actions'].filter((a): a is string => typeof a === 'string' && a.trim().length > 0) : [];
	const relevantObjects = Array.isArray(parsed['relevantObjects']) ? parsed['relevantObjects'].filter((o): o is string => typeof o === 'string' && o.trim().length > 0) : [];
	const expressions = Array.isArray(parsed['expressions']) ? parsed['expressions'].filter((e): e is string => typeof e === 'string' && e.trim().length > 0) : [];
	const uncertainties = Array.isArray(parsed['uncertainties']) ? parsed['uncertainties'].filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : [];
	const setting = typeof parsed['setting'] === 'string' && parsed['setting'].trim() ? parsed['setting'].trim() : undefined;

	const rawBubbles = Array.isArray(parsed['speechBubbles']) ? parsed['speechBubbles'] : [];
	const speechBubbles = rawBubbles
		.map((b, idx) => {
			if (!b || typeof b !== 'object') return null;
			const obj = b as Record<string, unknown>;
			const orig = typeof obj['originalText'] === 'string' ? obj['originalText'].trim() : '';
			const trans = typeof obj['translatedText'] === 'string' ? obj['translatedText'].trim() : '';
			const text = trans || orig || (typeof obj['text'] === 'string' ? obj['text'].trim() : '');
			if (!text) return null;
			const kindRaw = obj['kind'];
			const kind = kindRaw === 'dialogue' || kindRaw === 'thought' || kindRaw === 'narration' || kindRaw === 'sfx' ? kindRaw : 'dialogue';
			return {
				text,
				originalText: orig || text,
				...(trans ? { translatedText: trans } : {}),
				...(typeof obj['speaker'] === 'string' && obj['speaker'].trim() ? { speaker: obj['speaker'].trim() } : {}),
				kind,
				isNarration: kind === 'narration',
				readingOrder: typeof obj['readingOrder'] === 'number' ? obj['readingOrder'] : idx,
			};
		})
		.filter((x): x is NonNullable<typeof x> => x !== null);

	return {
		nature,
		natureConfidence: confidence,
		description,
		frames: [{ atMs: 0, observed: description, visibleText: speechBubbles.map((b) => ({ text: b.originalText, region: 'center' })) }],
		entities: [
			...characters.map((name) => ({ name, type: 'character', basis: 'observed', evidence: description, confidence })),
			...relevantObjects.map((name) => ({ name, type: 'object', basis: 'observed', evidence: description, confidence })),
		],
		actions: actionsRaw.map((a) => ({ description: a, basis: 'observed', confidence })),
		environment: setting ? { description: setting, basis: 'observed', confidence } : null,
		overlays: { burnedText: speechBubbles.length > 0, burnedTextRegion: speechBubbles.length > 0 ? 'center' : null, watermark: false, webcam: false },
		limitations: uncertainties,
		confidence,
		speechBubbles,
		expressions,
		relevantObjects,
	};
}

function createCodexCliVisionPort(cwd: string): RecapVisualAnalysisPort {
	return {
		id: 'codex',
		model: 'codex-cli',
		async detect() {
			try {
				await execFileAsync('cmd.exe', ['/c', 'codex', '--version'], { timeout: 8000, windowsHide: true });
				return { available: true };
			} catch (err) {
				return { available: false, reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
			}
		},
		async analyze(input) {
			const imgPath = input.frames[0]!.path;
			const prompt = `${MANGA_VISION_PROMPT}\n${input.context ? `Contexto: ${input.context}` : ''}`;
			const { stdout, stderr } = await execFileAsync(
				'cmd.exe',
				['/c', 'codex', 'exec', '--sandbox', 'read-only', '--image', imgPath, prompt],
				{ cwd, timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
			);
			const combined = [stderr, stdout].filter(Boolean).join('\n');
			const detErr = detectProviderErrorInText(combined, 'codex');
			if (detErr) throw detErr;
			const parsed = parseJsonLoose(stdout);
			if (!parsed) throw classifyVisionError(`Codex returned non-JSON: ${stdout.slice(0, 200)}`, 'codex', 'INVALID_MODEL_RESPONSE');
			return mapRawVisionJson(parsed);
		},
	};
}

function createAgyCliVisionPort(cwd: string): RecapVisualAnalysisPort {
	return {
		id: 'antigravity',
		model: 'agy-cli',
		async detect() {
			try {
				await execFileAsync('agy', ['--version'], { timeout: 8000, windowsHide: true });
				return { available: true };
			} catch (err) {
				return { available: false, reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
			}
		},
		async analyze(input) {
			const imgPath = input.frames[0]!.path;
			const prompt = `Leia a imagem em "${imgPath}" e analise este painel de mangá/manhwa em PT-BR. ${MANGA_VISION_PROMPT.replace(/\s+/g, ' ')} ${input.context ? `Contexto: ${input.context}` : ''}`;
			const { stdout, stderr } = await execFileAsync(
				'agy',
				['--output-format', 'text', '--mode', 'plan', '--print', prompt],
				{ cwd, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
			);
			const combined = [stderr, stdout].filter(Boolean).join('\n');
			const detErr = detectProviderErrorInText(combined, 'antigravity');
			if (detErr) throw detErr;
			const parsed = parseJsonLoose(stdout);
			if (!parsed || !parsed['description']) {
				throw classifyVisionError(`Antigravity returned invalid vision JSON: ${stdout.slice(0, 200)}`, 'antigravity', 'INVALID_MODEL_RESPONSE');
			}
			return mapRawVisionJson(parsed);
		},
	};
}

function createCliHumanizerPort(cwd: string): TextEnhancementPort {
	return {
		name: 'antigravity-humanizer',
		async enhance(req) {
			try {
				const fullPrompt = `${req.systemPrompt}\n\nTexto original:\n${req.text}\n\nContexto:\n${JSON.stringify(req.context)}`;
				const { stdout } = await execFileAsync(
					'agy',
					['--output-format', 'text', '--mode', 'plan', '--print', fullPrompt],
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

function log(stage: string, msg: string) {
	console.log(`[${new Date().toISOString().slice(11, 19)}] [${stage}] ${msg}`);
}

async function main() {
	if (!existsSync(CBZ_PATH)) {
		throw new Error(`CBZ real não encontrado: ${CBZ_PATH}`);
	}
	mkdirSync(OUTPUT_DIR, { recursive: true });
	mkdirSync(CHECKPOINT_DIR, { recursive: true });
	mkdirSync(RENDER_DIR, { recursive: true });

	// 1. Importar CBZ real e extrair painéis
	log('IMPORT', `Importando ${CBZ_PATH}`);
	const imported = await importChapter({
		chapterId: CHAPTER_ID,
		archivePath: CBZ_PATH,
		outputDir: OUTPUT_DIR,
		readingOrder: 'vertical',
	});
	const extracted = await extractPanels({
		chapter: imported,
		outputDir: OUTPUT_DIR,
	});
	const samplePanels = extracted.panels.slice(0, MAX_PANELS);
	const gateF = runGateFPanelIntegrity({
		panels: samplePanels,
		minOcrConfidence: 0,
		expectedReadingOrder: 'vertical',
	});
	log('GATE-F', `Veredicto: ${gateF.verdict} (${samplePanels.length}/${extracted.panels.length} painéis)`);
	if (gateF.verdict === 'fail') {
		throw new Error(`Gate F falhou: ${gateF.reasons.join('; ')}`);
	}

	// 2. Montar cadeia multimodal real com circuit breaker (agy operacional primeiro, fallback codex)
	const circuitBreaker = new AgentCircuitBreaker();
	const visionAdapter = createRecapVisionAdapter({
		root: WORK_DIR,
		providers: [createAgyCliVisionPort(WORK_DIR), createCodexCliVisionPort(WORK_DIR)],
		circuitBreaker,
		throwOnAllUnavailable: true,
	});

	// 3. Executar Story Engine completo (Visão + Diálogos + Continuidade + Roteiro + Gate G + Humanizer)
	log('STORY', `Executando Story Engine em ${samplePanels.length} painéis reais...`);
	const storyResult = await runStoryEngine({
		chapterId: CHAPTER_ID,
		workTitle: 'Nano Machine',
		panels: samplePanels,
		outputDir: join(WORK_DIR, 'story'),
		checkpointDir: CHECKPOINT_DIR,
		visionAdapter,
		scriptStyle: 'narrative_recap',
		language: 'pt-BR',
		humorVolume: 15,
		analysisConcurrency: 1,
		humanize: {
			enabled: true,
			style: 'narrative_recap',
			port: createCliHumanizerPort(WORK_DIR),
			maxDurationDeviation: 0.35,
		},
	});

	log('STORY', `Cenas: ${storyResult.script.scenes.length} · Gate G pré: ${storyResult.preHumanizeGateG?.verdict ?? 'n/a'} · Gate G final: ${storyResult.gateGReport.verdict}`);

	// 4. TTS real + Motion Velix + Render MP4 real via FFmpeg + Gate H
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

	let renderResult: Awaited<ReturnType<typeof renderRecapVideo>> | null = null;
	let renderError: string | null = null;

	if (storyResult.gateGReport.verdict !== 'fail') {
		log('RENDER', 'Executando TTS real + MotionVelix + FFmpeg...');
		try {
			renderResult = await renderRecapVideo({
				script: storyResult.script,
				panels: samplePanels,
				outputDir: RENDER_DIR,
				checkpointDir: join(CHECKPOINT_DIR, 'phase3'),
				ttsPort: chainedTts,
				...(motionVelixKit.sfxDir ? { sfxAssetsDir: motionVelixKit.sfxDir } : {}),
				plannerOptions: {
					aspectRatio: '16:9',
					renderTarget: 'preview',
				},
			});
			log('RENDER', `MP4: ${renderResult.mp4Path} · Gate H: ${renderResult.gateHReport.verdict} · Duração: ${renderResult.plan.totalDurationMs}ms`);
		} catch (err) {
			renderError = err instanceof Error ? err.message : String(err);
			log('RENDER', `Erro no render: ${renderError}`);
		}
	} else {
		renderError = `Render bloqueado pelo Gate G (${storyResult.gateGReport.reasons.join('; ')})`;
	}

	// 5. Gerar relatório markdown com evidências por cena
	const lines: string[] = [
		'# Relatório E2E Real — Story Engine Aethera Recap (Nano Machine Cap. 01)',
		'',
		`- **Data:** ${new Date().toISOString()}`,
		`- **Arquivo fonte:** \`tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz\``,
		`- **Painéis analisados:** ${samplePanels.length} (de ${extracted.panels.length} extraídos)`,
		`- **Gate F:** \`${gateF.verdict}\``,
		`- **Gate G (pré-Humanizer):** \`${storyResult.preHumanizeGateG?.verdict ?? 'n/a'}\``,
		`- **Gate G (final):** \`${storyResult.gateGReport.verdict}\``,
		`- **Humanizer:** ${storyResult.humanizeResult ? `${storyResult.humanizeResult.agentId} (skipped=${storyResult.humanizeResult.skipped})` : 'não executado'}`,
		`- **Gate H (audiovisual):** \`${renderResult?.gateHReport.verdict ?? 'não executado'}\``,
		`- **MotionVelix aplicado:** ${renderResult ? `sim (engine=${renderResult.motionVelix.engine}, sfx=${renderResult.motionVelix.sfxApplied}/${renderResult.motionVelix.sfxPlanned}, vfxShots=${renderResult.motionVelix.vfxAppliedShots})` : 'não'}`,
		`- **MP4 gerado:** ${renderResult?.mp4Path ? `\`${renderResult.mp4Path}\`` : `não (${renderError ?? 'n/a'})`}`,
		'',
		'## Estado de Continuidade Narrativa (Fase 4)',
		'',
		`- **Personagens rastreados:** ${storyResult.sequence.continuityState?.characters.map((c) => c.name).join(', ') || 'nenhum'}`,
		`- **Localização atual:** ${storyResult.sequence.continuityState?.currentLocation ?? 'não identificada'}`,
		`- **Conflito em andamento:** ${storyResult.sequence.continuityState?.ongoingConflict ?? 'nenhum'}`,
		`- **Perguntas em aberto:** ${storyResult.sequence.continuityState?.openQuestions.join(' | ') || 'nenhuma'}`,
		'',
		'## Evidências por Cena',
		'',
	];

	const measuredMsByScene = new Map<string, number>();
	for (const shot of renderResult?.plan.shots ?? []) {
		measuredMsByScene.set(shot.sceneId, (measuredMsByScene.get(shot.sceneId) ?? 0) + shot.durationMs);
	}
	const diffByScene = new Map((storyResult.humanizeResult?.diffs ?? []).map((d) => [d.sceneId, d]));

	for (let i = 0; i < storyResult.script.scenes.length; i++) {
		const scene = storyResult.script.scenes[i]!;
		const measuredMs = measuredMsByScene.get(scene.sceneId);
		const diff = diffByScene.get(scene.sceneId);
		const realDurSec = measuredMs ? `${(measuredMs / 1000).toFixed(1)}s` : 'n/a';

		lines.push(`### Cena ${String(i + 1).padStart(2, '0')} — \`${scene.sceneId}\``);
		lines.push(`- **Painéis:** ${scene.panelIds.join(', ')}`);
		lines.push(`- **Personagens:** ${scene.characters.join(', ') || 'nenhum identificado'}`);
		lines.push(`- **Cenário:** ${scene.setting ?? 'não especificado'}`);
		lines.push(`- **Confiança:** ${Math.round(scene.confidence * 100)}% · **Status:** \`${scene.reviewStatus}\``);
		lines.push(`- **Duração estimada:** ${scene.estimatedDurationSec}s · **Duração real (TTS/Timeline):** ${realDurSec}`);
		lines.push(`- **Análise visual:** ${scene.visualSummary ?? scene.eventDescription}`);
		if (scene.extractedDialogues && scene.extractedDialogues.length > 0) {
			lines.push('- **Balões/textos extraídos:**');
			for (const d of scene.extractedDialogues) {
				lines.push(`  - [${(d.kind ?? 'dialogue').toUpperCase()}]${d.speaker ? ` **${d.speaker}:**` : ''} "${d.translatedText ?? d.text}"${d.originalText && d.translatedText && d.originalText !== d.translatedText ? ` *(orig.: "${d.originalText}")*` : ''}`);
			}
		} else {
			lines.push('- **Balões/textos extraídos:** nenhum balão legível neste grupo de painéis');
		}
		if (diff) {
			lines.push(`- **Narração pré-Humanizer:** ${diff.originalText}`);
			lines.push(`- **Narração pós-Humanizer (${diff.reverted ? `revertida: ${diff.revertReason}` : 'aceita'}):** ${diff.humanizedText}`);
		} else {
			lines.push(`- **Narração gerada:** ${scene.narrationText}`);
		}
		lines.push('');
	}

	writeFileSync(REPORT_PATH, lines.join('\n'), 'utf-8');
	log('REPORT', `Relatório salvo em ${REPORT_PATH}`);
}

main().catch((err) => {
	console.error('[E2E-REAL] Falha:', err);
	process.exit(1);
});
