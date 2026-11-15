import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { AssetIngestionService } from './asset-ingestion.js';
import type { ManagedAssetRef } from './schemas.js';

const execFileAsync = promisify(execFile);

export interface VideoSceneHint {
  timestampSec: number;
  label?: string;
  emotion?: string;
  narrationExcerpt?: string;
}

export interface FrameProvenanceSummary {
  origin: string;
  workTitle: string;
  episode?: number | string | null;
  fromSec: number;
  toSec: number;
  confidence: number;
  anilistId?: number;
  malId?: number;
  fromCache: boolean;
}

export interface FrameProvenanceResolver {
  identifyFrame(input: {
    framePath?: string;
    frameBuffer?: Buffer;
    mimeType?: string;
    signal?: AbortSignal;
  }): Promise<{
    status: string;
    topMatch?: {
      origin: string;
      workTitle: string;
      episode?: number | string | null;
      fromSec: number;
      toSec: number;
      confidence: number;
      identifiers?: { anilistId?: number; malId?: number };
      evidence: { fromCache: boolean };
    };
  }>;
}

export interface ExtractedFrameCandidate {
  timestampSec: number;
  asset: ManagedAssetRef;
  impactScore: number;
  brightness: number;
  contrastScore: number;
  saturationScore: number;
  isBlackFrame: boolean;
  sceneHint?: VideoSceneHint;
  provenance?: FrameProvenanceSummary;
}

export interface VideoFrameAnalysisResult {
  videoPath: string;
  durationSec: number;
  width: number;
  height: number;
  candidates: ExtractedFrameCandidate[];
  bestCandidate: ExtractedFrameCandidate | null;
}

export class VideoFrameAnalyzer {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly provenanceResolver?: FrameProvenanceResolver;

  constructor(
    private readonly ingestion: AssetIngestionService,
    options?: {
      ffmpegPath?: string;
      ffprobePath?: string;
      provenanceResolver?: FrameProvenanceResolver;
    },
  ) {
    this.ffmpegPath = options?.ffmpegPath ?? process.env['NB_FFMPEG'] ?? 'ffmpeg';
    this.ffprobePath = options?.ffprobePath ?? process.env['NB_FFPROBE'] ?? 'ffprobe';
    this.provenanceResolver = options?.provenanceResolver;
  }

  async analyzeAndExtractFrames(options: {
    videoPath: string;
    sampleCount?: number;
    sceneHints?: VideoSceneHint[];
    identifyAnimeProvenance?: boolean;
  }): Promise<VideoFrameAnalysisResult> {
    const absVideo = resolve(options.videoPath);
    if (!existsSync(absVideo)) {
      throw new Error(`Video file not found: ${absVideo}`);
    }

    const probe = await this.probeVideo(absVideo);
    const sampleCount = Math.max(3, Math.min(12, options.sampleCount ?? 6));
    const timestamps = this.selectTimestamps(probe.durationSec, sampleCount, options.sceneHints);

    const workDir = join(tmpdir(), `aethera-frames-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(workDir, { recursive: true });

    const candidates: ExtractedFrameCandidate[] = [];
    try {
      for (let i = 0; i < timestamps.length; i += 1) {
        const ts = timestamps[i]!;
        const frameFile = join(workDir, `frame-${i}.png`);
        await execFileAsync(this.ffmpegPath, [
          '-y',
          '-ss',
          ts.toFixed(3),
          '-i',
          absVideo,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          frameFile,
        ]);
        if (!existsSync(frameFile)) continue;

        const metrics = await this.scoreFrameImage(frameFile);
        const asset = await this.ingestion.ingestFile({
          sourcePath: frameFile,
          kind: 'frame',
          originalName: `frame-${ts.toFixed(2)}s.png`,
        });

        const matchingHint = options.sceneHints?.find((h) => Math.abs(h.timestampSec - ts) <= 1.5);
        candidates.push({
          timestampSec: ts,
          asset,
          ...metrics,
          ...(matchingHint ? { sceneHint: matchingHint } : {}),
        });
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }

    candidates.sort((a, b) => b.impactScore - a.impactScore);
    const bestCandidate = candidates.find((c) => !c.isBlackFrame) ?? candidates[0] ?? null;

    if (options.identifyAnimeProvenance && bestCandidate && this.provenanceResolver) {
      try {
        const prov = await this.provenanceResolver.identifyFrame({
          framePath: bestCandidate.asset.storagePath,
          mimeType: bestCandidate.asset.mimeType,
        });
        if (prov.status === 'ok' && prov.topMatch) {
          const m = prov.topMatch;
          bestCandidate.provenance = {
            origin: m.origin,
            workTitle: m.workTitle,
            episode: m.episode ?? null,
            fromSec: m.fromSec,
            toSec: m.toSec,
            confidence: m.confidence,
            ...(m.identifiers?.anilistId !== undefined ? { anilistId: m.identifiers.anilistId } : {}),
            ...(m.identifiers?.malId !== undefined ? { malId: m.identifiers.malId } : {}),
            fromCache: m.evidence.fromCache,
          };
        }
      } catch {
        // non-fatal provenance fallback
      }
    }

    return {
      videoPath: absVideo,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      candidates,
      bestCandidate,
    };
  }

  private selectTimestamps(durationSec: number, sampleCount: number, hints?: VideoSceneHint[]): number[] {
    const safeDuration = Math.max(0.5, durationSec);
    const set = new Set<number>();

    if (hints && hints.length > 0) {
      for (const hint of hints) {
        const clamped = Math.max(0.05, Math.min(safeDuration - 0.05, hint.timestampSec));
        set.add(Number(clamped.toFixed(2)));
      }
    }

    for (let i = 0; i < sampleCount; i += 1) {
      const ratio = (i + 1) / (sampleCount + 1);
      set.add(Number((safeDuration * ratio).toFixed(2)));
    }

    return Array.from(set).sort((a, b) => a - b).slice(0, sampleCount + 4);
  }

  private async scoreFrameImage(framePath: string): Promise<{
    impactScore: number;
    brightness: number;
    contrastScore: number;
    saturationScore: number;
    isBlackFrame: boolean;
  }> {
    const stats = await sharp(framePath).stats();
    const r = stats.channels[0];
    const g = stats.channels[1];
    const b = stats.channels[2];
    const meanBrightness = ((r?.mean ?? 0) + (g?.mean ?? 0) + (b?.mean ?? 0)) / 3;
    const meanStdev = ((r?.stdev ?? 0) + (g?.stdev ?? 0) + (b?.stdev ?? 0)) / 3;
    const channelSpread =
      Math.abs((r?.mean ?? 0) - (g?.mean ?? 0)) +
      Math.abs((g?.mean ?? 0) - (b?.mean ?? 0)) +
      Math.abs((r?.mean ?? 0) - (b?.mean ?? 0));

    const isBlackFrame = meanBrightness < 12 && meanStdev < 8;
    const brightnessNorm = 100 - Math.min(100, Math.abs(meanBrightness - 128) * 0.9);
    const contrastScore = Math.min(100, Math.round((meanStdev / 72) * 100));
    const saturationScore = Math.min(100, Math.round((channelSpread / 120) * 100));
    const impactScore = isBlackFrame
      ? 0
      : Math.round(contrastScore * 0.5 + saturationScore * 0.3 + brightnessNorm * 0.2);

    return {
      impactScore,
      brightness: Math.round(meanBrightness),
      contrastScore,
      saturationScore,
      isBlackFrame,
    };
  }

  private async probeVideo(videoPath: string): Promise<{ durationSec: number; width: number; height: number }> {
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      videoPath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    return {
      width: stream?.width ?? 1280,
      height: stream?.height ?? 720,
      durationSec: Math.max(0.5, Number(parsed.format?.duration ?? 5)),
    };
  }
}
