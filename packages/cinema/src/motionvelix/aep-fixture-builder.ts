/**
 * Synthetic `.mogrt` writer for pipeline tests. This is NOT an After Effects file and proves nothing
 * about compatibility with real templates.
 *
 * It writes the few records the pipeline tests need, at the offsets measured on real projects (see
 * aep-binary.ts). Never change the decoder to make this fixture pass: the real-file acceptance test
 * is the source of truth, and this writer follows it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { crc32 } from 'node:zlib';

export const SYNTHETIC_MOGRT = { name: 'Synthetic Burst', width: 640, height: 360, fps: 30, durationSec: 2 } as const;

const TIME_SCALE = 30720;
const ROOT_ID = 1;
const BURST_ID = 2;
const LOGO_ID = 3;
const SOLID_ID = 4;
const CONTROLS_LAYER_ID = 10;
const LOGO_LAYER_ID = 11;
const MAGENTA_ARGB = [255, 255, 0, 255];

function chunk(id: string, data: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.write(id, 0, 'latin1');
	header.writeUInt32BE(data.length, 4);
	return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

function list(type: string, children: Buffer[], container: 'LIST' | 'RIFX' = 'LIST'): Buffer {
	return chunk(container, Buffer.concat([Buffer.from(type, 'latin1'), ...children]));
}

function record(size: number, fill: (buf: Buffer) => void): Buffer {
	const buf = Buffer.alloc(size);
	fill(buf);
	return buf;
}

const utf8 = (text: string): Buffer => chunk('Utf8', Buffer.from(text, 'utf8'));
const matchName = (name: string): Buffer => chunk('tdmn', Buffer.from(`${name}\0`, 'latin1'));
const wrappedName = (id: string, text: string): Buffer => chunk(id, utf8(text));
const uint32 = (value: number): Buffer => record(4, (buf) => buf.writeUInt32BE(value, 0));

function recordList(count: number, size: number, data: Buffer): Buffer {
	const header = record(52, (buf) => {
		buf.writeUInt32BE(count, 8);
		buf.writeUInt32BE(size, 16);
	});
	return list('list', [chunk('lhd3', header), chunk('ldat', data)]);
}

function property(value: number[], options: { colour?: boolean; expression?: string } = {}): Buffer {
	const header = record(124, (buf) => {
		buf.writeUInt16BE(value.length, 2);
		if (options.colour) buf[59] = 1;
	});
	const stored = record(value.length * 8, (buf) => value.forEach((v, i) => buf.writeDoubleBE(v, i * 8)));
	return list('tdbs', [
		chunk('tdb4', header),
		chunk('cdat', stored),
		...(options.expression ? [utf8(options.expression)] : []),
	]);
}

function effect(name: string, displayName: string, params: Array<[string, Buffer]>, definitions: Buffer[] = []): Buffer {
	return Buffer.concat([
		matchName(name),
		list('sspc', [
			wrappedName('fnam', displayName),
			list('parT', definitions),
			list('tdgp', [wrappedName('tdsn', displayName), ...params.flatMap(([id, value]) => [matchName(id), value])]),
		]),
	]);
}

function colourDefinition(id: string, name: string): Buffer {
	const definition = record(148, (buf) => {
		buf.writeUInt32BE(5, 12);
		buf.write(name, 16, 'latin1');
	});
	return Buffer.concat([matchName(id), chunk('pard', definition)]);
}

/** A rectangular Difference mask held at the same shape on two keys. */
function mask(left: number, top: number, right: number, bottom: number): Buffer {
	const { width, height } = SYNTHETIC_MOGRT;
	const bounds = record(24, (buf) => {
		[left / width, top / height, right / width, bottom / height].forEach((v, i) => buf.writeFloatBE(v, 4 + i * 4));
	});
	// Stored per vertex: point, out handle, in handle of the next vertex. Corners have no handles.
	const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
	const stored = corners.flatMap((corner, i) => [corner, corner, corners[(i + 1) % corners.length]!]);
	const points = record(stored.length * 8, (buf) => stored.flat().forEach((v, i) => buf.writeFloatBE(v, i * 4)));
	const shape = list('shap', [chunk('shph', bounds), recordList(stored.length, 8, points)]);
	const keys = record(16, (buf) => {
		buf[5] = 3; // hold
		buf.writeInt32BE(TIME_SCALE, 8);
		buf[13] = 3;
	});
	const mode = record(8, (buf) => buf.writeUInt16BE(6, 6));
	return Buffer.concat([
		matchName('ADBE Mask Atom'),
		chunk('mkif', mode),
		list('tdgp', [
			matchName('ADBE Mask Shape'),
			list('om-s', [list('tdbs', [recordList(2, 8, keys)]), list('omks', [shape, shape])]),
		]),
	]);
}

function layer(spec: {
	id: number;
	name: string;
	sourceId?: number;
	startSec?: number;
	durationSec: number;
	isNull?: boolean;
	hidden?: boolean;
	effects?: Buffer[];
	masks?: Buffer[];
}): Buffer {
	const header = record(160, (buf) => {
		buf.writeUInt32BE(spec.id, 0);
		buf.writeInt32BE(1, 8);
		buf.writeInt32BE(Math.round((spec.startSec ?? 0) * TIME_SCALE), 12);
		buf.writeUInt32BE(TIME_SCALE, 16);
		buf.writeUInt32BE(TIME_SCALE, 24);
		buf.writeInt32BE(Math.round(spec.durationSec * TIME_SCALE), 28);
		buf.writeUInt32BE(TIME_SCALE, 32);
		if (spec.isNull) buf[38] = 0x80;
		buf[39] = spec.hidden ? 0x04 : 0x05;
		buf.writeUInt32BE(spec.sourceId ?? 0, 40);
		buf.writeUInt32BE(2, 96);
		buf.writeUInt32BE(1, 108);
	});
	const groups = [
		...(spec.masks ? [matchName('ADBE Mask Parade'), list('tdgp', spec.masks)] : []),
		...(spec.effects ? [matchName('ADBE Effect Parade'), list('tdgp', spec.effects)] : []),
	];
	return list('Layr', [chunk('ldta', header), utf8(spec.name), list('tdgp', groups)]);
}

function item(id: number, name: string, body: Buffer[]): Buffer {
	return list('Item', [chunk('idta', record(84, (buf) => buf.writeUInt32BE(id, 16))), utf8(name), ...body]);
}

function composition(width: number, height: number, fps: number, durationSec: number): Buffer {
	const header = record(160, (buf) => {
		buf.writeUInt32BE(TIME_SCALE / fps, 4);
		buf.writeUInt32BE(TIME_SCALE, 8);
		buf.writeUInt32BE(TIME_SCALE, 24);
		buf.writeUInt32BE(Math.round(durationSec * TIME_SCALE), 44);
		buf.writeUInt32BE(TIME_SCALE, 48);
		buf.writeUInt16BE(width, 140);
		buf.writeUInt16BE(height, 142);
		buf.writeUInt16BE(fps, 156);
	});
	return chunk('cdta', header);
}

function control(name: string, type: number, layerId: number, path: Array<{ index: number; matchName: string }>): Buffer {
	return list('CCtl', [
		chunk('CTyp', uint32(type)),
		list('CpS2', [utf8(name)]),
		list('CPrp', [chunk('CCId', uint32(ROOT_ID)), chunk('CLId', uint32(layerId)), utf8(JSON.stringify({ ...path }))]),
	]);
}

function project(hideBurst: boolean): Buffer {
	const { name, width, height, fps, durationSec } = SYNTHETIC_MOGRT;
	const colourParam = 'ADBE Color Control-0001';

	const root = item(ROOT_ID, name, [
		composition(width, height, fps, durationSec),
		layer({
			id: CONTROLS_LAYER_ID,
			name: 'Controls',
			durationSec,
			isNull: true,
			effects: [
				effect(
					'ADBE Color Control',
					'Burst Color',
					[[colourParam, property(MAGENTA_ARGB, { colour: true })]],
					[colourDefinition(colourParam, 'Color')],
				),
			],
		}),
		layer({ id: LOGO_LAYER_ID, name: 'Logo Placeholder', sourceId: LOGO_ID, startSec: 1.2, durationSec: 0.8 }),
		layer({
			id: 12,
			name: 'Burst',
			sourceId: BURST_ID,
			startSec: 0.5,
			durationSec: 1.5,
			hidden: hideBurst,
			effects: [effect('ADBE Wave Warp', 'Wave Warp', [])],
		}),
	]);

	const expression = `comp("${name}").layer("Controls").effect("Burst Color")("Color")`;
	const fill = effect('ADBE Fill', 'Fill', [
		['ADBE Fill-0002', property(MAGENTA_ARGB, { colour: true, expression })],
		['ADBE Fill-0005', property([1])],
	]);
	const burst = item(BURST_ID, 'Burst', [
		composition(width, height, 15, 1.5),
		layer({
			id: 20,
			name: 'Masked solid',
			sourceId: SOLID_ID,
			durationSec: 1.5,
			effects: [fill],
			masks: [mask(160, 90, 360, 250), mask(280, 110, 480, 270)],
		}),
	]);

	const logo = item(LOGO_ID, 'Logo Placeholder', [composition(100, 100, fps, durationSec)]);
	const solidSize = record(60, (buf) => {
		buf.writeUInt16BE(width, 32);
		buf.writeUInt16BE(height, 36);
	});
	const solidOptions = record(40, (buf) => {
		buf.write('Soli', 0, 'latin1');
		for (const offset of [14, 18, 22]) buf.writeFloatBE(1, offset);
	});
	const solid = item(SOLID_ID, 'White Solid', [list('Pin ', [chunk('sspc', solidSize), chunk('opti', solidOptions)])]);

	const controls = list('CIF3', [
		list('CpS2', [utf8(name)]),
		control('Burst Color', 4, CONTROLS_LAYER_ID, [
			{ index: 0, matchName: 'ADBE Effect Parade' },
			{ index: 0, matchName: 'ADBE Color Control' },
			{ index: 1, matchName: colourParam },
		]),
		control('Logo Placeholder', 14, LOGO_LAYER_ID, []),
	]);
	return list('Egg!', [list('Fold', [root, burst, logo, solid]), controls], 'RIFX');
}

/** A stored (uncompressed) ZIP, so building a fixture needs no external tool. */
function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
	const bodies: Buffer[] = [];
	const directory: Buffer[] = [];
	let offset = 0;
	for (const { name, data } of files) {
		const nameBytes = Buffer.from(name, 'utf8');
		const common = record(26, (buf) => {
			buf.writeUInt16LE(20, 0); // version needed
			buf.writeUInt16LE(0x21, 8); // 1980-01-01, so builds are reproducible
			buf.writeUInt32LE(crc32(data), 10);
			buf.writeUInt32LE(data.length, 14);
			buf.writeUInt32LE(data.length, 18);
			buf.writeUInt16LE(nameBytes.length, 22);
		});
		const local = Buffer.concat([Buffer.from('504b0304', 'hex'), common, nameBytes, data]);
		const central = record(46, (buf) => {
			buf.write('504b0102', 0, 'hex');
			buf.writeUInt16LE(20, 4); // version made by
			common.copy(buf, 6);
			buf.writeUInt32LE(offset, 42);
		});
		bodies.push(local);
		directory.push(central, nameBytes);
		offset += local.length;
	}
	const entries = Buffer.concat(directory);
	const end = record(22, (buf) => {
		buf.write('504b0506', 0, 'hex');
		buf.writeUInt16LE(files.length, 8);
		buf.writeUInt16LE(files.length, 10);
		buf.writeUInt32LE(entries.length, 12);
		buf.writeUInt32LE(offset, 16);
	});
	return Buffer.concat([...bodies, entries, end]);
}

/**
 * Writes the synthetic template: a null with a colour control, a logo placeholder and a nested comp
 * with two overlapping masks. `hideBurst` yields a project that renders black.
 */
export function buildSyntheticMogrt(outputMogrtPath: string, options: { hideBurst?: boolean } = {}): void {
	const { name, width, height, fps, durationSec } = SYNTHETIC_MOGRT;
	const definition = {
		capsuleName: name,
		capsuleNameLocalized: { en_US: name },
		sourceInfoLocalized: {
			en_US: {
				name,
				framesize: { size: { x: width, y: height } },
				duration: { value: durationSec * fps, scale: fps },
				framerate: { ticksperframe: 254016000000 / fps },
			},
		},
		usedEffects: ['ADBE Color Control', 'ADBE Fill', 'ADBE Wave Warp'],
		clientControls: [],
	};
	const aegraphic = zip([{ name: 'synthetic.aep', data: project(options.hideBurst ?? false) }]);
	mkdirSync(dirname(outputMogrtPath), { recursive: true });
	writeFileSync(
		outputMogrtPath,
		zip([
			{ name: 'definition.json', data: Buffer.from(JSON.stringify(definition), 'utf8') },
			{ name: 'project.aegraphic', data: aegraphic },
		]),
	);
}
