/**
 * MotionVelix MOGRT Engine: what an editor needs around the renderer.
 *
 * Describes a template's editable controls in the units `MogrtRenderOverrides` takes, and renders
 * single preview pictures.
 */

import { parseAepProjectGraph, type AepControlBinding, type AepControlKind } from './aep-comp-graph.js';
import { flattenOverBlack, renderMogrtFrameRgba, type MogrtRenderOverrides } from './mogrt-comp-renderer.js';
import type { ControlOverrideValue } from './mogrt-expression-eval.js';
import { inspectMogrtFile } from './mogrt-importer.js';
import { writeRgbaBufferToPng } from './mogrt-media-loader.js';

export { mogrtOutputSize } from './mogrt-output-size.js';

export interface MogrtEditableControl {
	name: string;
	kind: Exclude<AepControlKind, 'media'>;
	value: ControlOverrideValue;
}

export interface MogrtTemplateDescription {
	name: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	thumbnailPath: string | null;
	media: Array<'logo' | 'background'>;
	controls: MogrtEditableControl[];
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function currentValue({ kind, layer, property }: AepControlBinding): ControlOverrideValue | undefined {
	if (kind === 'text') return layer.textDoc?.text.replaceAll('\u0003', '\n').replace(/\r\n?/g, '\n');
	if (!property) return undefined;
	const value = property.staticValue;
	switch (kind) {
		case 'boolean':
			return value[0]! > 0;
		case 'color': {
			const channels =
				property.unit === 'color_argb255' ? value.slice(1, 4) : value.slice(0, 3).map((channel) => channel * 255);
			const hex = channels.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0'));
			return `#${hex.join('')}`;
		}
		case 'point':
			return value.slice(0, 2).map(round);
		case 'scale': {
			const [x = 0, y = x] = value.map((part) => round(part * 100));
			return x === y ? x : [x, y];
		}
		default:
			return round(value[0]!);
	}
}

export function describeMogrtTemplate(mogrtPath: string, workDir: string): MogrtTemplateDescription {
	const inspection = inspectMogrtFile(mogrtPath, workDir);
	if (!inspection.aepPath) {
		throw new Error('Este .mogrt não tem um projeto do After Effects. Os criados no Premiere não são suportados.');
	}
	const graph = parseAepProjectGraph(inspection.aepPath, { preferredRootCompName: inspection.name });
	const root = graph.compositionsById.get(graph.rootCompId)!;

	// Overrides are keyed by name, so controls that share one are edited together.
	const controls = new Map<string, MogrtEditableControl>();
	const media = new Set<'logo' | 'background'>();
	for (const binding of graph.controls) {
		if (binding.kind === 'media') {
			if (binding.layer.kind === 'logo_placeholder') media.add('logo');
			else if (binding.layer.kind === 'bg_placeholder') media.add('background');
			continue;
		}
		if (controls.has(binding.name)) continue;
		const value = currentValue(binding);
		if (value !== undefined) controls.set(binding.name, { name: binding.name, kind: binding.kind, value });
	}

	return {
		name: inspection.name,
		width: root.width,
		height: root.height,
		fps: root.fps,
		durationSec: root.durationSec,
		thumbnailPath: inspection.thumbnailPath,
		media: [...media],
		controls: [...controls.values()],
	};
}

export function renderMogrtPreviewPng(options: {
	mogrtPath: string;
	workDir: string;
	outputPngPath: string;
	tSec: number;
	width: number;
	height: number;
	overrides?: MogrtRenderOverrides;
}): void {
	const { outputPngPath, ...render } = options;
	const { frame } = renderMogrtFrameRgba(render);
	// Over black, like the MP4.
	flattenOverBlack(frame);
	writeRgbaBufferToPng(frame, outputPngPath);
}
