import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CreateRemoteJobRequest, RemoteEngineMode } from './contracts/v1';
import { killProcessTree } from './agents';
import { checkFfmpegNvencSupport, detectMonorepoPackages, locateBinary } from './telemetry';

const execFileAsync = promisify(execFile);

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

function findSystemFont(): string | null {
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
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}...` : clean;
}

function normalizeHex(hex: string | undefined, fallback: string): string {
  const clean = (hex ?? '').trim().replace('#', '');
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `0x${clean}` : fallback;
}

export interface MediaProbeResult {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  bitrateKbps: number;
  sizeBytes: number;
  loudnessLufs: number | null;
}

export async function probeMediaWithFfprobe(filePath: string): Promise<MediaProbeResult> {
  const ffprobePath = locateBinary('ffprobe');
  if (!ffprobePath) {
    throw new Error('Binário ffprobe não encontrado neste host.');
  }
  const stat = fs.statSync(filePath);
  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 10_000, windowsHide: true },
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let loudnessLufs: number | null = null;
  const ffmpegPath = locateBinary('ffmpeg');
  if (ffmpegPath) {
    try {
      const { stderr } = await execFileAsync(
        ffmpegPath,
        ['-hide_banner', '-nostats', '-i', filePath, '-filter_complex', 'ebur128', '-f', 'null', '-'],
        { timeout: 15_000, windowsHide: true },
      );
      const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
      if (matches.length > 0) {
        loudnessLufs = Number(matches[matches.length - 1][1]);
      }
    } catch {
      loudnessLufs = null;
    }
  }

  return {
    durationSec: Number(Number(parsed.format?.duration ?? 0).toFixed(2)),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    videoCodec: videoStream?.codec_name ?? 'unknown',
    audioCodec: audioStream?.codec_name ?? 'unknown',
    bitrateKbps: Math.round(Number(parsed.format?.bit_rate ?? 0) / 1000),
    sizeBytes: stat.size,
    loudnessLufs,
  };
}

export interface RealFfmpegRenderOutput {
  mp4Path: string;
  mp4Filename: string;
  thumbPath: string;
  thumbFilename: string;
  encoderUsed: 'h264_nvenc' | 'libx264';
  probe: MediaProbeResult;
}

export interface CinemaBridgeHandle {
  engineMode: RemoteEngineMode;
  monorepoCinemaLoaded: boolean;
  produceViaMonorepoIfAvailable(input: {
    prompt: string;
    title: string;
    style: string;
    aspectRatio: '16:9' | '9:16';
    outputDir: string;
    onLog: (msg: string, level: 'info' | 'warn' | 'error') => void;
  }): Promise<{ handled: boolean; summary?: string; mp4Path?: string; reason?: string }>;
  renderMp4WithRealFfmpeg(input: {
    jobId: string;
    title: string;
    style: string;
    aspectRatio: '16:9' | '9:16';
    qualityPreset: NonNullable<CreateRemoteJobRequest['qualityPreset']>;
    useGpu: boolean;
    scenes: Array<{ index: number; title: string; caption: string; accentHex?: string }>;
    outputDir: string;
    signal?: AbortSignal;
    onProgressPct: (pct: number, detail: string) => void;
    onLog: (msg: string, level: 'info' | 'warn' | 'error') => void;
    onSpawn?: (child: ChildProcess) => void;
  }): Promise<RealFfmpegRenderOutput>;
  acquireMediaViaYtDlp(input: {
    query?: string;
    url?: string;
    outputDir: string;
    signal?: AbortSignal;
    onLog: (msg: string, level: 'info' | 'warn' | 'error') => void;
    onSpawn?: (child: ChildProcess) => void;
  }): Promise<{ ok: boolean; filePath?: string; filename?: string; metadata?: Record<string, unknown>; error?: string }>;
}

/**
 * Cinema Engine Bridge (Phase 4):
 * - Reuses the real `@neuralbridge/cinema` package dynamically when present in the user's Windows monorepo.
 * - Never fabricates missing `@neuralbridge/*` contracts.
 * - Executes real FFmpeg (with NVIDIA h264_nvenc detection + libx264 fallback), FFprobe, EBU R128, and yt-dlp.
 */
export function createCinemaBridge(monorepoRoot: string): CinemaBridgeHandle {
  const pkgStatus = detectMonorepoPackages(monorepoRoot);

  return {
    engineMode: pkgStatus.engineMode,
    monorepoCinemaLoaded: pkgStatus.cinema,

    async produceViaMonorepoIfAvailable(input) {
      if (!pkgStatus.cinema) {
        return {
          handled: false,
          reason:
            'Pacote @neuralbridge/cinema não está presente neste snapshot. No PC Windows com o monorepo completo, o Remote Host delegará diretamente para produceCinemaPackage/renderRealCinemaMp4.',
        };
      }

      try {
        const cinemaSpecifier = '@neuralbridge/cinema';
        const mod = (await import(cinemaSpecifier)) as {
          produceCinemaPackage?: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
          renderRealCinemaMp4?: (opts: Record<string, unknown>) => Promise<{ outputPath?: string }>;
        };

        if (typeof mod.produceCinemaPackage !== 'function') {
          return {
            handled: false,
            reason: 'Módulo @neuralbridge/cinema encontrado, mas produceCinemaPackage não está exportado.',
          };
        }

        input.onLog('[Cinema Engine] Delegando produção para o pacote real @neuralbridge/cinema do monorepo...', 'info');
        const pkg = await mod.produceCinemaPackage({
          prompt: input.prompt,
          title: input.title,
          genre: input.style,
          deliveryFormat: input.aspectRatio === '9:16' ? 'shorts_9_16' : 'youtube_1080p',
          outputDir: input.outputDir,
        });

        let mp4Path: string | undefined;
        if (typeof mod.renderRealCinemaMp4 === 'function') {
          input.onLog('[Cinema Engine] Executando renderRealCinemaMp4 do pacote @neuralbridge/cinema...', 'info');
          const rendered = await mod.renderRealCinemaMp4({ package: pkg, outputDir: input.outputDir });
          mp4Path = rendered?.outputPath;
        }

        return {
          handled: true,
          summary: `Produção executada pelo @neuralbridge/cinema real (${input.title}).`,
          ...(mp4Path ? { mp4Path } : {}),
        };
      } catch (err) {
        return {
          handled: false,
          reason: `Falha ao carregar @neuralbridge/cinema: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async renderMp4WithRealFfmpeg(input) {
      const ffmpegPath = locateBinary('ffmpeg');
      if (!ffmpegPath) {
        throw new Error('FFmpeg não encontrado no PATH deste host. Instale o FFmpeg para renderizar MP4.');
      }

      fs.mkdirSync(input.outputDir, { recursive: true });
      const mp4Filename = `aethera-${input.jobId}.mp4`;
      const thumbFilename = `aethera-${input.jobId}.jpg`;
      const mp4Path = path.join(input.outputDir, mp4Filename);
      const thumbPath = path.join(input.outputDir, thumbFilename);

      const nvencReady = input.useGpu ? await checkFfmpegNvencSupport(ffmpegPath) : false;
      const encoderUsed: 'h264_nvenc' | 'libx264' = nvencReady ? 'h264_nvenc' : 'libx264';
      input.onLog(
        nvencReady
          ? '[FFmpeg GPU] Encoder NVIDIA h264_nvenc verificado e ativado para renderização.'
          : '[FFmpeg CPU] Encoder libx264 ativo (NVENC indisponível ou desabilitado).',
        'info',
      );

      const isVertical = input.aspectRatio === '9:16';
      const resolution =
        input.qualityPreset === 'cinema_4k'
          ? isVertical
            ? { w: 1080, h: 1920 }
            : { w: 1920, h: 1080 }
          : input.qualityPreset === 'master_1080p'
            ? isVertical
              ? { w: 720, h: 1280 }
              : { w: 1280, h: 720 }
            : isVertical
              ? { w: 540, h: 960 }
              : { w: 960, h: 540 };

      const fps = 24;
      const scenes = input.scenes.slice(0, 6);
      const sceneDurationSec = 1.6;
      const totalDurationSec = Math.max(2, Number((scenes.length * sceneDurationSec).toFixed(2)));
      const fontPath = findSystemFont();

      const filterParts: string[] = [];
      const concatInputs: string[] = [];
      const darkBgs = ['0x14131c', '0x1b1238', '0x22131d', '0x0f1a1c', '0x191926'];

      scenes.forEach((scene, idx) => {
        const bg = darkBgs[idx % darkBgs.length];
        const accent = normalizeHex(scene.accentHex, '0xb8a4f4');
        const label = `v${idx}`;
        const headerTxt = escapeDrawtext(`AETHERA REMOTE • ${input.style.toUpperCase()}`, 44);
        const titleTxt = escapeDrawtext(`CENA ${scene.index}: ${scene.title}`, 40);
        const captionTxt = escapeDrawtext(scene.caption, 46);

        const drawParts: string[] = [
          `color=c=${bg}:s=${resolution.w}x${resolution.h}:d=${sceneDurationSec}:r=${fps}`,
          `drawbox=x=0:y=0:w=${resolution.w}:h=10:color=${accent}:t=fill`,
          `drawbox=x=32:y=${resolution.h - 134}:w=${resolution.w - 64}:h=64:color=black@0.62:t=fill`,
        ];

        if (fontPath) {
          const safeFont = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          drawParts.push(
            `drawtext=fontfile='${safeFont}':text='${headerTxt}':fontcolor=${accent}:fontsize=${isVertical ? 18 : 20}:x=36:y=34`,
            `drawtext=fontfile='${safeFont}':text='${titleTxt}':fontcolor=white:fontsize=${isVertical ? 26 : 32}:x=(w-text_w)/2:y=(h-text_h)/2-28`,
            `drawtext=fontfile='${safeFont}':text='${captionTxt}':fontcolor=0xd8fb4f:fontsize=${isVertical ? 16 : 20}:x=(w-text_w)/2:y=${resolution.h - 110}`,
          );
        }

        drawParts.push('format=yuv420p');
        filterParts.push(`${drawParts.join(',')}[${label}]`);
        concatInputs.push(`[${label}]`);
      });

      filterParts.push(`${concatInputs.join('')}concat=n=${scenes.length}:v=1:a=0[vout]`);
      filterParts.push(
        `sine=frequency=220:sample_rate=44100:duration=${totalDurationSec},volume=-14dB,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0.4, totalDurationSec - 0.4)}:d=0.3[aout]`,
      );

      const videoEncoderArgs =
        encoderUsed === 'h264_nvenc'
          ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', '4M']
          : ['-c:v', 'libx264', '-preset', 'ultrafast'];

      const args = [
        '-y',
        '-hide_banner',
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        ...videoEncoderArgs,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        mp4Path,
      ];

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
          detached: process.platform !== 'win32',
        });
        input.onSpawn?.(proc);

        const onAbort = () => {
          killProcessTree(proc);
          reject(new Error('Render FFmpeg cancelado pelo usuário.'));
        };
        if (input.signal?.aborted) {
          onAbort();
          return;
        }
        input.signal?.addEventListener('abort', onAbort, { once: true });

        let stderrBuf = '';
        let lastEmittedPct = -1;

        proc.stderr?.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString('utf8');
          // Real progress derived strictly from FFmpeg stderr `time=HH:MM:SS.xx`
          const matches = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
          if (matches && matches.length > 0) {
            const last = matches[matches.length - 1];
            const [hh, mm, ss] = last.replace('time=', '').split(':').map(Number);
            const renderedSec = hh * 3600 + mm * 60 + ss;
            const pct = Math.min(99, Math.max(0, Math.round((renderedSec / totalDurationSec) * 100)));
            if (pct > lastEmittedPct) {
              lastEmittedPct = pct;
              input.onProgressPct(pct, `FFmpeg (${encoderUsed}) renderizando ${renderedSec.toFixed(1)}s / ${totalDurationSec}s`);
            }
          }
        });

        proc.on('error', (err) => {
          input.signal?.removeEventListener('abort', onAbort);
          reject(err);
        });

        proc.on('close', (code) => {
          input.signal?.removeEventListener('abort', onAbort);
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`FFmpeg encerrou com código ${code}: ${stderrBuf.slice(-300)}`));
        });
      });

      await execFileAsync(
        ffmpegPath,
        ['-y', '-hide_banner', '-ss', '0.5', '-i', mp4Path, '-vframes', '1', '-q:v', '3', thumbPath],
        { timeout: 10_000, windowsHide: true },
      );

      const probe = await probeMediaWithFfprobe(mp4Path);
      input.onProgressPct(100, `Render concluído (${probe.width}×${probe.height}, ${probe.videoCodec}/${probe.audioCodec}, ${probe.durationSec}s).`);

      return {
        mp4Path,
        mp4Filename,
        thumbPath,
        thumbFilename,
        encoderUsed,
        probe,
      };
    },

    async acquireMediaViaYtDlp(input) {
      const ytdlpPath = locateBinary('yt-dlp');
      if (!ytdlpPath) {
        return {
          ok: false,
          error: 'Binário yt-dlp não encontrado neste host. Instale yt-dlp no Windows (`winget install yt-dlp.yt-dlp`) para aquisição real de mídias.',
        };
      }

      const rawTarget = (input.url || '').trim();
      const rawQuery = (input.query || '').trim();
      if (!rawTarget && !rawQuery) {
        return { ok: false, error: 'Informe uma URL HTTPS válida ou um termo de busca para o yt-dlp.' };
      }

      // Strict input validation: never pass flags or shell metacharacters
      let targetArg: string;
      if (rawTarget) {
        if (!/^https:\/\/[^\s]+$/i.test(rawTarget)) {
          return { ok: false, error: 'URL inválida: apenas URLs https:// são permitidas.' };
        }
        targetArg = rawTarget;
      } else {
        const safeQuery = rawQuery.replace(/[;&|`$<>]/g, ' ').trim().slice(0, 120);
        targetArg = `ytsearch1:${safeQuery}`;
      }

      fs.mkdirSync(input.outputDir, { recursive: true });
      const outTemplate = path.join(input.outputDir, 'ytdlp-%(id)s.%(ext)s');
      input.onLog(`[yt-dlp] Consultando e baixando mídia controlada para ${targetArg}...`, 'info');

      return new Promise((resolve) => {
        const proc = spawn(
          ytdlpPath,
          ['--no-playlist', '--max-filesize', '120M', '--print-json', '-o', outTemplate, '--', targetArg],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
            detached: process.platform !== 'win32',
          },
        );
        input.onSpawn?.(proc);

        const onAbort = () => {
          killProcessTree(proc);
          resolve({ ok: false, error: 'Aquisição yt-dlp cancelada pelo usuário.' });
        };
        input.signal?.addEventListener('abort', onAbort, { once: true });

        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        proc.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        proc.on('error', (err) => {
          input.signal?.removeEventListener('abort', onAbort);
          resolve({ ok: false, error: err.message });
        });
        proc.on('close', (code) => {
          input.signal?.removeEventListener('abort', onAbort);
          if (code !== 0) {
            resolve({ ok: false, error: stderr.trim().slice(-300) || `yt-dlp falhou (código ${code})` });
            return;
          }
          try {
            const firstJsonLine = stdout.trim().split(/\r?\n/).find((l) => l.startsWith('{'));
            const meta = firstJsonLine ? (JSON.parse(firstJsonLine) as Record<string, unknown>) : {};
            const filename = typeof meta['_filename'] === 'string' ? meta['_filename'] : undefined;
            resolve({
              ok: true,
              ...(filename ? { filePath: filename, filename: path.basename(filename) } : {}),
              metadata: meta,
            });
          } catch {
            resolve({ ok: true });
          }
        });
      });
    },
  };
}
