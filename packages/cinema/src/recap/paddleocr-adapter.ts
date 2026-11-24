import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import type {
	RecapLocalizedOcrAdapter,
	RecapLocalizedOcrRequest,
	RecapLocalizedOcrResult,
	RecapRecoveryBoundingBox,
} from './recap-fidelity-recovery.js';
import type { OcrAdapter } from './recap-types.js';

export const PADDLE_OCR_ADAPTER_VERSION = 'paddleocr-adapter-v1';

export interface PaddleOcrLine {
	text: string;
	confidence: number | null;
	boundingBox: RecapRecoveryBoundingBox;
	polygon: readonly [number, number][];
}

export interface PaddleOcrResult extends RecapLocalizedOcrResult {
	lines: readonly PaddleOcrLine[];
	processingMs: number;
	model: string | null;
	provenance: {
		adapterVersion: string;
		engine: 'paddleocr';
		engineVersion: string | null;
		sourcePath: string;
		imageSha256: string;
		region: RecapRecoveryBoundingBox | null;
		cacheKey: string;
		cacheHit: boolean;
	};
	error: string | null;
	status: 'success' | 'failed' | 'cancelled' | 'timeout' | 'cache_hit';
	cacheHit: boolean;
}

export interface PaddleOcrAdapterOptions {
	/** Python 3.11 venv executable; defaults to AETHERA_PADDLEOCR_PYTHON or python. */
	pythonPath?: string;
	workerScriptPath?: string;
	cacheDirectory?: string;
	ledgerPath?: string;
	model?: string;
	lang?: string;
	timeoutMs?: number;
	preprocessingVersion?: string;
	workerEnv?: Record<string, string>;
	budget?: PaddleOcrBudgetPort;
}

export interface PaddleOcrBudgetPort {
	reserveCall(input: { kind: 'ocr'; estimatedInputTokens?: number | null; estimatedOutputTokens?: number | null }): unknown;
	settleCall(reservation: unknown, usage: { inputTokens?: number | null; outputTokens?: number | null; wallMs?: number | null; errorCode?: string | null }): Promise<void>;
}

interface PaddleWorkerResponse {
	type: 'ready' | 'result' | 'error';
	id?: string;
	model?: string | null;
	engineVersion?: string | null;
	result?: {
		lines?: readonly {
			text?: string;
			confidence?: number | null;
			box?: readonly number[];
			polygon?: readonly (readonly number[])[];
		}[];
		model?: string | null;
		engineVersion?: string | null;
	};
	error?: string;
}

interface CachedPaddleOcrResult extends PaddleOcrResult {
	cacheKey: string;
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
	writeFileSync(temp, content, 'utf8');
	renameSync(temp, path);
}

function sanitizeError(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 600);
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalizeRegion(region: RecapRecoveryBoundingBox | null | undefined): RecapRecoveryBoundingBox | null {
	if (!region) return null;
	if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w <= 0 || region.h <= 0) return null;
	return { x: Math.round(region.x), y: Math.round(region.y), w: Math.round(region.w), h: Math.round(region.h) };
}

function cacheKeyFor(input: RecapLocalizedOcrRequest, imageSha256: string, options: Required<Pick<PaddleOcrAdapterOptions, 'model' | 'lang' | 'preprocessingVersion'>>): string {
	return createHash('sha256').update(JSON.stringify({
		version: PADDLE_OCR_ADAPTER_VERSION,
		imageSha256,
		region: normalizeRegion(input.region),
		model: options.model,
		lang: options.lang,
		preprocessingVersion: options.preprocessingVersion,
	})).digest('hex');
}

function parseBox(box: readonly number[] | undefined): RecapRecoveryBoundingBox | null {
	if (!box || box.length < 4 || !box.slice(0, 4).every(Number.isFinite)) return null;
	const x1 = box[0];
	const y1 = box[1];
	const x2 = box[2];
	const y2 = box[3];
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
	return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

function toResultLines(result: PaddleWorkerResponse['result']): PaddleOcrLine[] {
	return (result?.lines ?? []).flatMap((line) => {
		const box = parseBox(line.box);
		const text = typeof line.text === 'string' ? line.text.trim() : '';
		if (!box || !text) return [];
		const polygon = (line.polygon ?? []).flatMap((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [[point[0], point[1]] as [number, number]] : []);
		return [{ text, confidence: typeof line.confidence === 'number' ? line.confidence : null, boundingBox: box, polygon }];
	});
}

class PaddleOcrWorkerClient {
	private process: ChildProcessWithoutNullStreams | null = null;
	private ready: Promise<void> | null = null;
	private buffer = '';
	private readonly pending = new Map<string, { resolve: (value: PaddleWorkerResponse) => void; reject: (error: Error) => void }>();

	constructor(private readonly options: { pythonPath: string; workerScriptPath: string; model: string; lang: string; workerEnv?: Record<string, string> }) {}

	private handleLine(line: string): void {
		let message: PaddleWorkerResponse;
		try { message = JSON.parse(line) as PaddleWorkerResponse; } catch { return; }
		if (message.type === 'ready') return;
		if (!message.id) return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.type === 'error') pending.reject(new Error(message.error ?? 'PaddleOCR worker error.'));
		else pending.resolve(message);
	}

	private failPending(error: Error): void {
		for (const item of this.pending.values()) item.reject(error);
		this.pending.clear();
	}

	private async ensureReady(timeoutMs: number): Promise<void> {
		if (this.ready) return this.ready;
		this.process = spawn(this.options.pythonPath, [this.options.workerScriptPath, '--model', this.options.model, '--lang', this.options.lang], {
			stdio: 'pipe',
			env: {
				...process.env,
				...(this.options.workerEnv ?? {}),
				FLAGS_use_mkldnn: '0',
				PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
				OMP_NUM_THREADS: '1',
				MKL_NUM_THREADS: '1',
			},
		});
		this.process.stdout.on('data', (chunk: Buffer | string) => {
			this.buffer += chunk.toString();
			let end = this.buffer.indexOf('\n');
			while (end >= 0) {
				const line = this.buffer.slice(0, end).trim();
				this.buffer = this.buffer.slice(end + 1);
				if (line) this.handleLine(line);
				end = this.buffer.indexOf('\n');
			}
		});
		this.process.on('error', (error) => this.failPending(error));
		this.process.on('exit', (code, signal) => {
			this.failPending(new Error(`PaddleOCR worker exited (${code ?? 'null'}/${signal ?? 'null'}).`));
			this.process = null;
			this.ready = null;
		});
		this.ready = new Promise<void>((resolveReady, rejectReady) => {
			const timer = setTimeout(() => rejectReady(new Error(`PaddleOCR worker startup timeout after ${timeoutMs}ms.`)), timeoutMs);
			const onData = (chunk: Buffer | string) => {
				const text = chunk.toString();
				if (text.includes('"type": "ready"') || text.includes('"type":"ready"')) {
					clearTimeout(timer);
					this.process?.stdout.off('data', onData);
					resolveReady();
				}
			};
			this.process?.stdout.on('data', onData);
		}).catch((error) => {
			this.kill();
			this.ready = null;
			throw error;
		});
		return this.ready;
	}

	async request(payload: { id: string; imagePath: string; region: RecapRecoveryBoundingBox | null }, timeoutMs: number, signal?: AbortSignal): Promise<PaddleWorkerResponse> {
		if (signal?.aborted) throw new Error('PaddleOCR request cancelled before start.');
		await this.ensureReady(timeoutMs);
		if (!this.process?.stdin.writable) throw new Error('PaddleOCR worker stdin is unavailable.');
		return new Promise<PaddleWorkerResponse>((resolveResponse, rejectResponse) => {
			const id = payload.id;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.kill();
				rejectResponse(new Error(`PaddleOCR request timeout after ${timeoutMs}ms.`));
			}, timeoutMs);
			const onAbort = () => {
				clearTimeout(timer);
				this.pending.delete(id);
				this.kill();
				rejectResponse(new Error('PaddleOCR request cancelled.'));
			};
			this.pending.set(id, {
				resolve: (response) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolveResponse(response); },
				reject: (error) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); rejectResponse(error); },
			});
			signal?.addEventListener('abort', onAbort, { once: true });
			this.process!.stdin.write(`${JSON.stringify(payload)}\n`);
		});
	}

	kill(): void {
		this.failPending(new Error('PaddleOCR worker stopped.'));
		this.process?.kill();
		this.process = null;
		this.ready = null;
	}
}

export function createPaddleOcrAdapter(options: PaddleOcrAdapterOptions = {}): PaddleOcrAdapter {
	const model = options.model ?? 'PP-OCRv6_medium_det+rec';
	const lang = options.lang ?? 'en';
	const timeoutMs = options.timeoutMs ?? 45_000;
	const preprocessingVersion = options.preprocessingVersion ?? 'paddleocr-cpu-no-mkldnn-v1';
	const cacheDirectory = resolve(options.cacheDirectory ?? '.aethera-recap-data/phase4b8-paddleocr/cache');
	const ledgerPath = options.ledgerPath ?? join(cacheDirectory, 'paddleocr-ledger.jsonl');
	const worker = new PaddleOcrWorkerClient({
		pythonPath: options.pythonPath ?? process.env['AETHERA_PADDLEOCR_PYTHON'] ?? 'python',
		workerScriptPath: options.workerScriptPath ?? resolve(process.cwd(), 'scripts/paddleocr-worker.py'),
		model,
		lang,
		...(options.workerEnv ? { workerEnv: options.workerEnv } : {}),
	});
	let queue = Promise.resolve();
	const inFlight = new Map<string, Promise<PaddleOcrResult>>();

	const recognizeDetailed = (input: RecapLocalizedOcrRequest): Promise<PaddleOcrResult> => {
		const imageSha256 = sha256File(input.imagePath);
		const region = normalizeRegion(input.region);
		const cacheKey = cacheKeyFor(input, imageSha256, { model, lang, preprocessingVersion });
		const cachedPath = join(cacheDirectory, `${cacheKey}.json`);
		const existing = inFlight.get(cacheKey);
		if (existing) return existing;
		const task = queue.then(async () => {
			if (existsSync(cachedPath)) {
				try {
					const cached = JSON.parse(readFileSync(cachedPath, 'utf8')) as CachedPaddleOcrResult;
					if (cached.cacheKey === cacheKey && cached.status === 'success') {
						const result: PaddleOcrResult = { ...cached, cacheHit: true, status: 'cache_hit', processingMs: 0, provenance: { ...cached.provenance, cacheHit: true } };
						appendFileSync(ledgerPath, `${JSON.stringify({ ...result, cacheKey, cacheHit: true, timestampIso: new Date().toISOString() })}\n`, 'utf8');
						return result;
					}
				} catch { /* corrupted cache is a miss and is never used as evidence */ }
			}
			const started = Date.now();
			let reservation: unknown = null;
			try {
				reservation = options.budget?.reserveCall({ kind: 'ocr', estimatedInputTokens: null, estimatedOutputTokens: null }) ?? null;
				const response = await worker.request({ id: randomUUID(), imagePath: input.imagePath, region }, timeoutMs, input.signal);
				if (reservation !== null && options.budget) await options.budget.settleCall(reservation, { inputTokens: null, outputTokens: null, wallMs: Date.now() - started });
				const lines = toResultLines(response.result);
				const text = lines.map((line) => line.text).join('\n').trim();
				const confidence = lines.length ? Math.min(...lines.map((line) => line.confidence ?? 0)) : null;
				const result: PaddleOcrResult = {
					text,
					confidence,
					language: lang,
					region: region ? `${region.x},${region.y},${region.w},${region.h}` : null,
					inputTokens: null,
					outputTokens: null,
					validatedAgainstImage: false,
					evidence: `PaddleOCR ${model} reconheceu ${lines.length} linha(s); validação visual independente é necessária.`,
					lines,
					processingMs: Date.now() - started,
					model,
					provenance: { adapterVersion: PADDLE_OCR_ADAPTER_VERSION, engine: 'paddleocr', engineVersion: response.result?.engineVersion ?? null, sourcePath: input.imagePath, imageSha256, region, cacheKey, cacheHit: false },
					error: null,
					status: 'success',
					cacheHit: false,
				};
				atomicWrite(cachedPath, `${JSON.stringify({ ...result, cacheKey }, null, 2)}\n`);
				mkdirSync(dirname(ledgerPath), { recursive: true });
				appendFileSync(ledgerPath, `${JSON.stringify({ ...result, cacheKey, cacheHit: false, timestampIso: new Date().toISOString() })}\n`, 'utf8');
				return result;
			} catch (error) {
				const message = sanitizeError(error);
				if (reservation !== null && options.budget) {
					try { await options.budget.settleCall(reservation, { inputTokens: null, outputTokens: null, wallMs: Date.now() - started, errorCode: /RECAP_PILOT_/iu.test(message) ? 'RECAP_PILOT_BUDGET_EXCEEDED' : 'PADDLEOCR_FAILED' }); } catch { /* budget pause is already persisted */ }
				}
				const aborted = input.signal?.aborted === true;
				const result: PaddleOcrResult = {
					text: '', confidence: null, language: lang, region: region ? `${region.x},${region.y},${region.w},${region.h}` : null,
					inputTokens: null, outputTokens: null, validatedAgainstImage: false,
					evidence: `PaddleOCR não produziu texto: ${message}`,
					lines: [], processingMs: Date.now() - started, model, provenance: { adapterVersion: PADDLE_OCR_ADAPTER_VERSION, engine: 'paddleocr', engineVersion: null, sourcePath: input.imagePath, imageSha256, region, cacheKey, cacheHit: false }, error: message,
					status: aborted ? 'cancelled' : /timeout/i.test(message) ? 'timeout' : 'failed', cacheHit: false,
				};
				mkdirSync(dirname(ledgerPath), { recursive: true });
				appendFileSync(ledgerPath, `${JSON.stringify({ ...result, cacheKey, timestampIso: new Date().toISOString() })}\n`, 'utf8');
				return result;
			}
		});
		queue = task.then(() => undefined, () => undefined);
		inFlight.set(cacheKey, task);
		void task.finally(() => inFlight.delete(cacheKey));
		return task;
	};

	return {
		name: `paddleocr-${model}-${lang}`,
		recognize: recognizeDetailed,
		recognizeDetailed,
		terminate: async () => worker.kill(),
	};
}

export interface PaddleOcrAdapter extends RecapLocalizedOcrAdapter {
	recognizeDetailed(input: RecapLocalizedOcrRequest): Promise<PaddleOcrResult>;
	terminate(): Promise<void>;
}

/**
 * Bridges the persistent/localized PaddleOCR adapter to the panel extractor's generic OCR port.
 * Buffer inputs are materialized as content-addressed PNG files so the worker always receives a
 * real path and the same bytes can be reused after a process restart.
 */
export function createPaddleOcrTextAdapter(options: PaddleOcrAdapterOptions = {}): OcrAdapter & { terminate(): Promise<void> } {
	const detailed = createPaddleOcrAdapter(options);
	const inputDirectory = resolve(options.cacheDirectory ?? '.aethera-recap-data/phase4b8-paddleocr/cache', 'inputs');
	return {
		name: detailed.name,
		recognize: async (imageOrPath) => {
			let imagePath: string;
			if (typeof imageOrPath === 'string') {
				imagePath = imageOrPath;
			} else {
				const digest = createHash('sha256').update(imageOrPath).digest('hex');
				imagePath = join(inputDirectory, `${digest}.png`);
				if (!existsSync(imagePath)) {
					mkdirSync(dirname(imagePath), { recursive: true });
					const tempPath = `${imagePath}.${process.pid}.${randomUUID()}.tmp`;
					writeFileSync(tempPath, imageOrPath);
					renameSync(tempPath, imagePath);
				}
			}
			const result = await detailed.recognize({ panelId: `extract-${sha256File(imagePath).slice(0, 16)}`, imagePath });
			return { text: result.text, confidence: result.confidence ?? 0 };
		},
		terminate: detailed.terminate,
	};
}
