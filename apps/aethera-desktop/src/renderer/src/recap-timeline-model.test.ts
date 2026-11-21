import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAudiovisualTracks,
  derivePipelineTimeline,
  deriveQualityScorecard,
  formatTimecodeMs,
  getStateMetadata,
  mergeActiveProjectIntoRecentList,
  toAetheraMediaUrl,
  type MotionVelixRenderTelemetry,
  type RecapAudiovisualPlanView,
  type RecapGateReportView,
  type RecapProjectRecordView,
} from './recap-timeline-model.js';

function makeRecord(overrides: Partial<RecapProjectRecordView> = {}): RecapProjectRecordView {
  return {
    schemaVersion: 1,
    runId: 'run-alpha',
    chapterId: 'ch-01',
    workTitle: 'Solo Leveling — Cap. 01',
    state: 'idle',
    completedSteps: [],
    updatedAtIso: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

test('derivePipelineTimeline returns 0% idle timeline when no record exists', () => {
  const tl = derivePipelineTimeline(null);
  assert.equal(tl.completedCount, 0);
  assert.equal(tl.totalCount, 8);
  assert.equal(tl.overallProgressPct, 0);
  assert.equal(tl.tone, 'neutral');
  assert.equal(tl.stages.every((s) => s.status === 'pending'), true);
});

test('derivePipelineTimeline marks exact active, completed, failed, and paused stages from real record', () => {
  const importing = derivePipelineTimeline(
    makeRecord({
      state: 'importing',
      currentStage: 'import',
      completedSteps: [],
    }),
    'Extraindo páginas do CBZ...',
  );
  assert.equal(importing.completedCount, 0);
  assert.equal(importing.overallProgressPct, 0);
  assert.equal(importing.stages.find((s) => s.id === 'import')?.status, 'active');
  assert.equal(importing.detailMessage, 'Extraindo páginas do CBZ...');

  const failedAtMotion = derivePipelineTimeline(
    makeRecord({
      state: 'failed',
      currentStage: 'motion',
      completedSteps: ['import', 'gate-f', 'vision', 'continuity', 'script', 'humanize'],
      lastError: 'FFmpeg retornou erro ao mixar SFX',
    }),
  );
  assert.equal(failedAtMotion.completedCount, 6);
  assert.equal(failedAtMotion.overallProgressPct, 75);
  assert.equal(failedAtMotion.tone, 'error');
  assert.equal(failedAtMotion.stages.find((s) => s.id === 'motion')?.status, 'failed');
  assert.equal(failedAtMotion.stages.find((s) => s.id === 'gate-h')?.status, 'pending');

  const paused = derivePipelineTimeline(
    makeRecord({
      state: 'paused_provider_unavailable',
      currentStage: 'vision',
      completedSteps: ['import', 'gate-f'],
    }),
  );
  assert.equal(paused.tone, 'warning');
  assert.equal(paused.stages.find((s) => s.id === 'vision')?.status, 'paused');

  const masterExport = derivePipelineTimeline(
    makeRecord({
      state: 'master_export',
      currentStage: 'motion',
      completedSteps: ['import', 'gate-f', 'vision', 'continuity', 'script', 'humanize', 'motion'],
    }),
  );
  // Master export re-enters motion stage even though preview motion already completed
  assert.equal(masterExport.stages.find((s) => s.id === 'motion')?.status, 'active');

  const completed = derivePipelineTimeline(
    makeRecord({
      state: 'completed',
      completedSteps: ['import', 'gate-f', 'vision', 'continuity', 'script', 'humanize', 'motion', 'gate-h'],
    }),
  );
  assert.equal(completed.completedCount, 8);
  assert.equal(completed.overallProgressPct, 100);
  assert.equal(completed.tone, 'success');
});

test('deriveAudiovisualTracks projects real shots, Audio-First sync, and MotionVelix SFX cues', () => {
  const empty = deriveAudiovisualTracks(null);
  assert.equal(empty.hasRealPlan, false);
  assert.equal(empty.shots.length, 0);

  const plan: RecapAudiovisualPlanView = {
    chapterId: 'ch-01',
    scriptTitle: 'Cap. 01',
    renderTarget: 'preview',
    aspectRatio: '16:9',
    width: 1280,
    height: 720,
    fps: 24,
    totalDurationMs: 10_000,
    shots: [
      {
        shotId: 'shot-1',
        sceneId: 'scene-1',
        sceneIndex: 0,
        panelId: 'p1',
        pageNumber: 1,
        imagePath: '/tmp/p1.png',
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        motionStyle: 'ken_burns_in',
        transitionIn: 'dip_black',
        balloonSafeZoneProtected: true,
        emotion: 'tension',
      },
      {
        shotId: 'shot-2',
        sceneId: 'scene-2',
        sceneIndex: 1,
        panelId: 'p2',
        pageNumber: 2,
        imagePath: '/tmp/p2.png',
        startMs: 4000,
        endMs: 10000,
        durationMs: 6000,
        motionStyle: 'impact_push',
        transitionIn: 'flash_white',
        balloonSafeZoneProtected: false,
        framingCropRisk: { atRisk: true, reason: 'Corte lateral alto' },
        emotion: 'action',
      },
    ],
    sfxCues: [
      {
        cueId: 'sfx-1',
        sceneId: 'scene-1',
        timeMs: 500,
        sfxKind: 'whoosh',
        gainDb: -10,
        reason: 'Abertura',
      },
      {
        cueId: 'sfx-2',
        sceneId: 'scene-2',
        timeMs: 4200,
        sfxKind: 'impact_hit',
        gainDb: -8,
        reason: 'Golpe',
      },
    ],
    vfxSpecs: [
      { sceneId: 'scene-1', vignetteStrength: 0.2, contrastBoost: 1.08, shakeIntensity: 0, balloonSafe: true },
      { sceneId: 'scene-2', vignetteStrength: 0, contrastBoost: 1.0, shakeIntensity: 0, balloonSafe: true },
    ],
    captions: { cues: [{}, {}, {}] },
    durationAudit: {
      plannedTimelineDurationMs: 10_000,
      measuredNarrationDurationMs: 9_600,
      finalTimelineDurationMs: 10_000,
    },
  };

  const motionVelix: MotionVelixRenderTelemetry = {
    engine: 'ffmpeg_motionvelix_hybrid',
    sfxDirUsed: '/kit/assets/sfx',
    sfxPlanned: 2,
    sfxApplied: 1,
    sfxKindsApplied: ['whoosh'],
    vfxAppliedShots: 1,
    transitionsApplied: 2,
    motionStylesUsed: ['ken_burns_in', 'impact_push'],
    fallbackUsed: false,
  };

  const tracks = deriveAudiovisualTracks(plan, motionVelix);
  assert.equal(tracks.hasRealPlan, true);
  assert.equal(tracks.resolutionLabel, '1280×720');
  assert.equal(tracks.audioClipped, false);
  assert.equal(tracks.shots.length, 2);
  assert.equal(tracks.shots[0]?.widthPct, 40);
  assert.equal(tracks.shots[1]?.startPct, 40);
  assert.equal(tracks.shots[1]?.framingAtRisk, true);
  assert.equal(tracks.sfxMarkers.length, 2);
  assert.equal(tracks.sfxMarkers[0]?.applied, true);
  assert.equal(tracks.sfxMarkers[1]?.applied, false);
  assert.equal(tracks.captionCueCount, 3);
  assert.equal(tracks.vfxActiveCount, 1);

  // Audio clipped detection when totalDurationMs < measuredNarrationDurationMs
  const clipped = deriveAudiovisualTracks({
    ...plan,
    totalDurationMs: 8000,
    durationAudit: {
      plannedTimelineDurationMs: 8000,
      measuredNarrationDurationMs: 9500,
      finalTimelineDurationMs: 8000,
    },
  });
  assert.equal(clipped.audioClipped, true);
});

test('deriveQualityScorecard never fabricates scores when unevaluated and reflects real Gate F/G/H failures', () => {
  const empty = deriveQualityScorecard(makeRecord(), null, null);
  assert.equal(empty.evaluated, false);
  assert.equal(empty.technicalScore, null);
  assert.equal(empty.narrativeScore, null);
  assert.equal(empty.audioScore, null);

  const gateGPass: RecapGateReportView = { verdict: 'pass', reasons: [] };
  const gateHPass: RecapGateReportView = {
    verdict: 'pass',
    reasons: [],
    findings: [],
    metrics: { audioClipped: false, narrationFallbackCount: 0, sfxPlanned: 3, sfxApplied: 3 },
  };
  const passed = deriveQualityScorecard(
    makeRecord({ gateFVerdict: 'pass', gateGVerdict: 'pass', gateHVerdict: 'pass' }),
    gateGPass,
    gateHPass,
  );
  assert.equal(passed.evaluated, true);
  assert.equal(passed.approvedForRelease, true);
  assert.equal(passed.technicalScore, 100);
  assert.equal(passed.narrativeScore, 100);
  assert.equal(passed.audioScore, 100);

  const gateHFail: RecapGateReportView = {
    verdict: 'fail',
    reasons: ['MotionVelix SFX não aplicado'],
    findings: [{ severity: 'critical', detail: 'MotionVelix ausente' }],
    metrics: { audioClipped: false, narrationFallbackCount: 0, sfxPlanned: 4, sfxApplied: 0 },
  };
  const failed = deriveQualityScorecard(
    makeRecord({ gateFVerdict: 'pass', gateGVerdict: 'needs_review', gateHVerdict: 'fail' }),
    { verdict: 'needs_review', reasons: ['Revisar ritmo da cena 2'] },
    gateHFail,
  );
  assert.equal(failed.approvedForRelease, false);
  assert.equal(failed.technicalScore, 70);
  assert.equal(failed.narrativeScore, 75);
  assert.equal(failed.audioScore, 70);
  assert.deepEqual(failed.reasons, ['Revisar ritmo da cena 2', 'MotionVelix SFX não aplicado']);
});

test('mergeActiveProjectIntoRecentList keeps active project visible, deduplicated, and sorted newest-first', () => {
  const older = makeRecord({ runId: 'run-1', workTitle: 'Antigo', updatedAtIso: '2026-11-20T08:00:00.000Z' });
  const middle = makeRecord({ runId: 'run-2', workTitle: 'Intermediário', updatedAtIso: '2026-11-21T09:00:00.000Z' });
  const activeUpdated = makeRecord({
    runId: 'run-2',
    workTitle: 'Intermediário (Atualizado)',
    state: 'audiovisual_preview',
    updatedAtIso: '2026-11-21T12:30:00.000Z',
  });
  const brandNew = makeRecord({
    runId: 'run-3',
    workTitle: 'Novo Em Execução',
    state: 'importing',
    updatedAtIso: '2026-11-21T13:00:00.000Z',
  });

  const mergedUpdated = mergeActiveProjectIntoRecentList([older, middle], activeUpdated);
  assert.equal(mergedUpdated.length, 2);
  assert.equal(mergedUpdated[0]?.runId, 'run-2');
  assert.equal(mergedUpdated[0]?.workTitle, 'Intermediário (Atualizado)');
  assert.equal(mergedUpdated[1]?.runId, 'run-1');

  const mergedNew = mergeActiveProjectIntoRecentList([older, middle], brandNew);
  assert.equal(mergedNew.length, 3);
  assert.equal(mergedNew[0]?.runId, 'run-3');
});

test('formatTimecodeMs, toAetheraMediaUrl, and getStateMetadata behave deterministically', () => {
  assert.equal(formatTimecodeMs(0), '00:00.0');
  assert.equal(formatTimecodeMs(65_400), '01:05.4');
  assert.equal(formatTimecodeMs(-10), '00:00.0');
  assert.equal(
    toAetheraMediaUrl('C:\\recap\\preview.mp4'),
    'aethera-media://local?path=C%3A%5Crecap%5Cpreview.mp4',
  );
  assert.equal(toAetheraMediaUrl('aethera-media://local?path=x'), 'aethera-media://local?path=x');
  assert.equal(getStateMetadata('awaiting_preview_approval').tone, 'warning');
  assert.equal(getStateMetadata('completed').tone, 'success');
});
