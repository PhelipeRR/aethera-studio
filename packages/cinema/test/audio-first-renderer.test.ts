import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNarrationModeIsApproved,
  buildEditorialScript,
  produceCinemaPackage,
  renderRealCinemaMp4,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Audio-first real renderer', () => {
  it('does not accept procedural narration without explicit opt-in', () => {
    expect(() => assertNarrationModeIsApproved('procedural_voice_fallback')).toThrow(/procedural_voice_blocked/);
    expect(() => assertNarrationModeIsApproved('procedural_voice_fallback', true)).not.toThrow();
  });

  it('measures narration before final mux and extends a short planned video without cutting speech', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-audio-first-'));
    tempDirs.push(dir);
    const editorialScript = buildEditorialScript({
      scriptId: 'audio_first_long_script',
      source: 'agent',
      treatment: 'Narração de validação do caminho audio-first.',
      segments: [
        {
          beatId: 'beat_1',
          stage: 'hook',
          title: 'Night City',
          spokenText:
            'Em Night City, cada avenida revela uma camada diferente de Cyberpunk 2077. A cidade mistura neon, chuva, anúncios e conflitos humanos em uma paisagem que nunca fica parada.',
          estimatedDurationSec: 1.5,
        },
        {
          beatId: 'beat_2',
          stage: 'progression',
          title: 'Evidence',
          spokenText:
            'Nesta validação, a narração é deliberadamente mais longa que a estimativa visual para provar que a timeline não corta palavras nem termina antes da última frase.',
          estimatedDurationSec: 1.5,
        },
      ],
    });
    const pkg = produceCinemaPackage({
      projectId: 'audio_first_real_render',
      prompt: 'Cyberpunk 2077 em Night City',
      genre: 'gameplay_essay',
      targetDurationSec: 3,
      humorIntensity: 0,
      editorialScript,
      externalDirection: {
        treatment: editorialScript.treatment,
        beats: editorialScript.segments.map((segment) => ({ stage: segment.stage, summary: segment.spokenText })),
      },
    });
    pkg.timeline.clips = pkg.timeline.clips.slice(0, 2);
    pkg.direction.shots = pkg.direction.shots.slice(0, 2);
    pkg.direction.narrativeBeats = pkg.direction.narrativeBeats.slice(0, 2);

    const rendered = await renderRealCinemaMp4({
      pkg,
      outputDir: join(dir, 'render'),
      fileName: 'audio-first.mp4',
      useNvenc: false,
      previewQuality: 'fast_preview',
      allowProceduralVoiceFallback: false,
    });

    expect(rendered.narrationMode).not.toBe('procedural_voice_fallback');
    expect(rendered.audioFirstTimeline?.measuredNarrationDurationMs).toBeGreaterThan(
      rendered.audioFirstTimeline?.plannedDurationMs ?? Number.MAX_SAFE_INTEGER,
    );
    expect(rendered.audioFirstTimeline?.finalTimelineDurationMs).toBe(
      rendered.audioFirstTimeline?.measuredNarrationDurationMs,
    );
    expect(rendered.audioFirstTimeline?.completeNarrationPreserved).toBe(true);
    expect(rendered.audioFirstTimeline?.mixedAudioDurationMs).toBeGreaterThanOrEqual(
      (rendered.audioFirstTimeline?.measuredNarrationDurationMs ?? 0) - 150,
    );
    expect(rendered.audioFirstTimeline?.finalAudioStreamDurationMs).toBeGreaterThanOrEqual(
      (rendered.audioFirstTimeline?.measuredNarrationDurationMs ?? 0) - 150,
    );
    expect(rendered.audioFirstTimeline?.narrationSegmentCount).toBe(2);
    expect(rendered.audioFirstTimeline?.narrationProviders).toHaveLength(2);
    expect(rendered.audioFirstTimeline?.narrationProviders.every((provider) => provider.mode !== 'procedural_voice_fallback')).toBe(true);
    expect(rendered.audioFirstTimeline?.sceneDurationAdjustments.length).toBeGreaterThanOrEqual(2);
    expect(rendered.audioTimeline.filter((event) => event.bus === 'A1_narration')).toHaveLength(2);
    expect(new Set(rendered.audioTimeline.filter((event) => event.bus === 'A1_narration').map((event) => event.sceneId)).size).toBe(2);
    expect(rendered.deliveryValidation?.actual.audioDurationSec).toBeCloseTo(
      (rendered.audioFirstTimeline?.finalAudioStreamDurationMs ?? 0) / 1000,
      3,
    );
    expect(rendered.deliveryValidation?.valid).toBe(true);

    const narrationMetadataFiles = readdirSync(rendered.audioFirstTimeline?.narrationCacheDir ?? '')
      .filter((file) => file.endsWith('.wav.json'));
    expect(narrationMetadataFiles).toHaveLength(2);
    const firstMetadataFile = narrationMetadataFiles[0];
    if (!firstMetadataFile) throw new Error('Expected a persisted narration metadata sidecar.');
    const narrationMetadata = JSON.parse(
      readFileSync(join(rendered.audioFirstTimeline?.narrationCacheDir ?? '', firstMetadataFile), 'utf8'),
    ) as { providerNamespace?: string };
    expect(narrationMetadata.providerNamespace).toMatch(/^voicestudio:/);

    const persistedAfterRestart = JSON.parse(JSON.stringify(rendered)) as typeof rendered;
    expect(persistedAfterRestart.audioFirstTimeline).toMatchObject({
      plannedDurationMs: rendered.audioFirstTimeline?.plannedDurationMs,
      measuredNarrationDurationMs: rendered.audioFirstTimeline?.measuredNarrationDurationMs,
      finalTimelineDurationMs: rendered.audioFirstTimeline?.finalTimelineDurationMs,
      completeNarrationPreserved: true,
    });
  }, 60_000);
});
