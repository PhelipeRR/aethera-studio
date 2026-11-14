/*
 * SD-2.2 — Integração Contextual de SFX.
 *
 * Estende o render-plan-sd211.mts substituindo assignSfx() hardcoded
 * pelo classificador contextual classifyAndSelectSfx(), que seleciona
 * SFX baseado em intent, label, posição na timeline e palavras-chave.
 *
 * Uso:
 *   PLANO=jogos npx tsx render-plan-sd22.mts
 *   PLANO=buraco-como npx tsx render-plan-sd22.mts
 *   PLANO=farol npx tsx render-plan-sd22.mts
 *   PLANO=filas npx tsx render-plan-sd22.mts
 *
 * Saída: <PLANO>-sd22.mp4 (com áudio + SFX contextuais) + relatorio-<PLANO>-sd22.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import {
  assembleTimeline,
  timelineDocumentSchema,
} from '../packages/shared/src/aethera-timeline.ts';
import {
  applyEditorialPlan,
  type DirectorSegment,
  type EditorialPlan,
} from '../packages/shared/src/aethera-smart-director.ts';
import { VIDEO_FORMATS } from '../packages/shared/src/velix-production.ts';
import { designAetheraAudio } from '../packages/shared/src/aethera-audio.ts';
import { classifyAndSelectSfx, validateSfxEvents } from '../packages/shared/src/aethera-sfx-classifier.ts';
import { renderAetheraTimelineSegments } from '../packages/workspace/src/velix-motion.ts';
import { renderAetheraAudioUnlocked } from '../packages/workspace/src/aethera-audio-render.js';
import { createVoiceStudioClient } from '../packages/workspace/src/velix-narration.js';

const FFMPEG = 'C:/ffmpeg/bin/ffmpeg.exe';
const FFPROBE = 'C:/ffmpeg/bin/ffprobe.exe';
const HERE = resolve(import.meta.dirname);
const REPO = resolve(HERE, '..');
const BROWSER = join(process.env['APPDATA'] ?? '', 'Singularity', 'motion-runtime', 'node_modules', '.remotion', 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const MOTIONVELIX_SFX_DIR = 'C:/Users/Pheli/.claude/skills/motionvelix/assets/sfx';

const id = process.env['PLANO'] ?? 'buraco-como';
const { plan, segments } = JSON.parse(readFileSync(join(HERE, process.env['PLANOS'] ?? 'planos-v4', `${id}.json`), 'utf8')) as { plan: EditorialPlan; segments: DirectorSegment[] };
const format = id === 'filas' ? VIDEO_FORMATS['instagram-reels'] : VIDEO_FORMATS['youtube-long'];
const root = join(HERE, 'render-root-sd22');
mkdirSync(root, { recursive: true });

// --- Narração ---
const NARRATION_MEASURED: Record<string, string> = {
  jogos: resolve(HERE, '../aethera-e2/D-ritmo-corrigido/narracao/narracao-66bd9f5b330a0963-680.wav'),
};

async function synthesizeNarration(segs: DirectorSegment[], outputDir: string): Promise<{ path: string; durationMs: number }> {
  const client = createVoiceStudioClient({ baseUrl: 'http://127.0.0.1:3900' });
  const status = await client.status();
  if (!status.available) throw new Error(`VoiceStudio indisponível: ${status.error}`);

  const modelId = 'omnivoice';
  const voiceId = 'a6422ef2'; // Phelipe PT-BR
  const blocks: string[] = [];

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const blockPath = join(outputDir, `bloco-${i}.wav`);
    if (!existsSync(blockPath)) {
      console.log(`  [TTS] segmento ${i + 1}/${segs.length}: "${seg.text.slice(0, 50)}…"`);
      const result = await client.speech({ text: seg.text, modelId, voiceId, format: 'wav', language: 'pt' });
      writeFileSync(blockPath, result.bytes);
    }
    blocks.push(blockPath);
  }

  const concatPath = join(outputDir, 'narracao-sd22.wav');
  if (!existsSync(concatPath)) {
    const inputs = blocks.flatMap((b) => ['-i', b]);
    const filter = blocks.map((_, i) => `[${i}:a]`).join('') + `concat=n=${blocks.length}:v=0:a=1[out]`;
    execFileSync(FFMPEG, ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', concatPath], { windowsHide: true });
  }

  const durStdout = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', concatPath], { encoding: 'utf8', windowsHide: true }).trim();
  return { path: concatPath, durationMs: Math.round(Number(durStdout) * 1000) };
}

// --- Main ---
console.log(`\n=== SD-2.2: ${id} ===`);

// 1. Narração
const narrationDir = join(root, `narracao-${id}`);
mkdirSync(narrationDir, { recursive: true });
let narrationPath: string;
let narrationDurationMs: number;

if (NARRATION_MEASURED[id] && existsSync(NARRATION_MEASURED[id])) {
  narrationPath = NARRATION_MEASURED[id];
  const durStdout = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', narrationPath], { encoding: 'utf8', windowsHide: true }).trim();
  narrationDurationMs = Math.round(Number(durStdout) * 1000);
  console.log(`Narração medida: ${basename(narrationPath)} (${narrationDurationMs} ms)`);
} else {
  console.log('Narração não encontrada; sintetizando via VoiceStudio…');
  const result = await synthesizeNarration(segments, narrationDir);
  narrationPath = result.path;
  narrationDurationMs = result.durationMs;
  console.log(`Narração sintetizada: ${narrationDurationMs} ms`);
}

// 2. Timeline visual
const scenes = segments.map((segment, index) => ({
  id: `${id}-${index}`, chapter: 1, narration: segment.text, startMs: segment.startMs, endMs: segment.endMs, claimIds: [], visualObjective: segment.text.slice(0, 80), sceneType: 'broll' as const, searchTerms: ['x'],
  visual: { type: 'fallback' as const, kind: 'animation' as const, reason: 'SD-2.2 sem mídia' }, onScreenText: '', transition: 'cut' as const, camera: 'static' as const, locked: false, reviewStatus: 'approved' as const,
  audio: { relativePath: `${id}-${index}.wav`, durationMs: segment.endMs - segment.startMs, key: `${id}-${index}`, words: segment.words.map((word) => ({ w: word.w, startMs: word.startMs - segment.startMs, endMs: word.endMs - segment.startMs })) },
}));
const document = assembleTimeline({ runId: `sd22-${id}`, storyboard: { schemaVersion: 1, timing: 'measured', narrationKey: `sd22-${id}`, scenes }, format });
const remapped = segments.map((segment, index) => ({ ...segment, sceneId: scenes[index]?.id ?? segment.sceneId }));
const executed = applyEditorialPlan(document, plan, { segments: remapped, subjects: [], candidates: [], proxyPaths: new Map() });
const timeline = timelineDocumentSchema.parse(executed.document);
writeFileSync(join(HERE, `timeline-${id}-sd22.json`), `${JSON.stringify(timeline, null, 2)}\n`);

// 3. Render dos segmentos visuais
console.log('Renderizando segmentos visuais…');
const rendered = await renderAetheraTimelineSegments({ root, timeline, cacheRelativeDir: 'segmentos-sd22', bundlePath: join(REPO, 'apps/desktop/motion-bundle'), workerPath: join(REPO, 'apps/desktop/motion/render-worker.mjs'), runtime: process.execPath, browserExecutable: BROWSER, ffmpeg: FFMPEG, ffprobe: FFPROBE });
const list = join(HERE, `segmentos-${id}-sd22.txt`);
writeFileSync(list, rendered.map((segment) => `file '${join(root, segment.relativePath).replaceAll('\\', '/')}'`).join('\n'));

const videoOnly = join(HERE, `${id}-sd22-video-only.mp4`);
execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', (narrationDurationMs / 1000).toFixed(3), videoOnly]);
console.log(`Vídeo silencioso: ${videoOnly}`);

// 4. SFX contextuais via classificador
console.log('Classificando SFX contextuais…');
const sfxEvents = classifyAndSelectSfx({ timeline, sfxBasePath: MOTIONVELIX_SFX_DIR, baseGainDb: -6 });
const validation = validateSfxEvents(sfxEvents, narrationDurationMs);
if (!validation.valid) {
  console.warn('⚠ Validação de SFX falhou:');
  for (const err of validation.errors) console.warn(`  ${err}`);
}
console.log(`SFX classificados: ${sfxEvents.length} eventos`);
for (const sfx of sfxEvents) {
  const exists = existsSync(sfx.relativePath);
  if (!exists) console.warn(`  ⚠ SFX não encontrado: ${sfx.relativePath}`);
  else console.log(`  ✓ ${sfx.sfxId} @${sfx.atMs}ms gain=${sfx.gainDb}dB`);
}

// 5. Audio plan com SFX contextuais
const audioInput = {
  music: null,
  sfx: sfxEvents.filter((s) => existsSync(s.relativePath)),
};
const audioPlan = designAetheraAudio({ timeline, music: null, sfx: audioInput.sfx });
writeFileSync(join(HERE, `audio-plan-${id}-sd22.json`), `${JSON.stringify(audioPlan, null, 2)}\n`);
console.log(`Audio plan: targetLufs=${audioPlan.targetLufs}, ducking=${audioPlan.ducking.length} envelopes, sfx=${audioPlan.sfx.length} eventos`);

// 6. Mixagem final
const audioOutput = join(HERE, `${id}-sd22-audio.m4a`);
await renderAetheraAudioUnlocked({
  ffmpeg: FFMPEG,
  narration: narrationPath,
  plan: audioPlan,
  output: audioOutput,
  durationMs: narrationDurationMs,
});
console.log(`Áudio mixado: ${audioOutput}`);

// 7. Mux vídeo + áudio
const finalOutput = join(HERE, `${id}-sd22.mp4`);
execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', videoOnly, '-i', audioOutput, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalOutput]);
console.log(`✅ Render final: ${finalOutput}`);

// 8. Relatório
const report = {
  plano: id,
  versao: 'SD-2.2',
  narracao: { origem: NARRATION_MEASURED[id] ? 'medida' : 'sintetizada', durationMs: narrationDurationMs, path: narrationPath },
  sfx: sfxEvents.map((s) => ({ sfxId: s.sfxId, atMs: s.atMs, durationMs: s.durationMs, gainDb: s.gainDb, existe: existsSync(s.relativePath) })),
  audioPlan: { targetLufs: audioPlan.targetLufs, truePeakDb: audioPlan.truePeakDb, duckingEnvelopes: audioPlan.ducking.length, sfxEvents: audioPlan.sfx.length },
  efeitosVisuais: { totalFallbacks: executed.fallbacks.length, totalGaps: executed.gaps.length, transitions: executed.transitions },
  saida: finalOutput,
  geradoEm: new Date().toISOString(),
};
writeFileSync(join(HERE, `relatorio-${id}-sd22.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Relatório: relatorio-${id}-sd22.json\n`);