/** The main process's side of the MOGRT page: holds the paths, checks what the page sends, runs the worker. */

import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { rm } from 'node:fs/promises';
import { mogrtOutputSize } from '../../../../packages/cinema/src/motionvelix/mogrt-output-size.js';
import {
	MOGRT_RESOLUTIONS,
	type MogrtEditRequest,
	type MogrtMediaSlot,
	type MogrtPreviewRequest,
	type MogrtProgress,
	type MogrtRenderRequest,
	type MogrtRenderResult,
	type MogrtRenderSummary,
	type MogrtTemplate,
	type MogrtValue,
} from '../renderer/src/mogrt-studio-contract.js';
import type { MogrtJob, MogrtWorkerMessage } from './mogrt-worker-protocol.js';

const MAX_TEMPLATE_BYTES = 512 * 2 ** 20;
const MAX_MEDIA_BYTES = 64 * 2 ** 20;
const MAX_TEXT_LENGTH = 2000;
const PREVIEW_LONG_EDGE = 960;
export const MOGRT_MEDIA_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];

interface OpenTemplate {
	info: MogrtTemplate;
	dir: string;
	mogrtPath: string;
	media: Partial<Record<MogrtMediaSlot, string>>;
	lastPreview?: string;
}

function isValue(value: unknown): value is MogrtValue {
	if (typeof value === 'string') return value.length <= MAX_TEXT_LENGTH;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value === 'boolean') return true;
	return Array.isArray(value) && value.length <= 4 && value.every((part) => Number.isFinite(part));
}

/** `maxRetries` of `rm` only applies to folders, and the encoder can hold its file for a moment after the worker is gone. */
async function removeFile(path: string): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			await rm(path, { force: true });
			return;
		} catch (error) {
			if (attempt >= 30) {
				console.warn('[mogrt] file not removed', error);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

export function createMogrtStudioService(options: {
	workerPath: string;
	tempDir: string;
	rendersDir: string;
	/** Used when the system has no FFmpeg of its own. */
	ffmpegPath?: string;
}) {
	const { workerPath, tempDir, rendersDir, ffmpegPath } = options;
	const templates = new Map<string, OpenTemplate>();
	const renders = new Map<string, string>();
	let active: { worker: Worker; cancelled: boolean; exited: Promise<void> } | null = null;

	const workerEnv = (): NodeJS.ProcessEnv => {
		// A worker's copy of the environment is case-sensitive, and Windows usually spells it `Path`.
		const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
		const path = [process.env[pathKey], ffmpegPath && dirname(ffmpegPath)].filter(Boolean).join(delimiter);
		// The engine starts Node through process.execPath, which inside Electron is the app itself.
		return { ...process.env, [pathKey]: path, ELECTRON_RUN_AS_NODE: '1' };
	};

	function run<T>(job: MogrtJob, onProgress?: (progress: MogrtProgress) => void): Promise<T> {
		if (active) return Promise.reject(new Error('Já há uma operação MOGRT em andamento.'));
		return new Promise<T>((resolve, reject) => {
			const worker = new Worker(workerPath, { workerData: job, env: workerEnv() });
			let markExited!: () => void;
			const current = { worker, cancelled: false, exited: new Promise<void>((done) => (markExited = done)) };
			active = current;
			let result: { value: T } | undefined;
			let failure: Error | undefined;

			worker.on('message', (message: MogrtWorkerMessage) => {
				if (message.type === 'progress') {
					if (!current.cancelled) onProgress?.({ done: message.done, total: message.total });
				} else result = { value: message.value as T };
			});
			worker.on('error', (error) => {
				failure = error instanceof Error ? error : new Error(String(error));
				// How Node words a program that isn't on PATH.
				if (/spawn(Sync)? ffmpeg ENOENT/.test(failure.message)) {
					failure = new Error('FFmpeg não encontrado. Instale o FFmpeg, coloque-o no PATH e reabra o Aethera.');
				}
			});
			// Settle on exit, so that the next job never starts beside a dying one.
			worker.on('exit', () => {
				active = null;
				markExited();
				if (current.cancelled) reject(new Error('Operação cancelada.'));
				else if (result) resolve(result.value);
				else reject(failure ?? new Error('O motor MOGRT encerrou sem resposta.'));
			});
		});
	}

	function find(id: string): OpenTemplate {
		const template = templates.get(id);
		if (!template) throw new Error('Template não encontrado. Importe o arquivo de novo.');
		return template;
	}

	function overridesOf(template: OpenTemplate, values: MogrtEditRequest['values']) {
		const names = new Set(template.info.controls.map((control) => control.name));
		for (const [name, value] of Object.entries(values ?? {})) {
			if (!names.has(name) || !isValue(value)) throw new Error(`Controle inválido: "${name.slice(0, 80)}".`);
		}
		return {
			controls: { ...values },
			...(template.media.logo ? { logoPath: template.media.logo } : {}),
			...(template.media.background ? { bgImagePath: template.media.background } : {}),
		};
	}

	return {
		async importTemplate(sourcePath: string): Promise<MogrtTemplate> {
			if (extname(sourcePath).toLowerCase() !== '.mogrt') throw new Error('Escolha um arquivo .mogrt.');
			if (statSync(sourcePath).size > MAX_TEMPLATE_BYTES) throw new Error('O .mogrt passa de 512 MB.');
			const id = randomUUID();
			const dir = join(tempDir, id);
			mkdirSync(dir, { recursive: true });
			const mogrtPath = join(dir, 'template.mogrt');
			copyFileSync(sourcePath, mogrtPath);
			const described = await run<Omit<MogrtTemplate, 'id' | 'fileName'>>({
				type: 'inspect',
				mogrtPath,
				workDir: join(dir, 'inspect'),
			});
			const info: MogrtTemplate = { ...described, id, fileName: basename(sourcePath) };
			templates.set(id, { info, dir, mogrtPath, media: {} });
			return info;
		},

		/** `sourcePath` comes from the main process's own dialog; null clears the slot. */
		setMedia(id: string, slot: MogrtMediaSlot, sourcePath: string | null): string | null {
			const template = find(id);
			if (!template.info.media.includes(slot)) throw new Error('O template não tem esse espaço de mídia.');
			if (sourcePath === null) {
				delete template.media[slot];
				return null;
			}
			const extension = extname(sourcePath).toLowerCase().slice(1);
			if (!MOGRT_MEDIA_EXTENSIONS.includes(extension)) throw new Error('Formato de imagem não suportado.');
			if (statSync(sourcePath).size > MAX_MEDIA_BYTES) throw new Error('A imagem passa de 64 MB.');
			const copy = join(template.dir, `${slot}-${randomUUID()}.${extension}`);
			copyFileSync(sourcePath, copy);
			template.media[slot] = copy;
			return basename(sourcePath);
		},

		async preview({ id, values, tSec }: MogrtPreviewRequest): Promise<{ path: string }> {
			const template = find(id);
			const { info, dir, mogrtPath } = template;
			const overrides = overridesOf(template, values);
			if (!Number.isFinite(tSec)) throw new Error('Instante inválido.');
			const path = join(dir, `preview-${randomUUID()}.png`);
			await run<null>({
				type: 'preview',
				mogrtPath,
				workDir: join(dir, 'preview'),
				outputPath: path,
				overrides,
				// The instant after the last frame is empty.
				tSec: Math.min(info.durationSec - 1 / info.fps, Math.max(0, tSec)),
				...mogrtOutputSize(info.width, info.height, PREVIEW_LONG_EDGE),
			});
			if (template.lastPreview) await removeFile(template.lastPreview);
			template.lastPreview = path;
			return { path };
		},

		async render(
			{ id, values, longEdge }: MogrtRenderRequest,
			onProgress: (progress: MogrtProgress) => void,
		): Promise<MogrtRenderResult> {
			const template = find(id);
			const overrides = overridesOf(template, values);
			if (!MOGRT_RESOLUTIONS.some((allowed) => allowed === longEdge)) throw new Error('Resolução inválida.');
			if (active) throw new Error('Já há uma operação MOGRT em andamento.');
			mkdirSync(rendersDir, { recursive: true });
			const renderId = randomUUID();
			const path = join(rendersDir, `${renderId}.mp4`);
			const size = mogrtOutputSize(template.info.width, template.info.height, longEdge);
			try {
				const summary = await run<MogrtRenderSummary>(
					{
						type: 'render',
						mogrtPath: template.mogrtPath,
						workDir: join(template.dir, 'render'),
						outputPath: path,
						overrides,
						...size,
					},
					onProgress,
				);
				renders.set(renderId, path);
				return { ...summary, renderId, path, ...size };
			} catch (error) {
				await removeFile(path);
				throw error;
			}
		},

		async cancel(): Promise<void> {
			const current = active;
			if (!current) return;
			current.cancelled = true;
			void current.worker.terminate();
			await current.exited;
		},

		renderPath(renderId: string): string {
			const path = renders.get(renderId);
			if (!path) throw new Error('Render não encontrado.');
			return path;
		},
	};
}

export type MogrtStudioService = ReturnType<typeof createMogrtStudioService>;
