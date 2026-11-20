import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VELIX_DOSSIE_EXAMPLE, VELIX_DOSSIE_HTML, VELIX_DOSSIE_ID } from './velix-dossie.js';
import { runExclusiveRender } from './aethera-visual-scheduler.js';

/** Scenes that render straight to MP4; alpha layers and take edits stay with the agent in the Chat. */
export const VELIX_TEMPLATES = [
  { id: 'kinetic-explainer', label: 'Explicativo animado', example: 'skill-verde.json', webgl: false },
  { id: 'showreel-bauhaus', label: 'Showreel', example: null, webgl: false },
  { id: 'logo-reveal', label: 'Logo reveal', example: 'logo.json', webgl: false },
  { id: 'particulas-3d', label: 'Partículas 3D', example: 'particulas.json', webgl: true },
  { id: 'lyric-kinetic', label: 'Lyric video', example: 'lyric.json', webgl: false },
  { id: 'ui-showcase', label: 'Demonstração de app', example: 'ui-app.json', webgl: false },
  { id: 'texto-gigante', label: 'Texto gigante', example: 'texto-gigante.json', webgl: false },
] as const;

export type VelixTemplateId = (typeof VELIX_TEMPLATES)[number]['id'];
export type VelixKit = { installed: boolean; path: string; version: string | null; templates: Array<{ id: string; label: string; defaultData: string }>; downloaderVersion: string | null };
/** A transparent layer composed over a filmed video of the project (relative to the root). */
export type VelixOverlay = { baseRelativePath: string };
export type VelixRequest = { root: string; template: string; data: string; video?: string | undefined; overlay?: VelixOverlay | undefined };
export type VelixRenderRequest = VelixRequest & { outputPath: string; audioPath?: string | undefined; quality?: 'draft' | 'final' | undefined; origin?: 'studio' | 'chat' | undefined; agent?: 'auto' | 'claude' | 'codex' | undefined; normalize?: boolean | undefined };
export type VelixRenderJob = { id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error: string | null; origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex' | null; progress: number | null; output: string | null };
export type VelixImportRequest = { root: string; url: string; quality: 1080 | 720 | 480 | 360 | 'mp3'; confirmed: boolean };
type StoredVelixRenderJob = Omit<VelixRenderJob, 'origin' | 'agent' | 'progress' | 'output'> & { origin?: 'studio' | 'chat'; agent?: 'auto' | 'claude' | 'codex' | null };
export type VelixRenderStore = { save(job: StoredVelixRenderJob): void; load(id: string): StoredVelixRenderJob | null; list(): Array<StoredVelixRenderJob & { createdAt: string; updatedAt: string }>; update(job: StoredVelixRenderJob): void; recover(): void };

/** The kit stays outside the app: each user installs their own copy as a skill. */
export function velixKitPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return env['NB_VELIX_DIR'] ?? join(home, '.claude', 'skills', 'motionvelix');
}

export function readVelixKit(path: string = velixKitPath()): VelixKit {
  const installed = existsSync(join(path, 'engine', 'render.mjs')) && existsSync(join(path, 'templates'));
  if (!installed) return { installed, path, version: null, templates: [], downloaderVersion: null };
  const skill = existsSync(join(path, 'SKILL.md')) ? readFileSync(join(path, 'SKILL.md'), 'utf8') : '';
  const templates: VelixKit['templates'] = VELIX_TEMPLATES.filter(({ id }) => existsSync(join(path, 'templates', `${id}.html`))).map(({ id, label, example }) => {
    const file = example ? join(path, 'templates', 'exemplos', example) : null;
    return { id, label, defaultData: file && existsSync(file) ? readFileSync(file, 'utf8') : '{}' };
  });
  templates.push({ id: VELIX_DOSSIE_ID, label: 'Dossiê com dados', defaultData: JSON.stringify(VELIX_DOSSIE_EXAMPLE, null, 2) });
  return { installed, path, version: skill.match(/^# MotionVelix v(\S+?):/m)?.[1] ?? null, templates, downloaderVersion: null };
}

/** render.mjs imports Playwright by absolute path, which ESM rejects on Windows; a link lets it resolve by name. */
export function linkVelixDependencies(kitPath: string, home: string = homedir(), platform: NodeJS.Platform = process.platform): void {
  const installed = join(home, '.motionvelix', 'node_modules');
  const link = join(kitPath, 'node_modules');
  if (platform !== 'win32' || !existsSync(join(kitPath, 'engine', 'render.mjs')) || !existsSync(installed) || existsSync(link)) return;
  symlinkSync(installed, link, 'junction');
}

const VIDEO_FOLDERS = { tema: ['pesquisa', 'narracao', 'renders'], projeto: ['prints', 'pesquisa', 'narracao', 'renders'] } as const;

export type VelixVideoKind = keyof typeof VIDEO_FOLDERS;

export function velixVideoSlug(name: string): string {
  const slug = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('invalid: dê um nome ao vídeo com letras ou números.');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/.test(slug) ? `video-${slug}` : slug;
}

/** Creates the folder of one video under the Video project; a repeated name reuses it and removes nothing. */
export function prepareVelixVideo(root: string, name: string, kind: VelixVideoKind): { folder: string } {
  const base = authorizedRoot(root);
  const folder = velixVideoSlug(name);
  for (const part of VIDEO_FOLDERS[kind]) mkdirSync(join(base, folder, part), { recursive: true });
  return { folder };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function authorizedRoot(root: string): string {
  if (!isAbsolute(root) || !existsSync(root) || !statSync(root).isDirectory()) throw new Error('invalid: a raiz precisa ser uma pasta existente.');
  return realpathSync(root);
}

/** Resolves a path under the root, following links, so a symlink cannot lead outside it. */
function underRoot(root: string, path: string, label: string): string {
  const absolute = resolve(root, path);
  if (isAbsolute(path) || !inside(root, absolute)) throw new Error(`forbidden: ${label} fora da raiz de vídeo.`);
  return absolute;
}

/** Writes the app's own scene next to the data, pointing at the engine of the kit installed here. */
export function installVelixDossie(kitPath: string, folder: string): string {
  const file = join(folder, 'dossie.html');
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, VELIX_DOSSIE_HTML.replaceAll('__ENGINE__', pathToFileURL(join(kitPath, 'engine')).href));
  return file;
}

function dossieFile(kitPath: string, root: string, video: string | undefined): string {
  return installVelixDossie(kitPath, video ? join(root, velixVideoSlug(video), 'motion') : join(root, '.velix'));
}

function template(kitPath: string, id: string) {
  if (id === VELIX_DOSSIE_ID) return { id, label: 'Dossiê com dados', example: null, webgl: false, file: '' };
  const known = VELIX_TEMPLATES.find((item) => item.id === id);
  if (!known) throw new Error('invalid: template do Aethera desconhecido.');
  return { ...known, file: join(kitPath, 'templates', `${id}.html`) };
}

function writeData(root: string, id: string, data: string): string {
  try { JSON.parse(data); } catch { throw new Error('invalid: os dados da cena não são JSON válido.'); }
  const file = join(root, '.velix', `${id}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

function preparedOutput(root: string, outputPath: string): string {
  const output = underRoot(root, outputPath, 'saída');
  if (!/\.mp4$/i.test(output)) throw new Error('invalid: a saída deve ser MP4.');
  mkdirSync(dirname(output), { recursive: true });
  if (!inside(root, join(realpathSync(dirname(output)), basename(output)))) throw new Error('forbidden: saída fora da raiz de vídeo.');
  return output;
}

/** Where the transparent layer of an overlay render is written, next to the final MP4. */
export const overlayLayerPath = (output: string) => `${output}.layer.mov`;
/** Vertical 1080×1920 frame from any footage: fill and center-crop, as the reels reframe does. */
const REFRAME = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1';

/** FFmpeg arguments that put the transparent layer over the base video, keeping the base's sound and length. */
export function buildVelixOverlayArgs(base: string, layer: string, output: string): string[] {
  return ['-y', '-v', 'error', '-i', base, '-i', layer, '-filter_complex', `[0:v]${REFRAME},fps=30[b];[b][1:v]overlay=0:0:eof_action=pass[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}

export function buildVelixRenderArgs(kitPath: string, request: VelixRenderRequest, dataFile: string): string[] {
  const root = authorizedRoot(request.root);
  const scene = template(kitPath, request.template);
  const output = preparedOutput(root, request.outputPath);
  const file = request.template === VELIX_DOSSIE_ID ? dossieFile(kitPath, root, request.video) : scene.file;
  if (request.overlay) {
    const base = underRoot(root, request.overlay.baseRelativePath, 'vídeo base');
    if (!existsSync(base)) throw new Error('invalid: vídeo base não encontrado.');
    // The layer has no sound of its own: the base video brings the voice.
    return [join(kitPath, 'engine', 'render.mjs'), file, overlayLayerPath(output), '--data', dataFile, '--alpha', '--no-sfx', '--mb', request.quality === 'draft' ? '1' : '4', ...(scene.webgl ? ['--webgl'] : [])];
  }
  const audio = request.audioPath ? underRoot(root, request.audioPath, 'áudio') : null;
  if (audio && !existsSync(audio)) throw new Error('invalid: arquivo de áudio não encontrado.');
  return [join(kitPath, 'engine', 'render.mjs'), file, output, '--data', dataFile, ...(request.template === VELIX_DOSSIE_ID ? [] : ['--mb', request.quality === 'draft' ? '1' : '4']), ...(scene.webgl ? ['--webgl'] : []), ...(audio ? ['--audio', audio] : [])];
}

/** YouTube changes often, and a stale yt-dlp fails with a raw 403 that says nothing useful. */
export function velixImportError(message: string): string {
  if (/HTTP Error 403|Sign in to confirm|Requested format is not available/i.test(message)) return `O site recusou o download, o que costuma indicar yt-dlp desatualizado. Atualize com python -m pip install --user -U "yt-dlp[default]", reabra o app e tente de novo. Detalhe: ${message}`;
  return message;
}

export function buildVelixImportArgs(request: VelixImportRequest): string[] {
  if (request.confirmed !== true) throw new Error('forbidden: confirme que você tem direito de usar este vídeo.');
  const root = authorizedRoot(request.root);
  let url: URL;
  try { url = new URL(request.url); } catch { throw new Error('invalid: link inválido.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid: o link deve ser http ou https.');
  // `<=?` keeps sources that do not report a height, such as direct file links.
  const height = request.quality === 'mp3' ? null : `[height<=?${request.quality}]`;
  const media = height === null
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K']
    // H.264 first: VP9 and AV1 files play without picture in many Windows players.
    : ['-f', `bestvideo${height}[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo${height}[vcodec^=avc1]+bestaudio/best${height}[ext=mp4]/bestvideo${height}+bestaudio/best${height}`, '--merge-output-format', 'mp4'];
  return ['--no-playlist', '--restrict-filenames', '--no-warnings', '--newline', '--progress', '--print', 'after_move:filepath', '--paths', join(root, 'imports'), '-o', '%(title).80B-%(id)s.%(ext)s', ...media, '--', url.href];
}

export { run as runVelixCommand };

type RunOptions = { cwd: string; signal?: AbortSignal; onOutput?: (text: string) => void; onStderr?: (text: string) => void; env?: Record<string, string> };

/** The renderer spawns Chromium and FFmpeg, so cancelling has to take the whole process tree. */
function run(command: string, args: string[], { cwd, signal, onOutput, onStderr, env }: RunOptions): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled: renderização cancelada.'));
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', ...env } });
    let cancelled = false;
    let stderr = '';
    const cancel = () => {
      cancelled = true;
      if (child.pid === undefined) return;
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined);
      else process.kill(-child.pid, 'SIGTERM');
    };
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => onOutput?.(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-4_096);
      onStderr?.(text);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', cancel);
      if (cancelled) reject(new Error('cancelled: renderização cancelada.'));
      else if (code === 0) resolvePromise();
      else reject(new Error(`O MotionVelix falhou (${code ?? 'desconhecido'}): ${stderr.trim()}`));
    });
  });
}

export type VelixServiceOptions = { kitPath?: string; node?: string; downloader?: readonly string[]; store?: VelixRenderStore | undefined; ffmpeg?: string };

export function createVelixService({ kitPath = velixKitPath(), node = 'node', downloader = [process.env['NB_PYTHON'] ?? 'python', '-m', 'yt_dlp'], store, ffmpeg = process.env['NB_FFMPEG'] ?? 'ffmpeg' }: VelixServiceOptions = {}) {
  const jobs = new Map<string, { job: VelixRenderJob; controller: AbortController }>();
  store?.recover();
  const stored = (job: StoredVelixRenderJob): VelixRenderJob => ({ ...job, origin: job.origin ?? 'studio', agent: job.agent ?? null, progress: null, output: null });
  const assertIdle = () => { if ([...jobs.values()].some((entry) => entry.job.status === 'running')) throw new Error('busy: já existe uma renderização em execução.'); };
  const [downloadCommand = 'python', ...downloadPrefix] = downloader;
  return {
    /** yt-dlp is the user's own install, so it can be missing or too old without affecting renders. */
    async kit(): Promise<VelixKit> {
      linkVelixDependencies(kitPath);
      const downloaderVersion = await new Promise<string | null>((done) => {
        execFile(downloadCommand, [...downloadPrefix, '--version'], { windowsHide: true, timeout: 15_000 }, (error, stdout) => done(error ? null : stdout.trim() || null));
      });
      return { ...readVelixKit(kitPath), downloaderVersion };
    },
    importVideo(request: VelixImportRequest): VelixRenderJob {
      assertIdle();
      const root = authorizedRoot(request.root);
      const args = buildVelixImportArgs(request);
      const id = randomUUID();
      const entry = { job: { id, status: 'running', error: null, origin: 'studio', agent: null, progress: 0, output: null } as VelixRenderJob, controller: new AbortController() };
      jobs.set(id, entry);
      store?.save(entry.job);
      let printed = '';
      void run(downloadCommand, [...downloadPrefix, ...args], {
        cwd: root,
        signal: entry.controller.signal,
        onOutput: (text) => {
          printed = `${printed}${text}`.slice(-8_192);
          const percent = [...text.matchAll(/\[download\]\s+([\d.]+)%/g)].at(-1)?.[1];
          if (percent) entry.job.progress = Math.min(Number(percent) / 100, 1);
        },
      })
        .then(() => {
          const file = printed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('[')).at(-1);
          const absolute = file ? resolve(root, file) : '';
          if (!file || !inside(root, absolute) || !existsSync(absolute)) throw new Error('O download terminou sem gerar um arquivo na raiz.');
          entry.job.output = relative(root, absolute);
          entry.job.status = 'completed';
          entry.job.progress = 1;
          store?.update(entry.job);
        })
        .catch((error: unknown) => {
          entry.job.status = entry.controller.signal.aborted ? 'cancelled' : 'failed';
          entry.job.error = velixImportError(error instanceof Error ? error.message : String(error));
          store?.update(entry.job);
        });
      return entry.job;
    },
    start(request: VelixRenderRequest): VelixRenderJob {
      assertIdle();
      const id = randomUUID();
      const root = authorizedRoot(request.root);
      template(kitPath, request.template);
      linkVelixDependencies(kitPath);
      const args = buildVelixRenderArgs(kitPath, request, writeData(root, id, request.data));
      const output = args[2] as string;
      const entry = { job: { id, status: 'running', error: null, origin: request.origin ?? 'studio', agent: request.agent ?? null, progress: 0, output: request.outputPath } as VelixRenderJob, controller: new AbortController() };
      jobs.set(id, entry);
      store?.save(entry.job);
      const onOutput = (text: string) => {
        const match = [...text.matchAll(/(\d+)\/(\d+) frames/g)].at(-1);
        if (match) entry.job.progress = Number(match[1]) / Number(match[2]);
      };
      void runExclusiveRender(async () => {
        await run(node, args, { cwd: kitPath, signal: entry.controller.signal, onOutput });
          if (request.overlay) {
            const layer = output;
            if (!existsSync(layer)) throw new Error('O render terminou sem gerar a camada transparente.');
            const final = request.outputPath ? preparedOutput(root, request.outputPath) : layer.replace(/\.layer\.mov$/u, '');
            await run(ffmpeg, buildVelixOverlayArgs(underRoot(root, request.overlay.baseRelativePath, 'vídeo base'), layer, final), { cwd: dirname(final), signal: entry.controller.signal });
            rmSync(layer, { force: true });
            if (!existsSync(final)) throw new Error('A composição sobre o vídeo base não gerou o MP4.');
            return;
          }
          if (!existsSync(output)) throw new Error('O render terminou sem gerar o MP4.');
          // The kit's export brings loudness to the -14 LUFS of the reels; a kit without it keeps the plain render.
          const exporter = join(kitPath, 'scripts', 'mv_edit.py');
          if (request.normalize && existsSync(exporter)) {
            const final = `${output}.final.mp4`;
            await run(downloadCommand, [exporter, 'exportar', output, final], { cwd: dirname(output), signal: entry.controller.signal });
            renameSync(final, output);
          }
      }, entry.controller.signal)
        .then(() => { entry.job.status = 'completed'; entry.job.progress = 1; store?.update(entry.job); })
        .catch((error: unknown) => {
          entry.job.status = entry.controller.signal.aborted ? 'cancelled' : 'failed';
          entry.job.error = error instanceof Error ? error.message : String(error);
          store?.update(entry.job);
        });
      return entry.job;
    },
    cancel(id: string): VelixRenderJob {
      const entry = jobs.get(id);
      if (!entry) { const saved = store?.load(id); if (saved) return stored(saved); throw new Error('not_found: renderização não encontrada.'); }
      if (entry.job.status === 'running') entry.controller.abort();
      return entry.job;
    },
    get(id: string): VelixRenderJob | null { const job = jobs.get(id)?.job; if (job) return job; const saved = store?.load(id); return saved ? stored(saved) : null; },
    list() { return (store?.list() ?? [...jobs.values()].map(({ job }) => ({ ...job, createdAt: '', updatedAt: '' }))).map((job) => ({ ...job, origin: job.origin ?? 'studio', agent: job.agent ?? null })); },
    /** Stills of a scene at fixed times, to check it before a full render. */
    async frames(request: VelixRequest, times: readonly number[] = [0.5, 2, 4]): Promise<string[]> {
      return runExclusiveRender(async () => {
        const root = authorizedRoot(request.root);
        const scene = template(kitPath, request.template);
        linkVelixDependencies(kitPath);
        const id = randomUUID();
        const data = writeData(root, id, request.data);
        const file = request.template === VELIX_DOSSIE_ID ? dossieFile(kitPath, root, request.video) : scene.file;
        const base = join(root, '.velix', `${id}.png`);
        await run(node, [join(kitPath, 'engine', 'render.mjs'), file, base, '--data', data, '--preview', times.join(','), ...(request.overlay ? ['--alpha'] : []), ...(scene.webgl ? ['--webgl'] : [])], { cwd: kitPath });
        const still = (time: number) => join(root, '.velix', `${id}_t${time.toFixed(2)}.png`);
        if (request.overlay) {
          const footage = underRoot(root, request.overlay.baseRelativePath, 'vídeo base');
          for (const time of times) {
            const composed = join(root, '.velix', `${id}_c${time.toFixed(2)}.png`);
            await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(time), '-i', footage, '-i', still(time), '-filter_complex', `[0:v]${REFRAME}[b];[b][1:v]overlay=0:0`, '-frames:v', '1', composed], { cwd: root });
            renameSync(composed, still(time));
          }
        }
        return times.map((time) => `data:image/png;base64,${readFileSync(still(time)).toString('base64')}`);
      });
    },
  };
}
