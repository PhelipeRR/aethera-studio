/**
 * Aethera Recap — Multimodal Vision Health Check & Separated Engine States (Phases 2 & 5)
 *
 * Separates CLI installation, authentication, and real multimodal vision availability into
 * distinct, non-ambiguous states:
 *   - not_installed ("Não instalado")
 *   - auth_expired ("Autenticação expirada")
 *   - quota_exhausted ("Quota esgotada")
 *   - model_incompatible ("Modelo incompatível")
 *   - temporarily_unavailable ("Temporariamente indisponível")
 *   - cli_ready_untested ("CLI operacional · Visão não testada")
 *   - multimodal_available ("Multimodal disponível")
 *
 * Includes a deterministic tiny PNG probe generator and disk/memory TTL caching
 * so real vision tests do not consume user quota on repeated UI polls.
 */

import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecapVisualAnalysisPort } from './recap-vision-adapter.js';
import type { AgentCircuitBreaker } from './vision-circuit-breaker.js';
import { classifyVisionError, sanitizeErrorMessage, type VisionErrorCode } from './vision-error-classifier.js';

export const MULTIMODAL_HEALTH_STATES = [
	'multimodal_available',
	'cli_ready_untested',
	'quota_exhausted',
	'auth_expired',
	'model_incompatible',
	'temporarily_unavailable',
	'not_installed',
] as const;

export type MultimodalHealthState = (typeof MULTIMODAL_HEALTH_STATES)[number];

export const MULTIMODAL_HEALTH_LABELS: Record<MultimodalHealthState, string> = {
	multimodal_available: 'Multimodal disponível',
	cli_ready_untested: 'CLI operacional',
	quota_exhausted: 'Quota esgotada',
	auth_expired: 'Autenticação expirada',
	model_incompatible: 'Modelo incompatível',
	temporarily_unavailable: 'Temporariamente indisponível',
	not_installed: 'Não instalado',
};

export interface MultimodalProviderHealthRecord {
	providerId: string;
	label: string;
	installed: boolean;
	version: string | null;
	authenticated: boolean | null;
	authMethod: string | null;
	model: string | null;
	multimodalStatus: MultimodalHealthState;
	multimodalLabel: string;
	code?: VisionErrorCode;
	detail: string;
	resetAtText?: string;
	latencyMs?: number;
	testedWithRealImage: boolean;
	checkedAtIso: string;
}

export interface VisionHealthCheckCacheFile {
	schemaVersion: 1;
	entries: Record<string, MultimodalProviderHealthRecord>;
}

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function crc32(buf: Buffer): number {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i]!;
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const crcInput = Buffer.concat([typeBuf, data]);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(crcInput), 0);
	return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Generates a valid 24x24 RGB PNG buffer with a dark frame and white inner panel
 * so any multimodal VLM can inspect it with minimal token usage (~35 tokens).
 */
export function createTinyProbePngBuffer(width = 24, height = 24): Buffer {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: RGB
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const rowSize = 1 + width * 3;
	const raw = Buffer.alloc(height * rowSize);
	for (let y = 0; y < height; y++) {
		const rowOffset = y * rowSize;
		raw[rowOffset] = 0; // filter type: None
		for (let x = 0; x < width; x++) {
			const px = rowOffset + 1 + x * 3;
			const isInner = x >= 4 && x < width - 4 && y >= 4 && y < height - 4;
			const val = isInner ? 245 : 30;
			raw[px] = val;
			raw[px + 1] = val;
			raw[px + 2] = isInner ? 255 : 45;
		}
	}

	const idat = deflateSync(raw);
	return Buffer.concat([
		signature,
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', idat),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

export function ensureVisionHealthProbeImage(rootDir: string): string {
	const tempDir = join(rootDir, '.recap-vision-tmp');
	if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
	const probePath = join(tempDir, 'vision-health-probe.png');
	if (!existsSync(probePath)) {
		writeFileSync(probePath, createTinyProbePngBuffer(24, 24));
	}
	return probePath;
}

export function mapErrorCodeToMultimodalState(code: VisionErrorCode): MultimodalHealthState {
	switch (code) {
		case 'QUOTA_EXCEEDED':
			return 'quota_exhausted';
		case 'AUTHENTICATION_FAILED':
			return 'auth_expired';
		case 'MODEL_INCOMPATIBLE':
			return 'model_incompatible';
		case 'RATE_LIMITED':
		case 'TIMEOUT':
		case 'NETWORK_ERROR':
		case 'PROVIDER_UNAVAILABLE':
		case 'INVALID_MODEL_RESPONSE':
		case 'UNKNOWN_PROVIDER_ERROR':
		default:
			return 'temporarily_unavailable';
	}
}

export function loadVisionHealthCheckCache(cacheFilePath: string): Record<string, MultimodalProviderHealthRecord> {
	if (!existsSync(cacheFilePath)) return {};
	try {
		const raw = JSON.parse(readFileSync(cacheFilePath, 'utf-8')) as VisionHealthCheckCacheFile;
		if (raw && raw.schemaVersion === 1 && raw.entries && typeof raw.entries === 'object') {
			return raw.entries;
		}
	} catch {
		// ignore corrupted cache
	}
	return {};
}

export function saveVisionHealthCheckCache(
	cacheFilePath: string,
	entries: Record<string, MultimodalProviderHealthRecord>,
): void {
	const dir = dirname(cacheFilePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const payload: VisionHealthCheckCacheFile = {
		schemaVersion: 1,
		entries,
	};
	const tmp = `${cacheFilePath}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
	renameSync(tmp, cacheFilePath);
}

export interface VisionHealthProbeCandidate {
	id: string;
	label: string;
	getCliStatus: () => Promise<{
		installed: boolean;
		version: string | null;
		authenticated: boolean | null;
		authMethod: string | null;
		problems: string[];
	}>;
	port: RecapVisualAnalysisPort;
}

/**
 * Computes passive multimodal health status without executing a live VLM call
 * (combines CLI status, circuit breaker state, and recent cached vision test result).
 */
export async function inspectPassiveMultimodalHealth(input: {
	candidates: readonly VisionHealthProbeCandidate[];
	circuitBreaker: AgentCircuitBreaker;
	cacheFilePath?: string;
	cacheTtlMs?: number;
}): Promise<MultimodalProviderHealthRecord[]> {
	const ttl = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const cachedEntries = input.cacheFilePath ? loadVisionHealthCheckCache(input.cacheFilePath) : {};
	const now = Date.now();
	const records: MultimodalProviderHealthRecord[] = [];

	for (const candidate of input.candidates) {
		const cli = await candidate.getCliStatus();
		const checkedAtIso = new Date().toISOString();

		if (!cli.installed) {
			records.push({
				providerId: candidate.id,
				label: candidate.label,
				installed: false,
				version: null,
				authenticated: null,
				authMethod: null,
				model: candidate.port.model,
				multimodalStatus: 'not_installed',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.not_installed,
				code: 'PROVIDER_UNAVAILABLE',
				detail: cli.problems[0] ?? `${candidate.label} não instalado.`,
				testedWithRealImage: false,
				checkedAtIso,
			});
			continue;
		}

		if (cli.authenticated === false) {
			records.push({
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: false,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: 'auth_expired',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.auth_expired,
				code: 'AUTHENTICATION_FAILED',
				detail: cli.problems[0] ?? `${candidate.label} sem autenticação ativa.`,
				testedWithRealImage: false,
				checkedAtIso,
			});
			continue;
		}

		// 1. Check live circuit breaker state from recent runs
		const cbState = input.circuitBreaker.getState(candidate.id);
		if (cbState && cbState.state === 'open' && cbState.code) {
			const mmStatus = mapErrorCodeToMultimodalState(cbState.code);
			records.push({
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: mmStatus === 'auth_expired' ? false : cli.authenticated,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: mmStatus,
				multimodalLabel: MULTIMODAL_HEALTH_LABELS[mmStatus],
				code: cbState.code,
				detail: sanitizeErrorMessage(cbState.reason ?? MULTIMODAL_HEALTH_LABELS[mmStatus]),
				...(cbState.resetAtText ? { resetAtText: cbState.resetAtText } : {}),
				testedWithRealImage: true,
				checkedAtIso: cbState.openedAtIso ?? checkedAtIso,
			});
			continue;
		}

		// 2. Check cached real vision health test result
		const cached = cachedEntries[candidate.id];
		if (cached && cached.testedWithRealImage) {
			const ageMs = now - new Date(cached.checkedAtIso).getTime();
			if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttl) {
				records.push({
					...cached,
					installed: cli.installed,
					version: cli.version ?? cached.version,
					model: candidate.port.model ?? cached.model,
				});
				continue;
			}
		}

		// 3. CLI is installed and authenticated, but vision has not been actively probed yet
		if (cli.problems.length > 0) {
			records.push({
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: cli.authenticated,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: 'temporarily_unavailable',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.temporarily_unavailable,
				code: 'PROVIDER_UNAVAILABLE',
				detail: sanitizeErrorMessage(cli.problems.join('; ')),
				testedWithRealImage: false,
				checkedAtIso,
			});
			continue;
		}

		records.push({
			providerId: candidate.id,
			label: candidate.label,
			installed: true,
			version: cli.version,
			authenticated: cli.authenticated,
			authMethod: cli.authMethod,
			model: candidate.port.model,
			multimodalStatus: 'cli_ready_untested',
			multimodalLabel: MULTIMODAL_HEALTH_LABELS.cli_ready_untested,
			detail: `CLI instalado (${cli.version ?? 'ativo'}) e autenticado. Clique em "Testar visão" para validar chamada multimodal com imagem real.`,
			testedWithRealImage: false,
			checkedAtIso,
		});
	}

	return records;
}

/**
 * Executes a real multimodal vision health check with a tiny probe image on one or all providers.
 * Caches results on disk and updates the circuit breaker so subsequent Recap runs immediately
 * skip providers with exhausted quota or incompatible models.
 */
export async function runMultimodalVisionHealthCheck(input: {
	rootDir: string;
	candidates: readonly VisionHealthProbeCandidate[];
	circuitBreaker: AgentCircuitBreaker;
	providerId?: string;
	force?: boolean;
	cacheFilePath?: string;
	cacheTtlMs?: number;
	signal?: AbortSignal;
}): Promise<MultimodalProviderHealthRecord[]> {
	const ttl = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const cachedEntries = input.cacheFilePath ? loadVisionHealthCheckCache(input.cacheFilePath) : {};
	const now = Date.now();
	const probePath = ensureVisionHealthProbeImage(input.rootDir);
	const results: MultimodalProviderHealthRecord[] = [];

	for (const candidate of input.candidates) {
		if (input.providerId && candidate.id !== input.providerId) {
			const existing = cachedEntries[candidate.id];
			if (existing) {
				results.push(existing);
			}
			continue;
		}

		if (!input.force) {
			const cached = cachedEntries[candidate.id];
			if (cached && cached.testedWithRealImage) {
				const ageMs = now - new Date(cached.checkedAtIso).getTime();
				if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttl) {
					results.push(cached);
					continue;
				}
			}
		}

		const startTime = Date.now();
		const cli = await candidate.getCliStatus();
		const checkedAtIso = new Date().toISOString();

		if (!cli.installed) {
			const rec: MultimodalProviderHealthRecord = {
				providerId: candidate.id,
				label: candidate.label,
				installed: false,
				version: null,
				authenticated: null,
				authMethod: null,
				model: candidate.port.model,
				multimodalStatus: 'not_installed',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.not_installed,
				code: 'PROVIDER_UNAVAILABLE',
				detail: cli.problems[0] ?? `${candidate.label} não instalado.`,
				testedWithRealImage: false,
				checkedAtIso,
			};
			cachedEntries[candidate.id] = rec;
			results.push(rec);
			continue;
		}

		if (cli.authenticated === false) {
			const rec: MultimodalProviderHealthRecord = {
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: false,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: 'auth_expired',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.auth_expired,
				code: 'AUTHENTICATION_FAILED',
				detail: cli.problems[0] ?? `${candidate.label} não autenticado.`,
				testedWithRealImage: false,
				checkedAtIso,
			};
			input.circuitBreaker.open(candidate.id, 'AUTHENTICATION_FAILED', rec.detail);
			cachedEntries[candidate.id] = rec;
			results.push(rec);
			continue;
		}

		try {
			const det = await candidate.port.detect(input.signal);
			if (!det.available) {
				const classified = classifyVisionError(det.reason, candidate.id, 'PROVIDER_UNAVAILABLE');
				const mmStatus = mapErrorCodeToMultimodalState(classified.code);
				const rec: MultimodalProviderHealthRecord = {
					providerId: candidate.id,
					label: candidate.label,
					installed: true,
					version: cli.version,
					authenticated: mmStatus === 'auth_expired' ? false : cli.authenticated,
					authMethod: cli.authMethod,
					model: candidate.port.model,
					multimodalStatus: mmStatus,
					multimodalLabel: MULTIMODAL_HEALTH_LABELS[mmStatus],
					code: classified.code,
					detail: sanitizeErrorMessage(det.reason || classified.message),
					...(classified.resetAtText ? { resetAtText: classified.resetAtText } : {}),
					latencyMs: Date.now() - startTime,
					testedWithRealImage: false,
					checkedAtIso,
				};
				input.circuitBreaker.recordError(candidate.id, classified);
				cachedEntries[candidate.id] = rec;
				results.push(rec);
				continue;
			}

			const frames = [{ hash: 'vision-health-probe', path: probePath }];
			let sampleDescription = '';
			if (candidate.port.analyze) {
				const analysis = await candidate.port.analyze({
					frames,
					context: 'Health check multimodal: descreva brevemente a imagem de teste.',
					...(input.signal ? { signal: input.signal } : {}),
				});
				if (!analysis || analysis.confidence <= 0 || !analysis.description?.trim()) {
					throw new Error('Provedor retornou análise visual vazia ou confiança zero.');
				}
				sampleDescription = analysis.description.trim();
			} else if (candidate.port.describe) {
				const desc = await candidate.port.describe({
					frames,
					...(input.signal ? { signal: input.signal } : {}),
				});
				if (!desc?.description?.trim()) {
					throw new Error('Provedor retornou descrição visual vazia.');
				}
				sampleDescription = desc.description.trim();
			} else {
				throw new Error('Modelo configurado não possui suporte a entrada de imagens (sem analyze/describe).');
			}

			const latencyMs = Date.now() - startTime;
			input.circuitBreaker.clearProvider(candidate.id);
			input.circuitBreaker.recordSuccess(candidate.id);

			const rec: MultimodalProviderHealthRecord = {
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: true,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: 'multimodal_available',
				multimodalLabel: MULTIMODAL_HEALTH_LABELS.multimodal_available,
				detail: `Visão multimodal validada (${latencyMs}ms): "${sanitizeErrorMessage(sampleDescription, 140)}"`,
				latencyMs,
				testedWithRealImage: true,
				checkedAtIso,
			};
			cachedEntries[candidate.id] = rec;
			results.push(rec);
		} catch (err) {
			const latencyMs = Date.now() - startTime;
			const classified = classifyVisionError(err, candidate.id);
			const mmStatus = mapErrorCodeToMultimodalState(classified.code);
			input.circuitBreaker.recordError(candidate.id, classified);
			if (
				classified.code === 'QUOTA_EXCEEDED' ||
				classified.code === 'AUTHENTICATION_FAILED' ||
				classified.code === 'MODEL_INCOMPATIBLE'
			) {
				input.circuitBreaker.open(candidate.id, classified.code, classified.message, classified.resetAtText);
			}
			const rec: MultimodalProviderHealthRecord = {
				providerId: candidate.id,
				label: candidate.label,
				installed: true,
				version: cli.version,
				authenticated: mmStatus === 'auth_expired' ? false : cli.authenticated,
				authMethod: cli.authMethod,
				model: candidate.port.model,
				multimodalStatus: mmStatus,
				multimodalLabel: MULTIMODAL_HEALTH_LABELS[mmStatus],
				code: classified.code,
				detail: classified.message,
				...(classified.resetAtText ? { resetAtText: classified.resetAtText } : {}),
				latencyMs,
				testedWithRealImage: true,
				checkedAtIso,
			};
			cachedEntries[candidate.id] = rec;
			results.push(rec);
		}
	}

	if (input.cacheFilePath) {
		saveVisionHealthCheckCache(input.cacheFilePath, cachedEntries);
	}

	return results;
}
