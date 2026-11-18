import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSceneAudiovisualPlan,
  hasCrossWorkEntityConflict,
  interpretProductionPrompt,
  produceCinemaPackage,
  runGateAPreAssembly,
  runGateBPreRender,
  runGateCPostRender,
  selectSemanticSfxFromLibrary,
  validateSceneAudiovisualPlan,
} from '../src/index.js';

describe('Aethera Pipeline Quality Recovery (P1-P5)', () => {
  it('parses requestedDurationSec in seconds from prompt instead of falling back to 180s', () => {
    const prompt =
      'Crie um vídeo de 60 segundos sobre cinco jogos nostálgicos: Super Mario 64, Sonic the Hedgehog, GTA San Andreas, Red Dead Redemption 2 e Cyberpunk 2077.';
    const interpreted = interpretProductionPrompt(prompt);
    expect(interpreted.targetDurationSec).toBe(60);
  });

  it('prevents cross-work incompatible media recycling (e.g., Mario/Sonic into GTA/RDR2/Cyberpunk)', () => {
    const segments = [
      { segmentId: 's_mario', subject: 'Super Mario 64', narrationText: 'Super Mario 64', entities: ['Super Mario 64'], expectedDurationSec: 10 },
      { segmentId: 's_gta', subject: 'GTA San Andreas', narrationText: 'GTA San Andreas', entities: ['GTA San Andreas'], expectedDurationSec: 10 },
      { segmentId: 's_cp', subject: 'Cyberpunk 2077', narrationText: 'Cyberpunk 2077', entities: ['Cyberpunk 2077'], expectedDurationSec: 10 },
    ];
    expect(hasCrossWorkEntityConflict('Super Mario 64 Bowser Fight Gameplay', segments[1]!, segments)).toBe(true);
    expect(hasCrossWorkEntityConflict('Super Mario 64 Bowser Fight Gameplay', segments[2]!, segments)).toBe(true);
    expect(hasCrossWorkEntityConflict('GTA San Andreas Los Santos Gameplay', segments[1]!, segments)).toBe(false);
  });

  it('rejects motorcycle/unrelated SFX and selects semantically compatible SFX from local library', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-sfx-test-'));
    try {
      const files = [
        'Cactuzz Sound - 1993 Suzuki VS 800 GL Intruder.wav',
        'DavidDumais - ATV Arctic Cat 650 H1.wav',
        'Bluezone_BC0303_futuristic_user_interface_transition_006.wav',
        'Doex Studio - 90s Anime SFX Pack_whoosh_01.wav',
      ];
      const entries = files.map((name, idx) => {
        const p = join(dir, name);
        writeFileSync(p, Buffer.alloc(2048));
        return { id: String(idx + 1), path: p };
      });
      entries.push({ id: '99', path: join(dir, 'missing_transition.wav') });

      const selected = selectSemanticSfxFromLibrary(
        entries,
        [
          { id: 'sfx_1', eventType: 'transition', atMs: 1000 },
          { id: 'sfx_2', eventType: 'whoosh', atMs: 5000 },
        ],
        'vídeo sobre cinco jogos nostálgicos Super Mario 64 Sonic GTA Cyberpunk 2077',
      );
      expect(selected.length).toBe(2);
      expect(selected.some((s) => /suzuki|arctic cat|missing/i.test(s.path))).toBe(false);
      expect(selected[0]!.path).toContain('transition');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates transitionIn, vfx1 clips, vfxPlan, humorBeats, and audiovisualPlan in produceCinemaPackage', () => {
    const pkg = produceCinemaPackage({
      projectId: 'proj_quality_1',
      prompt: 'Crie um vídeo de 60 segundos sobre cinco jogos nostálgicos.',
      targetDurationSec: 60,
      humorIntensity: 45,
    });
    const v1 = pkg.timeline.clips.filter((c) => c.trackId === 'v1');
    const vfx1 = pkg.timeline.clips.filter((c) => c.trackId === 'vfx1');
    expect(v1.length).toBeGreaterThan(0);
    expect(v1.every((c) => Boolean(c.transitionIn))).toBe(true);
    expect(vfx1.length).toBeGreaterThan(0);
    expect(pkg.vfxPlan?.length).toBeGreaterThan(0);
    expect(pkg.audiovisualPlan).toBeDefined();
    const validation = validateSceneAudiovisualPlan(pkg.audiovisualPlan!);
    expect(validation.valid).toBe(true);
  });

  it('executes Gate A, Gate B, and Gate C with explicit needs_review / fail / pass verdicts', () => {
    const plan = buildSceneAudiovisualPlan({
      requestedDurationSec: 60,
      clips: [
        {
          clipId: 'c1',
          trackId: 'v1',
          mediaId: 'm1',
          label: 'Mario 64',
          sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } },
          timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 300, rate: 30 } },
          speed: 1,
          approved: true,
          effects: [],
          keyframes: [],
          transitionIn: 'dissolve',
        },
      ],
      scenes: [{ sceneId: 'scene_1', subject: 'Super Mario 64', narrationText: 'Super Mario 64 revolucionou o 3D.' }],
    });
    expect(plan.vfxPlan.length).toBe(1);

    const gateA = runGateAPreAssembly({
      requestedDurationSec: 60,
      plannedDurationSec: 60,
      coverageReport: {
        format: 'analysis',
        totalExpectedDurationSec: 60,
        identifiedAssetCount: 1,
        editorialApprovedAssetCount: 1,
        uniqueAssetCount: 1,
        usableMediaDurationSec: 60,
        contextualMediaDurationSec: 0,
        coverageRatio: 1,
        repetitionIndex: 0,
        uncoveredSubjects: [],
        incompatibleMedia: [],
        contextualMedia: [],
        segments: [],
        gatePassed: true,
        gateReasons: [],
      },
    });
    expect(gateA.verdict).toBe('pass');

    const gateBEmpty = runGateBPreRender({
      timeline: { projectId: 'p', fps: { value: 30, rate: 1 }, resolution: { width: 1280, height: 720 }, tracks: [], clips: [], markers: [], provenance: [], sourceMedia: {}, comedyBeats: [], qcFindings: [] },
      requestedDurationSec: 60,
    });
    expect(gateBEmpty.verdict).toBe('fail');

    const gateCPass = runGateCPostRender({
      requestedDurationSec: 60,
      actualDurationSec: 59.5,
      width: 1280,
      height: 720,
      hasAudio: true,
      blackFramesCount: 0,
      clippingDetected: false,
    });
    expect(gateCPass.verdict).toBe('pass');
  });
});
