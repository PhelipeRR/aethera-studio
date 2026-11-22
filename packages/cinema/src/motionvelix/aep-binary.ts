/**
 * Low-level readers for the big-endian RIFX (`Egg!`) container of After Effects projects.
 *
 * Every offset below was measured on After Effects-authored projects. Do not change one to make a
 * synthetic fixture pass: verify it against a real file (see mogrt-real-file-acceptance.test.ts).
 */

const MAX_TREE_DEPTH = 256;

export interface AepChunk {
	/** Chunk id, or the list type for LIST/RIFX containers (`Layr`, `tdgp`, `btdk`...). */
	id: string;
	data: Buffer;
	children: AepChunk[];
}

/** Parses the container tree. Throws on truncated or malformed input instead of guessing. */
export function parseAepChunks(file: Buffer): AepChunk[] {
	if (file.length < 12 || file.toString('latin1', 0, 4) !== 'RIFX') {
		throw new Error('Not an After Effects project: missing RIFX header');
	}
	// After Effects appends XMP after the RIFX container, so only the container itself is parsed.
	const end = 8 + file.readUInt32BE(4);
	if (end > file.length) throw new Error('Truncated After Effects project');
	return parseRange(file.subarray(0, end), 0);
}

function parseRange(buf: Buffer, depth: number): AepChunk[] {
	if (depth > MAX_TREE_DEPTH) throw new Error('After Effects project is nested too deeply');
	const chunks: AepChunk[] = [];
	let pos = 0;
	while (pos + 8 <= buf.length) {
		const tag = buf.toString('latin1', pos, pos + 4);
		const size = buf.readUInt32BE(pos + 4);
		const body = pos + 8;
		if (body + size > buf.length) throw new Error(`Chunk "${tag}" overruns its container`);
		const isContainer = (tag === 'LIST' || tag === 'RIFX') && size >= 4;
		if (isContainer) {
			const id = buf.toString('latin1', body, body + 4);
			const data = buf.subarray(body + 4, body + size);
			// `LIST btdk` holds a raw COS stream, not child chunks.
			chunks.push({ id, data, children: id === 'btdk' ? [] : parseRange(data, depth + 1) });
		} else {
			chunks.push({ id: tag, data: buf.subarray(body, body + size), children: [] });
		}
		pos = body + size + (size % 2);
	}
	return chunks;
}

export function findChild(parent: AepChunk | undefined, id: string): AepChunk | undefined {
	return parent?.children.find((child) => child.id === id);
}

export function findChildren(parent: AepChunk | undefined, id: string): AepChunk[] {
	return parent?.children.filter((child) => child.id === id) ?? [];
}

export function findDescendants(roots: readonly AepChunk[], id: string): AepChunk[] {
	return roots.flatMap((chunk) => [...(chunk.id === id ? [chunk] : []), ...findDescendants(chunk.children, id)]);
}

export function readText(chunk: AepChunk | undefined): string {
	return chunk ? chunk.data.toString('utf8').replace(/\0+$/, '') : '';
}

/** Yields the `tdmn` match name with the chunk that carries its value. */
export function namedEntries(group: AepChunk | undefined): Array<{ matchName: string; value: AepChunk }> {
	const entries: Array<{ matchName: string; value: AepChunk }> = [];
	let matchName: string | null = null;
	for (const child of group?.children ?? []) {
		if (child.id === 'tdmn') {
			matchName = readText(child);
		} else if (matchName !== null && ['tdbs', 'tdgp', 'sspc', 'om-s', 'btds', 'pard'].includes(child.id)) {
			entries.push({ matchName, value: child });
			matchName = null;
		}
	}
	return entries;
}

function requireSize(buf: Buffer, size: number, chunk: string): void {
	if (buf.length < size) throw new Error(`${chunk} record is ${buf.length} bytes, expected at least ${size}`);
}

function readRatio(buf: Buffer, offset: number): number {
	const divisor = buf.readUInt32BE(offset + 4);
	return divisor ? buf.readInt32BE(offset) / divisor : 0;
}

// ---------------------------------------------------------------------------
// Composition and layer headers

export interface CompHeader {
	width: number;
	height: number;
	fps: number;
	timeScale: number;
	frameDurationTicks: number;
	durationSec: number;
	/** Saved playhead. It is neither the duration nor, necessarily, the thumbnail time. */
	playheadSec: number;
	bgColor: [number, number, number];
}

export function decodeCompHeader(cdta: Buffer): CompHeader {
	requireSize(cdta, 160, 'cdta');
	const timeScale = cdta.readUInt32BE(8);
	const frameDurationTicks = cdta.readUInt32BE(4);
	if (!timeScale || !frameDurationTicks) throw new Error('cdta has no time base');
	return {
		width: cdta.readUInt16BE(140),
		height: cdta.readUInt16BE(142),
		fps: cdta.readUInt16BE(156) + cdta.readUInt16BE(158) / 65536,
		timeScale,
		frameDurationTicks,
		durationSec: readRatio(cdta, 44),
		playheadSec: readRatio(cdta, 20),
		bgColor: [cdta[52]! / 255, cdta[53]! / 255, cdta[54]! / 255],
	};
}

const BLEND_MODES = {
	2: 'normal',
	4: 'add',
	5: 'multiply',
	6: 'screen',
	7: 'overlay',
	10: 'darken',
	11: 'lighten',
	15: 'color',
	17: 'stencil_alpha',
	18: 'stencil_luma',
	19: 'silhouette_alpha',
	20: 'silhouette_luma',
} as const;
export type AepBlendMode = (typeof BLEND_MODES)[keyof typeof BLEND_MODES];

const TRACK_MATTES = ['none', 'alpha', 'alpha_inverted', 'luma', 'luma_inverted'] as const;
export type AepTrackMatteType = (typeof TRACK_MATTES)[number];

export interface LayerHeader {
	layerId: number;
	sourceId: number;
	parentLayerId: number;
	/** 0 AV, 3 text, 4 shape. */
	layerType: number;
	visible: boolean;
	effectsActive: boolean;
	collapseTransform: boolean;
	isNull: boolean;
	adjustment: boolean;
	threeD: boolean;
	guide: boolean;
	startTimeSec: number;
	inPointSec: number;
	outPointSec: number;
	stretch: number;
	blendMode: AepBlendMode;
	/** Raw blend id when it is not implemented; `blendMode` is then `normal`. */
	unsupportedBlendId?: number;
	trackMatte: AepTrackMatteType;
}

export function decodeLayerHeader(ldta: Buffer): LayerHeader {
	requireSize(ldta, 160, 'ldta');
	const startTimeSec = readRatio(ldta, 12);
	const stretchDivisor = ldta.readUInt32BE(108);
	const blendId = ldta.readUInt32BE(96);
	const blendMode = (BLEND_MODES as Record<number, AepBlendMode | undefined>)[blendId];
	return {
		layerId: ldta.readUInt32BE(0),
		sourceId: ldta.readUInt32BE(40),
		parentLayerId: ldta.readUInt32BE(132),
		layerType: ldta.readUInt32BE(128),
		guide: (ldta[37]! & 0x02) !== 0,
		isNull: (ldta[38]! & 0x80) !== 0,
		adjustment: (ldta[38]! & 0x02) !== 0,
		threeD: (ldta[38]! & 0x04) !== 0,
		visible: (ldta[39]! & 0x01) !== 0,
		effectsActive: (ldta[39]! & 0x04) !== 0,
		collapseTransform: (ldta[39]! & 0x80) !== 0,
		startTimeSec,
		// In and out points are stored relative to the layer start.
		inPointSec: startTimeSec + readRatio(ldta, 20),
		outPointSec: startTimeSec + readRatio(ldta, 28),
		stretch: stretchDivisor ? ldta.readInt32BE(8) / stretchDivisor || 1 : 1,
		blendMode: blendMode ?? 'normal',
		...(blendMode || blendId === 0 ? {} : { unsupportedBlendId: blendId }),
		trackMatte: TRACK_MATTES[ldta.readUInt32BE(104)] ?? 'none',
	};
}

/** Anchors of layers with a source are stored as a fraction of it; text and shapes use pixels. */
export function anchorToPixels(value: readonly number[], source: { width: number; height: number } | undefined): number[] {
	if (!source) return [...value];
	return [(value[0] ?? 0) * source.width, (value[1] ?? 0) * source.height, ...value.slice(2)];
}

// ---------------------------------------------------------------------------
// Properties and keyframes

export interface PropertyHeader {
	dimensions: number;
	spatial: boolean;
	isColor: boolean;
}

export function decodePropertyHeader(tdb4: Buffer): PropertyHeader {
	requireSize(tdb4, 60, 'tdb4');
	return {
		dimensions: tdb4.readUInt16BE(2),
		spatial: (tdb4[5]! & 0x08) !== 0,
		isColor: (tdb4[59]! & 0x01) !== 0,
	};
}

export type AepTemporalInterpolation = 'linear' | 'bezier' | 'hold';

export interface KeyframeRecord {
	timeTicks: number;
	timeSec: number;
	values: number[];
	/** Interpolation leaving this key. */
	interpolation: AepTemporalInterpolation;
	/** Interpolation arriving at this key. */
	inInterpolation: AepTemporalInterpolation;
	/** Per dimension, or a single entry measured along the path for spatial properties. */
	inSpeed: number[];
	inInfluence: number[];
	outSpeed: number[];
	outInfluence: number[];
}

function interpolationName(code: number): AepTemporalInterpolation {
	return code === 3 ? 'hold' : code === 2 ? 'bezier' : 'linear';
}

export function decodeKeyframeRecord(
	record: Buffer,
	options: { dimensions: number; spatial: boolean; timeScale: number },
): KeyframeRecord {
	const { dimensions, spatial, timeScale } = options;
	// Spatial and colour records carry 16 extra bytes and a single speed/influence pair.
	const valueOffset = spatial ? 56 : 8;
	requireSize(record, valueOffset + dimensions * 8, 'keyframe');
	const doubles = (offset: number, count: number): number[] =>
		Array.from({ length: count }, (_, i) =>
			offset + i * 8 + 8 <= record.length ? record.readDoubleBE(offset + i * 8) : 0,
		);
	const easeDims = spatial ? 1 : dimensions;
	const easeOffset = spatial ? 24 : 8 + dimensions * 8;
	const timeTicks = record.readInt32BE(0);
	return {
		timeTicks,
		timeSec: timeTicks / timeScale,
		values: doubles(valueOffset, dimensions),
		inInterpolation: interpolationName(record[4]!),
		interpolation: interpolationName(record[5]!),
		inSpeed: doubles(easeOffset, easeDims),
		inInfluence: doubles(easeOffset + easeDims * 8, easeDims),
		outSpeed: doubles(easeOffset + easeDims * 16, easeDims),
		outInfluence: doubles(easeOffset + easeDims * 24, easeDims),
	};
}

/** Splits a keyframe `list` (lhd3 + ldat) into records. */
export function readRecordList(list: AepChunk | undefined): { count: number; records: Buffer[]; data: Buffer } {
	const header = findChild(list, 'lhd3')?.data;
	const data = findChild(list, 'ldat')?.data;
	if (!header || !data) return { count: 0, records: [], data: Buffer.alloc(0) };
	requireSize(header, 20, 'lhd3');
	const count = header.readUInt32BE(8);
	const size = header.readUInt32BE(16);
	if (count * size > data.length) throw new Error('ldat is shorter than its lhd3 header declares');
	const records = Array.from({ length: count }, (_, i) => data.subarray(i * size, (i + 1) * size));
	return { count, records, data };
}

// ---------------------------------------------------------------------------
// Masks

const MASK_MODES = ['none', 'add', 'subtract', 'intersect', 'lighten', 'darken', 'difference'] as const;
export type AepMaskMode = (typeof MASK_MODES)[number];

export function decodeMaskHeader(mkif: Buffer): { mode: AepMaskMode; inverted: boolean } {
	requireSize(mkif, 8, 'mkif');
	const code = mkif.readUInt16BE(6);
	const mode = MASK_MODES[code];
	if (!mode) throw new Error(`Unknown mask mode ${code}`);
	return { mode, inverted: mkif[0] !== 0 };
}

export interface Vec2 {
	x: number;
	y: number;
}

export interface BezierVertex {
	point: Vec2;
	/** Absolute position of the outgoing handle. */
	outHandle: Vec2;
	/** Absolute position of the incoming handle. */
	inHandle: Vec2;
}

export interface ShapePath {
	closed: boolean;
	bounds: { top: number; left: number; bottom: number; right: number };
	vertices: BezierVertex[];
}

/**
 * `shph` holds the bounds as fractions of the layer; points are (x, y) fractions of those bounds,
 * ordered vertex, out handle, in handle of the next vertex.
 */
export function decodeShapePath(
	shph: Buffer,
	points: Buffer,
	count: number,
	/** The source's size, which normalizes the points. Absent for text and shape layers, stored in pixels. */
	size: { width: number; height: number } | undefined,
): ShapePath {
	const { width, height } = size ?? { width: 1, height: 1 };
	requireSize(shph, 20, 'shph');
	requireSize(points, count * 8, 'shape points');
	const left = shph.readFloatBE(4);
	const top = shph.readFloatBE(8);
	const right = shph.readFloatBE(12);
	const bottom = shph.readFloatBE(16);
	const at = (index: number): Vec2 => ({
		x: (left + points.readFloatBE(index * 8) * (right - left)) * width,
		y: (top + points.readFloatBE(index * 8 + 4) * (bottom - top)) * height,
	});
	const vertices: BezierVertex[] = [];
	for (let i = 0; i < count; i += 3) {
		const point = at(i);
		vertices.push({
			point,
			outHandle: i + 1 < count ? at(i + 1) : point,
			inHandle: at((i - 1 + count) % count),
		});
	}
	return {
		closed: (shph[3]! & 0x08) === 0,
		bounds: {
			top: top * height,
			left: left * width,
			bottom: bottom * height,
			right: right * width,
		},
		vertices,
	};
}

// ---------------------------------------------------------------------------
// Effect parameter definitions

const PARAM_INTEGER = 1;
const PARAM_SLIDER = 2;
const PARAM_ANGLE = 3;
const PARAM_CHECKBOX = 4;
const PARAM_COLOR = 5;
const PARAM_POINT = 6;
const PARAM_POPUP = 7;
const PARAM_FLOAT_SLIDER = 10;

/**
 * Default value from a `pard` definition, used when an effect omits the parameter.
 * Byte 56 holds the last used value and is deliberately ignored.
 */
export function decodeParamDefault(pard: Buffer): { name: string; value: number[] } {
	requireSize(pard, 56, 'pard');
	const name = pard.toString('latin1', 16, 48).split('\0')[0] ?? '';
	const i32 = (offset: number): number => (offset + 4 <= pard.length ? pard.readInt32BE(offset) : 0);
	switch (pard.readUInt32BE(12)) {
		case PARAM_INTEGER:
			return { name, value: [i32(140)] };
		case PARAM_SLIDER:
			return { name, value: [i32(140) / 65536] };
		case PARAM_FLOAT_SLIDER:
			return { name, value: [pard.length >= 124 ? pard.readFloatBE(120) : 0] };
		case PARAM_ANGLE:
			return { name, value: [i32(60) / 65536] };
		case PARAM_CHECKBOX:
			return { name, value: [pard.length > 60 ? pard[60]! : 0] };
		case PARAM_COLOR:
			// Same ARGB 0..255 convention as `cdat`. The stored default alpha is not meaningful.
			return { name, value: pard.length >= 64 ? [255, pard[61]!, pard[62]!, pard[63]!] : [255, 0, 0, 0] };
		case PARAM_POINT:
			return { name, value: [i32(68) / 65536 / 100, i32(72) / 65536 / 100] };
		case PARAM_POPUP:
			return { name, value: [pard.length >= 64 ? pard.readUInt16BE(62) : 1] };
		default:
			return { name, value: [0] };
	}
}

const CURVE_TABLE_COUNT = 5;
const CURVE_TABLE_SIZE = 256;

/**
 * The `aRbp` blob of a Curves effect. After a 4-byte version come the evaluated tables for RGB, red,
 * green, blue and alpha; the control points that follow them are not needed.
 */
export function decodeCurvesData(aRbp: Buffer): Uint8Array[] | undefined {
	if (aRbp.length < 4 + CURVE_TABLE_COUNT * CURVE_TABLE_SIZE) return undefined;
	return Array.from({ length: CURVE_TABLE_COUNT }, (_, i) => {
		const start = 4 + i * CURVE_TABLE_SIZE;
		return new Uint8Array(aRbp.subarray(start, start + CURVE_TABLE_SIZE));
	});
}

// ---------------------------------------------------------------------------
// Text documents (`btdk` COS stream)

export type CosValue = number | boolean | string | null | CosValue[] | { [key: string]: CosValue };

export function parseCos(data: Buffer): CosValue {
	let pos = 0;

	const skipSpace = (): void => {
		while (pos < data.length && data[pos]! <= 32) pos++;
	};

	const token = (): string => {
		const start = pos;
		while (pos < data.length && data[pos]! > 32 && !'()<>[]/'.includes(String.fromCharCode(data[pos]!))) pos++;
		return data.toString('latin1', start, pos);
	};

	const string = (): string => {
		const bytes: number[] = [];
		pos++;
		while (pos < data.length && data[pos] !== 0x29) {
			if (data[pos] === 0x5c) pos++; // escaped byte
			if (pos < data.length) bytes.push(data[pos++]!);
		}
		pos++;
		const raw = Buffer.from(bytes);
		if (raw[0] !== 0xfe || raw[1] !== 0xff) return raw.toString('latin1');
		return Buffer.from(raw.subarray(2, 2 + ((raw.length - 2) & ~1)))
			.swap16()
			.toString('utf16le');
	};

	const dictionary = (closing: boolean, depth: number): CosValue => {
		// Keys come from the file: a null prototype keeps `__proto__` an ordinary key.
		const out = Object.create(null) as { [key: string]: CosValue };
		for (;;) {
			skipSpace();
			if (pos >= data.length) break;
			if (closing && data[pos] === 0x3e && data[pos + 1] === 0x3e) {
				pos += 2;
				break;
			}
			if (data[pos] !== 0x2f) {
				if (!closing) break;
				throw new Error('Malformed COS dictionary');
			}
			pos++;
			const key = token();
			out[key] = value(depth + 1);
		}
		return out;
	};

	const value = (depth: number): CosValue => {
		if (depth > MAX_TREE_DEPTH) throw new Error('COS stream is nested too deeply');
		skipSpace();
		if (pos >= data.length) return null;
		const byte = data[pos];
		if (byte === 0x28) return string();
		if (byte === 0x3c && data[pos + 1] === 0x3c) {
			pos += 2;
			return dictionary(true, depth);
		}
		if (byte === 0x5b) {
			pos++;
			const list: CosValue[] = [];
			for (;;) {
				skipSpace();
				if (pos >= data.length) break;
				if (data[pos] === 0x5d) {
					pos++;
					break;
				}
				list.push(value(depth + 1));
			}
			return list;
		}
		if (byte === 0x2f) {
			pos++;
			return token();
		}
		const word = token();
		if (!word) throw new Error('Malformed COS stream');
		if (word === 'true' || word === 'false') return word === 'true';
		const number = Number(word);
		return Number.isNaN(number) ? null : number;
	};

	return dictionary(false, 0);
}

export function cosGet(root: CosValue | undefined, ...path: Array<string | number>): CosValue | undefined {
	let current = root;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) return undefined;
		current = (current as Record<string | number, CosValue | undefined>)[key];
	}
	return current;
}
