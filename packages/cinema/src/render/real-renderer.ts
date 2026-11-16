import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CinemaProductionPackage } from '../index.js';
import { synthesizeElevenLabsWav } from './elevenlabs-tts.js';
import {
  verifyEditorialConsistency,
  type EditorialConsistencyReport,
} from '../editorial/editorial-integrity.js';
import {
  detectMediaAnomalies,
  extractWaveformPeaks,
  probeRealMp4,
  runRealMediaQc,
  type MediaAnomalyReport,
  type RealMp4ProbeResult,
} from '../qc/real-media-probe.js';
import type { QcFindingRecord } from '../ir/timeline-ir.js';
import {
  assertSoundDirectorApproval,
  auditAudioTimeline,
  measureAudioDurationMs,
  type AudioTimelineEvent,
  type SoundDirectorAuditReport,
} from '../audio/sound-director.js';
import {
  directNarrationSegments,
  evaluateNarrationAudioQuality,
  type AudioQualityGateReport,
  type PronunciationDictionaryEntry,
  type SynthesizedSegmentProbe,
} from '../audio/voice-director.js';
import type { AetheraEvolutionCore, ProductionDirectives } from '../evolution/evolution-core.js';
import { resolveDeliveryProfile, type ResolvedDeliveryProfile } from '../director/aethera-format-catalog.js';

const execFileAsync = promisify(execFile);

export interface RealRenderInput {
  pkg: CinemaProductionPackage;
  outputDir: string;
  fileName?: string;
  useNvenc?: boolean;
  injectRealBlackFrameDefect?: boolean;
  requireRealMedia?: boolean;
  voiceStudioUrl?: string;
  voiceStudioModelId?: string;
  voiceStudioVoiceId?: string;
  ttsProviderId?: string;
  ttsVoiceId?: string;
  /** ElevenLabs credentials resolved by the host from its secret store; never persisted in the job. */
  ttsApiKey?: string;
  ttsModelId?: string;
  evolution?: AetheraEvolutionCore;
  genre?: string;
  prompt?: string;
  technicalSampleMaxClips?: number;
  previewQuality?: 'fast_preview' | 'standard';
  renderTarget?: 'preview' | 'master';
  deliveryPresetId?: string;
  previewProfile?: import('../director/aethera-format-catalog.js').DeliveryQualityProfile;
  segmentCacheDir?: string;
  pronunciationDictionary?: PronunciationDictionaryEntry[];
  voiceExpressiveness?: number;
  voiceBaseWpm?: number;
  channelId?: string;
  language?: string;
}

export interface RealRenderResult {
  mp4Path: string;
  isTechnicalSample: boolean;
  sampleLabel?: string;
  appliedDirectives?: ProductionDirectives;
  renderedHeadlines?: string[];
  narrationMode: 'voicestudio_tts' | 'elevenlabs_tts' | 'windows_sapi_tts' | 'procedural_voice_fallback';
  encoderUsed: string;
  appliedEffects: string[];
  probe: RealMp4ProbeResult;
  realQcFindings: QcFindingRecord[];
  waveformPeaks: number[];
  stemPaths?: {
    voiceover: string;
    music: string;
    sfx: string;
    ambience: string;
    master: string;
  };
  anomalies?: MediaAnomalyReport;
  incrementalRenderStats?: {
    totalScenes: number;
    cacheHits: number;
    reRenderedScenes: number;
    cacheDir: string;
  };
  audioTimeline: AudioTimelineEvent[];
  audioAudit: SoundDirectorAuditReport;
  narrationTextSent?: string;
  editorialConsistency?: EditorialConsistencyReport;
  audioQuality?: AudioQualityGateReport;
  deliveryValidation?: {
    valid: boolean;
    target: 'preview' | 'master';
    expected: { width: number; height: number; fps: number; durationSec: number; audioCodec: string; videoCodec: string };
    actual: { width: number; height: number; fps: number; durationSec: number; audioCodec: string | null; videoCodec: string; audioSampleRate: number | null };
    errors: string[];
  };
}

async function synthesizeViaVoiceStudio(
  text: string,
  outWavPath: string,
  options?: { baseUrl?: string; modelId?: string; voiceId?: string },
): Promise<boolean> {
  const baseUrl = (options?.baseUrl ?? 'http://localhost:3900').replace(/\/+$/, '');
  try {
    const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!healthRes.ok) return false;

    let voiceId = options?.voiceId;
    if (!voiceId) {
      const preferredId = '9190edfa'; // Perfil: Narrador YouTube PT-BR
      const voicesRes = await fetch(`${baseUrl}/v1/audio/voices`, { signal: AbortSignal.timeout(3_000) });
      if (voicesRes.ok) {
        const data = (await voicesRes.json()) as {
          voices?: Array<{ voice_id?: string; id?: string; name?: string; type?: string }>;
        };
        const voices = data.voices ?? [];
        const preferred = voices.find(
          (v) =>
            v.voice_id === preferredId ||
            v.id === preferredId ||
            /narrador\s+youtube\s+pt-br/i.test(v.name ?? ''),
        );
        const ptProfile = voices.find(
          (v) => v.type === 'profile' && /pt|brazil|brasil|phelipe/i.test(v.name ?? ''),
        );
        const anyProfile = voices.find((v) => v.type === 'profile');
        voiceId =
          preferred?.voice_id ??
          preferred?.id ??
          ptProfile?.voice_id ??
          ptProfile?.id ??
          anyProfile?.voice_id ??
          anyProfile?.id ??
          preferredId;
      } else {
        voiceId = preferredId;
      }
    }

    const speechRes = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: text,
        model: options?.modelId ?? 'omnivoice',
        voice: voiceId,
        response_format: 'wav',
        language: 'pt',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!speechRes.ok) return false;
    const buf = Buffer.from(await speechRes.arrayBuffer());
    if (buf.byteLength < 1024) return false;
    writeFileSync(outWavPath, buf);
    return existsSync(outWavPath);
  } catch {
    return false;
  }
}

async function synthesizeNarrationWav(
  text: string,
  outWavPath: string,
  options?: {
    voiceStudioUrl?: string;
    voiceStudioModelId?: string;
    voiceStudioVoiceId?: string;
    ttsProviderId?: string;
    ttsVoiceId?: string;
    ttsApiKey?: string;
    ttsModelId?: string;
    language?: string;
  },
): Promise<'voicestudio_tts' | 'elevenlabs_tts' | 'windows_sapi_tts' | 'procedural_voice_fallback'> {
  // When ElevenLabs is explicitly selected and configured, use it instead of VoiceStudio
  if (options?.ttsProviderId === 'elevenlabs' && options.ttsVoiceId) {
    const apiKey = options.ttsApiKey || process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
      try {
        await synthesizeElevenLabsWav({
          apiKey,
          voiceId: options.ttsVoiceId,
          text,
          outWavPath,
          ...(options.ttsModelId ? { modelId: options.ttsModelId } : {}),
          ...(options.language ? { languageCode: options.language.slice(0, 2).toLowerCase() } : {}),
        });
        return 'elevenlabs_tts';
      } catch (err) {
        // Fall through to VoiceStudio/SAPI; the result's narrationMode reports the fallback.
        console.warn(`[aethera] ElevenLabs indisponível, usando fallback: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.warn('[aethera] ElevenLabs selecionado sem API Key configurada; usando fallback.');
    }
  }

  if (
    await synthesizeViaVoiceStudio(text, outWavPath, {
      ...(options?.voiceStudioUrl ? { baseUrl: options.voiceStudioUrl } : {}),
      ...(options?.voiceStudioModelId ? { modelId: options.voiceStudioModelId } : {}),
      ...(options?.voiceStudioVoiceId ? { voiceId: options.voiceStudioVoiceId } : {}),
    })
  ) {
    return 'voicestudio_tts';
  }

  if (process.platform === 'win32') {
    const psScriptPath = `${outWavPath}.ps1`;
    const safeText = text.replace(/'/g, "''");
    const psBody = [
      '$v = New-Object -ComObject SAPI.SpVoice',
      '$voices = $v.GetVoices()',
      'foreach ($voice in $voices) { if ($voice.GetDescription() -match "Maria|Portuguese") { $v.Voice = $voice; break } }',
      '$v.Rate = 1',
      '$stream = New-Object -ComObject SAPI.SpFileStream',
      `$stream.Open('${outWavPath.replace(/'/g, "''")}', 3, $false)`,
      '$v.AudioOutputStream = $stream',
      `$v.Speak('${safeText}') | Out-Null`,
      '$stream.Close()',
    ].join('\n');
    writeFileSync(psScriptPath, psBody, 'utf8');
    try {
      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], {
        timeout: 25_000,
      });
      if (existsSync(outWavPath)) {
        return 'windows_sapi_tts';
      }
    } catch {
      // Fallback below when Windows SAPI voices are blocked (e.g., inside restricted sandbox)
    }
  }

  // Fallback: deterministic speech-cadence formant cue (marked explicitly as fallback, never claimed as human voice)
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=195:sample_rate=48000:duration=3.2,volume=0.28,afade=t=in:st=0:d=0.1,afade=t=out:st=2.8:d=0.4',
    outWavPath,
  ]);
  return 'procedural_voice_fallback';
}

function escapeDrawtext(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .replace(/:/g, ' -')
    .replace(/'/g, '')
    .slice(0, 56);
}

function resolveFontOption(): string {
  const candidates = [
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/consola.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) return '';
  return `:fontfile='${found.replace(':', '\\:')}'`;
}

export async function renderRealCinemaMp4(input: RealRenderInput): Promise<RealRenderResult> {
  mkdirSync(input.outputDir, { recursive: true });
  const mp4Path = join(input.outputDir, input.fileName ?? `${input.pkg.timeline.projectId}.mp4`);
  const workDir = join(input.outputDir, '_work');
  mkdirSync(workDir, { recursive: true });
  const fallbackPresetId = input.pkg.timeline.resolution.height > input.pkg.timeline.resolution.width ? 'shorts' : 'youtube-1080p';
  const deliveryProfile: ResolvedDeliveryProfile = input.deliveryPresetId
    ? resolveDeliveryProfile({ presetId: input.deliveryPresetId, ...(input.previewProfile ? { previewProfile: input.previewProfile } : {}) })
    : input.pkg.deliveryProfile ?? resolveDeliveryProfile({ presetId: fallbackPresetId, previewProfile: input.previewProfile ?? 'review_720p' });
  // Master output must be requested explicitly (renderTarget or a delivery preset). Callers that
  // pass neither keep the historical review render instead of silently scaling up to the master size.
  const renderTarget = input.renderTarget ?? (input.deliveryPresetId ? 'master' : 'preview');
  const target = renderTarget === 'preview' ? deliveryProfile.preview : deliveryProfile.master;
  const targetWidth = target.width;
  const targetHeight = target.height;
  const targetFps = target.fps;
  const safeArea = deliveryProfile.preset.safeArea;
  const safeLeft = Math.round((targetWidth * safeArea.left) / 100);
  const safeRight = Math.round((targetWidth * safeArea.right) / 100);
  const safeBottom = Math.round((targetHeight * safeArea.bottom) / 100);
  const baseScale = Math.max(0.5, targetWidth / 1280);
  // Procedural placeholders run a per-pixel geq; generate them at ≤640px on the long edge
  // (same aspect as the target) and let the base filter scale up, as the 640x360 source did before.
  const proceduralFactor = Math.min(1, 640 / Math.max(targetWidth, targetHeight));
  const proceduralWidth = Math.max(2, Math.round((targetWidth * proceduralFactor) / 2) * 2);
  const proceduralHeight = Math.max(2, Math.round((targetHeight * proceduralFactor) / 2) * 2);

  const primaryVideoClips = input.pkg.timeline.clips.filter(
    (c) => c.trackId === 'v1' || (!c.trackId.startsWith('a') && c.trackId !== 'sub1' && c.trackId !== 'v2' && c.trackId !== 'vfx1'),
  );
  const subtitleClips = input.pkg.timeline.clips.filter(
    (c) => c.trackId === 'sub1' || c.effects.some((e) => e.kind === 'subtitle_style' && e.enabled),
  );
  const sortedClips = [...primaryVideoClips]
    .sort((a, b) => a.timelineRange.start.value / a.timelineRange.start.rate - b.timelineRange.start.value / b.timelineRange.start.rate);
  const isTechnicalSample =
    typeof input.technicalSampleMaxClips === 'number' &&
    input.technicalSampleMaxClips > 0 &&
    input.technicalSampleMaxClips < sortedClips.length;
  const orderedClips = isTechnicalSample
    ? sortedClips.slice(0, input.technicalSampleMaxClips)
    : sortedClips;
  const sampleLabel = isTechnicalSample
    ? `AMOSTRA TÉCNICA (${orderedClips.length} de ${sortedClips.length} cenas — não é o vídeo completo)`
    : undefined;
  const shots = input.pkg.direction.shots;
  const sceneCount = Math.max(orderedClips.length, 1);
  const clipSpecs = Array.from({ length: sceneCount }, (_, i) => {
    const clip = orderedClips[i];
    const rawDur = clip
      ? (clip.timelineRange.duration.value / clip.timelineRange.duration.rate) / Math.max(0.25, clip.speed || 1)
      : 6.0;
    const effectiveDur = Number(Math.max(1.2, Math.min(600, rawDur)).toFixed(2));
    const sourceUri = clip ? input.pkg.timeline.sourceMedia[clip.mediaId]?.uri : undefined;
    const resolvedUri = sourceUri && existsSync(sourceUri) ? sourceUri : null;
    const allowProcedural = clip?.effects?.some((e) => e.kind === 'allow_procedural' && e.enabled) ?? false;
    if (input.requireRealMedia && !resolvedUri && !allowProcedural) {
      throw new Error(
        `missing_real_media: Clipe "${clip?.label ?? `cena_${i + 1}`}" (${clip?.clipId ?? i + 1}) não possui mídia real adquirida (${sourceUri ?? 'sem URI'}). Resolva ou importe a mídia antes da renderização.`,
      );
    }
    return {
      clip,
      shot: shots[i % Math.max(1, shots.length)],
      effectiveDur,
      sourceUri: resolvedUri,
    };
  });
  const minClipDur = Math.min(...clipSpecs.map((s) => s.effectiveDur));
  const xfadeDur = Number(Math.min(0.4, minClipDur * 0.28).toFixed(2));
  const totalDur = Number(
    (
      clipSpecs.reduce((acc, s) => acc + s.effectiveDur, 0) -
      Math.max(0, clipSpecs.length - 1) * xfadeDur
    ).toFixed(2),
  );

  const palettes = [
    ['0x0f0a1f', '0x8b5cf6'],
    ['0x160d24', '0xf59e0b'],
    ['0x0b1322', '0x38bdf8'],
    ['0x1b0e1c', '0xec4899'],
    ['0x13111c', '0xa855f7'],
    ['0x090b12', '0x10b981'],
  ];

  // 1. Render scene clips with real motion graphics, color grading, vignette/VFX and learned directives
  let cacheHits = 0;
  let reRenderedScenes = 0;
  const directives = input.evolution
    ? input.evolution.resolveProductionDirectives({
        prompt: input.prompt ?? input.pkg.timeline.projectId,
        projectId: input.pkg.timeline.projectId,
        ...(input.genre ? { genre: input.genre } : {}),
      })
    : undefined;

  if (input.evolution && directives && (directives.appliedMemoryIds.length > 0 || directives.overriddenDirectives.length > 0)) {
    input.evolution.recordDecision({
      projectId: input.pkg.timeline.projectId,
      directorId: 'vfx_director',
      action: 'apply_learned_production_directives',
      rationale: `Diretivas aplicadas: suppressActCards=${directives.suppressActCards}, suppressAetheraSignature=${directives.suppressAetheraSignature}, discreteTypography=${directives.discreteTypography}, elaborateMotion=${directives.elaborateMotionGraphics}, overrides=[${directives.overriddenDirectives.join(',')}]`,
      consultedMemoryIds: directives.appliedMemoryIds,
      consultedAcademyIds: [],
      outcome: 'applied',
    });
  }

  const sceneFiles: string[] = [];
  const renderedHeadlines: string[] = [];
  const humorActive = input.pkg.timeline.humorProfile.humorIntensity > 0 && input.pkg.timeline.comedyBeats.length > 0;
  const defaultBeatTitles = [
    'Abertura',
    'Contexto & Promessa',
    humorActive ? 'Contraponto Editorial' : 'Desenvolvimento',
    'Ponto de Inflexão',
    'Clímax',
    'Conclusão',
  ];
  const editorialTitles = [
    'Abertura - Contexto Visual',
    'Desenvolvimento & Descoberta',
    humorActive ? 'Contraponto Editorial' : 'Aprofundamento Tematico',
    'Ponto de Inflexao',
    'Climax Visual',
    'Encerramento',
  ];

  for (let i = 0; i < clipSpecs.length; i += 1) {
    const spec = clipSpecs[i];
    if (!spec) continue;
    const outScene = join(workDir, `scene_${i + 1}.mp4`);
    const shot = spec.shot;
    const [bgHex, accentHex] = palettes[i % palettes.length] ?? ['0x0f0a1f', '0x8b5cf6'];
    let rawTitle = spec.clip?.label || (directives?.suppressActCards ? editorialTitles[i % editorialTitles.length] : defaultBeatTitles[i % defaultBeatTitles.length]) || `Cena ${i + 1}`;
    if (directives?.suppressActCards) {
      rawTitle = rawTitle.replace(/\bATO\s+[IVX]+\s*[-–—:]?\s*/gi, '').trim() || editorialTitles[i % editorialTitles.length] || `Cena ${i + 1}`;
    }
    if (directives?.suppressAetheraSignature) {
      rawTitle = rawTitle.replace(/\s*[&|•-]?\s*Aethera\s*Studio/gi, '').trim() || 'Encerramento';
    }
    renderedHeadlines.push(rawTitle);
    const headline = escapeDrawtext(rawTitle);
    const subline = escapeDrawtext(
      `${shot?.shotId ?? `shot_${i + 1}`} | ${shot?.framing ?? 'wide'} | ${spec.clip?.speed ?? 1}x | ${spec.effectiveDur}s`,
    );

    const blackOverlay =
      input.injectRealBlackFrameDefect && i === Math.min(2, clipSpecs.length - 1)
        ? ',drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable=\'between(t,0.8,1.3)\''
        : '';

    const isImageSource = spec.sourceUri ? /\.(png|jpe?g|webp)$/i.test(spec.sourceUri) : false;
    const baseFilter = spec.sourceUri
      ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=${targetFps},setpts=(PTS-STARTPTS)/${Math.max(0.25, spec.clip?.speed ?? 1)},trim=duration=${spec.effectiveDur},setpts=PTS-STARTPTS`
      : `geq=r='clip(44+38*sin(X/45+T*1.4)+24*cos(Y/35-T),24,235)':g='clip(34+28*cos(X/55-T)+30*sin((X+Y)/60+T),20,235)':b='clip(68+58*sin((X-Y)/42+T*1.8),32,235)',scale=${targetWidth}:${targetHeight}:flags=bilinear`;

    const isDiscrete = Boolean(directives?.discreteTypography);
    const hasRealFootage = Boolean(spec.sourceUri);
    const isGenericShotLabel = /^shot_\d+$/i.test(rawTitle) || /^Cena\s+\d+$/i.test(rawTitle);
    const hideTitle =
      (spec.clip?.effects?.some((e) => e.kind === 'hide_title' && e.enabled) ?? false) ||
      (hasRealFootage && isGenericShotLabel);
    const headlineSize = Math.round((isDiscrete ? 22 : directives?.elaborateMotionGraphics ? 36 : 34) * baseScale);
    const sublineSize = Math.round((isDiscrete ? 15 : 20) * baseScale);
    const lowerBoxHeight = Math.round((hasRealFootage ? 72 : isDiscrete ? 82 : 130) * baseScale);
    const lowerBoxY = Math.max(0, targetHeight - safeBottom - lowerBoxHeight);
    const lowerBoxWidth = Math.max(1, targetWidth - safeLeft - safeRight);
    const motionBar = isDiscrete || hideTitle || hasRealFootage
      ? ''
      : `drawbox=x='mod(t*220,w-240)':y=140:w=220:h=8:color=${accentHex}@0.92:t=fill`;
    const lowerBox = hideTitle
      ? ''
      : hasRealFootage
      ? `drawbox=x=${safeLeft}:y=${lowerBoxY}:w=${lowerBoxWidth}:h=${lowerBoxHeight}:color=${bgHex}@0.58:t=fill`
        : isDiscrete
        ? `drawbox=x=${safeLeft}:y=${lowerBoxY}:w=${lowerBoxWidth}:h=${lowerBoxHeight}:color=${bgHex}@0.64:t=fill`
        : `drawbox=x=${safeLeft}:y=${lowerBoxY}:w=${lowerBoxWidth}:h=${lowerBoxHeight}:color=${bgHex}@0.82:t=fill`;
    const headlineY = Math.round(lowerBoxY + (hasRealFootage ? 16 : isDiscrete ? 14 : 21) * baseScale);
    const sublineY = Math.round(headlineY + (isDiscrete ? 34 : 52) * baseScale);
    const colorFilterChain =
      input.pkg.colorPlan?.ffmpegColorFilterChain?.trim() ||
      'colorspace=all=bt709:iall=bt709:fast=1,eq=contrast=1.06:saturation=1.12,limiter=min=16:max=235';

    // Apply clip keyframes (scale, rotation, opacity) if set
    const getKf = (prop: string, fallback: number): number => {
      const k = spec.clip?.keyframes?.find((kf) => kf.property === prop);
      return k && typeof k.value === 'number' && Number.isFinite(k.value) ? k.value : fallback;
    };
    const kfScale = Math.max(0.25, Math.min(3.0, getKf('scale', 1)));
    const kfRotDeg = getKf('rotation', 0);
    const kfOpacity = Math.max(0, Math.min(1, getKf('opacity', 1)));
    const transformFilters: string[] = [];
    if (Math.abs(kfScale - 1) > 0.02) {
      const sw = Math.max(64, Math.round(targetWidth * kfScale));
      const sh = Math.max(36, Math.round(targetHeight * kfScale));
      transformFilters.push(
        kfScale > 1
          ? `scale=${sw}:${sh},crop=${targetWidth}:${targetHeight}`
          : `scale=${sw}:${sh},pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`,
      );
    }
    if (Math.abs(kfRotDeg) > 0.5) {
      const rad = Number(((kfRotDeg * Math.PI) / 180).toFixed(4));
      transformFilters.push(`rotate=${rad}:ow=${targetWidth}:oh=${targetHeight}:fillcolor=black`);
    }
    if (kfOpacity < 0.99) {
      transformFilters.push(`eq=brightness=${Number(((kfOpacity - 1) * 0.45).toFixed(3))}`);
    }

    // Real source or procedural texture + keyframes + motion graphics + safe-zone typography + project color grading + vignette VFX
    const vf = [
      baseFilter,
      ...transformFilters,
      motionBar,
      lowerBox,
      ...(hideTitle
        ? []
        : hasRealFootage
          ? [`drawtext=text='${headline}'${resolveFontOption()}:expansion=none:x=${safeLeft + Math.round(32 * baseScale)}:y=${headlineY}:fontsize=${headlineSize}:fontcolor=white`]
          : [
              `drawtext=text='${headline}'${resolveFontOption()}:expansion=none:x=${safeLeft + Math.round(32 * baseScale)}:y=${headlineY}:fontsize=${headlineSize}:fontcolor=white`,
              `drawtext=text='${subline}'${resolveFontOption()}:expansion=none:x=${safeLeft + Math.round(32 * baseScale)}:y=${sublineY}:fontsize=${sublineSize}:fontcolor=0xf59e0b`,
            ]),
      `vignette=PI/6`,
      colorFilterChain,
      blackOverlay.replace(/^,/, ''),
    ]
      .filter(Boolean)
      .join(',');

    const segmentCacheDir = input.segmentCacheDir ?? join(workDir, 'segment-cache');
    mkdirSync(segmentCacheDir, { recursive: true });
    if (i === 0) {
      for (const f of readdirSync(segmentCacheDir)) {
        if (f.endsWith('.tmp')) {
          try {
            unlinkSync(join(segmentCacheDir, f));
          } catch {
            // ignore cleanup errors
          }
        }
      }
    }

    let sourceStat: { mtimeMs: number; size: number } | null = null;
    if (spec.sourceUri && existsSync(spec.sourceUri)) {
      try {
        const st = statSync(spec.sourceUri);
        sourceStat = { mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        sourceStat = null;
      }
    }
    const matchingBeat = input.pkg.direction?.narrativeBeats?.[i];
    const sceneKey = createHash('sha1')
      .update(
        JSON.stringify({
          sourceUri: spec.sourceUri ?? null,
          sourceStat,
          dur: spec.effectiveDur,
          speed: spec.clip?.speed ?? 1,
          trimIn: spec.clip?.sourceRange?.start?.value ?? 0,
          trimOut: spec.clip?.sourceRange?.duration?.value ?? null,
          vf,
          fontOption: resolveFontOption(),
          effects: (spec.clip?.effects ?? []).map((e) => ({ kind: e.kind, enabled: e.enabled, params: e.params })),
          beatSummary: matchingBeat?.summary ?? null,
          beatStage: matchingBeat?.stage ?? null,
          previewQuality: input.previewQuality ?? 'full',
          useNvenc: Boolean(input.useNvenc),
          isImageSource,
          fps: targetFps,
          targetWidth,
          targetHeight,
          renderTarget,
        }),
      )
      .digest('hex');
    const cachedScenePath = join(segmentCacheDir, `seg_${sceneKey}.mp4`);

    let validCacheHit = false;
    if (existsSync(cachedScenePath)) {
      try {
        validCacheHit = statSync(cachedScenePath).size > 1024;
      } catch {
        validCacheHit = false;
      }
    }

    if (validCacheHit) {
      copyFileSync(cachedScenePath, outScene);
      cacheHits += 1;
      sceneFiles.push(outScene);
      continue;
    }

    const trimStartSec = spec.clip?.sourceRange?.start
      ? Math.max(0, spec.clip.sourceRange.start.value / Math.max(1, spec.clip.sourceRange.start.rate))
      : 0;
    const inputArgs = spec.sourceUri
      ? isImageSource
        ? ['-loop', '1', '-t', String(spec.effectiveDur), '-i', spec.sourceUri]
        : [
            ...(trimStartSec > 0 ? ['-ss', String(trimStartSec)] : []),
            '-stream_loop',
            '-1',
            '-t',
            String(spec.effectiveDur * Math.max(0.25, spec.clip?.speed ?? 1) + 0.5),
            '-i',
            spec.sourceUri,
          ]
      : ['-f', 'lavfi', '-i', `color=c=${bgHex}:s=${proceduralWidth}x${proceduralHeight}:r=${targetFps}:d=${spec.effectiveDur}`];

    await execFileAsync('ffmpeg', [
      '-y',
      ...inputArgs,
      '-vf',
      vf,
      '-t',
      String(spec.effectiveDur),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      outScene,
    ]);
    const tmpCachePath = `${cachedScenePath}.tmp`;
    copyFileSync(outScene, tmpCachePath);
    renameSync(tmpCachePath, cachedScenePath);
    reRenderedScenes += 1;
    sceneFiles.push(outScene);
  }

  // 2. Concatenate scenes with real xfade transitions (fade / wipeleft / slideright / smoothleft / dissolve)
  const rawVideoPath = join(workDir, 'video_xfade.mp4');
  if (sceneFiles.length === 1 && sceneFiles[0]) {
    await execFileAsync('ffmpeg', ['-y', '-i', sceneFiles[0], '-c', 'copy', rawVideoPath]);
  } else {
    const transitionKinds = ['fade', 'wipeleft', 'smoothleft', 'slideright', 'dissolve'];
    const inputsArgs: string[] = [];
    for (const f of sceneFiles) {
      inputsArgs.push('-i', f);
    }

    const xfadeFilters: string[] = [];
    let prevLabel = '[0:v]';
    let runningDur = clipSpecs[0]?.effectiveDur ?? 6.0;
    for (let i = 1; i < sceneFiles.length; i += 1) {
      const trEffect = clipSpecs[i]?.clip?.effects?.find((e) => e.kind === 'transition' && e.enabled);
      const customKind = typeof trEffect?.params?.['transitionKind'] === 'string' ? trEffect.params['transitionKind'] : undefined;
      const customDurRaw = trEffect?.params?.['durationSec'];
      const segXfadeDur = customDurRaw !== undefined && Number.isFinite(Number(customDurRaw))
        ? Number(Math.min(1.2, Math.max(0.15, Number(customDurRaw))).toFixed(2))
        : xfadeDur;
      const offset = Number(Math.max(0.1, runningDur - segXfadeDur).toFixed(2));
      const nextLabel = i === sceneFiles.length - 1 ? '[vout]' : `[v${i}]`;
      const tr = customKind || transitionKinds[(i - 1) % transitionKinds.length] || 'fade';
      xfadeFilters.push(
        `${prevLabel}[${i}:v]xfade=transition=${tr}:duration=${segXfadeDur}:offset=${offset}${nextLabel}`,
      );
      prevLabel = nextLabel;
      runningDur = offset + (clipSpecs[i]?.effectiveDur ?? 6.0);
    }

    await execFileAsync('ffmpeg', [
      '-y',
      ...inputsArgs,
      '-filter_complex',
      xfadeFilters.join(';'),
      '-map',
      '[vout]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      rawVideoPath,
    ]);
  }

  // 2b. Burn timed subtitle track clips if present
  if (subtitleClips.length > 0) {
    const subVideoPath = join(workDir, 'video_subtitled.mp4');
    const subFilters = subtitleClips.map((sc) => {
      const startSec = Number((sc.timelineRange.start.value / sc.timelineRange.start.rate).toFixed(2));
      const endSec = Number(
        (startSec + sc.timelineRange.duration.value / sc.timelineRange.duration.rate).toFixed(2),
      );
      const textParam = sc.effects.find((e) => e.kind === 'subtitle_style')?.params['text'];
      const txt = escapeDrawtext(typeof textParam === 'string' ? textParam : sc.label);
      const subtitleSize = Math.max(18, Math.round(28 * baseScale));
      const subtitleY = Math.max(0, targetHeight - safeBottom - Math.round(48 * baseScale));
      return `drawtext=text='${txt}'${resolveFontOption()}:expansion=none:x=(w-text_w)/2:y=${subtitleY}:fontsize=${subtitleSize}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=${Math.max(6, Math.round(10 * baseScale))}:enable='between(t,${startSec},${endSec})'`;
    });
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      rawVideoPath,
      '-vf',
      subFilters.join(','),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      subVideoPath,
    ]);
    await execFileAsync('ffmpeg', ['-y', '-i', subVideoPath, '-c', 'copy', rawVideoPath]);
  }

  // 3. Real Narration via AI Voice Director (segmented, punctuated, Pronunciation Dictionary, incremental cache)
  const narrationWav = join(workDir, 'narration.wav');
  const canonicalFullText = input.pkg.editorialScript?.fullSpokenText?.trim();
  const legacyBeatsText = (input.pkg.direction.narrativeBeats ?? [])
    .map((b) => b.summary.trim())
    .filter(Boolean)
    .join(' ');
  const rawFullText = canonicalFullText || legacyBeatsText || input.pkg.direction.brief.prompt;
  const rawSegments =
    input.pkg.editorialScript?.segments && input.pkg.editorialScript.segments.length > 0
      ? input.pkg.editorialScript.segments.map((s) => ({ segmentId: s.segmentId, text: s.spokenText }))
      : (rawFullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [rawFullText]).reduce<Array<{ segmentId: string; text: string }>>(
          (acc, sentence) => {
            const trimmed = sentence.trim();
            if (!trimmed) return acc;
            const prev = acc.at(-1);
            if (prev && prev.text.length + trimmed.length < 320) {
              prev.text = `${prev.text} ${trimmed}`;
            } else {
              acc.push({ segmentId: `seg_${acc.length + 1}`, text: trimmed });
            }
            return acc;
          },
          [],
        );

  // ElevenLabs voices get their own cache namespace so switching provider never reuses VoiceStudio audio.
  const useElevenLabs = input.ttsProviderId === 'elevenlabs' && Boolean(input.ttsVoiceId);
  const voicePlan = directNarrationSegments({
    segments: rawSegments,
    voiceId: useElevenLabs
      ? `elevenlabs:${input.ttsVoiceId}:${input.ttsModelId || 'default'}`
      : input.voiceStudioVoiceId || '9190edfa',
    ...(input.voiceExpressiveness !== undefined ? { expressiveness: input.voiceExpressiveness } : {}),
    ...(input.voiceBaseWpm !== undefined ? { baseWpm: input.voiceBaseWpm } : {}),
    ...(input.pronunciationDictionary ? { dictionary: input.pronunciationDictionary } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.language ? { language: input.language } : {}),
  });

  const narrationTextToSpeak = voicePlan.segments.map((s) => s.editorialText).join(' ');
  const editorialConsistency = verifyEditorialConsistency({
    ...(input.pkg.editorialScript ? { editorialScript: input.pkg.editorialScript } : {}),
    ttsTextSent: narrationTextToSpeak,
    timelineClipCount: clipSpecs.length,
  });

  const voiceCacheDir = input.segmentCacheDir ? join(input.segmentCacheDir, 'voice-segments') : join(workDir, 'voice-segments');
  mkdirSync(voiceCacheDir, { recursive: true });
  const segmentWavPaths: string[] = [];
  const segmentProbes: SynthesizedSegmentProbe[] = [];
  let narrationMode: 'voicestudio_tts' | 'elevenlabs_tts' | 'windows_sapi_tts' | 'procedural_voice_fallback' = 'voicestudio_tts';

  for (const seg of voicePlan.segments) {
    const cachedSegPath = join(voiceCacheDir, `voice_${seg.cacheKey}.wav`);
    const segWorkPath = join(workDir, `nar_${seg.segmentId}.wav`);
    if (existsSync(cachedSegPath) && statSync(cachedSegPath).size > 1024) {
      copyFileSync(cachedSegPath, segWorkPath);
    } else {
      const mode = await synthesizeNarrationWav(seg.ttsInputText, segWorkPath, {
        ...(input.voiceStudioUrl ? { voiceStudioUrl: input.voiceStudioUrl } : {}),
        ...(input.voiceStudioModelId ? { voiceStudioModelId: input.voiceStudioModelId } : {}),
        ...(input.voiceStudioVoiceId ? { voiceStudioVoiceId: input.voiceStudioVoiceId } : {}),
        ...(input.ttsProviderId ? { ttsProviderId: input.ttsProviderId } : {}),
        ...(input.ttsVoiceId ? { ttsVoiceId: input.ttsVoiceId } : {}),
        ...(input.ttsApiKey ? { ttsApiKey: input.ttsApiKey } : {}),
        ...(input.ttsModelId ? { ttsModelId: input.ttsModelId } : {}),
        ...(input.language ? { language: input.language } : {}),
      });
      if (mode !== 'voicestudio_tts') narrationMode = mode;
      // Never cache a fallback voice under the ElevenLabs key.
      const cacheable = useElevenLabs ? mode === 'elevenlabs_tts' : true;
      if (cacheable && existsSync(segWorkPath) && statSync(segWorkPath).size > 1024) {
        copyFileSync(segWorkPath, cachedSegPath);
      }
    }
    const segFinalPath = join(workDir, `nar_${seg.segmentId}_paced.wav`);
    const padSec = Math.max(0.12, seg.targetPauseAfterMs / 1000);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', segWorkPath, '-af', `apad=pad_dur=${padSec.toFixed(2)}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', segFinalPath],
      { windowsHide: true, timeout: 30_000 },
    );
    segmentWavPaths.push(segFinalPath);
    const durMs = await measureAudioDurationMs(segFinalPath);
    segmentProbes.push({
      segmentId: seg.segmentId,
      editorialText: seg.editorialText,
      wavPath: segFinalPath,
      durationSec: durMs / 1000,
    });
  }

  const audioQuality = evaluateNarrationAudioQuality(segmentProbes);

  if (segmentWavPaths.length === 1 && segmentWavPaths[0]) {
    copyFileSync(segmentWavPaths[0], narrationWav);
  } else if (segmentWavPaths.length > 1) {
    const concatListPath = join(workDir, 'narration-concat.txt');
    writeFileSync(
      concatListPath,
      segmentWavPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', narrationWav],
      { windowsHide: true, timeout: 60_000 },
    );
  } else {
    narrationMode = await synthesizeNarrationWav(narrationTextToSpeak.slice(0, 3800), narrationWav, {
      ...(input.voiceStudioUrl ? { voiceStudioUrl: input.voiceStudioUrl } : {}),
      ...(input.voiceStudioModelId ? { voiceStudioModelId: input.voiceStudioModelId } : {}),
      ...(input.voiceStudioVoiceId ? { voiceStudioVoiceId: input.voiceStudioVoiceId } : {}),
      ...(input.ttsProviderId ? { ttsProviderId: input.ttsProviderId } : {}),
      ...(input.ttsVoiceId ? { ttsVoiceId: input.ttsVoiceId } : {}),
      ...(input.ttsApiKey ? { ttsApiKey: input.ttsApiKey } : {}),
      ...(input.ttsModelId ? { ttsModelId: input.ttsModelId } : {}),
      ...(input.language ? { language: input.language } : {}),
    });
  }

  const totalDurMs = Math.round(totalDur * 1000);
  const measuredNarMs = await measureAudioDurationMs(narrationWav);
  const audioTimeline: AudioTimelineEvent[] = [
    {
      sourceId: 'nar_master_01',
      sceneId: clipSpecs[0]?.shot?.shotId ?? 'scene_01',
      bus: 'A1_narration',
      role: 'narration',
      startMs: 0,
      endMs: Math.min(measuredNarMs, totalDurMs),
      gainDb: 0,
      priority: 100,
      fadeInMs: 40,
      fadeOutMs: 120,
    },
    {
      sourceId: 'music_bed_01',
      sceneId: 'global',
      bus: 'A3_music',
      role: 'music',
      startMs: 0,
      endMs: totalDurMs,
      gainDb: -16,
      priority: 40,
      fadeInMs: 1200,
      fadeOutMs: 1500,
      duckedUnderSpeech: true,
    },
    {
      sourceId: 'sfx_trans_01',
      sceneId: clipSpecs[1]?.shot?.shotId ?? 'scene_02',
      bus: 'A4_sfx',
      role: 'sfx',
      startMs: 5600,
      endMs: 5850,
      gainDb: -10,
      priority: 70,
    },
    {
      sourceId: 'sfx_comedy_02',
      sceneId: clipSpecs[2]?.shot?.shotId ?? 'scene_03',
      bus: 'A4_sfx',
      role: 'sfx',
      startMs: 11200,
      endMs: 11420,
      gainDb: -9,
      priority: 70,
    },
    {
      sourceId: 'sfx_trans_03',
      sceneId: clipSpecs[3]?.shot?.shotId ?? 'scene_04',
      bus: 'A4_sfx',
      role: 'sfx',
      startMs: 16800,
      endMs: 17050,
      gainDb: -10,
      priority: 70,
    },
  ];
  const audioAudit = auditAudioTimeline(audioTimeline, totalDurMs);
  assertSoundDirectorApproval(audioAudit);

  const audioMixPath = join(workDir, 'audio_master.wav');
  const musicStemPath = join(workDir, 'stem_music.wav');
  const sfxStemPath = join(workDir, 'stem_sfx.wav');
  const ambienceStemPath = join(workDir, 'stem_ambience.wav');
  const stemByRole = new Map(input.pkg.soundPlan.stems.map((s) => [s.stemRole, s]));
  const voiceStem = stemByRole.get('voiceover');
  const musicStem = stemByRole.get('music');
  const sfxStem = stemByRole.get('sfx');
  const ambienceStem = stemByRole.get('ambience');
  const voiceVol = voiceStem?.muted ? '0' : `${voiceStem?.targetGainDb ?? 0}dB`;
  const musicBaseDb = (musicStem?.targetGainDb ?? -16) + 16;
  const musicVol = musicStem?.muted ? '0' : `${musicBaseDb}dB`;
  const sfxBaseDb = (sfxStem?.targetGainDb ?? -8) + 8;
  const sfxVol = sfxStem?.muted ? '0' : `${sfxBaseDb}dB`;
  const ambienceBaseDb = (ambienceStem?.targetGainDb ?? -22) + 22;
  const ambienceVol = ambienceStem?.muted ? '0' : `${ambienceBaseDb}dB`;
  const duckRatio = Math.max(2, Math.min(12, Math.round(Math.abs(musicStem?.duckingUnderVoiceDb ?? -9) * 0.5)));
  const targetLufs = input.pkg.soundPlan.platformProfile?.integratedLufs ?? -14.0;
  const targetTp = input.pkg.soundPlan.platformProfile?.truePeakDbtp ?? -1.0;
  const targetLra = input.pkg.soundPlan.platformProfile?.loudnessRangeLu ?? 8.0;

  const sfxDelay1Ms = Math.min(5600, Math.max(100, Math.round(totalDur * 250)));
  const sfxDelay2Ms = Math.min(11200, Math.max(250, Math.round(totalDur * 500)));
  const sfxDelay3Ms = Math.min(16800, Math.max(400, Math.round(totalDur * 750)));

  // Generate warm chord music bed + ambience room tone + SFX whoosh/impact cues synced to stems & mixer gains
  const audioComplex = [
    `[0:a]apad=whole_dur=${totalDur},volume=${voiceVol},asplit=2[nar_sc][nar_mix]`,
    `sine=frequency=110:sample_rate=48000:duration=${totalDur},volume=0.14[m1]`,
    `sine=frequency=164.81:sample_rate=48000:duration=${totalDur},volume=0.09[m2]`,
    `sine=frequency=220:sample_rate=48000:duration=${totalDur},volume=0.07[m3]`,
    `[m1][m2][m3]amix=inputs=3:normalize=0,afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0.2, totalDur - 1.5)}:d=1.5,volume=${musicVol}[music]`,
    `[music][nar_sc]sidechaincompress=threshold=0.03:ratio=${duckRatio}:attack=25:release=250,asplit=2[ducked_music][ducked_music_stem]`,
    `anoisesrc=color=pink:sample_rate=48000:duration=${totalDur},volume=0.015,volume=${ambienceVol},asplit=2[amb][amb_stem]`,
    // SFX impacts synced to scene transitions
    `sine=frequency=520:sample_rate=48000:duration=0.25,afade=t=out:st=0.05:d=0.2,volume=0.32,volume=${sfxVol},adelay=${sfxDelay1Ms}|${sfxDelay1Ms}[sfx1]`,
    `sine=frequency=780:sample_rate=48000:duration=0.22,afade=t=out:st=0.04:d=0.18,volume=0.35,volume=${sfxVol},adelay=${sfxDelay2Ms}|${sfxDelay2Ms}[sfx2]`,
    `sine=frequency=440:sample_rate=48000:duration=0.25,afade=t=out:st=0.05:d=0.2,volume=0.30,volume=${sfxVol},adelay=${sfxDelay3Ms}|${sfxDelay3Ms}[sfx3]`,
    `[sfx1][sfx2][sfx3]amix=inputs=3:duration=longest:normalize=0,apad=whole_dur=${totalDur},atrim=0:${totalDur},asplit=2[sfx_mix][sfx_stem]`,
    `[nar_mix][ducked_music][amb][sfx_mix]amix=inputs=4:duration=longest:normalize=0,atrim=0:${totalDur},loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}[aout]`,
  ].join(';');

  const rawAudioMixPath = join(workDir, 'audio_master_raw.wav');
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    narrationWav,
    '-filter_complex',
    audioComplex,
    '-map',
    '[aout]',
    '-ar',
    '48000',
    '-ac',
    '2',
    rawAudioMixPath,
    '-map',
    '[ducked_music_stem]',
    '-ar',
    '24000',
    '-ac',
    '1',
    musicStemPath,
    '-map',
    '[sfx_stem]',
    '-ar',
    '24000',
    '-ac',
    '1',
    sfxStemPath,
    '-map',
    '[amb_stem]',
    '-ar',
    '24000',
    '-ac',
    '1',
    ambienceStemPath,
  ]);

  // 2-pass measured EBU R128 loudness normalization to hit exact targetLufs (-14.0 LUFS) and targetTp (-1.0 dBTP)
  let twoPassApplied = false;
  try {
    const measureRes = await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-i',
      rawAudioMixPath,
      '-af',
      `loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}:print_format=json`,
      '-f',
      'null',
      '-',
    ]).catch((err: { stderr?: string }) => ({ stderr: err.stderr ?? '' }));
    const jsonMatch = (measureRes.stderr ?? '').match(/\{[\s\S]*"input_i"[\s\S]*\}/);
    if (jsonMatch) {
      const m = JSON.parse(jsonMatch[0]) as Record<string, string>;
      if (m['input_i'] && m['input_tp'] && m['input_lra'] && m['input_thresh'] && m['target_offset']) {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          rawAudioMixPath,
          '-af',
          `loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}:measured_I=${m['input_i']}:measured_TP=${m['input_tp']}:measured_LRA=${m['input_lra']}:measured_thresh=${m['input_thresh']}:offset=${m['target_offset']}:linear=true`,
          '-ar',
          '48000',
          '-ac',
          '2',
          audioMixPath,
        ]);
        twoPassApplied = true;
      }
    }
  } catch {
    twoPassApplied = false;
  }
  if (!twoPassApplied) {
    copyFileSync(rawAudioMixPath, audioMixPath);
  }

  // 4. Mux final MP4 (prefer NVENC if requested and available, fallback libx264)
  const outputAudioCodec = deliveryProfile.preset.audioCodec;
  const audioBitrate = outputAudioCodec === 'aac' ? (renderTarget === 'preview' ? '128k' : '192k') : undefined;
  const pixels = targetWidth * targetHeight;
  const targetVideoBitrate = renderTarget === 'preview' ? '2M' : pixels >= 8_000_000 ? '18M' : pixels >= 3_500_000 ? '10M' : '5M';
  const outputVideoFilter = `scale=${targetWidth}:${targetHeight},fps=${targetFps}`;
  let encoderUsed = 'libx264';
  if (input.useNvenc) {
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        rawVideoPath,
        '-i',
        audioMixPath,
        '-c:v',
        'h264_nvenc',
        '-vf',
        outputVideoFilter,
        '-preset',
        input.previewQuality === 'fast_preview' ? 'p1' : 'p4',
        '-b:v',
        targetVideoBitrate,
        '-c:a',
        outputAudioCodec,
        ...(audioBitrate ? ['-b:a', audioBitrate] : []),
        '-r',
        String(targetFps),
        '-shortest',
        mp4Path,
      ]);
      encoderUsed = 'h264_nvenc';
    } catch {
      encoderUsed = 'libx264';
    }
  }

  if (encoderUsed === 'libx264') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      rawVideoPath,
      '-i',
      audioMixPath,
      '-c:v',
      'libx264',
      '-vf',
      outputVideoFilter,
      '-preset',
      input.previewQuality === 'fast_preview' ? 'ultrafast' : 'veryfast',
      '-crf',
      input.previewQuality === 'fast_preview' ? '27' : '22',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      outputAudioCodec,
      ...(audioBitrate ? ['-b:a', audioBitrate] : []),
      '-r',
      String(targetFps),
      '-shortest',
      mp4Path,
    ]);
  }

  const probe = await probeRealMp4(mp4Path);
  const anomalies = await detectMediaAnomalies(mp4Path);
  const targetLufsForQc = deliveryProfile.audio.integratedLufs;
  const realQcFindings = runRealMediaQc(probe, targetLufsForQc, anomalies);
  const expectedVideoCodec = deliveryProfile.preset.videoCodec === 'h264_nvenc' ? 'h264' : deliveryProfile.preset.videoCodec;
  const validationErrors: string[] = [];
  if (probe.width !== targetWidth || probe.height !== targetHeight) validationErrors.push(`Dimensões FFprobe ${probe.width}x${probe.height} divergem do alvo ${targetWidth}x${targetHeight}.`);
  if (Math.abs(probe.fps - targetFps) > 0.1) validationErrors.push(`FPS FFprobe ${probe.fps} diverge do alvo ${targetFps}.`);
  if (Math.abs(probe.durationSec - totalDur) > Math.max(1.5, totalDur * 0.08)) validationErrors.push(`Duração FFprobe ${probe.durationSec}s diverge do planejamento ${totalDur}s.`);
  if (probe.videoCodec !== expectedVideoCodec) validationErrors.push(`Codec de vídeo FFprobe ${probe.videoCodec} diverge do codec esperado ${expectedVideoCodec}.`);
  if (probe.audioCodec !== deliveryProfile.preset.audioCodec) validationErrors.push(`Codec de áudio FFprobe ${probe.audioCodec ?? 'ausente'} diverge do codec esperado ${deliveryProfile.preset.audioCodec}.`);
  if (probe.audioSampleRate !== deliveryProfile.audio.sampleRate) validationErrors.push(`Sample rate FFprobe ${probe.audioSampleRate ?? 'ausente'} diverge do alvo ${deliveryProfile.audio.sampleRate}.`);
  const deliveryValidation = {
    valid: validationErrors.length === 0,
    target: renderTarget,
    expected: { width: targetWidth, height: targetHeight, fps: targetFps, durationSec: totalDur, audioCodec: deliveryProfile.preset.audioCodec, videoCodec: expectedVideoCodec },
    actual: { width: probe.width, height: probe.height, fps: probe.fps, durationSec: probe.durationSec, audioCodec: probe.audioCodec, videoCodec: probe.videoCodec, audioSampleRate: probe.audioSampleRate },
    errors: validationErrors,
  } as const;
  const waveformPeaks = await extractWaveformPeaks(audioMixPath, 80);

  return {
    mp4Path,
    isTechnicalSample,
    ...(sampleLabel ? { sampleLabel } : {}),
    ...(directives ? { appliedDirectives: directives } : {}),
    renderedHeadlines,
    narrationMode,
    encoderUsed,
    appliedEffects: [
      `${sceneFiles.length} cenas editadas com xfade transitions (fade, wipeleft, smoothleft, slideright, dissolve)`,
      'Motion graphics (barra animada + box safe-zone)',
      'Tipografia drawtext legível em safe zone',
      'VFX vignette=PI/6',
      'Color grading Rec.709 (colorspace=bt709, eq, limiter 16..235)',
      `Narração (${narrationMode}) + música + SFX sincronizados + sidechain ducking + loudnorm ${targetLufsForQc} LUFS`,
    ],
    probe,
    anomalies,
    incrementalRenderStats: {
      totalScenes: clipSpecs.length,
      cacheHits,
      reRenderedScenes,
      cacheDir: input.segmentCacheDir ?? join(workDir, 'segment-cache'),
    },
    realQcFindings: [...realQcFindings, ...audioAudit.conflicts.map((c, idx) => ({
      issueId: `sound_director_${c.conflictId}_${idx}`,
      timeRange: {
        start: { value: Math.floor(c.startMs / 1000), rate: 1 },
        duration: { value: Math.max(1, Math.ceil((c.endMs - c.startMs) / 1000)), rate: 1 },
      },
      category: 'audio' as const,
      severity: c.severity === 'critical' ? ('critical' as const) : ('warning' as const),
      confidence: 1,
      evidence: c.description,
      owner: 'sound' as const,
      fixSuggestion: c.correctiveAction,
      affectedDependencies: c.sceneIds,
      status: 'open' as const,
    }))],
    waveformPeaks,
    stemPaths: {
      voiceover: narrationWav,
      music: musicStemPath,
      sfx: sfxStemPath,
      ambience: ambienceStemPath,
      master: audioMixPath,
    },
    audioTimeline,
    audioAudit,
    narrationTextSent: narrationTextToSpeak,
    editorialConsistency,
    audioQuality,
    deliveryValidation,
  };
}
