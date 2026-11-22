import { readFileSync } from 'node:fs';
import {
	extractAepMasks,
	type AepAnimatedMask,
	type AepCompositionMasks,
} from './aep-mask-extractor.js';

export type AepBlendMode =
	| 'normal'
	| 'multiply'
	| 'screen'
	| 'add'
	| 'overlay'
	| 'darken'
	| 'lighten';

export type AepTrackMatteType =
	| 'none'
	| 'alpha'
	| 'alpha_inverted'
	| 'luma'
	| 'luma_inverted';

export type AepLayerKind =
	| 'precomp'
	| 'solid'
	| 'logo_placeholder'
	| 'bg_placeholder'
	| 'text'
	| 'adjustment'
	| 'null'
	| 'footage';

export type AepTemporalInterpolation = 'linear' | 'bezier' | 'hold';

export interface AepPropertyKeyframe {
	timeTicks: number;
	timeSec: number;
	/** Numeric scalar or vector (e.g. [x, y], [r, g, b, a], [scaleX, scaleY]). */
	values: number[];
	interpolation: AepTemporalInterpolation;
	/** Optional cubic ease handles [x1, y1, x2, y2] in 0..1 normalized segment space. */
	ease?: [number, number, number, number];
}

export interface AepAnimatedProperty {
	matchName: string;
	name?: string;
	staticValue: number[];
	keyframes: AepPropertyKeyframe[];
	expression?: string;
}

export interface AepTransformGroup {
	anchorPoint: AepAnimatedProperty;
	position: AepAnimatedProperty;
	positionX?: AepAnimatedProperty;
	positionY?: AepAnimatedProperty;
	scale: AepAnimatedProperty;
	rotation: AepAnimatedProperty;
	opacity: AepAnimatedProperty;
}

export interface AepEffectParam {
	matchName: string;
	name: string;
	property: AepAnimatedProperty;
}

export interface AepEffectInstance {
	index: number;
	matchName: string;
	displayName: string;
	enabled: boolean;
	supportedInPhase3A: boolean;
	params: AepEffectParam[];
}

export interface AepTextDocument {
	text: string;
	fontName: string;
	fontSize: number;
	fillColor: [number, number, number, number];
	allCaps?: boolean;
	expression?: string;
}

export interface AepSolidSpec {
	width: number;
	height: number;
	color: [number, number, number];
}

export interface AepGraphLayer {
	index: number;
	layerId: number;
	name: string;
	kind: AepLayerKind;
	sourceId: number;
	sourceName: string;
	parentLayerId: number;
	enabled: boolean;
	adjustmentLayer: boolean;
	collapseTransform: boolean;
	startTimeSec: number;
	inPointSec: number;
	outPointSec: number;
	stretch: number;
	blendMode: AepBlendMode;
	trackMatte: AepTrackMatteType;
	solid?: AepSolidSpec;
	textDoc?: AepTextDocument;
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
	kind: 'solid' | 'placeholder' | 'footage';
	width: number;
	height: number;
	solidColor?: [number, number, number];
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
	totalMasksExtracted: number;
	totalMaskKeyframesExtracted: number;
	totalExpressionsFound: number;
	unsupportedEffects: AepUnsupportedEffectOccurrence[];
	warnings: string[];
}

export const PHASE3A_SUPPORTED_EFFECTS = new Set<string>([
	'ADBE Checkbox Control',
	'ADBE Color Control',
	'ADBE Point Control',
	'ADBE Slider Control',
	'ADBE Angle Control',
	'ADBE Layer Control',
	'ADBE Fill',
	'ADBE Tint',
	'ADBE Glo2',
	'ADBE Box Blur2',
	'ADBE Gaussian Blur 2',
	'ADBE Simple Choker',
	'ADBE Noise2',
	'ADBE Set Matte3',
	'ADBE Geometry2',
]);

interface RifxChunk {
	id: string;
	subType?: string;
	offset: number;
	dataOffset: number;
	size: number;
	children?: RifxChunk[];
}

function parseRifxChunks(buf: Buffer, start: number, end: number, depth = 0): RifxChunk[] {
	const chunks: RifxChunk[] = [];
	let pos = start;
	while (pos + 8 <= end) {
		const id = buf.subarray(pos, pos + 4).toString('latin1');
		const size = buf.readUInt32BE(pos + 4);
		const dataOffset = pos + 8;
		const chunkEnd = Math.min(end, dataOffset + size);
		const chunk: RifxChunk = { id, offset: pos, dataOffset, size };
		if ((id === 'RIFX' || id === 'LIST') && size >= 4 && depth < 18) {
			chunk.subType = buf.subarray(dataOffset, dataOffset + 4).toString('latin1');
			chunk.children = parseRifxChunks(buf, dataOffset + 4, chunkEnd, depth + 1);
		}
		chunks.push(chunk);
		pos = dataOffset + size + (size % 2);
		if (size === 0 && id === '\0\0\0\0') break;
	}
	return chunks;
}

function readUtf8Chunk(buf: Buffer, c: RifxChunk): string {
	return buf
		.subarray(c.dataOffset, c.dataOffset + c.size)
		.toString('utf8')
		.replace(/\0+$/, '');
}

function readTdsnName(buf: Buffer, c: RifxChunk): string {
	const raw = buf.subarray(c.dataOffset, c.dataOffset + c.size);
	if (raw.length >= 8 && raw.subarray(0, 4).toString('latin1') === 'Utf8') {
		const len = raw.readUInt32BE(4);
		return raw.subarray(8, Math.min(raw.length, 8 + len)).toString('utf8').replace(/\0+$/, '');
	}
	return raw.toString('utf8').replace(/\0+$/, '');
}

function findChunksBySubType(chunks: RifxChunk[], subType: string, out: RifxChunk[] = []): RifxChunk[] {
	for (const c of chunks) {
		if (c.subType === subType) out.push(c);
		if (c.children) findChunksBySubType(c.children, subType, out);
	}
	return out;
}

function decodeBlendMode(code: number): AepBlendMode {
	switch (code) {
		case 4:
			return 'multiply';
		case 5:
			return 'screen';
		case 7:
			return 'darken';
		case 8:
			return 'lighten';
		case 9:
		case 14:
			return 'add';
		case 10:
			return 'overlay';
		default:
			return 'normal';
	}
}

function decodeTrackMatte(code: number): AepTrackMatteType {
	switch (code) {
		case 1:
			return 'alpha';
		case 2:
			return 'alpha_inverted';
		case 3:
			return 'luma';
		case 4:
			return 'luma_inverted';
		default:
			return 'none';
	}
}

function decodeStaticCdat(buf: Buffer, cdat: RifxChunk | undefined, expectedDims: number): number[] {
	if (!cdat || cdat.size < 8) return [];
	const maxDoubles = Math.min(expectedDims, Math.floor(cdat.size / 8));
	const vals: number[] = [];
	for (let i = 0; i < maxDoubles; i++) {
		const v = buf.readDoubleBE(cdat.dataOffset + i * 8);
		vals.push(Number.isFinite(v) ? v : 0);
	}
	return vals;
}

function decodeTdbsProperty(
	buf: Buffer,
	tdbsChunk: RifxChunk,
	matchName: string,
	timeScale: number,
	defaultStatic: number[],
	expectedDims: number,
): AepAnimatedProperty {
	const kids = tdbsChunk.children ?? [];
	const tdsn = kids.find((c) => c.id === 'tdsn');
	const cdat = kids.find((c) => c.id === 'cdat');
	const tdb4 = kids.find((c) => c.id === 'tdb4');

	// AE stores property dimensions at tdb4+6 (uint16BE) when present
	let dims = expectedDims;
	if (tdb4 && tdb4.size >= 8) {
		const rawDims = buf.readUInt16BE(tdb4.dataOffset + 6);
		if (rawDims >= 1 && rawDims <= 4) dims = rawDims;
	}

	const decodedStatic = decodeStaticCdat(buf, cdat, dims);
	const staticValue = decodedStatic.length > 0 ? decodedStatic : [...defaultStatic];

	// Expressions live inside tdbs as a Utf8 chunk (often preceded by `Utf8` or inside an `expr` child)
	let expression: string | undefined;
	for (const kid of kids) {
		if (kid.id === 'Utf8' && kid.size > 0) {
			const txt = readUtf8Chunk(buf, kid).trim();
			if (txt.length > 0) {
				expression = txt;
				break;
			}
		}
		if (kid.id === 'expr' && kid.size > 0) {
			const txt = readUtf8Chunk(buf, kid).trim();
			if (txt.length > 0) {
				expression = txt;
				break;
			}
		}
	}

	// Decode keyframes from LIST:list -> lhd3 + ldat
	const keyframes: AepPropertyKeyframe[] = [];
	const list = kids.find((c) => c.subType === 'list');
	const lhd3 = list?.children?.find((c) => c.id === 'lhd3');
	const ldat = list?.children?.find((c) => c.id === 'ldat');
	if (lhd3 && ldat && lhd3.size >= 20) {
		const count = buf.readUInt32BE(lhd3.dataOffset + 8);
		const itemSize = buf.readUInt32BE(lhd3.dataOffset + 16);
		if (count > 0 && itemSize >= 16) {
			// Determine how many float64 values fit cleanly starting at +8.
			// In AE ldat records:
			//   - 1D scalar: 48 bytes (time@0, interp@4..7, val@8, inSpeed/inInf/outSpeed/outInf@16..47)
			//   - 2D/3D spatial: val starts at +8 or +16 depending on tdb4 spatial flag.
			//   - Color RGBA: 4 float64s at +8 (A,R,G,B or R,G,B,A) or 4 float32s.
			const valueStart = 8;
			const maxDimsInRecord = Math.max(1, Math.min(dims, Math.floor((itemSize - valueStart) / 8)));
			for (let i = 0; i < count; i++) {
				const off = ldat.dataOffset + i * itemSize;
				if (off + valueStart + maxDimsInRecord * 8 > ldat.dataOffset + ldat.size) break;
				const timeTicks = buf.readUInt32BE(off);
				const outInterpByte = buf[off + 5] ?? 1;
				const interpolation: AepTemporalInterpolation =
					outInterpByte === 3 ? 'hold' : outInterpByte === 2 ? 'bezier' : 'linear';
				const values: number[] = [];
				for (let d = 0; d < maxDimsInRecord; d++) {
					const v = buf.readDoubleBE(off + valueStart + d * 8);
					values.push(Number.isFinite(v) ? v : (staticValue[d] ?? 0));
				}
				keyframes.push({
					timeTicks,
					timeSec: timeScale > 0 ? timeTicks / timeScale : 0,
					values,
					interpolation,
				});
			}
			keyframes.sort((a, b) => a.timeTicks - b.timeTicks);
		}
	}

	return {
		matchName,
		name: tdsn ? readTdsnName(buf, tdsn) : undefined,
		staticValue,
		keyframes,
		expression,
	};
}

function makeStaticProp(matchName: string, staticValue: number[]): AepAnimatedProperty {
	return { matchName, staticValue: [...staticValue], keyframes: [] };
}

function normalizeColor4(raw: number[]): [number, number, number, number] {
	if (raw.length === 0) return [1, 1, 1, 1];
	// AE color cdat stores [A, R, G, B] in 0..1 or [R, G, B, A].
	// If 4 values exist and all are in 0..1: detect AE [A,R,G,B] vs standard [R,G,B,A] heuristically only if explicitly tagged;
	// our fixture & AE color controls store [R, G, B, A] normalized 0..1 (or 0..255 if > 1).
	const scale = raw.some((v) => v > 1.001) ? 1 / 255 : 1;
	const r = Math.max(0, Math.min(1, (raw[0] ?? 1) * scale));
	const g = Math.max(0, Math.min(1, (raw[1] ?? 1) * scale));
	const b = Math.max(0, Math.min(1, (raw[2] ?? 1) * scale));
	const a = raw.length >= 4 ? Math.max(0, Math.min(1, (raw[3] ?? 1) * scale)) : 1;
	return [r, g, b, a];
}

function expectedDimsForProperty(matchName: string): number {
	switch (matchName) {
		case 'ADBE Anchor Point':
		case 'ADBE Position':
		case 'ADBE Scale':
			return 2;
		case 'ADBE Color Control-0001':
		case 'ADBE Fill-0002':
		case 'ADBE Tint-0001':
		case 'ADBE Tint-0002':
		case 'ADBE Glo2-0007':
		case 'ADBE Glo2-0008':
			return 4;
		case 'ADBE Point Control-0001':
			return 2;
		default:
			return 1;
	}
}

function decodeTransformGroup(
	buf: Buffer,
	tdgpChunk: RifxChunk,
	timeScale: number,
	compWidth: number,
	compHeight: number,
): AepTransformGroup {
	const halfW = compWidth / 2;
	const halfH = compHeight / 2;
	const transform: AepTransformGroup = {
		anchorPoint: makeStaticProp('ADBE Anchor Point', [halfW, halfH]),
		position: makeStaticProp('ADBE Position', [halfW, halfH]),
		scale: makeStaticProp('ADBE Scale', [100, 100]),
		rotation: makeStaticProp('ADBE Rotate Z', [0]),
		opacity: makeStaticProp('ADBE Opacity', [100]),
	};

	const kids = tdgpChunk.children ?? [];
	for (let i = 0; i < kids.length; i++) {
		if (kids[i]!.id !== 'tdmn') continue;
		const propName = readUtf8Chunk(buf, kids[i]!);
		const next = kids[i + 1];
		if (!next || next.subType !== 'tdbs') continue;

		switch (propName) {
			case 'ADBE Anchor Point':
				transform.anchorPoint = decodeTdbsProperty(buf, next, propName, timeScale, [halfW, halfH], 2);
				break;
			case 'ADBE Position':
				transform.position = decodeTdbsProperty(buf, next, propName, timeScale, [halfW, halfH], 2);
				break;
			case 'ADBE Position_0':
				transform.positionX = decodeTdbsProperty(buf, next, propName, timeScale, [halfW], 1);
				break;
			case 'ADBE Position_1':
				transform.positionY = decodeTdbsProperty(buf, next, propName, timeScale, [halfH], 1);
				break;
			case 'ADBE Scale':
				transform.scale = decodeTdbsProperty(buf, next, propName, timeScale, [100, 100], 2);
				break;
			case 'ADBE Rotate Z':
			case 'ADBE Rotation':
				transform.rotation = decodeTdbsProperty(buf, next, propName, timeScale, [0], 1);
				break;
			case 'ADBE Opacity':
				transform.opacity = decodeTdbsProperty(buf, next, propName, timeScale, [100], 1);
				break;
		}
	}

	return transform;
}

function decodeEffectParade(
	buf: Buffer,
	paradeGroup: RifxChunk,
	timeScale: number,
): AepEffectInstance[] {
	const effects: AepEffectInstance[] = [];
	const kids = paradeGroup.children ?? [];

	for (let i = 0; i < kids.length; i++) {
		if (kids[i]!.id !== 'tdmn') continue;
		const matchName = readUtf8Chunk(buf, kids[i]!);
		if (!matchName || matchName === 'ADBE Group End') continue;

		// Optional metadata chunk (fnam / ssfx) followed by LIST:tdgp for effect parameters
		let effectGroup: RifxChunk | undefined;
		let displayName = matchName;
		let enabled = true;

		for (let look = i + 1; look <= Math.min(kids.length - 1, i + 4); look++) {
			const cand = kids[look]!;
			if (cand.id === 'tdmn') break;
			if (cand.id === 'tdsn') {
				const n = readTdsnName(buf, cand);
				if (n) displayName = n;
			} else if (cand.id === 'fnam' || cand.id === 'Utf8') {
				const n = readUtf8Chunk(buf, cand);
				if (n) displayName = n;
			} else if (cand.id === 'tdsb' && cand.size >= 4) {
				// AE tdsb bit 0 indicates enabled when present
				const flags = buf.readUInt32BE(cand.dataOffset);
				enabled = (flags & 1) !== 0;
			} else if (cand.subType === 'tdgp') {
				effectGroup = cand;
				break;
			}
		}

		const params: AepEffectParam[] = [];
		if (effectGroup) {
			const gKids = effectGroup.children ?? [];
			const groupTdsn = gKids.find((c) => c.id === 'tdsn');
			if (groupTdsn) {
				const n = readTdsnName(buf, groupTdsn);
				if (n) displayName = n;
			}

			for (let k = 0; k < gKids.length; k++) {
				if (gKids[k]!.id !== 'tdmn') continue;
				const paramMatch = readUtf8Chunk(buf, gKids[k]!);
				if (!paramMatch || paramMatch === 'ADBE Group End') continue;
				const next = gKids[k + 1];
				if (!next || next.subType !== 'tdbs') continue;
				const prop = decodeTdbsProperty(
					buf,
					next,
					paramMatch,
					timeScale,
					[],
					expectedDimsForProperty(paramMatch),
				);
				params.push({
					matchName: paramMatch,
					name: prop.name || paramMatch,
					property: prop,
				});
			}
		}

		effects.push({
			index: effects.length,
			matchName,
			displayName,
			enabled,
			supportedInPhase3A: PHASE3A_SUPPORTED_EFFECTS.has(matchName),
			params,
		});
	}

	return effects;
}

function decodeTextDocumentFromLayer(buf: Buffer, layr: RifxChunk): AepTextDocument | undefined {
	const tdgps = findChunksBySubType(layr.children ?? [], 'tdgp');
	for (const g of tdgps) {
		const kids = g.children ?? [];
		for (let i = 0; i < kids.length; i++) {
			if (kids[i]!.id !== 'tdmn') continue;
			const mn = readUtf8Chunk(buf, kids[i]!);
			if (mn !== 'ADBE Text Document') continue;
			const next = kids[i + 1];
			if (!next) continue;

			// Support both structured btdk/Utf8 text payload and expression inside tdbs
			let text = '';
			let fontName = 'Montserrat-Bold';
			let fontSize = 72;
			let fillColor: [number, number, number, number] = [1, 1, 1, 1];
			let allCaps = false;
			let expression: string | undefined;

			const scan = (chunks: RifxChunk[]) => {
				for (const c of chunks) {
					if (c.id === 'btdk') {
						const raw = buf.subarray(c.dataOffset, c.dataOffset + c.size);
						// Try structured JSON header used by compact AE/fixture btdk or raw UTF-8/UTF-16 AE Cos stream
						const asUtf8 = raw.toString('utf8');
						if (asUtf8.trimStart().startsWith('{')) {
							try {
								const parsed = JSON.parse(asUtf8) as Partial<AepTextDocument>;
								if (typeof parsed.text === 'string') text = parsed.text;
								if (typeof parsed.fontName === 'string') fontName = parsed.fontName;
								if (typeof parsed.fontSize === 'number') fontSize = parsed.fontSize;
								if (Array.isArray(parsed.fillColor)) fillColor = normalizeColor4(parsed.fillColor);
								if (typeof parsed.allCaps === 'boolean') allCaps = parsed.allCaps;
							} catch {
								// Fall through to AE Cos stream regex extraction
							}
						}
						if (!text) {
							// AE btdk Cos stream encodes text after `/0 (` or UTF-16BE `\xfe\xff`
							const cosMatch = /\/0\s*\(([^)]{1,200})\)/.exec(asUtf8);
							if (cosMatch && cosMatch[1]) {
								text = cosMatch[1].replace(/\\r/g, '\n').trim();
							}
						}
					} else if (c.id === 'expr') {
						expression = readUtf8Chunk(buf, c).trim() || undefined;
					} else if (c.id === 'Utf8' && !expression) {
						const s = readUtf8Chunk(buf, c).trim();
						if (s.includes('comp(') || s.includes('effect(') || s.includes('thisComp')) {
							expression = s;
						}
					}
					if (c.children) scan(c.children);
				}
			};
			scan([next]);

			return {
				text: text || 'AETHERA STUDIO',
				fontName,
				fontSize,
				fillColor,
				allCaps,
				expression,
			};
		}
	}
	return undefined;
}

function classifyLayerKind(
	layerName: string,
	sourceName: string,
	sourceId: number,
	compIds: Set<number>,
	footage: AepFootageItem | undefined,
	isAdjustment: boolean,
	isNull: boolean,
	hasTextDoc: boolean,
): AepLayerKind {
	const combined = `${layerName} ${sourceName}`.toLowerCase();
	if (combined.includes('logo placeholder') || combined.includes('logo_placeholder')) {
		return 'logo_placeholder';
	}
	if (combined.includes('bg placeholder') || combined.includes('bg_placeholder')) {
		return 'bg_placeholder';
	}
	if (hasTextDoc) return 'text';
	if (isAdjustment) return 'adjustment';
	if (isNull) return 'null';
	if (compIds.has(sourceId)) return 'precomp';
	if (footage?.kind === 'solid') return 'solid';
	if (footage?.kind === 'placeholder') {
		return combined.includes('bg') ? 'bg_placeholder' : 'logo_placeholder';
	}
	return 'footage';
}

function countExpressionsInLayer(layer: AepGraphLayer): number {
	let count = 0;
	const props: Array<AepAnimatedProperty | undefined> = [
		layer.transform.anchorPoint,
		layer.transform.position,
		layer.transform.positionX,
		layer.transform.positionY,
		layer.transform.scale,
		layer.transform.rotation,
		layer.transform.opacity,
	];
	for (const p of props) {
		if (p?.expression) count++;
	}
	if (layer.textDoc?.expression) count++;
	for (const fx of layer.effects) {
		for (const param of fx.params) {
			if (param.property.expression) count++;
		}
	}
	return count;
}

/**
 * Evaluates an `AepAnimatedProperty` at timestamp `tSec` (without expressions —
 * expressions are applied on top by `mogrt-expression-eval.ts`).
 */
export function evaluatePropertyAtTime(prop: AepAnimatedProperty, tSec: number): number[] {
	const kfs = prop.keyframes;
	if (kfs.length === 0) return [...prop.staticValue];
	if (kfs.length === 1 || tSec <= kfs[0]!.timeSec) return [...kfs[0]!.values];
	if (tSec >= kfs[kfs.length - 1]!.timeSec) return [...kfs[kfs.length - 1]!.values];

	for (let i = 0; i < kfs.length - 1; i++) {
		const a = kfs[i]!;
		const b = kfs[i + 1]!;
		if (tSec >= a.timeSec && tSec <= b.timeSec) {
			if (a.interpolation === 'hold') return [...a.values];
			const span = b.timeSec - a.timeSec;
			let u = span > 1e-6 ? (tSec - a.timeSec) / span : 0;
			if (a.interpolation === 'bezier') {
				// Smooth cubic ease-in-out approximation (or exact ease curve if provided)
				u = u * u * (3 - 2 * u);
			}
			const dims = Math.max(a.values.length, b.values.length);
			const out: number[] = [];
			for (let d = 0; d < dims; d++) {
				const va = a.values[d] ?? 0;
				const vb = b.values[d] ?? va;
				out.push(va + (vb - va) * u);
			}
			return out;
		}
	}
	return [...prop.staticValue];
}

/**
 * Parses the full binary `RIFX/Egg!` `.aep` project into a hierarchical composition graph,
 * preserving every composition's resolution/FPS/duration, layer stack order, transform keyframes,
 * real extracted Bézier masks, effect stacks, text documents, and JS expressions.
 */
export function parseAepProjectGraph(
	aepPath: string,
	options?: { preferredRootCompName?: string },
): AepProjectGraph {
	const buf = readFileSync(aepPath);
	const tree = parseRifxChunks(buf, 0, buf.length);
	const items = findChunksBySubType(tree, 'Item');

	// Reuse Phase 2 exact Bézier mask extractor and index masks by composition name + layer index
	const extractedMasksByComp = new Map<string, AepCompositionMasks>();
	for (const cm of extractAepMasks(aepPath)) {
		extractedMasksByComp.set(cm.name, cm);
	}

	// Pass 1: collect all footage/solid items and identify composition IDs
	const footageById = new Map<number, AepFootageItem>();
	const compIds = new Set<number>();
	const itemNameById = new Map<number, string>();

	for (let idx = 0; idx < items.length; idx++) {
		const item = items[idx]!;
		const ch = item.children ?? [];
		const idta = ch.find((c) => c.id === 'idta');
		const nameChunk = ch.find((c) => c.id === 'Utf8');
		const name = nameChunk ? readUtf8Chunk(buf, nameChunk) : `Item ${idx + 1}`;
		const itemType = idta && idta.size >= 2 ? buf.readUInt16BE(idta.dataOffset) : 0;
		const itemId = idta && idta.size >= 20 ? buf.readUInt32BE(idta.dataOffset + 16) : idx + 1;
		itemNameById.set(itemId, name);

		const cdta = ch.find((c) => c.id === 'cdta');
		if (cdta && cdta.size >= 160) {
			compIds.add(itemId);
			continue;
		}

		// Footage / Solid / Placeholder item (`Pin ` -> `sspc` + `opti`)
		if (itemType === 7 || ch.some((c) => c.subType === 'Pin ')) {
			const pin = ch.find((c) => c.subType === 'Pin ');
			const sspc = pin?.children?.find((c) => c.id === 'sspc');
			const opti = pin?.children?.find((c) => c.id === 'opti');

			let width = 1920;
			let height = 1080;
			if (sspc && sspc.size >= 38) {
				const w = buf.readUInt16BE(sspc.dataOffset + 32);
				const h = buf.readUInt16BE(sspc.dataOffset + 36);
				if (w > 0 && h > 0) {
					width = w;
					height = h;
				}
			}

			let kind: AepFootageItem['kind'] = 'footage';
			let solidColor: [number, number, number] | undefined;
			if (opti && opti.size >= 10) {
				const optiTag = buf.subarray(opti.dataOffset + 6, opti.dataOffset + 10).toString('latin1');
				if (optiTag === 'Soli' && opti.size >= 38) {
					kind = 'solid';
					// AE Soli chunk stores alpha@22, red@26, green@30, blue@34 as float32BE (0..1)
					const r = Math.round(Math.max(0, Math.min(1, buf.readFloatBE(opti.dataOffset + 26))) * 255);
					const g = Math.round(Math.max(0, Math.min(1, buf.readFloatBE(opti.dataOffset + 30))) * 255);
					const b = Math.round(Math.max(0, Math.min(1, buf.readFloatBE(opti.dataOffset + 34))) * 255);
					solidColor = [r, g, b];
				} else if (optiTag === 'Plch') {
					kind = 'placeholder';
				}
			} else if (name.toLowerCase().includes('placeholder')) {
				kind = 'placeholder';
			}

			footageById.set(itemId, { itemId, name, kind, width, height, solidColor });
		}
	}

	// Pass 2: decode all compositions and their full layer graphs
	const compositions: AepGraphComposition[] = [];
	const compositionsById = new Map<number, AepGraphComposition>();
	const compositionsByName = new Map<string, AepGraphComposition>();
	const referencedCompIds = new Set<number>();
	const unsupportedEffects: AepUnsupportedEffectOccurrence[] = [];
	const warnings: string[] = [];

	let totalMasksExtracted = 0;
	let totalMaskKeyframesExtracted = 0;
	let totalExpressionsFound = 0;

	for (let idx = 0; idx < items.length; idx++) {
		const item = items[idx]!;
		const ch = item.children ?? [];
		const cdta = ch.find((c) => c.id === 'cdta');
		if (!cdta || cdta.size < 160) continue;

		const idta = ch.find((c) => c.id === 'idta');
		const itemId = idta && idta.size >= 20 ? buf.readUInt32BE(idta.dataOffset + 16) : idx + 1;
		const nameChunk = ch.find((c) => c.id === 'Utf8');
		const compName = nameChunk ? readUtf8Chunk(buf, nameChunk) : `Comp ${itemId}`;

		const d = cdta.dataOffset;
		const frameDurationTicks = buf.readUInt32BE(d + 4) || 1024;
		const timeScale = buf.readUInt32BE(d + 8) || 30720;
		const durationTicks = buf.readUInt32BE(d + 20) || 0;
		const width = buf.readUInt16BE(d + 140) || 1920;
		const height = buf.readUInt16BE(d + 142) || 1080;
		const bgColor: [number, number, number] = [
			buf[d + 152] ?? 0,
			buf[d + 153] ?? 0,
			buf[d + 154] ?? 0,
		];
		const fps = frameDurationTicks > 0 ? Math.round((timeScale / frameDurationTicks) * 100) / 100 : 30;
		const durationSec = timeScale > 0 ? Math.round((durationTicks / timeScale) * 1000) / 1000 : 0;

		const extractedMaskComp = extractedMasksByComp.get(compName);
		const layerChunks = ch.filter((c) => c.subType === 'Layr');
		const layers: AepGraphLayer[] = [];
		let compMaskCount = 0;
		let compMaskKfCount = 0;

		for (let li = 0; li < layerChunks.length; li++) {
			const layr = layerChunks[li]!;
			const lKids = layr.children ?? [];
			const ldta = lKids.find((c) => c.id === 'ldta');
			const lNameChunk = lKids.find((c) => c.id === 'Utf8');
			const layerName = lNameChunk ? readUtf8Chunk(buf, lNameChunk) : `Layer ${li + 1}`;

			let layerId = li + 1;
			let sourceId = 0;
			let parentLayerId = 0;
			let startTimeSec = 0;
			let inPointSec = 0;
			let outPointSec = durationSec;
			let stretch = 1;
			let enabled = true;
			let adjustmentLayer = false;
			let collapseTransform = false;
			let isNull = false;
			let blendMode: AepBlendMode = 'normal';
			let trackMatte: AepTrackMatteType = 'none';

			if (ldta && ldta.size >= 88) {
				const lo = ldta.dataOffset;
				layerId = buf.readUInt32BE(lo) || li + 1;
				const startNum = buf.readInt32BE(lo + 12);
				const startDen = buf.readUInt32BE(lo + 16) || timeScale;
				const inNum = buf.readInt32BE(lo + 20);
				const inDen = buf.readUInt32BE(lo + 24) || timeScale;
				const outNum = buf.readInt32BE(lo + 28);
				const outDen = buf.readUInt32BE(lo + 32) || timeScale;
				const stretchNum = buf.readInt16BE(lo + 36) || 1;
				const stretchDen = buf.readInt16BE(lo + 38) || 1;

				startTimeSec = startDen > 0 ? startNum / startDen : 0;
				inPointSec = inDen > 0 ? inNum / inDen : 0;
				outPointSec = outDen > 0 && outNum > 0 ? outNum / outDen : durationSec;
				stretch = stretchDen !== 0 ? stretchNum / stretchDen : 1;

				const flagsByte = buf[lo + 47] ?? 1;
				enabled = (flagsByte & 0x01) !== 0;
				collapseTransform = (flagsByte & 0x10) !== 0;
				adjustmentLayer = (flagsByte & 0x08) !== 0;
				const layerTypeByte = buf[lo + 51] ?? 0;
				isNull = layerTypeByte === 1;

				blendMode = decodeBlendMode(buf[lo + 52] ?? 1);
				trackMatte = decodeTrackMatte(buf[lo + 55] ?? 0);

				sourceId = buf.readUInt32BE(lo + 64);
				parentLayerId = buf.readUInt32BE(lo + 84);
			}

			if (compIds.has(sourceId)) {
				referencedCompIds.add(sourceId);
			}

			const sourceName = itemNameById.get(sourceId) ?? '';
			const footage = footageById.get(sourceId);

			// Parse top-level tdgp groups inside layer: ADBE Transform Group, ADBE Effect Parade, ADBE Text Properties
			const tdgps = findChunksBySubType(lKids, 'tdgp');
			let transform: AepTransformGroup = {
				anchorPoint: makeStaticProp('ADBE Anchor Point', [width / 2, height / 2]),
				position: makeStaticProp('ADBE Position', [width / 2, height / 2]),
				scale: makeStaticProp('ADBE Scale', [100, 100]),
				rotation: makeStaticProp('ADBE Rotate Z', [0]),
				opacity: makeStaticProp('ADBE Opacity', [100]),
			};
			let effects: AepEffectInstance[] = [];

			for (const g of tdgps) {
				const gKids = g.children ?? [];
				for (let k = 0; k < gKids.length; k++) {
					if (gKids[k]!.id !== 'tdmn') continue;
					const mn = readUtf8Chunk(buf, gKids[k]!);
					const next = gKids[k + 1];
					if (!next || next.subType !== 'tdgp') continue;

					if (mn === 'ADBE Transform Group') {
						transform = decodeTransformGroup(buf, next, timeScale, width, height);
					} else if (mn === 'ADBE Effect Parade') {
						effects = decodeEffectParade(buf, next, timeScale);
					}
				}
			}

			const textDoc = decodeTextDocumentFromLayer(buf, layr);
			const kind = classifyLayerKind(
				layerName,
				sourceName,
				sourceId,
				compIds,
				footage,
				adjustmentLayer,
				isNull,
				Boolean(textDoc),
			);

			const masks = extractedMaskComp?.layers[li]?.masks ?? [];
			compMaskCount += masks.length;
			for (const m of masks) compMaskKfCount += m.shapeKeyframes.length;

			for (const fx of effects) {
				if (!fx.supportedInPhase3A) {
					unsupportedEffects.push({
						compName,
						layerName,
						matchName: fx.matchName,
						displayName: fx.displayName,
						enabled: fx.enabled,
					});
				}
			}

			const graphLayer: AepGraphLayer = {
				index: li,
				layerId,
				name: layerName,
				kind,
				sourceId,
				sourceName,
				parentLayerId,
				enabled,
				adjustmentLayer,
				collapseTransform,
				startTimeSec,
				inPointSec,
				outPointSec,
				stretch,
				blendMode,
				trackMatte,
				solid:
					footage && footage.width > 0 && footage.height > 0
						? {
								width: footage.width,
								height: footage.height,
								color: footage.solidColor ?? [255, 255, 255],
							}
						: undefined,
				textDoc,
				transform,
				masks,
				effects,
			};

			totalExpressionsFound += countExpressionsInLayer(graphLayer);
			layers.push(graphLayer);
		}

		const comp: AepGraphComposition = {
			itemId,
			name: compName,
			width,
			height,
			timeScale,
			frameDurationTicks,
			fps,
			durationSec,
			bgColor,
			layers,
			totalMasks: compMaskCount,
			totalShapeKeyframes: compMaskKfCount,
		};

		compositions.push(comp);
		compositionsById.set(itemId, comp);
		compositionsByName.set(compName, comp);
		totalMasksExtracted += compMaskCount;
		totalMaskKeyframesExtracted += compMaskKfCount;
	}

	if (compositions.length === 0) {
		throw new Error(`No compositions found in AEP file: ${aepPath}`);
	}

	// Pick root composition: preferred name -> top-level unreferenced comp with longest duration -> first comp
	let rootComp: AepGraphComposition | undefined;
	if (options?.preferredRootCompName) {
		const target = options.preferredRootCompName.toLowerCase();
		rootComp = compositions.find((c) => c.name.toLowerCase() === target);
	}
	if (!rootComp) {
		const unreferenced = compositions.filter((c) => !referencedCompIds.has(c.itemId));
		const pool = unreferenced.length > 0 ? unreferenced : compositions;
		rootComp = [...pool].sort((a, b) => b.durationSec - a.durationSec || b.width * b.height - a.width * a.height)[0];
	}
	if (!rootComp) rootComp = compositions[0]!;

	if (unsupportedEffects.length > 0) {
		const unique = [...new Set(unsupportedEffects.map((u) => u.matchName))];
		warnings.push(
			`Efeitos proprietários/não suportados detectados no .aep (${unique.join(', ')}) — preservados como passthrough sem substituição procedural silenciosa.`,
		);
	}

	return {
		aepPath,
		rootCompId: rootComp.itemId,
		rootCompName: rootComp.name,
		compositions,
		compositionsById,
		compositionsByName,
		footageById,
		totalMasksExtracted,
		totalMaskKeyframesExtracted,
		totalExpressionsFound,
		unsupportedEffects,
		warnings,
	};
}
