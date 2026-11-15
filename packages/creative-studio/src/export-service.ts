import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { SharpSvgCompositionEngine } from './image-generation-adapter.js';
import {
  creativeProjectDocumentSchema,
  type CreativeProjectDocument,
  type ExportFormat,
} from './schemas.js';

const execFileAsync = promisify(execFile);

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  bytes: number;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  sha256: string;
}

export interface VideoWatermarkResult {
  outputPath: string;
  applied: boolean;
  skippedAlreadyWatermarked: boolean;
}

export class ExportService {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(
    private readonly engine: SharpSvgCompositionEngine,
    options?: { ffmpegPath?: string; ffprobePath?: string },
  ) {
    this.ffmpegPath = options?.ffmpegPath ?? process.env['NB_FFMPEG'] ?? 'ffmpeg';
    this.ffprobePath = options?.ffprobePath ?? process.env['NB_FFPROBE'] ?? 'ffprobe';
  }

  async exportProject(
    doc: CreativeProjectDocument,
    options: {
      outputPath: string;
      format: ExportFormat;
      quality?: number;
    },
  ): Promise<ExportResult> {
    const validated = creativeProjectDocumentSchema.parse(doc);
    const outPath = resolve(options.outputPath);
    mkdirSync(dirname(outPath), { recursive: true });

    if (options.format === 'project') {
      const json = JSON.stringify(validated, null, 2);
      const buffer = Buffer.from(json, 'utf8');
      writeFileSync(outPath, buffer);
      return {
        format: 'project',
        outputPath: outPath,
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    }

    const buffer = await this.engine.renderDocumentToBuffer(validated, options.format, options.quality ?? 92);
    writeFileSync(outPath, buffer);
    const meta = await sharp(buffer).metadata();
    return {
      format: options.format,
      outputPath: outPath,
      bytes: buffer.length,
      ...(meta.width !== undefined ? { width: meta.width } : {}),
      ...(meta.height !== undefined ? { height: meta.height } : {}),
      hasAlpha: Boolean(meta.hasAlpha),
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  loadPortableProject(projectJsonPath: string): CreativeProjectDocument {
    const abs = resolve(projectJsonPath);
    const raw = readFileSync(abs, 'utf8');
    return creativeProjectDocumentSchema.parse(JSON.parse(raw));
  }

  async exportAnimatedPreview(
    doc: CreativeProjectDocument,
    options: {
      outputPath: string;
      format?: 'mp4' | 'webp';
      durationSec?: number;
    },
  ): Promise<{ outputPath: string; format: 'mp4' | 'webp'; bytes: number }> {
    const format = options.format ?? 'mp4';
    const duration = Math.max(1.5, Math.min(8, options.durationSec ?? 3));
    const outPath = resolve(options.outputPath);
    mkdirSync(dirname(outPath), { recursive: true });

    const stillPath = `${outPath}.still.png`;
    const pngBuffer = await this.engine.renderDocumentToBuffer(doc, 'png');
    writeFileSync(stillPath, pngBuffer);

    const frames = Math.round(duration * 24);
    const args =
      format === 'webp'
        ? [
            '-y',
            '-loop',
            '1',
            '-i',
            stillPath,
            '-vf',
            `zoompan=z='min(zoom+0.0018,1.08)':d=${frames}:s=${doc.width}x${doc.height}:fps=24`,
            '-t',
            String(duration),
            '-loop',
            '0',
            outPath,
          ]
        : [
            '-y',
            '-loop',
            '1',
            '-i',
            stillPath,
            '-vf',
            `zoompan=z='min(zoom+0.0018,1.08)':d=${frames}:s=${doc.width}x${doc.height}:fps=24,format=yuv420p`,
            '-t',
            String(duration),
            '-c:v',
            'libx264',
            '-movflags',
            '+faststart',
            outPath,
          ];

    await execFileAsync(this.ffmpegPath, args);
    const bytes = readFileSync(outPath).length;
    return { outputPath: outPath, format, bytes };
  }

  async hasWatermarkApplied(videoPath: string): Promise<boolean> {
    const sidecar = `${resolve(videoPath)}.aethera-watermark.json`;
    if (existsSync(sidecar)) {
      return true;
    }
    try {
      const { stdout } = await execFileAsync(this.ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'format_tags=aethera_watermark_applied,comment',
        '-of',
        'json',
        videoPath,
      ]);
      const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
      const tags = parsed.format?.tags ?? {};
      return tags['aethera_watermark_applied'] === '1' || (tags['comment'] ?? '').includes('aethera_watermark=1');
    } catch {
      return false;
    }
  }

  /**
   * Applies a transparent PNG watermark onto a video idempotently:
   * if the input video already carries the Aethera watermark marker, it skips re-applying.
   */
  async applyWatermarkToVideo(options: {
    inputVideoPath: string;
    watermarkPngPath: string;
    outputVideoPath: string;
    anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    opacity?: number;
    marginPx?: number;
  }): Promise<VideoWatermarkResult> {
    const inputAbs = resolve(options.inputVideoPath);
    const wmAbs = resolve(options.watermarkPngPath);
    const outAbs = resolve(options.outputVideoPath);
    mkdirSync(dirname(outAbs), { recursive: true });

    if (await this.hasWatermarkApplied(inputAbs)) {
      if (inputAbs !== outAbs) {
        writeFileSync(outAbs, readFileSync(inputAbs));
      }
      writeFileSync(
        `${outAbs}.aethera-watermark.json`,
        JSON.stringify({ applied: true, source: 'preserved', checkedAt: new Date().toISOString() }, null, 2),
      );
      return { outputPath: outAbs, applied: false, skippedAlreadyWatermarked: true };
    }

    const margin = Math.max(8, options.marginPx ?? 24);
    const opacity = Math.max(0.1, Math.min(1, options.opacity ?? 0.72));
    const anchor = options.anchor ?? 'bottom-right';
    const overlayPos =
      anchor === 'top-left'
        ? `${margin}:${margin}`
        : anchor === 'top-right'
          ? `W-w-${margin}:${margin}`
          : anchor === 'bottom-left'
            ? `${margin}:H-h-${margin}`
            : `W-w-${margin}:H-h-${margin}`;

    const filterComplex = `[1:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[wm];[0:v][wm]overlay=${overlayPos}:format=auto[vout]`;

    await execFileAsync(this.ffmpegPath, [
      '-y',
      '-i',
      inputAbs,
      '-i',
      wmAbs,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-c:a',
      'copy',
      '-metadata',
      'aethera_watermark_applied=1',
      '-metadata',
      'comment=aethera_watermark=1',
      '-movflags',
      '+faststart',
      outAbs,
    ]);

    writeFileSync(
      join(dirname(outAbs), `${outAbs.split(/[\\/]/).pop()}.aethera-watermark.json`),
      JSON.stringify(
        {
          applied: true,
          anchor,
          opacity,
          appliedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    return { outputPath: outAbs, applied: true, skippedAlreadyWatermarked: false };
  }
}
