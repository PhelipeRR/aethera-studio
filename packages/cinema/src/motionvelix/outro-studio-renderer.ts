/**
 * MotionVelix Outro Studio 3.0 — Real Multi-Template Renderer (Fire, Electric, Particle, Glitch)
 *
 * - Renders all 4 templates with proportional 6-phase keyframes (0-2-5-7-10-13-15s scaled to any 5-30s duration).
 * - Preserves exact aspect ratio and alpha transparency of ANY user-selected logo (PNG, WebP, sanitized SVG).
 * - Progressive mask reveal for the logo synced to the impact keyframe.
 * - Real MotionVelix WAV SFX mixing (NEVER synthetic sine tones!) + optional user music track.
 * - Full integration with OutroCacheManager (Level C render cache hit/miss/invalidation).
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveMotionVelixKit } from '../recap/phase3/recap-motionvelix.js';
import {
	parseFirePaletteRgb,
	renderFireRevealFrameRgba,
	renderFlamePackFrameRgba,
	type FlamePackVariant,
} from './procedural-fire-shader.js';

const FLAME_PACK_VARIANTS = new Set<string>(['flame_wide', 'flame_banner', 'flame_squircle', 'flame_circle']);
import {
	computeRenderCacheKey,
	OUTRO_RENDERER_VERSION,
	OutroCacheManager,
	sha256File,
} from './outro-cache-manager.js';
import {
	computeProportionalKeyframes,
	mapIntensityToVisualParams,
	outroStudioConfigV3Schema,
	resolveOutroTemplateWithFallback,
	type OutroKeyframeSchedule,
	type OutroStudioConfigV3,
} from './outro-template-registry.js';
import {
	getOutroDimensions,
	getOutroSafeZone,
	probeMediaFile,
	validateOutroBackgroundImagePath,
} from './video-outro-engine.js';

const execFileAsync = promisify(execFile);

function escapeXml(raw: string): string {
	return raw
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function resolveSfxPath(filename: string, kitSfxDir: string | null): string | null {
	if (!kitSfxDir) return null;
	const full = join(kitSfxDir, filename);
	if (existsSync(full)) return full;
	const fallback = join(kitSfxDir, 'whoosh.wav');
	return existsSync(fallback) ? fallback : null;
}

/**
 * Generates the template-specific animated energy/atmosphere SVG layer (recolored by `config.palette`
 * and scaled by `config.intensity`) rasterized via sharp.
 */
function buildTemplateEnergySvg(
	config: OutroStudioConfigV3,
	width: number,
	height: number,
): string {
	const p = config.palette;
	const iv = mapIntensityToVisualParams(config.intensity, config.templateId);
	const cx = Math.round(width / 2);
	const cy = Math.round(height * 0.43);

	if (config.templateId === 'electric_reveal') {
		// Branching high-voltage lightning arcs + corona ring
		const bolts: string[] = [];
		const boltCount = Math.max(4, Math.round(6 * iv.turbulenceScale));
		for (let i = 0; i < boltCount; i++) {
			const angle = (i / boltCount) * Math.PI * 2;
			const r1 = Math.min(width, height) * 0.14;
			const r2 = Math.min(width, height) * 0.34;
			const r3 = Math.min(width, height) * 0.52;
			const x1 = Math.round(cx + Math.cos(angle) * r1);
			const y1 = Math.round(cy + Math.sin(angle) * r1);
			const x2 = Math.round(cx + Math.cos(angle + 0.12) * r2);
			const y2 = Math.round(cy + Math.sin(angle - 0.1) * r2);
			const x3 = Math.round(cx + Math.cos(angle - 0.06) * r3);
			const y3 = Math.round(cy + Math.sin(angle + 0.08) * r3);
			bolts.push(
				`<polyline points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="none" stroke="${p.energy}" stroke-width="4" stroke-linecap="round" opacity="${iv.energyOpacity}" />`,
				`<polyline points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" opacity="0.85" />`,
			);
		}
		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="elecGlow" cx="50%" cy="43%" r="48%">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="${(0.55 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="55%" stop-color="${p.primary}" stop-opacity="${(0.28 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#elecGlow)"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.round(Math.min(width, height) * 0.22)}" fill="none" stroke="${p.energy}" stroke-width="4" opacity="${iv.energyOpacity}"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.round(Math.min(width, height) * 0.27)}" fill="none" stroke="${p.secondary}" stroke-width="2" stroke-dasharray="18 12" opacity="0.65"/>
  ${bolts.join('\n  ')}
</svg>`;
	}

	if (config.templateId === 'particle_reveal') {
		// Converging deterministic orbital particle constellation
		const dots: string[] = [];
		for (let i = 0; i < iv.particleCount; i++) {
			const golden = i * 2.399963229728653;
			const frac = (i + 1) / (iv.particleCount + 1);
			const radius = Math.min(width, height) * (0.09 + 0.42 * Math.sqrt(frac));
			const px = Math.round(cx + Math.cos(golden) * radius * 1.25);
			const py = Math.round(cy + Math.sin(golden) * radius * 0.85);
			const r = (2 + (i % 5) * 1.6).toFixed(1);
			const fill = i % 3 === 0 ? p.particles : i % 2 === 0 ? p.energy : p.glow;
			const op = (0.35 + ((i * 17) % 60) / 100).toFixed(2);
			dots.push(`<circle cx="${px}" cy="${py}" r="${r}" fill="${fill}" opacity="${op}"/>`);
		}
		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="partGlow" cx="50%" cy="43%" r="54%">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="${(0.5 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="60%" stop-color="${p.primary}" stop-opacity="${(0.22 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#partGlow)"/>
  ${dots.join('\n  ')}
</svg>`;
	}

	if (config.templateId === 'glitch_reveal') {
		// Cyber RGB scanlines + digital slice bars
		const bars: string[] = [];
		const barCount = Math.max(8, Math.round(14 * iv.turbulenceScale));
		for (let i = 0; i < barCount; i++) {
			const y = Math.round(((i + 0.5) / barCount) * height);
			const h = 3 + (i % 4) * 4;
			const x = Math.round(((i * 197) % 70) * (width / 100));
			const w = Math.round(width * (0.12 + ((i * 31) % 28) / 100));
			const fill = i % 2 === 0 ? p.primary : p.secondary;
			bars.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="${(0.32 * iv.energyOpacity).toFixed(2)}"/>`);
		}
		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="cyberWash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.primary}" stop-opacity="0.22"/>
      <stop offset="50%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="${p.secondary}" stop-opacity="0.24"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#cyberWash)"/>
  ${bars.join('\n  ')}
</svg>`;
	}

	// Default: `fire_reveal` — 2D Anime Cel-Shaded Sakuga Fire (per-frame animated)
	return buildSakugaFireFrameSvg(config, width, height, 0, 24);
}

/**
 * Generates one frame of 2D Anime Cel-Shaded Sakuga Fire (animated on 2s @ 12fps):
 * - Deep smoky radial glow
 * - Twin curved cel-shaded crescent flame wings cradling the user's logo
 * - 3-tone cel-shaded roaring anime bottom flame wall (primary shadow + energy body + hot core + white highlight)
 * - Rising flickering flame droplets
 */
function buildSakugaFireFrameSvg(
	config: OutroStudioConfigV3,
	width: number,
	height: number,
	frameIdx: number,
	loopFrames: number,
): string {
	const p = config.palette;
	const iv = mapIntensityToVisualParams(config.intensity, config.templateId);
	const isVertical = config.aspectRatio === '9:16';
	const phase = (frameIdx / Math.max(1, loopFrames)) * Math.PI * 2;
	const cx = Math.round(width / 2);
	const cradleY = Math.round(height * (isVertical ? 0.36 : 0.36));
	const cradleR = Math.round(Math.min(width, height) * (isVertical ? 0.24 : 0.22));
	const swayA = Math.round(Math.sin(phase) * 18 * iv.turbulenceScale);
	const swayB = Math.round(Math.cos(phase * 2) * 12 * iv.turbulenceScale);

	const buildCelWall = (yBase: number, ampScale: number, phOff: number): string => {
		const steps = 11;
		let d = `M -40,${height + 40} L -40,${Math.round(yBase)}`;
		for (let i = 0; i < steps; i++) {
			const x0 = (i / steps) * (width + 80) - 40;
			const xMid = ((i + 0.5) / steps) * (width + 80) - 40;
			const x1 = ((i + 1) / steps) * (width + 80) - 40;
			const flicker = Math.sin(phase * (1 + (i % 2)) + i * 1.7 + phOff) * 26;
			const curl = Math.cos(phase + i * 2.1 + phOff) * 22;
			const peakY = yBase - height * (0.14 + (i % 3) * 0.055) * ampScale + flicker;
			const valleyY = yBase - height * 0.03 * ampScale - flicker * 0.3;
			d += ` Q ${Math.round(x0 + (xMid - x0) * 0.35 + curl)},${Math.round(peakY + 32)} ${Math.round(xMid + curl)},${Math.round(peakY)} Q ${Math.round(xMid + (x1 - xMid) * 0.55 - curl * 0.4)},${Math.round(valleyY - 8)} ${Math.round(x1)},${Math.round(valleyY)}`;
		}
		d += ` L ${width + 40},${height + 40} Z`;
		return d;
	};

	const droplets: string[] = [];
	const dropCount = Math.max(12, Math.round(iv.particleCount * 0.75));
	for (let i = 0; i < dropCount; i++) {
		const pFrac = ((frameIdx / loopFrames) + i * 0.17) % 1;
		const ex = Math.round(width * (((i * 43 + 11) % 90 + 5) / 100) + Math.sin(phase + i * 1.9) * 18);
		const ey = Math.round(height * (0.94 - pFrac * 0.82));
		const sz = Math.max(3, Math.round((5 + (i % 4) * 3.2) * (1 - pFrac * 0.5)));
		const fill = i % 3 === 0 ? '#FFFFFF' : i % 2 === 0 ? p.glow : p.energy;
		droplets.push(
			`<path d="M ${ex},${ey - Math.round(sz * 1.6)} Q ${ex + sz},${ey} ${ex},${ey + sz} Q ${ex - sz},${ey} ${ex},${ey - Math.round(sz * 1.6)} Z" fill="${fill}" opacity="${(0.85 * (1 - pFrac)).toFixed(2)}"/>`,
		);
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="sakugaHalo" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="${p.energy}" stop-opacity="${(0.42 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="50%" stop-color="${p.primary}" stop-opacity="${(0.24 * iv.energyOpacity).toFixed(2)}"/>
      <stop offset="100%" stop-color="#05070D" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sakugaHalo)"/>
  <!-- Twin Curved Anime Flame Wings Cradling the Logo -->
  <g opacity="${(0.75 + 0.25 * iv.normalized).toFixed(2)}" transform="translate(0, ${Math.round(swayB * 0.35)})">
    <path d="M ${cx},${Math.round(cradleY + cradleR * 0.92)} C ${Math.round(cx - cradleR * 1.15)},${Math.round(cradleY + cradleR * 0.72)} ${Math.round(cx - cradleR * 1.38 + swayA)},${Math.round(cradleY - cradleR * 0.25)} ${Math.round(cx - cradleR * 0.58 + swayB)},${Math.round(cradleY - cradleR * 1.05)} C ${Math.round(cx - cradleR * 0.92)},${Math.round(cradleY - cradleR * 0.28)} ${Math.round(cx - cradleR * 0.78)},${Math.round(cradleY + cradleR * 0.48)} ${cx},${Math.round(cradleY + cradleR * 0.78)} Z" fill="${p.energy}"/>
    <path d="M ${cx - 4},${Math.round(cradleY + cradleR * 0.86)} C ${Math.round(cx - cradleR * 0.92)},${Math.round(cradleY + cradleR * 0.62)} ${Math.round(cx - cradleR * 1.08 + swayA * 0.7)},${Math.round(cradleY - cradleR * 0.18)} ${Math.round(cx - cradleR * 0.56 + swayB * 0.7)},${Math.round(cradleY - cradleR * 0.82)} C ${Math.round(cx - cradleR * 0.78)},${Math.round(cradleY - cradleR * 0.18)} ${Math.round(cx - cradleR * 0.66)},${Math.round(cradleY + cradleR * 0.44)} ${cx - 4},${Math.round(cradleY + cradleR * 0.76)} Z" fill="${p.glow}"/>
    <path d="M ${cx},${Math.round(cradleY + cradleR * 0.92)} C ${Math.round(cx + cradleR * 1.15)},${Math.round(cradleY + cradleR * 0.72)} ${Math.round(cx + cradleR * 1.38 - swayA)},${Math.round(cradleY - cradleR * 0.25)} ${Math.round(cx + cradleR * 0.58 - swayB)},${Math.round(cradleY - cradleR * 1.05)} C ${Math.round(cx + cradleR * 0.92)},${Math.round(cradleY - cradleR * 0.28)} ${Math.round(cx + cradleR * 0.78)},${Math.round(cradleY + cradleR * 0.48)} ${cx},${Math.round(cradleY + cradleR * 0.78)} Z" fill="${p.energy}"/>
    <path d="M ${cx + 4},${Math.round(cradleY + cradleR * 0.86)} C ${Math.round(cx + cradleR * 0.92)},${Math.round(cradleY + cradleR * 0.62)} ${Math.round(cx + cradleR * 1.08 - swayA * 0.7)},${Math.round(cradleY - cradleR * 0.18)} ${Math.round(cx + cradleR * 0.56 - swayB * 0.7)},${Math.round(cradleY - cradleR * 0.82)} C ${Math.round(cx + cradleR * 0.78)},${Math.round(cradleY - cradleR * 0.18)} ${Math.round(cx + cradleR * 0.66)},${Math.round(cradleY + cradleR * 0.44)} ${cx + 4},${Math.round(cradleY + cradleR * 0.76)} Z" fill="${p.glow}"/>
  </g>
  <!-- 3-Tone Cel-Shaded Roaring Bottom Anime Flame Wall -->
  <path d="${buildCelWall(height * 0.9, 1.32, 0.4)}" fill="${p.primary}" opacity="0.45"/>
  <path d="${buildCelWall(height * 0.96, 1.15, 1.2)}" fill="${p.energy}"/>
  <path d="${buildCelWall(height * 1.01, 0.78, 2.0)}" fill="${p.glow}"/>
  <path d="${buildCelWall(height * 1.05, 0.45, 2.8)}" fill="#FFFFFF" opacity="0.88"/>
  ${droplets.join('\n  ')}
</svg>`;
}

/**
 * Generates the Channel Title SVG layer (revealed at 7–10s proportionally).
 */
function buildChannelTitleSvg(config: OutroStudioConfigV3, width: number, height: number): string {
	const safe = getOutroSafeZone(config.aspectRatio, width >= 1080 && height >= 1080 ? 'master' : 'preview');
	const isVertical = config.aspectRatio === '9:16';
	const cx = Math.round(safe.marginLeft + safe.contentWidth / 2);
	const titleText = escapeXml((config.texts.channelTitle || config.channelName || 'Aethera Studio').trim());
	const preTitle = escapeXml((config.texts.preTitle || 'OBRIGADO POR ASSISTIR').trim());
	const titleSize = isVertical ? Math.round(width * 0.068) : Math.round(width * 0.044);
	const preSize = isVertical ? Math.round(width * 0.026) : Math.round(width * 0.015);
	const baseY = config.logoDisabled
		? Math.round(safe.marginTop + safe.contentHeight * 0.42)
		: Math.round(safe.marginTop + safe.contentHeight * (isVertical ? 0.56 : 0.62));

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text x="${cx}" y="${baseY - Math.round(titleSize * 0.95)}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${preSize}" font-weight="700" letter-spacing="3" fill="${config.palette.glow}">${preTitle}</text>
  <text x="${cx}" y="${baseY}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="${config.palette.text}">${titleText}</text>
</svg>`;
}

/**
 * Generates the Subscribe CTA + optional Next Video Card SVG layer (revealed at 10–13s proportionally).
 */
function buildCtaLayerSvg(config: OutroStudioConfigV3, width: number, height: number): string {
	if (!config.showSubscribeCta && !config.showNextVideoCard) {
		return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
	}
	const safe = getOutroSafeZone(config.aspectRatio, width >= 1080 && height >= 1080 ? 'master' : 'preview');
	const isVertical = config.aspectRatio === '9:16';
	const cx = Math.round(safe.marginLeft + safe.contentWidth / 2);
	const ctaText = escapeXml((config.texts.subscribeCtaText || 'INSCREVA-SE NO CANAL').trim());
	const ctaW = isVertical ? Math.round(safe.contentWidth * 0.82) : Math.round(width * 0.3);
	const ctaH = isVertical ? Math.round(height * 0.056) : Math.round(height * 0.078);
	const ctaX = Math.round(cx - ctaW / 2);
	const ctaY = Math.round(safe.marginTop + safe.contentHeight * (isVertical ? 0.68 : 0.74));
	const ctaFont = isVertical ? Math.round(width * 0.032) : Math.round(width * 0.019);

	const ctaXml = config.showSubscribeCta
		? `<rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH / 2)}" fill="${config.palette.ctaBg}"/>
  <text x="${cx}" y="${ctaY + Math.round(ctaH * 0.64)}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${ctaFont}" font-weight="800" fill="${config.palette.ctaText}">${ctaText}</text>`
		: '';

	const nextCardXml = config.showNextVideoCard
		? (() => {
				const cardW = isVertical ? Math.round(safe.contentWidth * 0.72) : Math.round(width * 0.24);
				const cardH = Math.round(cardW * (9 / 16));
				const cardX = isVertical ? Math.round(cx - cardW / 2) : Math.round(safe.width - safe.marginRight - cardW);
				const cardY = isVertical
					? ctaY + ctaH + 22
					: Math.round(safe.marginTop + safe.contentHeight * 0.52);
				const label = escapeXml((config.texts.nextVideoLabel || 'PRÓXIMO VÍDEO').trim());
				const nextTitle = escapeXml((config.texts.nextVideoTitle || 'Assista a seguir').trim());
				return `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="rgba(12,15,24,0.78)" stroke="${config.palette.energy}" stroke-width="2.5"/>
  <text x="${cardX + 16}" y="${cardY + 26}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${Math.max(11, Math.round(ctaFont * 0.68))}" font-weight="700" fill="${config.palette.glow}">${label}</text>
  <text x="${cardX + 16}" y="${cardY + cardH - 16}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${Math.max(12, Math.round(ctaFont * 0.74))}" font-weight="600" fill="${config.palette.text}">${nextTitle}</text>`;
			})()
		: '';

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${ctaXml}
  ${nextCardXml}
</svg>`;
}

export interface RenderOutroStudioV3Input {
	config: OutroStudioConfigV3;
	logoFilePath?: string | null;
	logoHash?: string | null;
	logoVersion?: number | null;
	outputDir: string;
	outputFilename?: string;
	quality?: 'preview' | 'master';
	cacheManager?: OutroCacheManager;
	motionVelixKitDir?: string;
}

export interface RenderOutroStudioV3Result {
	ok: boolean;
	outputMp4Path: string;
	cacheKey: string;
	cacheHit: boolean;
	templateId: string;
	templateVersion: string;
	durationSec: number;
	width: number;
	height: number;
	aspectRatio: '16:9' | '9:16';
	keyframes: OutroKeyframeSchedule;
	logoApplied: boolean;
	logoVersion: number | null;
	sfxApplied: string[];
	musicApplied: boolean;
	hasVideo: boolean;
	hasAudio: boolean;
	fileSizeBytes: number;
	renderDurationMs: number;
	engine: 'motionvelix_studio_v3_ffmpeg';
}

/**
 * Renders any of the 4 registered MotionVelix Studio 3.0 templates (`fire_reveal`, `electric_reveal`,
 * `particle_reveal`, `glitch_reveal`) with progressive logo reveal, proportional keyframes,
 * real MotionVelix WAV SFX mixing (zero synthetic sine tones), and 3-level cache support.
 */
export async function renderOutroStudioV3Mp4(
	input: RenderOutroStudioV3Input,
): Promise<RenderOutroStudioV3Result> {
	const startedAt = Date.now();
	const parsed = outroStudioConfigV3Schema.parse(input.config);
	const { template } = resolveOutroTemplateWithFallback(parsed.templateId);
	const config: OutroStudioConfigV3 = {
		...parsed,
		templateId: template.templateId,
		templateVersion: template.version,
	};

	const imgCheck = validateOutroBackgroundImagePath(config.backgroundImagePath);
	if (!imgCheck.ok) {
		throw new Error(imgCheck.error ?? 'Imagem de fundo inválida.');
	}

	const quality = input.quality ?? 'preview';
	const { width, height } = getOutroDimensions(config.aspectRatio, quality);
	const fps = 30;
	const durationSec = Number((config.durationMs / 1000).toFixed(3));
	const totalFrames = Math.max(fps * 5, Math.round(durationSec * fps));
	const keyframes = computeProportionalKeyframes(config.durationMs);
	const iv = mapIntensityToVisualParams(config.intensity, config.templateId);

	const effectiveLogoPath =
		!config.logoDisabled && input.logoFilePath && existsSync(input.logoFilePath)
			? resolve(input.logoFilePath)
			: null;
	const logoHash = effectiveLogoPath ? (input.logoHash ?? sha256File(effectiveLogoPath)) : null;
	const logoVersion = effectiveLogoPath ? (input.logoVersion ?? config.selectedLogoVersion ?? 1) : null;
	const bgHash = config.backgroundImagePath ? sha256File(config.backgroundImagePath) : null;
	const musicPath =
		config.audio.enabled && config.audio.musicPath && existsSync(config.audio.musicPath)
			? resolve(config.audio.musicPath)
			: null;
	const musicHash = musicPath ? sha256File(musicPath) : null;

	const cacheKey = computeRenderCacheKey({
		config,
		logoHash,
		logoVersion,
		backgroundHash: bgHash,
		musicHash,
		width,
		height,
		fps,
		rendererVersion: OUTRO_RENDERER_VERSION,
	});

	// Check Level C Render Cache
	if (input.cacheManager) {
		const cached = input.cacheManager.getValid('renders', cacheKey);
		if (cached) {
			const probe = await probeMediaFile(cached.filePath);
			return {
				ok: true,
				outputMp4Path: cached.filePath,
				cacheKey,
				cacheHit: true,
				templateId: config.templateId,
				templateVersion: config.templateVersion,
				durationSec: Number(probe.durationSec.toFixed(2)),
				width: probe.width,
				height: probe.height,
				aspectRatio: config.aspectRatio,
				keyframes,
				logoApplied: Boolean(effectiveLogoPath),
				logoVersion,
				sfxApplied: [],
				musicApplied: Boolean(musicPath),
				hasVideo: probe.hasVideo,
				hasAudio: probe.hasAudio,
				fileSizeBytes: probe.fileSizeBytes,
				renderDurationMs: Date.now() - startedAt,
				engine: 'motionvelix_studio_v3_ffmpeg',
			};
		}
	}

	mkdirSync(input.outputDir, { recursive: true });
	const workDir = join(input.outputDir, `_v3_work_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
	mkdirSync(workDir, { recursive: true });

	const sharpMod = await import('sharp');
	const sharp = sharpMod.default;

	try {
		const bgPng = join(workDir, 'bg.png');
		const energyPng = join(workDir, 'energy.png');
		const logoCanvasPng = join(workDir, 'logo.png');
		const titlePng = join(workDir, 'title.png');
		const ctaPng = join(workDir, 'cta.png');

		// Layer 1: Background image (or deep dark studio base)
		if (config.backgroundImagePath && existsSync(config.backgroundImagePath)) {
			const overscanW = config.parallaxEnabled ? Math.round(width * 1.2) : width;
			const overscanH = config.parallaxEnabled ? Math.round(height * 1.2) : height;
			await sharp(config.backgroundImagePath)
				.resize(overscanW, overscanH, { fit: 'cover' })
				.png()
				.toFile(bgPng);
		} else {
			const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
				<defs>
					<radialGradient id="darkBg" cx="50%" cy="44%" r="72%">
						<stop offset="0%" stop-color="#141829"/>
						<stop offset="100%" stop-color="#05070D"/>
					</radialGradient>
				</defs>
				<rect width="${width}" height="${height}" fill="url(#darkBg)"/>
			</svg>`;
			await sharp(Buffer.from(fallbackSvg)).png().toFile(bgPng);
		}

		// Layer 2 & 3: Energy layer for non-shader templates
		const isFlamePack = FLAME_PACK_VARIANTS.has(config.templateId);
		if (config.templateId !== 'fire_reveal' && !isFlamePack) {
			await sharp(Buffer.from(buildTemplateEnergySvg(config, width, height)))
				.resize(width, height)
				.png()
				.toFile(energyPng);
		}

		// Layer 4 & 5: User Logo placed inside safe zone (or centered inside Flame Pack frame) preserving exact aspect ratio & alpha
		const safe = getOutroSafeZone(config.aspectRatio, quality);
		const isVertical = config.aspectRatio === '9:16';
		if (effectiveLogoPath) {
			const frameCy = isVertical ? 0.42 : 0.45;
			const maxLogoW = isFlamePack
				? Math.round(width * (config.templateId === 'flame_wide' || config.templateId === 'flame_banner' ? (isVertical ? 0.62 : 0.34) : (isVertical ? 0.38 : 0.16)) * config.logoTransform.scale)
				: Math.round(safe.contentWidth * (isVertical ? 0.56 : 0.34) * config.logoTransform.scale);
			const maxLogoH = isFlamePack
				? Math.round(height * (config.templateId === 'flame_wide' || config.templateId === 'flame_banner' ? (isVertical ? 0.11 : 0.17) : (isVertical ? 0.18 : 0.24)) * config.logoTransform.scale)
				: Math.round(safe.contentHeight * (isVertical ? 0.24 : 0.36) * config.logoTransform.scale);
			const resizedLogo = await sharp(effectiveLogoPath)
				.resize(Math.max(48, maxLogoW), Math.max(48, maxLogoH), {
					fit: 'inside',
					withoutEnlargement: false,
				})
				.png()
				.toBuffer();
			const logoMeta = await sharp(resizedLogo).metadata();
			const lw = logoMeta.width ?? maxLogoW;
			const lh = logoMeta.height ?? maxLogoH;
			const left = Math.max(
				0,
				Math.min(
					width - lw,
					Math.round(width / 2 - lw / 2 + config.logoTransform.offsetX),
				),
			);
			const top = Math.max(
				0,
				Math.min(
					height - lh,
					Math.round(
						(isFlamePack ? height * frameCy : safe.marginTop + safe.contentHeight * 0.34) -
							lh / 2 +
							config.logoTransform.offsetY,
					),
				),
			);
			await sharp({
				create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
			})
				.composite([{ input: resizedLogo, left, top }])
				.png()
				.toFile(logoCanvasPng);
		} else {
			await sharp({
				create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
			})
				.png()
				.toFile(logoCanvasPng);
		}

		// Layer 6 & 7: Channel Title & CTA (Flame Pack uses ultra-clean minimalist typography below the glowing frame!)
		if (isFlamePack) {
			const cxText = Math.round(width / 2);
			const isSquareOrCircle = config.templateId === 'flame_squircle' || config.templateId === 'flame_circle';
			const textBaseY = Math.round(height * (isVertical ? (isSquareOrCircle ? 0.65 : 0.59) : (isSquareOrCircle ? 0.71 : 0.67)));
			const mainTitle = escapeXml((config.texts.channelTitle || config.channelName || 'NextWorth').trim());
			const subCta = escapeXml((config.texts.subscribeCtaText || 'INSCREVA-SE').trim().toUpperCase());
			const mainSize = Math.round(width * (isVertical ? 0.05 : 0.026));
			const subSize = Math.round(width * (isVertical ? 0.028 : 0.014));
			const minimalTitleSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text x="${cxText}" y="${textBaseY}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${mainSize}" font-weight="800" letter-spacing="1.5" fill="${config.palette.text}">${mainTitle}</text>
</svg>`;
			const minimalCtaSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${config.showSubscribeCta ? `<text x="${cxText}" y="${textBaseY + Math.round(mainSize * 1.18)}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="${subSize}" font-weight="600" letter-spacing="4" fill="rgba(255,255,255,0.82)">${subCta}</text>` : ''}
</svg>`;
			await sharp(Buffer.from(minimalTitleSvg)).resize(width, height).png().toFile(titlePng);
			await sharp(Buffer.from(minimalCtaSvg)).resize(width, height).png().toFile(ctaPng);
		} else {
			await sharp(Buffer.from(buildChannelTitleSvg(config, width, height)))
				.resize(width, height)
				.png()
				.toFile(titlePng);
			await sharp(Buffer.from(buildCtaLayerSvg(config, width, height)))
				.resize(width, height)
				.png()
				.toFile(ctaPng);
		}

		// Layer 9: Real MotionVelix SFX kit WAVs (NO synthetic sine tones!)
		const kit = resolveMotionVelixKit(input.motionVelixKitDir ? { envVelixDir: input.motionVelixKitDir } : undefined);
		const sfxCues: Array<{ name: string; path: string; delayMs: number; volume: number }> = [];
		if (config.audio.enabled && kit.sfxDir) {
			const cueSpecs = [
				{ name: template.sfxProfile.intro, delaySec: 0.2, volume: config.audio.introSfxVolume },
				{ name: template.sfxProfile.whoosh, delaySec: keyframes.energyInStartSec, volume: config.audio.whooshVolume },
				{ name: template.sfxProfile.impact, delaySec: keyframes.logoRevealStartSec, volume: config.audio.impactVolume },
				{ name: template.sfxProfile.subscribe, delaySec: keyframes.ctaStartSec, volume: config.audio.subscribeSfxVolume },
			];
			for (const cue of cueSpecs) {
				if (cue.volume <= 0.01) continue;
				const p = resolveSfxPath(cue.name, kit.sfxDir);
				if (p) {
					sfxCues.push({
						name: cue.name,
						path: p,
						delayMs: Math.max(0, Math.round(cue.delaySec * 1000)),
						volume: cue.volume,
					});
				}
			}
		}

		const outputMp4Path = join(
			input.outputDir,
			input.outputFilename ?? `outro-v3-${config.templateId}-${config.aspectRatio.replace(':', 'x')}-${Math.round(durationSec)}s.mp4`,
		);

		// True 2D FBM Fluid Fire Shader pipeline for `fire_reveal` AND the 4 Flame Logo Pack variants
		if (config.templateId === 'fire_reveal' || isFlamePack) {
			const simW = config.aspectRatio === '9:16' ? 270 : 480;
			const simH = config.aspectRatio === '9:16' ? 480 : 270;
			const fireFps = 24;
			const fireTotalFrames = Math.max(fireFps * 5, Math.round(durationSec * fireFps));

			let bgRgba: Uint8Array | null = null;
			if (!isFlamePack && config.backgroundImagePath && existsSync(config.backgroundImagePath)) {
				const rawBg = await sharp(config.backgroundImagePath)
					.resize(simW, simH, { fit: 'cover' })
					.ensureAlpha()
					.raw()
					.toBuffer();
				bgRgba = new Uint8Array(rawBg.buffer, rawBg.byteOffset, rawBg.byteLength);
			}

			let logoRgba: Uint8Array | null = null;
			if (effectiveLogoPath) {
				const rawLogo = await sharp(logoCanvasPng)
					.resize(simW, simH, { fit: 'fill' })
					.ensureAlpha()
					.raw()
					.toBuffer();
				logoRgba = new Uint8Array(rawLogo.buffer, rawLogo.byteOffset, rawLogo.byteLength);
			}

			const fadeOutDur = Math.max(0.4, Math.min(2.0, config.audio.fadeOutSec || 0.8));
			const fadeOutStart = Math.max(0.5, durationSec - fadeOutDur).toFixed(2);
			const titleStartSec = isFlamePack ? Number((3.4 * (durationSec / 15)).toFixed(2)) : keyframes.channelRevealStartSec;
			const ctaStartSec = isFlamePack ? Number((4.2 * (durationSec / 15)).toFixed(2)) : keyframes.ctaStartSec;
			const titleRevealDur = Math.max(0.4, (keyframes.channelRevealEndSec - keyframes.channelRevealStartSec) * 0.5).toFixed(2);
			const ctaRevealDur = Math.max(0.35, (keyframes.ctaEndSec - keyframes.ctaStartSec) * 0.45).toFixed(2);

			const fireArgs: string[] = [
				'-y',
				'-f', 'rawvideo',
				'-pix_fmt', 'rgba',
				'-s', `${simW}x${simH}`,
				'-r', String(fireFps),
				'-i', 'pipe:0',
				'-loop', '1', '-t', String(durationSec), '-i', titlePng,
				'-loop', '1', '-t', String(durationSec), '-i', ctaPng,
			];

			const audioFilters: string[] = [];
			const mixLabels: string[] = [];
			let nextIdx = 3;
			if (musicPath) {
				fireArgs.push('-stream_loop', '-1', '-t', String(durationSec), '-i', musicPath);
				audioFilters.push(
					`[${nextIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},asetpts=PTS-STARTPTS,volume=${config.audio.musicVolume.toFixed(2)}[base_a]`,
				);
				mixLabels.push('[base_a]');
				nextIdx++;
			} else {
				fireArgs.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
				audioFilters.push(
					`[${nextIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},asetpts=PTS-STARTPTS[base_a]`,
				);
				mixLabels.push('[base_a]');
				nextIdx++;
			}
			sfxCues.forEach((cue, idx) => {
				fireArgs.push('-i', cue.path);
				const label = `[sfx${idx}]`;
				audioFilters.push(
					`[${nextIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${cue.volume.toFixed(2)},adelay=${cue.delayMs}|${cue.delayMs}${label}`,
				);
				mixLabels.push(label);
				nextIdx++;
			});
			if (mixLabels.length > 1) {
				audioFilters.push(
					`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,afade=t=in:st=0:d=${config.audio.fadeInSec || 0.5},afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}[aout]`,
				);
			} else {
				audioFilters.push(
					`[base_a]afade=t=in:st=0:d=${config.audio.fadeInSec || 0.5},afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}[aout]`,
				);
			}

			const fireVideoFilters = [
				`[0:v]scale=${width}:${height}:flags=lanczos,format=gbrp,split[vb0][vb1]`,
				`[vb1]gblur=sigma=8[vglow]`,
				`[vb0][vglow]blend=all_mode=screen:all_opacity=0.22,format=rgba[vfire]`,
				`[1:v]scale=${width}:${height},fps=${fireFps},format=rgba,fade=t=in:st=${titleStartSec}:d=${titleRevealDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[vtitle]`,
				`[2:v]scale=${width}:${height},fps=${fireFps},format=rgba,fade=t=in:st=${ctaStartSec}:d=${ctaRevealDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[vcta]`,
				`[vfire][vtitle]overlay=0:0:shortest=1[c1]`,
				`[c1][vcta]overlay=0:0:shortest=1,format=yuv420p[vout]`,
			];

			fireArgs.push(
				'-filter_complex', [...fireVideoFilters, ...audioFilters].join(';'),
				'-map', '[vout]',
				'-map', '[aout]',
				'-t', String(durationSec),
				'-r', String(fireFps),
				'-c:v', 'libx264',
				'-preset', quality === 'master' ? 'medium' : 'veryfast',
				'-crf', quality === 'master' ? '18' : '21',
				'-pix_fmt', 'yuv420p',
				'-c:a', 'aac',
				'-b:a', '192k',
				'-ar', '48000',
				'-ac', '2',
				'-movflags', '+faststart',
				outputMp4Path,
			);

			const firePalRgb = parseFirePaletteRgb(config.palette);
			const frameBuf = new Uint8Array(simW * simH * 4);

			await new Promise<void>((resolvePromise, rejectPromise) => {
				const child = spawn('ffmpeg', fireArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
				let stderr = '';
				child.stderr?.on('data', (chunk: Buffer) => {
					stderr += chunk.toString('utf-8');
				});
				child.on('error', rejectPromise);
				child.on('close', (code) => {
					if (code === 0) resolvePromise();
					else rejectPromise(new Error(`FFmpeg Fire Shader exited with code ${code}: ${stderr.slice(-400)}`));
				});

				(async () => {
					try {
						for (let f = 0; f < fireTotalFrames; f++) {
							if (isFlamePack) {
								renderFlamePackFrameRgba({
									variant: config.templateId as FlamePackVariant,
									width: simW,
									height: simH,
									tSec: f / fireFps,
									keyframes,
									intensity: config.intensity,
									palette: firePalRgb,
									logoRgba,
									outRgba: frameBuf,
								});
							} else {
								renderFireRevealFrameRgba({
									width: simW,
									height: simH,
									tSec: f / fireFps,
									keyframes,
									intensity: config.intensity,
									palette: firePalRgb,
									bgRgba,
									logoRgba,
									outRgba: frameBuf,
									parallaxEnabled: config.parallaxEnabled,
								});
							}
							if (!child.stdin!.write(frameBuf)) {
								await new Promise<void>((r) => child.stdin!.once('drain', r));
							}
						}
						child.stdin!.end();
					} catch (writeErr) {
						child.kill('SIGKILL');
						rejectPromise(writeErr);
					}
				})();
			});

			const probe = await probeMediaFile(outputMp4Path);
			if (!probe.hasVideo || !probe.hasAudio || probe.fileSizeBytes === 0) {
				throw new Error('Falha na validação do MP4 final do Fire Reveal.');
			}
			if (input.cacheManager) {
				input.cacheManager.putFile({
					level: 'renders',
					key: cacheKey,
					sourceFilePath: outputMp4Path,
					extension: '.mp4',
					templateId: config.templateId,
					logoId: config.selectedLogoId,
					logoVersion,
				});
			}
			return {
				ok: true,
				outputMp4Path,
				cacheKey,
				cacheHit: false,
				templateId: config.templateId,
				templateVersion: config.templateVersion,
				durationSec: Number(probe.durationSec.toFixed(2)),
				width: probe.width,
				height: probe.height,
				aspectRatio: config.aspectRatio,
				keyframes,
				logoApplied: Boolean(effectiveLogoPath),
				logoVersion,
				sfxApplied: sfxCues.map((c) => c.name),
				musicApplied: Boolean(musicPath),
				hasVideo: probe.hasVideo,
				hasAudio: probe.hasAudio,
				fileSizeBytes: probe.fileSizeBytes,
				renderDurationMs: Date.now() - startedAt,
				engine: 'motionvelix_studio_v3_ffmpeg',
			};
		}

		// Build deterministic FFmpeg filter_complex honoring proportional 6-phase keyframes
		const fadeOutDur = Math.max(0.4, Math.min(2.0, config.audio.fadeOutSec || 0.8));
		const fadeOutStart = Math.max(0.5, durationSec - fadeOutDur).toFixed(2);
		const energyFadeInDur = Math.max(0.4, (keyframes.energyInEndSec - keyframes.energyInStartSec) * 0.6).toFixed(2);
		const logoRevealDur = Math.max(0.4, keyframes.logoRevealEndSec - keyframes.logoRevealStartSec).toFixed(2);
		const titleRevealDur = Math.max(0.4, (keyframes.channelRevealEndSec - keyframes.channelRevealStartSec) * 0.6).toFixed(2);
		const ctaRevealDur = Math.max(0.35, (keyframes.ctaEndSec - keyframes.ctaStartSec) * 0.5).toFixed(2);

		const panX = Math.round(22 * iv.parallaxAmplitude);
		const panY = Math.round(12 * iv.parallaxAmplitude);
		const zoomDelta = (0.12 * iv.parallaxAmplitude).toFixed(4);

		const bgFilter = config.parallaxEnabled
			? `[0:v]zoompan=z='1.0+${zoomDelta}*on/${totalFrames}':x='iw/2-(iw/zoom/2)+${panX}*sin(2*PI*on/${totalFrames})':y='ih/2-(ih/zoom/2)+${panY}*cos(2*PI*on/${totalFrames})':d=${totalFrames}:s=${width}x${height}:fps=${fps},format=rgba[v_bg]`
			: `[0:v]scale=${width}:${height},fps=${fps},trim=duration=${durationSec},setpts=PTS-STARTPTS,format=rgba[v_bg]`;

		const energyFilter = `[1:v]scale=${width}:${height},fps=${fps},format=rgba,fade=t=in:st=${keyframes.energyInStartSec}:d=${energyFadeInDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[v_en]`;
		const logoFilter = `[2:v]scale=${width}:${height},fps=${fps},format=rgba,fade=t=in:st=${keyframes.logoRevealStartSec}:d=${logoRevealDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[v_logo]`;
		const titleFilter = `[3:v]scale=${width}:${height},fps=${fps},format=rgba,fade=t=in:st=${keyframes.channelRevealStartSec}:d=${titleRevealDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[v_title]`;
		const ctaFilter = `[4:v]scale=${width}:${height},fps=${fps},format=rgba,fade=t=in:st=${keyframes.ctaStartSec}:d=${ctaRevealDur}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${fadeOutDur}:alpha=1[v_cta]`;

		// Subtle organic vertical sway on energy layer
		const energyYExpr =
			config.templateId === 'glitch_reveal'
				? `0`
				: `round(${Math.round(8 * iv.turbulenceScale)}*sin(2*PI*t/2.4))`;

		const compositeChain = [
			bgFilter,
			energyFilter,
			logoFilter,
			titleFilter,
			ctaFilter,
			`[v_bg][v_en]overlay=0:${energyYExpr}:shortest=1[c1]`,
			`[c1][v_logo]overlay=0:0:shortest=1[c2]`,
			`[c2][v_title]overlay=0:0:shortest=1[c3]`,
			`[c3][v_cta]overlay=0:0:shortest=1,fade=t=in:st=0:d=${config.audio.fadeInSec || 0.5},fade=t=out:st=${fadeOutStart}:d=${fadeOutDur},format=yuv420p[vout]`,
		];

		const ffmpegArgs: string[] = [
			'-y',
			'-loop', '1', '-t', String(durationSec), '-i', bgPng,
			'-loop', '1', '-t', String(durationSec), '-i', energyPng,
			'-loop', '1', '-t', String(durationSec), '-i', logoCanvasPng,
			'-loop', '1', '-t', String(durationSec), '-i', titlePng,
			'-loop', '1', '-t', String(durationSec), '-i', ctaPng,
		];

		// Input 5: Base audio (real music file OR clean digital silence — NEVER artificial sine tones)
		const audioFilters: string[] = [];
		const mixLabels: string[] = [];
		let nextInputIdx = 5;

		if (musicPath) {
			ffmpegArgs.push('-stream_loop', '-1', '-t', String(durationSec), '-i', musicPath);
			audioFilters.push(
				`[${nextInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},asetpts=PTS-STARTPTS,volume=${config.audio.musicVolume.toFixed(2)}[base_a]`,
			);
			mixLabels.push('[base_a]');
			nextInputIdx++;
		} else {
			ffmpegArgs.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
			audioFilters.push(
				`[${nextInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${durationSec},asetpts=PTS-STARTPTS[base_a]`,
			);
			mixLabels.push('[base_a]');
			nextInputIdx++;
		}

		sfxCues.forEach((cue, idx) => {
			ffmpegArgs.push('-i', cue.path);
			const label = `[sfx${idx}]`;
			audioFilters.push(
				`[${nextInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${cue.volume.toFixed(2)},adelay=${cue.delayMs}|${cue.delayMs}${label}`,
			);
			mixLabels.push(label);
			nextInputIdx++;
		});

		if (mixLabels.length > 1) {
			audioFilters.push(
				`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0,afade=t=in:st=0:d=${config.audio.fadeInSec || 0.5},afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}[aout]`,
			);
		} else {
			audioFilters.push(
				`[base_a]afade=t=in:st=0:d=${config.audio.fadeInSec || 0.5},afade=t=out:st=${fadeOutStart}:d=${fadeOutDur}[aout]`,
			);
		}

		ffmpegArgs.push(
			'-filter_complex', [...compositeChain, ...audioFilters].join(';'),
			'-map', '[vout]',
			'-map', '[aout]',
			'-t', String(durationSec),
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
			throw new Error('Falha na validação do MP4 final do Outro Studio 3.0.');
		}

		if (input.cacheManager) {
			input.cacheManager.putFile({
				level: 'renders',
				key: cacheKey,
				sourceFilePath: outputMp4Path,
				extension: '.mp4',
				templateId: config.templateId,
				logoId: config.selectedLogoId,
				logoVersion,
			});
		}

		return {
			ok: true,
			outputMp4Path,
			cacheKey,
			cacheHit: false,
			templateId: config.templateId,
			templateVersion: config.templateVersion,
			durationSec: Number(probe.durationSec.toFixed(2)),
			width: probe.width,
			height: probe.height,
			aspectRatio: config.aspectRatio,
			keyframes,
			logoApplied: Boolean(effectiveLogoPath),
			logoVersion,
			sfxApplied: sfxCues.map((c) => c.name),
			musicApplied: Boolean(musicPath),
			hasVideo: probe.hasVideo,
			hasAudio: probe.hasAudio,
			fileSizeBytes: probe.fileSizeBytes,
			renderDurationMs: Date.now() - startedAt,
			engine: 'motionvelix_studio_v3_ffmpeg',
		};
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}
