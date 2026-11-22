import { describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
	buildOutroOverlaySvg,
	composeVideoWithOutroMp4,
	DEFAULT_VIDEO_OUTRO_CONFIG,
	getOutroSafeZone,
	probeMediaFile,
	renderMotionVelixOutroMp4,
	validateOutroBackgroundImagePath,
	VideoOutroConfigStore,
} from '../../src/motionvelix/video-outro-engine.js';

const execFileAsync = promisify(execFile);

describe('MotionVelix — Video Outro (Encerramento do Vídeo) Engine', () => {
	it('enforces exact required defaults and safe-zone geometry for 16:9 and 9:16', () => {
		expect(DEFAULT_VIDEO_OUTRO_CONFIG.style).toBe('energetic');
		expect(DEFAULT_VIDEO_OUTRO_CONFIG.durationSec).toBe(15);
		expect(DEFAULT_VIDEO_OUTRO_CONFIG.showSubscribeCta).toBe(true);
		expect(DEFAULT_VIDEO_OUTRO_CONFIG.parallaxEnabled).toBe(true);
		expect(DEFAULT_VIDEO_OUTRO_CONFIG.showNextVideoCard).toBe(false);

		const safe16x9 = getOutroSafeZone('16:9', 'master');
		expect(safe16x9.width).toBe(1920);
		expect(safe16x9.height).toBe(1080);
		expect(safe16x9.contentWidth).toBeGreaterThan(1500);

		const safe9x16 = getOutroSafeZone('9:16', 'master');
		expect(safe9x16.width).toBe(1080);
		expect(safe9x16.height).toBe(1920);
		expect(safe9x16.marginBottom).toBeGreaterThanOrEqual(400); // TikTok/Reels HUD clearance

		const svg = buildOutroOverlaySvg(
			{
				...DEFAULT_VIDEO_OUTRO_CONFIG,
				enabled: true,
				channelName: 'Aethera Mangá Recap',
				showSubscribeCta: true,
				showNextVideoCard: true,
				nextVideoTitle: 'Nano Machine Ep. 02',
			},
			1280,
			720,
		);
		expect(svg).toContain('Aethera Mangá Recap');
		expect(svg).toContain('INSCREVA-SE NO CANAL');
		expect(svg).toContain('PRÓXIMO VÍDEO');
		expect(svg).toContain('Nano Machine Ep. 02');
	});

	it('persists per-project config, channel default inheritance, image validation, and removal', () => {
		const tempRoot = join(tmpdir(), `aethera-outro-store-${Date.now()}`);
		try {
			const store = new VideoOutroConfigStore(tempRoot);
			const saved = store.saveProjectConfig(
				'proj-1',
				{
					enabled: true,
					channelName: 'Canal Aethera',
					style: 'cinematic',
					durationSec: 18,
					showSubscribeCta: true,
					parallaxEnabled: true,
					showNextVideoCard: true,
					saveAsChannelDefault: true,
				},
				{ channelKey: 'canal-aethera', saveAsChannelDefault: true },
			);
			expect(saved.durationSec).toBe(18);
			expect(saved.style).toBe('cinematic');

			// Project 1 reloads its exact saved config
			const reloaded = store.loadEffectiveConfig({ projectId: 'proj-1', channelKey: 'canal-aethera' });
			expect(reloaded.source).toBe('project');
			expect(reloaded.config.durationSec).toBe(18);

			// New Project 2 inherits the saved channel default
			const inherited = store.loadEffectiveConfig({ projectId: 'proj-2', channelKey: 'canal-aethera' });
			expect(inherited.source).toBe('channel_default');
			expect(inherited.config.channelName).toBe('Canal Aethera');
			expect(inherited.config.style).toBe('cinematic');

			// Removal clears project config
			expect(store.removeProjectConfig('proj-1')).toBe(true);
			expect(store.loadProjectConfig('proj-1')).toBeNull();

			// Image validation rejects invalid extension
			const badImg = validateOutroBackgroundImagePath('C:/tmp/not-an-image.txt');
			expect(badImg.ok).toBe(false);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it(
		'E2E: renders real 15s Energetic Outro MP4 (parallax + audio + transitions), 9:16 variant, and composes with a main video without cutting narration',
		async () => {
			const demoDir = resolve(process.cwd(), 'renders', 'motionvelix-outro-e2e');
			mkdirSync(demoDir, { recursive: true });

			// Create a real stylized PNG background image for the Outro
			const bgPngPath = join(demoDir, 'demo-outro-bg.png');
			const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
				<defs>
					<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stop-color="#0f172a"/>
						<stop offset="50%" stop-color="#312e81"/>
						<stop offset="100%" stop-color="#111827"/>
					</linearGradient>
				</defs>
				<rect width="1920" height="1080" fill="url(#sky)"/>
				<circle cx="1520" cy="240" r="140" fill="#b6f500" opacity="0.22"/>
				<polygon points="0,1080 420,560 880,1080" fill="#1e1b4b" opacity="0.85"/>
				<polygon points="620,1080 1160,480 1720,1080" fill="#0f172a" opacity="0.9"/>
			</svg>`;
			await sharp(Buffer.from(bgSvg)).png().toFile(bgPngPath);

			// 1. Render REAL 15-second 16:9 Energetic Outro with Parallax ON + Subscribe CTA ON
			const outro15s = await renderMotionVelixOutroMp4({
				config: {
					...DEFAULT_VIDEO_OUTRO_CONFIG,
					enabled: true,
					backgroundImagePath: bgPngPath,
					backgroundImageName: 'demo-outro-bg.png',
					channelName: 'Aethera Studio Recap',
					style: 'energetic',
					durationSec: 15,
					showSubscribeCta: true,
					parallaxEnabled: true,
					showNextVideoCard: false,
					aspectRatio: '16:9',
				},
				outputDir: demoDir,
				outputFilename: 'motionvelix-outro-demo-15s.mp4',
				quality: 'preview',
			});

			expect(outro15s.ok).toBe(true);
			expect(existsSync(outro15s.outputMp4Path)).toBe(true);
			expect(outro15s.hasVideo).toBe(true);
			expect(outro15s.hasAudio).toBe(true);
			expect(outro15s.parallaxApplied).toBe(true);
			expect(outro15s.width).toBe(1280);
			expect(outro15s.height).toBe(720);
			expect(outro15s.durationSec).toBeGreaterThanOrEqual(14.6);
			expect(outro15s.durationSec).toBeLessThanOrEqual(15.4);
			expect(outro15s.fileSizeBytes).toBeGreaterThan(50_000);

			// 2. Render 5-second 9:16 vertical variant (Shorts/Reels/TikTok safe area)
			const outro9x16 = await renderMotionVelixOutroMp4({
				config: {
					...DEFAULT_VIDEO_OUTRO_CONFIG,
					enabled: true,
					backgroundImagePath: bgPngPath,
					channelName: 'Aethera Shorts',
					style: 'cinematic',
					durationSec: 5,
					showSubscribeCta: true,
					parallaxEnabled: true,
					showNextVideoCard: true,
					nextVideoTitle: 'Próximo Capítulo',
					aspectRatio: '9:16',
				},
				outputDir: demoDir,
				outputFilename: 'motionvelix-outro-demo-9x16-5s.mp4',
				quality: 'preview',
			});
			expect(outro9x16.ok).toBe(true);
			expect(outro9x16.width).toBe(720);
			expect(outro9x16.height).toBe(1280);
			expect(outro9x16.durationSec).toBeGreaterThanOrEqual(4.6);
			expect(outro9x16.durationSec).toBeLessThanOrEqual(5.4);

			// 3. Create a real 3-second main video MP4 and compose with the 15s Outro (total ≈ 18s, zero clipping)
			const mainVideoPath = join(demoDir, 'demo-main-video-3s.mp4');
			await execFileAsync(
				'ffmpeg',
				[
					'-y',
					'-f', 'lavfi', '-i', 'color=c=0x1e293b:s=1280x720:r=30:d=3',
					'-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
					'-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
					'-c:a', 'aac', '-ac', '2', '-ar', '48000',
					mainVideoPath,
				],
				{ timeout: 30_000, windowsHide: true },
			);

			const composedPath = join(demoDir, 'motionvelix-composed-main3s-plus-outro15s.mp4');
			const composed = await composeVideoWithOutroMp4({
				mainVideoPath,
				outroVideoPath: outro15s.outputMp4Path,
				outputMp4Path: composedPath,
				aspectRatio: '16:9',
				quality: 'preview',
			});

			expect(composed.ok).toBe(true);
			expect(composed.hasVideo).toBe(true);
			expect(composed.hasAudio).toBe(true);
			expect(composed.mainDurationSec).toBeGreaterThanOrEqual(2.8);
			expect(composed.outroDurationSec).toBeGreaterThanOrEqual(14.6);
			// Must preserve full main video + full outro without cutting narration
			expect(composed.composedDurationSec).toBeGreaterThanOrEqual(17.5);
			expect(composed.composedDurationSec).toBeLessThanOrEqual(18.6);

			const finalProbe = await probeMediaFile(composedPath);
			expect(finalProbe.videoCodec).toBe('h264');
			expect(finalProbe.audioCodec).toBe('aac');
			expect(finalProbe.fileSizeBytes).toBeGreaterThan(80_000);
		},
		120_000,
	);
});
