import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { produceCinemaPackage, renderRealCinemaMp4 } from '../src/index.js';

const cyberpunkPath = join(process.cwd(), 'artifacts', 'aethera-p2-broll-poc', '2026-11-17T17-22-54-360Z', 'media', 'cyberpunk-2077-clip.mp4');
const evidenceDir = join(process.cwd(), 'artifacts', 'aethera-p6-e2e');

describe('P6 60-second production E2E', () => {
  it('reuses local Cyberpunk media and produces a reproducible FFmpeg MP4 with persisted diagnostics', async () => {
    if (!existsSync(cyberpunkPath)) throw new Error(`Local Cyberpunk fixture is missing: ${cyberpunkPath}`);
    mkdirSync(evidenceDir, { recursive: true });
    const pkg = produceCinemaPackage({
      projectId: 'p6_e2e_cyberpunk_60s',
      prompt: 'Cyberpunk 2077: Night City, implantes e sobrevivência em 60 segundos',
      genre: 'gameplay_essay',
      targetDurationSec: 60,
      humorIntensity: 0,
      mediaCatalog: [{
        mediaId: 'cyberpunk_local',
        uri: cyberpunkPath,
        sha256: 'local-cyberpunk-p6',
        kind: 'video',
        origin: 'local',
        license: 'user_owned',
        duration: { value: 15, rate: 1 },
        width: 1280,
        height: 720,
        fps: { value: 30, rate: 1 },
        hasAudio: false,
      }],
      externalDirection: {
        treatment: 'Produção E2E local com b-roll real Cyberpunk, narração medida e composição FFmpeg.',
        beats: [
          { stage: 'hook', summary: 'Night City transforma cada rua em uma promessa de perigo e descoberta.' },
          { stage: 'progression', summary: 'Implantes ampliam o corpo, mas também aumentam o custo de cada escolha.' },
          { stage: 'progression', summary: 'A cidade mistura neon, chuva e movimento em uma paisagem visualmente densa.' },
          { stage: 'tension', summary: 'Quando a missão muda, o jogador precisa decidir entre velocidade e controle.' },
          { stage: 'climax', summary: 'O confronto revela que tecnologia sem propósito não garante sobrevivência.' },
          { stage: 'resolution', summary: 'No fim, Night City continua viva e a próxima escolha já começou.' },
        ],
      },
    });

    const first = await renderRealCinemaMp4({
      pkg,
      outputDir: evidenceDir,
      fileName: 'aethera-p6-cyberpunk-60s.mp4',
      segmentCacheDir: join(evidenceDir, 'segment-cache'),
      requireRealMedia: true,
      previewQuality: 'fast_preview',
      allowProceduralVoiceFallback: false,
    });
    const second = await renderRealCinemaMp4({
      pkg,
      outputDir: evidenceDir,
      fileName: 'aethera-p6-cyberpunk-60s-rerender.mp4',
      segmentCacheDir: join(evidenceDir, 'segment-cache'),
      requireRealMedia: true,
      previewQuality: 'fast_preview',
      allowProceduralVoiceFallback: false,
    });

    expect(existsSync(first.mp4Path)).toBe(true);
    expect(existsSync(`${first.mp4Path}.delivery.json`)).toBe(true);
    expect(first.narrationMode).not.toBe('procedural_voice_fallback');
    expect(first.audioFirstTimeline?.completeNarrationPreserved).toBe(true);
    expect(first.probe.audioCodec).toBeTruthy();
    expect(first.probe.durationSec).toBeGreaterThanOrEqual(55);
    expect(first.probe.durationSec).toBeLessThanOrEqual(65);
    expect(first.deliveryGate?.status).toBe('approved');
    expect(second.narrationCacheHits).toBeGreaterThanOrEqual(1);
    expect(second.incrementalRenderStats?.cacheHits).toBeGreaterThanOrEqual(1);

    const persistedGate = JSON.parse(readFileSync(`${first.mp4Path}.delivery.json`, 'utf8')) as typeof first.deliveryGate;
    expect(persistedGate).toEqual(first.deliveryGate);
    writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify({
      schemaVersion: 1,
      phase: 'P6',
      sourceMedia: cyberpunkPath,
      mp4Path: first.mp4Path,
      rerenderMp4Path: second.mp4Path,
      probe: first.probe,
      deliveryValidation: first.deliveryValidation,
      deliveryGate: first.deliveryGate,
      audioFirstTimeline: first.audioFirstTimeline,
      narration: {
        mode: first.narrationMode,
        measuredDurationMs: first.audioFirstTimeline?.measuredNarrationDurationMs,
        cacheHitsOnRerender: second.narrationCacheHits,
      },
      cache: second.incrementalRenderStats,
      limitations: [
        'Nenhum asset local separado de música, ambience ou SFX licenciados foi encontrado; esta prova valida a narração real e a composição FFmpeg.',
        'Nenhuma legenda foi declarada nesta prova porque timestamps por palavra completos não estavam disponíveis; não há aprovação silenciosa de captions.',
      ],
    }, null, 2), 'utf8');
  }, 180_000);
});
