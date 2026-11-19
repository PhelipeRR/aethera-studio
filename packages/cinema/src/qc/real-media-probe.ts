import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { QcFindingRecord } from '../ir/timeline-ir.js';

const execFileAsync = promisify(execFile);

export interface RealMp4ProbeResult {
  filePath: string;
  fileSizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  audioSampleRate: number | null;
  avDurationDeltaSec: number;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  blackFramesCount: number;
  frozenSegmentsCount: number;
  sceneCutsCount: number;
  silenceEventsCount: number;
}

export async function probeRealMp4(filePath: string): Promise<RealMp4ProbeResult> {
  if (!existsSync(filePath)) {
    throw new Error(`not_found: arquivo MP4 não encontrado em ${filePath}`);
  }

  const { stdout: ffprobeOut } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const parsed = JSON.parse(ffprobeOut) as {
    format?: { size?: string; duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      sample_rate?: string;
      duration?: string;
    }>;
  };

  const vStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const aStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  let fps = 30;
  if (vStream?.r_frame_rate && vStream.r_frame_rate.includes('/')) {
    const [numStr, denStr] = vStream.r_frame_rate.split('/');
    const num = Number(numStr);
    const den = Number(denStr);
    if (den > 0 && Number.isFinite(num)) fps = Number((num / den).toFixed(3));
  }

  const vDur = Number(vStream?.duration ?? parsed.format?.duration ?? 0);
  const aDur = Number(aStream?.duration ?? vDur);
  const avDurationDeltaSec = Number(Math.abs(vDur - aDur).toFixed(3));

  // Run real FFmpeg visual + EBU R128 loudness analysis on the rendered MP4
  const { stderr: analysisLog } = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-vf',
      'blackdetect=d=0.1:pix_th=0.10,freezedetect=n=-60dB:d=2.5,scdet=threshold=12',
      '-af',
      'ebur128=peak=true,silencedetect=n=-45dB:d=1.2',
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );

  const blackMatches = analysisLog.match(/black_start:/g);
  const freezeMatches = analysisLog.match(/lavfi\.freezedetect\.freeze_start:/g);
  const sceneCutMatches = analysisLog.match(/lavfi\.scd\.time:/g);
  const silenceMatches = analysisLog.match(/silence_start:/g);

  // Extract Summary Integrated loudness & True peak from ebur128 output
  const lufsMatch = analysisLog.match(/Summary:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const peakMatch = analysisLog.match(/True peak:\s*[\r\n]+\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);

  return {
    filePath,
    fileSizeBytes: Number(parsed.format?.size ?? 0),
    durationSec: Number(Number(parsed.format?.duration ?? vDur).toFixed(3)),
    width: vStream?.width ?? 0,
    height: vStream?.height ?? 0,
    fps,
    videoCodec: vStream?.codec_name ?? 'unknown',
    audioCodec: aStream?.codec_name ?? null,
    audioSampleRate: aStream?.sample_rate ? Number(aStream.sample_rate) : null,
    avDurationDeltaSec,
    integratedLufs: lufsMatch?.[1] ? Number(lufsMatch[1]) : null,
    truePeakDbtp: peakMatch?.[1] ? Number(peakMatch[1]) : null,
    blackFramesCount: blackMatches?.length ?? 0,
    frozenSegmentsCount: freezeMatches?.length ?? 0,
    sceneCutsCount: sceneCutMatches?.length ?? 0,
    silenceEventsCount: silenceMatches?.length ?? 0,
  };
}

export interface MediaAnomalyInterval {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface MediaAnomalyReport {
  blackIntervals: MediaAnomalyInterval[];
  silenceIntervals: MediaAnomalyInterval[];
  freezeIntervals: MediaAnomalyInterval[];
}

export async function detectMediaAnomalies(
  mediaPath: string,
  options?: { minBlackSec?: number; minSilenceSec?: number; minFreezeSec?: number },
): Promise<MediaAnomalyReport> {
  const minBlack = options?.minBlackSec ?? 0.4;
  const minSilence = options?.minSilenceSec ?? 1.5;
  const minFreeze = options?.minFreezeSec ?? 2.0;

  let stderr = '';
  try {
    const res = await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-i',
      mediaPath,
      '-vf',
      `blackdetect=d=${minBlack}:pix_th=0.10,freezedetect=n=-60dB:d=${minFreeze}`,
      '-af',
      `silencedetect=n=-50dB:d=${minSilence}`,
      '-f',
      'null',
      '-',
    ]);
    stderr = res.stderr ?? '';
  } catch (err) {
    stderr = (err as { stderr?: string })?.stderr ?? '';
  }

  const blackIntervals: MediaAnomalyInterval[] = [];
  for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    blackIntervals.push({
      startSec: Number(m[1]),
      endSec: Number(m[2]),
      durationSec: Number(m[3]),
    });
  }

  const silenceIntervals: MediaAnomalyInterval[] = [];
  let pendingSilenceStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const sMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (sMatch) pendingSilenceStart = Number(sMatch[1]);
    const eMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (eMatch) {
      const endSec = Number(eMatch[1]);
      const durationSec = Number(eMatch[2]);
      silenceIntervals.push({
        startSec: pendingSilenceStart ?? Math.max(0, endSec - durationSec),
        endSec,
        durationSec,
      });
      pendingSilenceStart = null;
    }
  }

  const freezeIntervals: MediaAnomalyInterval[] = [];
  let pendingFreezeStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const fsMatch = line.match(/freeze_start:\s*([\d.]+)/);
    if (fsMatch) pendingFreezeStart = Number(fsMatch[1]);
    const feMatch = line.match(/freeze_end:\s*([\d.]+)/);
    const fdMatch = line.match(/freeze_duration:\s*([\d.]+)/);
    if (feMatch && pendingFreezeStart !== null) {
      const endSec = Number(feMatch[1]);
      freezeIntervals.push({
        startSec: pendingFreezeStart,
        endSec,
        durationSec: fdMatch ? Number(fdMatch[1]) : Number((endSec - pendingFreezeStart).toFixed(3)),
      });
      pendingFreezeStart = null;
    }
  }

  return { blackIntervals, silenceIntervals, freezeIntervals };
}

export interface IntentionalAnomalyRanges {
  black?: Array<{ startSec: number; endSec: number }>;
  silence?: Array<{ startSec: number; endSec: number }>;
  freeze?: Array<{ startSec: number; endSec: number }>;
}

function overlapsIntentionalRange(
  interval: MediaAnomalyInterval,
  ranges?: Array<{ startSec: number; endSec: number }>,
): boolean {
  if (!ranges || ranges.length === 0) return false;
  return ranges.some((r) => interval.startSec < r.endSec && interval.endSec > r.startSec);
}

export function runRealMediaQc(
  probe: RealMp4ProbeResult,
  targetLufs = -14.0,
  anomalies?: MediaAnomalyReport,
  options?: {
    intentionalRanges?: IntentionalAnomalyRanges;
    dramaticSilenceMaxSec?: number;
  },
): QcFindingRecord[] {
  const findings: QcFindingRecord[] = [];
  const defaultRange = { start: { value: 0, rate: 1 }, duration: { value: Math.round(probe.durationSec), rate: 1 } };

  if (probe.blackFramesCount > 0) {
    findings.push({
      issueId: 'real_qc_black_frames',
      timeRange: defaultRange,
      category: 'technical',
      severity: 'critical',
      confidence: 1,
      evidence: `FFmpeg blackdetect encontrou ${probe.blackFramesCount} segmento(s) preto(s) no MP4 final.`,
      owner: 'editor',
      fixSuggestion: 'Remover ou substituir quadros pretos nas transições.',
      affectedDependencies: ['v1'],
      status: 'open',
    });
  }

  if (probe.avDurationDeltaSec > 0.2) {
    findings.push({
      issueId: 'real_qc_av_duration_drift',
      timeRange: defaultRange,
      category: 'technical',
      severity: 'critical',
      confidence: 1,
      evidence: `Diferença entre duração de vídeo e áudio é ${probe.avDurationDeltaSec}s (> 0.2s).`,
      owner: 'sound',
      fixSuggestion: 'Aplicar -shortest / apad sincronizado à duração exata do vídeo.',
      affectedDependencies: ['a_nar', 'a_mus'],
      status: 'open',
    });
  }

  if (probe.integratedLufs !== null && Math.abs(probe.integratedLufs - targetLufs) > 2.5) {
    findings.push({
      issueId: 'real_qc_loudness_drift',
      timeRange: defaultRange,
      category: 'audio',
      severity: 'warning',
      confidence: 0.98,
      evidence: `Loudness medido no MP4: ${probe.integratedLufs} LUFS (alvo: ${targetLufs} LUFS).`,
      owner: 'sound',
      fixSuggestion: 'Re-executar normalização EBU R128 para -14.0 LUFS.',
      affectedDependencies: ['a_nar', 'a_mus', 'a_sfx'],
      status: 'open',
    });
  }

  if (probe.truePeakDbtp !== null && probe.truePeakDbtp > -0.8) {
    findings.push({
      issueId: 'real_qc_true_peak_high',
      timeRange: defaultRange,
      category: 'audio',
      severity: 'critical',
      confidence: 1,
      evidence: `True peak medido no MP4: ${probe.truePeakDbtp} dBTP (> -0.8 dBTP).`,
      owner: 'sound',
      fixSuggestion: 'Limitar True Peak em -1.0 dBTP via loudnorm TP=-1.0.',
      affectedDependencies: ['a_nar', 'a_mus'],
      status: 'open',
    });
  }

  if (anomalies) {
    const dramaticSilenceMaxSec = options?.dramaticSilenceMaxSec ?? 2.2;
    for (const [idx, b] of anomalies.blackIntervals.entries()) {
      const isEdgeFade =
        (b.startSec < 1.0 && b.durationSec <= 1.2) ||
        (probe.durationSec > 2 && b.endSec >= probe.durationSec - 1.0 && b.durationSec <= 1.5);
      if (isEdgeFade || overlapsIntentionalRange(b, options?.intentionalRanges?.black)) {
        continue;
      }
      findings.push({
        issueId: `real_qc_black_interval_${idx}`,
        timeRange: { start: { value: Math.floor(b.startSec), rate: 1 }, duration: { value: Math.max(1, Math.ceil(b.durationSec)), rate: 1 } },
        category: 'visual',
        severity: 'warning',
        confidence: 1,
        evidence: `Trecho preto detectado via blackdetect (${b.startSec}s–${b.endSec}s, ${b.durationSec}s).`,
        owner: 'director',
        fixSuggestion: 'Substituir ou aparar trecho preto na cena afetada.',
        affectedDependencies: ['v1'],
        status: 'open',
      });
    }
    for (const [idx, s] of anomalies.silenceIntervals.entries()) {
      if (
        s.durationSec <= dramaticSilenceMaxSec ||
        overlapsIntentionalRange(s, options?.intentionalRanges?.silence)
      ) {
        continue;
      }
      findings.push({
        issueId: `real_qc_silence_interval_${idx}`,
        timeRange: { start: { value: Math.floor(s.startSec), rate: 1 }, duration: { value: Math.max(1, Math.ceil(s.durationSec)), rate: 1 } },
        category: 'audio',
        severity: 'warning',
        confidence: 1,
        evidence: `Silêncio prolongado detectado via silencedetect (${s.startSec}s–${s.endSec}s, ${s.durationSec}s).`,
        owner: 'sound',
        fixSuggestion: 'Verificar lacuna de narração ou preencher cama sonora.',
        affectedDependencies: ['a_nar'],
        status: 'open',
      });
    }
    for (const [idx, f] of anomalies.freezeIntervals.entries()) {
      if (overlapsIntentionalRange(f, options?.intentionalRanges?.freeze)) {
        continue;
      }
      findings.push({
        issueId: `real_qc_freeze_interval_${idx}`,
        timeRange: { start: { value: Math.floor(f.startSec), rate: 1 }, duration: { value: Math.max(1, Math.ceil(f.durationSec)), rate: 1 } },
        category: 'visual',
        severity: 'warning',
        confidence: 1,
        evidence: `Imagem congelada detectada via freezedetect (${f.startSec}s–${f.endSec}s, ${f.durationSec}s).`,
        owner: 'editor',
        fixSuggestion: 'Adicionar movimento de câmera (Ken Burns) ou trocar clipe estático.',
        affectedDependencies: ['v1'],
        status: 'open',
      });
    }
  }

  return findings;
}

export async function extractVerificationFrames(
  mp4Path: string,
  framesDir: string,
  timestampsSec: number[],
): Promise<string[]> {
  mkdirSync(framesDir, { recursive: true });
  const outputs: string[] = [];
  let lastError: unknown = null;
  for (let i = 0; i < timestampsSec.length; i += 1) {
    const ts = Math.max(0, timestampsSec[i] ?? 0);
    const outPath = join(framesDir, `frame_${String(i + 1).padStart(2, '0')}_${ts}s.jpg`);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss',
        String(ts),
        '-i',
        mp4Path,
        '-vf',
        "scale='min(640,iw)':-2",
        '-frames:v',
        '1',
        '-q:v',
        '4',
        outPath,
      ]);
      if (existsSync(outPath)) {
        outputs.push(outPath);
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (outputs.length === 0 && lastError) {
    throw lastError;
  }
  return outputs;
}

export async function extractSingleThumbnail(
  mediaPath: string,
  outPngPath: string,
  timestampSec = 1,
): Promise<string> {
  mkdirSync(join(outPngPath, '..'), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    String(Math.max(0, timestampSec)),
    '-i',
    mediaPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-2',
    outPngPath,
  ]);
  return outPngPath;
}

export async function extractWaveformPeaks(
  mediaPath: string,
  buckets = 64,
): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        mediaPath,
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 } as unknown as { encoding: 'buffer' },
    );
    const buf = stdout as unknown as Buffer;
    const sampleCount = Math.floor(buf.length / 2);
    if (sampleCount === 0) return Array.from({ length: buckets }, () => 0.12);
    const step = Math.max(1, Math.floor(sampleCount / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets; b += 1) {
      let maxAbs = 0;
      const start = b * step;
      const end = Math.min(sampleCount, start + step);
      for (let i = start; i < end; i += 1) {
        const val = Math.abs(buf.readInt16LE(i * 2)) / 32768;
        if (val > maxAbs) maxAbs = val;
      }
      peaks.push(Number(Math.max(0.06, Math.min(1, maxAbs)).toFixed(3)));
    }
    return peaks;
  } catch {
    return Array.from({ length: buckets }, () => 0.12);
  }
}
