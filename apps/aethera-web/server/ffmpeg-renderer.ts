import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProductionProject, RenderJob, RenderProbeMetrics } from '../src/domain/types';

const execFileAsync = promisify(execFile);

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

function findFontPath(): string | null {
  for (const candidate of FONT_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function escapeDrawtext(input: string, maxLen = 46): string {
  const clean = input
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

function normalizeHex(hex: string, fallback: string): string {
  const clean = hex.trim().replace('#', '');
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `0x${clean}` : fallback;
}

export async function probeMediaFile(filePath: string): Promise<RenderProbeMetrics> {
  const stat = fs.statSync(filePath);
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 10_000 },
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let loudnessLufs: number | null = null;
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', filePath, '-filter_complex', 'ebur128', '-f', 'null', '-'],
      { timeout: 10_000 },
    );
    const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
    if (matches.length > 0) {
      loudnessLufs = Number(matches[matches.length - 1][1]);
    }
  } catch {
    loudnessLufs = null;
  }

  return {
    durationSec: Number(Number(parsed.format?.duration ?? 0).toFixed(2)),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    videoCodec: videoStream?.codec_name ?? 'unknown',
    audioCodec: audioStream?.codec_name ?? 'unknown',
    bitrateKbps: Math.round(Number(parsed.format?.bit_rate ?? 0) / 1000),
    fileSizeBytes: stat.size,
    loudnessLufs,
  };
}

export interface RenderCallbacks {
  onProgress: (job: RenderJob) => void;
  onComplete: (job: RenderJob) => void;
  onError: (job: RenderJob) => void;
}

export class FfmpegRenderManager {
  private readonly rendersDir: string;
  private activeProcesses = new Map<string, ReturnType<typeof spawn>>();

  constructor(rendersDir: string) {
    this.rendersDir = rendersDir;
    fs.mkdirSync(rendersDir, { recursive: true });
  }

  public cancelJob(jobId: string): boolean {
    const proc = this.activeProcesses.get(jobId);
    if (!proc) return false;
    proc.kill('SIGTERM');
    this.activeProcesses.delete(jobId);
    return true;
  }

  public async renderProjectPreview(
    project: ProductionProject,
    job: RenderJob,
    callbacks: RenderCallbacks,
  ): Promise<RenderJob> {
    fs.mkdirSync(this.rendersDir, { recursive: true });
    const safeProjectId = project.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const baseName = `${safeProjectId}-${job.id}`;
    const outputFilename = `${baseName}.mp4`;
    const thumbFilename = `${baseName}.jpg`;
    const outputPath = path.join(this.rendersDir, outputFilename);
    const thumbPath = path.join(this.rendersDir, thumbFilename);

    const isVertical = project.aspectRatio === '9:16';
    const width = isVertical ? 540 : job.preset === 'cinema_4k' ? 1280 : 960;
    const height = isVertical ? 960 : job.preset === 'cinema_4k' ? 720 : 540;
    const fps = 24;

    const scenes = project.scenes.slice(0, 5);
    const sceneDurationSec = 1.6;
    const totalDurationSec = Math.max(2, Number((scenes.length * sceneDurationSec).toFixed(2)));
    const fontPath = findFontPath();

    const updateJob = (patch: Partial<RenderJob>): RenderJob => {
      const updated: RenderJob = { ...job, ...patch };
      Object.assign(job, updated);
      callbacks.onProgress(updated);
      return updated;
    };

    try {
      updateJob({
        status: 'rendering',
        progressPct: 12,
        stageMessage: `Preparando grafo FFmpeg (${scenes.length} cenas, ${width}x${height} @ ${fps}fps)...`,
      });

      const filterParts: string[] = [];
      const concatInputs: string[] = [];
      const darkBgs = ['0x14131c', '0x1b1238', '0x22131d', '0x0f1a1c', '0x191926'];

      scenes.forEach((scene, idx) => {
        const bg = darkBgs[idx % darkBgs.length];
        const accent = normalizeHex(scene.accentHex, '0xb8a4f4');
        const label = `v${idx}`;
        const titleTxt = escapeDrawtext(`CENA ${scene.index}: ${scene.title}`, 40);
        const captionTxt = escapeDrawtext(scene.caption, 46);
        const headerTxt = escapeDrawtext(`AETHERA STUDIO • ${project.style.toUpperCase()}`, 44);

        const drawParts: string[] = [
          `color=c=${bg}:s=${width}x${height}:d=${sceneDurationSec}:r=${fps}`,
          `drawbox=x=0:y=0:w=${width}:h=10:color=${accent}:t=fill`,
          `drawbox=x=32:y=${height - 134}:w=${width - 64}:h=64:color=black@0.62:t=fill`,
        ];

        if (fontPath) {
          drawParts.push(
            `drawtext=fontfile='${fontPath}':text='${headerTxt}':fontcolor=${accent}:fontsize=${isVertical ? 18 : 20}:x=36:y=34`,
            `drawtext=fontfile='${fontPath}':text='${titleTxt}':fontcolor=white:fontsize=${isVertical ? 26 : 32}:x=(w-text_w)/2:y=(h-text_h)/2-28`,
            `drawtext=fontfile='${fontPath}':text='${captionTxt}':fontcolor=0xd8fb4f:fontsize=${isVertical ? 16 : 20}:x=(w-text_w)/2:y=${height - 110}`,
          );
        }

        drawParts.push('format=yuv420p');
        filterParts.push(`${drawParts.join(',')}[${label}]`);
        concatInputs.push(`[${label}]`);
      });

      filterParts.push(`${concatInputs.join('')}concat=n=${scenes.length}:v=1:a=0[vout]`);
      // Soft ambient audio tone normalized cleanly for real AAC stream + EBU R128 verification (~ -16 LUFS)
      filterParts.push(
        `sine=frequency=220:sample_rate=44100:duration=${totalDurationSec},volume=-14dB,afade=t=in:st=0:d=0.35,afade=t=out:st=${Math.max(0.5, totalDurationSec - 0.45)}:d=0.35[aout]`,
      );

      const args = [
        '-y',
        '-hide_banner',
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ];

      updateJob({
        progressPct: 35,
        stageMessage: 'Codificando vídeo H.264 + áudio AAC via FFmpeg...',
      });

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        this.activeProcesses.set(job.id, proc);

        let stderrBuf = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString('utf8');
          const timeMatch = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
          if (timeMatch && timeMatch.length > 0) {
            const last = timeMatch[timeMatch.length - 1];
            const parts = last.replace('time=', '').split(':').map(Number);
            const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            const pct = Math.min(82, Math.max(38, Math.round(35 + (sec / totalDurationSec) * 47)));
            if (pct > job.progressPct) {
              updateJob({
                progressPct: pct,
                stageMessage: `FFmpeg renderizando quadro (${sec.toFixed(1)}s / ${totalDurationSec}s)...`,
              });
            }
          }
        });

        proc.on('error', (err) => {
          this.activeProcesses.delete(job.id);
          reject(err);
        });

        proc.on('close', (code, signal) => {
          this.activeProcesses.delete(job.id);
          if (signal === 'SIGTERM') {
            reject(new Error('Render cancelado pelo usuário.'));
            return;
          }
          if (code !== 0) {
            reject(new Error(`FFmpeg encerrou com código ${code}: ${stderrBuf.slice(-300)}`));
            return;
          }
          resolve();
        });
      });

      updateJob({
        progressPct: 88,
        stageMessage: 'Extraindo frame thumbnail e auditando stream com FFprobe...',
      });

      // Extract real JPEG frame from the rendered MP4
      await execFileAsync(
        'ffmpeg',
        ['-y', '-hide_banner', '-ss', '0.5', '-i', outputPath, '-vframes', '1', '-q:v', '3', thumbPath],
        { timeout: 10_000 },
      );

      const metrics = await probeMediaFile(outputPath);

      const completedJob: RenderJob = {
        ...job,
        status: 'completed',
        progressPct: 100,
        stageMessage: `Render concluído (${metrics.width}×${metrics.height}, ${metrics.videoCodec}/${metrics.audioCodec}, ${metrics.durationSec}s).`,
        outputFilename,
        outputUrl: `/api/renders/${outputFilename}`,
        thumbnailUrl: `/api/renders/${thumbFilename}`,
        probeMetrics: metrics,
        completedAt: new Date().toISOString(),
        error: null,
      };
      callbacks.onComplete(completedJob);
      return completedJob;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCancelled = msg.includes('cancelado');
      const failedJob: RenderJob = {
        ...job,
        status: isCancelled ? 'cancelled' : 'failed',
        stageMessage: isCancelled ? 'Render cancelado.' : 'Falha na renderização FFmpeg.',
        error: msg,
        completedAt: new Date().toISOString(),
      };
      callbacks.onError(failedJob);
      return failedJob;
    }
  }
}
