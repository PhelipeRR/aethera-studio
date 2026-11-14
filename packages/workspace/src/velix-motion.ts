import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { alignMotionCaptions, alignMotionScenes, generateMotionCaptions, MOTION_LIMITS, motionCaptionProblems, motionDuration, motionProjectSchema, type MotionCaption, type MotionProject, type MotionVoiceWord } from '@neuralbridge/shared/motion';
import { aetheraTimelineSegmentKey, aetheraTimelineSegments, compileAetheraTimeline, type AetheraCompositionWindow, type AetheraTimelineCompositionProps } from '@neuralbridge/shared/aethera-timeline-composition';
import { panelProxyPaths, type TimelineDocument } from '@neuralbridge/shared';
import { runVelixCommand, velixKitPath } from './velix.js';
import { runExclusiveRender } from './aethera-visual-scheduler.js';
import { serveRenderMedia } from './aethera-media-server.js';

const exec = promisify(execFile);
export type MotionRenderRequest = { root: string; project: MotionProject; outputRelativePath: string; audioRelativePath?: string; bundlePath: string; workerPath: string; runtime: string; browserExecutable: string; ffmpeg?: string; ffprobe?: string; signal?: AbortSignal; onProgress?: (progress: number) => void };
export type MotionRenderResult = { outputPath: string; duration: number; hasVideo: boolean; hasAudio: boolean };
export type MotionFramesRequest = Omit<MotionRenderRequest, 'outputRelativePath' | 'audioRelativePath' | 'onProgress'> & { times: number[] };
export type AetheraTimelineRenderRequest = { root: string; timeline: TimelineDocument; window?: AetheraCompositionWindow; outputRelativePath: string; bundlePath: string; workerPath: string; runtime: string; browserExecutable: string; ffmpeg?: string; ffprobe?: string; signal?: AbortSignal; onProgress?: (progress: number) => void };
export type AetheraTimelineSegmentRender = { index: number; key: string; relativePath: string; reused: boolean; fromMs: number; durationMs: number };
export type MotionVoiceAlignmentOptions = { kitPath?: string; python?: string };

const BROWSER_PATH = ['node_modules', '.remotion', 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'];

/** The browser the render uses, inside the app's own data folder; null when the user has not installed it. */
export function motionBrowserExecutable(runtimeDir: string): string | null {
  const path = join(runtimeDir, ...BROWSER_PATH);
  return existsSync(path) ? path : null;
}

/** FFmpeg and FFprobe shipped with the app, so a render never depends on what the machine has on its PATH. */
export function motionMediaTools(appPath: string): { ffmpeg: string; ffprobe: string } | null {
  for (const base of [join(appPath, 'node_modules'), join(appPath, '..', '..', 'node_modules')]) {
    const folder = join(base, '@remotion', 'compositor-win32-x64-msvc');
    const tools = { ffmpeg: join(folder, 'ffmpeg.exe'), ffprobe: join(folder, 'ffprobe.exe') };
    if (existsSync(tools.ffmpeg) && existsSync(tools.ffprobe)) return tools;
  }
  return null;
}

function runProcess(request: { workerPath: string; runtime: string; cwd: string; job: object; signal?: AbortSignal | undefined; onProgress?: ((progress: number) => void) | undefined; timeoutMs: number; failure: string }): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(request.runtime, [request.workerPath], { cwd: request.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const stop = () => {
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(stop, request.timeoutMs);
    request.signal?.addEventListener('abort', stop, { once: true });
    let stderr = '';
    let pending = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2_000); });
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        try { const message = JSON.parse(line) as { progress?: number }; if (typeof message.progress === 'number') request.onProgress?.(message.progress); } catch { /* Not a progress line. */ }
      }
    });
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', stop);
      if (request.signal?.aborted) fail(new Error('cancelled: operação cancelada.'));
      else if (code === 0) done();
      else fail(new Error(`${request.failure} (saída ${code}): ${stderr.trim().slice(-400)}`));
    });
    child.stdin.end(JSON.stringify(request.job));
  });
}

/**
 * Downloads the render browser into runtimeDir, and only when the user asked. Remotion picks the folder from the nearest
 * package.json, so one here keeps the download inside the app's data whatever sits above it on the disk.
 */
export async function installMotionBrowser(request: { runtimeDir: string; workerPath: string; runtime: string; signal?: AbortSignal; onProgress?: (progress: number) => void }): Promise<string> {
  mkdirSync(request.runtimeDir, { recursive: true });
  writeFileSync(join(request.runtimeDir, 'package.json'), '{"private":true}\n');
  await runProcess({ workerPath: request.workerPath, runtime: request.runtime, cwd: request.runtimeDir, job: { install: true }, signal: request.signal, onProgress: request.onProgress, timeoutMs: MOTION_LIMITS.renderTimeoutMs, failure: 'Download do navegador falhou' });
  const browser = motionBrowserExecutable(request.runtimeDir);
  if (!browser) throw new Error('O download terminou sem o navegador esperado.');
  return browser;
}

function confined(root: string, value: string): string {
  if (isAbsolute(value)) throw new Error('invalid: caminho fora do projeto.');
  const base = realpathSync(root);
  const path = resolve(base, value);
  const rel = relative(base, path);
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('invalid: caminho fora do projeto.');
  return path;
}
/** Resolves a Motion asset only after confinement to the project root; callers may then pass this path to Remotion. */
export function resolveMotionAsset(root: string, relativePath: string): string {
  const path = confined(root, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('not_found: asset Motion não encontrado.');
  return realpathSync(path);
}

/** Converts persisted proxy-relative paths to confined local paths immediately before Remotion runs. */
export function resolveAetheraTimelineProps(root: string, props: AetheraTimelineCompositionProps): AetheraTimelineCompositionProps {
  return { ...props, layers: props.layers.map((layer) => {
    if (layer.source.kind === 'media' && layer.source.proxyPath) return { ...layer, source: { ...layer.source, proxyPath: resolveMotionAsset(root, layer.source.proxyPath) } };
    // Smart Director panels: each panel's footage is confined to the project like any media layer.
    if (layer.source.kind === 'graphic' && layer.source.component === 'panels') return { ...layer, source: { ...layer.source, props: mapPanelProxies(layer.source.props, (path) => resolveMotionAsset(root, path)) } };
    return layer;
  }) };
}

function mapPanelProxies(props: Record<string, unknown>, map: (path: string) => string): Record<string, unknown> {
  const panels = Array.isArray(props['panels']) ? props['panels'] as Array<Record<string, unknown>> : [];
  return { ...props, panels: panels.map((panel) => typeof panel['proxyPath'] === 'string' ? { ...panel, proxyPath: map(panel['proxyPath']) } : panel) };
}
export function validateMotionImageAsset(root: string, relativePath: string): string {
  const path = resolveMotionAsset(root, relativePath); const bytes = readFileSync(path);
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (!png && !jpeg) throw new Error('invalid: asset Motion não é uma imagem PNG/JPEG reconhecida.');
  return path;
}

/** Every entry to the engine goes through here: only data that passes the contract and the timing rules renders. */
export function validateMotionProject(value: unknown): MotionProject {
  const project = motionProjectSchema.parse(value);
  const frames = motionDuration(project);
  if (frames > MOTION_LIMITS.maxDurationFrames) throw new Error('invalid: composição acima do limite de duração.');
  const problems = motionCaptionProblems(project.captions, (frames / project.fps) * 1000);
  if (problems.length > 0) throw new Error(`invalid: ${problems.join(' ')}`);
  return project;
}

/** Transcribes an authorized local narration into timed words; the audio never leaves the project root. */
export async function transcribeVelixMotionVoice(root: string, audioRelativePath: string, options: MotionVoiceAlignmentOptions = {}): Promise<MotionVoiceWord[]> {
  const audio = confined(root, audioRelativePath);
  if (!existsSync(audio) || !statSync(audio).isFile()) throw new Error('invalid: narração inválida.');
  const temporary = mkdtempSync(join(tmpdir(), 'neuralbridge-motion-align-'));
  const wordsPath = join(temporary, 'palavras.json');
  try {
    await runVelixCommand(options.python ?? process.env['NB_PYTHON'] ?? 'python', [join(options.kitPath ?? velixKitPath(), 'scripts', 'transcrever.py'), audio, wordsPath, '--idioma', 'pt'], { cwd: realpathSync(root) });
    let parsed: { words?: MotionVoiceWord[] };
    try { parsed = JSON.parse(readFileSync(wordsPath, 'utf8')) as { words?: MotionVoiceWord[] }; } catch { throw new Error('invalid: a transcrição da narração não é JSON válido.'); }
    if (!Array.isArray(parsed.words) || parsed.words.length === 0) throw new Error('A transcrição não encontrou fala no áudio.');
    return parsed.words;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Transcribes an authorized local narration and returns aligned captions without changing the project on disk. */
export async function alignVelixMotionVoice(root: string, audioRelativePath: string, captions: readonly MotionCaption[], options: MotionVoiceAlignmentOptions = {}): Promise<{ captions: MotionCaption[]; missed: number }> {
  return alignMotionCaptions(captions, await transcribeVelixMotionVoice(root, audioRelativePath, options));
}

/**
 * Builds captions from the approved script with the real voice timing and fits each scene to the voice of its segment.
 * Returns a draft for review; nothing is written to disk. Unmatched captions and scenes are reported, never guessed.
 */
export async function syncVelixMotionNarration(root: string, audioRelativePath: string, project: MotionProject, script: string, options: MotionVoiceAlignmentOptions & { audioDurationMs?: number } = {}): Promise<{ project: MotionProject; missedCaptions: string[]; missedScenes: string[] }> {
  const words = await transcribeVelixMotionVoice(root, audioRelativePath, options);
  const generated = generateMotionCaptions(script, words, project.fps);
  const missedIds = new Set(generated.missed);
  const captions = generated.captions.filter((_caption, index) => !missedIds.has(`caption-${index + 1}`));
  const lastWordMs = Math.round(Math.max(...words.map((word) => word.e)) * 1000);
  const aligned = alignMotionScenes({ ...project, captions }, captions, options.audioDurationMs ?? lastWordMs);
  return { project: aligned.project, missedCaptions: generated.missed, missedScenes: aligned.missed };
}

function runWorker(request: MotionRenderRequest, project: MotionProject, output: string): Promise<void> {
  return runProcess({ workerPath: request.workerPath, runtime: request.runtime, cwd: dirname(output), job: { serveUrl: request.bundlePath, project, output, browserExecutable: request.browserExecutable }, signal: request.signal, onProgress: request.onProgress, timeoutMs: MOTION_LIMITS.renderTimeoutMs, failure: 'Render Motion falhou' }).catch((error: unknown) => {
    throw error instanceof Error && error.message.startsWith('cancelled') ? new Error('cancelled: render cancelado.') : error;
  });
}

function runAetheraTimelineWorker(request: AetheraTimelineRenderRequest, props: AetheraTimelineCompositionProps, output: string): Promise<void> {
  return runProcess({ workerPath: request.workerPath, runtime: request.runtime, cwd: dirname(output), job: { serveUrl: request.bundlePath, timelineProps: props, output, browserExecutable: request.browserExecutable }, signal: request.signal, onProgress: request.onProgress, timeoutMs: MOTION_LIMITS.renderTimeoutMs, failure: 'Render da timeline Aethera falhou' });
}

/** Renders the AP-04 composition from the same serialized props used by the Player. */
export async function renderAetheraTimeline(request: AetheraTimelineRenderRequest): Promise<MotionRenderResult> {
  return runExclusiveRender(async () => {
    const timeline = request.timeline;
    const window = request.window ?? { fromMs: 0, durationMs: timeline.durationMs };
    const local = resolveAetheraTimelineProps(request.root, compileAetheraTimeline(timeline, window));
    const output = confined(request.root, request.outputRelativePath);
    mkdirSync(dirname(output), { recursive: true });
    const silent = `${output}.timeline.mp4`;
    // OffthreadVideo only reads http(s): the job's proxies are served on loopback for the length of this render.
    const media = await serveRenderMedia(local.layers.flatMap((layer) => layer.source.kind === 'media' && layer.source.proxyPath ? [layer.source.proxyPath] : layer.source.kind === 'graphic' && layer.source.component === 'panels' ? panelProxyPaths(layer.source.props) : []));
    const props = { ...local, layers: local.layers.map((layer) => {
      if (layer.source.kind === 'media' && layer.source.proxyPath) return { ...layer, source: { ...layer.source, proxyPath: media.urlFor(layer.source.proxyPath) } };
      if (layer.source.kind === 'graphic' && layer.source.component === 'panels') return { ...layer, source: { ...layer.source, props: mapPanelProxies(layer.source.props, (path) => media.urlFor(path)) } };
      return layer;
    }) };
    try {
      await runAetheraTimelineWorker(request, props, silent);
      const checked = await probe(silent, request.ffprobe ?? 'ffprobe');
      if (!checked.hasVideo || !(checked.duration > 0)) throw new Error('FFprobe reprovou a composição Aethera.');
      renameSync(silent, output);
      return { outputPath: request.outputRelativePath, ...checked };
    } finally {
      rmSync(silent, { force: true });
      await media.close();
    }
  }, request.signal);
}

/** Renders only missing timeline windows and leaves completed cache entries reusable after an interruption or edit. */
export async function renderAetheraTimelineSegments(request: Omit<AetheraTimelineRenderRequest, 'window' | 'outputRelativePath'> & { cacheRelativeDir?: string; proxyHashes?: ReadonlyMap<string, string> }): Promise<AetheraTimelineSegmentRender[]> {
  const cacheRelativeDir = request.cacheRelativeDir ?? '.aethera-cache/timeline';
  const segments: AetheraTimelineSegmentRender[] = [];
  for (const segment of aetheraTimelineSegments(request.timeline)) {
    if (request.signal?.aborted) throw new Error('cancelled: render cancelado.');
    const key = aetheraTimelineSegmentKey(request.timeline, segment, request.proxyHashes);
    const relativePath = `${cacheRelativeDir}/${key}.mp4`;
    const absolutePath = confined(request.root, relativePath);
    const reusable = existsSync(absolutePath) && statSync(absolutePath).isFile() && statSync(absolutePath).size > 0;
    if (!reusable) await renderAetheraTimeline({ ...request, outputRelativePath: relativePath, window: { fromMs: segment.fromMs, durationMs: segment.durationMs } });
    segments.push({ index: segment.index, key, relativePath, reused: reusable, fromMs: segment.fromMs, durationMs: segment.durationMs });
  }
  return segments;
}

/** Renders the exact Remotion frames used by the style gallery; outputs never leave the project root. */
export function renderMotionFrames(request: MotionFramesRequest): Promise<string[]> {
  return runExclusiveRender(() => renderMotionFramesUnlocked(request), request.signal);
}

async function renderMotionFramesUnlocked(request: MotionFramesRequest): Promise<string[]> {
  const project = validateMotionProject(request.project);
  const root = realpathSync(request.root);
  const directory = mkdtempSync(join(root, '.motion-preview-'));
  try {
    const frames: string[] = [];
    for (const time of request.times) {
      if (!Number.isFinite(time) || time < 0) throw new Error('invalid: momento de prévia inválido.');
      const frame = Math.min(motionDuration(project) - 1, Math.max(0, Math.round(time * project.fps)));
      const output = join(directory, `frame-${frames.length}.png`);
      await runProcess({ workerPath: request.workerPath, runtime: request.runtime, cwd: directory, job: { serveUrl: request.bundlePath, project, output, frame, still: true, browserExecutable: request.browserExecutable }, signal: request.signal, timeoutMs: MOTION_LIMITS.renderTimeoutMs, failure: 'Prévia Motion falhou' });
      frames.push(`data:image/png;base64,${readFileSync(output).toString('base64')}`);
    }
    return frames;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function probe(file: string, ffprobe: string): Promise<Omit<MotionRenderResult, 'outputPath'>> {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const types = (parsed.streams ?? []).map((stream) => stream.codec_type);
  return { duration: Number(parsed.format?.duration ?? 0), hasVideo: types.includes('video'), hasAudio: types.includes('audio') };
}

/** Remotion draws the frames; FFmpeg stays in charge of the audio and the final file. Nothing counts until FFprobe says so. */
export async function renderMotionProject(request: MotionRenderRequest): Promise<MotionRenderResult> {
  return runExclusiveRender(() => renderMotionProjectUnlocked(request), request.signal);
}

export async function renderMotionProjectUnlocked(request: MotionRenderRequest): Promise<MotionRenderResult> {
  const project = validateMotionProject(request.project);
  const ffmpeg = request.ffmpeg ?? 'ffmpeg';
  const ffprobe = request.ffprobe ?? 'ffprobe';
  const output = confined(request.root, request.outputRelativePath);
  const audio = request.audioRelativePath ? confined(request.root, request.audioRelativePath) : null;
  if (audio && !statSync(audio).isFile()) throw new Error('invalid: narração inválida.');
  mkdirSync(dirname(output), { recursive: true });
  const silent = `${output}.motion.mp4`;
  const final = `${output}.part.mp4`;
  try {
    await runWorker(request, project, silent);
    if (audio) await exec(ffmpeg, ['-y', '-i', silent, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', final], { windowsHide: true, ...(request.signal ? { signal: request.signal } : {}) });
    else renameSync(silent, final);
    const checked = await probe(final, ffprobe);
    if (!checked.hasVideo || !(checked.duration > 0) || (audio && !checked.hasAudio)) throw new Error('FFprobe reprovou o arquivo final.');
    renameSync(final, output);
    return { outputPath: request.outputRelativePath, ...checked };
  } finally {
    rmSync(silent, { force: true });
    rmSync(final, { force: true });
  }
}
