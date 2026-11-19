import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSceneAudiovisualPlan,
  evaluateMediaRelevance,
  hasCrossWorkEntityConflict,
  interpretProductionPrompt,
  produceCinemaPackage,
  runGateAPreAssembly,
  runGateBPreRender,
  runGateCPostRender,
  selectSemanticSfxFromLibrary,
  validateSceneAudiovisualPlan,
} from '../src/index.js';
import { buildAcquisitionArgs, buildAcquisitionFormat } from '../../workspace/src/aethera-acquisition.js';

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

  it('builds partial yt-dlp args preferring progressive 720p mp4 without blocking long originals via --max-filesize', () => {
    const fmt = buildAcquisitionFormat(720);
    expect(fmt.startsWith('b[height<=720][ext=mp4]')).toBe(true);

    const sectionedArgs = buildAcquisitionArgs({
      url: 'https://www.youtube.com/watch?v=abc123',
      directory: 'C:/temp',
      fileStem: 'slot_1',
      maxHeight: 720,
      downloadSection: '*0:00-0:35',
      maxFilesize: '80M',
    });
    expect(sectionedArgs).toContain('--download-sections');
    expect(sectionedArgs).not.toContain('--max-filesize');

    const fullArgs = buildAcquisitionArgs({
      url: 'https://www.youtube.com/watch?v=abc123',
      directory: 'C:/temp',
      fileStem: 'slot_1',
      maxHeight: 720,
      maxFilesize: '80M',
    });
    expect(fullArgs).toContain('--max-filesize');
  });

  it('keeps VisionRouter/MediaRelevanceGate conservative: verified vs rejected vs needs_review across visually different games', async () => {
    const segment = {
      segmentId: 'scene_rdr2',
      narrationText: 'Red Dead Redemption 2 apresenta o velho oeste com cavalgadas e acampamentos.',
      expectedEntities: ['Red Dead Redemption 2'],
      prompt: 'Red Dead Redemption 2',
      requiresSpecificEventVisual: false,
    };

    // 1. Visually different urban/sci-fi game (Cyberpunk) must be rejected or never verified for RDR2
    const urbanMismatch = await evaluateMediaRelevance(
      {
        mediaId: 'cand_urban',
        title: 'Red Dead Redemption 2 trailer.mp4',
        origin: 'yt_dlp',
        url: 'https://youtube.com/watch?v=urban',
        durationSec: 30,
      },
      segment,
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 4,
            visualCategory: 'gameplay',
            detectedEntities: ['cyberpunk 2077', 'neon'],
            detectedActions: ['pilotando motocicleta futurista'],
            description: 'Visão em primeira pessoa pilotando motocicleta em avenida com neon rosa em Night City.',
            confidence: 0.9,
          },
          {
            timestampSec: 15,
            visualCategory: 'gameplay',
            detectedEntities: ['cyberpunk 2077'],
            detectedActions: [],
            description: 'Prédios futuristas e letreiros luminosos em cidade cyberpunk.',
            confidence: 0.88,
          },
        ],
      },
    );
    expect(urbanMismatch.accepted).toBe(false);
    expect(urbanMismatch.assemblyEligible).toBe(false);
    expect(urbanMismatch.verificationOutcome).toBe('rejected');

    // 2. Title matches file name, but frames show only generic scenery without positive entity proof -> needs_review
    const genericFrames = await evaluateMediaRelevance(
      {
        mediaId: 'cand_generic',
        title: 'Red Dead Redemption 2 gameplay.mp4',
        origin: 'yt_dlp',
        url: 'https://youtube.com/watch?v=gen',
        durationSec: 30,
      },
      segment,
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 5,
            visualCategory: 'gameplay',
            detectedEntities: [],
            detectedActions: [],
            description: 'Paisagem genérica com árvores ao fundo sem elementos identificáveis.',
            confidence: 0.5,
          },
          {
            timestampSec: 18,
            visualCategory: 'gameplay',
            detectedEntities: [],
            detectedActions: [],
            description: 'Estrada vazia com céu nublado.',
            confidence: 0.5,
          },
        ],
      },
    );
    expect(genericFrames.accepted).toBe(false);
    expect(genericFrames.assemblyEligible).toBe(false);
    expect(genericFrames.verificationOutcome).toBe('needs_review');

    // 3. Positive visual proof in multiple frames -> verified
    const verifiedRdr2 = await evaluateMediaRelevance(
      {
        mediaId: 'cand_rdr2',
        title: 'Red Dead Redemption 2 Official Trailer.mp4',
        origin: 'yt_dlp',
        url: 'https://youtube.com/watch?v=rdr2',
        durationSec: 45,
      },
      segment,
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 6,
            visualCategory: 'gameplay',
            detectedEntities: ['red dead redemption 2'],
            detectedActions: ['cavalgando'],
            description: 'Red Dead Redemption 2: Arthur Morgan cavalgando no velho oeste com montanhas nevadas.',
            confidence: 0.92,
          },
          {
            timestampSec: 21,
            visualCategory: 'gameplay',
            detectedEntities: ['red dead redemption 2'],
            detectedActions: ['acampamento'],
            description: 'Red Dead Redemption 2: dois vaqueiros próximos à fogueira no acampamento.',
            confidence: 0.91,
          },
        ],
      },
    );
    // 4. In-universe tokens (NCPD, Arasaka, armas/tiroteio) map to Cyberpunk 2077 / combat without bypassing identity checks
    const cpSegment = {
      segmentId: 'scene_cp',
      narrationText: 'Cyberpunk 2077 entrega ação futurista em Night City com visuais neon e combate intenso.',
      expectedEntities: ['Cyberpunk 2077', 'Night City'],
      prompt: 'Cyberpunk 2077',
    };
    const cpVerified = await evaluateMediaRelevance(
      {
        mediaId: 'cand_cp',
        title: 'Cyberpunk 2077 Gameplay.mp4',
        origin: 'yt_dlp',
        url: 'https://youtube.com/watch?v=cp2077',
        durationSec: 30,
      },
      cpSegment,
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 5,
            visualCategory: 'gameplay',
            detectedEntities: ['ncpd', 'arasaka'],
            detectedActions: ['atirando com rifle'],
            description: 'Tiroteio em rua iluminada por neon contra viaturas da NCPD.',
            confidence: 0.9,
          },
          {
            timestampSec: 18,
            visualCategory: 'gameplay',
            detectedEntities: ['night city'],
            detectedActions: ['disparando pistola'],
            description: 'Combate em primeira pessoa com armas futuristas em Night City.',
            confidence: 0.91,
          },
        ],
      },
    );
    expect(cpVerified.accepted).toBe(true);
    expect(cpVerified.assemblyEligible).toBe(true);
    expect(cpVerified.verificationOutcome).toBe('verified');
  });
});
