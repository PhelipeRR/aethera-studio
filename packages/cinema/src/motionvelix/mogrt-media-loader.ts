/**
 * MotionVelix MOGRT Engine — Phase 3A Media Loader, SVG/PNG Logo Rasterizer,
 * Editable Text Renderer, and Comparative Frame Diff Generator (Zero Adobe).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { createRgbaBuffer, type RgbaBuffer } from './mogrt-effects-pipeline.js';
import type { Affine } from './mogrt-mask-renderer.js';

/** `node -e` resolves modules from the working directory, so hand the child an absolute path. */
function sharpRequireStatement(): string {
	let target = 'sharp';
	try {
		target = createRequire(import.meta.url).resolve('sharp');
	} catch {
		// Not installed next to this package: the child fails and the fallbacks are tried.
	}
	return `const sharp = require(${JSON.stringify(target)});`;
}

function runCommandWithFallback(
	candidates: Array<{ bin: string; args: string[]; input?: Buffer | string }>,
): Buffer {
	const errors: string[] = [];
	for (const c of candidates) {
		// On Windows `convert` is the FAT-to-NTFS volume tool, not ImageMagick.
		if (process.platform === 'win32' && c.bin === 'convert') continue;
		try {
			return execFileSync(c.bin, c.args, {
				maxBuffer: 256 * 1024 * 1024,
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true,
				...(c.input !== undefined ? { input: c.input } : {}),
			});
		} catch (err) {
			errors.push(err instanceof Error ? err.message.slice(0, 600) : String(err));
		}
	}
	throw new Error(`Unable to rasterize media via sharp/ffmpeg/ImageMagick: ${errors.join(' | ')}`);
}

/**
 * Synchronously rasterizes an SVG file or markup string to a PNG file using `sharp` (built-in librsvg+Pango),
 * falling back to ImageMagick `magick`/`convert` when `sharp` is unavailable.
 */
export function rasterizeSvgToPngSync(svgMarkupOrPath: string, outputPngPath: string, width?: number, height?: number): void {
	mkdirSync(dirname(outputPngPath), { recursive: true });
	const isMarkup = svgMarkupOrPath.trimStart().startsWith('<');
	const sharpScript = `
${sharpRequireStatement()}
const fs = require('fs');
const [isMarkup, src, outPath, wStr, hStr] = process.argv.slice(1);
const input = isMarkup === '1' ? Buffer.from(src, 'utf8') : fs.readFileSync(src);
let p = sharp(input, { density: 240 });
const w = Number(wStr) || 0;
const h = Number(hStr) || 0;
if (w > 0 && h > 0) {
  p = p.resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
}
p.png().toFile(outPath).catch((err) => { console.error(err); process.exit(1); });
`;
	const tmpSvg = isMarkup
		? join(tmpdir(), `mvx-svgpng-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`)
		: svgMarkupOrPath;
	try {
		if (isMarkup) writeFileSync(tmpSvg, svgMarkupOrPath, 'utf8');
		runCommandWithFallback([
			{
				bin: process.execPath,
				args: [
					'-e',
					sharpScript,
					isMarkup ? '1' : '0',
					isMarkup ? svgMarkupOrPath : svgMarkupOrPath,
					outputPngPath,
					String(width ?? 0),
					String(height ?? 0),
				],
			},
			{
				bin: 'magick',
				args: ['-background', 'none', tmpSvg, outputPngPath],
			},
			{
				bin: 'convert',
				args: ['-background', 'none', tmpSvg, outputPngPath],
			},
		]);
	} finally {
		if (isMarkup && existsSync(tmpSvg)) rmSync(tmpSvg, { force: true });
	}
}

function rasterizeSvgToRgbaSync(svgMarkupOrPath: string, w: number, h: number): Buffer {
	const isMarkup = svgMarkupOrPath.trimStart().startsWith('<');
	const sharpScript = `
${sharpRequireStatement()}
const fs = require('fs');
const [isMarkup, src, wStr, hStr] = process.argv.slice(1);
const input = isMarkup === '1' ? Buffer.from(src, 'utf8') : fs.readFileSync(src);
const w = Number(wStr);
const h = Number(hStr);
sharp(input, { density: Math.max(200, Math.round(Math.max(w, h) * 0.75)) })
  .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer()
  .then((buf) => process.stdout.write(buf))
  .catch((err) => { console.error(err); process.exit(1); });
`;
	const tmpSvg = isMarkup
		? join(tmpdir(), `mvx-svgrgba-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`)
		: svgMarkupOrPath;
	try {
		if (isMarkup) writeFileSync(tmpSvg, svgMarkupOrPath, 'utf8');
		const density = String(Math.max(192, Math.round(Math.max(w, h) * 0.75)));
		return runCommandWithFallback([
			{
				bin: process.execPath,
				args: ['-e', sharpScript, isMarkup ? '1' : '0', svgMarkupOrPath, String(w), String(h)],
			},
			{
				bin: 'magick',
				args: [
					'-background',
					'none',
					'-density',
					density,
					tmpSvg,
					'-resize',
					`${w}x${h}`,
					'-gravity',
					'center',
					'-extent',
					`${w}x${h}`,
					'-depth',
					'8',
					'rgba:-',
				],
			},
			{
				bin: 'convert',
				args: [
					'-background',
					'none',
					'-density',
					density,
					tmpSvg,
					'-resize',
					`${w}x${h}`,
					'-gravity',
					'center',
					'-extent',
					`${w}x${h}`,
					'-depth',
					'8',
					'rgba:-',
				],
			},
		]);
	} finally {
		if (isMarkup && existsSync(tmpSvg)) rmSync(tmpSvg, { force: true });
	}
}

/**
 * Loads a user-supplied PNG, JPG, WEBP, or SVG logo into a fitted RGBA buffer with full alpha preservation.
 * Preserves aspect ratio inside `(targetWidth x targetHeight)` centered on transparent background.
 */
export function loadLogoImageRgba(
	filePath: string,
	targetWidth: number,
	targetHeight: number,
): RgbaBuffer {
	if (!existsSync(filePath)) {
		throw new Error(`Logo file not found: ${filePath}`);
	}
	const w = Math.max(1, Math.round(targetWidth));
	const h = Math.max(1, Math.round(targetHeight));
	const ext = extname(filePath).toLowerCase();

	if (ext === '.svg') {
		const raw = rasterizeSvgToRgbaSync(filePath, w, h);
		const buf = createRgbaBuffer(w, h);
		buf.data.set(raw.subarray(0, Math.min(raw.length, buf.data.length)));
		return buf;
	}

	// Raster images (PNG/WEBP/JPG) via FFmpeg scale+pad with exact alpha preservation, or ImageMagick fallback
	const raw = runCommandWithFallback([
		{
			bin: 'ffmpeg',
			args: [
				'-v',
				'error',
				'-i',
				filePath,
				'-vf',
				`scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
				'-frames:v',
				'1',
				'-f',
				'rawvideo',
				'-pix_fmt',
				'rgba',
				'pipe:1',
			],
		},
		{
			bin: 'convert',
			args: [
				'-background',
				'none',
				filePath,
				'-resize',
				`${w}x${h}`,
				'-gravity',
				'center',
				'-extent',
				`${w}x${h}`,
				'-depth',
				'8',
				'rgba:-',
			],
		},
	]);

	const buf = createRgbaBuffer(w, h);
	buf.data.set(raw.subarray(0, Math.min(raw.length, buf.data.length)));
	return buf;
}

export interface RenderTextLayerOptions {
	text: string;
	width: number;
	height: number;
	/** Maps text space (origin at the paragraph's first baseline) to buffer pixels. */
	matrix: Affine;
	fontSize: number;
	lineHeight: number;
	colorRgba01: [number, number, number, number];
	/** PostScript name, e.g. `Montserrat-Bold`. */
	fontName: string;
	justification: 'left' | 'right' | 'center';
	/** Thousandths of an em. */
	tracking?: number;
	baselineShift?: number;
	allCaps?: boolean;
}

const FONT_WEIGHTS: Array<[RegExp, number]> = [
	[/thin/i, 100],
	[/(extra|ultra)light/i, 200],
	[/light/i, 300],
	[/(semi|demi)bold/i, 600],
	[/(extra|ultra)bold/i, 800],
	[/bold/i, 700],
	[/black|heavy/i, 900],
	[/medium/i, 500],
];

function escapeXml(text: string): string {
	return text
		.replace(/[^\P{Cc}\t\n\r]/gu, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Renders a point-text layer with SVG + sharp. A font that is not installed is substituted by the
 * rasterizer. Throws when rasterization fails, instead of returning a blank layer.
 */
export function renderTextLayerRgba(opts: RenderTextLayerOptions): RgbaBuffer {
	const buf = createRgbaBuffer(opts.width, opts.height);
	const text = opts.allCaps ? opts.text.toUpperCase() : opts.text;
	if (!text.trim()) return buf;

	const [family = '', style = ''] = opts.fontName.replace(/[^\w -]/g, '').split('-');
	const spaced = family.replace(/([a-z])([A-Z])/g, '$1 $2');
	const families = [...new Set([family, spaced, 'Arial', 'sans-serif'])].filter(Boolean).join(', ');
	const weight = FONT_WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400;
	const anchor = { left: 'start', center: 'middle', right: 'end' }[opts.justification];
	const [r, g, b, a] = opts.colorRgba01.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number, number];
	const fill = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
	const spacing = ((opts.tracking ?? 0) / 1000) * opts.fontSize;
	const italic = /italic|oblique/i.test(style) ? 'italic' : 'normal';
	const lines = text
		.replaceAll('\u0003', '\n') // AE's soft line break
		.split(/\r\n|[\r\n]/)
		.map(
			(line, i) =>
				`<text x="0" y="${i * opts.lineHeight - (opts.baselineShift ?? 0)}" text-anchor="${anchor}">${escapeXml(line)}</text>`,
		)
		.join('');
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">` +
		`<g transform="matrix(${opts.matrix.join(' ')})" font-family="${families}" font-size="${opts.fontSize}" font-weight="${weight}" ` +
		`font-style="${italic}" letter-spacing="${spacing}" fill="${fill}" fill-opacity="${a}">${lines}</g></svg>`;

	buf.data.set(rasterizeSvgToRgbaSync(svg, opts.width, opts.height).subarray(0, buf.data.length));
	return buf;
}

/**
 * Writes an RGBA buffer directly to a PNG file via FFmpeg.
 */
export function writeRgbaBufferToPng(buf: RgbaBuffer, outputPngPath: string): void {
	mkdirSync(dirname(outputPngPath), { recursive: true });
	execFileSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-y',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgba',
			'-s',
			`${buf.width}x${buf.height}`,
			'-i',
			'pipe:0',
			'-frames:v',
			'1',
			outputPngPath,
		],
		{ input: Buffer.from(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength), windowsHide: true },
	);
}

export interface FrameComparisonMetrics {
	width: number;
	height: number;
	maeRgb: number;
	psnrDb: number;
	similarityPct: number;
	sideBySidePngPath: string;
}

/**
 * Compares a rendered frame against a reference PNG (`thumb.png` or another render)
 * at matched resolution, computes MAE/PSNR/similarity%, and writes a side-by-side + diff visual comparison PNG.
 */
export function compareFrameAgainstReference(
	referencePngPath: string,
	renderedFrame: RgbaBuffer,
	sideBySidePngPath: string,
): FrameComparisonMetrics {
	const w = renderedFrame.width;
	const h = renderedFrame.height;
	const ref = loadLogoImageRgba(referencePngPath, w, h);

	let absDiffSum = 0;
	let sqDiffSum = 0;
	const totalChannels = w * h * 3;

	// Build 3-panel strip: [Reference | Rendered | 2x Amplified Diff]
	const strip = createRgbaBuffer(w * 3, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const so = (y * w + x) * 4;
			const rr = ref.data[so]!;
			const rg = ref.data[so + 1]!;
			const rb = ref.data[so + 2]!;
			const cr = renderedFrame.data[so]!;
			const cg = renderedFrame.data[so + 1]!;
			const cb = renderedFrame.data[so + 2]!;

			const dr = Math.abs(rr - cr);
			const dg = Math.abs(rg - cg);
			const db = Math.abs(rb - cb);
			absDiffSum += dr + dg + db;
			sqDiffSum += dr * dr + dg * dg + db * db;

			const dstRef = (y * (w * 3) + x) * 4;
			strip.data[dstRef] = rr;
			strip.data[dstRef + 1] = rg;
			strip.data[dstRef + 2] = rb;
			strip.data[dstRef + 3] = 255;

			const dstCur = (y * (w * 3) + (w + x)) * 4;
			strip.data[dstCur] = cr;
			strip.data[dstCur + 1] = cg;
			strip.data[dstCur + 2] = cb;
			strip.data[dstCur + 3] = 255;

			const dstDiff = (y * (w * 3) + (w * 2 + x)) * 4;
			strip.data[dstDiff] = Math.min(255, dr * 2);
			strip.data[dstDiff + 1] = Math.min(255, dg * 2);
			strip.data[dstDiff + 2] = Math.min(255, db * 2);
			strip.data[dstDiff + 3] = 255;
		}
	}

	writeRgbaBufferToPng(strip, sideBySidePngPath);

	const maeRgb = Math.round((absDiffSum / Math.max(1, totalChannels)) * 100) / 100;
	const mse = sqDiffSum / Math.max(1, totalChannels);
	const psnrDb = mse <= 1e-6 ? 99 : Math.round((10 * Math.log10((255 * 255) / mse)) * 100) / 100;
	const similarityPct = Math.round(Math.max(0, (1 - maeRgb / 255) * 100) * 100) / 100;

	return {
		width: w,
		height: h,
		maeRgb,
		psnrDb,
		similarityPct,
		sideBySidePngPath,
	};
}

/**
 * Extracts a single frame from an MP4 file at `tSec` into an RGBA buffer via FFmpeg.
 */
export function extractMp4FrameRgba(
	mp4Path: string,
	tSec: number,
	width: number,
	height: number,
): RgbaBuffer {
	const raw = execFileSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-ss',
			tSec.toFixed(3),
			'-i',
			mp4Path,
			'-vf',
			`scale=${width}:${height}`,
			'-frames:v',
			'1',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgba',
			'pipe:1',
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	const buf = createRgbaBuffer(width, height);
	buf.data.set(raw.subarray(0, Math.min(raw.length, buf.data.length)));
	return buf;
}

export function sha256File(filePath: string): string {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
