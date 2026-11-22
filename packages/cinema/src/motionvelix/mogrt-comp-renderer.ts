/**
 * MotionVelix MOGRT Engine — Phase 3A Nested Composition Graph Renderer & Full MP4 Exporter
 *
 * Renders an entire `.mogrt` / `.aep` project without Adobe:
 * - Recursive nested composition graph (hierarchy, duration, per-comp FPS quantization, layer order)
 * - Keyframed 2D transforms (anchorPoint, position, scale, rotation, opacity) + parent-child inheritance
 * - Real extracted `.aep` Bézier masks (90+ masks, add/subtract/inverted, Hold opacity keyframes)
 * - 7 Phase 3A image effects (Glow, Box Blur, Simple Choker, Noise, Fill, Tint, Set Matte)
 * - Safe AE control-binding expression evaluator (editable colors, text, sliders, checkboxes)
 * - Real `Logo Placeholder` substitution with user-chosen PNG/SVG (and optional `BG Placeholder`)
 * - Zero mutation of original `.mogrt` (verified via before/after SHA-256)
 * - Zero silent procedural fallback for unsupported Adobe proprietary effects
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateAnimatedMaskAtTime } from './aep-mask-extractor.js';
import {
	evaluatePropertyAtTime,
	parseAepProjectGraph,
	type AepAnimatedProperty,
	type AepEffectInstance,
	type AepGraphComposition,
	type AepGraphLayer,
	type AepProjectGraph,
} from './aep-comp-graph.js';
import {
	applyEffectBoxBlur,
	applyEffectFill,
	applyEffectGlow,
	applyEffectNoise,
	applyEffectSetMatte,
	applyEffectSimpleChoker,
	applyEffectTint,
	cloneRgbaBuffer,
	compositeLayerTransformed,
	createRgbaBuffer,
	fillRgbaSolid,
	type RgbaBuffer,
	type SetMatteChannel,
	type Transform2DParams,
} from './mogrt-effects-pipeline.js';
import {
	evaluateAeExpression,
	hexStringToRgba01,
	type ControlOverrideValue,
} from './mogrt-expression-eval.js';
import {
	inspectMogrtFile,
	type MogrtInspectionResult,
} from './mogrt-importer.js';
import { flattenBezierVertices, rasterizePolygonIntoMask } from './mogrt-mask-renderer.js';
import {
	loadLogoImageRgba,
	renderTextLayerRgba,
	sha256File,
	writeRgbaBufferToPng,
} from './mogrt-media-loader.js';

export interface MogrtRenderOverrides {
	/** Path to user-chosen PNG or SVG logo replacing `Logo Placeholder`. */
	logoPath?: string;
	/** Optional path to user-chosen background PNG/JPG/SVG replacing `BG Placeholder`. */
	bgImagePath?: string;
	/** Editable control overrides (colors as `#rrggbb` or `[r,g,b,a]`, text strings, numbers, booleans). */
	controls?: Record<string, ControlOverrideValue>;
	/** Explicit editable text override (applied to `Text` layer / text controls without mutating `.mogrt`). */
	textOverride?: string;
}

export interface RenderMogrtPhase3AOptions {
	mogrtPath: string;
	workDir: string;
	outputMp4Path: string;
	overrides?: MogrtRenderOverrides;
	/** Target render width (default 1280 for fast validation; preserves comp aspect ratio). */
	width?: number;
	/** Target render height (default 720). */
	height?: number;
	/** Override FPS (default: root comp FPS from `.aep` / `definition.json`, e.g. 30). */
	fps?: number;
	/** Override duration in seconds (default: full root comp duration, e.g. 7.267s). */
	durationSec?: number;
	/** Optional timestamps (in seconds) to capture PNG frames during the render pass. */
	captureFrames?: Array<{ tSec: number; outputPngPath: string }>;
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
	framesRendered: number;
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
	unsupportedEffectsEncountered: Array<{
		compName: string;
		layerName: string;
		matchName: string;
		displayName: string;
		reason: string;
	}>;
	expressionsAudit: {
		totalInAep: number;
		supportedEvaluations: number;
		unsupportedUnique: Array<{ compName: string; layerName: string; expression: string; reason: string }>;
	};
	missingEssentialLayers: string[];
	completenessVerdict: 'complete' | 'partial_with_documented_gaps';
	completenessReason: string;
	capturedFramePaths: string[];
}

interface RenderSessionState {
	graph: AepProjectGraph;
	inspection: MogrtInspectionResult;
	controlOverrides: Record<string, ControlOverrideValue>;
	textOverride?: string;
	logoPath?: string;
	bgImagePath?: string;
	logoCache: Map<string, RgbaBuffer>;
	textCache: Map<string, RgbaBuffer>;
	precompCache: Map<string, RgbaBuffer>;
	logoSubstituted: boolean;
	compsTouched: Set<string>;
	uniqueRealMasksRasterized: Set<string>;
	totalMaskRasterizations: number;
	totalVerticesRasterized: number;
	effectsExecutedCounts: Record<string, number>;
	unsupportedEffectsMap: Map<string, { compName: string; layerName: string; matchName: string; displayName: string; reason: string }>;
	expressionAudit: {
		supportedEvaluated: number;
		unsupported: Array<{ compName: string; layerName: string; expression: string; reason: string }>;
	};
}

function buildEffectiveControlOverrides(
	inspection: MogrtInspectionResult,
	userOverrides?: Record<string, ControlOverrideValue>,
): Record<string, ControlOverrideValue> {
	const merged: Record<string, ControlOverrideValue> = {};
	// 1. Seed defaults from definition.json so controls resolve even if AE cdat differs
	for (const ctrl of inspection.controls) {
		if (ctrl.kind === 'color' && ctrl.defaultValue && typeof ctrl.defaultValue === 'object') {
			const cObj = ctrl.defaultValue as { rgba?: number[]; hex?: string };
			if (Array.isArray(cObj.rgba) && cObj.rgba.length >= 3) {
				merged[ctrl.name] = cObj.rgba;
			} else if (cObj.hex) {
				merged[ctrl.name] = cObj.hex;
			}
		} else if (ctrl.kind === 'text' && typeof ctrl.defaultValue === 'string') {
			merged[ctrl.name] = ctrl.defaultValue;
		} else if (
			(ctrl.kind === 'number' || ctrl.kind === 'angle' || ctrl.kind === 'scale') &&
			typeof ctrl.defaultValue === 'number'
		) {
			merged[ctrl.name] = ctrl.defaultValue;
		} else if (ctrl.kind === 'boolean') {
			merged[ctrl.name] = Boolean(ctrl.defaultValue);
		} else if (ctrl.kind === 'point' && Array.isArray(ctrl.defaultValue)) {
			merged[ctrl.name] = ctrl.defaultValue.map(Number);
		}
	}
	// 2. Apply user overrides on top
	if (userOverrides) {
		for (const [k, v] of Object.entries(userOverrides)) {
			merged[k] = v;
		}
	}
	return merged;
}

function resolvePropertyNumeric(
	prop: AepAnimatedProperty,
	tSec: number,
	comp: AepGraphComposition,
	layer: AepGraphLayer,
	session: RenderSessionState,
): number[] {
	const base = evaluatePropertyAtTime(prop, tSec);
	if (!prop.expression) return base;
	const res = evaluateAeExpression(prop.expression, {
		tSec,
		currentComp: comp,
		currentLayerName: layer.name,
		compositionsByName: session.graph.compositionsByName,
		controlOverrides: session.controlOverrides,
		baseValue: base,
		audit: session.expressionAudit,
	});
	if (res.supported && Array.isArray(res.value)) return res.value;
	return base;
}

function rgb01ToBytes(val: number[], fallback: [number, number, number] = [255, 255, 255]): [number, number, number] {
	if (val.length < 3) return fallback;
	const scale = val.some((v) => v > 1.001) ? 1 : 255;
	return [
		Math.max(0, Math.min(255, Math.round((val[0] ?? 1) * scale))),
		Math.max(0, Math.min(255, Math.round((val[1] ?? 1) * scale))),
		Math.max(0, Math.min(255, Math.round((val[2] ?? 1) * scale))),
	];
}

function getParam(fx: AepEffectInstance, matchSuffixOrName: string[]): AepAnimatedProperty | undefined {
	for (const key of matchSuffixOrName) {
		const lower = key.toLowerCase();
		const hit = fx.params.find(
			(p) => p.matchName.toLowerCase() === lower || p.name.toLowerCase() === lower,
		);
		if (hit) return hit.property;
	}
	return undefined;
}

function resolveLayerTransform(
	comp: AepGraphComposition,
	layer: AepGraphLayer,
	tSec: number,
	session: RenderSessionState,
	renderScaleX: number,
	renderScaleY: number,
	srcWidth: number,
	srcHeight: number,
	depth = 0,
): Transform2DParams {
	const anchorRaw = resolvePropertyNumeric(layer.transform.anchorPoint, tSec, comp, layer, session);
	const posRaw = resolvePropertyNumeric(layer.transform.position, tSec, comp, layer, session);
	const posX = layer.transform.positionX
		? (resolvePropertyNumeric(layer.transform.positionX, tSec, comp, layer, session)[0] ?? posRaw[0] ?? comp.width / 2)
		: (posRaw[0] ?? comp.width / 2);
	const posY = layer.transform.positionY
		? (resolvePropertyNumeric(layer.transform.positionY, tSec, comp, layer, session)[0] ?? posRaw[1] ?? comp.height / 2)
		: (posRaw[1] ?? comp.height / 2);
	const scaleRaw = resolvePropertyNumeric(layer.transform.scale, tSec, comp, layer, session);
	const rotRaw = resolvePropertyNumeric(layer.transform.rotation, tSec, comp, layer, session);
	const opRaw = resolvePropertyNumeric(layer.transform.opacity, tSec, comp, layer, session);

	// Anchor point is in source layer coordinates; scale to srcBuffer coordinates
	const srcBaseW = layer.solid?.width ?? (layer.kind === 'precomp' ? (session.graph.compositionsById.get(layer.sourceId)?.width ?? comp.width) : comp.width);
	const srcBaseH = layer.solid?.height ?? (layer.kind === 'precomp' ? (session.graph.compositionsById.get(layer.sourceId)?.height ?? comp.height) : comp.height);
	const anchorScaleX = srcWidth / Math.max(1, srcBaseW);
	const anchorScaleY = srcHeight / Math.max(1, srcBaseH);

	let tx: Transform2DParams = {
		anchorX: (anchorRaw[0] ?? srcBaseW / 2) * anchorScaleX,
		anchorY: (anchorRaw[1] ?? srcBaseH / 2) * anchorScaleY,
		posX: posX * renderScaleX,
		posY: posY * renderScaleY,
		scaleX: ((scaleRaw[0] ?? 100) / 100) * (renderScaleX / Math.max(1e-6, anchorScaleX)),
		scaleY: ((scaleRaw[1] ?? scaleRaw[0] ?? 100) / 100) * (renderScaleY / Math.max(1e-6, anchorScaleY)),
		rotationDeg: rotRaw[0] ?? 0,
		opacity: Math.max(0, Math.min(1, (opRaw[0] ?? 100) / 100)),
	};

	// Compose with parent layer transform if parentLayerId > 0
	if (layer.parentLayerId > 0 && depth < 8) {
		const parent = comp.layers.find((l) => l.layerId === layer.parentLayerId);
		if (parent && parent.layerId !== layer.layerId) {
			const pAnchor = resolvePropertyNumeric(parent.transform.anchorPoint, tSec, comp, parent, session);
			const pPos = resolvePropertyNumeric(parent.transform.position, tSec, comp, parent, session);
			const pScale = resolvePropertyNumeric(parent.transform.scale, tSec, comp, parent, session);
			const pRot = resolvePropertyNumeric(parent.transform.rotation, tSec, comp, parent, session);
			const psx = (pScale[0] ?? 100) / 100;
			const psy = (pScale[1] ?? pScale[0] ?? 100) / 100;
			const pRad = ((pRot[0] ?? 0) * Math.PI) / 180;
			const dx = (posX - (pAnchor[0] ?? comp.width / 2)) * psx;
			const dy = (posY - (pAnchor[1] ?? comp.height / 2)) * psy;
			const rx = dx * Math.cos(pRad) - dy * Math.sin(pRad) + (pPos[0] ?? comp.width / 2);
			const ry = dx * Math.sin(pRad) + dy * Math.cos(pRad) + (pPos[1] ?? comp.height / 2);
			tx = {
				...tx,
				posX: rx * renderScaleX,
				posY: ry * renderScaleY,
				scaleX: tx.scaleX * psx,
				scaleY: tx.scaleY * psy,
				rotationDeg: tx.rotationDeg + (pRot[0] ?? 0),
			};
		}
	}

	return tx;
}

function applyLayerMasksToBuffer(
	buf: RgbaBuffer,
	comp: AepGraphComposition,
	layer: AepGraphLayer,
	tSec: number,
	session: RenderSessionState,
): void {
	if (layer.masks.length === 0) return;
	const { width, height, data } = buf;
	const scaleX = width / Math.max(1, comp.width);
	const scaleY = height / Math.max(1, comp.height);
	const maskAlpha = new Float32Array(width * height);
	let anyEvaluated = false;

	for (const mask of layer.masks) {
		const st = evaluateAnimatedMaskAtTime(mask, tSec);
		if (!st.visible || st.vertices.length < 3) continue;
		anyEvaluated = true;
		session.uniqueRealMasksRasterized.add(`${comp.name}:${layer.index}:${mask.name}`);
		session.totalMaskRasterizations++;
		session.totalVerticesRasterized += st.vertices.length;

		const poly = flattenBezierVertices(st.vertices, scaleX, scaleY, 8);
		const op: 'add' | 'subtract' = st.mode === 'subtract' ? 'subtract' : 'add';
		if (st.inverted) {
			const invBuf = new Float32Array(width * height);
			rasterizePolygonIntoMask(poly, invBuf, width, height, st.opacity, 'add');
			for (let i = 0; i < maskAlpha.length; i++) {
				const v = 1 - invBuf[i]!;
				if (op === 'add') maskAlpha[i] = Math.max(maskAlpha[i]!, v);
				else maskAlpha[i] = maskAlpha[i]! * (1 - v);
			}
		} else {
			rasterizePolygonIntoMask(poly, maskAlpha, width, height, st.opacity, op);
		}
	}

	if (!anyEvaluated) {
		// Masks exist on the layer, none visible at tSec -> fully masked out
		for (let i = 3; i < data.length; i += 4) data[i] = 0;
		return;
	}

	for (let i = 0; i < width * height; i++) {
		data[i * 4 + 3] = Math.round(data[i * 4 + 3]! * maskAlpha[i]!);
	}
}

function applyLayerEffectsStack(
	buf: RgbaBuffer,
	comp: AepGraphComposition,
	layer: AepGraphLayer,
	tSec: number,
	frameIndex: number,
	renderScale: number,
	session: RenderSessionState,
	resolveLayerMatte: (targetIndex0Based: number) => RgbaBuffer | undefined,
): void {
	for (const fx of layer.effects) {
		if (!fx.enabled) continue;
		const mn = fx.matchName;

		// Control effects hold parameters only; no image mutation
		if (
			mn === 'ADBE Color Control' ||
			mn === 'ADBE Slider Control' ||
			mn === 'ADBE Checkbox Control' ||
			mn === 'ADBE Point Control' ||
			mn === 'ADBE Angle Control' ||
			mn === 'ADBE Layer Control'
		) {
			continue;
		}

		if (!fx.supportedInPhase3A) {
			// STRICT HONESTY RULE: Never silently replace unsupported Adobe effects with procedural effects!
			const key = `${comp.name}::${layer.name}::${mn}`;
			if (!session.unsupportedEffectsMap.has(key)) {
				session.unsupportedEffectsMap.set(key, {
					compName: comp.name,
					layerName: layer.name,
					matchName: mn,
					displayName: fx.displayName,
					reason: 'Efeito proprietário/não suportado na Fase 3A — camada mantida sem substituição procedural silenciosa.',
				});
			}
			continue;
		}

		session.effectsExecutedCounts[mn] = (session.effectsExecutedCounts[mn] ?? 0) + 1;

		if (mn === 'ADBE Fill') {
			const colorProp = getParam(fx, ['ADBE Fill-0002', 'Color']);
			const opProp = getParam(fx, ['ADBE Fill-0007', 'Opacity']);
			const color = colorProp
				? rgb01ToBytes(resolvePropertyNumeric(colorProp, tSec, comp, layer, session))
				: ([255, 255, 255] as [number, number, number]);
			const opVal = opProp ? (resolvePropertyNumeric(opProp, tSec, comp, layer, session)[0] ?? 1) : 1;
			const opacity = opVal > 1.01 ? opVal / 100 : opVal;
			applyEffectFill(buf, color, opacity);
		} else if (mn === 'ADBE Tint') {
			const blackProp = getParam(fx, ['ADBE Tint-0001', 'Map Black To']);
			const whiteProp = getParam(fx, ['ADBE Tint-0002', 'Map White To']);
			const amtProp = getParam(fx, ['ADBE Tint-0003', 'Amount to Tint']);
			const black = blackProp
				? rgb01ToBytes(resolvePropertyNumeric(blackProp, tSec, comp, layer, session), [0, 0, 0])
				: ([0, 0, 0] as [number, number, number]);
			const white = whiteProp
				? rgb01ToBytes(resolvePropertyNumeric(whiteProp, tSec, comp, layer, session), [255, 255, 255])
				: ([255, 255, 255] as [number, number, number]);
			const amtRaw = amtProp ? (resolvePropertyNumeric(amtProp, tSec, comp, layer, session)[0] ?? 100) : 100;
			const amount = amtRaw > 1.01 ? amtRaw / 100 : amtRaw;
			applyEffectTint(buf, black, white, amount);
		} else if (mn === 'ADBE Box Blur2' || mn === 'ADBE Gaussian Blur 2') {
			const radProp = getParam(fx, ['ADBE Box Blur2-0001', 'ADBE Gaussian Blur 2-0001', 'Blur Radius', 'Blurriness']);
			const iterProp = getParam(fx, ['ADBE Box Blur2-0002', 'Iterations']);
			const radius = (radProp ? (resolvePropertyNumeric(radProp, tSec, comp, layer, session)[0] ?? 6) : 6) * renderScale;
			const iterations = iterProp ? (resolvePropertyNumeric(iterProp, tSec, comp, layer, session)[0] ?? 2) : 2;
			applyEffectBoxBlur(buf, radius, iterations);
		} else if (mn === 'ADBE Glo2') {
			const threshProp = getParam(fx, ['ADBE Glo2-0002', 'Glow Threshold']);
			const radProp = getParam(fx, ['ADBE Glo2-0003', 'Glow Radius']);
			const intProp = getParam(fx, ['ADBE Glo2-0004', 'Glow Intensity']);
			const colorAProp = getParam(fx, ['ADBE Glo2-0007', 'Color A']);
			const thresholdPct = threshProp ? (resolvePropertyNumeric(threshProp, tSec, comp, layer, session)[0] ?? 45) : 45;
			const radiusPx = Math.max(2, (radProp ? (resolvePropertyNumeric(radProp, tSec, comp, layer, session)[0] ?? 24) : 24) * renderScale);
			const intensity = intProp ? (resolvePropertyNumeric(intProp, tSec, comp, layer, session)[0] ?? 1.1) : 1.1;
			const tintColor = colorAProp
				? rgb01ToBytes(resolvePropertyNumeric(colorAProp, tSec, comp, layer, session))
				: undefined;
			applyEffectGlow(buf, { thresholdPct, radiusPx, intensity, tintColor });
		} else if (mn === 'ADBE Simple Choker') {
			const chokeProp = getParam(fx, ['ADBE Simple Choker-0001', 'Choke Matte']);
			const choke = (chokeProp ? (resolvePropertyNumeric(chokeProp, tSec, comp, layer, session)[0] ?? 0) : 0) * renderScale;
			applyEffectSimpleChoker(buf, choke);
		} else if (mn === 'ADBE Noise2') {
			const amtProp = getParam(fx, ['ADBE Noise2-0001', 'Amount of Noise']);
			const colorNoiseProp = getParam(fx, ['ADBE Noise2-0002', 'Use Color Noise']);
			const amountPct = amtProp ? (resolvePropertyNumeric(amtProp, tSec, comp, layer, session)[0] ?? 6) : 6;
			const useColor = colorNoiseProp ? (resolvePropertyNumeric(colorNoiseProp, tSec, comp, layer, session)[0] ?? 0) > 0.5 : false;
			applyEffectNoise(buf, amountPct, useColor, frameIndex);
		} else if (mn === 'ADBE Set Matte3') {
			const layerIdxProp = getParam(fx, ['ADBE Set Matte3-0001', 'Take Matte From Layer']);
			const chanProp = getParam(fx, ['ADBE Set Matte3-0002', 'Use For Matte']);
			const invProp = getParam(fx, ['ADBE Set Matte3-0003', 'Invert Matte']);
			const target1Based = Math.round(
				layerIdxProp ? (resolvePropertyNumeric(layerIdxProp, tSec, comp, layer, session)[0] ?? 0) : 0,
			);
			const matteBuf = target1Based > 0 ? resolveLayerMatte(target1Based - 1) : undefined;
			if (matteBuf) {
				const chanCode = Math.round(chanProp ? (resolvePropertyNumeric(chanProp, tSec, comp, layer, session)[0] ?? 4) : 4);
				const channel: SetMatteChannel =
					chanCode === 1 ? 'red' : chanCode === 2 ? 'green' : chanCode === 3 ? 'blue' : chanCode === 5 ? 'luma' : 'alpha';
				const invert = invProp ? (resolvePropertyNumeric(invProp, tSec, comp, layer, session)[0] ?? 0) > 0.5 : false;
				applyEffectSetMatte(buf, matteBuf, channel, invert);
			}
		}
	}
}

function compUsesFrameDependentNoise(comp: AepGraphComposition): boolean {
	return comp.layers.some((l) => l.effects.some((fx) => fx.enabled && fx.matchName === 'ADBE Noise2'));
}

function renderCompositionFrame(
	comp: AepGraphComposition,
	tSec: number,
	targetWidth: number,
	targetHeight: number,
	frameIndex: number,
	session: RenderSessionState,
	depth = 0,
): RgbaBuffer {
	session.compsTouched.add(comp.name);
	const out = createRgbaBuffer(targetWidth, targetHeight);
	if (depth > 8) return out;

	// Quantize time to this composition's native FPS (preserves 15 fps "on twos" inside Transition 01!)
	const compFps = comp.fps > 0 ? comp.fps : 30;
	const localTimeSec = Math.floor(tSec * compFps + 1e-6) / compFps;

	// Memoize deterministic nested precomp frames (huge speedup for 15fps bursts like Transition 01)
	const canMemoize = depth > 0 && !compUsesFrameDependentNoise(comp);
	const precompCacheKey = `${comp.itemId}:${Math.round(localTimeSec * 10000)}:${targetWidth}x${targetHeight}`;
	if (canMemoize) {
		const cached = session.precompCache.get(precompCacheKey);
		if (cached) {
			return cloneRgbaBuffer(cached);
		}
	}

	// Root comp gets opaque background; nested precomps stay transparent unless they contain a BG solid
	if (depth === 0) {
		fillRgbaSolid(out, comp.bgColor[0], comp.bgColor[1], comp.bgColor[2], 255);
	}

	const renderScaleX = targetWidth / Math.max(1, comp.width);
	const renderScaleY = targetHeight / Math.max(1, comp.height);
	const renderScale = Math.min(renderScaleX, renderScaleY);

	// Track which layers are consumed as track mattes by the layer immediately below them
	const consumedAsTrackMatte = new Set<number>();
	for (let i = 1; i < comp.layers.length; i++) {
		if (comp.layers[i]!.trackMatte !== 'none') {
			consumedAsTrackMatte.add(i - 1);
		}
	}

	// Render individual layer buffers (needed for Track Mattes & Set Matte cross-layer references)
	const layerBuffers = new Map<number, RgbaBuffer>();
	const resolvingLayers = new Set<number>();

	const resolveLayerMatte = (targetIdx0: number): RgbaBuffer | undefined => {
		if (targetIdx0 < 0 || targetIdx0 >= comp.layers.length) return undefined;
		const existing = layerBuffers.get(targetIdx0);
		if (existing) return existing;
		if (resolvingLayers.has(targetIdx0)) return undefined;
		resolvingLayers.add(targetIdx0);
		try {
			const targetLayer = comp.layers[targetIdx0]!;
			const produced = produceLayerBuffer(targetLayer);
			if (!produced) return undefined;
			const matteInComp = createRgbaBuffer(targetWidth, targetHeight);
			const mTx = resolveLayerTransform(
				comp,
				targetLayer,
				localTimeSec,
				session,
				renderScaleX,
				renderScaleY,
				produced.width,
				produced.height,
			);
			compositeLayerTransformed(matteInComp, produced, mTx, 'normal');
			layerBuffers.set(targetIdx0, matteInComp);
			return matteInComp;
		} finally {
			resolvingLayers.delete(targetIdx0);
		}
	};

	const produceLayerBuffer = (layer: AepGraphLayer): RgbaBuffer | null => {
		if (localTimeSec < layer.inPointSec - 1e-4 || localTimeSec > layer.outPointSec + 1e-4) {
			return null;
		}
		if (layer.kind === 'null') return null;

		let layerBuf: RgbaBuffer | null = null;

		if (layer.kind === 'precomp') {
			const childComp = session.graph.compositionsById.get(layer.sourceId);
			if (!childComp) return null;
			const childW = Math.max(1, Math.round(childComp.width * renderScaleX));
			const childH = Math.max(1, Math.round(childComp.height * renderScaleY));
			const stretch = Math.abs(layer.stretch) > 1e-4 ? layer.stretch : 1;
			const childTime = (localTimeSec - layer.startTimeSec) / stretch;
			if (childTime < -1e-4 || childTime > childComp.durationSec + 1e-4) return null;
			layerBuf = renderCompositionFrame(
				childComp,
				Math.max(0, childTime),
				childW,
				childH,
				frameIndex,
				session,
				depth + 1,
			);
		} else if (layer.kind === 'logo_placeholder') {
			const phW = Math.max(64, Math.round((layer.solid?.width ?? 500) * renderScaleX));
			const phH = Math.max(64, Math.round((layer.solid?.height ?? 500) * renderScaleY));
			const needsHaloHeadroom = layer.effects.some(
				(fx) => fx.enabled && (fx.matchName === 'ADBE Glo2' || fx.matchName === 'ADBE Box Blur2' || fx.matchName === 'ADBE Gaussian Blur 2'),
			);
			if (session.logoPath) {
				const cacheKey = `${session.logoPath}:${phW}x${phH}:${needsHaloHeadroom ? 'pad' : 'fit'}`;
				let cached = session.logoCache.get(cacheKey);
				if (!cached) {
					if (needsHaloHeadroom) {
						const innerW = Math.max(32, Math.round(phW * 0.8));
						const innerH = Math.max(32, Math.round(phH * 0.8));
						const inner = loadLogoImageRgba(session.logoPath, innerW, innerH);
						const padded = createRgbaBuffer(phW, phH);
						const offX = Math.floor((phW - innerW) / 2);
						const offY = Math.floor((phH - innerH) / 2);
						for (let y = 0; y < innerH; y++) {
							const srcStart = y * innerW * 4;
							const dstStart = ((offY + y) * phW + offX) * 4;
							padded.data.set(inner.data.subarray(srcStart, srcStart + innerW * 4), dstStart);
						}
						cached = padded;
					} else {
						cached = loadLogoImageRgba(session.logoPath, phW, phH);
					}
					session.logoCache.set(cacheKey, cached);
				}
				session.logoSubstituted = true;
				layerBuf = cloneRgbaBuffer(cached);
			} else {
				// No user logo supplied -> render clean neutral placeholder square
				layerBuf = createRgbaBuffer(phW, phH);
				fillRgbaSolid(layerBuf, 220, 220, 225, 255);
			}
		} else if (layer.kind === 'bg_placeholder') {
			if (session.bgImagePath) {
				const cacheKey = `bg:${session.bgImagePath}:${targetWidth}x${targetHeight}`;
				let cached = session.logoCache.get(cacheKey);
				if (!cached) {
					cached = loadLogoImageRgba(session.bgImagePath, targetWidth, targetHeight);
					session.logoCache.set(cacheKey, cached);
				}
				layerBuf = cloneRgbaBuffer(cached);
			} else {
				layerBuf = createRgbaBuffer(targetWidth, targetHeight);
				// Check for BG Color override
				const bgOverride =
					session.controlOverrides['BG Color'] ??
					session.controlOverrides['Background Color'] ??
					session.controlOverrides['BG Color 1'];
				let rgb: [number, number, number] = [10, 10, 16];
				if (typeof bgOverride === 'string') {
					const parsed = hexStringToRgba01(bgOverride);
					if (parsed) rgb = rgb01ToBytes(parsed, rgb);
				} else if (Array.isArray(bgOverride)) {
					rgb = rgb01ToBytes(bgOverride, rgb);
				}
				fillRgbaSolid(layerBuf, rgb[0], rgb[1], rgb[2], 255);
			}
		} else if (layer.kind === 'text' && layer.textDoc) {
			let textStr = session.textOverride ?? layer.textDoc.text;
			if (!session.textOverride && layer.textDoc.expression) {
				const evalRes = evaluateAeExpression(layer.textDoc.expression, {
					tSec: localTimeSec,
					currentComp: comp,
					currentLayerName: layer.name,
					compositionsByName: session.graph.compositionsByName,
					controlOverrides: session.controlOverrides,
					baseValue: textStr,
					audit: session.expressionAudit,
				});
				if (evalRes.supported && typeof evalRes.value === 'string') {
					textStr = evalRes.value;
				}
			} else if (!session.textOverride && typeof session.controlOverrides['Text'] === 'string') {
				textStr = session.controlOverrides['Text'];
			}

			let colorRgba01 = layer.textDoc.fillColor;
			const textColorOverride =
				session.controlOverrides['Text Color'] ?? session.controlOverrides['Title Color'];
			if (typeof textColorOverride === 'string') {
				const parsed = hexStringToRgba01(textColorOverride);
				if (parsed) colorRgba01 = parsed;
			} else if (Array.isArray(textColorOverride) && textColorOverride.length >= 3) {
				colorRgba01 = [
					textColorOverride[0] ?? 1,
					textColorOverride[1] ?? 1,
					textColorOverride[2] ?? 1,
					textColorOverride[3] ?? 1,
				];
			}

			const fontSizePx = Math.max(14, Math.round(layer.textDoc.fontSize * renderScale));
			const cacheKey = `${textStr}|${targetWidth}x${targetHeight}|${fontSizePx}|${colorRgba01.join(',')}|${layer.textDoc.allCaps ? 1 : 0}`;
			let cached = session.textCache.get(cacheKey);
			if (!cached) {
				cached = renderTextLayerRgba({
					text: textStr,
					width: targetWidth,
					height: targetHeight,
					fontSize: fontSizePx,
					colorRgba01,
					fontName: layer.textDoc.fontName,
					allCaps: layer.textDoc.allCaps,
				});
				session.textCache.set(cacheKey, cached);
			}
			layerBuf = cloneRgbaBuffer(cached);
		} else if (layer.kind === 'solid') {
			const sw = Math.max(1, Math.round((layer.solid?.width ?? comp.width) * renderScaleX));
			const sh = Math.max(1, Math.round((layer.solid?.height ?? comp.height) * renderScaleY));
			const sc = layer.solid?.color ?? [255, 255, 255];
			layerBuf = createRgbaBuffer(sw, sh);
			fillRgbaSolid(layerBuf, sc[0], sc[1], sc[2], 255);
		} else {
			return null;
		}

		// Apply real extracted `.aep` Bézier masks before effects (matches AE render pipeline order)
		if (layer.masks.length > 0) {
			applyLayerMasksToBuffer(layerBuf, comp, layer, localTimeSec, session);
		}

		// Apply layer effect stack (Glow, Blur, Choker, Noise, Fill, Tint, Set Matte)
		if (layer.effects.length > 0) {
			applyLayerEffectsStack(
				layerBuf,
				comp,
				layer,
				localTimeSec,
				frameIndex,
				renderScale,
				session,
				resolveLayerMatte,
			);
		}

		return layerBuf;
	};

	// Composite bottom-to-top (AE index N-1 is bottommost, index 0 is topmost)
	for (let i = comp.layers.length - 1; i >= 0; i--) {
		const layer = comp.layers[i]!;

		// Adjustment layer: applies its effects directly to the composited buffer accumulated below it
		if (layer.kind === 'adjustment') {
			if (!layer.enabled) continue;
			if (localTimeSec < layer.inPointSec - 1e-4 || localTimeSec > layer.outPointSec + 1e-4) continue;
			applyLayerEffectsStack(out, comp, layer, localTimeSec, frameIndex, renderScale, session, resolveLayerMatte);
			continue;
		}

		// Pre-render matte source layers even if their eyeball is turned off (AE track matte semantics)
		const isTrackMatteSource = consumedAsTrackMatte.has(i);
		if (!layer.enabled && !isTrackMatteSource) continue;

		const buf = produceLayerBuffer(layer);
		if (!buf) continue;
		layerBuffers.set(i, buf);

		if (isTrackMatteSource) {
			// Held in layerBuffers to serve as track matte for layer i+1
			continue;
		}

		const tx = resolveLayerTransform(
			comp,
			layer,
			localTimeSec,
			session,
			renderScaleX,
			renderScaleY,
			buf.width,
			buf.height,
		);

		let trackMatteArg: { buffer: RgbaBuffer; type: AepGraphLayer['trackMatte'] } | undefined;
		if (layer.trackMatte !== 'none' && i > 0) {
			// Ensure matte layer (i - 1) was produced if it wasn't yet (since loop runs bottom-to-top, i-1 is above i!)
			let matteRaw = layerBuffers.get(i - 1);
			if (!matteRaw) {
				const matteLayer = comp.layers[i - 1]!;
				const produced = produceLayerBuffer(matteLayer);
				if (produced) {
					// Transform matte layer into comp space
					const matteInComp = createRgbaBuffer(targetWidth, targetHeight);
					const mTx = resolveLayerTransform(
						comp,
						matteLayer,
						localTimeSec,
						session,
						renderScaleX,
						renderScaleY,
						produced.width,
						produced.height,
					);
					compositeLayerTransformed(matteInComp, produced, mTx, 'normal');
					layerBuffers.set(i - 1, matteInComp);
					matteRaw = matteInComp;
				}
			}
			if (matteRaw) {
				trackMatteArg = { buffer: matteRaw, type: layer.trackMatte };
			}
		}

		compositeLayerTransformed(out, buf, tx, layer.blendMode, trackMatteArg);
	}

	if (canMemoize && session.precompCache.size < 160) {
		session.precompCache.set(precompCacheKey, cloneRgbaBuffer(out));
	}

	return out;
}

/**
 * Renders a single frame of a `.mogrt` project at `tSec` without invoking FFmpeg (fast unit-testable entry point).
 */
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
	unsupportedEffects: Array<{ compName: string; layerName: string; matchName: string; displayName: string; reason: string }>;
} {
	const inspection = inspectMogrtFile(opts.mogrtPath, opts.workDir);
	if (!inspection.aepPath) {
		throw new Error(`No .aep project found inside MOGRT: ${opts.mogrtPath}`);
	}
	const graph = parseAepProjectGraph(inspection.aepPath, {
		preferredRootCompName: inspection.name,
	});
	const rootComp = graph.compositionsById.get(graph.rootCompId) ?? graph.compositions[0]!;
	const width = opts.width ?? 1280;
	const height = opts.height ?? 720;

	const session: RenderSessionState = {
		graph,
		inspection,
		controlOverrides: buildEffectiveControlOverrides(inspection, opts.overrides?.controls),
		textOverride: opts.overrides?.textOverride,
		logoPath: opts.overrides?.logoPath,
		bgImagePath: opts.overrides?.bgImagePath,
		logoCache: new Map(),
		textCache: new Map(),
		precompCache: new Map(),
		logoSubstituted: false,
		compsTouched: new Set(),
		uniqueRealMasksRasterized: new Set(),
		totalMaskRasterizations: 0,
		totalVerticesRasterized: 0,
		effectsExecutedCounts: {},
		unsupportedEffectsMap: new Map(),
		expressionAudit: { supportedEvaluated: 0, unsupported: [] },
	};

	const frameIdx = Math.max(0, Math.round(opts.tSec * (rootComp.fps || 30)));
	const frame = renderCompositionFrame(rootComp, opts.tSec, width, height, frameIdx, session, 0);

	return {
		frame,
		graph,
		inspection,
		logoSubstituted: session.logoSubstituted,
		masksRasterized: session.totalMaskRasterizations,
		effectsExecutedCounts: session.effectsExecutedCounts,
		unsupportedEffects: [...session.unsupportedEffectsMap.values()],
	};
}

/**
 * Full Phase 3A Pipeline: inspects an isolated copy of `.mogrt`, parses the nested `.aep`
 * composition graph, applies Logo/Color/Text overrides without touching the original `.mogrt`,
 * renders all frames (e.g. full 7.27s @ 30fps = 218 frames) into MP4 via FFmpeg, and returns
 * a complete auditable compatibility & provenance report.
 */
export async function renderMogrtPhase3AToMp4(
	opts: RenderMogrtPhase3AOptions,
): Promise<MogrtPhase3ARenderReport> {
	const t0 = Date.now();
	const shaBefore = sha256File(opts.mogrtPath);

	const inspection = inspectMogrtFile(opts.mogrtPath, opts.workDir);
	if (!inspection.aepPath) {
		throw new Error(`MOGRT does not contain an .aep project: ${opts.mogrtPath}`);
	}

	const graph = parseAepProjectGraph(inspection.aepPath, {
		preferredRootCompName: inspection.name,
	});
	const rootComp = graph.compositionsById.get(graph.rootCompId) ?? graph.compositions[0]!;

	const width = opts.width ?? 1280;
	const height = opts.height ?? 720;
	const fps = opts.fps ?? (rootComp.fps > 0 ? rootComp.fps : inspection.fps || 30);
	const durationSec = opts.durationSec ?? (rootComp.durationSec > 0 ? rootComp.durationSec : inspection.durationSec || 7.267);
	const totalFrames = Math.max(1, Math.round(durationSec * fps));

	mkdirSync(dirname(opts.outputMp4Path), { recursive: true });

	const session: RenderSessionState = {
		graph,
		inspection,
		controlOverrides: buildEffectiveControlOverrides(inspection, opts.overrides?.controls),
		textOverride: opts.overrides?.textOverride,
		logoPath: opts.overrides?.logoPath,
		bgImagePath: opts.overrides?.bgImagePath,
		logoCache: new Map(),
		textCache: new Map(),
		precompCache: new Map(),
		logoSubstituted: false,
		compsTouched: new Set(),
		uniqueRealMasksRasterized: new Set(),
		totalMaskRasterizations: 0,
		totalVerticesRasterized: 0,
		effectsExecutedCounts: {},
		unsupportedEffectsMap: new Map(),
		expressionAudit: { supportedEvaluated: 0, unsupported: [] },
	};

	const ff = spawn(
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
			`${width}x${height}`,
			'-r',
			String(fps),
			'-i',
			'pipe:0',
			'-c:v',
			'libx264',
			'-pix_fmt',
			'yuv420p',
			'-preset',
			'fast',
			'-crf',
			'18',
			'-movflags',
			'+faststart',
			opts.outputMp4Path,
		],
		{ stdio: ['pipe', 'ignore', 'pipe'] },
	);

	let stderr = '';
	ff.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});

	const captureTargets = (opts.captureFrames ?? []).map((c) => ({
		targetFrame: Math.max(0, Math.min(totalFrames - 1, Math.round(c.tSec * fps))),
		outputPngPath: c.outputPngPath,
	}));
	const capturedFramePaths: string[] = [];

	for (let f = 0; f < totalFrames; f++) {
		const tSec = f / fps;
		const frame = renderCompositionFrame(rootComp, tSec, width, height, f, session, 0);

		for (const cap of captureTargets) {
			if (cap.targetFrame === f) {
				writeRgbaBufferToPng(frame, cap.outputPngPath);
				capturedFramePaths.push(cap.outputPngPath);
			}
		}

		const ok = ff.stdin.write(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
		if (!ok) {
			await new Promise<void>((resolve) => ff.stdin.once('drain', resolve));
		}
	}
	ff.stdin.end();

	const exitCode = await new Promise<number>((resolve, reject) => {
		ff.on('error', reject);
		ff.on('close', (code) => resolve(code ?? 1));
	});
	if (exitCode !== 0) {
		throw new Error(`ffmpeg failed (code ${exitCode}): ${stderr.slice(-400)}`);
	}

	const shaAfter = sha256File(opts.mogrtPath);

	// Deduplicate unsupported expressions
	const exprSeen = new Set<string>();
	const unsupportedExprUnique = session.expressionAudit.unsupported.filter((item) => {
		const k = `${item.compName}::${item.layerName}::${item.expression}`;
		if (exprSeen.has(k)) return false;
		exprSeen.add(k);
		return true;
	});

	// Collect all unsupported effects (both encountered during active frame render and declared in graph)
	for (const ue of graph.unsupportedEffects) {
		const k = `${ue.compName}::${ue.layerName}::${ue.matchName}`;
		if (!session.unsupportedEffectsMap.has(k)) {
			session.unsupportedEffectsMap.set(k, {
				compName: ue.compName,
				layerName: ue.layerName,
				matchName: ue.matchName,
				displayName: ue.displayName,
				reason: 'Efeito proprietário/não suportado na Fase 3A — não substituído silenciosamente.',
			});
		}
	}
	const unsupportedEffectsEncountered = [...session.unsupportedEffectsMap.values()];

	const missingEssentialLayers: string[] = [];
	const hasLogoLayerInGraph = graph.compositions.some((c) =>
		c.layers.some((l) => l.kind === 'logo_placeholder'),
	);
	if (!hasLogoLayerInGraph) {
		missingEssentialLayers.push('Logo Placeholder (não localizado no grafo .aep)');
	}

	const isComplete =
		unsupportedEffectsEncountered.length === 0 &&
		missingEssentialLayers.length === 0 &&
		unsupportedExprUnique.length === 0;

	const completenessReason = isComplete
		? 'Todas as camadas, máscaras, efeitos e expressões do template foram reproduzidos nativamente sem Adobe.'
		: `Reprodução parcial honesta (Fase 3A): grafo de composições, keyframes, ${session.uniqueRealMasksRasterized.size} máscaras Bézier reais do .aep, logo editável, cores/textos e efeitos base (Glow, Blur, Choker, Noise, Fill, Tint, Set Matte) foram renderizados, mas ${unsupportedEffectsEncountered.length} ocorrência(s) de efeitos proprietários Adobe permanecem pendentes para a Fase 3B (sem substituição procedural silenciosa).`;

	return {
		mogrtPath: opts.mogrtPath,
		originalMogrtSha256Before: shaBefore,
		originalMogrtSha256After: shaAfter,
		originalMogrtUntouched: shaBefore === shaAfter,
		templateName: inspection.name,
		rootCompName: rootComp.name,
		outputMp4Path: opts.outputMp4Path,
		width,
		height,
		fps,
		durationSec: Math.round(durationSec * 1000) / 1000,
		framesRendered: totalFrames,
		renderMs: Date.now() - t0,
		logoSubstituted: session.logoSubstituted,
		logoSourcePath: opts.overrides?.logoPath ?? null,
		nestedCompsRendered: graph.compositions
			.filter((c) => session.compsTouched.has(c.name))
			.map((c) => ({
				name: c.name,
				width: c.width,
				height: c.height,
				fps: c.fps,
				durationSec: c.durationSec,
				layerCount: c.layers.length,
				maskCount: c.totalMasks,
			})),
		masksProvenance: {
			aepTotalMasksExtracted: graph.totalMasksExtracted,
			aepTotalKeyframesExtracted: graph.totalMaskKeyframesExtracted,
			uniqueRealMasksRasterized: session.uniqueRealMasksRasterized.size,
			totalMaskRasterizations: session.totalMaskRasterizations,
			totalVerticesRasterized: session.totalVerticesRasterized,
			verifiedFromAepBinary:
				graph.totalMasksExtracted > 0 && session.uniqueRealMasksRasterized.size > 0,
		},
		effectsExecutedCounts: session.effectsExecutedCounts,
		unsupportedEffectsEncountered,
		expressionsAudit: {
			totalInAep: graph.totalExpressionsFound,
			supportedEvaluations: session.expressionAudit.supportedEvaluated,
			unsupportedUnique: unsupportedExprUnique,
		},
		missingEssentialLayers,
		completenessVerdict: isComplete ? 'complete' : 'partial_with_documented_gaps',
		completenessReason,
		capturedFramePaths,
	};
}
