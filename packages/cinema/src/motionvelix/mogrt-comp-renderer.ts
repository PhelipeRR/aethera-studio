/**
 * MotionVelix MOGRT Engine: composition renderer and MP4 exporter, without Adobe.
 *
 * Renders the decoded project graph (parenting, keyframes, expressions, masks, track mattes,
 * adjustment layers, time remapping, text, rectangle shapes) on CPU RGBA buffers.
 *
 * It is a partial reimplementation. Whatever it cannot reproduce is reported as a gap or an
 * approximation; nothing is replaced by procedural look-alike content.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	evaluatePropertyAtTime,
	parseAepProjectGraph,
	type AepAnimatedProperty,
	type AepControlBinding,
	type AepEffectInstance,
	type AepGraphComposition,
	type AepGraphLayer,
	type AepProjectGraph,
	type AepVectorNode,
} from './aep-comp-graph.js';
import { evaluateAnimatedMaskAtTime, type Vec2 } from './aep-mask-extractor.js';
import {
	applyEffectCurves,
	applyEffectExposure,
	applyEffectMosaic,
	applyEffectRadialZoom,
	applyEffectRamp,
	type ExposureChannel,
	type RadialZoomType,
} from './mogrt-effects-color.js';
import {
	applyEffectDisplacementMap,
	applyEffectFractalNoise,
	applyEffectTurbulentDisplace,
	turbulentDisplaceReach,
	type DisplacementChannel,
	type TurbulentDisplaceKind,
} from './mogrt-effects-distort.js';
import {
	applyEffectBoxBlur,
	applyEffectDropShadow,
	applyEffectFill,
	applyEffectGlow,
	applyEffectNoise,
	applyEffectSetMatte,
	applyEffectShiftChannels,
	applyEffectSimpleChoker,
	applyEffectTint,
	cloneRgbaBuffer,
	compositeLayerAffine,
	compositeLayerTransformed,
	createRgbaBuffer,
	fillRgbaSolid,
	type RgbaBuffer,
	type SetMatteChannel,
} from './mogrt-effects-pipeline.js';
import {
	evaluateAeExpression,
	hexStringToRgba01,
	type ControlOverrideValue,
	type ExpressionPropertyRef,
} from './mogrt-expression-eval.js';
import { inspectMogrtFile, type MogrtInspectionResult } from './mogrt-importer.js';
import { rasterizeMaskStack, rasterizePaths, strokeConvexPath, type Affine } from './mogrt-mask-renderer.js';
import { loadLogoImageRgba, renderTextLayerRgba, sha256File, writeRgbaBufferToPng } from './mogrt-media-loader.js';

export interface MogrtRenderOverrides {
	/** Path to user-chosen PNG or SVG logo replacing the template's logo placeholder. */
	logoPath?: string;
	/** Path to user-chosen background image. The template's own "BG Footage" control still decides its visibility. */
	bgImagePath?: string;
	/**
	 * Values keyed by the template's control names (colours as `#rrggbb` or `[r,g,b,a]` in 0..1, points in
	 * pixels, scales in percent). Unknown names and invalid values throw.
	 */
	controls?: Record<string, ControlOverrideValue>;
	/** Text for the template's single text control, without mutating the `.mogrt`. */
	textOverride?: string;
}

export interface RenderMogrtPhase3AOptions {
	mogrtPath: string;
	workDir: string;
	outputMp4Path: string;
	overrides?: MogrtRenderOverrides;
	/** Target render width (default 1280 for fast validation). */
	width?: number;
	/** Target render height (default 720). The composition is fitted inside, keeping its aspect ratio. */
	height?: number;
	/** Override FPS (default: root composition FPS). */
	fps?: number;
	/** Override duration in seconds (default: root composition duration). */
	durationSec?: number;
	/** Optional timestamps (in seconds) to capture PNG frames during the render pass. */
	captureFrames?: Array<{ tSec: number; outputPngPath: string }>;
}

export interface MogrtRenderGap {
	compName: string;
	layerName: string;
	reason: string;
}

export interface MogrtUnsupportedEffect extends MogrtRenderGap {
	matchName: string;
	displayName: string;
}

export interface MogrtPhase3ARenderReport {
	mogrtPath: string;
	originalMogrtSha256Before: string;
	originalMogrtSha256After: string;
	originalMogrtUntouched: boolean;
	templateName: string;
	rootCompName: string;
	outputMp4Path: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	/** Duration declared by `definition.json`. */
	templateDurationSec: number;
	framesRendered: number;
	/** Frames where more than 0.1% of the pixels are not black. */
	nonBlackFrames: number;
	renderMs: number;
	logoSubstituted: boolean;
	logoSourcePath: string | null;
	nestedCompsRendered: Array<{
		name: string;
		width: number;
		height: number;
		fps: number;
		durationSec: number;
		layerCount: number;
		maskCount: number;
	}>;
	masksProvenance: {
		aepTotalMasksExtracted: number;
		aepTotalKeyframesExtracted: number;
		uniqueRealMasksRasterized: number;
		totalMaskRasterizations: number;
		totalVerticesRasterized: number;
		verifiedFromAepBinary: boolean;
	};
	effectsExecutedCounts: Record<string, number>;
	unsupportedEffectsEncountered: MogrtUnsupportedEffect[];
	/** Gaps other than effects and expressions. */
	renderGaps: MogrtRenderGap[];
	approximations: string[];
	warnings: string[];
	expressionsAudit: {
		totalInAep: number;
		supportedEvaluations: number;
		unsupportedUnique: Array<{ compName: string; layerName: string; expression: string; reason: string }>;
	};
	missingEssentialLayers: string[];
	failures: string[];
	completenessVerdict: 'complete' | 'partial_with_documented_gaps' | 'failed';
	completenessReason: string;
	capturedFramePaths: string[];
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const TIME_EPSILON_SEC = 1e-6;
const MAX_DEPTH = 32;
const MAX_EFFECT_PADDING_PX = 160;
const LIT_PIXEL_SUM = 24;
/** Popup codes, which count the menus' separators. The "Smoother" variants share their base kind. */
const DISPLACE_KINDS: Record<number, TurbulentDisplaceKind> = {
	1: 'turbulent',
	2: 'bulge',
	3: 'twist',
	5: 'turbulent',
	6: 'bulge',
	7: 'twist',
	9: 'vertical',
	10: 'horizontal',
	11: 'turbulent', // Cross is both axes at once.
};
const DISPLACEMENT_CHANNELS: Record<number, DisplacementChannel> = {
	1: 'red',
	2: 'green',
	3: 'blue',
	4: 'alpha',
	5: 'luma',
	9: 'full',
	10: 'half',
	11: 'off',
};
const CONTROL_EFFECT = /^ADBE (Checkbox|Color|Point|Slider|Angle|Layer) Control$/;

function multiply(m: Affine, n: Affine): Affine {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

function translation(x: number, y: number): Affine {
	return [1, 0, 0, 1, x, y];
}

function scaling(x: number, y: number): Affine {
	return [x, 0, 0, y, 0, 0];
}

function rotation(degrees: number): Affine {
	const angle = (degrees * Math.PI) / 180;
	return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
}

function transformPoint([a, b, c, d, e, f]: Affine, x: number, y: number): Vec2 {
	return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function invert([a, b, c, d, e, f]: Affine): Affine | undefined {
	const det = a * d - b * c;
	if (Math.abs(det) < 1e-12) return undefined;
	return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Stored units to the units expressions and controls show. */
function toUserUnits(prop: AepAnimatedProperty, value: number[]): number[] {
	if (prop.unit === 'fraction_percent') return value.map((v) => v * 100);
	if (prop.unit !== 'color_argb255') return value;
	const [a = 255, r = 0, g = 0, b = 0] = value;
	return [r / 255, g / 255, b / 255, a / 255];
}

function toStoredUnits(prop: AepAnimatedProperty, value: number[]): number[] {
	if (prop.unit === 'fraction_percent') return value.map((v) => v / 100);
	if (prop.unit !== 'color_argb255') return value;
	const [r = 0, g = 0, b = 0, a = 1] = value;
	return [a * 255, r * 255, g * 255, b * 255];
}

// ---------------------------------------------------------------------------
// Overrides

interface ResolvedOverrides {
	properties: Map<AepAnimatedProperty, number[]>;
	texts: Map<AepGraphLayer, string>;
	logoPath?: string;
	bgImagePath?: string;
}

function controlValue(binding: AepControlBinding, raw: ControlOverrideValue): number[] {
	const invalid = (expected: string): never => {
		throw new TypeError(`Valor inválido para o controle "${binding.name}": esperado ${expected}.`);
	};
	const vector = (min: number, max: number, expected: string): number[] =>
		Array.isArray(raw) && raw.length >= min && raw.length <= max && raw.every(Number.isFinite) ? raw : invalid(expected);
	const single = (expected: string): number => (typeof raw === 'number' && Number.isFinite(raw) ? raw : invalid(expected));
	const prop = binding.property!;

	switch (binding.kind) {
		case 'boolean':
			return typeof raw === 'boolean' || raw === 0 || raw === 1 ? [Number(raw)] : invalid('true/false');
		case 'color': {
			const expected = '#rrggbb ou [r,g,b,a] entre 0 e 1';
			const rgba = typeof raw === 'string' ? (hexStringToRgba01(raw) ?? invalid(expected)) : vector(3, 4, expected);
			return toStoredUnits(prop, rgba);
		}
		case 'point': {
			const point = vector(2, 3, '[x, y] em pixels');
			return prop.staticValue.map((value, i) => point[i] ?? value);
		}
		case 'scale': {
			const expected = 'porcentagem ou [x, y]';
			const percent = typeof raw === 'number' ? [single(expected), single(expected)] : vector(2, 3, expected);
			return prop.staticValue.map((value, i) => (percent[i] === undefined ? value : percent[i] / 100));
		}
		default:
			return [single('um número')];
	}
}

function resolveOverrides(graph: AepProjectGraph, overrides: MogrtRenderOverrides = {}): ResolvedOverrides {
	const resolved: ResolvedOverrides = { properties: new Map(), texts: new Map() };
	const editable = graph.controls.filter((control) => control.kind !== 'media');

	for (const [name, raw] of Object.entries(overrides.controls ?? {})) {
		const targets = editable.filter((control) => control.name === name);
		if (targets.length === 0) {
			const available = [...new Set(editable.map((control) => control.name))].join(', ');
			throw new Error(`Controle "${name}" não existe no template. Disponíveis: ${available}`);
		}
		for (const target of targets) {
			if (target.kind === 'text') {
				if (typeof raw !== 'string') throw new TypeError(`O controle "${name}" espera um texto.`);
				resolved.texts.set(target.layer, raw);
			} else {
				resolved.properties.set(target.property!, controlValue(target, raw));
			}
		}
	}

	if (overrides.textOverride !== undefined) {
		const texts = new Set(editable.filter((control) => control.kind === 'text').map((control) => control.layer));
		if (texts.size !== 1) {
			throw new Error(`textOverride exige exatamente um controle de texto; o template tem ${texts.size}. Use "controls".`);
		}
		for (const layer of texts) resolved.texts.set(layer, overrides.textOverride);
	}

	for (const [key, kind] of [
		['logoPath', 'logo_placeholder'],
		['bgImagePath', 'bg_placeholder'],
	] as const) {
		const path = overrides[key];
		if (!path) continue;
		if (!existsSync(path)) throw new Error(`Arquivo não encontrado (${key}): ${path}`);
		if (!graph.controls.some((control) => control.kind === 'media' && control.layer.kind === kind)) {
			throw new Error(`O template não tem placeholder para ${key}.`);
		}
		resolved[key] = path;
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// Renderer

/** A layer drawn into its own buffer. `matrix` maps buffer pixels to composition buffer pixels. */
interface LayerImage {
	buffer: RgbaBuffer;
	matrix: Affine;
}

/** Transparent pixels kept around a composition's bounds on each side, for collapsed pre-compositions. */
type Bleed = number;

interface EffectSpace {
	comp: AepGraphComposition;
	layer: AepGraphLayer;
	tSec: number;
	/** Buffer pixels per layer pixel. */
	scale: number;
	padding: number;
	/** Buffer size of the layer itself, without padding. */
	width: number;
	height: number;
	depth: number;
}

class CompositionRenderer {
	masksRasterized = 0;
	verticesRasterized = 0;
	logoSubstituted = false;
	supportedExpressionEvaluations = 0;
	readonly uniqueMasks = new Set<string>();
	readonly compsTouched = new Set<number>();
	readonly effectCounts: Record<string, number> = {};
	readonly approximations = new Set<string>();
	private readonly gapMap = new Map<string, MogrtRenderGap>();
	private readonly effectGaps = new Map<string, MogrtUnsupportedEffect>();
	private readonly expressionGaps = new Map<
		string,
		{ compName: string; layerName: string; expression: string; reason: string }
	>();
	private readonly staticImages = new Map<string, RgbaBuffer>();
	private frameCache = new Map<string, RgbaBuffer>();

	constructor(
		readonly graph: AepProjectGraph,
		private readonly overrides: ResolvedOverrides,
	) {}

	get gaps(): MogrtRenderGap[] {
		return [...this.gapMap.values()];
	}

	get unsupportedExpressions() {
		return [...this.expressionGaps.values()];
	}

	/** Effects skipped while rendering plus every unsupported effect declared in the project. */
	get unsupportedEffects(): MogrtUnsupportedEffect[] {
		const all = new Map(this.effectGaps);
		for (const { compName, layerName, matchName, displayName } of this.graph.unsupportedEffects) {
			const key = `${compName}::${layerName}::${matchName}`;
			if (all.has(key)) continue;
			all.set(key, {
				compName,
				layerName,
				matchName,
				displayName,
				reason: 'Efeito não implementado (Fase 3B); não é reproduzido.',
			});
		}
		return [...all.values()];
	}

	/** Renders the root composition fitted into `width` x `height`, with transparency. */
	renderFrame(tSec: number, width: number, height: number): RgbaBuffer {
		const root = this.graph.compositionsById.get(this.graph.rootCompId)!;
		this.frameCache = new Map();
		const scale = Math.min(width / root.width, height / root.height);
		const image = this.renderComposition(root, tSec, scale, 0);
		if (image.width === width && image.height === height) return image;
		const frame = createRgbaBuffer(width, height);
		compositeLayerAffine(frame, image, translation((width - image.width) / 2, (height - image.height) / 2));
		return frame;
	}

	private gap(comp: AepGraphComposition, layer: AepGraphLayer, reason: string): void {
		this.gapMap.set(`${comp.itemId}:${layer.layerId}:${reason}`, { compName: comp.name, layerName: layer.name, reason });
	}

	private effectGap(space: EffectSpace, effect: AepEffectInstance, reason: string): void {
		const { comp, layer } = space;
		this.effectGaps.set(`${comp.name}::${layer.name}::${effect.matchName}`, {
			compName: comp.name,
			layerName: layer.name,
			matchName: effect.matchName,
			displayName: effect.displayName,
			reason,
		});
	}

	private executed(effect: AepEffectInstance): void {
		this.effectCounts[effect.matchName] = (this.effectCounts[effect.matchName] ?? 0) + 1;
	}

	// --- properties

	private localTime(layer: AepGraphLayer, tSec: number): number {
		return (tSec - layer.startTimeSec) / layer.stretch;
	}

	/** Value in stored units at composition time `tSec`, after overrides and expressions. */
	private value(
		prop: AepAnimatedProperty,
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		tSec: number,
		depth = 0,
	): number[] {
		const override = this.overrides.properties.get(prop);
		if (override) return override;
		const base = evaluatePropertyAtTime(prop, this.localTime(layer, tSec));
		if (!prop.expression || depth > MAX_DEPTH) return base;

		const result = evaluateAeExpression(prop.expression, {
			tSec,
			seed: layer.layerId,
			valueAt: (t) => toUserUnits(prop, evaluatePropertyAtTime(prop, this.localTime(layer, t))),
			resolveProperty: (ref, t) => this.referencedValue(ref, comp, layer, t, depth + 1),
		});
		if (!result.supported) {
			this.expressionGaps.set(`${comp.itemId}:${layer.layerId}:${prop.matchName}:${prop.expression}`, {
				compName: comp.name,
				layerName: layer.name,
				expression: prop.expression,
				reason: result.reason ?? 'Expressão não suportada.',
			});
			return base;
		}
		this.supportedExpressionEvaluations++;
		if (result.approximated) {
			this.approximations.add('wiggle(): ruído determinístico próprio, com curva diferente da do After Effects.');
		}
		const user = toUserUnits(prop, base).map((value, i) => result.value[i] ?? value);
		return toStoredUnits(prop, user);
	}

	private referencedValue(
		ref: ExpressionPropertyRef,
		currentComp: AepGraphComposition,
		currentLayer: AepGraphLayer,
		tSec: number,
		depth: number,
	): number[] | undefined {
		const comp = ref.comp === undefined ? currentComp : this.graph.compositionsByName.get(ref.comp);
		if (!comp) return undefined;
		let layer: AepGraphLayer | undefined;
		if (ref.layer === undefined) layer = comp === currentComp ? currentLayer : undefined;
		else if (typeof ref.layer === 'number') layer = comp.layers[ref.layer - 1];
		else layer = comp.layers.find((candidate) => candidate.name === ref.layer);
		if (!layer) return undefined;
		const effect =
			typeof ref.effect === 'number'
				? layer.effects[ref.effect - 1]
				: layer.effects.find((candidate) => candidate.displayName === ref.effect);
		if (!effect) return undefined;
		const param = effect.params.find((candidate) =>
			typeof ref.param === 'number'
				? candidate.matchName === `${effect.matchName}-${String(ref.param).padStart(4, '0')}`
				: candidate.matchName === ref.param || candidate.name === ref.param,
		);
		return param && toUserUnits(param.property, this.value(param.property, comp, layer, tSec, depth));
	}

	/** Layer pixels to composition pixels, through the whole parent chain. */
	private worldMatrix(comp: AepGraphComposition, layer: AepGraphLayer, tSec: number): Affine {
		let world: Affine = IDENTITY;
		const seen = new Set<AepGraphLayer>();
		let current: AepGraphLayer | undefined = layer;
		while (current && !seen.has(current)) {
			seen.add(current);
			const node: AepGraphLayer = current;
			const get = (prop: AepAnimatedProperty): number[] => this.value(prop, comp, node, tSec);
			const { transform } = node;
			const position =
				transform.positionX && transform.positionY
					? [get(transform.positionX)[0]!, get(transform.positionY)[0]!]
					: get(transform.position);
			const anchor = get(transform.anchorPoint);
			const scale = get(transform.scale);
			const local = multiply(
				multiply(translation(position[0]!, position[1]!), rotation(get(transform.rotation)[0]!)),
				multiply(scaling(scale[0]!, scale[1]!), translation(-anchor[0]!, -anchor[1]!)),
			);
			world = multiply(local, world);
			const parentId: number = node.parentLayerId;
			current = parentId ? comp.layers.find((candidate) => candidate.layerId === parentId) : undefined;
		}
		return world;
	}

	// --- compositions and layers

	private renderComposition(
		comp: AepGraphComposition,
		tSec: number,
		scale: number,
		depth: number,
		bleed: Bleed = 0,
	): RgbaBuffer {
		const key = `${comp.itemId}|${tSec.toFixed(6)}|${scale}|${bleed}`;
		let image = this.frameCache.get(key);
		if (!image) {
			if (depth > MAX_DEPTH) throw new Error(`Composições aninhadas demais ou cíclicas em "${comp.name}".`);
			this.compsTouched.add(comp.itemId);
			image = this.renderStack(comp, 0, tSec, scale, depth, bleed);
			this.frameCache.set(key, image);
		}
		return cloneRgbaBuffer(image);
	}

	/** Composites the layers from `first` down to the bottom of the stack. */
	private renderStack(
		comp: AepGraphComposition,
		first: number,
		tSec: number,
		scale: number,
		depth: number,
		bleed: Bleed,
	): RgbaBuffer {
		if (depth > MAX_DEPTH * 2) throw new Error(`Pilha de camadas profunda demais em "${comp.name}".`);
		let out = createRgbaBuffer(
			Math.max(1, Math.round(comp.width * scale)) + bleed * 2,
			Math.max(1, Math.round(comp.height * scale)) + bleed * 2,
		);

		for (let i = comp.layers.length - 1; i >= first; i--) {
			const layer = comp.layers[i]!;
			if (!layer.enabled || layer.guide || (layer.isNull && !layer.adjustmentLayer)) continue;
			if (!this.isActive(layer, tSec)) continue;
			if (layer.threeD) this.gap(comp, layer, 'Camada 3D renderizada em 2D.');
			if (layer.unsupportedBlendId !== undefined) {
				this.gap(comp, layer, `Modo de mesclagem ${layer.unsupportedBlendId} não implementado; composto como normal.`);
			}

			const opacity = this.value(layer.transform.opacity, comp, layer, tSec)[0]!;
			if (opacity <= 0.002) continue;

			if (layer.adjustmentLayer) {
				out = this.applyAdjustment(comp, i, out, opacity, tSec, scale, depth, bleed);
				continue;
			}
			const image = this.renderLayer(comp, layer, tSec, scale, depth, bleed);
			if (!image) continue;
			const matte = this.trackMatte(comp, i, out, tSec, scale, depth, bleed);
			compositeLayerAffine(
				out,
				image.buffer,
				image.matrix,
				opacity,
				layer.blendMode,
				matte && { buffer: matte, type: layer.trackMatte },
			);
		}
		return out;
	}

	private isActive(layer: AepGraphLayer, tSec: number): boolean {
		const start = Math.min(layer.inPointSec, layer.outPointSec);
		const end = Math.max(layer.inPointSec, layer.outPointSec);
		return tSec >= start - TIME_EPSILON_SEC && tSec < end - TIME_EPSILON_SEC;
	}

	private trackMatte(
		comp: AepGraphComposition,
		index: number,
		target: RgbaBuffer,
		tSec: number,
		scale: number,
		depth: number,
		bleed: Bleed,
	): RgbaBuffer | undefined {
		if (comp.layers[index]!.trackMatte === 'none') return undefined;
		const matte = createRgbaBuffer(target.width, target.height);
		const source = comp.layers[index - 1];
		if (!source || !this.isActive(source, tSec)) return matte;
		const image = this.renderLayer(comp, source, tSec, scale, depth, bleed);
		if (image) {
			const opacity = this.value(source.transform.opacity, comp, source, tSec)[0]!;
			compositeLayerAffine(matte, image.buffer, image.matrix, opacity);
		}
		return matte;
	}

	/** Posterize Time makes the layer, and for adjustment layers everything below it, step in time. */
	private posterizedTime(comp: AepGraphComposition, layer: AepGraphLayer, tSec: number): number {
		if (!layer.effectsActive) return tSec;
		let time = tSec;
		for (const effect of layer.effects) {
			if (!effect.enabled || effect.matchName !== 'ADBE Posterize Time') continue;
			const param = effect.params.find((candidate) => candidate.matchName === 'ADBE Posterize Time-0001');
			const fps = param ? this.value(param.property, comp, layer, tSec)[0]! : 0;
			if (fps > 0) {
				time = Math.floor(time * fps + TIME_EPSILON_SEC) / fps;
				this.executed(effect);
			}
		}
		return time;
	}

	private applyAdjustment(
		comp: AepGraphComposition,
		index: number,
		below: RgbaBuffer,
		opacity: number,
		tSec: number,
		scale: number,
		depth: number,
		bleed: Bleed,
	): RgbaBuffer {
		const layer = comp.layers[index]!;
		if (!layer.effectsActive || !layer.effects.some((effect) => effect.enabled)) return below;

		const time = this.posterizedTime(comp, layer, tSec);
		const processed =
			time === tSec ? cloneRgbaBuffer(below) : this.renderStack(comp, index + 1, time, scale, depth + 1, bleed);
		const { width, height } = below;
		const inner = { width: width - bleed * 2, height: height - bleed * 2 };
		if (!this.applyEffects(processed, { comp, layer, tSec: time, scale, padding: bleed, ...inner, depth })) {
			return below;
		}

		// The effects only reach as far as the adjustment layer's own bounds, masks and matte.
		const matrix = multiply([scale, 0, 0, scale, bleed, bleed], this.worldMatrix(comp, layer, tSec));
		const size = layer.sourceSize ?? comp;
		const footprint = createRgbaBuffer(width, height);
		const square = createRgbaBuffer(2, 2);
		fillRgbaSolid(square, 255, 255, 255, 255);
		const matte = this.trackMatte(comp, index, below, tSec, scale, depth, bleed);
		compositeLayerAffine(
			footprint,
			square,
			multiply(matrix, scaling(size.width / 2, size.height / 2)),
			opacity,
			'normal',
			matte && { buffer: matte, type: layer.trackMatte },
		);
		this.applyMasks(footprint, comp, layer, matrix, tSec);

		const out = cloneRgbaBuffer(below);
		for (let o = 0; o < out.data.length; o += 4) {
			const mix = footprint.data[o + 3]! / 255;
			if (mix === 0) continue;
			const belowWeight = (below.data[o + 3]! / 255) * (1 - mix);
			const processedWeight = (processed.data[o + 3]! / 255) * mix;
			const alpha = belowWeight + processedWeight;
			out.data[o + 3] = Math.round(alpha * 255);
			if (alpha === 0) continue;
			for (let k = o; k < o + 3; k++) {
				out.data[k] = Math.round((below.data[k]! * belowWeight + processed.data[k]! * processedWeight) / alpha);
			}
		}
		return out;
	}

	private renderLayer(
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		tSec: number,
		compScale: number,
		depth: number,
		bleed: Bleed,
	): LayerImage | null {
		const world = this.worldMatrix(comp, layer, tSec);
		const toBuffer = multiply([compScale, 0, 0, compScale, bleed, bleed], world);
		const time = this.posterizedTime(comp, layer, tSec);

		// Text and shapes rasterize continuously: content, masks and effects live in composition space.
		if (!layer.sourceSize) {
			const width = Math.max(1, Math.round(comp.width * compScale));
			const height = Math.max(1, Math.round(comp.height * compScale));
			const buffer = createRgbaBuffer(width + bleed * 2, height + bleed * 2);
			this.drawVectorContent(buffer, comp, layer, toBuffer, time);
			this.applyMasks(buffer, comp, layer, toBuffer, time);
			const space = { comp, layer, tSec: time, scale: compScale, padding: bleed, width, height, depth };
			return this.applyEffects(buffer, space) ? { buffer, matrix: IDENTITY } : null;
		}

		const stretch = Math.max(Math.hypot(toBuffer[0], toBuffer[1]), Math.hypot(toBuffer[2], toBuffer[3]));
		if (stretch < 1e-4) return null;
		if (layer.collapseTransform) {
			this.approximations.add(
				'Recolher transformações: mais resolução (até 2x); só pré-composições com texto deixam de cortar nas bordas.',
			);
		}
		// Quantized, so that animated scales still share cached pre-compositions.
		const scale = Math.min(layer.collapseTransform ? 2 : 1, Math.ceil(stretch * 128) / 128);
		const { width: sourceWidth, height: sourceHeight } = layer.sourceSize;
		const width = Math.max(1, Math.round(sourceWidth * scale));
		const height = Math.max(1, Math.round(sourceHeight * scale));
		const sx = width / sourceWidth;
		const sy = height / sourceHeight;

		// Collapsed pre-compositions do not clip in AE; that matters for text longer than its comp.
		const child = layer.collapseTransform ? this.graph.compositionsById.get(layer.sourceId) : undefined;
		const childBleed = child?.layers.some((inner) => inner.kind === 'text') ? Math.max(width, height) : 0;
		let buffer = this.sourceContent(comp, layer, time, scale, width, height, depth, childBleed);
		if (!buffer) return null;
		this.applyMasks(buffer, comp, layer, [sx, 0, 0, sy, childBleed, childBleed], time);

		const effectRoom = this.effectPadding(comp, layer, time, scale);
		if (effectRoom > 0) {
			const inner: RgbaBuffer = buffer;
			buffer = createRgbaBuffer(inner.width + effectRoom * 2, inner.height + effectRoom * 2);
			for (let y = 0; y < inner.height; y++) {
				const row = inner.data.subarray(y * inner.width * 4, (y + 1) * inner.width * 4);
				buffer.data.set(row, ((y + effectRoom) * buffer.width + effectRoom) * 4);
			}
		}
		const padding = childBleed + effectRoom;
		if (!this.applyEffects(buffer, { comp, layer, tSec: time, scale, padding, width, height, depth })) return null;
		return { buffer, matrix: multiply(toBuffer, [1 / sx, 0, 0, 1 / sy, -padding / sx, -padding / sy]) };
	}

	/** The untouched source of a layer that has one. */
	private sourceContent(
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		tSec: number,
		scale: number,
		width: number,
		height: number,
		depth: number,
		bleed: Bleed = 0,
	): RgbaBuffer | null {
		const media =
			layer.kind === 'logo_placeholder'
				? this.overrides.logoPath
				: layer.kind === 'bg_placeholder'
					? this.overrides.bgImagePath
					: undefined;
		if (media) {
			const key = `media|${media}|${width}x${height}`;
			let image = this.staticImages.get(key);
			if (!image) {
				image = loadLogoImageRgba(media, width, height);
				this.staticImages.set(key, image);
			}
			if (layer.kind === 'logo_placeholder') this.logoSubstituted = true;
			return cloneRgbaBuffer(image);
		}

		if (layer.solid) {
			const buffer = createRgbaBuffer(width, height);
			const [r, g, b] = layer.solid.color;
			fillRgbaSolid(buffer, Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255);
			return buffer;
		}

		const child = this.graph.compositionsById.get(layer.sourceId);
		if (!child) {
			this.gap(comp, layer, `Mídia "${layer.sourceName}" não é suportada; camada omitida.`);
			return null;
		}
		let childTime = this.localTime(layer, tSec);
		if (layer.timeRemap) {
			childTime = this.value(layer.timeRemap, comp, layer, tSec)[0]!;
			// A remap held on the last key shows the last frame, not the empty instant after it.
			if (Math.abs(childTime - child.durationSec) < TIME_EPSILON_SEC) childTime -= 1 / child.fps;
		}
		if (childTime < -TIME_EPSILON_SEC || childTime >= child.durationSec - TIME_EPSILON_SEC) return null;
		return this.renderComposition(child, Math.max(0, childTime), scale, depth + 1, bleed);
	}

	private drawVectorContent(
		buffer: RgbaBuffer,
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		matrix: Affine,
		tSec: number,
	): void {
		if (layer.kind === 'text') this.drawText(buffer, comp, layer, matrix, tSec);
		else if (layer.shapes) this.drawShapes(buffer, comp, layer, matrix, tSec);
		// An empty shape layer, such as a controls holder, draws nothing in After Effects either.
		else if (layer.kind !== 'shape') this.gap(comp, layer, 'Tipo de camada sem fonte não suportado; camada omitida.');
	}

	private drawText(
		buffer: RgbaBuffer,
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		matrix: Affine,
		tSec: number,
	): void {
		const doc = layer.textDoc;
		if (!doc) {
			this.gap(comp, layer, 'Documento de texto não decodificado; camada omitida.');
			return;
		}
		const spacing = doc.lineSpacing ? (this.value(doc.lineSpacing, comp, layer, tSec)[1] ?? 0) : 0;
		const options = {
			text: this.overrides.texts.get(layer) ?? doc.text,
			width: buffer.width,
			height: buffer.height,
			matrix,
			fontSize: doc.fontSize,
			lineHeight: (doc.autoLeading || !doc.leading ? doc.fontSize * 1.2 : doc.leading) + spacing,
			colorRgba01: doc.fillColor,
			fontName: doc.fontName,
			justification: doc.justification,
			tracking: doc.tracking,
			baselineShift: doc.baselineShift,
			allCaps: doc.allCaps,
		};
		const key = `text|${JSON.stringify(options)}`;
		let image = this.staticImages.get(key);
		if (!image) {
			image = renderTextLayerRgba(options);
			this.staticImages.set(key, image);
			this.approximations.add(
				`Fonte "${doc.fontName}" não vem no .mogrt: se não estiver instalada, o rasterizador usa outra.`,
			);
		}
		buffer.data.set(image.data);
	}

	private drawShapes(
		buffer: RgbaBuffer,
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		matrix: Affine,
		tSec: number,
	): void {
		const get = (node: AepVectorNode, name: string, fallback: number[]): number[] => {
			const prop = node.properties.get(name);
			return prop ? this.value(prop, comp, layer, tSec) : fallback;
		};
		const paints: Array<{ paths: Vec2[][]; color: number[]; opacity: number }> = [];

		const visit = (items: AepVectorNode[], parentMatrix: Affine, opacity: number): Vec2[][] => {
			const paths: Vec2[][] = [];
			for (const node of items) {
				if (!node.enabled) continue;
				switch (node.matchName) {
					case 'ADBE Vector Group': {
						const contents = node.children.find((child) => child.matchName === 'ADBE Vectors Group');
						const transform = node.children.find((child) => child.matchName === 'ADBE Vector Transform Group');
						let groupMatrix = parentMatrix;
						let groupOpacity = opacity;
						if (transform) {
							const position = get(transform, 'ADBE Vector Position', [0, 0]);
							const anchor = get(transform, 'ADBE Vector Anchor', [0, 0]);
							const scale = get(transform, 'ADBE Vector Scale', [100, 100]);
							const skew = get(transform, 'ADBE Vector Skew', [0])[0]!;
							const axis = get(transform, 'ADBE Vector Skew Axis', [0])[0]!;
							const shear = multiply(
								multiply(rotation(axis), [1, 0, Math.tan((-skew * Math.PI) / 180), 1, 0, 0]),
								rotation(-axis),
							);
							const spin = rotation(get(transform, 'ADBE Vector Rotation', [0])[0]!);
							const local = multiply(
								multiply(translation(position[0]!, position[1]!), multiply(spin, shear)),
								multiply(scaling(scale[0]! / 100, scale[1]! / 100), translation(-anchor[0]!, -anchor[1]!)),
							);
							groupMatrix = multiply(parentMatrix, local);
							groupOpacity *= get(transform, 'ADBE Vector Group Opacity', [100])[0]! / 100;
						}
						paths.push(...visit(contents?.children ?? [], groupMatrix, groupOpacity));
						break;
					}
					case 'ADBE Vector Shape - Rect': {
						const [w, h] = get(node, 'ADBE Vector Rect Size', [100, 100]) as [number, number];
						const [x, y] = get(node, 'ADBE Vector Rect Position', [0, 0]) as [number, number];
						if (get(node, 'ADBE Vector Rect Roundness', [0])[0]! > 0) {
							this.gap(comp, layer, 'Retângulo arredondado desenhado com cantos retos.');
						}
						paths.push([
							transformPoint(parentMatrix, x - w / 2, y - h / 2),
							transformPoint(parentMatrix, x + w / 2, y - h / 2),
							transformPoint(parentMatrix, x + w / 2, y + h / 2),
							transformPoint(parentMatrix, x - w / 2, y + h / 2),
						]);
						break;
					}
					case 'ADBE Vector Graphic - Fill':
						paints.push({
							paths: [...paths],
							color: get(node, 'ADBE Vector Fill Color', [255, 255, 0, 0]),
							opacity: (opacity * get(node, 'ADBE Vector Fill Opacity', [100])[0]!) / 100,
						});
						break;
					case 'ADBE Vector Graphic - Stroke': {
						const strokeWidth = get(node, 'ADBE Vector Stroke Width', [2])[0]!;
						const toStroke = invert(parentMatrix);
						if (strokeWidth <= 0 || !toStroke) break;
						const styled =
							get(node, 'ADBE Vector Stroke Line Join', [1])[0] !== 1 ||
							node.children.some((child) => child.properties.size > 0);
						if (styled) this.gap(comp, layer, 'Traço desenhado sem tracejado, afinamento, onda ou junção arredondada.');
						// Offset in the stroke's own space, so that a non-uniform transform scales it as AE does.
						const outlines = paths.flatMap((path) => {
							const local = path.map((point) => transformPoint(toStroke, point.x, point.y));
							return strokeConvexPath(local, strokeWidth).map((ring) =>
								ring.map((point) => transformPoint(parentMatrix, point.x, point.y)),
							);
						});
						paints.push({
							paths: outlines,
							color: get(node, 'ADBE Vector Stroke Color', [255, 255, 255, 255]),
							opacity: (opacity * get(node, 'ADBE Vector Stroke Opacity', [100])[0]!) / 100,
						});
						break;
					}
					case 'ADBE Vector Materials Group':
						break;
					default:
						this.gap(comp, layer, `Item de shape "${node.matchName}" não implementado.`);
				}
			}
			return paths;
		};
		visit(layer.shapes!.children, matrix, 1);

		// Items listed first are painted on top.
		for (const fill of paints.reverse()) {
			if (fill.paths.length === 0 || fill.opacity <= 0) continue;
			const coverage = new Float32Array(buffer.width * buffer.height);
			const bounds = rasterizePaths(fill.paths, coverage, buffer.width, buffer.height);
			if (!bounds) continue;
			const [, r = 0, g = 0, b = 0] = fill.color;
			const rgb = [r, g, b];
			for (let y = bounds.y0; y < bounds.y1; y++) {
				for (let i = y * buffer.width + bounds.x0; i < y * buffer.width + bounds.x1; i++) {
					const alpha = coverage[i]! * fill.opacity;
					if (alpha <= 0) continue;
					const o = i * 4;
					const under = (buffer.data[o + 3]! / 255) * (1 - alpha);
					const out = alpha + under;
					for (let k = 0; k < 3; k++) {
						buffer.data[o + k] = Math.round((rgb[k]! * alpha + buffer.data[o + k]! * under) / out);
					}
					buffer.data[o + 3] = Math.round(out * 255);
				}
			}
		}
	}

	private applyMasks(
		buffer: RgbaBuffer,
		comp: AepGraphComposition,
		layer: AepGraphLayer,
		matrix: Affine,
		tSec: number,
	): void {
		// A layer whose masks all have 0% opacity is transparent; only `None` masks leave it whole.
		const clipping = layer.masks.filter((mask) => mask.mode !== 'none');
		if (clipping.length === 0) return;
		const time = this.localTime(layer, tSec);
		const states = clipping.flatMap((mask) => {
			const state = evaluateAnimatedMaskAtTime(mask, time);
			if (!state.visible || !state.closed || state.vertices.length < 2) return [];
			this.masksRasterized++;
			this.verticesRasterized += state.vertices.length;
			this.uniqueMasks.add(`${comp.itemId}:${layer.layerId}:${mask.index}`);
			return [state];
		});
		if (states.length === 0) {
			for (let o = 3; o < buffer.data.length; o += 4) buffer.data[o] = 0;
			return;
		}
		const coverage = rasterizeMaskStack(states, matrix, buffer.width, buffer.height);
		for (let i = 0; i < coverage.length; i++) {
			buffer.data[i * 4 + 3] = Math.round(buffer.data[i * 4 + 3]! * coverage[i]!);
		}
	}

	// --- effects

	private param(space: Omit<EffectSpace, 'padding' | 'width' | 'height' | 'depth'>, effect: AepEffectInstance, id: string): number[] {
		const param = effect.params.find((candidate) => candidate.matchName === `${effect.matchName}-${id}`);
		return param ? this.value(param.property, space.comp, space.layer, space.tSec) : [0];
	}

	/** Room for effects that draw outside the layer's bounds. */
	private effectPadding(comp: AepGraphComposition, layer: AepGraphLayer, tSec: number, scale: number): number {
		if (!layer.effectsActive) return 0;
		const space = { comp, layer, tSec, scale };
		let spread = 0;
		// Distortions in series add up.
		let moved = 0;
		for (const effect of layer.effects) {
			if (!effect.enabled) continue;
			const read = (id: string): number => this.param(space, effect, id)[0]!;
			if (effect.matchName === 'ADBE Drop Shadow') spread = Math.max(spread, read('0005') * 1.2 + Math.abs(read('0004')));
			else if (effect.matchName === 'ADBE Glo2') spread = Math.max(spread, read('0003') * 2);
			else if (effect.matchName === 'ADBE Box Blur2') spread = Math.max(spread, read('0001') * read('0002'));
			else if (effect.matchName === 'ADBE Simple Choker') spread = Math.max(spread, -read('0002'));
			else if (effect.matchName === 'ADBE Turbulent Displace') {
				if (layer.collapseTransform) moved += turbulentDisplaceReach(read('0002'), read('0003'));
			} else if (effect.matchName === 'ADBE Displacement Map') {
				if (layer.collapseTransform || read('0008') > 0) moved += Math.max(Math.abs(read('0003')), Math.abs(read('0005')));
			}
		}
		return Math.min(MAX_EFFECT_PADDING_PX, Math.ceil((spread + moved) * scale));
	}

	/** Returns false when the layer has to be omitted rather than shown without its defining effect. */
	private applyEffects(buffer: RgbaBuffer, space: EffectSpace): boolean {
		const { comp, layer, tSec, scale, padding } = space;
		if (!layer.effectsActive) return true;

		for (const effect of layer.effects) {
			if (!effect.enabled || CONTROL_EFFECT.test(effect.matchName)) continue;
			const read = (id: string): number => this.param(space, effect, id)[0]!;
			const rgb = (id: string): [number, number, number] => {
				const [, r = 0, g = 0, b = 0] = this.param(space, effect, id);
				return [r, g, b];
			};
			const point = (id: string): Vec2 => {
				const [x = 0, y = 0] = this.param(space, effect, id);
				return { x: x * scale + padding, y: y * scale + padding };
			};

			switch (effect.matchName) {
				case 'ADBE Posterize Time':
					continue; // Handled, and counted, when the layer's time is computed.
				case 'ADBE Fill':
					applyEffectFill(buffer, rgb('0002'), read('0005'));
					break;
				case 'ADBE Tint':
					applyEffectTint(buffer, rgb('0001'), rgb('0002'), read('0003') / 100);
					break;
				case 'ADBE Drop Shadow':
					this.approximations.add('Drop Shadow: desfoque por três box blurs, com queda próxima da do After Effects.');
					applyEffectDropShadow(buffer, {
						color: rgb('0001'),
						opacity: read('0002') / 255,
						directionDeg: read('0003'),
						distancePx: read('0004') * scale,
						softnessPx: read('0005') * scale,
						shadowOnly: read('0006') > 0,
					});
					break;
				case 'ADBE Glo2': {
					this.approximations.add('Glow: bloom próprio; cores A e B usam a média, e só Add/atrás são distinguidos.');
					const colourA = rgb('0012');
					const colourB = rgb('0013');
					const tintColor: [number, number, number] = [
						(colourA[0] + colourB[0]) / 2,
						(colourA[1] + colourB[1]) / 2,
						(colourA[2] + colourB[2]) / 2,
					];
					applyEffectGlow(buffer, {
						thresholdPct: (read('0002') / 255) * 100,
						radiusPx: read('0003') * scale,
						intensity: read('0004'),
						composite: read('0006') === 3 ? 'add' : 'behind',
						...(read('0007') === 2 ? { tintColor } : {}),
					});
					break;
				}
				case 'ADBE Box Blur2':
					applyEffectBoxBlur(buffer, read('0001') * scale, read('0002'));
					if (read('0003') > 1) this.effectGap(space, effect, 'Desfoque direcional aplicado nos dois eixos.');
					break;
				case 'ADBE Simple Choker':
					applyEffectSimpleChoker(buffer, read('0002') * scale);
					break;
				case 'ADBE Noise2':
					this.approximations.add('Noise: grão determinístico próprio, com outro padrão de pixels.');
					applyEffectNoise(buffer, read('0001'), read('0002') > 0, Math.round(tSec * comp.fps) + layer.layerId * 100003);
					break;
				case 'ADBE Shift Channels': {
					const from = { alpha: read('0001'), red: read('0002'), green: read('0003'), blue: read('0004') };
					if (applyEffectShiftChannels(buffer, from)) break;
					this.effectGap(space, effect, 'Canal de origem não suportado; efeito ignorado.');
					continue;
				}
				case 'ADBE Geometry2': {
					if (read('0005') !== 0) this.effectGap(space, effect, 'Skew do efeito Transform ignorado.');
					const anchor = this.param(space, effect, '0001');
					const position = this.param(space, effect, '0002');
					const scaleY = read('0003') / 100;
					const source = cloneRgbaBuffer(buffer);
					buffer.data.fill(0);
					compositeLayerTransformed(buffer, source, {
						anchorX: anchor[0]! * scale + padding,
						anchorY: (anchor[1] ?? 0) * scale + padding,
						posX: position[0]! * scale + padding,
						posY: (position[1] ?? 0) * scale + padding,
						scaleX: read('0011') > 0 ? scaleY : read('0004') / 100,
						scaleY,
						rotationDeg: read('0007'),
						opacity: read('0008') / 100,
					});
					break;
				}
				case 'ADBE Set Matte3':
					if (this.applySetMatte(buffer, space, effect)) break;
					continue;
				case 'ADBE CurvesCustom':
					if (effect.curveTables) {
						applyEffectCurves(buffer, effect.curveTables);
						break;
					}
					this.effectGap(space, effect, 'Curvas animadas ou não decodificadas; efeito ignorado.');
					continue;
				case 'ADBE Exposure2': {
					this.approximations.add('Exposure: luz linear com gama 2,2, sem o espaço de trabalho do projeto.');
					const channel = (id: number): ExposureChannel => {
						const at = (n: number): number => read(String(id + n).padStart(4, '0'));
						return { exposure: at(0), offset: at(1), gamma: at(2) };
					};
					const master = channel(3);
					const perChannel = read('0001') === 2;
					applyEffectExposure(
						buffer,
						perChannel ? [channel(8), channel(13), channel(18)] : [master, master, master],
						read('0022') > 0,
					);
					break;
				}
				case 'ADBE Ramp': {
					const blendWithOriginal = read('0007');
					if (blendWithOriginal < 1 && read('0006') > 0) this.effectGap(space, effect, 'Dispersão do Ramp ignorada.');
					applyEffectRamp(buffer, {
						start: point('0001'),
						end: point('0003'),
						startColor: rgb('0002'),
						endColor: rgb('0004'),
						radial: read('0005') === 2,
						blendWithOriginal,
					});
					break;
				}
				case 'ADBE Mosaic': {
					// Blocks finer than the layer's own pixels change nothing, at any render scale.
					const full = layer.sourceSize ?? comp;
					if (read('0001') >= full.width && read('0002') >= full.height) break;
					applyEffectMosaic(buffer, {
						columns: read('0001'),
						rows: read('0002'),
						sharp: read('0003') > 0,
						x: padding,
						y: padding,
						width: space.width,
						height: space.height,
					});
					break;
				}
				case 'CC Radial Blur': {
					const types: Record<number, RadialZoomType> = { 1: 'straight', 2: 'fading', 3: 'centred' };
					const type = types[read('0001')];
					if (!type) {
						this.effectGap(space, effect, 'Tipo rotacional do CC Radial Blur não implementado; efeito ignorado.');
						continue;
					}
					this.approximations.add('CC Radial Blur: zoom por amostragem própria, com queda exponencial no rastro.');
					applyEffectRadialZoom(buffer, {
						centre: point('0004'),
						amount: read('0002'),
						type,
					});
					break;
				}
				case 'ADBE Fractal Noise': {
					if (read('0001') !== 19) {
						this.effectGap(space, effect, 'Tipo de fractal não implementado (só Strings); efeito ignorado.');
						continue;
					}
					if (read('0030') !== 2) {
						this.effectGap(space, effect, 'Mesclagem do Fractal Noise não implementada; efeito ignorado.');
						continue;
					}
					if (read('0019') !== 0 || read('0021') > 0 || read('0025') > 0 || read('0031') > 0) {
						this.effectGap(space, effect, 'Subrotação, subescala centrada, ciclo ou perspectiva do Fractal Noise ignorados.');
					}
					this.approximations.add(
						'Fractal Noise (Strings): ruído próprio com a escala, o contraste e o tempo do projeto; o desenho dos fios difere do After Effects.',
					);
					const uniform = read('0009') > 0;
					applyEffectFractalNoise(buffer, {
						fractal: 'strings',
						invert: read('0003') > 0,
						contrast: read('0004'),
						brightness: read('0005'),
						// A cell is 100 layer pixels at 100% scale.
						cellWidth: read(uniform ? '0010' : '0011') * scale,
						cellHeight: read(uniform ? '0010' : '0012') * scale,
						rotationDeg: read('0008'),
						offset: point('0013'),
						complexity: read('0015'),
						subInfluence: read('0017') / 100,
						subScaling: read('0018') / 100,
						evolutionDeg: read('0023'),
						seed: read('0027'),
						opacity: read('0029') / 100,
					});
					break;
				}
				case 'ADBE Turbulent Displace': {
					const kind = DISPLACE_KINDS[read('0001')];
					if (!kind) {
						this.effectGap(space, effect, 'Tipo de Turbulent Displace não suportado; efeito ignorado.');
						continue;
					}
					const pinning = read('0012');
					const pinAll = pinning === 3 || pinning === 11;
					if (pinning !== 1 && !pinAll) this.effectGap(space, effect, 'Fixação por lado do Turbulent Displace ignorada.');
					if (read('0008') > 0) this.effectGap(space, effect, 'Ciclo de evolução do Turbulent Displace ignorado.');
					this.approximations.add(
						'Turbulent Displace: ruído próprio com amplitude, tamanho e tempo do projeto; o desenho da distorção difere do After Effects.',
					);
					applyEffectTurbulentDisplace(buffer, {
						kind,
						amount: read('0002'),
						size: read('0003'),
						complexity: read('0005'),
						evolutionDeg: read('0006'),
						seed: read('0010'),
						offset: point('0004'),
						scale,
						padding,
						// A collapsed pre-composition is pinned at the composition's bounds, away from its content.
						pinned: pinAll && !(layer.sourceSize && layer.collapseTransform),
					});
					break;
				}
				case 'ADBE Displacement Map':
					if (this.applyDisplacementMap(buffer, space, effect)) break;
					continue;
				default: {
					// These generators replace the layer: without them its raw content would be wrong content.
					const replacesLayer =
						(effect.matchName === 'APC Vegas' && [1, 4].includes(read('0008'))) ||
						(effect.matchName === 'ADBE Scribble Fill' && [2, 3].includes(read('0026')));
					this.effectGap(
						space,
						effect,
						replacesLayer
							? 'Gerador não implementado que substitui a camada; a camada é omitida.'
							: 'Efeito não implementado; a camada aparece sem ele.',
					);
					if (replacesLayer) return false;
					continue;
				}
			}
			this.executed(effect);
		}
		return true;
	}

	private applySetMatte(buffer: RgbaBuffer, space: EffectSpace, effect: AepEffectInstance): boolean {
		const { comp, layer, tSec, scale, padding, width, height, depth } = space;
		const ref = effect.params.find((param) => param.matchName === 'ADBE Set Matte3-0001')?.layerRef;
		const source = !ref || ref === layer.layerId ? layer : comp.layers.find((candidate) => candidate.layerId === ref);
		const channels: Record<number, SetMatteChannel> = { 1: 'red', 2: 'green', 3: 'blue', 4: 'alpha', 5: 'luma' };
		const channel = channels[this.param(space, effect, '0002')[0]!];
		if (!source || !channel) {
			this.effectGap(space, effect, 'Camada ou canal do Set Matte não suportado; efeito ignorado.');
			return false;
		}

		// AE takes the matte from the source's content, stretched to this layer's bounds. A collapsed source, like
		// vector layers, has comp-sized content with its transform already applied.
		const content = this.inputContent(comp, source, tSec, scale, depth);
		const matte = createRgbaBuffer(buffer.width, buffer.height);
		if (content) {
			let toLayer: Affine = [width / content.width, 0, 0, height / content.height, padding, padding];
			if (source.sourceSize && source.collapseTransform) {
				this.approximations.add('Set Matte com origem recolhida: usa o espaço da composição; regra inferida, sem quadro do After Effects para comparar.');
				const compToLayer: Affine = [width / comp.width, 0, 0, height / comp.height, padding, padding];
				const contentToSource = scaling(source.sourceSize.width / content.width, source.sourceSize.height / content.height);
				toLayer = multiply(compToLayer, multiply(this.worldMatrix(comp, source, tSec), contentToSource));
			}
			compositeLayerAffine(matte, content, toLayer);
		}
		applyEffectSetMatte(buffer, matte, channel, this.param(space, effect, '0003')[0]! > 0);
		return true;
	}

	/** What an effect's layer parameter reads: the source, before that layer's own masks and effects. */
	private inputContent(
		comp: AepGraphComposition,
		source: AepGraphLayer,
		tSec: number,
		scale: number,
		depth: number,
	): RgbaBuffer | null {
		if (source.sourceSize) {
			const width = Math.max(1, Math.round(source.sourceSize.width * scale));
			const height = Math.max(1, Math.round(source.sourceSize.height * scale));
			return this.isActive(source, tSec) ? this.sourceContent(comp, source, tSec, scale, width, height, depth + 1) : null;
		}
		const content = createRgbaBuffer(Math.max(1, Math.round(comp.width * scale)), Math.max(1, Math.round(comp.height * scale)));
		const matrix = multiply(scaling(scale, scale), this.worldMatrix(comp, source, tSec));
		this.drawVectorContent(content, comp, source, matrix, tSec);
		return content;
	}

	private applyDisplacementMap(buffer: RgbaBuffer, space: EffectSpace, effect: AepEffectInstance): boolean {
		const { comp, layer, tSec, scale, padding, width, height, depth } = space;
		const read = (id: string): number => this.param(space, effect, id)[0]!;
		const ref = effect.params.find((param) => param.matchName === 'ADBE Displacement Map-0001')?.layerRef;
		const source = !ref || ref === layer.layerId ? layer : comp.layers.find((candidate) => candidate.layerId === ref);
		const horizontal = DISPLACEMENT_CHANNELS[read('0002')];
		const vertical = DISPLACEMENT_CHANNELS[read('0004')];
		const behavior = read('0006');
		if (!source || !horizontal || !vertical || behavior === 3) {
			this.effectGap(space, effect, 'Camada, canal ou mapa repetido do Displacement Map não suportado; efeito ignorado.');
			return false;
		}
		const content = this.inputContent(comp, source, tSec, scale, depth);
		// Without a map at this instant there is nothing to displace by.
		if (!content) return true;
		this.approximations.add(
			'Displacement Map: o mapa fica centralizado na camada; regra inferida para pré-composições recolhidas.',
		);
		const stretched = behavior === 2;
		const mapWidth = stretched ? width : content.width;
		const mapHeight = stretched ? height : content.height;
		const x0 = padding + (width - mapWidth) / 2;
		const y0 = padding + (height - mapHeight) / 2;
		const map = createRgbaBuffer(buffer.width, buffer.height);
		compositeLayerAffine(map, content, [mapWidth / content.width, 0, 0, mapHeight / content.height, x0, y0]);
		applyEffectDisplacementMap(buffer, map, {
			horizontal: { channel: horizontal, max: read('0003') * scale },
			vertical: { channel: vertical, max: read('0005') * scale },
			wrap: read('0007') > 0,
			mapBounds: { x0, y0, x1: x0 + mapWidth, y1: y0 + mapHeight },
		});
		return true;
	}
}

// ---------------------------------------------------------------------------
// Entry points

function openProject(
	mogrtPath: string,
	workDir: string,
	overrides?: MogrtRenderOverrides,
): { inspection: MogrtInspectionResult; graph: AepProjectGraph; renderer: CompositionRenderer } {
	const inspection = inspectMogrtFile(mogrtPath, workDir);
	if (!inspection.aepPath) throw new Error(`MOGRT does not contain an .aep project: ${mogrtPath}`);
	const graph = parseAepProjectGraph(inspection.aepPath, { preferredRootCompName: inspection.name });
	return { inspection, graph, renderer: new CompositionRenderer(graph, resolveOverrides(graph, overrides)) };
}

/** Renders a single frame, with transparency, without invoking FFmpeg for encoding. */
export function renderMogrtFrameRgba(opts: {
	mogrtPath: string;
	workDir: string;
	tSec: number;
	width?: number;
	height?: number;
	overrides?: MogrtRenderOverrides;
}): {
	frame: RgbaBuffer;
	graph: AepProjectGraph;
	inspection: MogrtInspectionResult;
	logoSubstituted: boolean;
	masksRasterized: number;
	effectsExecutedCounts: Record<string, number>;
	unsupportedEffects: MogrtUnsupportedEffect[];
	renderGaps: MogrtRenderGap[];
} {
	const { inspection, graph, renderer } = openProject(opts.mogrtPath, opts.workDir, opts.overrides);
	const frame = renderer.renderFrame(opts.tSec, opts.width ?? 1280, opts.height ?? 720);
	return {
		frame,
		graph,
		inspection,
		logoSubstituted: renderer.logoSubstituted,
		masksRasterized: renderer.masksRasterized,
		effectsExecutedCounts: renderer.effectCounts,
		unsupportedEffects: renderer.unsupportedEffects,
		renderGaps: renderer.gaps,
	};
}

/** Flattens over black, as H.264 has no alpha, and counts the pixels that are not black. */
function flattenOverBlack(frame: RgbaBuffer): number {
	const { data } = frame;
	let lit = 0;
	for (let o = 0; o < data.length; o += 4) {
		const alpha = data[o + 3]!;
		if (alpha !== 255) {
			for (let k = o; k < o + 3; k++) data[k] = Math.round((data[k]! * alpha) / 255);
			data[o + 3] = 255;
		}
		if (data[o]! + data[o + 1]! + data[o + 2]! > LIT_PIXEL_SUM) lit++;
	}
	return lit;
}

/**
 * Renders every frame to MP4 over black and returns an auditable report. The verdict is `failed` when
 * the output is black, has the wrong duration, rasterized none of the template's masks, dropped a
 * requested logo or modified the original file.
 */
export async function renderMogrtPhase3AToMp4(opts: RenderMogrtPhase3AOptions): Promise<MogrtPhase3ARenderReport> {
	const startedAt = Date.now();
	const shaBefore = sha256File(opts.mogrtPath);
	const { inspection, graph, renderer } = openProject(opts.mogrtPath, opts.workDir, opts.overrides);
	const root = graph.compositionsById.get(graph.rootCompId)!;

	const width = opts.width ?? 1280;
	const height = opts.height ?? 720;
	const fps = opts.fps ?? root.fps;
	const durationSec = opts.durationSec ?? root.durationSec;
	if (!(fps > 0) || !(durationSec > 0)) throw new Error('A composição não tem FPS ou duração válidos.');
	const totalFrames = Math.max(1, Math.round(durationSec * fps));

	mkdirSync(dirname(opts.outputMp4Path), { recursive: true });
	const ff = spawn(
		'ffmpeg',
		[
			'-v', 'error', '-y',
			'-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
			'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '18', '-movflags', '+faststart',
			opts.outputMp4Path,
		],
		{ stdio: ['pipe', 'ignore', 'pipe'] },
	);
	let stderr = '';
	ff.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	let spawnError: Error | undefined;
	const closed = new Promise<number>((resolve) => {
		ff.on('error', (error) => {
			spawnError = error;
			resolve(1);
		});
		ff.on('close', (code) => resolve(code ?? 1));
	});
	// A dead encoder surfaces through `closed`; without this the broken pipe would crash the process.
	ff.stdin.on('error', () => undefined);

	const captureTargets = (opts.captureFrames ?? []).map(({ tSec, outputPngPath }) => ({
		frame: Math.max(0, Math.min(totalFrames - 1, Math.round(tSec * fps))),
		outputPngPath,
	}));
	const capturedFramePaths: string[] = [];
	let nonBlackFrames = 0;

	try {
		for (let f = 0; f < totalFrames; f++) {
			const frame = renderer.renderFrame(f / fps, width, height);
			if (flattenOverBlack(frame) > width * height * 0.001) nonBlackFrames++;
			for (const target of captureTargets) {
				if (target.frame !== f) continue;
				writeRgbaBufferToPng(frame, target.outputPngPath);
				capturedFramePaths.push(target.outputPngPath);
			}
			if (ff.exitCode !== null || spawnError) break;
			if (!ff.stdin.write(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength))) {
				await Promise.race([new Promise((resolve) => ff.stdin.once('drain', resolve)), closed]);
			}
		}
	} catch (error) {
		ff.kill();
		throw error;
	}
	ff.stdin.end();

	const exitCode = await closed;
	if (exitCode !== 0) throw new Error(`ffmpeg failed (code ${exitCode}): ${spawnError?.message ?? stderr.slice(-400)}`);

	const shaAfter = sha256File(opts.mogrtPath);
	const logoRequested = Boolean(opts.overrides?.logoPath);
	const coversWholeTemplate = opts.durationSec === undefined;

	const failures: string[] = [];
	if (shaBefore !== shaAfter) failures.push('o .mogrt original mudou durante o render');
	if (nonBlackFrames === 0) failures.push('todos os quadros saíram pretos');
	if (graph.totalMasksExtracted > 0 && renderer.uniqueMasks.size === 0) {
		failures.push('nenhuma máscara do template foi rasterizada');
	}
	if (coversWholeTemplate && Math.abs(durationSec - inspection.durationSec) > 1 / fps) {
		failures.push(`duração ${durationSec.toFixed(3)}s difere do definition.json (${inspection.durationSec}s)`);
	}
	if (logoRequested && coversWholeTemplate && !renderer.logoSubstituted) {
		failures.push('o logo pedido não chegou a nenhuma camada renderizada');
	}

	const missingEssentialLayers = graph.controls.some((control) => control.layer.kind === 'logo_placeholder')
		? []
		: ['Logo Placeholder (não localizado nos controles do .aep)'];

	const unsupportedEffects = renderer.unsupportedEffects;
	const unsupportedExpressions = renderer.unsupportedExpressions;
	const renderGaps = renderer.gaps;
	const approximations = [...renderer.approximations];
	const isComplete =
		[unsupportedEffects, unsupportedExpressions, renderGaps, approximations, graph.warnings, missingEssentialLayers].every(
			(list) => list.length === 0,
		);
	const unsupportedNames = [...new Set(unsupportedEffects.map((effect) => effect.matchName))];

	let completenessVerdict: MogrtPhase3ARenderReport['completenessVerdict'] = 'partial_with_documented_gaps';
	let completenessReason =
		`Reprodução parcial: ${renderer.uniqueMasks.size} de ${graph.totalMasksExtracted} máscaras rasterizadas, ` +
		`${unsupportedEffects.length} ocorrência(s) de efeito com lacuna (${unsupportedNames.join(', ') || 'nenhum'}), ` +
		`${unsupportedExpressions.length} expressão(ões) não avaliada(s), ${renderGaps.length} outra(s) lacuna(s) e ` +
		`${approximations.length} aproximação(ões). Não equivale a um render do After Effects.`;
	if (failures.length > 0) {
		completenessVerdict = 'failed';
		completenessReason = `Reprovado: ${failures.join('; ')}.`;
	} else if (isComplete) {
		completenessVerdict = 'complete';
		completenessReason = 'Nenhuma lacuna ou aproximação detectada; não houve comparação com um render do After Effects.';
	}

	return {
		mogrtPath: opts.mogrtPath,
		originalMogrtSha256Before: shaBefore,
		originalMogrtSha256After: shaAfter,
		originalMogrtUntouched: shaBefore === shaAfter,
		templateName: inspection.name,
		rootCompName: root.name,
		outputMp4Path: opts.outputMp4Path,
		width,
		height,
		fps,
		durationSec: Math.round(durationSec * 1000) / 1000,
		templateDurationSec: inspection.durationSec,
		framesRendered: totalFrames,
		nonBlackFrames,
		renderMs: Date.now() - startedAt,
		logoSubstituted: renderer.logoSubstituted,
		logoSourcePath: opts.overrides?.logoPath ?? null,
		nestedCompsRendered: graph.compositions
			.filter((comp) => renderer.compsTouched.has(comp.itemId))
			.map((comp) => ({
				name: comp.name,
				width: comp.width,
				height: comp.height,
				fps: comp.fps,
				durationSec: comp.durationSec,
				layerCount: comp.layers.length,
				maskCount: comp.totalMasks,
			})),
		masksProvenance: {
			aepTotalMasksExtracted: graph.totalMasksExtracted,
			aepTotalKeyframesExtracted: graph.totalMaskKeyframesExtracted,
			uniqueRealMasksRasterized: renderer.uniqueMasks.size,
			totalMaskRasterizations: renderer.masksRasterized,
			totalVerticesRasterized: renderer.verticesRasterized,
			verifiedFromAepBinary: renderer.uniqueMasks.size > 0,
		},
		effectsExecutedCounts: renderer.effectCounts,
		unsupportedEffectsEncountered: unsupportedEffects,
		renderGaps,
		approximations,
		warnings: graph.warnings,
		expressionsAudit: {
			totalInAep: graph.totalExpressionsFound,
			supportedEvaluations: renderer.supportedExpressionEvaluations,
			unsupportedUnique: unsupportedExpressions,
		},
		missingEssentialLayers,
		failures,
		completenessVerdict,
		completenessReason,
		capturedFramePaths,
	};
}
