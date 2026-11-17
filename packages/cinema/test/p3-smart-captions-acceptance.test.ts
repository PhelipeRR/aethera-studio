import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { produceCinemaPackage, renderRealCinemaMp4 } from '../src/index.js';

const cyberpunkPath = join(process.cwd(), 'artifacts', 'aethera-p2-broll-poc', '2026-11-17T17-22-54-360Z', 'media', 'cyberpunk-2077-clip.mp4');
const evidenceDir = join(process.cwd(), 'artifacts', 'aethera-p3-smart-captions', 'acceptance');

describe('P3 Smart Captions acceptance', () => {
  it('renders a local Cyberpunk MP4 with measured narration and visible ASS captions', async () => {
    if (!existsSync(cyberpunkPath)) throw new Error(`Local Cyberpunk fixture is missing: ${cyberpunkPath}`);
    mkdirSync(evidenceDir, { recursive: true });
    const pkg = produceCinemaPackage({
      projectId: 'p3_smart_captions_cyberpunk',
      prompt: 'Cyberpunk 2077 Night City com legendas sincronizadas',
      genre: 'gameplay_essay',
      targetDurationSec: 4,
      humorIntensity: 0,
      mediaCatalog: [{
        mediaId: 'cyberpunk_local',
        uri: cyberpunkPath,
        sha256: 'local-cyberpunk-p3',
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
        treatment: 'A validação do P3 usa mídia local real de Cyberpunk 2077.',
        beats: [{ stage: 'hook', summary: 'Night City combina neon, chuva e movimento em uma paisagem visualmente densa.' }],
      },
    });
    pkg.timeline.clips = pkg.timeline.clips.slice(0, 1);
    pkg.direction.shots = pkg.direction.shots.slice(0, 1);
    pkg.direction.narrativeBeats = pkg.direction.narrativeBeats.slice(0, 1);
    const captionWords = [
      { text: 'Night', startMs: 120, endMs: 380 },
      { text: 'City', startMs: 410, endMs: 700 },
      { text: 'combina', startMs: 730, endMs: 1_080 },
      { text: 'neon', startMs: 1_120, endMs: 1_380 },
    ];
    const first = await renderRealCinemaMp4({
      pkg,
      outputDir: evidenceDir,
      fileName: 'p3-cyberpunk-captioned.mp4',
      segmentCacheDir: join(evidenceDir, 'segment-cache'),
      requireRealMedia: true,
      previewQuality: 'fast_preview',
      allowProceduralVoiceFallback: false,
      captionStyle: 'game',
      captionKeywords: ['Night', 'City'],
      captionWords,
    });
    const second = await renderRealCinemaMp4({
      pkg,
      outputDir: evidenceDir,
      fileName: 'p3-cyberpunk-captioned-rerender.mp4',
      segmentCacheDir: join(evidenceDir, 'segment-cache'),
      requireRealMedia: true,
      previewQuality: 'fast_preview',
      allowProceduralVoiceFallback: false,
      captionStyle: 'game',
      captionKeywords: ['Night', 'City'],
      captionWords,
    });

    expect(existsSync(first.mp4Path)).toBe(true);
    expect(first.narrationMode).not.toBe('procedural_voice_fallback');
    expect(first.smartCaptions).toMatchObject({ enabled: true, wordCount: 4, cueCount: 2, coverage: { endMs: 1_380 } });
    expect(first.audioFirstTimeline?.completeNarrationPreserved).toBe(true);
    expect(first.deliveryValidation?.valid).toBe(true);
    expect(second.smartCaptions?.cacheHit).toBe(true);
    expect(second.incrementalRenderStats?.cacheHits).toBeGreaterThanOrEqual(1);

    writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify({
      schemaVersion: 1,
      media: cyberpunkPath,
      mp4Path: first.mp4Path,
      secondMp4Path: second.mp4Path,
      probe: first.probe,
      deliveryValidation: first.deliveryValidation,
      audioFirstTimeline: first.audioFirstTimeline,
      smartCaptions: first.smartCaptions,
      rerender: { smartCaptionCacheHit: second.smartCaptions?.cacheHit, sceneCacheHits: second.incrementalRenderStats?.cacheHits },
    }, null, 2), 'utf8');
  }, 120_000);
});
