/**
 * Validação do estilo natural_recap — Gera SOMENTE O ROTEIRO (sem TTS nem render MP4)
 * para os 6 painéis reais de Nano Machine Cap. 01, reutilizando o checkpoint real de análises visuais
 * e comparando com o roteiro anterior (prolixo / ~5 min).
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
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
	sanitizeErrorMessage,
	type TextEnhancementPort,
} from '../packages/cinema/src/recap/index.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const WORK_DIR = join(REPO_ROOT, '.aethera-recap-data', 'story-engine-e2e-real');
const CHECKPOINT_DIR = join(WORK_DIR, 'checkpoints', 'nano-machine-cap-01');
const COMPARISON_REPORT = join(REPO_ROOT, 'docs', 'recap-natural-script-comparison.md');

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

function createAgyNaturalHumanizerPort(cwd: string): TextEnhancementPort {
	return {
		name: 'antigravity-natural-humanizer',
		async enhance(req) {
			try {
				const prompt = [
					req.systemPrompt,
					'',
					'Reescreva em 1 a 3 frases curtas, naturais e diretas em português brasileiro, como um criador de conteúdo contando a história.',
					'NÃO descreva roupas, cabelo, enquadramento, iluminação ou detalhes visuais desnecessários.',
					'NÃO repita o mesmo acontecimento.',
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

async function main() {
	const ckpt = loadCheckpoint(CHECKPOINT_DIR);
	if (!ckpt || !ckpt.extractedPanels || !ckpt.panelAnalyses || ckpt.panelAnalyses.length === 0) {
		throw new Error(`Checkpoint real não encontrado em ${CHECKPOINT_DIR}`);
	}

	const panels = ckpt.extractedPanels;
	const analyses = ckpt.panelAnalyses;

	// 1. Continuidade com novo agrupamento inteligente
	const continuity = runStoryContinuityEngine({
		chapterId: 'nano-machine-cap-01',
		analyses,
		readingOrder: 'vertical',
		maxPanelsPerBeat: 4,
	});

	// 2. Roteiro natural_recap (sem renderizar vídeo)
	const generated = runScriptGenerator({
		sequence: continuity.sequence,
		panels,
		style: 'natural_recap',
		language: 'pt-BR',
		humorVolume: 10,
		generatedBy: 'story-engine-natural_recap',
	});

	const preGateG = runGateGNarrativeFidelity({
		script: generated.script,
		panels,
	});

	// 3. Humanizer real focado em concisão e naturalidade
	const humanized = await runNarrativeHumanizer({
		script: generated.script,
		panels,
		options: {
			enabled: true,
			style: 'natural_recap',
			port: createAgyNaturalHumanizerPort(WORK_DIR),
			maxDurationDeviation: 0.2,
		},
	});

	// 4. Consolidar no Story Memory do workspace de validação
	const memoryWorkspace = join(WORK_DIR, 'story-memory-validation');
	mkdirSync(memoryWorkspace, { recursive: true });
	const series = createOrLoadStoryMemoryProject({
		workspaceDir: memoryWorkspace,
		workTitle: 'Nano Machine',
		defaultScriptStyle: 'natural_recap',
	});
	const memResult = consolidateChapterIntoStoryMemory({
		workspaceDir: memoryWorkspace,
		projectId: series.projectId,
		chapterNumber: 1,
		chapterId: 'nano-machine-cap-01',
		analyses,
		sequence: continuity.sequence,
		script: humanized.script,
	});

	const totalWords = humanized.script.scenes
		.map((s) => s.narrationText.trim().split(/\s+/).filter(Boolean).length)
		.reduce((a, b) => a + b, 0);

	const reportLines: string[] = [
		'# Comparação de Roteiro — `narrative_recap` (anterior) vs `natural_recap` (novo)',
		'',
		'- **Obra:** Nano Machine — Capítulo 01 (6 painéis reais, somente roteiro — sem TTS/render)',
		`- **Anterior (\`narrative_recap\`):** 6 cenas · ~650 palavras · duração estimada ~340s (~5m40s)`,
		`- **Novo (\`natural_recap\`):** ${humanized.script.scenes.length} cenas · ${totalWords} palavras · duração estimada ~${humanized.script.totalEstimatedDurationSec}s`,
		`- **Gate G (pré-Humanizer):** \`${preGateG.verdict}\` · **Gate G (final):** \`${humanized.postHumanizeGateG.verdict}\``,
		`- **Story Memory consolidada:** ${memResult.project.characters.length} personagem(ns) (\`${memResult.project.characters.map((c) => `${c.characterId}:${c.nameStatus}`).join(', ')}\`), ${memResult.chapterRecord.events.length} evento(s)`,
		'',
		'## Novo Roteiro (`natural_recap`) — Para Aprovação Antes de TTS/Render',
		'',
	];

	for (let i = 0; i < humanized.script.scenes.length; i++) {
		const sc = humanized.script.scenes[i]!;
		reportLines.push(`### Cena ${String(i + 1).padStart(2, '0')} (${sc.panelIds.length} painéis: ${sc.panelIds.join(', ')}) — estimada ~${sc.estimatedDurationSec}s`);
		reportLines.push('');
		reportLines.push(`> ${sc.narrationText}`);
		reportLines.push('');
	}

	writeFileSync(COMPARISON_REPORT, reportLines.join('\n'), 'utf-8');
	console.log(reportLines.join('\n'));
}

main().catch((err) => {
	console.error('[NATURAL-SCRIPT] Erro:', err);
	process.exit(1);
});
