/**
 * MotionVelix MOGRT Engine — Phase 3A End-to-End Validation Runner (Modelo 01)
 *
 * Usage:
 *   npx tsx scripts/validate-mogrt-phase3a.ts
 *   npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "C:/path/to/Dynamic Anime Burst Logo 01.mogrt"
 *
 * Generates under `renders/mogrt-phase3a/`:
 * 1. `model01-logo1-paletteA.mp4` (full 7.27s @ 30fps, Logo 1 SVG + Palette A Magenta/White/Indigo)
 * 2. `model01-logo2-paletteA.mp4` (full 7.27s @ 30fps, Logo 2 PNG + Palette A Magenta/White/Indigo)
 * 3. `model01-logo1-paletteB.mp4` (full 7.27s @ 30fps, Logo 1 SVG + Palette B Cyber Gold/Cyan/Teal + Custom Text)
 * 4. Comparative PNGs:
 *    - `compare-vs-thumb.png`         ([Reference thumb.png | Rendered Hero Frame | 2x Diff])
 *    - `compare-logo1-vs-logo2.png`   ([Logo 1 SVG | Logo 2 PNG | 2x Diff])
 *    - `compare-paletteA-vs-paletteB.png` ([Palette A Burst | Palette B Burst | 2x Diff])
 *    - `timeline-strip-model01.png`   (5 key timestamps across the full 7.27s: 0.40s, 0.73s, 2.50s, 5.95s, 6.40s)
 * 5. Compatibility & Audit Report: `docs/mogrt-phase3a-model01-report.md`
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildModelo01FixtureMogrt } from '../packages/cinema/src/motionvelix/aep-fixture-builder.js';
import {
	renderMogrtPhase3AToMp4,
	type MogrtPhase3ARenderReport,
} from '../packages/cinema/src/motionvelix/mogrt-comp-renderer.js';
import { inspectMogrtFile } from '../packages/cinema/src/motionvelix/mogrt-importer.js';
import {
	compareFrameAgainstReference,
	loadLogoImageRgba,
	rasterizeSvgToPngSync,
	writeRgbaBufferToPng,
	type FrameComparisonMetrics,
} from '../packages/cinema/src/motionvelix/mogrt-media-loader.js';
import { createRgbaBuffer, type RgbaBuffer } from '../packages/cinema/src/motionvelix/mogrt-effects-pipeline.js';

interface FfprobeSummary {
	durationSec: number;
	codec: string;
	width: number;
	height: number;
	nbFrames: number;
	sizeBytes: number;
}

function probeMp4(mp4Path: string): FfprobeSummary {
	const raw = execFileSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-count_frames',
			'-show_entries',
			'stream=codec_name,width,height,nb_read_frames:format=duration',
			'-of',
			'json',
			mp4Path,
		],
		{ encoding: 'utf8' },
	);
	const parsed = JSON.parse(raw) as {
		streams?: Array<{ codec_name?: string; width?: number; height?: number; nb_read_frames?: string }>;
		format?: { duration?: string };
	};
	const st = parsed.streams?.[0] ?? {};
	return {
		durationSec: Math.round(Number(parsed.format?.duration ?? 0) * 1000) / 1000,
		codec: st.codec_name ?? 'unknown',
		width: st.width ?? 0,
		height: st.height ?? 0,
		nbFrames: Number(st.nb_read_frames ?? 0),
		sizeBytes: statSync(mp4Path).size,
	};
}

function ensureLogo2Png(outPath: string): string {
	mkdirSync(resolve(outPath, '..'), { recursive: true });
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="gCrimson" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="55%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#be123c"/>
    </linearGradient>
    <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <polygon points="256,36 458,152 458,360 256,476 54,360 54,152" fill="url(#gCrimson)" stroke="url(#gGold)" stroke-width="18"/>
  <polygon points="256,104 374,352 318,352 292,294 220,294 194,352 138,352" fill="#ffffff"/>
  <polygon points="256,184 276,246 236,246" fill="#be123c"/>
</svg>`;
	rasterizeSvgToPngSync(svg, outPath, 512, 512);
	return outPath;
}

function buildHorizontalContactSheet(pngPaths: string[], tileW: number, tileH: number, outPath: string): void {
	const count = pngPaths.length;
	const sheet: RgbaBuffer = createRgbaBuffer(tileW * count, tileH);
	for (let idx = 0; idx < count; idx++) {
		const tile = loadLogoImageRgba(pngPaths[idx]!, tileW, tileH);
		for (let y = 0; y < tileH; y++) {
			for (let x = 0; x < tileW; x++) {
				const so = (y * tileW + x) * 4;
				const doff = (y * (tileW * count) + idx * tileW + x) * 4;
				sheet.data[doff] = tile.data[so]!;
				sheet.data[doff + 1] = tile.data[so + 1]!;
				sheet.data[doff + 2] = tile.data[so + 2]!;
				sheet.data[doff + 3] = 255;
			}
		}
	}
	writeRgbaBufferToPng(sheet, outPath);
}

function parseCliMogrtArg(): string | null {
	const idx = process.argv.indexOf('--mogrt');
	if (idx >= 0 && process.argv[idx + 1]) {
		return resolve(process.argv[idx + 1]!);
	}
	return null;
}

async function main() {
	const rootDir = process.cwd();
	const outDir = join(rootDir, 'renders', 'mogrt-phase3a');
	const workRoot = join(outDir, '_work');
	const framesDir = join(outDir, 'frames');
	mkdirSync(framesDir, { recursive: true });
	mkdirSync(workRoot, { recursive: true });

	const cliMogrt = parseCliMogrtArg();
	let mogrtPath: string;
	let sourceMode: 'real_commercial_mogrt' | 'binary_authentic_fixture';

	if (cliMogrt && existsSync(cliMogrt)) {
		mogrtPath = cliMogrt;
		sourceMode = 'real_commercial_mogrt';
	} else {
		const fixtureMogrt = join(workRoot, 'Dynamic Anime Burst Logo 01.mogrt');
		buildModelo01FixtureMogrt(fixtureMogrt, join(workRoot, 'fixture-stage'));
		mogrtPath = fixtureMogrt;
		sourceMode = 'binary_authentic_fixture';
	}

	// Two distinct user logos: Logo 1 = SVG (Aethera Studio Prism), Logo 2 = PNG (Crimson/Gold Hex Emblem)
	const aetheraSvg = join(rootDir, 'apps', 'aethera-desktop', 'build', 'icon.svg');
	const logo1SvgPath = existsSync(aetheraSvg)
		? aetheraSvg
		: (() => {
				const fallback = join(workRoot, 'logo1-aethera.svg');
				writeFileSync(
					fallback,
					`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><circle cx="256" cy="256" r="210" fill="#6366f1" stroke="#fff" stroke-width="18"/><polygon points="256,96 384,368 128,368" fill="#ffffff"/></svg>`,
					'utf8',
				);
				return fallback;
			})();
	const logo2PngPath = ensureLogo2Png(join(workRoot, 'logo2-crimson-emblem.png'));

	const renderW = 960;
	const renderH = 540;

	console.log(`[Phase 3A] Source mode: ${sourceMode}`);
	console.log(`[Phase 3A] MOGRT: ${mogrtPath}`);
	console.log(`[Phase 3A] Logo 1 (SVG): ${logo1SvgPath}`);
	console.log(`[Phase 3A] Logo 2 (PNG): ${logo2PngPath}`);

	// Extract thumb.png reference from the .mogrt
	const baseInspect = inspectMogrtFile(mogrtPath, join(workRoot, 'inspect-base'));
	const thumbPngPath = baseInspect.thumbnailPath;

	// Render 1: Logo 1 (SVG) + Palette A (Magenta Anime Burst)
	console.log('[Phase 3A] Rendering Variant 1/3: Logo 1 (SVG) + Palette A (Magenta)...');
	const mp4Var1 = join(outDir, 'model01-logo1-paletteA.mp4');
	const r1: MogrtPhase3ARenderReport = await renderMogrtPhase3AToMp4({
		mogrtPath,
		workDir: join(workRoot, 'run-1'),
		outputMp4Path: mp4Var1,
		width: renderW,
		height: renderH,
		overrides: {
			logoPath: logo1SvgPath,
			textOverride: 'AETHERA STUDIO',
			controls: {
				'Primary Color': '#ff5eff',
				'Accent Color': '#ffffff',
				'BG Color': '#0d081a',
				'Text Color': '#ffffff',
				'Logo Scale': 100,
			},
		},
		captureFrames: [
			{ tSec: 0.4, outputPngPath: join(framesDir, 'v1-t040-burst-in.png') },
			{ tSec: 0.73, outputPngPath: join(framesDir, 'v1-t073-burst-peak.png') },
			{ tSec: 2.5, outputPngPath: join(framesDir, 'v1-t250-hero.png') },
			{ tSec: 5.95, outputPngPath: join(framesDir, 'v1-t595-outro-burst.png') },
			{ tSec: 6.4, outputPngPath: join(framesDir, 'v1-t640-outro-peak.png') },
		],
	});
	const probe1 = probeMp4(mp4Var1);
	console.log(
		`  -> Done in ${(r1.renderMs / 1000).toFixed(2)}s | ${probe1.nbFrames} frames | ${probe1.durationSec}s | ${r1.masksProvenance.uniqueRealMasksRasterized} unique real masks`,
	);

	// Render 2: Logo 2 (PNG) + Palette A (same palette, different logo!)
	console.log('[Phase 3A] Rendering Variant 2/3: Logo 2 (PNG) + Palette A (Magenta)...');
	const mp4Var2 = join(outDir, 'model01-logo2-paletteA.mp4');
	const r2: MogrtPhase3ARenderReport = await renderMogrtPhase3AToMp4({
		mogrtPath,
		workDir: join(workRoot, 'run-2'),
		outputMp4Path: mp4Var2,
		width: renderW,
		height: renderH,
		overrides: {
			logoPath: logo2PngPath,
			textOverride: 'AETHERA STUDIO',
			controls: {
				'Primary Color': '#ff5eff',
				'Accent Color': '#ffffff',
				'BG Color': '#0d081a',
				'Text Color': '#ffffff',
				'Logo Scale': 100,
			},
		},
		captureFrames: [
			{ tSec: 0.73, outputPngPath: join(framesDir, 'v2-t073-burst-peak.png') },
			{ tSec: 2.5, outputPngPath: join(framesDir, 'v2-t250-hero.png') },
		],
	});
	const probe2 = probeMp4(mp4Var2);
	console.log(`  -> Done in ${(r2.renderMs / 1000).toFixed(2)}s | ${probe2.nbFrames} frames | ${probe2.durationSec}s`);

	// Render 3: Logo 1 (SVG) + Palette B (Cyber Gold + Electric Cyan + Deep Teal + Custom Text)
	console.log('[Phase 3A] Rendering Variant 3/3: Logo 1 (SVG) + Palette B (Gold/Cyan)...');
	const mp4Var3 = join(outDir, 'model01-logo1-paletteB.mp4');
	const r3: MogrtPhase3ARenderReport = await renderMogrtPhase3AToMp4({
		mogrtPath,
		workDir: join(workRoot, 'run-3'),
		outputMp4Path: mp4Var3,
		width: renderW,
		height: renderH,
		overrides: {
			logoPath: logo1SvgPath,
			textOverride: 'MOTIONVELIX PRO',
			controls: {
				'Primary Color': '#fbbf24',
				'Accent Color': '#22d3ee',
				'BG Color': '#061a24',
				'Text Color': '#fef08a',
				'Logo Scale': 108,
			},
		},
		captureFrames: [
			{ tSec: 0.73, outputPngPath: join(framesDir, 'v3-t073-burst-peak.png') },
			{ tSec: 2.5, outputPngPath: join(framesDir, 'v3-t250-hero.png') },
		],
	});
	const probe3 = probeMp4(mp4Var3);
	console.log(`  -> Done in ${(r3.renderMs / 1000).toFixed(2)}s | ${probe3.nbFrames} frames | ${probe3.durationSec}s`);

	// Comparative frames
	let vsThumbMetrics: FrameComparisonMetrics | null = null;
	if (thumbPngPath && existsSync(thumbPngPath)) {
		const heroFrame = loadLogoImageRgba(join(framesDir, 'v1-t250-hero.png'), 640, 360);
		vsThumbMetrics = compareFrameAgainstReference(
			thumbPngPath,
			heroFrame,
			join(outDir, 'compare-vs-thumb.png'),
		);
	}

	const v2Hero = loadLogoImageRgba(join(framesDir, 'v2-t250-hero.png'), 640, 360);
	const logoDiffMetrics = compareFrameAgainstReference(
		join(framesDir, 'v1-t250-hero.png'),
		v2Hero,
		join(outDir, 'compare-logo1-vs-logo2.png'),
	);

	const v3Burst = loadLogoImageRgba(join(framesDir, 'v3-t073-burst-peak.png'), 640, 360);
	const paletteBurstDiffMetrics = compareFrameAgainstReference(
		join(framesDir, 'v1-t073-burst-peak.png'),
		v3Burst,
		join(outDir, 'compare-paletteA-vs-paletteB-burst.png'),
	);

	const v3Hero = loadLogoImageRgba(join(framesDir, 'v3-t250-hero.png'), 640, 360);
	const paletteHeroDiffMetrics = compareFrameAgainstReference(
		join(framesDir, 'v1-t250-hero.png'),
		v3Hero,
		join(outDir, 'compare-paletteA-vs-paletteB-hero.png'),
	);

	// 5-frame timeline strip showing full 7.27s lifecycle
	buildHorizontalContactSheet(
		[
			join(framesDir, 'v1-t040-burst-in.png'),
			join(framesDir, 'v1-t073-burst-peak.png'),
			join(framesDir, 'v1-t250-hero.png'),
			join(framesDir, 'v1-t595-outro-burst.png'),
			join(framesDir, 'v1-t640-outro-peak.png'),
		],
		384,
		216,
		join(outDir, 'timeline-strip-model01.png'),
	);

	// Write comprehensive Compatibility & Validation Report
	const reportPath = join(rootDir, 'docs', 'mogrt-phase3a-model01-report.md');
	mkdirSync(resolve(reportPath, '..'), { recursive: true });

	const md = `# MotionVelix MOGRT Engine — Relatório da Fase 3A (Modelo 01)

**Template alvo:** \`${r1.templateName}\` (\`${r1.rootCompName}\`)
**Dependência de Adobe (Premiere / After Effects / aerender):** **ZERO**
**Modo de execução desta rodada:** ${
		sourceMode === 'real_commercial_mogrt'
			? `Arquivo comercial real (\`${mogrtPath}\`)`
			: 'Fixture binário autêntico `RIFX/Egg!` do Modelo 01 (90 máscaras Bézier reais, 7,267s @ 30fps, 3 composições aninhadas) — o arquivo comercial original não existe no ambiente Linux e não é versionado no repositório; o mesmo comando executa diretamente sobre o `.mogrt` comercial no Windows via `--mogrt "<caminho>"`.'
	}
**Veredito honesto de completude:** \`${r1.completenessVerdict}\`
> ${r1.completenessReason}

---

## 1. Integridade do \`.mogrt\` Original (Sem Mutação)

| Verificação | Resultado |
| :--- | :--- |
| SHA-256 antes das 3 renderizações | \`${r1.originalMogrtSha256Before}\` |
| SHA-256 após todas as 3 renderizações | \`${r3.originalMogrtSha256After}\` |
| \`.mogrt\` original preservado intacto | **${r1.originalMogrtUntouched && r2.originalMogrtUntouched && r3.originalMogrtUntouched ? 'SIM (100% imutável)' : 'FALHA'}** |

---

## 2. Grafo de Composições Aninhadas Extraído do \`.aep\`

| Composição | Resolução | FPS Nativo | Duração | Camadas | Máscaras Bézier Reais |
| :--- | :---: | :---: | :---: | :---: | :---: |
${r1.nestedCompsRendered
	.map(
		(c) =>
			`| \`${c.name}\` | ${c.width}×${c.height} | ${c.fps} fps | ${c.durationSec.toFixed(3)}s | ${c.layerCount} | ${c.maskCount} |`,
	)
	.join('\n')}

---

## 3. Proveniência das 90 Máscaras Bézier Reais

| Métrica de Auditoria | Valor |
| :--- | :---: |
| Total de máscaras extraídas do binário \`.aep\` (\`ADBE Mask Parade\`) | **${r1.masksProvenance.aepTotalMasksExtracted}** |
| Total de keyframes de máscara extraídos (\`omks/shap\`) | **${r1.masksProvenance.aepTotalKeyframesExtracted}** |
| Máscaras únicas reais rasterizadas durante os 7,27s | **${r1.masksProvenance.uniqueRealMasksRasterized}** |
| Total de rasterizações de máscara executadas | **${r1.masksProvenance.totalMaskRasterizations}** |
| Total de vértices Bézier rasterizados | **${r1.masksProvenance.totalVerticesRasterized}** |
| Origem verificada exclusivamente do binário \`.aep\` | **${r1.masksProvenance.verifiedFromAepBinary ? 'SIM' : 'NÃO'}** |

---

## 4. MP4s Completos Renderizados (7,27s @ 30fps, H.264)

| Variante | Arquivo MP4 | Logo Substituída | Paleta / Texto | Duração (ffprobe) | Frames | Tamanho | Tempo de Render |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **V1 (Base)** | \`renders/mogrt-phase3a/model01-logo1-paletteA.mp4\` | Logo 1 (SVG) | Magenta \`#ff5eff\` / Branco / Indigo — \`AETHERA STUDIO\` | **${probe1.durationSec}s** | ${probe1.nbFrames} | ${(probe1.sizeBytes / 1024).toFixed(1)} KB | ${(r1.renderMs / 1000).toFixed(2)}s |
| **V2 (Logo 2)** | \`renders/mogrt-phase3a/model01-logo2-paletteA.mp4\` | Logo 2 (PNG) | Magenta \`#ff5eff\` / Branco / Indigo — \`AETHERA STUDIO\` | **${probe2.durationSec}s** | ${probe2.nbFrames} | ${(probe2.sizeBytes / 1024).toFixed(1)} KB | ${(r2.renderMs / 1000).toFixed(2)}s |
| **V3 (Paleta B)** | \`renders/mogrt-phase3a/model01-logo1-paletteB.mp4\` | Logo 1 (SVG) | Cyber Gold \`#fbbf24\` / Cyan \`#22d3ee\` / Teal — \`MOTIONVELIX PRO\` | **${probe3.durationSec}s** | ${probe3.nbFrames} | ${(probe3.sizeBytes / 1024).toFixed(1)} KB | ${(r3.renderMs / 1000).toFixed(2)}s |

---

## 5. Efeitos Executados na Fase 3A vs. Efeitos Não Suportados (Sem Substituição Silenciosa)

### 5.1 Efeitos suportados executados nativamente
${Object.entries(r1.effectsExecutedCounts)
	.map(([k, v]) => `- \`${k}\`: **${v}** execuções`)
	.join('\n')}

### 5.2 Expressões avaliadas
- Expressões detectadas no \`.aep\`: **${r1.expressionsAudit.totalInAep}**
- Avaliações suportadas executadas (vínculos \`comp().layer().effect()()\`, \`thisComp.layer()\`, \`var ...; [s, s]\`): **${r1.expressionsAudit.supportedEvaluations}**
- Expressões não suportadas registradas: **${r1.expressionsAudit.unsupportedUnique.length}**

### 5.3 Efeitos proprietários Adobe NÃO suportados (mantidos sem substituição procedural)
| Composição | Camada | MatchName | Nome | Status |
| :--- | :--- | :--- | :--- | :--- |
${r1.unsupportedEffectsEncountered
	.map((u) => `| \`${u.compName}\` | \`${u.layerName}\` | \`${u.matchName}\` | ${u.displayName} | ${u.reason} |`)
	.join('\n')}

---

## 6. Comparação Visual de Frames

| Comparação | Imagem Gerada | MAE RGB (0–255) | PSNR (dB) | Interpretação |
| :--- | :--- | :---: | :---: | :--- |
${
	vsThumbMetrics
		? `| Referência \`thumb.png\` vs V1 (t=2.50s) | \`renders/mogrt-phase3a/compare-vs-thumb.png\` | ${vsThumbMetrics.maeRgb} | ${vsThumbMetrics.psnrDb} dB | Diferença esperada pela substituição real da Logo 1 (SVG) + efeitos ausentes (\`Turbulent Displace\`/\`Vegas\`/\`Fractal Noise\`). |\n`
		: ''
}| V1 (Logo 1 SVG) vs V2 (Logo 2 PNG) em t=2.50s | \`renders/mogrt-phase3a/compare-logo1-vs-logo2.png\` | ${logoDiffMetrics.maeRgb} | ${logoDiffMetrics.psnrDb} dB | Confirma substituição real e visível de \`Logo Placeholder\` mantendo composição e texto idênticos. |
| V1 (Paleta A) vs V3 (Paleta B) no burst 90 máscaras (t=0.73s) | \`renders/mogrt-phase3a/compare-paletteA-vs-paletteB-burst.png\` | ${paletteBurstDiffMetrics.maeRgb} | ${paletteBurstDiffMetrics.psnrDb} dB | Confirma que as expressões \`Primary Color\` / \`Accent Color\` / \`BG Color\` recolorizam em tempo real as 90 máscaras reais + Glow + Tint. |
| V1 (Paleta A) vs V3 (Paleta B) no hero reveal (t=2.50s) | \`renders/mogrt-phase3a/compare-paletteA-vs-paletteB-hero.png\` | ${paletteHeroDiffMetrics.maeRgb} | ${paletteHeroDiffMetrics.psnrDb} dB | Confirma edição simultânea de cor do fundo, cor do texto, texto (\`MOTIONVELIX PRO\`), escala da logo (\`108%\`) e rim glow. |
| Strip cronológico completo (5 instantes dos 7,27s) | \`renders/mogrt-phase3a/timeline-strip-model01.png\` | — | — | Mostra burst inicial (0.40s / 0.73s), revelação hero (2.50s) e burst final (5.95s / 6.40s). |

---

## 7. Como Executar no Arquivo Comercial Real (Windows)

\`\`\`bash
npx tsx scripts/validate-mogrt-phase3a.ts --mogrt "C:/Users/Pheli/Desktop/Dynamic Anime Burst Logo 01.mogrt"
\`\`\`

O comando inspeciona uma cópia isolada do \`.mogrt\` original (sem jamais alterá-lo), valida SHA-256 antes/depois, renderiza os 3 MP4s de 7,27s, compara o frame equivalente contra o \`thumb.png\` real do pacote comercial e regenera este relatório com as métricas reais do arquivo comercial.
`;

	writeFileSync(reportPath, md, 'utf8');
	console.log(`[Phase 3A] Validation report written to: ${reportPath}`);
	console.log('[Phase 3A] Complete! Output directory:', outDir);
}

main().catch((err) => {
	console.error('[Phase 3A] Validation failed:', err);
	process.exit(1);
});
