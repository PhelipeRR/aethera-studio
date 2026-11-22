/**
 * MotionVelix MOGRT Engine: end-to-end validation of a real `.mogrt`, without Adobe.
 *
 * Usage:
 *   npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "C:/path/to/template.mogrt" [--out DIR] [--report FILE.md] [--thumb-time SEC]
 *
 * Exit codes: 0 every check passed (gaps are still listed), 1 a check or the render failed, 2 bad usage.
 * There is no synthetic fallback: without a real file there is nothing to validate.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseAepProjectGraph, type AepControlBinding } from '../packages/cinema/src/motionvelix/aep-comp-graph.js';
import {
	renderMogrtFrameRgba,
	renderMogrtPhase3AToMp4,
	type MogrtPhase3ARenderReport,
	type MogrtRenderOverrides,
} from '../packages/cinema/src/motionvelix/mogrt-comp-renderer.js';
import type { RgbaBuffer } from '../packages/cinema/src/motionvelix/mogrt-effects-pipeline.js';
import { inspectMogrtFile } from '../packages/cinema/src/motionvelix/mogrt-importer.js';
import {
	loadLogoImageRgba,
	rasterizeSvgToPngSync,
	sha256File,
} from '../packages/cinema/src/motionvelix/mogrt-media-loader.js';

/** The frame `thumb.png` was taken from, measured on each file. It is not the saved playhead. */
const KNOWN_THUMB_TIMES: Record<string, number> = {
	'742d296d11a90b0b8b35b5394c7a9404790e128ec6246f92188b36df619d96cc': 2 / 3,
	e3420357df866c9aa0749d4a5baed41fee6b2ee63be3ffc84bdaf1c9b5745552: 16 / 30,
};

const WIDTH = 640;
const HEIGHT = 360;
/** Mean absolute difference, 0..255. An all-black render scores about 58 on model 01. */
const MAX_THUMB_MAE = 20;
const MIN_THUMB_IOU = 0.85;
/** Smallest mean difference that counts as a visible edit. */
const MIN_EDIT_MAE = 0.2;
const TEST_COLOURS = ['#22d3ee', '#fbbf24', '#22c55e', '#ef4444'];

interface Check {
	name: string;
	passed: boolean | null;
	measured: string;
}

interface Variant {
	id: string;
	description: string;
	overrides?: MogrtRenderOverrides;
}

function usageError(message: string): never {
	console.error(`${message}\nUsage: validate-mogrt-phase3a.ts --mogrt FILE [--out DIR] [--report FILE.md] [--thumb-time SEC]`);
	process.exit(2);
}

function readArgs() {
	let values: { mogrt?: string; out?: string; report?: string; 'thumb-time'?: string };
	try {
		({ values } = parseArgs({
			options: {
				mogrt: { type: 'string' },
				out: { type: 'string' },
				report: { type: 'string' },
				'thumb-time': { type: 'string' },
			},
		}));
	} catch (error) {
		return usageError(String(error));
	}
	if (!values.mogrt) return usageError('--mogrt is required.');
	const mogrtPath = resolve(values.mogrt);
	if (!existsSync(mogrtPath)) return usageError(`File not found: ${mogrtPath}`);
	const thumbTime = values['thumb-time'] === undefined ? undefined : Number(values['thumb-time']);
	if (thumbTime !== undefined && !(thumbTime >= 0)) return usageError('--thumb-time must be a number of seconds.');
	const outDir = resolve(values.out ?? join('renders', 'mogrt-phase3a', basename(mogrtPath, '.mogrt')));
	return { mogrtPath, outDir, reportPath: resolve(values.report ?? join(outDir, 'report.md')), thumbTime };
}

function probeMp4(path: string): { durationSec: number; frames: number; codec: string } {
	const raw = execFileSync(
		'ffprobe',
		[
			'-v', 'error', '-select_streams', 'v:0', '-count_frames',
			'-show_entries', 'stream=codec_name,nb_read_frames:format=duration', '-of', 'json', path,
		],
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(raw) as {
		streams?: Array<{ codec_name?: string; nb_read_frames?: string }>;
		format?: { duration?: string };
	};
	return {
		durationSec: Number(parsed.format?.duration ?? 0),
		frames: Number(parsed.streams?.[0]?.nb_read_frames ?? 0),
		codec: parsed.streams?.[0]?.codec_name ?? 'unknown',
	};
}

function overBlack(image: RgbaBuffer, offset: number, channel: number): number {
	return (image.data[offset + channel]! * image.data[offset + 3]!) / 255;
}

/** Compares two images of the same size over black, optionally only between two rows. */
function compare(a: RgbaBuffer, b: RgbaBuffer, fromRow = 0, toRow = a.height): { mae: number; iou: number } {
	let sum = 0;
	let both = 0;
	let either = 0;
	for (let o = fromRow * a.width * 4; o < toRow * a.width * 4; o += 4) {
		let brightA = 0;
		let brightB = 0;
		for (let k = 0; k < 3; k++) {
			const left = overBlack(a, o, k);
			const right = overBlack(b, o, k);
			sum += Math.abs(left - right);
			brightA = Math.max(brightA, left);
			brightB = Math.max(brightB, right);
		}
		if (brightA > 150 && brightB > 150) both++;
		if (brightA > 150 || brightB > 150) either++;
	}
	return { mae: sum / ((toRow - fromRow) * a.width * 3), iou: either ? both / either : 0 };
}

function testLogo(path: string, shape: string): string {
	rasterizeSvgToPngSync(
		`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">${shape}</svg>`,
		path,
		500,
		500,
	);
	return path;
}

function planVariants(controls: AepControlBinding[], workDir: string): Variant[] {
	const variants: Variant[] = [{ id: 'base', description: 'template sem edição' }];
	if (controls.some((control) => control.kind === 'media' && control.layer.kind === 'logo_placeholder')) {
		const a = testLogo(join(workDir, 'logo-a.png'), '<circle cx="250" cy="250" r="220" fill="#6366f1"/>');
		const b = testLogo(join(workDir, 'logo-b.png'), '<path d="M250 25 L475 460 L25 460 Z" fill="#f97316"/>');
		variants.push({ id: 'logo-a', description: 'logo de teste A', overrides: { logoPath: a } });
		variants.push({ id: 'logo-b', description: 'logo de teste B', overrides: { logoPath: b } });
	}

	const edits: MogrtRenderOverrides = {};
	const colours = [...new Set(controls.filter((control) => control.kind === 'color').map((control) => control.name))];
	if (colours.length > 0) {
		edits.controls = Object.fromEntries(colours.map((name, i) => [name, TEST_COLOURS[i % TEST_COLOURS.length]!]));
	}
	const texts = new Set(controls.filter((control) => control.kind === 'text').map((control) => control.layer));
	if (texts.size === 1) edits.textOverride = 'TEXTO EDITADO';
	if (edits.controls || edits.textOverride) {
		variants.push({ id: 'edited', description: 'todas as cores e o texto editados', overrides: edits });
	}
	return variants;
}

function cell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

function table(head: string[], rows: string[][]): string {
	if (rows.length === 0) return 'Nenhum.';
	const lines = [head, head.map(() => ':---'), ...rows.map((row) => row.map(cell))];
	return lines.map((line) => `| ${line.join(' | ')} |`).join('\n');
}

function buildMarkdown(input: {
	file: string;
	sha: string;
	base: MogrtPhase3ARenderReport;
	checks: Check[];
	failed: boolean;
	renders: Array<{ variant: Variant; report: MogrtPhase3ARenderReport; probe: ReturnType<typeof probeMp4> }>;
}): string {
	const { file, sha, base, checks, failed, renders } = input;
	const masks = base.masksProvenance;
	const reports = renders.map((render) => render.report);
	const unique = <T>(items: T[], key: (item: T) => string): T[] => [...new Map(items.map((i) => [key(i), i])).values()];
	const effects = unique(
		reports.flatMap((report) => report.unsupportedEffectsEncountered),
		(effect) => `${effect.compName}|${effect.layerName}|${effect.matchName}`,
	);
	const gaps = unique(
		reports.flatMap((report) => report.renderGaps),
		(gap) => `${gap.compName}|${gap.layerName}|${gap.reason}`,
	);
	const approximations = [...new Set(reports.flatMap((report) => report.approximations))];
	const result = (passed: boolean | null): string => (passed === null ? 'não verificado' : passed ? 'passou' : 'FALHOU');

	return `# MOGRT Engine, Fase 3A: validação de \`${file}\`

Gerado por \`scripts/validate-mogrt-phase3a.ts\` a partir do arquivo real. Todos os números abaixo são medidos na execução.

- SHA-256: \`${sha}\`
- Resultado das verificações: **${failed ? 'REPROVADO' : 'aprovado'}**
- Completude do render: \`${base.completenessVerdict}\`
- ${base.completenessReason}

A única referência do After Effects é o \`thumb.png\` de um quadro. Os demais quadros não têm com o que ser comparados.

## Verificações

${table(['Verificação', 'Resultado', 'Medido'], checks.map((c) => [c.name, result(c.passed), c.measured]))}

## Renders

${table(
	['Variante', 'Edição', 'Duração (ffprobe)', 'Quadros', 'Quadros não pretos', 'Codec'],
	renders.map(({ variant, report, probe }) => [
		variant.id,
		variant.description,
		`${probe.durationSec.toFixed(3)} s`,
		String(probe.frames),
		String(report.nonBlackFrames),
		probe.codec,
	]),
)}

## Composições renderizadas

${table(
	['Composição', 'Tamanho', 'FPS', 'Duração', 'Camadas', 'Máscaras'],
	base.nestedCompsRendered.map((comp) => [
		comp.name,
		`${comp.width}x${comp.height}`,
		String(comp.fps),
		`${comp.durationSec.toFixed(3)} s`,
		String(comp.layerCount),
		String(comp.maskCount),
	]),
)}

## Máscaras e expressões

- Máscaras no .aep: ${masks.aepTotalMasksExtracted}, com ${masks.aepTotalKeyframesExtracted} keyframes de forma
- Máscaras distintas rasterizadas no template sem edição: ${masks.uniqueRealMasksRasterized}
- Expressões no .aep: ${base.expressionsAudit.totalInAep}
- Expressões não avaliadas: ${base.expressionsAudit.unsupportedUnique.length}

## Efeitos executados

${table(['Efeito', 'Execuções'], Object.entries(base.effectsExecutedCounts).map(([name, n]) => [name, String(n)]))}

## Efeitos não reproduzidos

${table(['Composição', 'Camada', 'Efeito', 'Motivo'], effects.map((e) => [e.compName, e.layerName, e.matchName, e.reason]))}

## Outras lacunas

${table(['Composição', 'Camada', 'Motivo'], gaps.map((gap) => [gap.compName, gap.layerName, gap.reason]))}

## Aproximações

${approximations.map((text) => `- ${text}`).join('\n') || 'Nenhuma.'}

## Como repetir

\`\`\`bash
npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "<caminho>/${file}"
\`\`\`
`;
}

async function main(): Promise<void> {
	const args = readArgs();
	const { mogrtPath, outDir, reportPath } = args;
	const sha = sha256File(mogrtPath);
	const thumbTime = args.thumbTime ?? KNOWN_THUMB_TIMES[sha];
	const workDir = join(outDir, '_work');
	const inspection = inspectMogrtFile(mogrtPath, join(workDir, 'inspect'));
	if (!inspection.aepPath) throw new Error('The MOGRT has no .aep project.');
	const graph = parseAepProjectGraph(inspection.aepPath, { preferredRootCompName: inspection.name });
	const fps = graph.compositionsById.get(graph.rootCompId)!.fps;
	const heroTime = inspection.durationSec * 0.65;
	const burstTime = thumbTime ?? inspection.durationSec * 0.1;

	const renders: Array<{
		variant: Variant;
		report: MogrtPhase3ARenderReport;
		probe: ReturnType<typeof probeMp4>;
		burst: RgbaBuffer;
		hero: RgbaBuffer;
	}> = [];
	for (const variant of planVariants(graph.controls, workDir)) {
		console.log(`[Phase 3A] Rendering ${variant.id}...`);
		const mp4 = join(outDir, `${variant.id}.mp4`);
		const burstPng = join(outDir, `${variant.id}-burst.png`);
		const heroPng = join(outDir, `${variant.id}-hero.png`);
		const report = await renderMogrtPhase3AToMp4({
			mogrtPath,
			workDir: join(workDir, variant.id),
			outputMp4Path: mp4,
			width: WIDTH,
			height: HEIGHT,
			...(variant.overrides ? { overrides: variant.overrides } : {}),
			captureFrames: [
				{ tSec: burstTime, outputPngPath: burstPng },
				{ tSec: heroTime, outputPngPath: heroPng },
			],
		});
		renders.push({
			variant,
			report,
			probe: probeMp4(mp4),
			burst: loadLogoImageRgba(burstPng, WIDTH, HEIGHT),
			hero: loadLogoImageRgba(heroPng, WIDTH, HEIGHT),
		});
	}

	const checks: Check[] = [];
	for (const { variant, report, probe } of renders) {
		checks.push({
			name: `${variant.id}: render`,
			passed: report.completenessVerdict !== 'failed',
			measured: report.failures.join('; ') || `${report.nonBlackFrames}/${report.framesRendered} quadros não pretos`,
		});
		checks.push({
			name: `${variant.id}: duração do MP4 igual ao definition.json`,
			passed: Math.abs(probe.durationSec - inspection.durationSec) <= 1.5 / fps,
			measured: `${probe.durationSec.toFixed(3)} s, esperado ${inspection.durationSec.toFixed(3)} s`,
		});
	}
	checks.push({ name: 'arquivo original intacto', passed: sha256File(mogrtPath) === sha, measured: 'SHA-256 antes e depois' });

	const base = renders[0]!;
	const thumbName = 'quadro base contra o thumb.png';
	if (inspection.thumbnailPath && thumbTime !== undefined) {
		// Thumbnails are 4:3 with the picture letterboxed: put the frame in the same box, compare only the picture.
		const boxHeight = Math.round((WIDTH * 3) / 4);
		const top = Math.round((boxHeight - HEIGHT) / 2);
		const thumb = loadLogoImageRgba(inspection.thumbnailPath, WIDTH, boxHeight);
		const framed = loadLogoImageRgba(join(outDir, 'base-burst.png'), WIDTH, boxHeight);
		const { mae, iou } = compare(thumb, framed, top, top + HEIGHT);
		checks.push({
			name: `${thumbName} (t=${thumbTime.toFixed(3)} s)`,
			passed: mae <= MAX_THUMB_MAE && iou >= MIN_THUMB_IOU,
			measured: `MAE ${mae.toFixed(2)} (máx. ${MAX_THUMB_MAE}), IoU ${iou.toFixed(3)} (mín. ${MIN_THUMB_IOU})`,
		});
	} else {
		checks.push({ name: thumbName, passed: null, measured: 'sem thumb ou sem instante conhecido; use --thumb-time' });
	}

	const find = (id: string) => renders.find((render) => render.variant.id === id);
	const visibleEdit = (name: string, left?: RgbaBuffer, right?: RgbaBuffer): void => {
		if (!left || !right) {
			checks.push({ name, passed: null, measured: 'o template não tem esse controle' });
			return;
		}
		const { mae } = compare(left, right);
		checks.push({ name, passed: mae >= MIN_EDIT_MAE, measured: `MAE ${mae.toFixed(2)} (mín. ${MIN_EDIT_MAE})` });
	};
	visibleEdit('trocar o logo muda o quadro', find('logo-a')?.hero, find('logo-b')?.hero);
	const edited = find('edited');
	visibleEdit('editar cores muda a transição', edited?.variant.overrides?.controls ? base.burst : undefined, edited?.burst);

	// Text on its own: in the `edited` variant a colour change alone would also move these pixels.
	const textOverride = edited?.variant.overrides?.textOverride;
	const heroFrame = (id: string, overrides: MogrtRenderOverrides): RgbaBuffer =>
		renderMogrtFrameRgba({
			mogrtPath,
			workDir: join(workDir, id),
			tSec: heroTime,
			width: WIDTH,
			height: HEIGHT,
			overrides,
		}).frame;
	visibleEdit(
		'editar só o texto muda o quadro final',
		textOverride ? heroFrame('text-original', {}) : undefined,
		textOverride ? heroFrame('text-edited', { textOverride }) : undefined,
	);

	const failed = checks.some((check) => check.passed === false);
	mkdirSync(dirname(reportPath), { recursive: true });
	const markdown = buildMarkdown({ file: basename(mogrtPath), sha, base: base.report, checks, failed, renders });
	writeFileSync(reportPath, markdown, 'utf8');

	for (const check of checks) {
		const label = check.passed === null ? 'SKIP' : check.passed ? 'PASS' : 'FAIL';
		console.log(`[Phase 3A] ${label} ${check.name}: ${check.measured}`);
	}
	console.log(`[Phase 3A] ${failed ? 'FAILED' : 'PASSED'}. Report: ${reportPath}`);
	if (failed) process.exitCode = 1;
}

main().catch((error) => {
	console.error('[Phase 3A] Validation failed:', error);
	process.exitCode = 1;
});
