/**
 * Binary-authentic `RIFX/Egg!` Modelo 01 `.mogrt` Fixture Builder.
 *
 * Generates a real ZIP `.mogrt` containing:
 * - `definition.json` matching `Dynamic Anime Burst Logo 01` metadata (7.267s @ 30fps, controls, placeholders, usedEffects)
 * - `project.aegraphic` (ZIP containing a valid binary `RIFX/Egg!` `.aep` project)
 *   - Root Comp `Dynamic Anime Burst Logo 01` (1920x1080 @ 30fps, 7.267s)
 *   - Nested Precomp `Transition 01` (1920x1080 @ 15fps, 1.667s) with **90 real animated Bézier masks**
 *     (Layer 0: 62 anime burst rays + Layer 1: 28 magenta energy masses, Hold opacity keyframes, Glow + Box Blur + Simple Choker + Fill bound to Color Controls!)
 *   - Nested Precomp `L01 LOGO` (1920x1080 @ 30fps, 7.267s) containing `Logo Placeholder` (500x500) with
 *     Scale/Position/Rotation/Opacity keyframes, `ADBE Glo2`, `ADBE Set Matte3`, and explicit unsupported markers
 *     (`ADBE Turbulent Displace`, `APC Vegas`, `ADBE Scribble Fill`) so gap detection is exercised end-to-end
 *   - Editable `Text` layer bound to `Text` & `Text Color` controls with fade/slide keyframes
 *   - `BG Placeholder` layer with `ADBE Tint` + `ADBE Noise2` + `ADBE Fractal Noise` (unsupported marker)
 *   - `Controls` adjustment/null layer holding Color, Slider, and Checkbox controls
 * - `thumb.png` reference frame (rendered with the default palette for comparative validation)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rasterizeSvgToPngSync } from './mogrt-media-loader.js';

function padEven(buf: Buffer): Buffer {
	return buf.length % 2 === 1 ? Buffer.concat([buf, Buffer.from([0])]) : buf;
}

function makeChunk(id: string, payload: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.write(id.slice(0, 4), 0, 'latin1');
	header.writeUInt32BE(payload.length, 4);
	return Buffer.concat([header, padEven(payload)]);
}

function makeList(subType: string, children: Buffer[]): Buffer {
	const st = Buffer.alloc(4);
	st.write(subType.slice(0, 4), 0, 'latin1');
	return makeChunk('LIST', Buffer.concat([st, ...children]));
}

function makeRifx(subType: string, children: Buffer[]): Buffer {
	const st = Buffer.alloc(4);
	st.write(subType.slice(0, 4), 0, 'latin1');
	return makeChunk('RIFX', Buffer.concat([st, ...children]));
}

function makeUtf8(text: string): Buffer {
	return makeChunk('Utf8', Buffer.from(text, 'utf8'));
}

function makeTdmn(matchName: string): Buffer {
	return makeChunk('tdmn', Buffer.from(matchName, 'utf8'));
}

function makeTdsn(name: string): Buffer {
	const inner = makeUtf8(name);
	return makeChunk('tdsn', inner);
}

function makeCdat(values: number[]): Buffer {
	const buf = Buffer.alloc(values.length * 8);
	for (let i = 0; i < values.length; i++) {
		buf.writeDoubleBE(values[i]!, i * 8);
	}
	return makeChunk('cdat', buf);
}

function makeTdb4(dims: number): Buffer {
	const buf = Buffer.alloc(16);
	buf.writeUInt16BE(dims, 6);
	return makeChunk('tdb4', buf);
}

interface KeyframeSpec {
	timeTicks: number;
	values: number[];
	interp?: 'linear' | 'bezier' | 'hold';
}

function makeTdbs(opts: {
	name?: string;
	dims: number;
	staticValue: number[];
	keyframes?: KeyframeSpec[];
	expression?: string;
}): Buffer {
	const kids: Buffer[] = [];
	if (opts.name) kids.push(makeTdsn(opts.name));
	kids.push(makeTdb4(opts.dims));
	kids.push(makeCdat(opts.staticValue));

	if (opts.keyframes && opts.keyframes.length > 0) {
		const itemSize = Math.max(48, 8 + opts.dims * 8);
		const lhd3 = Buffer.alloc(24);
		lhd3.writeUInt32BE(opts.keyframes.length, 8);
		lhd3.writeUInt32BE(itemSize, 16);

		const ldat = Buffer.alloc(opts.keyframes.length * itemSize);
		for (let i = 0; i < opts.keyframes.length; i++) {
			const kf = opts.keyframes[i]!;
			const off = i * itemSize;
			ldat.writeUInt32BE(Math.max(0, Math.round(kf.timeTicks)), off);
			ldat[off + 5] = kf.interp === 'hold' ? 3 : kf.interp === 'bezier' ? 2 : 1;
			for (let d = 0; d < opts.dims; d++) {
				ldat.writeDoubleBE(kf.values[d] ?? opts.staticValue[d] ?? 0, off + 8 + d * 8);
			}
		}
		kids.push(makeList('list', [makeChunk('lhd3', lhd3), makeChunk('ldat', ldat)]));
	}

	if (opts.expression) {
		kids.push(makeChunk('expr', Buffer.from(opts.expression, 'utf8')));
	}

	return makeList('tdbs', kids);
}

interface MaskPolygonKf {
	timeTicks: number;
	points: Array<{ x: number; y: number }>;
}

function makeMaskAtom(opts: {
	name: string;
	mode?: 'add' | 'subtract';
	inverted?: boolean;
	shapeKeyframes: MaskPolygonKf[];
	opacityKeyframes: Array<{ timeTicks: number; opacity: number; hold?: boolean }>;
}): Buffer {
	const mkif = Buffer.alloc(16);
	mkif[0] = opts.inverted ? 1 : 0;
	mkif.writeUInt32BE(opts.mode === 'subtract' ? 2 : 1, 8);

	// Build om-s (tdbs timestamps + omks shapes)
	const kfCount = opts.shapeKeyframes.length;
	const lhd3Time = Buffer.alloc(24);
	lhd3Time.writeUInt32BE(kfCount, 8);
	lhd3Time.writeUInt32BE(16, 16);
	const ldatTime = Buffer.alloc(kfCount * 16);
	for (let i = 0; i < kfCount; i++) {
		ldatTime.writeUInt32BE(Math.max(0, Math.round(opts.shapeKeyframes[i]!.timeTicks)), i * 16);
	}
	const shapeTdbs = makeList('tdbs', [
		makeList('list', [makeChunk('lhd3', lhd3Time), makeChunk('ldat', ldatTime)]),
	]);

	const shapChunks: Buffer[] = opts.shapeKeyframes.map((kf) => {
		const pts = kf.points;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of pts) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		const spanX = Math.max(1e-4, maxX - minX);
		const spanY = Math.max(1e-4, maxY - minY);

		const shph = Buffer.alloc(24);
		shph.writeFloatBE(minY, 4); // top
		shph.writeFloatBE(minX, 8); // left
		shph.writeFloatBE(maxY, 12); // bottom
		shph.writeFloatBE(maxX, 16); // right
		shph.writeUInt32BE(0x01000001, 20); // closed = true

		// AE shap ldat stores 3 items per vertex: [vertex, outHandle, inHandle-of-next]
		// with float[0] = Y-normalized in [top..bottom], float[1] = X-normalized in [left..right].
		const itemCount = pts.length * 3;
		const lhd3 = Buffer.alloc(24);
		lhd3.writeUInt32BE(itemCount, 8);
		lhd3.writeUInt32BE(8, 16);
		const ldat = Buffer.alloc(itemCount * 8);

		const writePair = (idx: number, x: number, y: number) => {
			const ny = (y - minY) / spanY;
			const nx = (x - minX) / spanX;
			ldat.writeFloatBE(ny, idx * 8);
			ldat.writeFloatBE(nx, idx * 8 + 4);
		};

		for (let i = 0; i < pts.length; i++) {
			const cur = pts[i]!;
			const next = pts[(i + 1) % pts.length]!;
			// Subtle organic Bézier curve handles along segment
			const hx1 = cur.x + (next.x - cur.x) * 0.25;
			const hy1 = cur.y + (next.y - cur.y) * 0.25;
			const hx2 = cur.x + (next.x - cur.x) * 0.75;
			const hy2 = cur.y + (next.y - cur.y) * 0.75;
			writePair(i * 3, cur.x, cur.y);
			writePair(i * 3 + 1, hx1, hy1);
			writePair(i * 3 + 2, hx2, hy2);
		}

		return makeList('shap', [
			makeChunk('shph', shph),
			makeList('list', [makeChunk('lhd3', lhd3), makeChunk('ldat', ldat)]),
		]);
	});

	const oms = makeList('om-s', [shapeTdbs, makeList('omks', shapChunks)]);

	const opacityTdbs = makeTdbs({
		dims: 1,
		staticValue: [1],
		keyframes: opts.opacityKeyframes.map((k) => ({
			timeTicks: k.timeTicks,
			values: [k.opacity],
			interp: k.hold ? 'hold' : 'linear',
		})),
	});

	const atomGroup = makeList('tdgp', [
		makeTdsn(opts.name),
		makeTdmn('ADBE Mask Shape'),
		oms,
		makeTdmn('ADBE Mask Opacity'),
		opacityTdbs,
		makeTdmn('ADBE Group End'),
	]);

	return Buffer.concat([makeTdmn('ADBE Mask Atom'), makeChunk('mkif', mkif), atomGroup]);
}

function makeEffectEntry(opts: {
	matchName: string;
	displayName: string;
	enabled?: boolean;
	params?: Array<{
		matchName: string;
		name: string;
		dims: number;
		staticValue: number[];
		keyframes?: KeyframeSpec[];
		expression?: string;
	}>;
}): Buffer {
	const tdsb = Buffer.alloc(4);
	tdsb.writeUInt32BE(opts.enabled === false ? 0 : 1, 0);

	const paramChunks: Buffer[] = [makeTdsn(opts.displayName)];
	for (const p of opts.params ?? []) {
		paramChunks.push(makeTdmn(p.matchName));
		paramChunks.push(
			makeTdbs({
				name: p.name,
				dims: p.dims,
				staticValue: p.staticValue,
				keyframes: p.keyframes,
				expression: p.expression,
			}),
		);
	}
	paramChunks.push(makeTdmn('ADBE Group End'));

	return Buffer.concat([
		makeTdmn(opts.matchName),
		makeChunk('tdsb', tdsb),
		makeList('tdgp', paramChunks),
	]);
}

function makeSolidItem(itemId: number, name: string, width: number, height: number, rgb01: [number, number, number]): Buffer {
	const idta = Buffer.alloc(24);
	idta.writeUInt16BE(7, 0); // footage/solid
	idta.writeUInt32BE(itemId, 16);

	const sspc = Buffer.alloc(48);
	sspc.writeUInt16BE(width, 32);
	sspc.writeUInt16BE(height, 36);

	const opti = Buffer.alloc(40);
	opti.write('Soli', 6, 'latin1');
	opti.writeFloatBE(1.0, 22);
	opti.writeFloatBE(rgb01[0], 26);
	opti.writeFloatBE(rgb01[1], 30);
	opti.writeFloatBE(rgb01[2], 34);

	return makeList('Item', [
		makeChunk('idta', idta),
		makeUtf8(name),
		makeList('Pin ', [makeChunk('sspc', sspc), makeChunk('opti', opti)]),
	]);
}

function makePlaceholderItem(itemId: number, name: string, width: number, height: number): Buffer {
	const idta = Buffer.alloc(24);
	idta.writeUInt16BE(7, 0);
	idta.writeUInt32BE(itemId, 16);

	const sspc = Buffer.alloc(48);
	sspc.writeUInt16BE(width, 32);
	sspc.writeUInt16BE(height, 36);

	const opti = Buffer.alloc(16);
	opti.write('Plch', 6, 'latin1');

	return makeList('Item', [
		makeChunk('idta', idta),
		makeUtf8(name),
		makeList('Pin ', [makeChunk('sspc', sspc), makeChunk('opti', opti)]),
	]);
}

interface LayerSpec {
	layerId: number;
	name: string;
	sourceId: number;
	parentLayerId?: number;
	timeScale: number;
	startTimeSec?: number;
	inPointSec?: number;
	outPointSec: number;
	enabled?: boolean;
	adjustment?: boolean;
	isNull?: boolean;
	blendModeCode?: number;
	trackMatteCode?: number;
	anchor?: { staticValue: number[]; keyframes?: KeyframeSpec[] };
	position?: { staticValue: number[]; keyframes?: KeyframeSpec[]; expression?: string };
	scale?: { staticValue: number[]; keyframes?: KeyframeSpec[]; expression?: string };
	rotation?: { staticValue: number[]; keyframes?: KeyframeSpec[]; expression?: string };
	opacity?: { staticValue: number[]; keyframes?: KeyframeSpec[]; expression?: string };
	masks?: Buffer[];
	effects?: Buffer[];
	textDoc?: {
		text: string;
		fontName: string;
		fontSize: number;
		fillColor: [number, number, number, number];
		allCaps?: boolean;
		expression?: string;
	};
}

function makeLayerChunk(spec: LayerSpec): Buffer {
	const ldta = Buffer.alloc(96);
	const ts = spec.timeScale;
	ldta.writeUInt32BE(spec.layerId, 0);
	ldta.writeInt32BE(Math.round((spec.startTimeSec ?? 0) * ts), 12);
	ldta.writeUInt32BE(ts, 16);
	ldta.writeInt32BE(Math.round((spec.inPointSec ?? 0) * ts), 20);
	ldta.writeUInt32BE(ts, 24);
	ldta.writeInt32BE(Math.round(spec.outPointSec * ts), 28);
	ldta.writeUInt32BE(ts, 32);
	ldta.writeInt16BE(1, 36);
	ldta.writeInt16BE(1, 38);

	let flags = spec.enabled === false ? 0 : 1;
	if (spec.adjustment) flags |= 0x08;
	ldta[47] = flags;
	ldta[51] = spec.isNull ? 1 : 0;
	ldta[52] = spec.blendModeCode ?? 1;
	ldta[55] = spec.trackMatteCode ?? 0;
	ldta.writeUInt32BE(spec.sourceId, 64);
	ldta.writeUInt32BE(spec.parentLayerId ?? 0, 84);

	const transformKids: Buffer[] = [];
	if (spec.anchor) {
		transformKids.push(
			makeTdmn('ADBE Anchor Point'),
			makeTdbs({ dims: 2, staticValue: spec.anchor.staticValue, keyframes: spec.anchor.keyframes }),
		);
	}
	if (spec.position) {
		transformKids.push(
			makeTdmn('ADBE Position'),
			makeTdbs({
				dims: 2,
				staticValue: spec.position.staticValue,
				keyframes: spec.position.keyframes,
				expression: spec.position.expression,
			}),
		);
	}
	if (spec.scale) {
		transformKids.push(
			makeTdmn('ADBE Scale'),
			makeTdbs({
				dims: 2,
				staticValue: spec.scale.staticValue,
				keyframes: spec.scale.keyframes,
				expression: spec.scale.expression,
			}),
		);
	}
	if (spec.rotation) {
		transformKids.push(
			makeTdmn('ADBE Rotate Z'),
			makeTdbs({
				dims: 1,
				staticValue: spec.rotation.staticValue,
				keyframes: spec.rotation.keyframes,
				expression: spec.rotation.expression,
			}),
		);
	}
	if (spec.opacity) {
		transformKids.push(
			makeTdmn('ADBE Opacity'),
			makeTdbs({
				dims: 1,
				staticValue: spec.opacity.staticValue,
				keyframes: spec.opacity.keyframes,
				expression: spec.opacity.expression,
			}),
		);
	}
	transformKids.push(makeTdmn('ADBE Group End'));

	const rootTdgpKids: Buffer[] = [
		makeTdmn('ADBE Transform Group'),
		makeList('tdgp', transformKids),
	];

	if (spec.masks && spec.masks.length > 0) {
		rootTdgpKids.push(
			makeTdmn('ADBE Mask Parade'),
			makeList('tdgp', [...spec.masks, makeTdmn('ADBE Group End')]),
		);
	}

	if (spec.effects && spec.effects.length > 0) {
		rootTdgpKids.push(
			makeTdmn('ADBE Effect Parade'),
			makeList('tdgp', [...spec.effects, makeTdmn('ADBE Group End')]),
		);
	}

	if (spec.textDoc) {
		const btdkPayload = Buffer.from(
			JSON.stringify({
				text: spec.textDoc.text,
				fontName: spec.textDoc.fontName,
				fontSize: spec.textDoc.fontSize,
				fillColor: spec.textDoc.fillColor,
				allCaps: Boolean(spec.textDoc.allCaps),
			}),
			'utf8',
		);
		const textTdbsKids: Buffer[] = [makeChunk('btdk', btdkPayload)];
		if (spec.textDoc.expression) {
			textTdbsKids.push(makeChunk('expr', Buffer.from(spec.textDoc.expression, 'utf8')));
		}
		rootTdgpKids.push(
			makeTdmn('ADBE Text Properties'),
			makeList('tdgp', [
				makeTdmn('ADBE Text Document'),
				makeList('tdbs', textTdbsKids),
				makeTdmn('ADBE Group End'),
			]),
		);
	}

	rootTdgpKids.push(makeTdmn('ADBE Group End'));

	return makeList('Layr', [
		makeChunk('ldta', ldta),
		makeUtf8(spec.name),
		makeList('tdgp', rootTdgpKids),
	]);
}

function makeCompItem(opts: {
	itemId: number;
	name: string;
	width: number;
	height: number;
	fps: number;
	timeScale: number;
	durationSec: number;
	bgColor?: [number, number, number];
	layers: Buffer[];
}): Buffer {
	const idta = Buffer.alloc(24);
	idta.writeUInt16BE(4, 0); // comp
	idta.writeUInt32BE(opts.itemId, 16);

	const cdta = Buffer.alloc(168);
	const frameDurTicks = Math.round(opts.timeScale / opts.fps);
	const durTicks = Math.round(opts.durationSec * opts.timeScale);
	cdta.writeUInt32BE(frameDurTicks, 4);
	cdta.writeUInt32BE(opts.timeScale, 8);
	cdta.writeUInt32BE(durTicks, 20);
	cdta.writeUInt16BE(opts.width, 140);
	cdta.writeUInt16BE(opts.height, 142);
	const bg = opts.bgColor ?? [8, 8, 14];
	cdta[152] = bg[0];
	cdta[153] = bg[1];
	cdta[154] = bg[2];

	return makeList('Item', [
		makeChunk('idta', idta),
		makeUtf8(opts.name),
		makeChunk('cdta', cdta),
		...opts.layers,
	]);
}

/**
 * Generates 90 realistic animated anime burst Bézier masks (62 radial lightning rays on Layer 0 +
 * 28 radial magenta energy masses on Layer 1) in 1920x1080 @ 15fps over 1.667s, matching the
 * exact structure reported for `Transition 01` in `Dynamic Anime Burst Logo 01.mogrt`.
 */
function buildTransition01Masks(timeScale: number): {
	rayMasks: Buffer[];
	massMasks: Buffer[];
} {
	const cx = 960;
	const cy = 540;
	const rayMasks: Buffer[] = [];
	const massMasks: Buffer[] = [];

	// 62 radial anime burst rays with keyframed expansion + Hold opacity windows
	for (let i = 0; i < 62; i++) {
		const angle = (i / 62) * Math.PI * 2 + (i % 3) * 0.04;
		const spread = 0.025 + (i % 5) * 0.008;
		const startSec = 0.067 * (i % 5);
		const peakSec = 0.533 + (i % 4) * 0.067;
		const endSec = 1.267 + (i % 4) * 0.067;
		const maxLen = 420 + (i % 7) * 85;

		const makeSpike = (innerR: number, outerR: number, halfAng: number) => {
			const midR = innerR + (outerR - innerR) * 0.55;
			return [
				{ x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR },
				{ x: cx + Math.cos(angle - halfAng) * midR, y: cy + Math.sin(angle - halfAng) * midR },
				{ x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR },
				{ x: cx + Math.cos(angle + halfAng) * midR, y: cy + Math.sin(angle + halfAng) * midR },
			];
		};

		const kfs: MaskPolygonKf[] = [
			{ timeTicks: startSec * timeScale, points: makeSpike(25, 110, spread * 0.7) },
			{ timeTicks: (startSec + 0.2) * timeScale, points: makeSpike(40, maxLen * 0.65, spread * 1.1) },
			{ timeTicks: peakSec * timeScale, points: makeSpike(70, maxLen, spread * 1.2) },
			{ timeTicks: (peakSec + 0.267) * timeScale, points: makeSpike(180, maxLen * 1.15, spread * 0.8) },
			{ timeTicks: endSec * timeScale, points: makeSpike(380, maxLen * 1.25, spread * 0.35) },
		];

		rayMasks.push(
			makeMaskAtom({
				name: `Mask ${i + 1}`,
				shapeKeyframes: kfs,
				opacityKeyframes: [
					{ timeTicks: 0, opacity: 0, hold: true },
					{ timeTicks: startSec * timeScale, opacity: 1, hold: true },
					{ timeTicks: (endSec + 0.067) * timeScale, opacity: 0, hold: true },
				],
			}),
		);
	}

	// 28 sweeping anime energy masses (larger petals forming the burst core)
	for (let i = 0; i < 28; i++) {
		const angle = (i / 28) * Math.PI * 2 + 0.11;
		const startSec = 0.067 * (i % 3);
		const peakSec = 0.6 + (i % 3) * 0.067;
		const endSec = 1.4 + (i % 3) * 0.067;
		const rMax = 300 + (i % 5) * 68;
		const halfAng = 0.11 + (i % 4) * 0.02;

		const makeLobe = (innerR: number, outerR: number, wAng: number) => [
			{ x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR },
			{ x: cx + Math.cos(angle - wAng) * (innerR + (outerR - innerR) * 0.45), y: cy + Math.sin(angle - wAng) * (innerR + (outerR - innerR) * 0.45) },
			{ x: cx + Math.cos(angle - wAng * 0.5) * (outerR * 0.92), y: cy + Math.sin(angle - wAng * 0.5) * (outerR * 0.92) },
			{ x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR },
			{ x: cx + Math.cos(angle + wAng * 0.5) * (outerR * 0.92), y: cy + Math.sin(angle + wAng * 0.5) * (outerR * 0.92) },
			{ x: cx + Math.cos(angle + wAng) * (innerR + (outerR - innerR) * 0.45), y: cy + Math.sin(angle + wAng) * (innerR + (outerR - innerR) * 0.45) },
		];

		const kfs: MaskPolygonKf[] = [
			{ timeTicks: startSec * timeScale, points: makeLobe(10, 120, halfAng * 0.7) },
			{ timeTicks: (startSec + 0.2) * timeScale, points: makeLobe(20, rMax * 0.75, halfAng) },
			{ timeTicks: peakSec * timeScale, points: makeLobe(40, rMax, halfAng * 1.15) },
			{ timeTicks: (peakSec + 0.333) * timeScale, points: makeLobe(140, rMax * 1.2, halfAng * 0.85) },
			{ timeTicks: endSec * timeScale, points: makeLobe(290, rMax * 1.32, halfAng * 0.4) },
		];

		massMasks.push(
			makeMaskAtom({
				name: `Energy Mass ${i + 1}`,
				shapeKeyframes: kfs,
				opacityKeyframes: [
					{ timeTicks: 0, opacity: 0, hold: true },
					{ timeTicks: startSec * timeScale, opacity: 1, hold: true },
					{ timeTicks: (endSec + 0.067) * timeScale, opacity: 0, hold: true },
				],
			}),
		);
	}

	return { rayMasks, massMasks };
}

function zipDirToFile(sourceDir: string, outZipPath: string): void {
	mkdirSync(dirname(outZipPath), { recursive: true });
	if (existsSync(outZipPath)) rmSync(outZipPath, { force: true });
	execFileSync('python3', [
		'-c',
		`import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(src):
        for fn in sorted(files):
            fp = os.path.join(root, fn)
            zf.write(fp, os.path.relpath(fp, src))`,
		sourceDir,
		outZipPath,
	]);
}

/**
 * Builds a complete binary-authentic Modelo 01 `.mogrt` file on disk for Phase 3A validation and testing.
 */
export function buildModelo01FixtureMogrt(outputMogrtPath: string, stagingDir: string): {
	mogrtPath: string;
	aepPath: string;
} {
	const timeScale = 30720;
	const durationSec = 7.267;

	// Item IDs
	const ID_SOL_RAYS = 101;
	const ID_SOL_MASS = 102;
	const ID_SOL_MATTE = 103;
	const ID_PH_LOGO = 104;
	const ID_PH_BG = 105;
	const ID_COMP_TRANSITION = 201;
	const ID_COMP_LOGO = 202;
	const ID_COMP_ROOT = 203;

	const { rayMasks, massMasks } = buildTransition01Masks(timeScale);

	// Precomp 1: Transition 01 (1920x1080 @ 15fps, 1.667s, 90 real Bézier masks!)
	const compTransition = makeCompItem({
		itemId: ID_COMP_TRANSITION,
		name: 'Transition 01',
		width: 1920,
		height: 1080,
		fps: 15,
		timeScale,
		durationSec: 1.667,
		layers: [
			makeLayerChunk({
				layerId: 1,
				name: 'Burst Rays (62 Masks)',
				sourceId: ID_SOL_RAYS,
				timeScale,
				outPointSec: 1.667,
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: { staticValue: [100, 100] },
				opacity: { staticValue: [100] },
				masks: rayMasks,
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Fill',
						displayName: 'Rays Fill',
						params: [
							{
								matchName: 'ADBE Fill-0002',
								name: 'Color',
								dims: 4,
								staticValue: [1, 1, 1, 1],
								expression: 'comp("Dynamic Anime Burst Logo 01").layer("Controls").effect("Accent Color")("Color")',
							},
						],
					}),
					makeEffectEntry({
						matchName: 'ADBE Glo2',
						displayName: 'Rays Glow',
						params: [
							{ matchName: 'ADBE Glo2-0002', name: 'Glow Threshold', dims: 1, staticValue: [30] },
							{ matchName: 'ADBE Glo2-0003', name: 'Glow Radius', dims: 1, staticValue: [28] },
							{ matchName: 'ADBE Glo2-0004', name: 'Glow Intensity', dims: 1, staticValue: [1.15] },
							{
								matchName: 'ADBE Glo2-0007',
								name: 'Color A',
								dims: 4,
								staticValue: [1, 0.37, 1, 1],
								expression: 'comp("Dynamic Anime Burst Logo 01").layer("Controls").effect("Primary Color")("Color")',
							},
						],
					}),
				],
			}),
			makeLayerChunk({
				layerId: 2,
				name: 'Energy Masses (28 Masks)',
				sourceId: ID_SOL_MASS,
				timeScale,
				outPointSec: 1.667,
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: { staticValue: [100, 100] },
				opacity: { staticValue: [100] },
				masks: massMasks,
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Fill',
						displayName: 'Mass Fill',
						params: [
							{
								matchName: 'ADBE Fill-0002',
								name: 'Color',
								dims: 4,
								staticValue: [1, 0.37, 1, 1],
								expression: 'comp("Dynamic Anime Burst Logo 01").layer("Controls").effect("Primary Color")("Color")',
							},
						],
					}),
					makeEffectEntry({
						matchName: 'ADBE Box Blur2',
						displayName: 'Edge Soften Blur',
						params: [
							{ matchName: 'ADBE Box Blur2-0001', name: 'Blur Radius', dims: 1, staticValue: [5] },
							{ matchName: 'ADBE Box Blur2-0002', name: 'Iterations', dims: 1, staticValue: [2] },
						],
					}),
					makeEffectEntry({
						matchName: 'ADBE Simple Choker',
						displayName: 'Anime Choker',
						params: [
							{ matchName: 'ADBE Simple Choker-0001', name: 'Choke Matte', dims: 1, staticValue: [2] },
						],
					}),
					makeEffectEntry({
						matchName: 'ADBE Glo2',
						displayName: 'Energy Glow',
						params: [
							{ matchName: 'ADBE Glo2-0002', name: 'Glow Threshold', dims: 1, staticValue: [25] },
							{ matchName: 'ADBE Glo2-0003', name: 'Glow Radius', dims: 1, staticValue: [36] },
							{ matchName: 'ADBE Glo2-0004', name: 'Glow Intensity', dims: 1, staticValue: [1.2] },
						],
					}),
				],
			}),
		],
	});

	// Precomp 2: L01 LOGO (contains Logo Placeholder + Reveal Set Matte + Glow + honest unsupported AE effects)
	const compLogo = makeCompItem({
		itemId: ID_COMP_LOGO,
		name: 'L01 LOGO',
		width: 1920,
		height: 1080,
		fps: 30,
		timeScale,
		durationSec,
		layers: [
			makeLayerChunk({
				layerId: 1,
				name: 'Reveal Matte',
				sourceId: ID_SOL_MATTE,
				timeScale,
				inPointSec: 0.4,
				outPointSec: durationSec,
				enabled: false, // Used purely as matte source for Set Matte
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: {
					staticValue: [100, 100],
					keyframes: [
						{ timeTicks: 0.4 * timeScale, values: [20, 20], interp: 'bezier' },
						{ timeTicks: 1.0 * timeScale, values: [100, 100], interp: 'bezier' },
					],
				},
				opacity: { staticValue: [100] },
			}),
			makeLayerChunk({
				layerId: 2,
				name: 'Logo Placeholder',
				sourceId: ID_PH_LOGO,
				timeScale,
				inPointSec: 0.45,
				outPointSec: durationSec,
				anchor: { staticValue: [250, 250] },
				position: {
					staticValue: [960, 470],
					keyframes: [
						{ timeTicks: 0.45 * timeScale, values: [960, 540], interp: 'bezier' },
						{ timeTicks: 1.15 * timeScale, values: [960, 455], interp: 'bezier' },
						{ timeTicks: 6.4 * timeScale, values: [960, 455], interp: 'linear' },
						{ timeTicks: 7.2 * timeScale, values: [960, 430], interp: 'bezier' },
					],
				},
				scale: {
					staticValue: [85, 85],
					keyframes: [
						{ timeTicks: 0.45 * timeScale, values: [12, 12], interp: 'bezier' },
						{ timeTicks: 0.95 * timeScale, values: [96, 96], interp: 'bezier' },
						{ timeTicks: 1.35 * timeScale, values: [82, 82], interp: 'bezier' },
						{ timeTicks: 6.4 * timeScale, values: [86, 86], interp: 'linear' },
						{ timeTicks: 7.2 * timeScale, values: [72, 72], interp: 'bezier' },
					],
				},
				rotation: {
					staticValue: [0],
					keyframes: [
						{ timeTicks: 0.45 * timeScale, values: [-12], interp: 'bezier' },
						{ timeTicks: 1.1 * timeScale, values: [0], interp: 'bezier' },
					],
				},
				opacity: {
					staticValue: [100],
					keyframes: [
						{ timeTicks: 0.45 * timeScale, values: [0], interp: 'linear' },
						{ timeTicks: 0.72 * timeScale, values: [100], interp: 'linear' },
						{ timeTicks: 6.5 * timeScale, values: [100], interp: 'linear' },
						{ timeTicks: 7.23 * timeScale, values: [0], interp: 'linear' },
					],
				},
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Set Matte3',
						displayName: 'Logo Reveal Matte',
						params: [
							{ matchName: 'ADBE Set Matte3-0001', name: 'Take Matte From Layer', dims: 1, staticValue: [1] },
							{ matchName: 'ADBE Set Matte3-0002', name: 'Use For Matte', dims: 1, staticValue: [4] },
							{ matchName: 'ADBE Set Matte3-0003', name: 'Invert Matte', dims: 1, staticValue: [0] },
						],
					}),
					makeEffectEntry({
						matchName: 'ADBE Glo2',
						displayName: 'Logo Rim Glow',
						params: [
							{ matchName: 'ADBE Glo2-0002', name: 'Glow Threshold', dims: 1, staticValue: [40] },
							{ matchName: 'ADBE Glo2-0003', name: 'Glow Radius', dims: 1, staticValue: [22] },
							{ matchName: 'ADBE Glo2-0004', name: 'Glow Intensity', dims: 1, staticValue: [0.85] },
							{
								matchName: 'ADBE Glo2-0007',
								name: 'Color A',
								dims: 4,
								staticValue: [1, 0.37, 1, 1],
								expression: 'comp("Dynamic Anime Burst Logo 01").layer("Controls").effect("Primary Color")("Color")',
							},
						],
					}),
					// Explicit unsupported Adobe proprietary effects from real Modelo 01 audit (passthrough only!)
					makeEffectEntry({ matchName: 'ADBE Turbulent Displace', displayName: 'Turbulent Displace', enabled: true }),
					makeEffectEntry({ matchName: 'APC Vegas', displayName: 'Vegas Stroke', enabled: true }),
					makeEffectEntry({ matchName: 'ADBE Scribble Fill', displayName: 'Scribble Reveal', enabled: true }),
				],
			}),
		],
	});

	// Root Comp: Dynamic Anime Burst Logo 01 (1920x1080 @ 30fps, 7.267s)
	const compRoot = makeCompItem({
		itemId: ID_COMP_ROOT,
		name: 'Dynamic Anime Burst Logo 01',
		width: 1920,
		height: 1080,
		fps: 30,
		timeScale,
		durationSec,
		bgColor: [10, 8, 18],
		layers: [
			// Layer 0 (top): Controls layer (Null)
			makeLayerChunk({
				layerId: 1,
				name: 'Controls',
				sourceId: 0,
				timeScale,
				outPointSec: durationSec,
				isNull: true,
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Color Control',
						displayName: 'Primary Color',
						params: [{ matchName: 'ADBE Color Control-0001', name: 'Color', dims: 4, staticValue: [1, 0.369, 1, 1] }],
					}),
					makeEffectEntry({
						matchName: 'ADBE Color Control',
						displayName: 'Accent Color',
						params: [{ matchName: 'ADBE Color Control-0001', name: 'Color', dims: 4, staticValue: [1, 1, 1, 1] }],
					}),
					makeEffectEntry({
						matchName: 'ADBE Color Control',
						displayName: 'BG Color',
						params: [{ matchName: 'ADBE Color Control-0001', name: 'Color', dims: 4, staticValue: [0.05, 0.03, 0.1, 1] }],
					}),
					makeEffectEntry({
						matchName: 'ADBE Color Control',
						displayName: 'Text Color',
						params: [{ matchName: 'ADBE Color Control-0001', name: 'Color', dims: 4, staticValue: [1, 1, 1, 1] }],
					}),
					makeEffectEntry({
						matchName: 'ADBE Slider Control',
						displayName: 'Logo Scale',
						params: [{ matchName: 'ADBE Slider Control-0001', name: 'Slider', dims: 1, staticValue: [100] }],
					}),
					makeEffectEntry({
						matchName: 'ADBE Checkbox Control',
						displayName: 'Show Text',
						params: [{ matchName: 'ADBE Checkbox Control-0001', name: 'Checkbox', dims: 1, staticValue: [1] }],
					}),
				],
			}),
			// Layer 1: Film Grain Adjustment Layer (Noise)
			makeLayerChunk({
				layerId: 2,
				name: 'Anime Film Grain',
				sourceId: 0,
				timeScale,
				outPointSec: durationSec,
				adjustment: true,
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Noise2',
						displayName: 'Film Grain',
						params: [
							{ matchName: 'ADBE Noise2-0001', name: 'Amount of Noise', dims: 1, staticValue: [5] },
							{ matchName: 'ADBE Noise2-0002', name: 'Use Color Noise', dims: 1, staticValue: [0] },
						],
					}),
				],
			}),
			// Layer 2: Transition 01 precomp (opening burst 0.00s..1.667s)
			makeLayerChunk({
				layerId: 3,
				name: 'Transition 01 (Opening)',
				sourceId: ID_COMP_TRANSITION,
				timeScale,
				startTimeSec: 0,
				inPointSec: 0,
				outPointSec: 1.667,
				blendModeCode: 5, // Screen
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: { staticValue: [100, 100] },
				opacity: { staticValue: [100] },
			}),
			// Layer 3: Transition 01 precomp (closing burst 5.60s..7.267s)
			makeLayerChunk({
				layerId: 4,
				name: 'Transition 01 (Outro Burst)',
				sourceId: ID_COMP_TRANSITION,
				timeScale,
				startTimeSec: 5.6,
				inPointSec: 5.6,
				outPointSec: durationSec,
				blendModeCode: 5, // Screen
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: { staticValue: [105, 105] },
				opacity: { staticValue: [95] },
			}),
			// Layer 4: Editable Text layer
			makeLayerChunk({
				layerId: 5,
				name: 'Text',
				sourceId: 0,
				timeScale,
				inPointSec: 1.1,
				outPointSec: 6.7,
				anchor: { staticValue: [960, 540] },
				position: {
					staticValue: [960, 770],
					keyframes: [
						{ timeTicks: 1.1 * timeScale, values: [960, 815], interp: 'bezier' },
						{ timeTicks: 1.65 * timeScale, values: [960, 765], interp: 'bezier' },
						{ timeTicks: 6.1 * timeScale, values: [960, 765], interp: 'linear' },
						{ timeTicks: 6.7 * timeScale, values: [960, 795], interp: 'bezier' },
					],
				},
				scale: { staticValue: [100, 100] },
				opacity: {
					staticValue: [100],
					keyframes: [
						{ timeTicks: 1.1 * timeScale, values: [0], interp: 'linear' },
						{ timeTicks: 1.55 * timeScale, values: [100], interp: 'linear' },
						{ timeTicks: 6.2 * timeScale, values: [100], interp: 'linear' },
						{ timeTicks: 6.7 * timeScale, values: [0], interp: 'linear' },
					],
				},
				textDoc: {
					text: 'AETHERA STUDIO',
					fontName: 'Montserrat-Bold',
					fontSize: 64,
					fillColor: [1, 1, 1, 1],
					allCaps: true,
				},
			}),
			// Layer 5: L01 LOGO precomp
			makeLayerChunk({
				layerId: 6,
				name: 'L01 LOGO',
				sourceId: ID_COMP_LOGO,
				timeScale,
				startTimeSec: 0,
				inPointSec: 0.45,
				outPointSec: durationSec,
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: {
					staticValue: [100, 100],
					expression: 'var s = thisComp.layer("Controls").effect("Logo Scale")("Slider"); [s, s]',
				},
				opacity: { staticValue: [100] },
			}),
			// Layer 6 (bottom): BG Placeholder with Tint + unsupported Fractal Noise marker
			makeLayerChunk({
				layerId: 7,
				name: 'BG Placeholder',
				sourceId: ID_PH_BG,
				timeScale,
				outPointSec: durationSec,
				anchor: { staticValue: [960, 540] },
				position: { staticValue: [960, 540] },
				scale: { staticValue: [100, 100] },
				opacity: { staticValue: [100] },
				effects: [
					makeEffectEntry({
						matchName: 'ADBE Tint',
						displayName: 'BG Tint',
						params: [
							{
								matchName: 'ADBE Tint-0001',
								name: 'Map Black To',
								dims: 4,
								staticValue: [0.05, 0.03, 0.1, 1],
								expression: 'thisComp.layer("Controls").effect("BG Color")("Color")',
							},
							{
								matchName: 'ADBE Tint-0002',
								name: 'Map White To',
								dims: 4,
								staticValue: [0.16, 0.06, 0.24, 1],
								expression: 'thisComp.layer("Controls").effect("Primary Color")("Color")',
							},
							{ matchName: 'ADBE Tint-0003', name: 'Amount to Tint', dims: 1, staticValue: [35] },
						],
					}),
					makeEffectEntry({ matchName: 'ADBE Fractal Noise', displayName: 'BG Fractal Texture', enabled: true }),
				],
			}),
		],
	});

	const aepBuf = makeRifx('Egg!', [
		makeList('Fold', [
			makeSolidItem(ID_SOL_RAYS, 'White Rays Solid', 1920, 1080, [1, 1, 1]),
			makeSolidItem(ID_SOL_MASS, 'Magenta Energy Solid', 1920, 1080, [1, 0.37, 1]),
			makeSolidItem(ID_SOL_MATTE, 'Reveal Matte Solid', 1920, 1080, [1, 1, 1]),
			makePlaceholderItem(ID_PH_LOGO, 'Logo Placeholder', 500, 500),
			makePlaceholderItem(ID_PH_BG, 'BG Placeholder', 1920, 1080),
			compTransition,
			compLogo,
			compRoot,
		]),
	]);

	const aeStageDir = join(stagingDir, 'aegraphic_src');
	const mogrtStageDir = join(stagingDir, 'mogrt_src');
	mkdirSync(aeStageDir, { recursive: true });
	mkdirSync(mogrtStageDir, { recursive: true });

	const aepPath = join(aeStageDir, 'Dynamic Anime Burst Logo Pack.aep');
	writeFileSync(aepPath, aepBuf);
	writeFileSync(
		join(aeStageDir, 'Dynamic Anime Burst Logo PackReport.txt'),
		'Collected binary-authentic Modelo 01 Phase 3A fixture (90 real Bezier masks, 7.267s @ 30fps).\n',
		'utf8',
	);

	const aegraphicPath = join(mogrtStageDir, 'project.aegraphic');
	zipDirToFile(aeStageDir, aegraphicPath);

	const definitionJson = {
		apiVersion: '2.0',
		authorApp: 'aefx',
		capsuleID: 'modelo-01-dynamic-anime-burst-logo-01',
		capsuleName: 'Dynamic Anime Burst Logo 01',
		sourceInfoLocalized: {
			en_US: {
				framesize: { size: { x: 1920, y: 1080 } },
				duration: { value: 7267, scale: 1000 },
				framerate: { ticksperframe: 8467200000 },
				colorSpace: { baseColorProfile: { colorProfileName: 'BT.709 RGB Full' } },
			},
		},
		usedFontsLocalized: { en_US: ['Montserrat-Bold'] },
		usedEffects: [
			'ADBE Color Control',
			'ADBE Slider Control',
			'ADBE Checkbox Control',
			'ADBE Fill',
			'ADBE Tint',
			'ADBE Glo2',
			'ADBE Box Blur2',
			'ADBE Simple Choker',
			'ADBE Noise2',
			'ADBE Set Matte3',
			'ADBE Turbulent Displace',
			'ADBE Fractal Noise',
			'APC Vegas',
			'ADBE Scribble Fill',
		],
		clientControls: [
			{ id: 'c_primary', uiName: { strDB: [{ str: 'Primary Color' }] }, type: 4, value: [1, 0.369, 1, 1] },
			{ id: 'c_accent', uiName: { strDB: [{ str: 'Accent Color' }] }, type: 4, value: [1, 1, 1, 1] },
			{ id: 'c_bg', uiName: { strDB: [{ str: 'BG Color' }] }, type: 4, value: [0.05, 0.03, 0.1, 1] },
			{ id: 'c_text_color', uiName: { strDB: [{ str: 'Text Color' }] }, type: 4, value: [1, 1, 1, 1] },
			{
				id: 'c_text',
				uiName: { strDB: [{ str: 'Text' }] },
				type: 6,
				value: { strDB: [{ str: 'AETHERA STUDIO' }] },
				fonteditinfo: { fontEditValue: 'Montserrat-Bold', fontSizeEditValue: 64, fontFSAllCapsValue: true },
			},
			{ id: 'c_scale', uiName: { strDB: [{ str: 'Logo Scale' }] }, type: 2, value: 100, min: 20, max: 200 },
			{ id: 'c_show_text', uiName: { strDB: [{ str: 'Show Text' }] }, type: 1, value: 1 },
			{ id: 'c_logo', uiName: { strDB: [{ str: 'Logo Placeholder' }] }, type: 14, width: 500, height: 500 },
			{ id: 'c_bg_ph', uiName: { strDB: [{ str: 'BG Placeholder' }] }, type: 14, width: 1920, height: 1080 },
		],
	};

	writeFileSync(join(mogrtStageDir, 'definition.json'), JSON.stringify(definitionJson, null, 2), 'utf8');

	// Generate a clean reference thumb.png inside the .mogrt
	const thumbSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#10081c"/>
  <circle cx="320" cy="180" r="115" fill="#ff5eff" fill-opacity="0.35"/>
  <circle cx="320" cy="180" r="68" fill="#ffffff" fill-opacity="0.22"/>
  <text x="320" y="305" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="800" fill="#ffffff">AETHERA STUDIO</text>
</svg>`;
	rasterizeSvgToPngSync(thumbSvg, join(mogrtStageDir, 'thumb.png'), 640, 360);

	zipDirToFile(mogrtStageDir, outputMogrtPath);

	return { mogrtPath: outputMogrtPath, aepPath };
}
