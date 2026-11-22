/**
 * MotionVelix MOGRT Engine — Phase 3A Media Loader, SVG/PNG Logo Rasterizer,
 * Editable Text Renderer, and Comparative Frame Diff Generator (Zero Adobe).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { createRgbaBuffer, type RgbaBuffer } from './mogrt-effects-pipeline.js';

function runCommandWithFallback(
	candidates: Array<{ bin: string; args: string[]; input?: Buffer | string }>,
): Buffer {
	let lastErr: unknown;
	for (const c of candidates) {
		try {
			return execFileSync(c.bin, c.args, {
				maxBuffer: 64 * 1024 * 1024,
				...(c.input !== undefined ? { input: c.input } : {}),
			});
		} catch (err) {
			lastErr = err;
		}
	}
	throw new Error(
		`Unable to rasterize media via sharp/ffmpeg/convert: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
	);
}

/**
 * Synchronously rasterizes an SVG file or markup string to a PNG file using `sharp` (built-in librsvg+Pango),
 * falling back to ImageMagick `magick`/`convert` when `sharp` is unavailable.
 */
export function rasterizeSvgToPngSync(svgMarkupOrPath: string, outputPngPath: string, width?: number, height?: number): void {
	mkdirSync(dirname(outputPngPath), { recursive: true });
	const isMarkup = svgMarkupOrPath.trimStart().startsWith('<');
	const sharpScript = `
const sharp = require('sharp');
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
const sharp = require('sharp');
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
	fontSize: number;
	colorRgba01: [number, number, number, number];
	fontName?: string;
	allCaps?: boolean;
}

/**
 * Renders an editable text layer into a transparent RGBA buffer using SVG + sharp (librsvg+Pango) rasterization
 * (no Adobe dependency; works deterministically with custom colors, sizes, and allCaps).
 */
export function renderTextLayerRgba(opts: RenderTextLayerOptions): RgbaBuffer {
	const w = Math.max(1, Math.round(opts.width));
	const h = Math.max(1, Math.round(opts.height));
	const displayText = (opts.allCaps ? opts.text.toUpperCase() : opts.text).trim();
	if (!displayText) return createRgbaBuffer(w, h);

	const r = Math.round(Math.max(0, Math.min(1, opts.colorRgba01[0])) * 255);
	const g = Math.round(Math.max(0, Math.min(1, opts.colorRgba01[1])) * 255);
	const b = Math.round(Math.max(0, Math.min(1, opts.colorRgba01[2])) * 255);
	const a = Math.max(0, Math.min(1, opts.colorRgba01[3]));
	const escaped = displayText
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	const fontFamily = (opts.fontName || 'DejaVu Sans, Arial, sans-serif').replace(/['"]/g, '');
	const fontSize = Math.max(12, Math.round(opts.fontSize));

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <text x="${Math.round(w / 2)}" y="${Math.round(h / 2 + fontSize * 0.34)}"
        text-anchor="middle"
        font-family="${fontFamily}, DejaVu Sans, sans-serif"
        font-size="${fontSize}"
        font-weight="800"
        letter-spacing="${Math.round(fontSize * 0.08)}"
        fill="rgb(${r},${g},${b})"
        fill-opacity="${a.toFixed(3)}">${escaped}</text>
</svg>`;

	try {
		const raw = rasterizeSvgToRgbaSync(svg, w, h);
		const buf = createRgbaBuffer(w, h);
		buf.data.set(raw.subarray(0, Math.min(raw.length, buf.data.length)));
		return buf;
	} catch {
		return createRgbaBuffer(w, h);
	}
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
		{ input: Buffer.from(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength) },
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
