import { readFileSync } from 'node:fs';

export interface Vec2 {
	x: number;
	y: number;
}

export interface BezierVertex {
	/** Anchor vertex position in composition pixel coordinates. */
	point: Vec2;
	/** Absolute position of the outgoing cubic Bézier control handle from this vertex. */
	outHandle: Vec2;
	/** Absolute position of the incoming cubic Bézier control handle into this vertex. */
	inHandle: Vec2;
}

export interface AepMaskShapeKeyframe {
	timeTicks: number;
	timeSec: number;
	closed: boolean;
	bounds: {
		top: number;
		left: number;
		bottom: number;
		right: number;
	};
	/** Ordered cubic Bézier vertices in composition pixel coordinates. */
	vertices: BezierVertex[];
}

export interface AepOpacityKeyframe {
	timeTicks: number;
	timeSec: number;
	/** Opacity in 0..1 range. */
	opacity: number;
	/** True when AE keyframe uses Hold (step) interpolation (interp byte === 3). */
	hold?: boolean;
}

export type AepMaskMode = 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference' | 'none';

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
		if ((id === 'RIFX' || id === 'LIST') && size >= 4 && depth < 16) {
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
	// tdsn often wraps a nested Utf8 chunk: "Utf8" + uint32 len + string
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

function decodeMaskMode(mkifBuf: Buffer): { mode: AepMaskMode; inverted: boolean } {
	// AE mkif: byte 0 = inverted flag (bit 0), byte 11 (or uint32@8) = mode enum (1=Add, 2=Subtract, 3=Intersect, ...)
	const inverted = mkifBuf.length > 0 ? (mkifBuf[0]! & 1) !== 0 : false;
	const modeCode = mkifBuf.length >= 12 ? mkifBuf.readUInt32BE(8) : 1;
	switch (modeCode) {
		case 0:
			return { mode: 'none', inverted };
		case 1:
			return { mode: 'add', inverted };
		case 2:
			return { mode: 'subtract', inverted };
		case 3:
			return { mode: 'intersect', inverted };
		case 4:
			return { mode: 'lighten', inverted };
		case 5:
			return { mode: 'darken', inverted };
		case 6:
			return { mode: 'difference', inverted };
		default:
			return { mode: 'add', inverted };
	}
}

function decodeShapeChunk(
	buf: Buffer,
	shapChunk: RifxChunk,
	timeTicks: number,
	timeScale: number,
	compWidth: number,
	compHeight: number,
): AepMaskShapeKeyframe | null {
	const kids = shapChunk.children ?? [];
	const shph = kids.find((c) => c.id === 'shph');
	const list = kids.find((c) => c.subType === 'list');
	if (!shph || shph.size < 24 || !list) return null;

	const sd = shph.dataOffset;
	// AE shph bounding box: top, left, bottom, right (float32BE)
	const top = buf.readFloatBE(sd + 4);
	const left = buf.readFloatBE(sd + 8);
	const bottom = buf.readFloatBE(sd + 12);
	const right = buf.readFloatBE(sd + 16);
	const flags = buf.readUInt32BE(sd + 20);
	const closed = (flags & 0x01000000) !== 0 || (flags & 1) !== 0;

	const lhd3 = list.children?.find((c) => c.id === 'lhd3');
	const ldat = list.children?.find((c) => c.id === 'ldat');
	if (!lhd3 || !ldat || lhd3.size < 20) return null;

	const count = buf.readUInt32BE(lhd3.dataOffset + 8);
	const itemSize = buf.readUInt32BE(lhd3.dataOffset + 16);
	if (itemSize !== 8 || count < 3 || count % 3 !== 0) return null;

	// Solid-layer masks store normalized 0..1 bounds; shape-layer masks store pixel coords directly.
	const isNormalized =
		Math.abs(top) <= 2.5 &&
		Math.abs(left) <= 2.5 &&
		Math.abs(bottom) <= 2.5 &&
		Math.abs(right) <= 2.5 &&
		Math.abs(bottom - top) <= 2.5 &&
		Math.abs(right - left) <= 2.5;

	const scaleX = isNormalized ? compWidth : 1;
	const scaleY = isNormalized ? compHeight : 1;
	const spanX = right - left;
	const spanY = bottom - top;

	const rawPts: Vec2[] = [];
	const maxItems = Math.min(count, Math.floor(ldat.size / 8));
	for (let i = 0; i < maxItems; i++) {
		const off = ldat.dataOffset + i * 8;
		const nx = buf.readFloatBE(off);
		const ny = buf.readFloatBE(off + 4);
		// Note: AE stores normalized (yNorm, xNorm) OR (xNorm, yNorm) within (top..bottom, left..right).
		// In AE's `shap` chunk, float[0] is Y-normalized in [top..bottom] and float[1] is X-normalized in [left..right]!
		// Wait: we expose exact mapping so we can verify orientation against thumb.png.
		const px = (left + ny * spanX) * scaleX;
		const py = (top + nx * spanY) * scaleY;
		rawPts.push({ x: px, y: py });
	}

	const numVerts = Math.floor(rawPts.length / 3);
	const vertices: BezierVertex[] = [];
	for (let i = 0; i < numVerts; i++) {
		const vPt = rawPts[i * 3]!;
		const outPt = rawPts[i * 3 + 1]!;
		// The incoming handle of vertex i is stored at the end of the previous triplet: (i - 1) * 3 + 2
		const prevIdx = (i - 1 + numVerts) % numVerts;
		const inPt = rawPts[prevIdx * 3 + 2]!;
		vertices.push({
			point: vPt,
			outHandle: outPt,
			inHandle: inPt,
		});
	}

	return {
		timeTicks,
		timeSec: timeScale > 0 ? timeTicks / timeScale : 0,
		closed,
		bounds: { top, left, bottom, right },
		vertices,
	};
}

function decodeOpacityKeyframes(
	buf: Buffer,
	tdbsChunk: RifxChunk,
	timeScale: number,
): AepOpacityKeyframe[] {
	const list = tdbsChunk.children?.find((c) => c.subType === 'list');
	if (!list) return [];
	const lhd3 = list.children?.find((c) => c.id === 'lhd3');
	const ldat = list.children?.find((c) => c.id === 'ldat');
	if (!lhd3 || !ldat || lhd3.size < 20) return [];

	const count = buf.readUInt32BE(lhd3.dataOffset + 8);
	const itemSize = buf.readUInt32BE(lhd3.dataOffset + 16);
	if (itemSize < 24) return [];

	const keyframes: AepOpacityKeyframe[] = [];
	for (let i = 0; i < count; i++) {
		const off = ldat.dataOffset + i * itemSize;
		if (off + 16 > ldat.dataOffset + ldat.size) break;
		const timeTicks = buf.readUInt32BE(off);
		// AE ldat byte +4/+5: temporal interpolation type (1=linear, 2=bezier, 3=hold)
		const outInterp = buf[off + 5] ?? 1;
		// Opacity float64BE sits at byte offset +8 in AE 48-byte 1D keyframe records (0.0..1.0)
		const opacity = buf.readDoubleBE(off + 8);
		keyframes.push({
			timeTicks,
			timeSec: timeScale > 0 ? timeTicks / timeScale : 0,
			opacity: Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1)),
			hold: outInterp === 3,
		});
	}
	return keyframes;
}

/**
 * Extracts all compositions and their real animated Bézier masks (vertices, tangents,
 * keyframe timestamps, and mask opacity keyframes) directly from a binary `.aep` file.
 */
export function extractAepMasks(aepPath: string): AepCompositionMasks[] {
	const buf = readFileSync(aepPath);
	const tree = parseRifxChunks(buf, 0, buf.length);
	const items = findChunksBySubType(tree, 'Item');
	const comps: AepCompositionMasks[] = [];

	for (const item of items) {
		const ch = item.children ?? [];
		const cdta = ch.find((c) => c.id === 'cdta');
		if (!cdta || cdta.size < 160) continue;

		const nameChunk = ch.find((c) => c.id === 'Utf8');
		const compName = nameChunk ? readUtf8Chunk(buf, nameChunk) : '(unnamed)';

		const d = cdta.dataOffset;
		const frameDurationTicks = buf.readUInt32BE(d + 4) || 1024;
		const timeScale = buf.readUInt32BE(d + 8) || 30720;
		const durationTicks = buf.readUInt32BE(d + 20) || 0;
		const width = buf.readUInt16BE(d + 140) || 1920;
		const height = buf.readUInt16BE(d + 142) || 1080;
		const fps = frameDurationTicks > 0 ? Math.round((timeScale / frameDurationTicks) * 100) / 100 : 30;
		const durationSec = timeScale > 0 ? durationTicks / timeScale : 0;

		const layerChunks = ch.filter((c) => c.subType === 'Layr');
		const layers: AepLayerWithMasks[] = [];
		let totalMasks = 0;
		let totalShapeKeyframes = 0;

		for (let li = 0; li < layerChunks.length; li++) {
			const layr = layerChunks[li]!;
			const lNameChunk = layr.children?.find((c) => c.id === 'Utf8');
			const layerName = lNameChunk ? readUtf8Chunk(buf, lNameChunk) : `Layer ${li + 1}`;
			const tdgps = findChunksBySubType(layr.children ?? [], 'tdgp');
			const masks: AepAnimatedMask[] = [];

			for (const g of tdgps) {
				const kids = g.children ?? [];
				for (let k = 0; k < kids.length; k++) {
					if (kids[k]!.id !== 'tdmn' || readUtf8Chunk(buf, kids[k]!) !== 'ADBE Mask Atom') {
						continue;
					}
					const mkif = kids[k + 1]?.id === 'mkif' ? kids[k + 1] : undefined;
					const atomGroup = kids[k + 2]?.subType === 'tdgp' ? kids[k + 2] : undefined;
					if (!atomGroup) continue;

					const { mode, inverted } = mkif
						? decodeMaskMode(buf.subarray(mkif.dataOffset, mkif.dataOffset + mkif.size))
						: { mode: 'add' as AepMaskMode, inverted: false };

					const atomKids = atomGroup.children ?? [];
					const tdsn = atomKids.find((c) => c.id === 'tdsn');
					const maskName = tdsn ? readTdsnName(buf, tdsn) : `Mask ${masks.length + 1}`;

					// Find ADBE Mask Shape -> LIST:om-s
					let shapeKeyframes: AepMaskShapeKeyframe[] = [];
					let opacityKeyframes: AepOpacityKeyframe[] = [];

					for (let ak = 0; ak < atomKids.length; ak++) {
						if (atomKids[ak]!.id !== 'tdmn') continue;
						const propMatchName = readUtf8Chunk(buf, atomKids[ak]!);
						const next = atomKids[ak + 1];
						if (!next) continue;

						if (propMatchName === 'ADBE Mask Shape' && next.subType === 'om-s') {
							const omsKids = next.children ?? [];
							const tdbs = omsKids.find((c) => c.subType === 'tdbs');
							const omks = omsKids.find((c) => c.subType === 'omks');
							const shapChunks = omks?.children?.filter((c) => c.subType === 'shap') ?? [];

							// Read keyframe timestamps from tdbs -> list -> ldat
							const times: number[] = [];
							const list = tdbs?.children?.find((c) => c.subType === 'list');
							const lhd3 = list?.children?.find((c) => c.id === 'lhd3');
							const ldat = list?.children?.find((c) => c.id === 'ldat');
							if (lhd3 && ldat && lhd3.size >= 20) {
								const kfCount = buf.readUInt32BE(lhd3.dataOffset + 8);
								const kfSize = buf.readUInt32BE(lhd3.dataOffset + 16);
								for (let ki = 0; ki < kfCount; ki++) {
									const off = ldat.dataOffset + ki * kfSize;
									if (off + 4 <= ldat.dataOffset + ldat.size) {
										times.push(buf.readUInt32BE(off));
									}
								}
							}

							for (let si = 0; si < shapChunks.length; si++) {
								const tick = times[si] ?? si * frameDurationTicks;
								const decoded = decodeShapeChunk(
									buf,
									shapChunks[si]!,
									tick,
									timeScale,
									width,
									height,
								);
								if (decoded) shapeKeyframes.push(decoded);
							}
						} else if (propMatchName === 'ADBE Mask Opacity' && next.subType === 'tdbs') {
							opacityKeyframes = decodeOpacityKeyframes(buf, next, timeScale);
						}
					}

					if (shapeKeyframes.length > 0) {
						masks.push({
							index: masks.length,
							name: maskName,
							mode,
							inverted,
							shapeKeyframes,
							opacityKeyframes,
							defaultOpacity: 1,
						});
						totalMasks++;
						totalShapeKeyframes += shapeKeyframes.length;
					}
				}
			}

			layers.push({ index: li, name: layerName, masks });
		}

		comps.push({
			name: compName,
			width,
			height,
			timeScale,
			frameDurationTicks,
			fps,
			durationSec: Math.round(durationSec * 1000) / 1000,
			layers,
			totalMasks,
			totalShapeKeyframes,
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

/**
 * Deterministically evaluates an extracted AE animated Bézier mask at timestamp `tSec`.
 * Preserves exact AE opacity keyframes and shape keyframes (interpolating vertex/tangent
 * positions linearly when consecutive keyframes share topology, or holding exact hand-drawn
 * anime frames when vertex counts differ).
 */
export function evaluateAnimatedMaskAtTime(
	mask: AepAnimatedMask,
	tSec: number,
): EvaluatedMaskState {
	// 1. Evaluate opacity at tSec
	let opacity = mask.defaultOpacity;
	const okfs = mask.opacityKeyframes;
	if (okfs.length === 1) {
		opacity = okfs[0]!.opacity;
	} else if (okfs.length > 1) {
		if (tSec <= okfs[0]!.timeSec) {
			opacity = okfs[0]!.opacity;
		} else if (tSec >= okfs[okfs.length - 1]!.timeSec) {
			opacity = okfs[okfs.length - 1]!.opacity;
		} else {
			for (let i = 0; i < okfs.length - 1; i++) {
				const a = okfs[i]!;
				const b = okfs[i + 1]!;
				if (tSec >= a.timeSec && tSec < b.timeSec) {
					if (a.hold) {
						opacity = a.opacity;
					} else {
						const span = b.timeSec - a.timeSec;
						const alpha = span > 1e-6 ? (tSec - a.timeSec) / span : 0;
						opacity = a.opacity + (b.opacity - a.opacity) * alpha;
					}
					break;
				}
			}
		}
	}

	if (opacity <= 0.01 || mask.shapeKeyframes.length === 0) {
		return {
			visible: false,
			opacity: 0,
			closed: true,
			mode: mask.mode,
			inverted: mask.inverted,
			vertices: [],
			activeKeyframeIndex: -1,
		};
	}

	// 2. Evaluate shape keyframes
	const skfs = mask.shapeKeyframes;
	if (tSec <= skfs[0]!.timeSec || skfs.length === 1) {
		return {
			visible: true,
			opacity,
			closed: skfs[0]!.closed,
			mode: mask.mode,
			inverted: mask.inverted,
			vertices: skfs[0]!.vertices,
			activeKeyframeIndex: 0,
		};
	}
	if (tSec >= skfs[skfs.length - 1]!.timeSec) {
		const last = skfs[skfs.length - 1]!;
		return {
			visible: true,
			opacity,
			closed: last.closed,
			mode: mask.mode,
			inverted: mask.inverted,
			vertices: last.vertices,
			activeKeyframeIndex: skfs.length - 1,
		};
	}

	for (let i = 0; i < skfs.length - 1; i++) {
		const a = skfs[i]!;
		const b = skfs[i + 1]!;
		if (tSec >= a.timeSec && tSec <= b.timeSec) {
			// If vertex counts match, smoothly interpolate vertices + tangents;
			// otherwise (hand-drawn anime frame-by-frame mask redraw), hold frame A cleanly.
			if (a.vertices.length === b.vertices.length && b.timeSec - a.timeSec > 1e-6) {
				const f = (tSec - a.timeSec) / (b.timeSec - a.timeSec);
				const lerpPt = (p1: Vec2, p2: Vec2): Vec2 => ({
					x: p1.x + (p2.x - p1.x) * f,
					y: p1.y + (p2.y - p1.y) * f,
				});
				const verts: BezierVertex[] = a.vertices.map((va, vi) => {
					const vb = b.vertices[vi]!;
					return {
						point: lerpPt(va.point, vb.point),
						outHandle: lerpPt(va.outHandle, vb.outHandle),
						inHandle: lerpPt(va.inHandle, vb.inHandle),
					};
				});
				return {
					visible: true,
					opacity,
					closed: a.closed,
					mode: mask.mode,
					inverted: mask.inverted,
					vertices: verts,
					activeKeyframeIndex: i,
				};
			}
			return {
				visible: true,
				opacity,
				closed: a.closed,
				mode: mask.mode,
				inverted: mask.inverted,
				vertices: a.vertices,
				activeKeyframeIndex: i,
			};
		}
	}

	return {
		visible: false,
		opacity: 0,
		closed: true,
		mode: mask.mode,
		inverted: mask.inverted,
		vertices: [],
		activeKeyframeIndex: -1,
	};
}
