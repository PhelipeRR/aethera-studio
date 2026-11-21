/**
 * Real E2E Comparison: Current Pipeline vs Manga Vision Analyst Skill
 *
 * Uses the exact same 6 real panels of Nano Machine Cap. 01.
 * Evaluates:
 *   1. Action fidelity
 *   2. Dialogue recovery (originalText, kind, readingOrder, speaker)
 *   3. Character identification consistency
 *   4. Continuity & sequence consolidation
 *   5. Unnecessary details (camera jargon & repetitive traits)
 *   6. Final natural_recap script quality & Quality Gate verdicts
 */

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
	AgentCircuitBreaker,
	MANGA_VISION_ANALYST_SCHEMA_VERSION,
	MANGA_VISION_ANALYST_VERSION,
	buildMangaVisionAnalystPrompt,
	classifyVisionError,
	createMangaVisionVisionAdapter,
	createRecapVisionAdapter,
	detectProviderErrorInText,
	loadCheckpoint,
	parseMangaVisionContractPayload,
	runGateGNarrativeFidelity,
	runScriptGenerator,
	runStoryContinuityEngine,
	runStoryEngine,
	sanitizeErrorMessage,
	type PanelAnalysis,
	type RecapVisualAnalysisPort,
	type StructuredVisionPayload,
} from '../packages/cinema/src/recap/index.js';

function spawnCli(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`CLI timeout after ${timeoutMs}ms: ${cmd}`));
		}, timeoutMs);
		child.stdout.on('data', (d) => { stdout += String(d); });
		child.stderr.on('data', (d) => { stderr += String(d); });
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`CLI exited with code ${code}: ${stderr || stdout}`));
		});
	});
}

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const BASELINE_WORK_DIR = join(REPO_ROOT, '.aethera-recap-data', 'story-engine-e2e-real');
const BASELINE_CHECKPOINT_DIR = join(BASELINE_WORK_DIR, 'checkpoints', 'nano-machine-cap-01');
const NEW_WORK_DIR = join(REPO_ROOT, '.aethera-recap-data', 'manga-vision-analyst-e2e');
const NEW_OUTPUT_DIR = join(NEW_WORK_DIR, 'output');
const NEW_CHECKPOINT_DIR = join(NEW_WORK_DIR, 'checkpoints', 'nano-machine-cap-01');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'recap-manga-vision-analyst-comparison.md');

const JARGON_COUNT_REGEX = /\b(plano\s+(geral|m[ée]dio|fechado|superfechado|detalhe)|plong[ée]e|close-up|painel\s+vertical|enquadramento|primeiro\s+plano|linhas\s+(verticais\s+)?de\s+velocidade)\b/gi;
const REPETITIVE_APPEARANCE_REGEX = /\b(cabelos\s+escuros|t[úu]nica\s+clara|faixa\s+roxa)\b/gi;

function countRegexMatches(text: string, re: RegExp): number {
	const m = text.match(re);
	return m ? m.length : 0;
}

function contractToStructuredPayload(contract: NonNullable<ReturnType<typeof parseMangaVisionContractPayload>>): StructuredVisionPayload {
	return {
		nature: contract.actions[0]?.type ?? 'observation',
		natureConfidence: contract.confidence,
		description: contract.narrativeSummary,
		frames: [
			{
				atMs: 0,
				observed: contract.narrativeSummary,
				visibleText: contract.speechBubbles.map((b) => ({ text: b.originalText, region: 'center' })),
			},
		],
		entities: contract.characters.map((c) => ({
			name: c.idOrLabel,
			type: 'character',
			basis: c.basis,
			evidence: c.evidence,
			confidence: c.confidence,
		})),
		actions: contract.actions.map((a) => ({
			description: a.description,
			basis: a.basis,
			confidence: a.confidence,
		})),
		environment: contract.environment
			? {
					description: contract.environment.setting,
					basis: contract.environment.basis,
					confidence: contract.environment.confidence,
				}
			: null,
		overlays: {
			burnedText: contract.speechBubbles.length > 0,
			burnedTextRegion: contract.speechBubbles.length > 0 ? 'center' : null,
			watermark: false,
			webcam: false,
		},
		limitations: contract.uncertainties,
		confidence: contract.confidence,
		speechBubbles: contract.speechBubbles.map((b) => ({
			text: b.translatedText?.trim() || b.originalText,
			originalText: b.originalText,
			...(b.translatedText?.trim() ? { translatedText: b.translatedText.trim() } : {}),
			kind: b.kind,
			isNarration: b.kind === 'narration',
			readingOrder: b.readingOrder,
			...(b.speaker && b.speakerConfidence >= 0.4 ? { speaker: b.speaker } : {}),
			...(b.uncertainty ? { uncertainty: b.uncertainty } : {}),
		})),
		expressions: contract.expressions,
		relevantObjects: contract.relevantObjects,
		...(contract.relationToPrevious ? { relationToPrevious: contract.relationToPrevious } : {}),
		...(contract.relationToNext ? { relationToNext: contract.relationToNext } : {}),
	};
}

function buildContractInstruction(context?: string): string {
	const base = buildMangaVisionAnalystPrompt({ readingOrder: 'vertical', workTitle: 'Nano Machine' });
	return [
		base,
		context ? `Contexto adicional:\n${context}` : '',
		'',
		'Responda APENAS JSON válido (sem markdown) no formato:',
		`{`,
		`  "schemaVersion": ${MANGA_VISION_ANALYST_SCHEMA_VERSION},`,
		`  "narrativeSummary": "resumo natural em PT-BR sem jargões de câmera",`,
		`  "characters": [{"idOrLabel": "nome ou papel", "expression": "expressão", "poseOrAction": "ação", "basis": "observed", "evidence": "evidência visual", "confidence": 0.9}],`,
		`  "actions": [{"type": "movement|dialogue|combat|reaction|observation|transformation|interaction", "actor": "quem age", "description": "ação concreta", "basis": "observed", "confidence": 0.9}],`,
		`  "speechBubbles": [{"kind": "dialogue|thought|narration|sfx", "originalText": "texto original", "translatedText": "tradução PT-BR", "readingOrder": 0, "speaker": "falante ou null", "speakerConfidence": 0.8, "attributionBasis": "tail_pointing|proximity|context|uncertain"}],`,
		`  "expressions": ["expressão"],`,
		`  "emotions": ["tension"],`,
		`  "environment": {"setting": "local", "basis": "observed", "confidence": 0.85},`,
		`  "relevantObjects": ["objeto"],`,
		`  "relationToPrevious": "ligação com painel anterior ou null",`,
		`  "relationToNext": "ligação com próximo painel ou null",`,
		`  "visualEvidence": [{"kind": "visual_observation", "detail": "evidência", "confidence": 0.9}],`,
		`  "uncertainties": [],`,
		`  "confidence": 0.9`,
		`}`,
	]
		.filter(Boolean)
		.join('\n');
}

function createCodexMangaProvider(cwd: string): RecapVisualAnalysisPort {
	return {
		id: 'codex',
		model: 'codex-cli',
		async detect() {
			try {
				await spawnCli('cmd.exe', ['/c', 'codex', '--version'], cwd, 8000);
				return { available: true };
			} catch (err) {
				return { available: false, reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
			}
		},
		async analyze(input) {
			const imgPath = input.frames[0]!.path;
			const prompt = buildContractInstruction(input.context);
			const { stdout, stderr } = await spawnCli(
				'cmd.exe',
				['/c', 'codex', 'exec', '--sandbox', 'read-only', '--image', imgPath, prompt],
				cwd,
				90_000,
			);
			const combined = [stderr, stdout].filter(Boolean).join('\n');
			const detErr = detectProviderErrorInText(combined, 'codex');
			if (detErr) throw detErr;
			const contract = parseMangaVisionContractPayload(stdout);
			if (!contract) {
				throw classifyVisionError(`Codex returned invalid contract JSON: ${stdout.slice(0, 200)}`, 'codex', 'INVALID_MODEL_RESPONSE');
			}
			return contractToStructuredPayload(contract);
		},
	};
}

function createAgyMangaProvider(cwd: string): RecapVisualAnalysisPort {
	return {
		id: 'antigravity',
		model: 'agy-cli',
		async detect() {
			try {
				await spawnCli('agy', ['--version'], cwd, 8000);
				return { available: true };
			} catch (err) {
				return { available: false, reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
			}
		},
		async analyze(input) {
			const imgPath = input.frames[0]!.path.replace(/\\/g, '/');
			const prompt = `Leia a imagem em ${imgPath} e analise este painel de manga/manhwa em PT-BR. ${buildContractInstruction(input.context).replace(/\s+/g, ' ')}`;
			let stdout = '';
			let stderr = '';
			try {
				const out = await spawnCli(
					'agy',
					['--output-format', 'text', '--mode', 'plan', '--print', prompt],
					cwd,
					120_000,
				);
				stdout = out.stdout;
				stderr = out.stderr;
			} catch (err) {
				console.error('[agy analyze error]:', err instanceof Error ? err.message : String(err));
				throw err;
			}
			const combined = [stderr, stdout].filter(Boolean).join('\n');
			const detErr = detectProviderErrorInText(combined, 'antigravity');
			if (detErr) throw detErr;
			const contract = parseMangaVisionContractPayload(stdout);
			if (!contract) {
				console.error('Antigravity raw stdout:', stdout.slice(0, 400));
				throw classifyVisionError(`Antigravity returned invalid contract JSON: ${stdout.slice(0, 200)}`, 'antigravity', 'INVALID_MODEL_RESPONSE');
			}
			return contractToStructuredPayload(contract);
		},
	};
}

function summarizeMetrics(label: string, analyses: readonly PanelAnalysis[], scriptText: string, sceneCount: number) {
	const totalDialogues = analyses.reduce((acc, a) => acc + a.dialogues.length, 0);
	const substantiveDialogues = analyses.reduce(
		(acc, a) => acc + a.dialogues.filter((d) => (d.kind ?? 'dialogue') !== 'sfx').length,
		0,
	);
	const uniqueCharacters = [...new Set(analyses.flatMap((a) => a.characters))];
	const avgConfidence = analyses.reduce((acc, a) => acc + a.analysisConfidence, 0) / Math.max(1, analyses.length);
	const rawVisualBlob = analyses.map((a) => a.visualDescription ?? '').join(' ');
	const jargonInAnalyses = countRegexMatches(rawVisualBlob, JARGON_COUNT_REGEX);
	const jargonInScript = countRegexMatches(scriptText, JARGON_COUNT_REGEX);
	const repetitiveTraitsInAnalyses = countRegexMatches(rawVisualBlob, REPETITIVE_APPEARANCE_REGEX);
	const repetitiveTraitsInScript = countRegexMatches(scriptText, REPETITIVE_APPEARANCE_REGEX);
	const wordCount = scriptText.trim().split(/\s+/).filter(Boolean).length;

	return {
		label,
		panelCount: analyses.length,
		sceneCount,
		wordCount,
		totalDialogues,
		substantiveDialogues,
		uniqueCharacters,
		avgConfidence: Number(avgConfidence.toFixed(3)),
		jargonInAnalyses,
		jargonInScript,
		repetitiveTraitsInAnalyses,
		repetitiveTraitsInScript,
	};
}

async function main() {
	const baselineCkpt = loadCheckpoint(BASELINE_CHECKPOINT_DIR);
	if (!baselineCkpt?.extractedPanels || !baselineCkpt.panelAnalyses?.length) {
		throw new Error(`Baseline checkpoint not found in ${BASELINE_CHECKPOINT_DIR}`);
	}

	const panels = baselineCkpt.extractedPanels;
	const beforeAnalyses = baselineCkpt.panelAnalyses as PanelAnalysis[];

	// 1. Before: current baseline analyses -> natural_recap
	const beforeContinuity = runStoryContinuityEngine({
		chapterId: 'nano-machine-cap-01',
		analyses: beforeAnalyses,
		readingOrder: 'vertical',
		maxPanelsPerBeat: 4,
	});
	const beforeScriptRes = runScriptGenerator({
		sequence: beforeContinuity.sequence,
		panels,
		style: 'natural_recap',
		language: 'pt-BR',
		humorVolume: 10,
		generatedBy: 'baseline-story-engine',
	});
	const beforeGateG = runGateGNarrativeFidelity({
		script: beforeScriptRes.script,
		panels,
	});
	const beforeScriptText = beforeScriptRes.script.scenes.map((s) => s.narrationText).join(' ');
	const beforeMetrics = summarizeMetrics('Antes (Pipeline Atual)', beforeAnalyses, beforeScriptText, beforeScriptRes.script.scenes.length);

	// 2. After: real multimodal analysis using MangaVisionAnalyst + StoryEngine
	if (existsSync(NEW_CHECKPOINT_DIR)) {
		rmSync(NEW_CHECKPOINT_DIR, { recursive: true, force: true });
	}
	mkdirSync(NEW_OUTPUT_DIR, { recursive: true });
	mkdirSync(NEW_CHECKPOINT_DIR, { recursive: true });

	const circuitBreaker = new AgentCircuitBreaker();
	const baseVisionAdapter = createRecapVisionAdapter({
		root: BASELINE_WORK_DIR,
		providers: [createAgyMangaProvider(REPO_ROOT), createCodexMangaProvider(REPO_ROOT)],
		circuitBreaker,
		throwOnAllUnavailable: true,
	});
	const mangaVisionAdapter = createMangaVisionVisionAdapter({
		visionAdapter: baseVisionAdapter,
	});

	console.log(`Running real Manga Vision Analyst (v${MANGA_VISION_ANALYST_VERSION}) on ${panels.length} Nano Machine panels...`);

	const afterRes = await runStoryEngine({
		chapterId: 'nano-machine-cap-01',
		panels,
		outputDir: NEW_OUTPUT_DIR,
		checkpointDir: NEW_CHECKPOINT_DIR,
		visionAdapter: mangaVisionAdapter,
		scriptStyle: 'natural_recap',
		language: 'pt-BR',
		humorVolume: 10,
		workTitle: 'Nano Machine',
		mangaVisionAnalyst: {
			enabled: true,
			consolidateSequences: true,
			qualityGate: true,
			maxPanelsPerSequence: 4,
		},
	});

	const afterTrace = baseVisionAdapter.getLastTrace();
	const afterScriptText = afterRes.script.scenes.map((s) => s.narrationText).join(' ');
	const afterMetrics = summarizeMetrics(
		'Depois (Manga Vision Analyst)',
		afterRes.analyses,
		afterScriptText,
		afterRes.script.scenes.length,
	);

	// 3. Build markdown comparison report
	const reportLines: string[] = [
		`# Comparação Real — Pipeline Atual vs Manga Vision Analyst Skill (Nano Machine Cap. 01)`,
		'',
		`- **Data:** ${new Date().toISOString()}`,
		`- **Skill:** \`aethera-manga-vision-analyst\` v${MANGA_VISION_ANALYST_VERSION} (schema v${MANGA_VISION_ANALYST_SCHEMA_VERSION})`,
		`- **Provedor multimodal usado (último trace):** \`${afterTrace?.provider ?? 'n/a'}\` (${afterTrace?.model ?? 'n/a'})`,
		`- **Painéis reais analisados:** ${panels.length} (${panels.map((p) => p.panelId).join(', ')})`,
		'',
		'## Tabela Comparativa (Antes vs Depois)',
		'',
		'| Métrica | Antes (Pipeline Atual) | Depois (Manga Vision Analyst) |',
		'|---|---:|---:|',
		`| Painéis cobertos | ${beforeMetrics.panelCount}/${panels.length} | ${afterMetrics.panelCount}/${panels.length} |`,
		`| Cenas geradas (\`natural_recap\`) | ${beforeMetrics.sceneCount} | ${afterMetrics.sceneCount} |`,
		`| Palavras no roteiro final | ${beforeMetrics.wordCount} | ${afterMetrics.wordCount} |`,
		`| Falas/balões extraídos (total / substantivos) | ${beforeMetrics.totalDialogues} / ${beforeMetrics.substantiveDialogues} | ${afterMetrics.totalDialogues} / ${afterMetrics.substantiveDialogues} |`,
		`| Identificadores de personagens | ${beforeMetrics.uniqueCharacters.length} (${beforeMetrics.uniqueCharacters.join(', ') || 'nenhum'}) | ${afterMetrics.uniqueCharacters.length} (${afterMetrics.uniqueCharacters.join(', ') || 'nenhum'}) |`,
		`| Confiança média | ${beforeMetrics.avgConfidence} | ${afterMetrics.avgConfidence} |`,
		`| Jargões cinematográficos nas análises | ${beforeMetrics.jargonInAnalyses} | ${afterMetrics.jargonInAnalyses} |`,
		`| Jargões cinematográficos no roteiro | ${beforeMetrics.jargonInScript} | ${afterMetrics.jargonInScript} |`,
		`| Traços repetitivos de roupa/cabelo (análises / roteiro) | ${beforeMetrics.repetitiveTraitsInAnalyses} / ${beforeMetrics.repetitiveTraitsInScript} | ${afterMetrics.repetitiveTraitsInAnalyses} / ${afterMetrics.repetitiveTraitsInScript} |`,
		`| Gate G | \`${beforeGateG.verdict}\` | \`${afterRes.gateGReport.verdict}\` |`,
		`| Manga Vision Quality Gate | n/a | \`${afterRes.mangaQualityGateReport?.verdict ?? 'n/a'}\` (bloqueia produção: \`${afterRes.mangaQualityGateReport?.shouldBlockProduction ?? false}\`) |`,
		'',
		'## Evidências por Painel (Antes vs Depois)',
		'',
	];

	for (let i = 0; i < panels.length; i++) {
		const p = panels[i]!;
		const b = beforeAnalyses[i];
		const a = afterRes.analyses[i];
		reportLines.push(`### ${p.panelId}`);
		reportLines.push(`- **Antes:** ${b?.visualDescription ?? '(sem descrição)'}`);
		reportLines.push(`  - *Personagens:* ${b?.characters.join(', ') || 'nenhum'} | *Falas:* ${b?.dialogues.map((d) => `[${d.kind ?? 'dialogue'}] "${d.text}"`).join('; ') || 'nenhuma'} | *Confiança:* ${b?.analysisConfidence ?? 0}`);
		reportLines.push(`- **Depois:** ${a?.visualDescription ?? '(sem descrição)'}`);
		reportLines.push(`  - *Personagens:* ${a?.characters.join(', ') || 'nenhum'} | *Falas:* ${a?.dialogues.map((d) => `[${d.kind ?? 'dialogue'}${d.speaker ? `:${d.speaker}` : ''}] "${d.text}"`).join('; ') || 'nenhuma'} | *Confiança:* ${a?.analysisConfidence ?? 0}`);
		if (a?.relationToPrevious || a?.relationToNext) {
			reportLines.push(`  - *Continuidade:* anterior="${a.relationToPrevious ?? '-'}" | próximo="${a.relationToNext ?? '-'}"`);
		}
		reportLines.push('');
	}

	reportLines.push('## Consolidação por Sequência (Nova Skill)');
	reportLines.push('');
	for (const grp of afterRes.sequenceGroups ?? []) {
		reportLines.push(`- **${grp.groupId}** (${grp.panelIds.join(', ')}): ${grp.consolidatedNarrative}`);
	}
	reportLines.push('');

	reportLines.push('## Roteiro Final (`natural_recap`) — Antes vs Depois');
	reportLines.push('');
	reportLines.push('### Antes');
	for (const s of beforeScriptRes.script.scenes) {
		reportLines.push(`- **${s.sceneId}** (${s.panelIds.join(', ')}): ${s.narrationText}`);
	}
	reportLines.push('');
	reportLines.push('### Depois (Manga Vision Analyst)');
	for (const s of afterRes.script.scenes) {
		reportLines.push(`- **${s.sceneId}** (${s.panelIds.join(', ')}): ${s.narrationText}`);
	}
	reportLines.push('');

	if (afterRes.mangaQualityGateReport) {
		reportLines.push('## Manga Vision Quality Gate');
		reportLines.push('');
		reportLines.push(`- **Veredito:** \`${afterRes.mangaQualityGateReport.verdict}\` — ${afterRes.mangaQualityGateReport.summary}`);
		for (const item of afterRes.mangaQualityGateReport.reviewItems) {
			reportLines.push(`  - [${item.severity}] \`${item.panelId}\` (${item.dimension}): ${item.reason} → *${item.suggestedAction}*`);
		}
		reportLines.push('');
	}

	writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf-8');
	console.log(`Comparison report written to ${REPORT_PATH}`);
	console.log('BEFORE:', JSON.stringify(beforeMetrics));
	console.log('AFTER:', JSON.stringify(afterMetrics));
}

main().catch((err) => {
	console.error('E2E Manga Vision Analyst failed:', err);
	if (err && typeof err === 'object' && 'diagnostics' in err) {
		console.error('Diagnostics:', JSON.stringify((err as { diagnostics: unknown }).diagnostics, null, 2));
	}
	process.exit(1);
});
