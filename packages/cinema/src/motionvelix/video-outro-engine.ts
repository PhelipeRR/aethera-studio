/**
 * MotionVelix — Video Outro (Encerramento do Vídeo) Engine
 *
 * Provides schema, persistence (per-project & channel default), safe-zone layout
 * for 16:9 (YouTube) and 9:16 (Shorts / Reels / TikTok), SVG/PNG overlay synthesis,
 * real MotionVelix + FFmpeg parallax animation rendering, audio mixing (ambient pad +
 * MotionVelix SFX kit), and non-destructive composition at the end of a main video.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { resolveMotionVelixKit } from '../recap/phase3/recap-motionvelix.js';

const execFileAsync = promisify(execFile);

export const OUTRO_ANIMATION_STYLES = ['energetic', 'cinematic', 'minimal'] as const;
export type OutroAnimationStyle = (typeof OUTRO_ANIMATION_STYLES)[number];

export const OUTRO_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export type OutroAspectRatio = (typeof OUTRO_ASPECT_RATIOS)[number];

export const ALLOWED_OUTRO_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export const videoOutroConfigSchema = z.object({
	enabled: z.boolean().default(false),
	backgroundImagePath: z.string().nullable().default(null),
	backgroundImageName: z.string().nullable().optional(),
	channelName: z.string().trim().max(120).default(''),
	style: z.enum(OUTRO_ANIMATION_STYLES).default('energetic'),
	durationSec: z.number().min(5).max(30).default(15),
	showSubscribeCta: z.boolean().default(true),
	parallaxEnabled: z.boolean().default(true),
	showNextVideoCard: z.boolean().default(false),
	nextVideoTitle: z.string().trim().max(120).optional(),
	aspectRatio: z.enum(OUTRO_ASPECT_RATIOS).default('16:9'),
	lastPreviewMp4Path: z.string().nullable().optional(),
	lastRenderedAtIso: z.string().nullable().optional(),
	saveAsChannelDefault: z.boolean().optional(),
});

export type VideoOutroConfig = z.infer<typeof videoOutroConfigSchema>;

export const DEFAULT_VIDEO_OUTRO_CONFIG: VideoOutroConfig = {
	enabled: false,
	backgroundImagePath: null,
	backgroundImageName: null,
	channelName: '',
	style: 'energetic',
	durationSec: 15,
	showSubscribeCta: true,
	parallaxEnabled: true,
	showNextVideoCard: false,
	nextVideoTitle: '',
	aspectRatio: '16:9',
	lastPreviewMp4Path: null,
	lastRenderedAtIso: null,
	saveAsChannelDefault: false,
};

export interface OutroSafeZone {
	width: number;
	height: number;
	marginLeft: number;
	marginRight: number;
	marginTop: number;
	marginBottom: number;
	contentWidth: number;
	contentHeight: number;
}

export interface OutroStylePreset {
	id: OutroAnimationStyle;
	label: string;
	description: string;
	accentHex: string;
	badgeBgHex: string;
	vignetteOpacity: number;
	zoomStart: number;
	zoomEnd: number;
	panAmplitudeX: number;
	panAmplitudeY: number;
	fadeInSec: number;
	fadeOutSec: number;
	baseChordHz: readonly [number, number, number];
	sfxKinds: readonly ('whoosh' | 'emotional_swell' | 'page_turn')[];
}

export const OUTRO_STYLE_PRESETS: Readonly<Record<OutroAnimationStyle, OutroStylePreset>> = {
	energetic: {
		id: 'energetic',
		label: 'Energetic',
		description: 'Zoom dinâmico com parallax ativo, destaque vibrante e transição ágil.',
		accentHex: '#B6F500',
		badgeBgHex: '#111111',
		vignetteOpacity: 0.48,
		zoomStart: 1.0,
		zoomEnd: 1.16,
		panAmplitudeX: 28,
		panAmplitudeY: 14,
		fadeInSec: 0.45,
		fadeOutSec: 0.65,
		baseChordHz: [261.63, 329.63, 392.0], // C major bright pad
		sfxKinds: ['whoosh', 'emotional_swell'],
	},
	cinematic: {
		id: 'cinematic',
		label: 'Cinematic',
		description: 'Movimento lento de câmera, vinheta dramática e atmosfera envolvente.',
		accentHex: '#F59E0B',
		badgeBgHex: '#0F172A',
		vignetteOpacity: 0.62,
		zoomStart: 1.02,
		zoomEnd: 1.12,
		panAmplitudeX: 16,
		panAmplitudeY: 8,
		fadeInSec: 0.8,
		fadeOutSec: 1.0,
		baseChordHz: [220.0, 261.63, 329.63], // A minor cinematic pad
		sfxKinds: ['emotional_swell'],
	},
	minimal: {
		id: 'minimal',
		label: 'Minimal',
		description: 'Flutuação sutil, tipografia limpa e transição suave sem excessos.',
		accentHex: '#FFFFFF',
		badgeBgHex: '#18181B',
		vignetteOpacity: 0.36,
		zoomStart: 1.0,
		zoomEnd: 1.06,
		panAmplitudeX: 8,
		panAmplitudeY: 4,
		fadeInSec: 0.6,
		fadeOutSec: 0.8,
		baseChordHz: [293.66, 369.99, 440.0], // D major warm minimal pad
		sfxKinds: ['page_turn', 'emotional_swell'],
	},
};

export function getOutroStylePreset(style: OutroAnimationStyle): OutroStylePreset {
	return OUTRO_STYLE_PRESETS[style] ?? OUTRO_STYLE_PRESETS.energetic;
}

export function getOutroDimensions(
	aspectRatio: OutroAspectRatio,
	quality: 'preview' | 'master' = 'preview',
): { width: number; height: number } {
	if (aspectRatio === '9:16') {
		return quality === 'master' ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
	}
	return quality === 'master' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

/**
 * Computes platform-safe zones for 16:9 (YouTube End Screen) and 9:16 (Shorts/Reels/TikTok HUD).
 */
export function getOutroSafeZone(
	aspectRatio: OutroAspectRatio,
	quality: 'preview' | 'master' = 'master',
): OutroSafeZone {
	const { width, height } = getOutroDimensions(aspectRatio, quality);
	if (aspectRatio === '9:16') {
		const marginLeft = Math.round(width * 0.08);
		const marginRight = Math.round(width * 0.14); // TikTok/Reels right action rail
		const marginTop = Math.round(height * 0.14);
		const marginBottom = Math.round(height * 0.22); // Caption/UI bottom bar
		return {
			width,
			height,
			marginLeft,
			marginRight,
			marginTop,
			marginBottom,
			contentWidth: width - marginLeft - marginRight,
			contentHeight: height - marginTop - marginBottom,
		};
	}
	const marginLeft = Math.round(width * 0.06);
	const marginRight = Math.round(width * 0.06);
	const marginTop = Math.round(height * 0.08);
	const marginBottom = Math.round(height * 0.12); // YouTube scrub bar clearance
	return {
		width,
		height,
		marginLeft,
		marginRight,
		marginTop,
		marginBottom,
		contentWidth: width - marginLeft - marginRight,
		contentHeight: height - marginTop - marginBottom,
	};
}

export function validateOutroBackgroundImagePath(filePath: string | null | undefined): {
	ok: boolean;
	error?: string;
} {
	if (!filePath || !filePath.trim()) {
		return { ok: true };
	}
	const ext = extname(filePath).toLowerCase();
	if (!(ALLOWED_OUTRO_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
		return {
			ok: false,
			error: `Formato de imagem não suportado (${ext || 'desconhecido'}). Use PNG, JPG ou WEBP.`,
		};
	}
	if (!existsSync(filePath)) {
		return { ok: false, error: `Imagem de fundo não encontrada no disco: ${filePath}` };
	}
	return { ok: true };
}

function escapeXml(raw: string): string {
	return raw
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Generates a crisp vector SVG overlay (safe-zone aligned) with channel name,
 * optional subscribe CTA pill, and optional next-video card.
 */
export function buildOutroOverlaySvg(
	config: VideoOutroConfig,
	width: number,
	height: number,
): string {
	const preset = getOutroStylePreset(config.style);
	const safe = getOutroSafeZone(config.aspectRatio, width >= 1080 && height >= 1080 ? 'master' : 'preview');
	const isVertical = config.aspectRatio === '9:16';
	const channelLabel = escapeXml((config.channelName || 'Aethera Studio').trim());
	const nextTitle = escapeXml((config.nextVideoTitle || 'Assista ao próximo episódio').trim());

	const centerX = Math.round(safe.marginLeft + safe.contentWidth / 2);
	const titleFontSize = isVertical ? Math.round(width * 0.068) : Math.round(width * 0.044);
	const subFontSize = isVertical ? Math.round(width * 0.032) : Math.round(width * 0.02);
	const ctaFontSize = isVertical ? Math.round(width * 0.034) : Math.round(width * 0.021);

	const headerY = isVertical
		? Math.round(safe.marginTop + safe.contentHeight * 0.28)
		: Math.round(safe.marginTop + safe.contentHeight * (config.showNextVideoCard ? 0.24 : 0.36));

	const ctaW = isVertical ? Math.round(safe.contentWidth * 0.82) : Math.round(width * 0.32);
	const ctaH = isVertical ? Math.round(height * 0.062) : Math.round(height * 0.088);
	const ctaX = Math.round(centerX - ctaW / 2);
	const ctaY = headerY + Math.round(titleFontSize * 1.45);

	const cardW = isVertical ? Math.round(safe.contentWidth * 0.84) : Math.round(width * 0.34);
	const cardH = Math.round(cardW * (9 / 16));
	const cardX = Math.round(centerX - cardW / 2);
	const cardY = config.showSubscribeCta
		? ctaY + ctaH + Math.round(height * 0.055)
		: headerY + Math.round(titleFontSize * 1.5);

	const ctaSvg = config.showSubscribeCta
		? `
  <g>
    <rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH / 2)}" fill="${preset.accentHex}" />
    <text x="${centerX}" y="${ctaY + Math.round(ctaH * 0.63)}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${ctaFontSize}" font-weight="800" fill="#111111">INSCREVA-SE NO CANAL</text>
  </g>`
		: '';

	const nextCardSvg = config.showNextVideoCard
		? `
  <g>
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="18" fill="rgba(17,17,17,0.72)" stroke="${preset.accentHex}" stroke-width="3" />
    <text x="${cardX + 22}" y="${cardY + 34}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${Math.round(subFontSize * 0.85)}" font-weight="700" fill="${preset.accentHex}">PRÓXIMO VÍDEO</text>
    <polygon points="${centerX - 14},${cardY + Math.round(cardH * 0.44)} ${centerX - 14},${cardY + Math.round(cardH * 0.64)} ${centerX + 18},${cardY + Math.round(cardH * 0.54)}" fill="#FFFFFF" />
    <text x="${centerX}" y="${cardY + cardH - 22}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${Math.round(subFontSize * 0.9)}" font-weight="600" fill="#F4F4F5">${nextTitle}</text>
  </g>`
		: '';

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="48%" r="72%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#000000" stop-opacity="${preset.vignetteOpacity}" />
    </radialGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.58" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#vignette)" />
  <rect x="0" y="${Math.round(height * 0.55)}" width="${width}" height="${Math.round(height * 0.45)}" fill="url(#bottomFade)" />

  <g>
    <rect x="${Math.round(centerX - (isVertical ? 140 : 120))}" y="${headerY - Math.round(titleFontSize * 1.45)}" width="${isVertical ? 280 : 240}" height="${Math.round(subFontSize * 2.1)}" rx="999" fill="rgba(17,17,17,0.68)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" />
    <text x="${centerX}" y="${headerY - Math.round(titleFontSize * 1.45) + Math.round(subFontSize * 1.42)}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${Math.round(subFontSize * 0.85)}" font-weight="700" letter-spacing="2" fill="${preset.accentHex}">OBRIGADO POR ASSISTIR</text>
    <text x="${centerX}" y="${headerY}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${titleFontSize}" font-weight="800" fill="#FFFFFF">${channelLabel}</text>
  </g>
  ${ctaSvg}
  ${nextCardSvg}
</svg>`;
}

/**
 * Writes a pleasant 48kHz stereo ambient musical pad WAV with smooth fade-in and fade-out
 * so the Outro MP4 always has real, non-silent stereo audio even without external music stems.
 */
export function writeAmbientOutroBedWav(
	filePath: string,
	durationSec: number,
	style: OutroAnimationStyle,
): void {
	const preset = getOutroStylePreset(style);
	const sampleRate = 48000;
	const channels = 2;
	const numFrames = Math.max(1, Math.round(durationSec * sampleRate));
	const dataSize = numFrames * channels * 2;
	const buf = Buffer.alloc(44 + dataSize);

	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(channels, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * channels * 2, 28);
	buf.writeUInt16LE(channels * 2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(dataSize, 40);

	const [f1, f2, f3] = preset.baseChordHz;
	const fadeInFrames = Math.min(numFrames / 3, Math.round(preset.fadeInSec * sampleRate));
	const fadeOutFrames = Math.min(numFrames / 3, Math.round(preset.fadeOutSec * sampleRate));

	for (let i = 0; i < numFrames; i++) {
		const t = i / sampleRate;
		let env = 1.0;
		if (i < fadeInFrames) env = i / Math.max(1, fadeInFrames);
		else if (i > numFrames - fadeOutFrames) env = (numFrames - i) / Math.max(1, fadeOutFrames);

		// Gentle harmonic swell + subtle stereo spread
		const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
		const left =
			(0.45 * Math.sin(2 * Math.PI * f1 * t) +
				0.32 * Math.sin(2 * Math.PI * f2 * t + 0.2) +
				0.23 * Math.sin(2 * Math.PI * f3 * t + 0.4)) *
			0.22 *
			env *
			lfo;
		const right =
			(0.45 * Math.sin(2 * Math.PI * (f1 * 1.002) * t + 0.15) +
				0.32 * Math.sin(2 * Math.PI * f2 * t + 0.35) +
				0.23 * Math.sin(2 * Math.PI * (f3 * 0.998) * t)) *
			0.22 *
			env *
			lfo;

		const lSample = Math.max(-32767, Math.min(32767, Math.round(left * 32767)));
		const rSample = Math.max(-32767, Math.min(32767, Math.round(right * 32767)));
		const offset = 44 + i * 4;
		buf.writeInt16LE(lSample, offset);
		buf.writeInt16LE(rSample, offset + 2);
	}

	writeFileSync(filePath, buf);
}

export interface OutroMediaProbe {
	durationSec: number;
	width: number;
	height: number;
	hasVideo: boolean;
	hasAudio: boolean;
	videoCodec: string | null;
	audioCodec: string | null;
	fileSizeBytes: number;
}

export async function probeMediaFile(filePath: string): Promise<OutroMediaProbe> {
	const { stdout } = await execFileAsync(
		'ffprobe',
		['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
		{ timeout: 15_000, windowsHide: true },
	);
	const parsed = JSON.parse(stdout) as {
		format?: { duration?: string };
		streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
	};
	const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
	const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
	return {
		durationSec: Number(parsed.format?.duration ?? 0),
		width: Number(videoStream?.width ?? 0),
		height: Number(videoStream?.height ?? 0),
		hasVideo: Boolean(videoStream),
		hasAudio: Boolean(audioStream),
		videoCodec: videoStream?.codec_name ?? null,
		audioCodec: audioStream?.codec_name ?? null,
		fileSizeBytes: existsSync(filePath) ? statSync(filePath).size : 0,
	};
}

export interface RenderMotionVelixOutroInput {
	config: VideoOutroConfig;
	outputDir: string;
	outputFilename?: string;
	quality?: 'preview' | 'master';
	/** Optional override for MotionVelix kit root in tests. */
	motionVelixKitDir?: string;
}

export interface RenderMotionVelixOutroResult {
	ok: boolean;
	outputMp4Path: string;
	durationSec: number;
	width: number;
	height: number;
	aspectRatio: OutroAspectRatio;
	style: OutroAnimationStyle;
	parallaxApplied: boolean;
	sfxApplied: string[];
	hasVideo: boolean;
	hasAudio: boolean;
	fileSizeBytes: number;
	engine: 'motionvelix_ffmpeg_hybrid';
}

async function rasterizeSvgToPng(svgContent: string, outputPngPath: string, width: number, height: number): Promise<void> {
	const sharpMod = await import('sharp');
	const sharp = sharpMod.default;
	await sharp(Buffer.from(svgContent, 'utf-8'))
		.resize(width, height)
		.png()
		.toFile(outputPngPath);
}

/**
 * Renders a real H.264/AAC MP4 Outro animation using MotionVelix SFX kit + FFmpeg
 * with animated parallax background, safe-zone typography/CTA overlay, and fade transitions.
 */
export async function renderMotionVelixOutroMp4(
	input: RenderMotionVelixOutroInput,
): Promise<RenderMotionVelixOutroResult> {
	const config = videoOutroConfigSchema.parse(input.config);
	const imgCheck = validateOutroBackgroundImagePath(config.backgroundImagePath);
	if (!imgCheck.ok) {
		throw new Error(imgCheck.error ?? 'Imagem de fundo inválida.');
	}

	const quality = input.quality ?? 'preview';
	const { width, height } = getOutroDimensions(config.aspectRatio, quality);
	const preset = getOutroStylePreset(config.style);
	const fps = 30;
	const totalFrames = Math.max(fps * 5, Math.round(config.durationSec * fps));

	mkdirSync(input.outputDir, { recursive: true });
	const workDir = join(input.outputDir, '_outro_work');
	mkdirSync(workDir, { recursive: true });

	const stamp = Date.now();
	const overlayPngPath = join(workDir, `outro-overlay-${stamp}.png`);
	const bedWavPath = join(workDir, `outro-bed-${stamp}.wav`);
	const fallbackBgPngPath = join(workDir, `outro-bg-fallback-${stamp}.png`);
	const outputMp4Path = join(
		input.outputDir,
		input.outputFilename ?? `motionvelix-outro-${config.style}-${config.aspectRatio.replace(':', 'x')}-${config.durationSec}s.mp4`,
	);

	// 1. Render crisp transparent overlay PNG (safe-zone aligned)
	const overlaySvg = buildOutroOverlaySvg(config, width, height);
	await rasterizeSvgToPng(overlaySvg, overlayPngPath, width, height);

	// 2. Prepare background image (chosen PNG/JPG/WEBP or dark Bento gradient fallback)
	let bgInputPath = config.backgroundImagePath ? resolve(config.backgroundImagePath) : null;
	if (!bgInputPath || !existsSync(bgInputPath)) {
		const fallbackBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			<defs>
				<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stop-color="#0f172a"/>
					<stop offset="55%" stop-color="#18181b"/>
					<stop offset="100%" stop-color="#09090b"/>
				</linearGradient>
			</defs>
			<rect width="100%" height="100%" fill="url(#g)"/>
		</svg>`;
		await rasterizeSvgToPng(fallbackBgSvg, fallbackBgPngPath, width, height);
		bgInputPath = fallbackBgPngPath;
	}

	// 3. Synthesize 48kHz stereo ambient bed + resolve MotionVelix SFX kit WAVs
	writeAmbientOutroBedWav(bedWavPath, config.durationSec, config.style);
	const kit = resolveMotionVelixKit(input.motionVelixKitDir ? { envVelixDir: input.motionVelixKitDir } : undefined);
	const sfxFiles: Array<{ kind: string; path: string; delayMs: number }> = [];
	if (kit.installed) {
		for (let idx = 0; idx < preset.sfxKinds.length; idx++) {
			const kind = preset.sfxKinds[idx]!;
			const found = kit.availableSfx.find((s) => s.kind === kind);
			if (found && existsSync(found.path)) {
				sfxFiles.push({
					kind,
					path: found.path,
					delayMs: idx === 0 ? 150 : Math.min(1800, Math.round(config.durationSec * 120)),
				});
			}
		}
	}

	// 4. Build FFmpeg filter_complex with Parallax motion + Overlay + Fade transitions + Audio mix
	const overscanW = Math.round(width * 1.24);
	const overscanH = Math.round(height * 1.24);
	const zoomDelta = (preset.zoomEnd - preset.zoomStart).toFixed(4);
	const fadeOutStart = Math.max(0.5, config.durationSec - preset.fadeOutSec).toFixed(2);

	const bgMotionFilter = config.parallaxEnabled
		? `[0:v]scale=${overscanW}:${overscanH}:force_original_aspect_ratio=increase,crop=${overscanW}:${overscanH},zoompan=z='${preset.zoomStart}+${zoomDelta}*on/${totalFrames}':x='iw/2-(iw/zoom/2)+${preset.panAmplitudeX}*sin(2*PI*on/${totalFrames})':y='ih/2-(ih/zoom/2)+${preset.panAmplitudeY}*cos(2*PI*on/${totalFrames})':d=${totalFrames}:s=${width}x${height}:fps=${fps},format=rgba[bg]`
		: `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},trim=duration=${config.durationSec},setpts=PTS-STARTPTS,format=rgba[bg]`;

	const overlayFilter = `[1:v]scale=${width}:${height},format=rgba,fade=t=in:st=0.25:d=${preset.fadeInSec}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${preset.fadeOutSec}:alpha=1[ov]`;
	const videoComposite = `[bg][ov]overlay=0:0:shortest=1,fade=t=in:st=0:d=${preset.fadeInSec},fade=t=out:st=${fadeOutStart}:d=${preset.fadeOutSec},format=yuv420p[vout]`;

	// Audio inputs: [2:a] = ambient bed WAV, [3:a..] = optional MotionVelix SFX
	const ffmpegArgs: string[] = [
		'-y',
		'-loop', '1',
		'-t', String(config.durationSec),
		'-i', bgInputPath,
		'-loop', '1',
		'-t', String(config.durationSec),
		'-i', overlayPngPath,
		'-i', bedWavPath,
	];

	const audioFilters: string[] = [
		`[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${config.durationSec},asetpts=PTS-STARTPTS[bed]`,
	];
	const mixLabels: string[] = ['[bed]'];

	sfxFiles.forEach((sfx, idx) => {
		const inputIdx = 3 + idx;
		ffmpegArgs.push('-i', sfx.path);
		const label = `[sfx${idx}]`;
		audioFilters.push(
			`[${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-8dB,adelay=${sfx.delayMs}|${sfx.delayMs}${label}`,
		);
		mixLabels.push(label);
	});

	if (mixLabels.length > 1) {
		audioFilters.push(
			`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,afade=t=in:st=0:d=${preset.fadeInSec},afade=t=out:st=${fadeOutStart}:d=${preset.fadeOutSec}[aout]`,
		);
	} else {
		audioFilters.push(
			`[bed]afade=t=in:st=0:d=${preset.fadeInSec},afade=t=out:st=${fadeOutStart}:d=${preset.fadeOutSec}[aout]`,
		);
	}

	const filterComplex = [bgMotionFilter, overlayFilter, videoComposite, ...audioFilters].join(';');

	ffmpegArgs.push(
		'-filter_complex', filterComplex,
		'-map', '[vout]',
		'-map', '[aout]',
		'-t', String(config.durationSec),
		'-r', String(fps),
		'-c:v', 'libx264',
		'-preset', quality === 'master' ? 'medium' : 'veryfast',
		'-crf', quality === 'master' ? '19' : '23',
		'-pix_fmt', 'yuv420p',
		'-c:a', 'aac',
		'-b:a', '192k',
		'-ar', '48000',
		'-ac', '2',
		'-movflags', '+faststart',
		outputMp4Path,
	);

	await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 120_000, windowsHide: true });

	const probe = await probeMediaFile(outputMp4Path);
	if (!probe.hasVideo || !probe.hasAudio || probe.fileSizeBytes === 0) {
		throw new Error('Falha na validação do MP4 de encerramento: stream de vídeo ou áudio ausente.');
	}

	return {
		ok: true,
		outputMp4Path,
		durationSec: Number(probe.durationSec.toFixed(2)),
		width: probe.width,
		height: probe.height,
		aspectRatio: config.aspectRatio,
		style: config.style,
		parallaxApplied: config.parallaxEnabled,
		sfxApplied: sfxFiles.map((s) => s.kind),
		hasVideo: probe.hasVideo,
		hasAudio: probe.hasAudio,
		fileSizeBytes: probe.fileSizeBytes,
		engine: 'motionvelix_ffmpeg_hybrid',
	};
}

export interface ComposeVideoWithOutroInput {
	mainVideoPath: string;
	outroVideoPath: string;
	outputMp4Path: string;
	aspectRatio?: OutroAspectRatio;
	quality?: 'preview' | 'master';
}

export interface ComposeVideoWithOutroResult {
	ok: boolean;
	outputMp4Path: string;
	mainDurationSec: number;
	outroDurationSec: number;
	composedDurationSec: number;
	hasVideo: boolean;
	hasAudio: boolean;
	fileSizeBytes: number;
}

/**
 * Appends the rendered Outro MP4 to the end of a main video MP4 WITHOUT cutting
 * narration or any scene from the main video (exact concatenation with matching
 * resolution, 30fps, yuv420p, and 48kHz stereo audio).
 */
export async function composeVideoWithOutroMp4(
	input: ComposeVideoWithOutroInput,
): Promise<ComposeVideoWithOutroResult> {
	if (!existsSync(input.mainVideoPath)) {
		throw new Error(`Vídeo principal não encontrado: ${input.mainVideoPath}`);
	}
	if (!existsSync(input.outroVideoPath)) {
		throw new Error(`Vídeo de encerramento não encontrado: ${input.outroVideoPath}`);
	}

	const mainProbe = await probeMediaFile(input.mainVideoPath);
	const outroProbe = await probeMediaFile(input.outroVideoPath);
	const targetW = mainProbe.width || outroProbe.width || 1280;
	const targetH = mainProbe.height || outroProbe.height || 720;
	const fps = 30;

	const filterComplex = [
		`[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setsar=1[v0]`,
		`[1:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setsar=1[v1]`,
		`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]`,
		`[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]`,
		`[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]`,
	].join(';');

	await execFileAsync(
		'ffmpeg',
		[
			'-y',
			'-i', input.mainVideoPath,
			'-i', input.outroVideoPath,
			'-filter_complex', filterComplex,
			'-map', '[vout]',
			'-map', '[aout]',
			'-c:v', 'libx264',
			'-preset', input.quality === 'master' ? 'medium' : 'veryfast',
			'-crf', input.quality === 'master' ? '19' : '23',
			'-pix_fmt', 'yuv420p',
			'-c:a', 'aac',
			'-b:a', '192k',
			'-ar', '48000',
			'-ac', '2',
			'-movflags', '+faststart',
			input.outputMp4Path,
		],
		{ timeout: 180_000, windowsHide: true },
	);

	const composedProbe = await probeMediaFile(input.outputMp4Path);
	return {
		ok: composedProbe.hasVideo && composedProbe.hasAudio && composedProbe.fileSizeBytes > 0,
		outputMp4Path: input.outputMp4Path,
		mainDurationSec: Number(mainProbe.durationSec.toFixed(2)),
		outroDurationSec: Number(outroProbe.durationSec.toFixed(2)),
		composedDurationSec: Number(composedProbe.durationSec.toFixed(2)),
		hasVideo: composedProbe.hasVideo,
		hasAudio: composedProbe.hasAudio,
		fileSizeBytes: composedProbe.fileSizeBytes,
	};
}

// ─── Persistent Store (Per-Project & Channel Default) ────────────────────────

function sanitizeKey(raw: string): string {
	return raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function writeJsonAtomic(filePath: string, data: unknown): void {
	const dir = resolve(filePath, '..');
	mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	renameSync(tmp, filePath);
}

export class VideoOutroConfigStore {
	private readonly projectsDir: string;
	private readonly channelsDir: string;

	constructor(workspaceDir: string) {
		this.projectsDir = join(workspaceDir, 'outro-configs', 'projects');
		this.channelsDir = join(workspaceDir, 'outro-configs', 'channels');
	}

	private projectFile(projectId: string): string {
		return join(this.projectsDir, `${sanitizeKey(projectId)}.json`);
	}

	private channelFile(channelKey: string): string {
		return join(this.channelsDir, `${sanitizeKey(channelKey)}.json`);
	}

	loadProjectConfig(projectId: string): VideoOutroConfig | null {
		const path = this.projectFile(projectId);
		if (!existsSync(path)) return null;
		try {
			return videoOutroConfigSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
		} catch {
			return null;
		}
	}

	loadChannelDefault(channelKey: string): VideoOutroConfig | null {
		const path = this.channelFile(channelKey);
		if (!existsSync(path)) return null;
		try {
			return videoOutroConfigSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
		} catch {
			return null;
		}
	}

	/**
	 * Loads the effective Outro configuration for a project:
	 * 1. Saved project config, if present.
	 * 2. Saved channel default config, if present.
	 * 3. Default configuration pre-filled with configured channelName.
	 */
	loadEffectiveConfig(input: {
		projectId: string;
		channelKey?: string | null;
		channelName?: string | null;
	}): { config: VideoOutroConfig; source: 'project' | 'channel_default' | 'default' } {
		const projectCfg = this.loadProjectConfig(input.projectId);
		if (projectCfg) {
			return {
				config: {
					...projectCfg,
					channelName: projectCfg.channelName || input.channelName?.trim() || '',
				},
				source: 'project',
			};
		}
		const chKey = input.channelKey || input.channelName;
		if (chKey) {
			const channelCfg = this.loadChannelDefault(chKey);
			if (channelCfg) {
				return {
					config: {
						...channelCfg,
						channelName: channelCfg.channelName || input.channelName?.trim() || '',
					},
					source: 'channel_default',
				};
			}
		}
		return {
			config: {
				...DEFAULT_VIDEO_OUTRO_CONFIG,
				channelName: input.channelName?.trim() || '',
			},
			source: 'default',
		};
	}

	saveProjectConfig(
		projectId: string,
		config: Partial<VideoOutroConfig>,
		options?: { channelKey?: string | null; saveAsChannelDefault?: boolean },
	): VideoOutroConfig {
		const merged = videoOutroConfigSchema.parse({
			...DEFAULT_VIDEO_OUTRO_CONFIG,
			...config,
		});
		writeJsonAtomic(this.projectFile(projectId), merged);
		if (options?.saveAsChannelDefault || merged.saveAsChannelDefault) {
			const chKey = options?.channelKey || merged.channelName || 'default-channel';
			writeJsonAtomic(this.channelFile(chKey), merged);
		}
		return merged;
	}

	removeProjectConfig(projectId: string): boolean {
		const path = this.projectFile(projectId);
		if (!existsSync(path)) return false;
		rmSync(path, { force: true });
		return true;
	}
}
