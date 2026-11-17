import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  buildEditorialScript,
  produceCinemaPackage,
  renderRealCinemaMp4,
  type SourceMediaRecord,
} from '../packages/cinema/src/index.js';

const repoRoot = resolve(import.meta.dirname, '..');
const cyberpunkPath = join(repoRoot, 'artifacts', 'creative-studio-cs6', 'cyberpunk-2077-clip.mp4');
if (!existsSync(cyberpunkPath) || statSync(cyberpunkPath).size <= 1024) {
  throw new Error(`Cyberpunk local artifact ausente ou inválido; nenhum download será iniciado: ${cyberpunkPath}`);
}

const projectId = 'aethera_p1_cyberpunk_audio_first';
const runId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const evidenceDir = join(repoRoot, 'artifacts', 'aethera-p1-audio-first', runId);
mkdirSync(evidenceDir, { recursive: true });
const sourceSha256 = createHash('sha256').update(readFileSync(cyberpunkPath)).digest('hex');

const sourceMedia: SourceMediaRecord = {
  mediaId: `${projectId}_src_main`,
  uri: cyberpunkPath,
  sha256: sourceSha256,
  kind: 'video',
  origin: 'local',
  license: 'user_owned',
  duration: { value: 48, rate: 24 },
  width: 1280,
  height: 720,
  fps: { value: 24, rate: 1 },
  hasAudio: false,
};
const spokenSegments = [
  {
    beatId: 'beat_1',
    stage: 'hook' as const,
    title: 'Night City',
    spokenText: 'Cyberpunk 2077 transforma Night City em uma paisagem de neon, chuva e conflito.',
    estimatedDurationSec: 1,
  },
  {
    beatId: 'beat_2',
    stage: 'progression' as const,
    title: 'Evidence',
    spokenText: 'Cada avenida apresenta uma escolha visual diferente, e esta narração longa valida que a montagem respeita a última palavra sem cortar o áudio.',
    estimatedDurationSec: 1,
  },
];
const spokenText = spokenSegments.map((segment) => segment.spokenText).join(' ');
const editorialScript = buildEditorialScript({
  scriptId: `${projectId}_script`,
  source: 'agent',
  treatment: 'Evidência real do pipeline audio-first com mídia local de Cyberpunk 2077.',
  segments: spokenSegments,
});
const pkg = produceCinemaPackage({
  projectId,
  prompt: 'Cyberpunk 2077 em Night City',
  genre: 'gameplay_essay',
  targetDurationSec: 2,
  humorIntensity: 0,
  mediaCatalog: [sourceMedia],
  editorialScript,
  externalDirection: {
    treatment: editorialScript.treatment,
    beats: spokenSegments.map((segment) => ({ stage: segment.stage, summary: segment.spokenText })),
  },
});
pkg.timeline.clips = pkg.timeline.clips.slice(0, 2);
pkg.direction.shots = pkg.direction.shots.slice(0, 2);
pkg.direction.narrativeBeats = pkg.direction.narrativeBeats.slice(0, 2);

const rendered = await renderRealCinemaMp4({
  pkg,
  outputDir: join(evidenceDir, 'render'),
  fileName: 'cyberpunk-audio-first.mp4',
  requireRealMedia: true,
  useNvenc: false,
  previewQuality: 'fast_preview',
  allowProceduralVoiceFallback: false,
  voiceStudioVoiceId: '9190edfa',
  segmentCacheDir: join(evidenceDir, 'segment-cache'),
  language: 'pt-BR',
});

const report = {
  schemaVersion: 1,
  phase: 'P1',
  sourceMedia: {
    path: cyberpunkPath,
    bytes: statSync(cyberpunkPath).size,
    sha256: sourceSha256,
    reusedWithoutDownload: true,
  },
  renderedAt: new Date().toISOString(),
  mp4Path: rendered.mp4Path,
  narrationMode: rendered.narrationMode,
  narrationTextWords: spokenText.split(/\s+/).length,
  audioFirstTimeline: rendered.audioFirstTimeline,
  probe: rendered.probe,
  deliveryValidation: rendered.deliveryValidation,
  incrementalRenderStats: rendered.incrementalRenderStats,
};
writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
