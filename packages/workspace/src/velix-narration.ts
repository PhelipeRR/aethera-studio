import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { NarrationAsset, NarrationLicenseState, NarrationModel, NarrationTimeline, NarrationVoice, VoiceLicenseFingerprint, VoiceStudioStatus } from '@neuralbridge/shared';
import { velixVideoSlug } from './velix.js';

const exec = promisify(execFile);
// Checked against the running 0.5.7 API; patch releases keep the contract.
const EXPECTED_API_LINE = '0.5';
const MAX_TEXT = 4_096;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const SIDECAR = 'neuralbridge-narration.json';

export interface VoiceStudioClient {
  readonly baseUrl: string;
  status(): Promise<VoiceStudioStatus>;
  models(): Promise<NarrationModel[]>;
  voices(): Promise<NarrationVoice[]>;
  /** Hands the voice model's GPU memory to the transcription. VoiceStudio loads it again the next time it has to speak. */
  releaseVoiceMemory(): Promise<void>;
  /**
   * `voiceId` names a library voice; a designed voice (Aethera channel voice) passes `instruct` + `seed` instead and no
   * voice, so nothing is cloned. `numStep` is the engine's quality steps.
   */
  speech(input: { text: string; modelId: string; voiceId?: string; format: 'mp3' | 'wav'; language?: string; speed?: number; instructions?: string; instruct?: string; seed?: number; numStep?: number }): Promise<{ bytes: Buffer; contentType: string }>;
  /** The licence VoiceStudio declares for a TTS model now (its registry), or null when it declares none. */
  modelLicense(modelId: string): Promise<VoiceLicenseFingerprint | null>;
}

export interface VoiceStudioClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  speechTimeoutMs?: number;
}

export interface GenerateVoiceStudioNarrationInput {
  root: string;
  video: string;
  client: VoiceStudioClient;
  text: string;
  modelId: string;
  voiceId: string;
  format: 'mp3' | 'wav';
  language?: string;
  speed?: number;
  license: NarrationLicenseState;
  probeAudio?: (path: string) => Promise<{ durationMs: number }>;
  ffprobe?: string;
}

export interface NarrationSidecar {
  schemaVersion: 1;
  asset: NarrationAsset | null;
  timeline: NarrationTimeline | null;
}

interface SidecarSnapshot {
  value: NarrationSidecar;
  fingerprint: string | null;
}

const unknownLicense = (): NarrationLicenseState => ({ provider: 'unknown', model: 'unknown', voice: 'unknown', output: 'unknown', userConfirmed: false });
const cleanLabel = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback;
const stringValue = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const listValue = (value: unknown, key: string): unknown[] => Array.isArray(value) ? value : Array.isArray(objectValue(value)[key]) ? objectValue(value)[key] as unknown[] : [];

function loopbackBaseUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('invalid: VoiceStudio precisa usar uma URL loopback válida.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw new Error('forbidden: VoiceStudio só pode ser acessado por loopback.');
  if (url.username || url.password || url.pathname !== '/' && url.pathname !== '') throw new Error('invalid: a URL do VoiceStudio não pode conter credenciais ou caminho remoto.');
  return url.origin;
}

function versionOf(value: unknown): string | null {
  const record = objectValue(value);
  return stringValue(record.version) ?? stringValue(record.apiVersion) ?? stringValue(record.api_version) ?? stringValue(record.openapi_version);
}

/** What the provider itself declares about the model; shown to the person, never treated as a review. */
function licenseNote(value: unknown): string | null {
  const info = objectValue(value);
  const license = stringValue(info.license);
  if (!license) return null;
  const restricted = info.commercial_inference === 'restricted' || info.review_status === 'noncommercial';
  return cleanLabel(`${license}${restricted ? ' — uso comercial restrito' : ''}`, license);
}

function normalizeModels(value: unknown): NarrationModel[] {
  return listValue(value, 'models').flatMap((entry) => {
    const item = objectValue(entry);
    // The catalog also lists speech-to-text and translation; only an engine id can be passed to /v1/audio/speech.
    if (item.role !== undefined && item.role !== 'TTS') return [];
    const id = stringValue(item.id) ?? stringValue(listValue(item.engines, 'engines')[0]);
    if (!id) return [];
    return [{ id, label: cleanLabel(item.name ?? item.label, id), installed: item.installed === true || item.diskInstalled === true || item.available === true, license: unknownLicense(), licenseNote: licenseNote(item.license_info) }];
  });
}

function normalizeVoices(value: unknown): NarrationVoice[] {
  return listValue(value, 'voices').flatMap((entry) => {
    const item = objectValue(entry);
    // OpenAI aliases only point at the engine's default voice, and a cloning engine has none.
    if (item.type === 'openai_alias') return [];
    const id = stringValue(item.id) ?? stringValue(item.voice_id);
    if (!id) return [];
    const declared = item.source ?? item.type;
    const source = declared === 'local' || declared === 'profile' || declared === 'preset' ? declared : 'unknown';
    return [{ id, label: cleanLabel(item.name ?? item.label, id), source, license: unknownLicense() }];
  });
}

/** OmniVoice takes `pt` and rejects `pt-BR`: it warns in its log and speaks with its default accent. */
function voiceLanguage(language: string): string { return language.split('-')[0]?.toLowerCase() ?? language; }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function createVoiceStudioClient(options: VoiceStudioClientOptions = {}): VoiceStudioClient {
  const baseUrl = loopbackBaseUrl(options.baseUrl ?? 'http://localhost:3900');
  const timeoutMs = options.timeoutMs ?? 30_000;
  const speechTimeoutMs = options.speechTimeoutMs ?? 600_000;

  async function request(path: string, init: RequestInit = {}, limitMs = timeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    try {
      return await fetch(new URL(path, `${baseUrl}/`).toString(), { ...init, signal: controller.signal, headers: { accept: 'application/json, audio/*', ...(init.headers ?? {}) } });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('timeout: VoiceStudio não respondeu no prazo.', { cause: error });
      throw new Error(`VoiceStudio indisponível: ${errorText(error)}`, { cause: error });
    } finally { clearTimeout(timer); }
  }

  async function json(path: string): Promise<unknown> {
    const response = await request(path);
    const text = await response.text();
    if (!response.ok) throw new Error(`VoiceStudio respondeu HTTP ${response.status}.`);
    if (text.length > 2 * 1024 * 1024) throw new Error('invalid: resposta do VoiceStudio acima do limite.');
    try { return JSON.parse(text) as unknown; } catch (error) { throw new Error('invalid: resposta JSON do VoiceStudio inválida.', { cause: error }); }
  }

  return {
    baseUrl,
    async status() {
      try {
        const health = await json('/health');
        const apiVersion = versionOf(health);
        const compatible = apiVersion === EXPECTED_API_LINE || apiVersion?.startsWith(`${EXPECTED_API_LINE}.`) === true;
        const [models, voices] = compatible ? await Promise.all([this.models(), this.voices()]) : [[], []];
        return { available: true, compatible, baseUrl, apiVersion, models, voices, error: compatible ? null : `Contrato incompatível: esperado ${EXPECTED_API_LINE}.x.` };
      } catch (error) {
        return { available: false, compatible: false, baseUrl, apiVersion: null, models: [], voices: [], error: errorText(error) };
      }
    },
    async models() { return normalizeModels(await json('/models')); },
    async modelLicense(modelId) {
      const entry = listValue(await json('/models'), 'models').map(objectValue).find((item) => (item.role === undefined || item.role === 'TTS') && (stringValue(item.id) === modelId || listValue(item.engines, 'engines').includes(modelId)));
      const info = objectValue(entry?.license_info);
      const fingerprint = { registryDigest: stringValue(info.registry_digest), license: stringValue(info.license), reviewStatus: stringValue(info.review_status), commercialInference: stringValue(info.commercial_inference), licenseCategory: stringValue(info.license_category) };
      return Object.values(fingerprint).every((value) => value !== null) ? fingerprint as VoiceLicenseFingerprint : null;
    },
    async voices() { return normalizeVoices(await json('/v1/audio/voices')); },
    async releaseVoiceMemory() {
      const response = await request('/system/flush-memory?unload_model=true', { method: 'POST' });
      if (!response.ok) throw new Error(`VoiceStudio respondeu HTTP ${response.status}.`);
    },
    async speech(input) {
      if (input.text.trim().length === 0 || input.text.length > MAX_TEXT) throw new Error(`invalid: a narração deve ter entre 1 e ${MAX_TEXT} caracteres.`);
      const response = await request('/v1/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: input.text, model: input.modelId, ...(input.voiceId ? { voice: input.voiceId } : {}), response_format: input.format, ...(input.language ? { language: voiceLanguage(input.language) } : {}), ...(input.speed === undefined ? {} : { speed: input.speed }), ...(input.instructions ? { instructions: input.instructions } : {}), ...(input.instruct ? { instruct: input.instruct } : {}), ...(input.seed === undefined ? {} : { seed: input.seed }), ...(input.numStep === undefined ? {} : { num_step: input.numStep }) }) }, speechTimeoutMs);
      if (!response.ok) {
        const responseText = (await response.text()).slice(0, 8_000);
        let detail: Record<string, unknown> = {};
        try { detail = objectValue(JSON.parse(responseText)); } catch { /* keep the HTTP fallback */ }
        const nested = objectValue(detail.error);
        const code = stringValue(nested.code) ?? stringValue(detail.code);
        const message = stringValue(nested.message) ?? stringValue(detail.message);
        if (code === 'model_licence_required') throw new Error(`license_required: ${message ?? 'aceite a licença do modelo no Model Catalogue do VoiceStudio.'}`);
        throw new Error(`VoiceStudio respondeu HTTP ${response.status} ao gerar narração.${message ? ` ${message}` : ''}`);
      }
      const contentType = response.headers.get('content-type')?.split(';')[0] ?? `audio/${input.format}`;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('invalid: áudio do VoiceStudio vazio ou acima do limite.');
      if (contentType.includes('json')) {
        let parsed: unknown;
        try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; } catch { throw new Error('invalid: resposta de áudio JSON inválida.'); }
        const encoded = stringValue(objectValue(parsed).audio) ?? stringValue(objectValue(parsed).data);
        if (!encoded) throw new Error('invalid: resposta do VoiceStudio não contém áudio.');
        return { bytes: Buffer.from(encoded, 'base64'), contentType: `audio/${input.format}` };
      }
      return { bytes, contentType };
    },
  };
}

function confined(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('invalid: caminho de narração absoluto não é aceito.');
  const base = realpathSync(root);
  const candidate = resolve(base, relativePath);
  const rel = relative(base, candidate);
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('invalid: caminho de narração fora do projeto.');
  return candidate;
}

function sidecarPath(root: string, video: string): string { return join(confined(root, velixVideoSlug(video)), 'narracao', SIDECAR); }
function emptySidecar(): NarrationSidecar { return { schemaVersion: 1, asset: null, timeline: null }; }

function readSidecarSnapshot(root: string, video: string): SidecarSnapshot {
  const path = sidecarPath(root, video);
  if (!existsSync(path)) return { value: emptySidecar(), fingerprint: null };
  try {
    const raw = readFileSync(path, 'utf8');
    const value = JSON.parse(raw) as Partial<NarrationSidecar>;
    return { value: { schemaVersion: 1, asset: value.asset ?? null, timeline: value.timeline ?? null }, fingerprint: createHash('sha256').update(raw).digest('hex') };
  } catch { throw new Error('invalid: sidecar de narração inválido.'); }
}

export function loadNarrationSidecar(root: string, video: string): NarrationSidecar { return readSidecarSnapshot(root, video).value; }
/** Selects only a ready narration recorded in the project's sidecar. */
export function selectNarrationAsset(root: string, video: string, assetId: string): NarrationAsset {
  const asset = loadNarrationSidecar(root, video).asset;
  if (!asset || asset.id !== assetId) throw new Error('not_found: narração não pertence a este projeto.');
  if (asset.status !== 'ready' || !asset.relativePath.trim()) throw new Error('invalid: a narração selecionada não está pronta.');
  return asset;
}

async function saveSidecar(root: string, video: string, value: NarrationSidecar, expectedFingerprint: string | null): Promise<void> {
  const path = sidecarPath(root, video);
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  try {
    await writeFile(lock, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    throw new Error('conflict: outra escrita concorrente do sidecar de narração está em andamento.', { cause: error });
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const currentFingerprint = existsSync(path) ? createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex') : null;
    if (currentFingerprint !== expectedFingerprint) throw new Error('conflict: o sidecar de narração mudou durante a operação; recarregue antes de salvar.');
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    await rm(lock, { force: true }).catch(() => undefined);
  }
}

function licenseReady(license: NarrationLicenseState): boolean {
  return license.userConfirmed && license.provider === 'reviewed' && license.model === 'reviewed' && license.voice === 'reviewed' && license.output === 'reviewed';
}

async function defaultProbeAudio(path: string, preferred?: string): Promise<{ durationMs: number }> {
  const ffprobe = preferred ?? process.env['NB_FFPROBE'] ?? 'ffprobe';
  try {
    const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { windowsHide: true, maxBuffer: 1_024 * 1_024 });
    const duration = Number(stdout.trim());
    if (!(duration > 0)) throw new Error('duração inválida');
    return { durationMs: Math.round(duration * 1_000) };
  } catch (error) { throw new Error(`invalid: não foi possível validar o áudio gerado: ${errorText(error)}`, { cause: error }); }
}

export async function generateVoiceStudioNarration(input: GenerateVoiceStudioNarrationInput): Promise<NarrationAsset> {
  if (!licenseReady(input.license)) throw new Error('license_required: confirme as licenças independentes do aplicativo, modelo, voz e saída.');
  if (input.text.trim().length === 0 || input.text.length > MAX_TEXT) throw new Error(`invalid: a narração deve ter entre 1 e ${MAX_TEXT} caracteres.`);
  const initialSidecar = readSidecarSnapshot(input.root, input.video);
  const status = await input.client.status();
  if (!status.available || !status.compatible) throw new Error(status.error ?? 'VoiceStudio indisponível ou incompatível.');
  const model = status.models.find((item) => item.id === input.modelId && item.installed);
  if (!model) throw new Error('invalid: o modelo escolhido não está instalado no VoiceStudio.');
  if (!status.voices.some((item) => item.id === input.voiceId)) throw new Error('invalid: a voz escolhida não está disponível no VoiceStudio.');
  const response = await input.client.speech({ text: input.text, modelId: input.modelId, voiceId: input.voiceId, format: input.format, ...(input.language ? { language: input.language } : {}), ...(input.speed === undefined ? {} : { speed: input.speed }) });
  const id = randomUUID();
  const relativePath = `${velixVideoSlug(input.video)}/narracao/voice-${id}.${input.format}`;
  const audioPath = confined(input.root, relativePath);
  await mkdir(dirname(audioPath), { recursive: true });
  const temporary = `${audioPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, response.bytes);
  await rename(temporary, audioPath);
  try {
    const probe = input.probeAudio ?? ((path: string) => defaultProbeAudio(path, input.ffprobe));
    const { durationMs } = await probe(audioPath);
    const asset: NarrationAsset = { id, provider: 'voicestudio', relativePath, format: input.format, modelId: input.modelId, voiceId: input.voiceId, textHash: createHash('sha256').update(input.text).digest('hex'), durationMs, license: input.license, status: 'ready', createdAt: new Date().toISOString() };
    await saveSidecar(input.root, input.video, { schemaVersion: 1, asset, timeline: { assetId: id, relativePath, startMs: 0, endMs: durationMs, syncStatus: 'not-synced' } }, initialSidecar.fingerprint);
    return asset;
  } catch (error) {
    await rm(audioPath, { force: true }).catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function saveNarrationTimeline(root: string, video: string, timeline: NarrationTimeline): Promise<void> {
  const snapshot = readSidecarSnapshot(root, video);
  const sidecar = snapshot.value;
  if (!sidecar.asset || sidecar.asset.id !== timeline.assetId || sidecar.asset.relativePath !== timeline.relativePath) throw new Error('invalid: timeline não corresponde ao asset de narração.');
  confined(root, timeline.relativePath);
  if (!(timeline.endMs >= timeline.startMs && timeline.startMs >= 0)) throw new Error('invalid: intervalo de timeline inválido.');
  await saveSidecar(root, video, { ...sidecar, timeline }, snapshot.fingerprint);
}

export async function previewNarration(root: string, video: string, assetId?: string): Promise<string> {
  const sidecar = loadNarrationSidecar(root, video);
  const asset = sidecar.asset;
  if (!asset || (assetId && asset.id !== assetId)) throw new Error('not_found: narração não encontrada.');
  const path = confined(root, asset.relativePath);
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_PREVIEW_BYTES) throw new Error('invalid: prévia de narração acima do limite.');
  const bytes = await readFile(path);
  return `data:audio/${asset.format};base64,${bytes.toString('base64')}`;
}
