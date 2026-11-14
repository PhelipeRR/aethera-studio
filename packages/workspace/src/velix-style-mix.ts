import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { commonScript, planStyleMix, videoStyle, type CommonScript, type ProductionStyleChoice } from '@neuralbridge/shared/video-styles';
import { motionProjectFromScript } from './velix-motion-adapter.js';
import { runExclusiveRender } from './aethera-visual-scheduler.js';
import { renderMotionFrames, renderMotionProject } from './velix-motion.js';

const exec = promisify(execFile);
const safePath = (root: string, value: string) => {
  const base = resolve(root);
  const target = resolve(base, value);
  const rel = relative(base, target);
  if (rel.startsWith('..') || rel.includes(':')) throw new Error('caminho fora da raiz autorizada');
  return target;
};

export type StyleMixRenderRequest = {
  root: string;
  script: CommonScript | unknown;
  choice: ProductionStyleChoice;
  outputRelativePath: string;
  narrationRelativePath?: string;
  bundlePath: string;
  workerPath: string;
  runtime: string;
  browserExecutable: string;
  ffmpeg: string;
  ffprobe: string;
  signal?: AbortSignal;
  broll?: Array<{ afterScene: number; relativePath: string }>;
  onProgress?: (progress: number) => void;
  renderKitSegment?: (request: { styleId: string; treatmentId: string | null; script: CommonScript; outputRelativePath: string; signal?: AbortSignal }) => Promise<{ outputPath: string }>;
};

export type StyleMixRenderResult = { outputPath: string; segments: number; duration: number; hasAudio: boolean };
export type StyleMixPreviewRequest = Omit<StyleMixRenderRequest, 'outputRelativePath' | 'narrationRelativePath' | 'onProgress'> & { time: number };

type MotionOptions = NonNullable<Parameters<typeof motionProjectFromScript>[1]>;
const presetFor = (styleId: string, treatmentId: string | null): MotionOptions => {
  const preset = treatmentId === 'colagem-jornal' ? 'colagem-jornal' : styleId === 'one-take' ? 'one-take' : styleId === 'motion-cenas-editorial' ? 'editorial' : styleId === 'motion-cenas-base' ? 'base' : styleId as MotionOptions['preset'];
  return { templateId: styleId === 'motion-cenas-editorial' ? 'velix-editorial' : 'velix-base', ...(preset ? { preset } : {}) };
};

function segmentScript(script: CommonScript, from: number, to: number): CommonScript {
  const start = script.scenes[from]?.at ?? 0;
  const end = script.scenes[to]?.end ?? start;
  return {
    ...script,
    duration: Math.max(0, end - start),
    scenes: script.scenes.slice(from, to + 1).map((scene, index) => ({ ...scene, index, id: `${scene.id}-mix-${from}`, at: scene.at - start, end: scene.end - start })),
  };
}

async function run(binary: string, args: string[], signal?: AbortSignal) {
  try { return await exec(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) }); }
  catch (error) { if (signal?.aborted) { const cancelled = new Error('renderização cancelada'); cancelled.name = 'AbortError'; throw cancelled; } throw new Error(`FFmpeg falhou: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}

/** Renders adjacent style segments and assembles them into one narrated MP4. */
export function renderStyleMix(request: StyleMixRenderRequest): Promise<StyleMixRenderResult> {
  return renderStyleMixUnlocked(request);
}

async function renderStyleMixUnlocked(request: StyleMixRenderRequest): Promise<StyleMixRenderResult> {
  const script = 'scenes' in Object(request.script) ? request.script as CommonScript : commonScript(request.script);
  const plan = planStyleMix(script, request.choice);
  if (plan.problems.length) throw new Error(`invalid: ${plan.problems.join(' ')}`);
  if (!plan.segments.length) throw new Error('invalid: o roteiro não tem cenas para misturar.');
  const id = `style-mix-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const work = safePath(request.root, `.velix-${id}`);
  await mkdir(work, { recursive: true });
  try {
    const rendered: Array<{ outputPath: string }> = [];
    for (const [index, segment] of plan.segments.entries()) {
      const output = `.velix-${id}/segment-${index}.mp4`;
      const segmentSource = segmentScript(script, segment.fromScene, segment.toScene);
      const style = videoStyle(segment.styleId);
      if (style.engine !== 'remotion') {
        if (!request.renderKitSegment) throw new Error(`unsupported: o estilo ${style.label} precisa de um adaptador de segmento kit.`);
        rendered.push(await request.renderKitSegment({ styleId: segment.styleId, treatmentId: segment.treatmentId, script: segmentSource, outputRelativePath: output, ...(request.signal ? { signal: request.signal } : {}) }));
      } else {
        const project = motionProjectFromScript(segmentSource, presetFor(segment.styleId, segment.treatmentId));
        rendered.push(await renderMotionProject({ root: request.root, project, outputRelativePath: output, bundlePath: request.bundlePath, workerPath: request.workerPath, runtime: request.runtime, browserExecutable: request.browserExecutable, ffmpeg: request.ffmpeg, ffprobe: request.ffprobe, ...(request.signal ? { signal: request.signal } : {}), onProgress: (progress) => request.onProgress?.((index + progress) / plan.segments.length) }));
      }
      for (const broll of request.broll ?? []) {
        if (broll.afterScene === segment.toScene) {
          const brollPath = safePath(request.root, broll.relativePath);
          if (!brollPath.toLowerCase().endsWith('.mp4')) throw new Error('invalid: B-roll de colagem precisa ser MP4.');
          rendered.push({ outputPath: brollPath });
        }
      }
      request.onProgress?.((index + 1) / plan.segments.length);
    }
    return await runExclusiveRender(async () => {
      const normalized = [] as Array<{ outputPath: string }>;
      for (const [index, item] of rendered.entries()) {
        const source = safePath(request.root, item.outputPath);
        const target = join(work, `normalized-${index}.mp4`);
        await run(request.ffmpeg, ['-y', '-v', 'error', '-i', source, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', target], request.signal);
        normalized.push({ outputPath: target });
      }
      const list = join(work, 'concat.txt');
      const lines = normalized.map((item) => `file '${item.outputPath.replace(/'/gu, "'\\''")}'`).join('\n');
      await writeFile(list, `${lines}\n`, 'utf8');
      const output = safePath(request.root, request.outputRelativePath);
      await mkdir(dirname(output), { recursive: true });
      const videoOnly = join(work, 'video.mp4');
      await run(request.ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', videoOnly], request.signal);
      const inputs = ['-y', '-i', videoOnly];
      const maps = ['-map', '0:v:0'];
      if (request.narrationRelativePath) { inputs.push('-i', safePath(request.root, request.narrationRelativePath)); maps.push('-map', '1:a:0', '-shortest'); }
      else maps.push('-an');
      await run(request.ffmpeg, [...inputs, ...maps, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output], request.signal);
      const probe = await run(request.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', output], request.signal);
      const parsed = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
      return { outputPath: request.outputRelativePath, segments: rendered.length, duration: Number(parsed.format?.duration ?? 0), hasAudio: (parsed.streams ?? []).some((stream) => stream.codec_type === 'audio') };
    }, request.signal);
  } finally { await rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

/** Renders the requested timestamp from the exact segment used by the final mix. */
export async function previewStyleMix(request: StyleMixPreviewRequest): Promise<string> {
  const script = 'scenes' in Object(request.script) ? request.script as CommonScript : commonScript(request.script);
  const plan = planStyleMix(script, request.choice);
  if (plan.problems.length) throw new Error(`invalid: ${plan.problems.join(' ')}`);
  const segment = plan.segments.find((item) => request.time >= item.start && request.time <= item.end) ?? plan.segments.at(-1);
  if (!segment) throw new Error('invalid: o roteiro não tem cenas para pré-visualizar.');
  const style = videoStyle(segment.styleId);
  if (style.engine !== 'remotion') throw new Error(`unsupported: o estilo ${style.label} ainda não tem prévia de mistura Remotion.`);
  const start = segment.start;
  const project = motionProjectFromScript(segmentScript(script, segment.fromScene, segment.toScene), presetFor(segment.styleId, segment.treatmentId));
  const localTime = Math.max(0, Math.min(request.time - start, project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) / project.fps - 0.01));
  const [frame] = await renderMotionFrames({ root: request.root, project, times: [localTime], bundlePath: request.bundlePath, workerPath: request.workerPath, runtime: request.runtime, browserExecutable: request.browserExecutable, ffmpeg: request.ffmpeg, ffprobe: request.ffprobe, ...(request.signal ? { signal: request.signal } : {}) });
  if (!frame) throw new Error('A prévia da mistura não gerou imagem.');
  return frame;
}
