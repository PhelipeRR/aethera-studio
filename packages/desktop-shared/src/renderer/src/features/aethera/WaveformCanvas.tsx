import React, { useEffect, useMemo, useRef } from 'react';

export interface WaveformBucketView {
  min: number;
  max: number;
  rms: number;
}

export interface WaveformDataView {
  filePath: string;
  sampleRate: number;
  durationSec: number;
  hasAudio: boolean;
  buckets: WaveformBucketView[];
  cached: boolean;
}

export type AudioTrackRole = 'voiceover' | 'music' | 'sfx' | 'ambience';

interface WaveformCanvasProps {
  data: WaveformDataView | null;
  loading?: boolean;
  error?: string | null;
  widthPx: number;
  heightPx?: number;
  role: AudioTrackRole;
  sourceStartSec?: number;
  timelineDurationSec: number;
  speed?: number;
  gainDb?: number;
  muted?: boolean;
  fadeInSec?: number;
  fadeOutSec?: number;
  label?: string;
}

const ROLE_PALETTES: Record<
  AudioTrackRole,
  { peak: string; rms: string; zeroLine: string; mutedPeak: string }
> = {
  voiceover: {
    peak: 'rgba(16, 185, 129, 0.58)',
    rms: 'rgba(52, 211, 153, 0.92)',
    zeroLine: 'rgba(16, 185, 129, 0.28)',
    mutedPeak: 'rgba(100, 116, 139, 0.35)',
  },
  music: {
    peak: 'rgba(14, 165, 233, 0.52)',
    rms: 'rgba(56, 189, 248, 0.88)',
    zeroLine: 'rgba(56, 189, 248, 0.25)',
    mutedPeak: 'rgba(100, 116, 139, 0.35)',
  },
  sfx: {
    peak: 'rgba(245, 158, 11, 0.58)',
    rms: 'rgba(251, 191, 36, 0.94)',
    zeroLine: 'rgba(245, 158, 11, 0.28)',
    mutedPeak: 'rgba(100, 116, 139, 0.35)',
  },
  ambience: {
    peak: 'rgba(139, 92, 246, 0.52)',
    rms: 'rgba(167, 139, 250, 0.88)',
    zeroLine: 'rgba(167, 139, 250, 0.25)',
    mutedPeak: 'rgba(100, 116, 139, 0.35)',
  },
};

export function resampleWaveformForClip(
  data: WaveformDataView,
  options: {
    sourceStartSec: number;
    timelineDurationSec: number;
    speed: number;
    targetBuckets: number;
  },
): WaveformBucketView[] {
  const targetBuckets = Math.max(1, Math.min(4096, Math.floor(options.targetBuckets)));
  if (!data.hasAudio || data.buckets.length === 0 || data.durationSec <= 0) {
    return Array.from({ length: targetBuckets }, () => ({ min: 0, max: 0, rms: 0 }));
  }

  const speed = Math.max(0.1, options.speed);
  const startSec = Math.max(0, options.sourceStartSec);
  const sourceSpanSec = Math.max(0.01, options.timelineDurationSec * speed);
  const endSec = Math.min(data.durationSec, startSec + sourceSpanSec);
  if (endSec <= startSec) {
    return Array.from({ length: targetBuckets }, () => ({ min: 0, max: 0, rms: 0 }));
  }

  const total = data.buckets.length;
  const startIdx = Math.max(0, Math.min(total - 1, (startSec / data.durationSec) * total));
  const endIdx = Math.max(startIdx + 0.001, Math.min(total, (endSec / data.durationSec) * total));
  const span = endIdx - startIdx;

  const out: WaveformBucketView[] = new Array(targetBuckets);
  for (let b = 0; b < targetBuckets; b += 1) {
    const s0 = Math.floor(startIdx + (b * span) / targetBuckets);
    const s1 = Math.max(s0 + 1, Math.ceil(startIdx + ((b + 1) * span) / targetBuckets));
    let minVal = 0;
    let maxVal = 0;
    let sumSq = 0;
    let count = 0;
    for (let i = s0; i < s1 && i < total; i += 1) {
      const item = data.buckets[i];
      if (!item) continue;
      if (item.min < minVal) minVal = item.min;
      if (item.max > maxVal) maxVal = item.max;
      sumSq += item.rms * item.rms;
      count += 1;
    }
    out[b] = {
      min: minVal,
      max: maxVal,
      rms: count > 0 ? Math.sqrt(sumSq / count) : 0,
    };
  }
  return out;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  data,
  loading = false,
  error = null,
  widthPx,
  heightPx = 32,
  role,
  sourceStartSec = 0,
  timelineDurationSec,
  speed = 1,
  gainDb = 0,
  muted = false,
  fadeInSec = 0,
  fadeOutSec = 0,
  label,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const safeWidth = Math.max(24, Math.floor(widthPx));
  const safeHeight = Math.max(18, Math.floor(heightPx));
  const targetBuckets = Math.max(12, Math.min(2400, Math.floor(safeWidth / 2)));

  const resampled = useMemo(() => {
    if (!data || !data.hasAudio) return [];
    return resampleWaveformForClip(data, {
      sourceStartSec,
      timelineDurationSec,
      speed,
      targetBuckets,
    });
  }, [data, sourceStartSec, timelineDurationSec, speed, targetBuckets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !data.hasAudio || resampled.length === 0) return;

    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.floor(safeWidth * dpr);
    canvas.height = Math.floor(safeHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, safeWidth, safeHeight);

    const palette = ROLE_PALETTES[role];
    const midY = safeHeight / 2;
    const maxAmpPx = Math.max(4, midY - 2);
    const linearGain = muted ? 0.15 : Math.min(2.0, Math.max(0.05, Math.pow(10, gainDb / 20)));

    // Center 0 dB reference line
    ctx.strokeStyle = palette.zeroLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(safeWidth, midY);
    ctx.stroke();

    const stepX = safeWidth / resampled.length;
    const barW = Math.max(1, stepX - 0.35);

    // Draw bipolar peak envelope
    ctx.fillStyle = muted ? palette.mutedPeak : palette.peak;
    for (let i = 0; i < resampled.length; i += 1) {
      const bucket = resampled[i];
      if (!bucket) continue;
      const tSec = (i / resampled.length) * timelineDurationSec;
      let fadeGain = 1;
      if (fadeInSec > 0 && tSec < fadeInSec) {
        fadeGain *= Math.max(0, tSec / fadeInSec);
      }
      if (fadeOutSec > 0 && tSec > timelineDurationSec - fadeOutSec) {
        fadeGain *= Math.max(0, (timelineDurationSec - tSec) / fadeOutSec);
      }

      const posPx = Math.min(maxAmpPx, Math.abs(bucket.max) * linearGain * fadeGain * maxAmpPx);
      const negPx = Math.min(maxAmpPx, Math.abs(bucket.min) * linearGain * fadeGain * maxAmpPx);
      const totalH = posPx + negPx;
      if (totalH >= 0.4) {
        ctx.fillRect(i * stepX, midY - posPx, barW, Math.max(0.8, totalH));
      }
    }

    // Draw inner RMS core (Premiere/Resolve style)
    if (!muted) {
      ctx.fillStyle = palette.rms;
      for (let i = 0; i < resampled.length; i += 1) {
        const bucket = resampled[i];
        if (!bucket) continue;
        const tSec = (i / resampled.length) * timelineDurationSec;
        let fadeGain = 1;
        if (fadeInSec > 0 && tSec < fadeInSec) {
          fadeGain *= Math.max(0, tSec / fadeInSec);
        }
        if (fadeOutSec > 0 && tSec > timelineDurationSec - fadeOutSec) {
          fadeGain *= Math.max(0, (timelineDurationSec - tSec) / fadeOutSec);
        }
        const rmsPx = Math.min(maxAmpPx, bucket.rms * linearGain * fadeGain * maxAmpPx);
        if (rmsPx >= 0.4) {
          ctx.fillRect(i * stepX, midY - rmsPx, barW, Math.max(0.8, rmsPx * 2));
        }
      }
    }
  }, [data, resampled, safeWidth, safeHeight, role, gainDb, muted, fadeInSec, fadeOutSec, timelineDurationSec]);

  if (loading) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded bg-black/20 px-1.5 text-[9px] text-slate-400 animate-pulse"
        style={{ width: safeWidth, height: safeHeight }}
      >
        Analisando áudio...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded border border-rose-500/30 bg-rose-950/20 px-1.5 text-[9px] text-rose-300"
        style={{ width: safeWidth, height: safeHeight }}
        title={error}
      >
        Erro ao decodificar áudio
      </div>
    );
  }

  if (!data || !data.hasAudio) {
    return (
      <div
        className="relative flex h-full w-full items-center justify-center px-1.5 text-[9px] text-slate-500"
        style={{ width: safeWidth, height: safeHeight }}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-slate-700/60" />
        <span className="relative z-10 bg-[#090910] px-1">
          {label ? `${label} · Sem áudio` : 'Sem faixa de áudio'}
        </span>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: safeWidth, height: safeHeight }}
      className="block"
      aria-label={label ? `Waveform ${label}` : 'Waveform de áudio'}
    />
  );
};
