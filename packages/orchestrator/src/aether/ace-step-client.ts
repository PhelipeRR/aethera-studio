import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { generatedMusicTrackSchema, musicGenerationSchema, musicLicenseSchema, type GeneratedMusicTrack, type TimelineDocument } from '@neuralbridge/shared';

export const ACE_STEP_PROVIDER_ID = 'ace-step-local';
export const ACE_STEP_MODEL_CARD_URL = 'https://huggingface.co/ACE-Step/Ace-Step1.5';
export const ACE_STEP_SOFTWARE_LICENSE_URL = 'https://github.com/ACE-Step/ACE-Step-1.5/blob/main/LICENSE';
export const ACE_STEP_EVALUATION_EVIDENCE = 'docs/aethera/ace-step-1.5-evaluation-2026-11-12.md';

const localHostnames = new Set(['127.0.0.1', 'localhost', '::1']);

export const aceStepConfigSchema = z.strictObject({
  baseUrl: z.string().url().default('http://127.0.0.1:8001'),
  modelId: z.literal('acestep-v15-turbo').default('acestep-v15-turbo'),
  lmModelPath: z.literal('acestep-5Hz-lm-0.6B').nullable().default('acestep-5Hz-lm-0.6B'),
  lmBackend: z.enum(['pt', 'vllm', 'mlx']).default('pt'),
  softwareVersion: z.string().min(1).default('1.5'),
  modelRevision: z.string().min(1).default('unresolved-local'),
  inferenceSteps: z.number().int().positive().default(8),
  guidanceScale: z.number().positive().default(7),
  batchSize: z.literal(1).default(1),
  timeoutMs: z.number().int().positive().default(3_600_000),
  pollIntervalMs: z.number().int().positive().default(1_000),
  apiKey: z.string().min(1).optional(),
});
export type AceStepConfig = z.infer<typeof aceStepConfigSchema>;

export const aceStepGenerationRequestSchema = z.strictObject({
  prompt: z.string().min(1),
  durationMs: z.number().int().positive().min(10_000).max(480_000),
  bpm: z.number().int().min(30).max(300).nullable().default(null),
  keyScale: z.string().max(64).default(''),
  timeSignature: z.string().max(16).default(''),
  seed: z.number().int().min(-1).default(-1),
  inferenceSteps: z.number().int().positive().max(100).optional(),
  guidanceScale: z.number().positive().max(30).optional(),
  audioFormat: z.enum(['wav', 'flac']).default('wav'),
});
export type AceStepGenerationRequest = z.input<typeof aceStepGenerationRequestSchema>;

const licenseEvidenceSchema = z.strictObject({
  software: z.strictObject({ name: z.string().min(1), license: z.string().min(1), source: z.string().url() }),
  ditWeights: z.strictObject({ model: z.string().min(1), license: z.string().min(1), source: z.string().url() }),
  lmWeights: z.strictObject({ model: z.string().min(1), license: z.string().min(1), source: z.string().url() }).nullable(),
  outputStatement: z.string().min(1),
  evidence: z.string().min(1),
});

const generatedResultSchema = z.object({
  file: z.string().min(1),
  metas: z.record(z.string(), z.unknown()).optional(),
  seed_value: z.union([z.string(), z.number()]).optional(),
  dit_model: z.string().optional(),
  lm_model: z.string().optional(),
});

const taskSchema = z.object({ task_id: z.string().min(1), status: z.number().int().min(0).max(2), result: z.unknown().optional(), error: z.string().optional() });

export interface AceStepHttp {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export interface AceStepProbe {
  health: Record<string, unknown>;
  modelIds: string[];
  configuredModelAvailable: boolean;
}

export interface AceStepGenerationArtifact {
  cacheKey: string;
  path: string;
  relativePath: string;
  manifestPath: string;
  manifestRelativePath: string;
  cacheHit: boolean;
  generation: z.infer<typeof musicGenerationSchema>;
  track: GeneratedMusicTrack;
}

/** Converts existing timeline intent into a deterministic instrumental prompt; it never invents a source or downloads media. */
export function aceStepInstrumentalRequest(input: { timeline: TimelineDocument; sceneIds: readonly string[]; genre: string; emotion: string; intensity: 'low' | 'medium' | 'high'; durationMs?: number; seed?: number }): AceStepGenerationRequest {
  const selected = new Set(input.sceneIds);
  const sceneText = input.timeline.tracks.flatMap((track) => track.items)
    .filter((clip) => clip.sceneIds.some((sceneId) => selected.has(sceneId)))
    .map((clip) => clip.intent?.reason ?? clip.label)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8)
    .join('; ');
  const bpm = input.intensity === 'high' ? 135 : input.intensity === 'low' ? 88 : 112;
  return aceStepGenerationRequestSchema.parse({
    prompt: `${input.genre}, ${input.emotion}, ${input.intensity} intensity, instrumental only, no vocals, no spoken words, dynamic arrangement for scenes: ${sceneText || 'cinematic narrative'}`,
    durationMs: Math.min(480_000, Math.max(10_000, input.durationMs ?? input.timeline.durationMs)), bpm, seed: input.seed ?? -1, audioFormat: 'wav',
  });
}

const normalizePrompt = (prompt: string): string => prompt.normalize('NFKC').replace(/\s+/gu, ' ').trim();

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');

function assertLocalBaseUrl(baseUrl: string): URL {
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || !localHostnames.has(parsed.hostname)) throw new Error('forbidden: o ACE-Step do Aethera aceita somente uma API local (localhost/127.0.0.1).');
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  return parsed;
}

function safeProjectPath(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(candidate);
  const relativePath = relative(absoluteRoot, absolute);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('forbidden: o artefato do ACE-Step precisa permanecer dentro do projeto.');
  return absolute;
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return 'data' in record ? record['data'] : value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid: resposta do ACE-Step sem ${label}.`);
  return value as Record<string, unknown>;
}

function modelIds(value: unknown): string[] {
  const unwrapped = unwrap(value);
  const record = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped) ? unwrapped as Record<string, unknown> : null;
  const list = Array.isArray(unwrapped) ? unwrapped : record && Array.isArray(record['data']) ? record['data'] : record && Array.isArray(record['models']) ? record['models'] : [];
  return list.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    return [candidate['id'], candidate['name'], candidate['model']].filter((name): name is string => typeof name === 'string');
  });
}

function taskId(value: unknown): string {
  const record = object(unwrap(value), 'task_id');
  if (typeof record['task_id'] !== 'string' || !record['task_id']) throw new Error('invalid: o ACE-Step não retornou task_id.');
  return record['task_id'];
}

function taskResult(value: unknown): z.infer<typeof taskSchema> {
  const unwrapped = unwrap(value);
  const list = Array.isArray(unwrapped) ? unwrapped : [];
  const candidate = list[0];
  return taskSchema.parse(candidate);
}

function resultItems(value: unknown): z.infer<typeof generatedResultSchema>[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error('invalid: resultado do ACE-Step não é uma lista de faixas.');
  return parsed.map((item) => generatedResultSchema.parse(item));
}

function audioUrl(base: URL, file: string): string {
  const candidate = new URL(file, base);
  if (!localHostnames.has(candidate.hostname) || candidate.pathname !== '/v1/audio') throw new Error('forbidden: o ACE-Step retornou uma origem de áudio externa ou uma rota inesperada.');
  return candidate.toString();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    if (signal?.aborted) { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); return; }
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); }, { once: true });
  });
}

const defaultHttp: AceStepHttp = { request: (input, init) => fetch(input, init) };

export const defaultAceStepConfig = (): AceStepConfig => aceStepConfigSchema.parse({});

export function aceStepCacheKey(config: AceStepConfig, request: AceStepGenerationRequest): string {
  const parsedConfig = aceStepConfigSchema.parse(config);
  const parsedRequest = aceStepGenerationRequestSchema.parse(request);
  return sha256(JSON.stringify({
    providerId: ACE_STEP_PROVIDER_ID,
    softwareVersion: parsedConfig.softwareVersion,
    modelId: parsedConfig.modelId,
    modelRevision: parsedConfig.modelRevision,
    lmModelPath: parsedConfig.lmModelPath,
    lmBackend: parsedConfig.lmBackend,
    request: {
      ...parsedRequest,
      prompt: normalizePrompt(parsedRequest.prompt),
      inferenceSteps: parsedRequest.inferenceSteps ?? parsedConfig.inferenceSteps,
      guidanceScale: parsedRequest.guidanceScale ?? parsedConfig.guidanceScale,
    },
  }));
}

export class AceStepLocalClient {
  private readonly config: AceStepConfig;
  private readonly base: URL;
  private readonly http: AceStepHttp;

  constructor(config: Partial<AceStepConfig> = {}, http: AceStepHttp = defaultHttp) {
    this.config = aceStepConfigSchema.parse(config);
    this.base = assertLocalBaseUrl(this.config.baseUrl);
    this.http = http;
  }

  private async json(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(path, this.base);
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (this.config.apiKey) headers.set('authorization', `Bearer ${this.config.apiKey}`);
    const requestInit: RequestInit = { ...init, headers };
    if (signal) requestInit.signal = signal;
    const response = await this.http.request(url.toString(), requestInit);
    if (!response.ok) throw new Error(`ACE-Step HTTP ${response.status} em ${path}.`);
    return response.json();
  }

  async probe(signal?: AbortSignal): Promise<AceStepProbe> {
    const health = object(unwrap(await this.json('/health', {}, signal)), 'health') as Record<string, unknown>;
    if (typeof health['status'] === 'string' && health['status'] !== 'ok') throw new Error('unavailable: o servidor local do ACE-Step não está saudável.');
    const ids = modelIds(await this.json('/v1/models', {}, signal));
    // The API lazy-loads models: until the first generation /v1/models is empty and /health names the configured DiT.
    const configuredModelAvailable = ids.includes(this.config.modelId) || health['loaded_model'] === this.config.modelId;
    return { health, modelIds: ids, configuredModelAvailable };
  }

  private requestBody(request: AceStepGenerationRequest): Record<string, unknown> {
    const parsed = aceStepGenerationRequestSchema.parse(request);
    return {
      prompt: normalizePrompt(parsed.prompt), lyrics: '', thinking: this.config.lmModelPath !== null, sample_mode: false, use_format: false,
      model: this.config.modelId, bpm: parsed.bpm, key_scale: parsed.keyScale, time_signature: parsed.timeSignature,
      vocal_language: 'unknown', inference_steps: parsed.inferenceSteps ?? this.config.inferenceSteps, guidance_scale: parsed.guidanceScale ?? this.config.guidanceScale,
      use_random_seed: parsed.seed < 0, seed: parsed.seed, audio_duration: parsed.durationMs / 1_000, batch_size: this.config.batchSize,
      task_type: 'text2music', audio_format: parsed.audioFormat, lm_model_path: this.config.lmModelPath, lm_backend: this.config.lmBackend,
    };
  }

  async generate(input: { projectRoot: string; timelineId: string; sceneIds: readonly string[]; request: AceStepGenerationRequest; mood?: readonly string[]; outputRelativePath?: string; signal?: AbortSignal }): Promise<AceStepGenerationArtifact> {
    const request = aceStepGenerationRequestSchema.parse(input.request);
    const projectRoot = resolve(input.projectRoot);
    const cacheKey = aceStepCacheKey(this.config, request);
    const relativeOutput = input.outputRelativePath ?? `producoes/ace-step/${cacheKey}.${request.audioFormat}`;
    if (isAbsolute(relativeOutput)) throw new Error('forbidden: o caminho do áudio ACE-Step deve ser relativo ao projeto.');
    const outputPath = safeProjectPath(projectRoot, join(projectRoot, relativeOutput));
    const manifestPath = safeProjectPath(projectRoot, `${outputPath}.json`);
    if (await exists(outputPath) && await exists(manifestPath)) return this.readCachedArtifact({ cacheKey, outputPath, manifestPath, projectRoot });
    if (await exists(outputPath) || await exists(manifestPath)) throw new Error('invalid: existe um artefato ACE-Step parcial para a mesma chave; ele não será sobrescrito automaticamente.');

    const probe = await this.probe(input.signal);
    if (!probe.configuredModelAvailable) throw new Error(`unavailable: o modelo local ${this.config.modelId} não apareceu em /v1/models.`);
    const release = await this.json('/release_task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.requestBody(request)) }, input.signal);
    const id = taskId(release);
    const startedAt = Date.now();
    let result: z.infer<typeof taskSchema> | null = null;
    while (Date.now() - startedAt <= this.config.timeoutMs) {
      result = taskResult(await this.json('/query_result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task_id_list: [id] }) }, input.signal));
      if (result.status === 1 || result.status === 2) break;
      await sleep(this.config.pollIntervalMs, input.signal);
    }
    if (!result || result.status === 0) throw new Error(`timeout: o ACE-Step não concluiu a tarefa ${id} dentro do limite configurado.`);
    if (result.status === 2) throw new Error(`ACE-Step falhou: ${result.error ?? 'erro não especificado'}.`);
    const generated = resultItems(result.result)[0];
    if (!generated) throw new Error('invalid: o ACE-Step concluiu sem retornar um arquivo de áudio.');
    const downloadInit: RequestInit = {};
    if (this.config.apiKey) downloadInit.headers = { authorization: `Bearer ${this.config.apiKey}` };
    if (input.signal) downloadInit.signal = input.signal;
    const response = await this.http.request(audioUrl(this.base, generated.file), downloadInit);
    if (!response.ok) throw new Error(`ACE-Step não entregou o áudio (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('invalid: o ACE-Step entregou um arquivo de áudio vazio.');
    await mkdir(dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, outputPath);
    const outputSha256 = sha256(bytes);
    const createdAt = new Date().toISOString();
    const generation = musicGenerationSchema.parse({
      providerId: ACE_STEP_PROVIDER_ID, softwareVersion: String(probe.health['version'] ?? this.config.softwareVersion), modelId: this.config.modelId,
      modelRevision: this.config.modelRevision, lmModelId: this.config.lmModelPath, lmBackend: this.config.lmBackend,
      promptHash: sha256(normalizePrompt(request.prompt)), seed: request.seed, durationMs: Math.round(Number(generated.metas?.['duration'] ?? request.durationMs / 1_000) * 1_000),
      bpm: typeof generated.metas?.['bpm'] === 'number' ? generated.metas['bpm'] : request.bpm, inferenceSteps: request.inferenceSteps ?? this.config.inferenceSteps,
      guidanceScale: request.guidanceScale ?? this.config.guidanceScale, taskType: 'text2music', outputSha256, format: request.audioFormat,
      origin: 'local-only', timelineId: input.timelineId, sceneIds: [...input.sceneIds], createdAt,
      licenseEvidence: licenseEvidenceSchema.parse({
        software: { name: 'ACE-Step 1.5', license: 'MIT', source: ACE_STEP_SOFTWARE_LICENSE_URL },
        ditWeights: { model: this.config.modelId, license: 'MIT conforme model card/revisão registrada', source: ACE_STEP_MODEL_CARD_URL },
        lmWeights: this.config.lmModelPath ? { model: this.config.lmModelPath, license: 'MIT conforme inventário ACE-Step; upstream Qwen3 Apache-2.0', source: ACE_STEP_MODEL_CARD_URL } : null,
        outputStatement: 'Uso não comercial do canal; a declaração de uso comercial do model card não é tratada como autorização jurídica automática.', evidence: ACE_STEP_EVALUATION_EVIDENCE,
      }),
    });
    const track = makeGeneratedTrack({ generation, relativePath: relative(projectRoot, outputPath), mood: input.mood ?? [], importedAt: createdAt, id: `ace-step:${cacheKey}` });
    const manifest = JSON.stringify({ schemaVersion: 1, cacheKey, request: { ...request, prompt: normalizePrompt(request.prompt) }, generation, track }, null, 2);
    await writeFile(`${manifestPath}.${process.pid}.tmp`, `${manifest}\n`, 'utf8');
    await rename(`${manifestPath}.${process.pid}.tmp`, manifestPath);
    return { cacheKey, path: outputPath, relativePath: track.relativePath, manifestPath, manifestRelativePath: relative(projectRoot, manifestPath), cacheHit: false, generation, track };
  }

  private async readCachedArtifact(input: { cacheKey: string; outputPath: string; manifestPath: string; projectRoot: string }): Promise<AceStepGenerationArtifact> {
    const raw = JSON.parse(await readFile(input.manifestPath, 'utf8')) as { cacheKey?: unknown; generation?: unknown; track?: unknown };
    if (raw.cacheKey !== input.cacheKey) throw new Error('invalid: manifesto ACE-Step não corresponde à chave de cache.');
    const generation = musicGenerationSchema.parse(raw.generation);
    const track = makeGeneratedTrackSchema(raw.track);
    if (track.generation.outputSha256 !== generation.outputSha256) throw new Error('invalid: hash de saída divergente no manifesto ACE-Step.');
    const bytes = await readFile(input.outputPath);
    if (sha256(bytes) !== generation.outputSha256) throw new Error('invalid: cache ACE-Step corrompido; o hash do áudio não confere.');
    return { cacheKey: input.cacheKey, path: input.outputPath, relativePath: track.relativePath, manifestPath: input.manifestPath, manifestRelativePath: relative(input.projectRoot, input.manifestPath), cacheHit: true, generation, track };
  }
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }

const makeGeneratedTrackSchema = (value: unknown): GeneratedMusicTrack => {
  try { return generatedMusicTrackSchema.parse(value); } catch { throw new Error('invalid: track ACE-Step inválida no cache.'); }
};

export function makeGeneratedTrack(input: { id: string; relativePath: string; mood: readonly string[]; importedAt: string; generation: z.infer<typeof musicGenerationSchema> }): GeneratedMusicTrack {
  return makeGeneratedTrackSchema({ id: input.id, relativePath: input.relativePath, sha256: input.generation.outputSha256, durationMs: input.generation.durationMs, bpm: input.generation.bpm, mood: [...input.mood].slice(0, 24), license: musicLicenseSchema.parse({ name: 'ACE-Step 1.5 — uso não comercial', source: ACE_STEP_MODEL_CARD_URL, evidence: input.generation.licenseEvidence.evidence, scope: 'não comercial; revisão comercial pendente', expiresAt: null }), importedAt: input.importedAt, generation: input.generation });
}

