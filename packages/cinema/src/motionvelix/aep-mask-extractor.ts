import { readFileSync } from 'node:fs';
import {
	decodeCompHeader,
	decodeKeyframeRecord,
	decodeLayerHeader,
	decodeMaskHeader,
	decodeShapePath,
	findChild,
	findChildren,
	findDescendants,
	namedEntries,
	parseAepChunks,
	readRecordList,
	readText,
	type AepChunk,
	type AepMaskMode,
	type BezierVertex,
	type Vec2,
} from './aep-binary.js';

export type { AepMaskMode, BezierVertex, Vec2 };

export interface AepMaskShapeKeyframe {
	timeTicks: number;
	/** Seconds relative to the layer start. */
	timeSec: number;
	closed: boolean;
	/** True when the key holds until the next one. */
	hold?: boolean;
	bounds: {
		top: number;
		left: number;
		bottom: number;
		right: number;
	};
	/** Cubic Bézier vertices in layer pixel coordinates. */
	vertices: BezierVertex[];
}

export interface AepOpacityKeyframe {
	timeTicks: number;
	timeSec: number;
	/** Opacity in 0..1 range. */
	opacity: number;
	/** True when AE keyframe uses Hold (step) interpolation. */
	hold?: boolean;
}

export interface AepAnimatedMask {
	index: number;
	name: string;
	mode: AepMaskMode;
	inverted: boolean;
	shapeKeyframes: AepMaskShapeKeyframe[];
	opacityKeyframes: AepOpacityKeyframe[];
	defaultOpacity: number;
}

export interface AepLayerWithMasks {
	index: number;
	name: string;
	masks: AepAnimatedMask[];
}

export interface AepCompositionMasks {
	name: string;
	width: number;
	height: number;
	timeScale: number;
	frameDurationTicks: number;
	fps: number;
	durationSec: number;
	layers: AepLayerWithMasks[];
	totalMasks: number;
	totalShapeKeyframes: number;
}

/** Absorbs floating-point error when a frame time lands exactly on a key. */
const TIME_EPSILON_SEC = 1e-6;

/** Reads the string of chunks that wrap a single `Utf8` chunk (`tdsn`, `fnam`). */
export function readWrappedText(chunk: AepChunk | undefined): string {
	if (!chunk || chunk.data.length < 8 || chunk.data.toString('latin1', 0, 4) !== 'Utf8') return '';
	return chunk.data.toString('utf8', 8, 8 + chunk.data.readUInt32BE(4)).replace(/\0+$/, '');
}

/** AE writes this placeholder when the user did not rename something. */
export const UNNAMED = '-_0_/-';

/** Decodes the masks of one `Layr` chunk. `size` is the source's pixel size, absent for text and shape layers. */
export function decodeLayerMasks(
	layer: AepChunk,
	size: { width: number; height: number } | undefined,
	timeScale: number,
): AepAnimatedMask[] {
	const parade = namedEntries(findChild(layer, 'tdgp')).find((e) => e.matchName === 'ADBE Mask Parade')?.value;
	const headers = findChildren(parade, 'mkif');
	const atoms = findChildren(parade, 'tdgp');
	if (headers.length !== atoms.length) throw new Error('Mask headers do not match the mask list');

	return atoms.map((atom, i) => {
		const { mode, inverted } = decodeMaskHeader(headers[i]!.data);
		const entries = namedEntries(atom);
		const shape = entries.find((e) => e.matchName === 'ADBE Mask Shape')?.value;
		const shapeKeys = readRecordList(findChild(findChild(shape, 'tdbs'), 'list')).records;
		const shapes = findChildren(findChild(shape, 'omks'), 'shap');

		const shapeKeyframes = shapes.map((shap, k): AepMaskShapeKeyframe => {
			const points = readRecordList(findChild(shap, 'list'));
			const header = findChild(shap, 'shph');
			if (!header) throw new Error('Mask shape without shph header');
			const path = decodeShapePath(header.data, points.data, points.count, size);
			const key = shapeKeys[k];
			const timeTicks = key ? key.readInt32BE(0) : 0;
			return { timeTicks, timeSec: timeTicks / timeScale, hold: key ? key[5] === 3 : true, ...path };
		});

		const opacity = entries.find((e) => e.matchName === 'ADBE Mask Opacity')?.value;
		const staticOpacity = findChild(opacity, 'cdat')?.data;
		const opacityKeyframes = readRecordList(findChild(opacity, 'list')).records.map((record): AepOpacityKeyframe => {
			const key = decodeKeyframeRecord(record, { dimensions: 1, spatial: false, timeScale });
			return {
				timeTicks: key.timeTicks,
				timeSec: key.timeSec,
				opacity: key.values[0]!,
				hold: key.interpolation === 'hold',
			};
		});

		const name = readWrappedText(findChild(atom, 'tdsn'));
		return {
			index: i + 1,
			name: name && name !== UNNAMED ? name : `Mask ${i + 1}`,
			mode,
			inverted,
			shapeKeyframes,
			opacityKeyframes,
			defaultOpacity: staticOpacity && staticOpacity.length >= 8 ? staticOpacity.readDoubleBE(0) : 1,
		};
	});
}

/** Reads the pixel size of a composition or footage item. */
export function readItemSize(item: AepChunk | undefined): { width: number; height: number } | undefined {
	const cdta = findChild(item, 'cdta');
	if (cdta) {
		const { width, height } = decodeCompHeader(cdta.data);
		return { width, height };
	}
	const sspc = findChild(findChild(item, 'Pin '), 'sspc')?.data;
	if (!sspc || sspc.length < 38) return undefined;
	const width = sspc.readUInt16BE(32);
	const height = sspc.readUInt16BE(36);
	return width && height ? { width, height } : undefined;
}

export function readItemId(item: AepChunk): number | undefined {
	const idta = findChild(item, 'idta')?.data;
	return idta && idta.length >= 20 ? idta.readUInt32BE(16) : undefined;
}

/**
 * Extracts all compositions and their animated Bézier masks (vertices, tangents,
 * keyframe timestamps, and mask opacity keyframes) directly from a binary `.aep` file.
 */
export function extractAepMasks(aepPath: string): AepCompositionMasks[] {
	const items = findDescendants(parseAepChunks(readFileSync(aepPath)), 'Item');
	const itemsById = new Map(items.map((item) => [readItemId(item), item]));
	const comps: AepCompositionMasks[] = [];

	for (const item of items) {
		const cdta = findChild(item, 'cdta');
		if (!cdta) continue;
		const { width, height, timeScale, frameDurationTicks, fps, durationSec } = decodeCompHeader(cdta.data);

		const layers = findChildren(item, 'Layr').map((layer, i): AepLayerWithMasks => {
			const ldta = findChild(layer, 'ldta');
			if (!ldta) throw new Error('Layer without ldta header');
			const source = itemsById.get(decodeLayerHeader(ldta.data).sourceId);
			return {
				index: i + 1,
				name: readText(findChild(layer, 'Utf8')) || readText(findChild(source, 'Utf8')) || `Layer ${i + 1}`,
				masks: decodeLayerMasks(layer, readItemSize(source), timeScale),
			};
		});

		const masks = layers.flatMap((layer) => layer.masks);
		comps.push({
			name: readText(findChild(item, 'Utf8')),
			width,
			height,
			timeScale,
			frameDurationTicks,
			fps,
			durationSec,
			layers,
			totalMasks: masks.length,
			totalShapeKeyframes: masks.reduce((sum, mask) => sum + mask.shapeKeyframes.length, 0),
		});
	}

	return comps;
}

export interface EvaluatedMaskState {
	visible: boolean;
	opacity: number;
	closed: boolean;
	mode: AepMaskMode;
	inverted: boolean;
	vertices: BezierVertex[];
	activeKeyframeIndex: number;
}

function lastKeyAtOrBefore(keys: ReadonlyArray<{ timeSec: number }>, tSec: number): number {
	let index = 0;
	for (let i = 1; i < keys.length; i++) {
		if (keys[i]!.timeSec <= tSec + TIME_EPSILON_SEC) index = i;
		else break;
	}
	return index;
}

function segmentProgress(from: { timeSec: number }, to: { timeSec: number }, tSec: number): number {
	return Math.max(0, Math.min(1, (tSec - from.timeSec) / Math.max(TIME_EPSILON_SEC, to.timeSec - from.timeSec)));
}

/**
 * Evaluates a mask at `tSec` (relative to the layer start). Hold keys step; other keys
 * interpolate linearly, holding when the topology changes between keys.
 */
export function evaluateAnimatedMaskAtTime(mask: AepAnimatedMask, tSec: number): EvaluatedMaskState {
	let opacity = mask.defaultOpacity;
	const opacityKeys = mask.opacityKeyframes;
	if (opacityKeys.length > 0) {
		const i = lastKeyAtOrBefore(opacityKeys, tSec);
		const from = opacityKeys[i]!;
		const to = opacityKeys[i + 1];
		opacity =
			!to || from.hold
				? from.opacity
				: from.opacity + (to.opacity - from.opacity) * segmentProgress(from, to, tSec);
	}

	const { mode, inverted } = mask;
	const shapes = mask.shapeKeyframes;
	if (opacity <= 0.01 || shapes.length === 0) {
		return { visible: false, opacity: 0, closed: true, mode, inverted, vertices: [], activeKeyframeIndex: -1 };
	}

	const index = lastKeyAtOrBefore(shapes, tSec);
	const from = shapes[index]!;
	const to = shapes[index + 1];
	let { vertices } = from;
	if (to && !from.hold && to.vertices.length === vertices.length) {
		const f = segmentProgress(from, to, tSec);
		const lerp = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
		vertices = vertices.map((vertex, v) => {
			const next = to.vertices[v]!;
			return {
				point: lerp(vertex.point, next.point),
				outHandle: lerp(vertex.outHandle, next.outHandle),
				inHandle: lerp(vertex.inHandle, next.inHandle),
			};
		});
	}

	return { visible: true, opacity, closed: from.closed, mode, inverted, vertices, activeKeyframeIndex: index };
}
