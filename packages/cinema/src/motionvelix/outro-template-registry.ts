/**
 * MotionVelix Outro Studio 3.0 — Extensible Template Registry, Palette, Intensity & Legacy Migration
 *
 * Registers 4 real animated outro templates (`fire_reveal`, `electric_reveal`,
 * `particle_reveal`, `glitch_reveal`) sharing a common parameter interface.
 * Never hardcodes any brand logo path or fixed brand colors in template compositions.
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { VideoOutroConfig } from './video-outro-engine.js';

export const OUTRO_TEMPLATE_IDS = [
	'fire_reveal',
	'electric_reveal',
	'particle_reveal',
	'glitch_reveal',
	'flame_wide',
	'flame_banner',
	'flame_squircle',
	'flame_circle',
] as const;

export type OutroTemplateId = (typeof OUTRO_TEMPLATE_IDS)[number];

export const PALETTE_SOURCES = ['channel', 'image', 'custom'] as const;
export type PaletteSource = (typeof PALETTE_SOURCES)[number];

export const LOGO_SELECTION_MODES = ['manual', 'default', 'rotate_favorites'] as const;
export type LogoSelectionMode = (typeof LOGO_SELECTION_MODES)[number];

export const outroPaletteSchema = z.object({
	primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7C3AED'),
	secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563EB'),
	energy: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#A855F7'),
	glow: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#38BDF8'),
	particles: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#E879F9'),
	text: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
	ctaBg: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#B6F500'),
	ctaText: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#111111'),
});

export type OutroPalette = z.infer<typeof outroPaletteSchema>;

export const outroLogoTransformSchema = z.object({
	scale: z.number().min(0.4).max(2.0).default(1.0),
	offsetX: z.number().min(-300).max(300).default(0),
	offsetY: z.number().min(-300).max(300).default(0),
	glowIntensity: z.number().min(0).max(100).default(65),
	revealIntensity: z.number().min(0).max(100).default(70),
});

export type OutroLogoTransform = z.infer<typeof outroLogoTransformSchema>;

export const outroAudioConfigSchema = z.object({
	enabled: z.boolean().default(true),
	musicPath: z.string().nullable().default(null),
	musicAssetId: z.string().nullable().optional(),
	musicVolume: z.number().min(0).max(1).default(0.45),
	introSfxVolume: z.number().min(0).max(1).default(0.7),
	whooshVolume: z.number().min(0).max(1).default(0.75),
	impactVolume: z.number().min(0).max(1).default(0.85),
	subscribeSfxVolume: z.number().min(0).max(1).default(0.75),
	fadeInSec: z.number().min(0).max(4).default(0.5),
	fadeOutSec: z.number().min(0).max(4).default(0.8),
});

export type OutroAudioConfig = z.infer<typeof outroAudioConfigSchema>;

export const outroTextsSchema = z.object({
	preTitle: z.string().trim().max(80).default('OBRIGADO POR ASSISTIR'),
	channelTitle: z.string().trim().max(120).default(''),
	subscribeCtaText: z.string().trim().max(80).default('INSCREVA-SE NO CANAL'),
	nextVideoLabel: z.string().trim().max(60).default('PRÓXIMO VÍDEO'),
	nextVideoTitle: z.string().trim().max(120).default(''),
});

export type OutroTexts = z.infer<typeof outroTextsSchema>;

export const outroStudioConfigV3Schema = z.object({
	schemaVersion: z.literal(3).default(3),
	enabled: z.boolean().default(true),
	templateId: z.string().default('fire_reveal'),
	templateVersion: z.string().default('3.0.0'),
	channelId: z.string().default('default'),
	channelName: z.string().trim().max(120).default(''),
	aspectRatio: z.enum(['16:9', '9:16']).default('16:9'),
	durationMs: z.number().int().min(5000).max(30000).default(15000),
	paletteSource: z.enum(PALETTE_SOURCES).default('channel'),
	palette: outroPaletteSchema.default(() => ({
		primary: '#7C3AED',
		secondary: '#2563EB',
		energy: '#A855F7',
		glow: '#38BDF8',
		particles: '#E879F9',
		text: '#FFFFFF',
		ctaBg: '#B6F500',
		ctaText: '#111111',
	})),
	logoSelectionMode: z.enum(LOGO_SELECTION_MODES).default('manual'),
	logoDisabled: z.boolean().default(false),
	selectedLogoId: z.string().nullable().default(null),
	selectedLogoVersion: z.number().int().positive().nullable().default(null),
	selectedLogoHash: z.string().nullable().default(null),
	logoTransform: outroLogoTransformSchema.default(() => ({
		scale: 1.0,
		offsetX: 0,
		offsetY: 0,
		glowIntensity: 65,
		revealIntensity: 70,
	})),
	backgroundImagePath: z.string().nullable().default(null),
	backgroundImageName: z.string().nullable().optional(),
	backgroundImageHash: z.string().nullable().optional(),
	parallaxEnabled: z.boolean().default(true),
	showSubscribeCta: z.boolean().default(true),
	showNextVideoCard: z.boolean().default(false),
	intensity: z.number().min(0).max(100).default(55),
	texts: outroTextsSchema.default(() => ({
		preTitle: 'OBRIGADO POR ASSISTIR',
		channelTitle: '',
		subscribeCtaText: 'INSCREVA-SE NO CANAL',
		nextVideoLabel: 'PRÓXIMO VÍDEO',
		nextVideoTitle: '',
	})),
	audio: outroAudioConfigSchema.default(() => ({
		enabled: true,
		musicPath: null,
		musicVolume: 0.45,
		introSfxVolume: 0.7,
		whooshVolume: 0.75,
		impactVolume: 0.85,
		subscribeSfxVolume: 0.75,
		fadeInSec: 0.5,
		fadeOutSec: 0.8,
	})),
	presetId: z.string().nullable().optional(),
	lastRenderCacheKey: z.string().nullable().optional(),
	lastPreviewMp4Path: z.string().nullable().optional(),
	lastRenderedAtIso: z.string().nullable().optional(),
	saveAsChannelDefault: z.boolean().optional(),
});

export type OutroStudioConfigV3 = z.infer<typeof outroStudioConfigV3Schema>;

export interface OutroTemplateCapabilities {
	supportsCustomLogo: boolean;
	supportsParallax: boolean;
	supportsPaletteRecolor: boolean;
	supportsNextVideoCard: boolean;
	supportsAudioSfx: boolean;
	supportsSafeAreas: boolean;
}

export interface OutroTemplateDefinition {
	templateId: string;
	version: string;
	name: string;
	shortDescription: string;
	description: string;
	thumbnail: {
		kind: 'procedural_loop' | 'webm' | 'mp4';
		loopDurationSec: number;
		accentHex: string;
		secondaryHex: string;
	};
	previewComposition: string;
	renderComposition: string;
	defaultParams: {
		durationMs: number;
		intensity: number;
		parallaxEnabled: boolean;
		showSubscribeCta: boolean;
		showNextVideoCard: boolean;
		palette: OutroPalette;
	};
	supportedAspectRatios: readonly ('16:9' | '9:16')[];
	capabilities: OutroTemplateCapabilities;
	requiredAssets: readonly ('optional_background' | 'optional_logo' | 'motionvelix_sfx')[];
	sfxProfile: {
		intro: string;
		whoosh: string;
		impact: string;
		subscribe: string;
	};
}

export interface OutroKeyframeSchedule {
	envPrepEndSec: number;
	energyInStartSec: number;
	energyInEndSec: number;
	logoRevealStartSec: number;
	logoRevealEndSec: number;
	channelRevealStartSec: number;
	channelRevealEndSec: number;
	ctaStartSec: number;
	ctaEndSec: number;
	holdStartSec: number;
	totalDurationSec: number;
}

/**
 * Scales the canonical 15-second Fire Reveal / Studio 3.0 sequence proportionally
 * for any duration in 5–30s:
 * 0–2s env prep, 2–5s flames/energy entry, 5–7s emblem reveal,
 * 7–10s channel name reveal, 10–13s subscribe CTA, 13–15s final hold & exit.
 */
export function computeProportionalKeyframes(durationMs: number): OutroKeyframeSchedule {
	const total = Math.max(5, Math.min(30, durationMs / 1000));
	const s = total / 15;
	return {
		envPrepEndSec: Number((2 * s).toFixed(3)),
		energyInStartSec: Number((2 * s).toFixed(3)),
		energyInEndSec: Number((5 * s).toFixed(3)),
		logoRevealStartSec: Number((5 * s).toFixed(3)),
		logoRevealEndSec: Number((7 * s).toFixed(3)),
		channelRevealStartSec: Number((7 * s).toFixed(3)),
		channelRevealEndSec: Number((10 * s).toFixed(3)),
		ctaStartSec: Number((10 * s).toFixed(3)),
		ctaEndSec: Number((13 * s).toFixed(3)),
		holdStartSec: Number((13 * s).toFixed(3)),
		totalDurationSec: Number(total.toFixed(3)),
	};
}

export interface MappedIntensityVisualParams {
	normalized: number; // 0..1
	particleCount: number;
	energyOpacity: number;
	glowRadiusPx: number;
	turbulenceScale: number;
	parallaxAmplitude: number;
	glitchDisplacementPx: number;
}

/**
 * Deterministically maps global intensity (0..100, default 55) to visual parameters.
 */
export function mapIntensityToVisualParams(
	intensity: number,
	templateId: string,
): MappedIntensityVisualParams {
	const clamped = Math.max(0, Math.min(100, intensity));
	const n = clamped / 100;
	const baseParticles = templateId === 'particle_reveal' ? 48 : templateId === 'fire_reveal' ? 32 : 24;
	return {
		normalized: Number(n.toFixed(3)),
		particleCount: Math.max(6, Math.round(baseParticles * (0.35 + 1.15 * n))),
		energyOpacity: Number((0.35 + 0.65 * n).toFixed(3)),
		glowRadiusPx: Math.round(10 + 36 * n),
		turbulenceScale: Number((0.45 + 1.15 * n).toFixed(3)),
		parallaxAmplitude: Number((0.4 + 1.1 * n).toFixed(3)),
		glitchDisplacementPx: Math.round(4 + 26 * n),
	};
}

// ─── Built-in Extensible Template Registry ───────────────────────────────────

const BUILTIN_TEMPLATES: OutroTemplateDefinition[] = [
	{
		templateId: 'fire_reveal',
		version: '3.0.0',
		name: 'Fire Reveal',
		shortDescription: 'Chamas orgânicas e brasas revelando o emblema com impacto cinematográfico.',
		description:
			'Composição multicamada com chamas orgânicas recoloríveis, máscara progressiva sobre qualquer logotipo, brasas ascendentes, nome do canal e CTA de inscrição.',
		thumbnail: {
			kind: 'procedural_loop',
			loopDurationSec: 2.6,
			accentHex: '#F97316',
			secondaryHex: '#A855F7',
		},
		previewComposition: 'OutroFireRevealPreview',
		renderComposition: 'OutroFireRevealMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#7C3AED',
				secondary: '#2563EB',
				energy: '#F97316',
				glow: '#F59E0B',
				particles: '#FDE047',
				text: '#FFFFFF',
				ctaBg: '#B6F500',
				ctaText: '#111111',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: {
			supportsCustomLogo: true,
			supportsParallax: true,
			supportsPaletteRecolor: true,
			supportsNextVideoCard: true,
			supportsAudioSfx: true,
			supportsSafeAreas: true,
		},
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: {
			intro: 'riser.wav',
			whoosh: 'whoosh_grave.wav',
			impact: 'impacto.wav',
			subscribe: 'brilho.wav',
		},
	},
	{
		templateId: 'electric_reveal',
		version: '3.0.0',
		name: 'Electric Reveal',
		shortDescription: 'Arcos elétricos de alta tensão e pulso luminoso revelando o logotipo.',
		description:
			'Raios procedurais convergentes, corona energética pulsante e onda de choque sincronizada revelando o emblema e a assinatura do canal.',
		thumbnail: {
			kind: 'procedural_loop',
			loopDurationSec: 2.4,
			accentHex: '#38BDF8',
			secondaryHex: '#2563EB',
		},
		previewComposition: 'OutroElectricRevealPreview',
		renderComposition: 'OutroElectricRevealMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#2563EB',
				secondary: '#06B6D4',
				energy: '#38BDF8',
				glow: '#60A5FA',
				particles: '#BAE6FD',
				text: '#FFFFFF',
				ctaBg: '#38BDF8',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: {
			supportsCustomLogo: true,
			supportsParallax: true,
			supportsPaletteRecolor: true,
			supportsNextVideoCard: true,
			supportsAudioSfx: true,
			supportsSafeAreas: true,
		},
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: {
			intro: 'riser.wav',
			whoosh: 'whoosh_rapido.wav',
			impact: 'boom.wav',
			subscribe: 'sucesso.wav',
		},
	},
	{
		templateId: 'particle_reveal',
		version: '3.0.0',
		name: 'Particle Reveal',
		shortDescription: 'Constelação de partículas orbitais coalescendo no emblema do canal.',
		description:
			'Fluxo determinístico de partículas luminosas em órbita espiral que se condensam no logotipo com glow suave e acabamento editorial.',
		thumbnail: {
			kind: 'procedural_loop',
			loopDurationSec: 2.8,
			accentHex: '#C084FC',
			secondaryHex: '#6366F1',
		},
		previewComposition: 'OutroParticleRevealPreview',
		renderComposition: 'OutroParticleRevealMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#8B5CF6',
				secondary: '#4F46E5',
				energy: '#C084FC',
				glow: '#A78BFA',
				particles: '#F5D0FE',
				text: '#FFFFFF',
				ctaBg: '#C084FC',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: {
			supportsCustomLogo: true,
			supportsParallax: true,
			supportsPaletteRecolor: true,
			supportsNextVideoCard: true,
			supportsAudioSfx: true,
			supportsSafeAreas: true,
		},
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: {
			intro: 'riser.wav',
			whoosh: 'swish_suave.wav',
			impact: 'brilho.wav',
			subscribe: 'ding.wav',
		},
	},
	{
		templateId: 'glitch_reveal',
		version: '3.0.0',
		name: 'Glitch Reveal',
		shortDescription: 'Separação cromática RGB, scanlines e travamento digital de alta precisão.',
		description:
			'Estética cyber/tech com deslocamento de fatias digitais, aberração cromática RGB determinística e revelação nítida do logotipo.',
		thumbnail: {
			kind: 'procedural_loop',
			loopDurationSec: 2.2,
			accentHex: '#22D3EE',
			secondaryHex: '#F43F5E',
		},
		previewComposition: 'OutroGlitchRevealPreview',
		renderComposition: 'OutroGlitchRevealMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#06B6D4',
				secondary: '#F43F5E',
				energy: '#22D3EE',
				glow: '#FB7185',
				particles: '#67E8F9',
				text: '#FFFFFF',
				ctaBg: '#22D3EE',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: {
			supportsCustomLogo: true,
			supportsParallax: true,
			supportsPaletteRecolor: true,
			supportsNextVideoCard: true,
			supportsAudioSfx: true,
			supportsSafeAreas: true,
		},
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: {
			intro: 'glitch.wav',
			whoosh: 'whoosh_rapido.wav',
			impact: 'impacto.wav',
			subscribe: 'pop.wav',
		},
	},
	{
		templateId: 'flame_wide',
		version: '3.3.0',
		name: 'Flame Wide',
		shortDescription: 'Moldura horizontal luminosa com fogo interno e explosão 2D cel-shaded.',
		description:
			'Opção 1 do Flame Logo Pack: moldura retangular larga com fogo fluido queimando por dentro atrás da logo + línguas de fogo 2D explodindo nas bordas.',
		thumbnail: { kind: 'procedural_loop', loopDurationSec: 2.5, accentHex: '#7DD3FC', secondaryHex: '#0284C7' },
		previewComposition: 'OutroFlameWidePreview',
		renderComposition: 'OutroFlameWideMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#0284C7',
				secondary: '#38BDF8',
				energy: '#7DD3FC',
				glow: '#BAE6FD',
				particles: '#E0F2FE',
				text: '#FFFFFF',
				ctaBg: '#38BDF8',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: { supportsCustomLogo: true, supportsParallax: true, supportsPaletteRecolor: true, supportsNextVideoCard: true, supportsAudioSfx: true, supportsSafeAreas: true },
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: { intro: 'riser.wav', whoosh: 'whoosh_grave.wav', impact: 'impacto.wav', subscribe: 'brilho.wav' },
	},
	{
		templateId: 'flame_banner',
		version: '3.3.0',
		name: 'Flame Banner',
		shortDescription: 'Banner horizontal com logo subindo nas chamas internas + CTA limpo.',
		description:
			'Opção 2 do Flame Logo Pack: moldura horizontal ciano com a logo deslizando de baixo através das chamas internas e texto minimalista abaixo.',
		thumbnail: { kind: 'procedural_loop', loopDurationSec: 2.5, accentHex: '#22D3EE', secondaryHex: '#0891B2' },
		previewComposition: 'OutroFlameBannerPreview',
		renderComposition: 'OutroFlameBannerMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#0891B2',
				secondary: '#06B6D4',
				energy: '#22D3EE',
				glow: '#67E8F9',
				particles: '#CFFAFE',
				text: '#FFFFFF',
				ctaBg: '#22D3EE',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: { supportsCustomLogo: true, supportsParallax: true, supportsPaletteRecolor: true, supportsNextVideoCard: true, supportsAudioSfx: true, supportsSafeAreas: true },
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: { intro: 'riser.wav', whoosh: 'whoosh_rapido.wav', impact: 'impacto.wav', subscribe: 'sucesso.wav' },
	},
	{
		templateId: 'flame_squircle',
		version: '3.3.0',
		name: 'Flame Squircle',
		shortDescription: 'Moldura quadrada arredondada com fogo interno e fragmentos 2D ao redor.',
		description:
			'Opção 3 do Flame Logo Pack: emblema quadrado arredondado luminoso com fogo volumétrico interno, faíscas 2D explodindo ao redor e tipografia limpa.',
		thumbnail: { kind: 'procedural_loop', loopDurationSec: 2.5, accentHex: '#34D399', secondaryHex: '#059669' },
		previewComposition: 'OutroFlameSquirclePreview',
		renderComposition: 'OutroFlameSquircleMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#059669',
				secondary: '#10B981',
				energy: '#34D399',
				glow: '#6EE7B7',
				particles: '#D1FAE5',
				text: '#FFFFFF',
				ctaBg: '#34D399',
				ctaText: '#09090B',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: { supportsCustomLogo: true, supportsParallax: true, supportsPaletteRecolor: true, supportsNextVideoCard: true, supportsAudioSfx: true, supportsSafeAreas: true },
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: { intro: 'riser.wav', whoosh: 'whoosh.wav', impact: 'boom.wav', subscribe: 'brilho.wav' },
	},
	{
		templateId: 'flame_circle',
		version: '3.3.0',
		name: 'Flame Circle',
		shortDescription: 'Moldura circular estilo avatar com fogo giratório interno e chamas nas bordas.',
		description:
			'Opção 4 do Flame Logo Pack: círculo luminoso com fogo girando internamente atrás do emblema + @CANAL e subtítulo minimalista abaixo.',
		thumbnail: { kind: 'procedural_loop', loopDurationSec: 2.5, accentHex: '#F87171', secondaryHex: '#DC2626' },
		previewComposition: 'OutroFlameCirclePreview',
		renderComposition: 'OutroFlameCircleMaster',
		defaultParams: {
			durationMs: 15000,
			intensity: 55,
			parallaxEnabled: true,
			showSubscribeCta: true,
			showNextVideoCard: false,
			palette: {
				primary: '#B91C1C',
				secondary: '#DC2626',
				energy: '#EF4444',
				glow: '#FCA5A5',
				particles: '#FEE2E2',
				text: '#FFFFFF',
				ctaBg: '#EF4444',
				ctaText: '#FFFFFF',
			},
		},
		supportedAspectRatios: ['16:9', '9:16'],
		capabilities: { supportsCustomLogo: true, supportsParallax: true, supportsPaletteRecolor: true, supportsNextVideoCard: true, supportsAudioSfx: true, supportsSafeAreas: true },
		requiredAssets: ['optional_background', 'optional_logo', 'motionvelix_sfx'],
		sfxProfile: { intro: 'riser.wav', whoosh: 'whoosh_grave.wav', impact: 'impacto.wav', subscribe: 'ding.wav' },
	},
];

const templateRegistry = new Map<string, OutroTemplateDefinition>(
	BUILTIN_TEMPLATES.map((t) => [t.templateId, t]),
);

export function listOutroTemplates(): OutroTemplateDefinition[] {
	return Array.from(templateRegistry.values());
}

export function getOutroTemplate(templateId: string): OutroTemplateDefinition | null {
	return templateRegistry.get(templateId) ?? null;
}

export function registerOutroTemplate(def: OutroTemplateDefinition): void {
	templateRegistry.set(def.templateId, def);
}

export function resolveOutroTemplateWithFallback(templateId?: string | null): {
	template: OutroTemplateDefinition;
	usedFallback: boolean;
} {
	if (templateId) {
		const found = templateRegistry.get(templateId);
		if (found) return { template: found, usedFallback: false };
	}
	return { template: templateRegistry.get('fire_reveal')!, usedFallback: Boolean(templateId) };
}

// ─── WCAG Contrast & Image Palette Extraction ────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
	const clean = hex.replace('#', '');
	const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
	return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function computeContrastRatio(fgHex: string, bgHex: string): number {
	const l1 = relativeLuminance(fgHex);
	const l2 = relativeLuminance(bgHex);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function validatePaletteContrast(palette: OutroPalette): {
	ctaContrastRatio: number;
	textOnDarkContrastRatio: number;
	ctaReadable: boolean;
	textReadable: boolean;
	warnings: string[];
} {
	const ctaContrastRatio = computeContrastRatio(palette.ctaText, palette.ctaBg);
	const textOnDarkContrastRatio = computeContrastRatio(palette.text, '#0B0F19');
	const ctaReadable = ctaContrastRatio >= 4.5;
	const textReadable = textOnDarkContrastRatio >= 4.5;
	const warnings: string[] = [];
	if (!ctaReadable) {
		warnings.push(`Contraste do botão CTA baixo (${ctaContrastRatio}:1; mínimo recomendado 4.5:1).`);
	}
	if (!textReadable) {
		warnings.push(`Contraste do texto principal sobre fundo escuro baixo (${textOnDarkContrastRatio}:1).`);
	}
	return { ctaContrastRatio, textOnDarkContrastRatio, ctaReadable, textReadable, warnings };
}

/**
 * Extracts a harmonious palette directly from a local background image using sharp stats.
 */
export async function extractPaletteFromImage(imagePath: string): Promise<OutroPalette> {
	if (!existsSync(imagePath)) {
		throw new Error(`Imagem não encontrada para extração de paleta: ${imagePath}`);
	}
	const sharpMod = await import('sharp');
	const sharp = sharpMod.default;
	const stats = await sharp(imagePath).resize(64, 64, { fit: 'cover' }).stats();
	const [r, g, b] = [
		stats.channels[0]?.mean ?? 124,
		stats.channels[1]?.mean ?? 58,
		stats.channels[2]?.mean ?? 237,
	];
	const primary = rgbToHex(Math.min(255, r * 1.25 + 25), Math.min(255, g * 1.15 + 15), Math.min(255, b * 1.25 + 30));
	const secondary = rgbToHex(Math.min(255, b * 1.1 + 20), Math.min(255, r * 0.9 + 30), Math.min(255, g * 1.2 + 40));
	const energy = rgbToHex(Math.min(255, r * 1.35 + 45), Math.min(255, g * 1.2 + 30), Math.min(255, b * 1.35 + 45));
	const glow = rgbToHex(Math.min(255, r * 1.4 + 60), Math.min(255, g * 1.35 + 55), Math.min(255, b * 1.4 + 60));
	const particles = rgbToHex(Math.min(255, r * 0.5 + 160), Math.min(255, g * 0.5 + 160), Math.min(255, b * 0.5 + 160));
	const ctaLum = relativeLuminance(energy);
	const ctaText = ctaLum > 0.35 ? '#111111' : '#FFFFFF';
	return {
		primary,
		secondary,
		energy,
		glow,
		particles,
		text: '#FFFFFF',
		ctaBg: energy,
		ctaText,
	};
}

// ─── Legacy Migration (v2 VideoOutroConfig → Studio 3.0 OutroStudioConfigV3) ─

export function createDefaultOutroStudioConfigV3(input?: {
	channelId?: string;
	channelName?: string;
	channelPalette?: Partial<OutroPalette>;
	aspectRatio?: '16:9' | '9:16';
	defaultLogoId?: string | null;
	defaultLogoVersion?: number | null;
	defaultLogoHash?: string | null;
}): OutroStudioConfigV3 {
	const fire = getOutroTemplate('fire_reveal')!;
	const mergedPalette = outroPaletteSchema.parse({
		...fire.defaultParams.palette,
		...(input?.channelPalette ?? {}),
	});
	const chName = input?.channelName?.trim() || '';
	return outroStudioConfigV3Schema.parse({
		schemaVersion: 3,
		enabled: true,
		templateId: 'fire_reveal',
		templateVersion: fire.version,
		channelId: input?.channelId || 'default',
		channelName: chName,
		aspectRatio: input?.aspectRatio ?? '16:9',
		durationMs: 15000,
		paletteSource: 'channel',
		palette: mergedPalette,
		logoSelectionMode: 'manual',
		logoDisabled: false,
		selectedLogoId: input?.defaultLogoId ?? null,
		selectedLogoVersion: input?.defaultLogoVersion ?? null,
		selectedLogoHash: input?.defaultLogoHash ?? null,
		parallaxEnabled: true,
		showSubscribeCta: true,
		showNextVideoCard: false,
		intensity: 55,
		texts: {
			preTitle: 'OBRIGADO POR ASSISTIR',
			channelTitle: chName,
			subscribeCtaText: 'INSCREVA-SE NO CANAL',
			nextVideoLabel: 'PRÓXIMO VÍDEO',
			nextVideoTitle: '',
		},
		audio: {
			enabled: true,
			musicPath: null,
			musicVolume: 0.45,
			introSfxVolume: 0.7,
			whooshVolume: 0.75,
			impactVolume: 0.85,
			subscribeSfxVolume: 0.75,
			fadeInSec: 0.5,
			fadeOutSec: 0.8,
		},
	});
}

/**
 * Migrates any legacy v2 VideoOutroConfig (or partial v3 config with missing/unknown templateId)
 * cleanly into a valid OutroStudioConfigV3 without losing user settings.
 */
export function migrateLegacyOutroConfig(
	raw: Partial<VideoOutroConfig> | Partial<OutroStudioConfigV3> | null | undefined,
	channelPalette?: Partial<OutroPalette>,
): OutroStudioConfigV3 {
	if (!raw) {
		return createDefaultOutroStudioConfigV3({ channelPalette });
	}
	// Already v3
	if ('schemaVersion' in raw && raw.schemaVersion === 3) {
		const { template } = resolveOutroTemplateWithFallback(raw.templateId);
		return outroStudioConfigV3Schema.parse({
			...createDefaultOutroStudioConfigV3({ channelPalette }),
			...raw,
			templateId: template.templateId,
			templateVersion: template.version,
		});
	}
	// Legacy v2 VideoOutroConfig
	const legacy = raw as Partial<VideoOutroConfig>;
	const mappedTemplateId: OutroTemplateId =
		legacy.style === 'cinematic'
			? 'particle_reveal'
			: legacy.style === 'minimal'
				? 'electric_reveal'
				: 'fire_reveal';
	const { template } = resolveOutroTemplateWithFallback(mappedTemplateId);
	const durationMs = Math.max(5000, Math.min(30000, Math.round((legacy.durationSec ?? 15) * 1000)));
	const chName = legacy.channelName?.trim() || '';
	return outroStudioConfigV3Schema.parse({
		...createDefaultOutroStudioConfigV3({
			channelName: chName,
			aspectRatio: legacy.aspectRatio ?? '16:9',
			channelPalette,
		}),
		enabled: legacy.enabled ?? false,
		templateId: template.templateId,
		templateVersion: template.version,
		durationMs,
		backgroundImagePath: legacy.backgroundImagePath ?? null,
		backgroundImageName: legacy.backgroundImageName ?? null,
		parallaxEnabled: legacy.parallaxEnabled ?? true,
		showSubscribeCta: legacy.showSubscribeCta ?? true,
		showNextVideoCard: legacy.showNextVideoCard ?? false,
		texts: {
			preTitle: 'OBRIGADO POR ASSISTIR',
			channelTitle: chName,
			subscribeCtaText: 'INSCREVA-SE NO CANAL',
			nextVideoLabel: 'PRÓXIMO VÍDEO',
			nextVideoTitle: legacy.nextVideoTitle ?? '',
		},
		lastPreviewMp4Path: legacy.lastPreviewMp4Path ?? null,
		lastRenderedAtIso: legacy.lastRenderedAtIso ?? null,
		saveAsChannelDefault: legacy.saveAsChannelDefault ?? false,
	});
}
