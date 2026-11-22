import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

export type MogrtControlKind =
	| 'group'
	| 'boolean'
	| 'number'
	| 'angle'
	| 'color'
	| 'point'
	| 'text'
	| 'scale'
	| 'media_placeholder'
	| 'unknown';

export interface MogrtControlDescriptor {
	id: string;
	name: string;
	kind: MogrtControlKind;
	rawType: number;
	defaultValue: unknown;
	min?: number;
	max?: number;
	childrenIds?: string[];
	mediaMeta?: {
		width?: number;
		height?: number;
		thumbnail?: string;
		startTimeTicks?: number;
		endTimeTicks?: number;
		timeScale?: number;
	};
	fontMeta?: {
		fontName?: string;
		fontSize?: number;
		allCaps?: boolean;
		bold?: boolean;
		italic?: boolean;
	};
}

export type MogrtEffectSupportTier =
	| 'native_exact'
	| 'webgl_approximable'
	| 'adobe_proprietary_gap';

export interface MogrtEffectCompatibility {
	matchName: string;
	support: MogrtEffectSupportTier;
	reason: string;
}

export interface MogrtEmbeddedAsset {
	relativePath: string;
	absolutePath: string;
	kind: 'video' | 'image' | 'audio' | 'aep_project' | 'thumbnail' | 'report' | 'other';
	sizeBytes: number;
}

export interface MogrtInspectionResult {
	sourcePath: string;
	workingDir: string;
	capsuleId: string;
	name: string;
	authorApp: string;
	apiVersion: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	colorProfile: string;
	usedFonts: string[];
	controls: MogrtControlDescriptor[];
	placeholders: MogrtControlDescriptor[];
	thumbnailPath: string | null;
	aepPath: string | null;
	embeddedAssets: MogrtEmbeddedAsset[];
	embeddedMediaCount: number;
	effects: MogrtEffectCompatibility[];
	compatibilitySummary: {
		controlsExtractable: boolean;
		hasPreRenderedMedia: boolean;
		nativeExactEffects: number;
		webglApproximableEffects: number;
		proprietaryGapEffects: number;
		canRenderFaithfullyWithoutAdobe: boolean;
		verdict: string;
	};
}

const NATIVE_EXACT_EFFECTS = new Set([
	'ADBE Checkbox Control',
	'ADBE Color Control',
	'ADBE Point Control',
	'ADBE Slider Control',
	'ADBE Angle Control',
	'ADBE Layer Control',
	'ADBE Fill',
	'ADBE Tint',
	'ADBE Geometry2',
	'ADBE Drop Shadow',
	'ADBE Shift Channels',
	'ADBE Set Matte3',
	'ADBE Ramp',
	'ADBE Exposure2',
]);

const WEBGL_APPROXIMABLE_EFFECTS = new Set([
	'ADBE Box Blur2',
	'ADBE Gaussian Blur 2',
	'ADBE Glo2',
	'ADBE CurvesCustom',
	'ADBE Noise2',
	'ADBE Mosaic',
	'ADBE Posterize Time',
	'ADBE Displacement Map',
	'ADBE Simple Choker',
	'CC Radial Blur',
	'CC Radial Fast Blur',
]);

export function classifyAfterEffectsMatchName(matchName: string): MogrtEffectCompatibility {
	if (NATIVE_EXACT_EFFECTS.has(matchName)) {
		return {
			matchName,
			support: 'native_exact',
			reason: 'Parâmetro de controle ou operação direta de cor/transformação/matte reproduzível com alta fidelidade em Remotion/WebGL.',
		};
	}
	if (WEBGL_APPROXIMABLE_EFFECTS.has(matchName)) {
		return {
			matchName,
			support: 'webgl_approximable',
			reason: 'Processamento de imagem reproduzível por shader WebGL2 equivalente (80–95% de fidelidade; pode haver microdiferenças de kernel/seed).',
		};
	}
	return {
		matchName,
		support: 'adobe_proprietary_gap',
		reason: 'Efeito gerativo ou plugin proprietário da Adobe sem algoritmo público; não deve ser substituído silenciosamente por efeito genérico.',
	};
}

function mapRawControlType(rawType: number): MogrtControlKind {
	switch (rawType) {
		case 1:
			return 'boolean';
		case 2:
			return 'number';
		case 3:
			return 'angle';
		case 4:
			return 'color';
		case 5:
			return 'point';
		case 6:
			return 'text';
		case 9:
			return 'scale';
		case 10:
			return 'group';
		case 14:
			return 'media_placeholder';
		default:
			return 'unknown';
	}
}

function rgbaFloatArrayToHex(val: unknown): string | null {
	if (!Array.isArray(val) || val.length < 3) return null;
	const nums = val.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v) * 255))));
	if (nums.some((n) => Number.isNaN(n))) return null;
	return `#${nums.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function walkDir(dir: string): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...walkDir(full));
		else out.push(full);
	}
	return out;
}

function classifyAssetKind(relPath: string): MogrtEmbeddedAsset['kind'] {
	const lower = relPath.toLowerCase();
	const ext = extname(lower);
	if (ext === '.aep') return 'aep_project';
	if (['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(ext)) return 'video';
	if (['.wav', '.mp3', '.aac', '.m4a', '.ogg'].includes(ext)) return 'audio';
	if (lower.includes('thumb')) return 'thumbnail';
	if (['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.psd'].includes(ext)) return 'image';
	if (lower.endsWith('report.txt')) return 'report';
	return 'other';
}

function unpackZipSafe(zipPath: string, targetDir: string): void {
	mkdirSync(targetDir, { recursive: true });
	if (process.platform === 'win32') {
		// Windows 10/11 ships bsdtar (`tar -xf`) which natively handles ZIP archives regardless of extension (.mogrt / .aegraphic / .zip).
		execFileSync('tar', ['-xf', zipPath, '-C', targetDir]);
		return;
	}
	try {
		execFileSync('unzip', ['-qo', zipPath, '-d', targetDir]);
	} catch {
		execFileSync('python3', ['-m', 'zipfile', '-e', zipPath, targetDir]);
	}
}

/**
 * Inspects a `.mogrt` file (working strictly on an isolated copy inside `workRoot`)
 * and returns parsed controls, placeholders, embedded assets, and an honest compatibility matrix.
 */
export function inspectMogrtFile(mogrtPath: string, workRoot: string): MogrtInspectionResult {
	if (!existsSync(mogrtPath)) {
		throw new Error(`MOGRT file not found: ${mogrtPath}`);
	}

	const slug = basename(mogrtPath, extname(mogrtPath)).replace(/[^a-zA-Z0-9._-]+/g, '_');
	const workingDir = join(workRoot, slug);
	const unpackedDir = join(workingDir, 'mogrt');
	const copyPath = join(workingDir, basename(mogrtPath));

	mkdirSync(unpackedDir, { recursive: true });
	copyFileSync(mogrtPath, copyPath);
	unpackZipSafe(copyPath, unpackedDir);

	const defPath = join(unpackedDir, 'definition.json');
	if (!existsSync(defPath)) {
		throw new Error(`Invalid .mogrt archive (missing definition.json): ${mogrtPath}`);
	}

	const def = JSON.parse(readFileSync(defPath, 'utf8')) as Record<string, any>;
	const sourceInfo = def.sourceInfoLocalized?.en_US ?? Object.values(def.sourceInfoLocalized ?? {})[0] ?? {};

	const width = Number(sourceInfo?.framesize?.size?.x ?? 1920);
	const height = Number(sourceInfo?.framesize?.size?.y ?? 1080);
	const durVal = Number(sourceInfo?.duration?.value ?? 0);
	const durScale = Number(sourceInfo?.duration?.scale ?? 1);
	const durationSec = durScale > 0 ? durVal / durScale : 0;

	// Adobe ticks-per-second = 254016000000; ticksperframe = 8467200000 => 30 fps
	const ticksPerFrame = Number(sourceInfo?.framerate?.ticksperframe ?? 8467200000);
	const fps = ticksPerFrame > 0 ? Math.round((254016000000 / ticksPerFrame) * 100) / 100 : 30;

	const colorProfile = String(sourceInfo?.colorSpace?.baseColorProfile?.colorProfileName ?? 'unknown');
	const usedFonts: string[] = Array.isArray(def.usedFontsLocalized?.en_US)
		? def.usedFontsLocalized.en_US
		: [];

	const rawControls: any[] = Array.isArray(def.clientControls) ? def.clientControls : [];
	const controls: MogrtControlDescriptor[] = rawControls.map((c) => {
		const rawType = Number(c.type ?? -1);
		const kind = mapRawControlType(rawType);
		const name = String(c.uiName?.strDB?.[0]?.str ?? c.uiName ?? c.id ?? 'Unnamed');
		let defaultValue: unknown = c.value;
		if (kind === 'text') {
			defaultValue = c.value?.strDB?.[0]?.str ?? String(c.value ?? '');
		} else if (kind === 'color') {
			defaultValue = {
				rgba: c.value,
				hex: rgbaFloatArrayToHex(c.value),
			};
		}

		const desc: MogrtControlDescriptor = {
			id: String(c.id ?? ''),
			name,
			kind,
			rawType,
			defaultValue,
		};
		if (typeof c.min === 'number') desc.min = c.min;
		if (typeof c.max === 'number') desc.max = c.max;
		if (kind === 'group' && Array.isArray(c.value)) {
			desc.childrenIds = c.value.map(String);
		}
		if (kind === 'media_placeholder') {
			desc.mediaMeta = {
				width: typeof c.width === 'number' ? c.width : undefined,
				height: typeof c.height === 'number' ? c.height : undefined,
				thumbnail: typeof c.thumbnail === 'string' ? c.thumbnail : undefined,
				startTimeTicks: typeof c.starttime === 'number' ? c.starttime : undefined,
				endTimeTicks: typeof c.endtime === 'number' ? c.endtime : undefined,
				timeScale: typeof c.timescale === 'number' ? c.timescale : undefined,
			};
		}
		if (kind === 'text' && c.fonteditinfo) {
			desc.fontMeta = {
				fontName: c.fonteditinfo.fontEditValue,
				fontSize: c.fonteditinfo.fontSizeEditValue,
				allCaps: Boolean(c.fonteditinfo.fontFSAllCapsValue),
				bold: Boolean(c.fonteditinfo.fontFSBoldValue),
				italic: Boolean(c.fonteditinfo.fontFSItalicValue),
			};
		}
		return desc;
	});

	const placeholders = controls.filter((c) => c.kind === 'media_placeholder');

	// Unpack project.aegraphic if present
	const innerFiles = walkDir(unpackedDir);
	const aegraphic = innerFiles.find((f) => f.toLowerCase().endsWith('.aegraphic'));
	const aeOutDir = join(workingDir, 'aegraphic');
	if (aegraphic) {
		unpackZipSafe(aegraphic, aeOutDir);
	}

	const allExtracted = [...innerFiles, ...(existsSync(aeOutDir) ? walkDir(aeOutDir) : [])];
	const embeddedAssets: MogrtEmbeddedAsset[] = allExtracted
		.filter((f) => !f.toLowerCase().endsWith('.aegraphic') && basename(f) !== 'definition.json')
		.map((f) => {
			const rel = relative(workingDir, f).replace(/\\/g, '/');
			return {
				relativePath: rel,
				absolutePath: f,
				kind: classifyAssetKind(rel),
				sizeBytes: statSync(f).size,
			};
		});

	const aepAsset = embeddedAssets.find((a) => a.kind === 'aep_project') ?? null;
	const thumbFile = existsSync(join(unpackedDir, 'thumb.png')) ? join(unpackedDir, 'thumb.png') : null;
	const embeddedMediaCount = embeddedAssets.filter(
		(a) => a.kind === 'video' || a.kind === 'audio' || a.kind === 'image',
	).length;

	const rawEffects: string[] = Array.isArray(def.usedEffects) ? def.usedEffects.map(String) : [];
	const effects = rawEffects.map(classifyAfterEffectsMatchName);
	const nativeExactEffects = effects.filter((e) => e.support === 'native_exact').length;
	const webglApproximableEffects = effects.filter((e) => e.support === 'webgl_approximable').length;
	const proprietaryGapEffects = effects.filter((e) => e.support === 'adobe_proprietary_gap').length;

	const canRenderFaithfullyWithoutAdobe =
		proprietaryGapEffects === 0 && (embeddedMediaCount > 0 || webglApproximableEffects === 0);

	const verdict = canRenderFaithfullyWithoutAdobe
		? 'Compatível para reprodução nativa sem Adobe.'
		: proprietaryGapEffects > 0
			? `Controles e máscaras extraíveis, mas possui ${proprietaryGapEffects} efeito(s) proprietário(s) da Adobe (${effects
					.filter((e) => e.support === 'adobe_proprietary_gap')
					.map((e) => e.matchName)
					.join(', ')}) sem reprodução fiel garantida sem motor equivalente.`
			: `Requer shaders WebGL equivalentes para ${webglApproximableEffects} efeito(s) de imagem.`;

	return {
		sourcePath: mogrtPath,
		workingDir,
		capsuleId: String(def.capsuleID ?? ''),
		name: String(def.capsuleName ?? slug),
		authorApp: String(def.authorApp ?? 'unknown'),
		apiVersion: String(def.apiVersion ?? 'unknown'),
		width,
		height,
		fps,
		durationSec: Math.round(durationSec * 1000) / 1000,
		colorProfile,
		usedFonts,
		controls,
		placeholders,
		thumbnailPath: thumbFile,
		aepPath: aepAsset?.absolutePath ?? null,
		embeddedAssets,
		embeddedMediaCount,
		effects,
		compatibilitySummary: {
			controlsExtractable: controls.length > 0,
			hasPreRenderedMedia: embeddedMediaCount > 0,
			nativeExactEffects,
			webglApproximableEffects,
			proprietaryGapEffects,
			canRenderFaithfullyWithoutAdobe,
			verdict,
		},
	};
}

/**
 * Imports either a single `.mogrt` file or a `.zip` pack containing multiple `.mogrt` files
 * (always operating on isolated copies inside `workRoot`).
 */
export function importMogrtOrZipPack(inputPath: string, workRoot: string): MogrtInspectionResult[] {
	const ext = extname(inputPath).toLowerCase();
	if (ext === '.mogrt') {
		return [inspectMogrtFile(inputPath, workRoot)];
	}
	if (ext === '.zip') {
		const packExtractDir = join(workRoot, '_zip_pack');
		unpackZipSafe(inputPath, packExtractDir);
		const mogrts = walkDir(packExtractDir).filter((f) => f.toLowerCase().endsWith('.mogrt'));
		return mogrts.map((m) => inspectMogrtFile(m, join(workRoot, 'templates')));
	}
	throw new Error(`Unsupported file extension for MOGRT importer: ${ext}`);
}
