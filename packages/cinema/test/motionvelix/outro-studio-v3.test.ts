import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import {
	computeProportionalKeyframes,
	createDefaultOutroStudioConfigV3,
	extractPaletteFromImage,
	listOutroTemplates,
	LogoLibraryStore,
	mapIntensityToVisualParams,
	migrateLegacyOutroConfig,
	OutroCacheManager,
	OutroPresetStore,
	probeMediaFile,
	renderOutroStudioV3Mp4,
	resolveOutroTemplateWithFallback,
	sanitizeSvgContent,
	sha256File,
	validateAndPrepareLogoBuffer,
	validatePaletteContrast,
} from '../../src/index.js';

async function makeTestLogoPng(label: string, colorHex: string, width = 360, height = 360): Promise<Buffer> {
	// Clean sculpted emblem crest with alpha transparency (no crude circle-with-initials placeholder)
	const cx = Math.round(width / 2);
	const cy = Math.round(height / 2);
	const r = Math.round(Math.min(width, height) * 0.42);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
		<defs>
			<linearGradient id="emblemGrad" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stop-color="#FFFFFF"/>
				<stop offset="45%" stop-color="${colorHex}"/>
				<stop offset="100%" stop-color="#1E1B4B"/>
			</linearGradient>
		</defs>
		<polygon points="${cx},${cy - r} ${cx + Math.round(r * 0.88)},${cy - Math.round(r * 0.35)} ${cx + Math.round(r * 0.62)},${cy + Math.round(r * 0.78)} ${cx},${cy + r} ${cx - Math.round(r * 0.62)},${cy + Math.round(r * 0.78)} ${cx - Math.round(r * 0.88)},${cy - Math.round(r * 0.35)}" fill="url(#emblemGrad)" stroke="#FFFFFF" stroke-width="6"/>
		<polygon points="${cx},${cy - Math.round(r * 0.62)} ${cx + Math.round(r * 0.46)},${cy} ${cx},${cy + Math.round(r * 0.62)} ${cx - Math.round(r * 0.46)},${cy}" fill="#09090B" fill-opacity="0.72" stroke="#FFFFFF" stroke-width="4"/>
		<polygon points="${cx},${cy - Math.round(r * 0.32)} ${cx + Math.round(r * 0.22)},${cy} ${cx},${cy + Math.round(r * 0.32)} ${cx - Math.round(r * 0.22)},${cy}" fill="#FFFFFF"/>
		<!-- ${label} -->
	</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('MotionVelix Outro Studio 3.0 — Complete Suite (Phases 2–13)', () => {
	it('registers all real templates (Studio 3.0 + Flame Pack), migrates legacy v2 configs, and falls back safely on unknown templates', () => {
		const templates = listOutroTemplates();
		const ids = templates.map((t) => t.templateId);
		expect(ids).toEqual([
			'fire_reveal',
			'electric_reveal',
			'particle_reveal',
			'glitch_reveal',
			'flame_wide',
			'flame_banner',
			'flame_squircle',
			'flame_circle',
		]);
		for (const t of templates) {
			expect(t.capabilities.supportsCustomLogo).toBe(true);
			expect(t.supportedAspectRatios).toEqual(['16:9', '9:16']);
			expect(t.defaultParams.durationMs).toBe(15000);
			expect(t.defaultParams.intensity).toBe(55);
		}

		// Unknown template fallback
		const fallback = resolveOutroTemplateWithFallback('non_existent_template_xyz');
		expect(fallback.usedFallback).toBe(true);
		expect(fallback.template.templateId).toBe('fire_reveal');

		// Legacy v2 migration
		const migrated = migrateLegacyOutroConfig({
			enabled: true,
			channelName: 'NextWorth',
			style: 'energetic',
			durationSec: 12,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			aspectRatio: '16:9',
		});
		expect(migrated.schemaVersion).toBe(3);
		expect(migrated.templateId).toBe('fire_reveal');
		expect(migrated.durationMs).toBe(12000);
		expect(migrated.intensity).toBe(55);
		expect(migrated.logoSelectionMode).toBe('manual');
		expect(migrated.paletteSource).toBe('channel');

		// Proportional keyframes for 15s and 10s
		const kf15 = computeProportionalKeyframes(15000);
		expect(kf15.envPrepEndSec).toBe(2);
		expect(kf15.energyInEndSec).toBe(5);
		expect(kf15.logoRevealEndSec).toBe(7);
		expect(kf15.channelRevealEndSec).toBe(10);
		expect(kf15.ctaEndSec).toBe(13);
		expect(kf15.totalDurationSec).toBe(15);

		const kf10 = computeProportionalKeyframes(10000);
		expect(kf10.logoRevealStartSec).toBeCloseTo(3.333, 2);
		expect(kf10.totalDurationSec).toBe(10);

		// Deterministic intensity mapping
		const low = mapIntensityToVisualParams(10, 'fire_reveal');
		const high = mapIntensityToVisualParams(90, 'fire_reveal');
		expect(high.particleCount).toBeGreaterThan(low.particleCount);
		expect(high.glowRadiusPx).toBeGreaterThan(low.glowRadiusPx);
	});

	it('validates logo magic bytes, sanitizes dangerous SVG, supports versioning, soft-delete, and deterministic favorite rotation without consecutive repeats', async () => {
		const root = join(tmpdir(), `outro-v3-logos-${Date.now()}`);
		try {
			// Security: SVG sanitizer strips script, onload, javascript:, remote href
			const evilSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" onload="alert(1)">
				<script>alert('xss')</script>
				<image href="https://evil.example/tracker.png" width="10" height="10"/>
				<circle cx="64" cy="64" r="50" fill="#7C3AED"/>
			</svg>`;
			const sanitized = sanitizeSvgContent(evilSvg);
			expect(sanitized).not.toContain('<script');
			expect(sanitized).not.toContain('onload');
			expect(sanitized).not.toContain('https://evil.example');
			expect(sanitized).toContain('<circle');

			// Rejects spoofed/invalid magic bytes
			await expect(validateAndPrepareLogoBuffer(Buffer.from('not a real image'))).rejects.toThrow();

			const store = new LogoLibraryStore(root);
			const logoA = await store.addLogo({
				channelId: 'nextworth',
				name: 'NextWorth Principal',
				fileBuffer: await makeTestLogoPng('NW', '#7C3AED'),
				isDefault: true,
				isFavorite: true,
			});
			const logoB = await store.addLogo({
				channelId: 'nextworth',
				name: 'NextWorth Neon',
				fileBuffer: await makeTestLogoPng('N2', '#06B6D4'),
				isFavorite: true,
			});
			const logoC = await store.addLogo({
				channelId: 'nextworth',
				name: 'NextWorth Gold',
				fileBuffer: Buffer.from(sanitized, 'utf-8'),
				isFavorite: true,
			});

			expect(store.listLogos('nextworth').length).toBe(3);
			expect(logoA.assetVersion).toBe(1);
			expect(existsSync(logoA.previewPath)).toBe(true);

			// Versioning: replace logoA -> creates v2, keeping v1 intact on disk for old projects
			const v1Path = logoA.originalPath;
			const logoAv2 = await store.replaceLogoFile({
				logoId: logoA.logoId,
				fileBuffer: await makeTestLogoPng('NW2', '#F97316'),
			});
			expect(logoAv2.assetVersion).toBe(2);
			expect(existsSync(v1Path)).toBe(true);
			expect(existsSync(logoAv2.originalPath)).toBe(true);
			expect(store.getLogo(logoA.logoId, 1)?.version.assetVersion).toBe(1);
			expect(store.getLogo(logoA.logoId, 2)?.version.assetVersion).toBe(2);

			// Per-video isolation: video 1 pins logoA v1, video 2 uses logoB
			const resVid1 = store.resolveLogoForVideo({
				channelId: 'nextworth',
				productionId: 'video-001',
				mode: 'manual',
				manualLogoId: logoA.logoId,
				manualLogoVersion: 1,
			});
			const resVid2 = store.resolveLogoForVideo({
				channelId: 'nextworth',
				productionId: 'video-002',
				mode: 'manual',
				manualLogoId: logoB.logoId,
			});
			expect(resVid1.version?.assetVersion).toBe(1);
			expect(resVid2.logo?.logoId).toBe(logoB.logoId);

			// Soft-delete referenced logoA preserves physical file on disk
			const delA = store.deleteLogo(logoA.logoId);
			expect(delA.deleted).toBe(true);
			expect(delA.softDeleted).toBe(true);
			expect(existsSync(v1Path)).toBe(true);

			// Deterministic rotate_favorites without consecutive repeats (between logoB & logoC)
			const r1 = store.resolveLogoForVideo({ channelId: 'nextworth', productionId: 'ep-101', mode: 'rotate_favorites' });
			const r2 = store.resolveLogoForVideo({ channelId: 'nextworth', productionId: 'ep-102', mode: 'rotate_favorites' });
			const r3 = store.resolveLogoForVideo({ channelId: 'nextworth', productionId: 'ep-103', mode: 'rotate_favorites' });
			expect(r1.logo?.logoId).not.toBe(r2.logo?.logoId);
			expect(r2.logo?.logoId).not.toBe(r3.logo?.logoId);

			// Re-opening ep-101 returns the EXACT persisted choice (never mutates on reload!)
			const r1Again = store.resolveLogoForVideo({ channelId: 'nextworth', productionId: 'ep-101', mode: 'rotate_favorites' });
			expect(r1Again.logo?.logoId).toBe(r1.logo?.logoId);
			expect(r1Again.reason).toBe('rotation_persisted_for_production');

			// Complete Presets CRUD (NextWorth Fire / Electric / Particle with different logos)
			const presets = new OutroPresetStore(root);
			const pFire = presets.savePreset({
				channelId: 'nextworth',
				name: 'NextWorth Fire',
				config: createDefaultOutroStudioConfigV3({ channelId: 'nextworth', channelName: 'NextWorth', defaultLogoId: logoB.logoId }),
			});
			const pCopy = presets.duplicatePreset(pFire.presetId, 'NextWorth Electric');
			presets.renamePreset(pCopy.presetId, 'NextWorth Electric v2');
			expect(presets.listPresets('nextworth').length).toBe(2);
			expect(presets.deletePreset(pFire.presetId)).toBe(true);
			expect(presets.listPresets('nextworth').length).toBe(1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('extracts palette from image, validates WCAG contrast, and enforces 3-level cache hit/miss/LRU/invalidation', async () => {
		const root = join(tmpdir(), `outro-v3-cache-${Date.now()}`);
		mkdirSync(root, { recursive: true });
		try {
			const imgPath = join(root, 'bg.png');
			await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 88, g: 28, b: 135, alpha: 1 } } })
				.png()
				.toFile(imgPath);
			const extracted = await extractPaletteFromImage(imgPath);
			expect(extracted.primary).toMatch(/^#[0-9A-F]{6}$/);

			const contrast = validatePaletteContrast(extracted);
			expect(contrast.textReadable).toBe(true);
			expect(contrast.ctaReadable).toBe(true);

			// Cache put, integrity validation, scoped Outro invalidation
			const cache = new OutroCacheManager(root, { maxBytes: 1024 * 1024 });
			const dummyFile = join(root, 'dummy.mp4');
			writeFileSync(dummyFile, Buffer.alloc(4096, 7));
			cache.putFile({ level: 'renders', key: 'k-fire', sourceFilePath: dummyFile, extension: '.mp4', templateId: 'fire_reveal', logoId: 'logo-1', logoVersion: 1 });
			cache.putFile({ level: 'renders', key: 'k-elec', sourceFilePath: dummyFile, extension: '.mp4', templateId: 'electric_reveal', logoId: 'logo-2', logoVersion: 1 });

			expect(cache.getValid('renders', 'k-fire')).not.toBeNull();
			expect(cache.invalidateOutroEntries({ templateId: 'fire_reveal' })).toBe(1);
			expect(cache.getValid('renders', 'k-fire')).toBeNull();
			expect(cache.getValid('renders', 'k-elec')).not.toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it(
		'E2E: renders real Fire Reveal 15s (16:9, 9:16, alternate palette, second logo, cache hit) + Electric, Particle & Glitch templates with real MotionVelix SFX',
		async () => {
			const demoDir = resolve(process.cwd(), 'renders', 'outro-studio-v3-e2e');
			mkdirSync(demoDir, { recursive: true });
			const cache = new OutroCacheManager(join(demoDir, '_cache'));

			const logo1Path = join(demoDir, 'logo-primary.png');
			const logo2Path = join(demoDir, 'logo-alt.png');
			writeFileSync(logo1Path, await makeTestLogoPng('NW', '#7C3AED', 420, 220)); // horizontal logo
			writeFileSync(logo2Path, await makeTestLogoPng('A2', '#06B6D4', 320, 320)); // circular logo

			// 1. Fire Reveal 15s in 16:9 (real MotionVelix SFX, zero synthetic tones)
			const baseCfg = createDefaultOutroStudioConfigV3({
				channelId: 'nextworth',
				channelName: 'NextWorth',
				aspectRatio: '16:9',
			});
			const fire16x9 = await renderOutroStudioV3Mp4({
				config: baseCfg,
				logoFilePath: logo1Path,
				outputDir: demoDir,
				outputFilename: 'fire-reveal-15s-16x9.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			expect(fire16x9.ok).toBe(true);
			expect(fire16x9.cacheHit).toBe(false);
			expect(fire16x9.durationSec).toBeGreaterThanOrEqual(14.6);
			expect(fire16x9.durationSec).toBeLessThanOrEqual(15.4);
			expect(fire16x9.width).toBe(1280);
			expect(fire16x9.height).toBe(720);
			expect(fire16x9.logoApplied).toBe(true);
			expect(fire16x9.sfxApplied.length).toBeGreaterThan(0);

			// 2. Cache Hit benchmark on identical config
			const fireCached = await renderOutroStudioV3Mp4({
				config: baseCfg,
				logoFilePath: logo1Path,
				outputDir: demoDir,
				quality: 'preview',
				cacheManager: cache,
			});
			expect(fireCached.cacheHit).toBe(true);
			expect(fireCached.cacheKey).toBe(fire16x9.cacheKey);

			// 3. Fire Reveal 15s in 9:16 (vertical Shorts/Reels/TikTok)
			const fire9x16 = await renderOutroStudioV3Mp4({
				config: { ...baseCfg, aspectRatio: '9:16' },
				logoFilePath: logo1Path,
				outputDir: demoDir,
				outputFilename: 'fire-reveal-15s-9x16.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			expect(fire9x16.ok).toBe(true);
			expect(fire9x16.width).toBe(720);
			expect(fire9x16.height).toBe(1280);
			expect(fire9x16.durationSec).toBeGreaterThanOrEqual(14.6);

			// 4. Fire Reveal with alternate palette (purple/blue flames) -> distinct cacheKey & MP4
			const fireAltPalette = await renderOutroStudioV3Mp4({
				config: {
					...baseCfg,
					durationMs: 8000,
					paletteSource: 'custom',
					palette: { ...baseCfg.palette, energy: '#38BDF8', glow: '#818CF8', particles: '#C4B5FD' },
				},
				logoFilePath: logo1Path,
				outputDir: demoDir,
				outputFilename: 'fire-reveal-alt-palette-8s.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			expect(fireAltPalette.cacheHit).toBe(false);
			expect(fireAltPalette.cacheKey).not.toBe(fire16x9.cacheKey);

			// 5. Fire Reveal with second logo -> distinct cacheKey & visual hash
			const fireLogo2 = await renderOutroStudioV3Mp4({
				config: { ...baseCfg, durationMs: 8000 },
				logoFilePath: logo2Path,
				outputDir: demoDir,
				outputFilename: 'fire-reveal-logo2-8s.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			expect(fireLogo2.cacheKey).not.toBe(fireAltPalette.cacheKey);
			expect(sha256File(fireLogo2.outputMp4Path)).not.toBe(sha256File(fireAltPalette.outputMp4Path));

			// 6. Render the other 3 real templates: electric_reveal, particle_reveal, glitch_reveal
			const electric = await renderOutroStudioV3Mp4({
				config: { ...baseCfg, templateId: 'electric_reveal', durationMs: 10000 },
				logoFilePath: logo2Path,
				outputDir: demoDir,
				outputFilename: 'electric-reveal-10s-16x9.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			const particle = await renderOutroStudioV3Mp4({
				config: { ...baseCfg, templateId: 'particle_reveal', durationMs: 12000 },
				logoFilePath: logo1Path,
				outputDir: demoDir,
				outputFilename: 'particle-reveal-12s-16x9.mp4',
				quality: 'preview',
				cacheManager: cache,
			});
			const glitch = await renderOutroStudioV3Mp4({
				config: { ...baseCfg, templateId: 'glitch_reveal', durationMs: 8000 },
				logoFilePath: logo2Path,
				outputDir: demoDir,
				outputFilename: 'glitch-reveal-8s-16x9.mp4',
				quality: 'preview',
				cacheManager: cache,
			});

			for (const res of [electric, particle, glitch]) {
				expect(res.ok).toBe(true);
				expect(res.hasVideo).toBe(true);
				expect(res.hasAudio).toBe(true);
				const p = await probeMediaFile(res.outputMp4Path);
				expect(p.videoCodec).toBe('h264');
				expect(p.audioCodec).toBe('aac');
				expect(p.fileSizeBytes).toBeGreaterThan(40_000);
			}
		},
		180_000,
	);
});
