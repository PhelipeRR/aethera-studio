import { readFileSync } from 'node:fs';
import {
	anchorToPixels,
	cosGet,
	decodeCompHeader,
	decodeCurvesData,
	decodeKeyframeRecord,
	decodeLayerHeader,
	decodeParamDefault,
	decodePropertyHeader,
	findChild,
	findChildren,
	findDescendants,
	namedEntries,
	parseAepChunks,
	parseCos,
	readRecordList,
	readText,
	type AepBlendMode,
	type AepChunk,
	type AepTemporalInterpolation,
	type AepTrackMatteType,
	type CompHeader,
} from './aep-binary.js';
import {
	decodeLayerMasks,
	readItemId,
	readItemSize,
	readWrappedText,
	UNNAMED,
	type AepAnimatedMask,
} from './aep-mask-extractor.js';

export type { AepBlendMode, AepTemporalInterpolation, AepTrackMatteType };

export type AepLayerKind =
	| 'precomp'
	| 'solid'
	| 'logo_placeholder'
	| 'bg_placeholder'
	| 'media_placeholder'
	| 'text'
	| 'shape'
	| 'adjustment'
	| 'null'
	| 'footage';

export interface AepPropertyKeyframe {
	timeTicks: number;
	/** Seconds relative to the layer start. */
	timeSec: number;
	values: number[];
	/** Interpolation leaving this key. */
	interpolation: AepTemporalInterpolation;
	inInterpolation?: AepTemporalInterpolation;
	inSpeed?: number[];
	inInfluence?: number[];
	outSpeed?: number[];
	outInfluence?: number[];
}

/**
 * How a stored value maps to the unit expressions see:
 * `fraction_percent` is stored 0..1 and shown 0..100; `color_argb255` is shown as RGBA 0..1.
 */
export type AepPropertyUnit = 'plain' | 'fraction_percent' | 'color_argb255';

export interface AepAnimatedProperty {
	matchName: string;
	name?: string;
	staticValue: number[];
	keyframes: AepPropertyKeyframe[];
	unit?: AepPropertyUnit;
	/** Spatial properties ease along the path instead of per dimension. */
	spatial?: boolean;
	expression?: string;
}

export interface AepTransformGroup {
	anchorPoint: AepAnimatedProperty;
	position: AepAnimatedProperty;
	positionX?: AepAnimatedProperty;
	positionY?: AepAnimatedProperty;
	/** Fraction: 1 = 100%. */
	scale: AepAnimatedProperty;
	rotation: AepAnimatedProperty;
	/** Fraction: 1 = 100%. */
	opacity: AepAnimatedProperty;
}

export interface AepEffectParam {
	matchName: string;
	name: string;
	property: AepAnimatedProperty;
	/** Target layer id of a layer-reference parameter. */
	layerRef?: number;
}

export interface AepEffectInstance {
	index: number;
	matchName: string;
	displayName: string;
	enabled: boolean;
	supportedInPhase3A: boolean;
	params: AepEffectParam[];
	/** Curves only: RGB, red, green, blue and alpha tables. Absent when they are animated or unreadable. */
	curveTables?: Uint8Array[];
}

export interface AepTextDocument {
	text: string;
	fontName: string;
	fontSize: number;
	fillColor: [number, number, number, number];
	allCaps: boolean;
	justification: 'left' | 'right' | 'center';
	autoLeading: boolean;
	leading: number;
	/** Thousandths of an em. */
	tracking: number;
	baselineShift: number;
	lineSpacing?: AepAnimatedProperty;
}

export interface AepSolidSpec {
	width: number;
	height: number;
	color: [number, number, number];
}

/** A node of a shape layer's contents tree. */
export interface AepVectorNode {
	matchName: string;
	enabled: boolean;
	properties: Map<string, AepAnimatedProperty>;
	children: AepVectorNode[];
}

export interface AepGraphLayer {
	index: number;
	layerId: number;
	name: string;
	kind: AepLayerKind;
	sourceId: number;
	sourceName: string;
	/** Size of the source; absent for text and shape layers, which live in composition space. */
	sourceSize?: { width: number; height: number };
	parentLayerId: number;
	enabled: boolean;
	isNull: boolean;
	threeD: boolean;
	guide: boolean;
	effectsActive: boolean;
	adjustmentLayer: boolean;
	collapseTransform: boolean;
	startTimeSec: number;
	inPointSec: number;
	outPointSec: number;
	stretch: number;
	blendMode: AepBlendMode;
	unsupportedBlendId?: number;
	trackMatte: AepTrackMatteType;
	solid?: AepSolidSpec;
	textDoc?: AepTextDocument;
	shapes?: AepVectorNode;
	timeRemap?: AepAnimatedProperty;
	transform: AepTransformGroup;
	masks: AepAnimatedMask[];
	effects: AepEffectInstance[];
}

export interface AepGraphComposition {
	itemId: number;
	name: string;
	width: number;
	height: number;
	timeScale: number;
	frameDurationTicks: number;
	fps: number;
	durationSec: number;
	bgColor: [number, number, number];
	/** Ordered top-to-bottom as in After Effects (index 0 is visually topmost). */
	layers: AepGraphLayer[];
	totalMasks: number;
	totalShapeKeyframes: number;
}

export interface AepFootageItem {
	itemId: number;
	name: string;
	kind: 'solid' | 'footage';
	width: number;
	height: number;
	solidColor?: [number, number, number];
}

export type AepControlKind = 'boolean' | 'number' | 'angle' | 'color' | 'point' | 'text' | 'scale' | 'media';

/** An Essential Graphics control, bound by composition, layer and property path (never by name). */
export interface AepControlBinding {
	name: string;
	kind: AepControlKind;
	comp: AepGraphComposition;
	layer: AepGraphLayer;
	/** Absent for text and media controls. */
	property?: AepAnimatedProperty;
}

export interface AepUnsupportedEffectOccurrence {
	compName: string;
	layerName: string;
	matchName: string;
	displayName: string;
	enabled: boolean;
}

export interface AepProjectGraph {
	aepPath: string;
	rootCompId: number;
	rootCompName: string;
	compositions: AepGraphComposition[];
	compositionsById: Map<number, AepGraphComposition>;
	compositionsByName: Map<string, AepGraphComposition>;
	footageById: Map<number, AepFootageItem>;
	controls: AepControlBinding[];
	totalMasksExtracted: number;
	totalMaskKeyframesExtracted: number;
	totalExpressionsFound: number;
	unsupportedEffects: AepUnsupportedEffectOccurrence[];
	warnings: string[];
}

/** Effects the renderer implements. Everything else is reported as a gap. */
export const PHASE3A_SUPPORTED_EFFECTS = new Set<string>([
	'ADBE Checkbox Control',
	'ADBE Color Control',
	'ADBE Point Control',
	'ADBE Slider Control',
	'ADBE Angle Control',
	'ADBE Layer Control',
	'ADBE Fill',
	'ADBE Tint',
	'ADBE Drop Shadow',
	'ADBE Glo2',
	'ADBE Box Blur2',
	'ADBE Simple Choker',
	'ADBE Noise2',
	'ADBE Set Matte3',
	'ADBE Shift Channels',
	'ADBE Geometry2',
	'ADBE Posterize Time',
	'ADBE CurvesCustom',
	'ADBE Exposure2',
	'ADBE Ramp',
	'ADBE Mosaic',
	'CC Radial Blur',
	'ADBE Fractal Noise',
	'ADBE Turbulent Displace',
	'ADBE Displacement Map',
]);

const MAX_DIMENSION = 30000;
const NO_INDEX = 0xffffffff;
const CONTROL_KINDS: Record<number, AepControlKind | undefined> = {
	1: 'boolean',
	2: 'number',
	3: 'angle',
	4: 'color',
	5: 'point',
	6: 'text',
	9: 'scale',
	14: 'media',
};
const FRACTION_PERCENT = new Set(['ADBE Scale', 'ADBE Opacity']);

// ---------------------------------------------------------------------------
// Evaluation

/** Solves a unit cubic Bézier timing curve for progress at `x`. */
function cubicTiming(x1: number, y1: number, x2: number, y2: number, x: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const at = (a: number, b: number, u: number): number => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
	let low = 0;
	let high = 1;
	let u = x;
	for (let i = 0; i < 40; i++) {
		const guess = at(x1, x2, u);
		if (Math.abs(guess - x) < 1e-9) break;
		if (guess < x) low = u;
		else high = u;
		u = (low + high) / 2;
	}
	return at(y1, y2, u);
}

function segmentEase(
	from: AepPropertyKeyframe,
	to: AepPropertyKeyframe,
	dim: number,
	delta: number,
	x: number,
): number {
	const incoming = to.inInterpolation ?? to.interpolation;
	if (from.interpolation !== 'bezier' && incoming !== 'bezier') return x;
	if (Math.abs(delta) < 1e-9) return x;
	const seconds = to.timeSec - from.timeSec;
	const linearSpeed = delta / seconds;
	const outBezier = from.interpolation === 'bezier';
	const inBezier = incoming === 'bezier';
	const x1 = Math.max(0, Math.min(1, outBezier ? (from.outInfluence?.[dim] ?? 1 / 3) : 1 / 6));
	const inInfluence = Math.max(0, Math.min(1, inBezier ? (to.inInfluence?.[dim] ?? 1 / 3) : 1 / 6));
	const y1 = ((outBezier ? (from.outSpeed?.[dim] ?? 0) : linearSpeed) * x1 * seconds) / delta;
	const y2 = 1 - ((inBezier ? (to.inSpeed?.[dim] ?? 0) : linearSpeed) * inInfluence * seconds) / delta;
	return cubicTiming(x1, y1, 1 - inInfluence, y2, x);
}

/** Evaluates a property at `tSec`, relative to the layer start, in stored units. */
export function evaluatePropertyAtTime(prop: AepAnimatedProperty, tSec: number): number[] {
	const keys = prop.keyframes;
	if (keys.length === 0) return [...prop.staticValue];
	let index = -1;
	for (let i = 0; i < keys.length; i++) {
		if (keys[i]!.timeSec <= tSec + 1e-6) index = i;
		else break;
	}
	if (index < 0) return [...keys[0]!.values];
	const from = keys[index]!;
	const to = keys[index + 1];
	if (!to || from.interpolation === 'hold' || to.timeSec <= from.timeSec) return [...from.values];

	const x = Math.max(0, Math.min(1, (tSec - from.timeSec) / (to.timeSec - from.timeSec)));
	const deltas = from.values.map((value, d) => (to.values[d] ?? value) - value);
	if (prop.spatial) {
		// Straight motion path: tangent curvature is not reproduced.
		const progress = segmentEase(from, to, 0, Math.hypot(...deltas), x);
		return from.values.map((value, d) => value + deltas[d]! * progress);
	}
	return from.values.map((value, d) => value + deltas[d]! * segmentEase(from, to, d, deltas[d]!, x));
}

// ---------------------------------------------------------------------------
// Decoding

interface ParamDefinition {
	name: string;
	value: number[];
	isColor: boolean;
	isPoint: boolean;
}

interface DecodeContext {
	timeScale: number;
	paramDefinitions: Map<string, ParamDefinition>;
}

const PARD_COLOR = 5;
const PARD_POINT = 6;

function staticProperty(matchName: string, value: number[]): AepAnimatedProperty {
	return {
		matchName,
		staticValue: value,
		keyframes: [],
		...(FRACTION_PERCENT.has(matchName) ? { unit: 'fraction_percent' as const } : {}),
	};
}

/** `tdsb` bit 0 is the enabled switch. */
function isEnabled(node: AepChunk | undefined): boolean {
	const flags = findChild(node, 'tdsb')?.data;
	return !flags || flags.length < 4 || (flags[3]! & 1) !== 0;
}

/** `tdsb` bit 1 marks properties AE hides because they are not in use (time remap, separated position). */
function isInUse(node: AepChunk): boolean {
	const flags = findChild(node, 'tdsb')?.data;
	return !flags || flags.length < 4 || (flags[3]! & 2) === 0;
}

function decodeProperty(matchName: string, node: AepChunk, ctx: DecodeContext): AepAnimatedProperty {
	const header = findChild(node, 'tdb4');
	if (!header) throw new Error(`Property ${matchName} has no tdb4 header`);
	const { dimensions, spatial, isColor } = decodePropertyHeader(header.data);

	const cdat = findChild(node, 'cdat')?.data;
	const staticValue = Array.from({ length: dimensions }, (_, i) =>
		cdat && cdat.length >= (i + 1) * 8 ? cdat.readDoubleBE(i * 8) : 0,
	);

	const keyframes = readRecordList(findChild(node, 'list')).records.map((record) =>
		decodeKeyframeRecord(record, { dimensions, spatial: spatial || isColor, timeScale: ctx.timeScale }),
	);

	const property: AepAnimatedProperty = { matchName, staticValue, keyframes };
	if (isColor) property.unit = 'color_argb255';
	else if (FRACTION_PERCENT.has(matchName)) property.unit = 'fraction_percent';
	if (spatial || isColor) property.spatial = true;
	const name = readWrappedText(findChild(node, 'tdsn'));
	if (name && name !== UNNAMED) property.name = name;
	const expression = readText(findChild(node, 'Utf8'));
	if (expression) property.expression = expression;
	return property;
}

function mapValues(prop: AepAnimatedProperty, map: (value: number[]) => number[], speedFactor: number): void {
	prop.staticValue = map(prop.staticValue);
	for (const key of prop.keyframes) {
		key.values = map(key.values);
		if (key.inSpeed) key.inSpeed = key.inSpeed.map((speed) => speed * speedFactor);
		if (key.outSpeed) key.outSpeed = key.outSpeed.map((speed) => speed * speedFactor);
	}
}

function decodeEffects(
	parade: AepChunk | undefined,
	size: { width: number; height: number },
	ctx: DecodeContext,
): AepEffectInstance[] {
	return namedEntries(parade)
		.filter((entry) => entry.value.id === 'sspc')
		.map(({ matchName, value }, index) => {
			const body = findChild(value, 'tdgp');
			const customName = readWrappedText(findChild(body, 'tdsn'));
			const stored = new Map(namedEntries(body).map((entry) => [entry.matchName, entry.value]));
			const names = new Set<string>(stored.keys());
			// Omitted parameters take the definition's default.
			for (const key of ctx.paramDefinitions.keys()) {
				if (key.startsWith(`${matchName}-`)) names.add(key);
			}

			const params: AepEffectParam[] = [];
			for (const paramName of names) {
				const definition = ctx.paramDefinitions.get(paramName);
				const node = stored.get(paramName);
				if (node && node.id !== 'tdbs') continue;
				let property: AepAnimatedProperty;
				if (node) {
					property = decodeProperty(paramName, node, ctx);
				} else if (definition) {
					property = staticProperty(paramName, [...definition.value]);
					if (definition.isColor) property.unit = 'color_argb255';
				} else {
					continue;
				}
				if (definition?.isPoint) {
					// Effect points are stored as a fraction of the layer.
					const toPixels = (v: number[]): number[] => [v[0]! * size.width, (v[1] ?? 0) * size.height, ...v.slice(2)];
					mapValues(property, toPixels, (size.width + size.height) / 2);
				}
				const param: AepEffectParam = { matchName: paramName, name: definition?.name ?? '', property };
				const layerRef = findChild(node, 'tdpi')?.data;
				if (layerRef && layerRef.length >= 4) param.layerRef = layerRef.readInt32BE(0);
				params.push(param);
			}

			let curveTables: Uint8Array[] | undefined;
			if (matchName === 'ADBE CurvesCustom') {
				// The arbitrary data sits beside its tdbs; more than one blob means keyframed curves.
				const blobs = findDescendants(body ? [body] : [], 'aRbp');
				if (blobs.length === 1) curveTables = decodeCurvesData(blobs[0]!.data);
			}

			return {
				index,
				matchName,
				...(curveTables ? { curveTables } : {}),
				displayName:
					customName && customName !== UNNAMED ? customName : readWrappedText(findChild(value, 'fnam')) || matchName,
				enabled: isEnabled(body),
				supportedInPhase3A: PHASE3A_SUPPORTED_EFFECTS.has(matchName),
				params,
			};
		});
}

function decodeVectorTree(matchName: string, group: AepChunk, ctx: DecodeContext): AepVectorNode {
	const node: AepVectorNode = { matchName, enabled: isEnabled(group), properties: new Map(), children: [] };
	for (const entry of namedEntries(group)) {
		if (entry.value.id === 'tdgp') node.children.push(decodeVectorTree(entry.matchName, entry.value, ctx));
		else if (entry.value.id === 'tdbs') {
			node.properties.set(entry.matchName, decodeProperty(entry.matchName, entry.value, ctx));
		} else if (entry.value.id === 'om-s') {
			// A drawn path: kept as an empty node so the renderer can report it.
			node.children.push({ matchName: entry.matchName, enabled: true, properties: new Map(), children: [] });
		}
	}
	return node;
}

function decodeText(group: AepChunk, ctx: DecodeContext, warnings: string[]): AepTextDocument | undefined {
	const stream = findDescendants([group], 'btdk')[0];
	if (!stream) return undefined;
	const cos = parseCos(stream.data);
	const story = cosGet(cos, '1', '1', 0);
	const text = cosGet(story, '0', '0');
	const styleRuns = cosGet(story, '0', '6', '0');
	const style = cosGet(styleRuns, 0, '0', '0', '6');
	const fontSize = cosGet(style, '1');
	if (typeof text !== 'string' || typeof fontSize !== 'number') {
		warnings.push('A text document could not be decoded; the layer is not rendered.');
		return undefined;
	}
	if (Array.isArray(styleRuns) && styleRuns.length > 1) {
		warnings.push(`Text "${text.trim()}" has ${styleRuns.length} style runs; only the first style is used.`);
	}

	const num = (key: string, fallback: number): number => {
		const value = cosGet(style, key);
		return typeof value === 'number' ? value : fallback;
	};
	const fontName = cosGet(cos, '0', '1', '0', num('0', 0), '0', '0', '0');
	const justification = cosGet(story, '0', '5', '0', 0, '0', '0', '5', '0');
	const fill = cosGet(style, '53', '0', '1');
	const channel = (i: number): number => {
		const value = Array.isArray(fill) ? fill[i] : undefined;
		return typeof value === 'number' ? value : 1;
	};

	const doc: AepTextDocument = {
		text: text.replace(/\r$/, ''),
		fontName: typeof fontName === 'string' ? fontName : '',
		fontSize,
		fillColor: [channel(1), channel(2), channel(3), channel(0)],
		allCaps: num('12', 0) === 2,
		justification: justification === 1 ? 'right' : justification === 2 ? 'center' : 'left',
		autoLeading: cosGet(style, '4') === true,
		leading: num('5', 0),
		tracking: num('8', 0),
		baselineShift: num('9', 0),
	};
	const spacing = findDescendants([group], 'tdgp')
		.flatMap((child) => namedEntries(child))
		.find((entry) => entry.matchName === 'ADBE Text Line Spacing' && entry.value.id === 'tdbs');
	if (spacing) doc.lineSpacing = decodeProperty(spacing.matchName, spacing.value, ctx);
	return doc;
}

function collectParamDefinitions(tree: AepChunk[]): Map<string, ParamDefinition> {
	const definitions = new Map<string, ParamDefinition>();
	for (const table of findDescendants(tree, 'parT')) {
		for (const { matchName, value } of namedEntries(table)) {
			if (value.id !== 'pard' || definitions.has(matchName) || value.data.length < 56) continue;
			const type = value.data.readUInt32BE(12);
			definitions.set(matchName, {
				...decodeParamDefault(value.data),
				isColor: type === PARD_COLOR,
				isPoint: type === PARD_POINT,
			});
		}
	}
	return definitions;
}

interface CompSource {
	item: AepChunk;
	itemId: number;
	name: string;
	header: CompHeader;
}

function decodeLayer(
	chunk: AepChunk,
	index: number,
	source: CompSource,
	lookup: {
		itemsById: Map<number, AepChunk>;
		footageById: Map<number, AepFootageItem>;
		paramDefinitions: Map<string, ParamDefinition>;
		warnings: string[];
	},
): AepGraphLayer {
	const ldta = findChild(chunk, 'ldta');
	if (!ldta) throw new Error(`Layer ${index} of ${source.name} has no ldta header`);
	const { visible, isNull, adjustment, layerType, ...header } = decodeLayerHeader(ldta.data);
	const ctx: DecodeContext = { timeScale: source.header.timeScale, paramDefinitions: lookup.paramDefinitions };

	const item = header.sourceId ? lookup.itemsById.get(header.sourceId) : undefined;
	const sourceName = readText(findChild(item, 'Utf8'));
	const sourceSize = readItemSize(item);
	const footage = lookup.footageById.get(header.sourceId);
	const compSize = { width: source.header.width, height: source.header.height };
	const size = sourceSize ?? compSize;
	const name = readText(findChild(chunk, 'Utf8')) || sourceName || `Layer ${index}`;

	const groups = new Map(namedEntries(findChild(chunk, 'tdgp')).map((entry) => [entry.matchName, entry.value]));
	const transformNodes = new Map(
		namedEntries(groups.get('ADBE Transform Group'))
			.filter((entry) => entry.value.id === 'tdbs')
			.map((entry) => [entry.matchName, entry.value]),
	);
	const transformProperty = (matchName: string, fallback: number[]): AepAnimatedProperty => {
		const node = transformNodes.get(matchName);
		return node ? decodeProperty(matchName, node, ctx) : staticProperty(matchName, fallback);
	};

	const anchorPoint = transformProperty('ADBE Anchor Point', sourceSize ? [0.5, 0.5, 0] : [0, 0, 0]);
	if (sourceSize) {
		mapValues(anchorPoint, (value) => anchorToPixels(value, sourceSize), (size.width + size.height) / 2);
	}
	const transform: AepTransformGroup = {
		anchorPoint,
		position: transformProperty('ADBE Position', [compSize.width / 2, compSize.height / 2, 0]),
		scale: transformProperty('ADBE Scale', [1, 1, 1]),
		rotation: transformProperty('ADBE Rotate Z', [0]),
		opacity: transformProperty('ADBE Opacity', [1]),
	};
	const x = transformNodes.get('ADBE Position_0');
	const y = transformNodes.get('ADBE Position_1');
	if (x && y && isInUse(x)) {
		transform.positionX = decodeProperty('ADBE Position_0', x, ctx);
		transform.positionY = decodeProperty('ADBE Position_1', y, ctx);
	}

	const textGroup = groups.get('ADBE Text Properties');
	const shapeGroup = groups.get('ADBE Root Vectors Group');
	let kind: AepLayerKind = 'footage';
	if (adjustment) kind = 'adjustment';
	else if (isNull) kind = 'null';
	else if (layerType === 3) kind = 'text';
	else if (layerType === 4) kind = 'shape';
	else if (findChild(item, 'cdta')) kind = 'precomp';
	else if (footage?.kind === 'solid') kind = 'solid';

	const layer: AepGraphLayer = {
		...header,
		index,
		name,
		kind,
		sourceName,
		enabled: visible,
		isNull,
		adjustmentLayer: adjustment,
		transform,
		masks: decodeLayerMasks(chunk, sourceSize, ctx.timeScale),
		effects: decodeEffects(groups.get('ADBE Effect Parade'), size, ctx),
	};
	if (sourceSize) layer.sourceSize = sourceSize;
	if (footage?.solidColor) layer.solid = { ...size, color: footage.solidColor };
	if (shapeGroup) layer.shapes = decodeVectorTree('ADBE Root Vectors Group', shapeGroup, ctx);
	if (textGroup) {
		const doc = decodeText(textGroup, ctx, lookup.warnings);
		if (doc) layer.textDoc = doc;
	}

	const remap = groups.get('ADBE Time Remapping');
	if (remap?.id === 'tdbs' && isInUse(remap)) {
		const property = decodeProperty('ADBE Time Remapping', remap, ctx);
		if (property.keyframes.length > 0 || property.expression) layer.timeRemap = property;
	}
	return layer;
}

function referencedCompIds(comps: AepGraphComposition[]): Set<number> {
	return new Set(comps.flatMap((comp) => comp.layers.map((layer) => layer.sourceId)));
}

function descendantCount(comp: AepGraphComposition, byId: Map<number, AepGraphComposition>): number {
	const seen = new Set<number>();
	const visit = (current: AepGraphComposition): void => {
		for (const layer of current.layers) {
			const child = byId.get(layer.sourceId);
			if (child && !seen.has(child.itemId)) {
				seen.add(child.itemId);
				visit(child);
			}
		}
	};
	visit(comp);
	return seen.size;
}

function decodeControls(
	tree: AepChunk[],
	root: AepGraphComposition,
	byId: Map<number, AepGraphComposition>,
	warnings: string[],
): AepControlBinding[] {
	let controlChunks: AepChunk[] = [];
	for (const capsule of findDescendants(tree, 'CIF3')) {
		if (readText(findChild(findChild(capsule, 'CpS2'), 'Utf8')) !== root.name) continue;
		const found = findDescendants(capsule.children, 'CCtl');
		if (found.length > controlChunks.length) controlChunks = found;
	}

	const bindings: AepControlBinding[] = [];
	for (const chunk of controlChunks) {
		const type = findChild(chunk, 'CTyp')?.data;
		const kind = type && type.length >= 4 ? CONTROL_KINDS[type.readUInt32BE(0)] : undefined;
		const pointer = findChild(chunk, 'CPrp');
		if (!kind || !pointer) continue;
		const name = readText(findChild(findChild(chunk, 'CpS2'), 'Utf8'));
		const compId = findChild(pointer, 'CCId')?.data;
		const layerId = findChild(pointer, 'CLId')?.data;
		if (!compId || compId.length < 4 || !layerId || layerId.length < 4) continue;

		const comp = byId.get(compId.readUInt32BE(0));
		const layer = comp?.layers.find((candidate) => candidate.layerId === layerId.readUInt32BE(0));
		if (!comp || !layer) {
			warnings.push(`Control "${name}" points to a layer that does not exist.`);
			continue;
		}
		if (kind === 'text' || kind === 'media') {
			bindings.push({ name, kind, comp, layer });
			continue;
		}

		let path: Array<{ index: number; matchName: string }>;
		try {
			const json = JSON.parse(readText(findChild(pointer, 'Utf8'))) as Record<string, { index: number; matchName: string }>;
			path = Object.keys(json)
				.sort((a, b) => Number(a) - Number(b))
				.map((key) => json[key]!);
		} catch {
			warnings.push(`Control "${name}" has an unreadable property path.`);
			continue;
		}

		let property: AepAnimatedProperty | undefined;
		if (path[0]?.matchName === 'ADBE Effect Parade' && path.length === 3) {
			const { index, matchName } = path[1]!;
			const effect =
				index === NO_INDEX ? layer.effects.find((e) => e.matchName === matchName) : layer.effects[index];
			if (effect?.matchName === matchName) {
				property = effect.params.find((param) => param.matchName === path[2]!.matchName)?.property;
			}
		} else if (path[0]?.matchName === 'ADBE Transform Group' && path.length === 2) {
			property = Object.values(layer.transform).find((prop) => prop?.matchName === path[1]!.matchName);
		}

		if (property) bindings.push({ name, kind, comp, layer, property });
		else warnings.push(`Control "${name}" points to an unsupported property.`);
	}
	return bindings;
}

function readSolidColor(item: AepChunk): [number, number, number] | undefined {
	const opti = findChild(findChild(item, 'Pin '), 'opti')?.data;
	if (!opti || opti.length < 26 || opti.toString('latin1', 0, 4) !== 'Soli') return undefined;
	return [opti.readFloatBE(14), opti.readFloatBE(18), opti.readFloatBE(22)];
}

/**
 * Parses a binary `RIFX/Egg!` `.aep` project into a composition graph: timing, layer stacks,
 * keyframes, masks, effects, text documents, expressions and Essential Graphics bindings.
 */
export function parseAepProjectGraph(
	aepPath: string,
	options?: { preferredRootCompName?: string },
): AepProjectGraph {
	const tree = parseAepChunks(readFileSync(aepPath));
	const warnings: string[] = [];
	const itemsById = new Map<number, AepChunk>();
	const footageById = new Map<number, AepFootageItem>();
	const compSources: CompSource[] = [];

	for (const item of findDescendants(tree, 'Item')) {
		const itemId = readItemId(item);
		if (itemId === undefined) continue;
		itemsById.set(itemId, item);
		const name = readText(findChild(item, 'Utf8'));
		const cdta = findChild(item, 'cdta');
		const size = readItemSize(item);
		if (size && (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION)) {
			throw new Error(`"${name}" is larger than After Effects allows`);
		}
		if (cdta) {
			compSources.push({ item, itemId, name, header: decodeCompHeader(cdta.data) });
		} else if (size) {
			const solidColor = readSolidColor(item);
			footageById.set(itemId, {
				itemId,
				name,
				kind: solidColor ? 'solid' : 'footage',
				...size,
				...(solidColor ? { solidColor } : {}),
			});
		}
	}

	const lookup = { itemsById, footageById, paramDefinitions: collectParamDefinitions(tree), warnings };
	const compositions = compSources.map((source): AepGraphComposition => {
		const layers = findChildren(source.item, 'Layr').map((chunk, i) => decodeLayer(chunk, i + 1, source, lookup));
		const masks = layers.flatMap((layer) => layer.masks);
		const { width, height, fps, timeScale, frameDurationTicks, durationSec, bgColor } = source.header;
		return {
			width,
			height,
			fps,
			timeScale,
			frameDurationTicks,
			durationSec,
			bgColor,
			itemId: source.itemId,
			name: source.name,
			layers,
			totalMasks: masks.length,
			totalShapeKeyframes: masks.reduce((sum, mask) => sum + mask.shapeKeyframes.length, 0),
		};
	});
	if (compositions.length === 0) throw new Error('The After Effects project has no composition');

	const compositionsById = new Map(compositions.map((comp) => [comp.itemId, comp]));
	const compositionsByName = new Map(compositions.map((comp) => [comp.name, comp]));

	let root = options?.preferredRootCompName ? compositionsByName.get(options.preferredRootCompName) : undefined;
	if (!root) {
		if (options?.preferredRootCompName) {
			warnings.push(`Composition "${options.preferredRootCompName}" not found; using the top-level composition.`);
		}
		const referenced = referencedCompIds(compositions);
		root = compositions
			.filter((comp) => !referenced.has(comp.itemId))
			.sort((a, b) => descendantCount(b, compositionsById) - descendantCount(a, compositionsById))[0];
		if (!root) throw new Error('The After Effects project has no top-level composition');
	}

	const controls = decodeControls(tree, root, compositionsById, warnings);
	for (const { name, kind, layer } of controls) {
		if (kind !== 'media') continue;
		layer.kind = /logo/i.test(name)
			? 'logo_placeholder'
			: /\bbg\b|background/i.test(name)
				? 'bg_placeholder'
				: 'media_placeholder';
	}

	const unsupportedEffects = compositions.flatMap((comp) =>
		comp.layers.flatMap((layer) =>
			layer.effects
				.filter((effect) => effect.enabled && !effect.supportedInPhase3A)
				.map(({ matchName, displayName, enabled }) => ({
					compName: comp.name,
					layerName: layer.name,
					matchName,
					displayName,
					enabled,
				})),
		),
	);

	return {
		aepPath,
		rootCompId: root.itemId,
		rootCompName: root.name,
		compositions,
		compositionsById,
		compositionsByName,
		footageById,
		controls,
		totalMasksExtracted: compositions.reduce((sum, comp) => sum + comp.totalMasks, 0),
		totalMaskKeyframesExtracted: compositions.reduce((sum, comp) => sum + comp.totalShapeKeyframes, 0),
		totalExpressionsFound: findDescendants(tree, 'tdbs').filter((prop) => findChild(prop, 'Utf8')).length,
		unsupportedEffects,
		warnings,
	};
}
