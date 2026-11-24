import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAudiovisualTracks,
  derivePipelineTimeline,
  deriveQualityScorecard,
  deriveQueueItemDisplayStatus,
  deriveSeparatedImportAndProductionStatus,
  deriveWorkflowSteps,
  formatTimecodeMs,
  getStateMetadata,
  mergeActiveProjectIntoRecentList,
  RECAP_PIPELINE_STAGES,
  RECAP_RELEASE_GATE_LABELS,
  reconcileQueueWithSuccessfulImport,
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

test('uses friendly names for release gates while preserving technical identifiers', () => {
  assert.deepEqual(RECAP_RELEASE_GATE_LABELS.gateF, {
    label: 'Validação do capítulo',
    shortLabel: 'Validação',
    technicalLabel: 'Gate F',
  });
  assert.equal(RECAP_PIPELINE_STAGES.find((stage) => stage.id === 'gate-f')?.label, 'Validação do capítulo');
  assert.equal(RECAP_PIPELINE_STAGES.find((stage) => stage.id === 'script')?.label, 'Fidelidade do roteiro');
  assert.equal(RECAP_PIPELINE_STAGES.find((stage) => stage.id === 'gate-h')?.label, 'Qualidade audiovisual');
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

  const pausedByBudget = derivePipelineTimeline(
    makeRecord({
      state: 'paused_budget',
      currentStage: 'vision',
      completedSteps: ['import', 'gate-f', 'preflight'],
      lastError: 'tempo máximo do job atingido',
    }),
  );
  assert.equal(pausedByBudget.stateLabel, 'Pausado (orçamento atingido)');
  assert.equal(pausedByBudget.tone, 'warning');
  assert.equal(pausedByBudget.stages.find((s) => s.id === 'vision')?.status, 'paused');

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
  assert.equal(getStateMetadata('paused_budget').label, 'Pausado (orçamento atingido)');
  assert.equal(getStateMetadata('completed').tone, 'success');
});

test('Synchronization across Import, Queue, Project History, and Workflow Steps (Failed attempt followed by 24/24 CBZ success)', () => {
  // 1. Initial failed attempt: job item failed with Cloudflare 403, historical record failed at import
  const failedRecord = makeRecord({
    runId: 'run-failed-1',
    workTitle: 'Nano Machine Cap. 1',
    state: 'failed',
    currentStage: 'import',
    completedSteps: [],
    lastError: 'Bloqueio Cloudflare / HTTP 403',
  });

  const failedQueueJob = {
    id: 'imp-1',
    status: 'failed',
    blockedByProtection: true,
    blockedUrl: 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1',
    items: [
      {
        url: 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1',
        status: 'failed',
        pagesDone: 0,
        pagesTotal: 0,
        error: 'Bloqueio Cloudflare / HTTP 403',
        blockedByProtection: true,
      },
    ],
  };

  // While failed and no valid CBZ exists yet: Capítulos is 'error', Narração is 'pending'
  const stepsWhileFailed = deriveWorkflowSteps({
    hasSeriesOrProject: true,
    hasChapterSource: false,
    chapterArchiveValidated: false,
    hasActiveImportError: true,
    isProducing: false,
    record: failedRecord,
    sceneCount: 0,
    hasLowConfidenceScenes: false,
    hasAudiovisualPlan: false,
    hasRenderedVideo: false,
  });
  assert.equal(stepsWhileFailed.find((s) => s.id === 'capitulos')?.status, 'error');
  assert.equal(stepsWhileFailed.find((s) => s.id === 'narracao')?.status, 'pending');

  // 2. Subsequent successful import (24/24 pages CBZ generated via Interactive Persistent Browser)
  const reconciledJob = reconcileQueueWithSuccessfulImport(failedQueueJob, [
    {
      cbzPath: 'C:\\Users\\Pheli\\AppData\\Roaming\\AetheraStudio\\recap-library\\nano-machine\\cap-1.cbz',
      pageCount: 24,
      sourceUrl: 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1',
      workTitle: 'Nano Machine',
      chapterNumber: '1',
    },
  ]);

  assert.ok(reconciledJob);
  assert.equal(reconciledJob.status, 'completed');
  assert.equal(reconciledJob.blockedByProtection, false);
  assert.equal(reconciledJob.items[0]?.status, 'completed');
  assert.equal(reconciledJob.items[0]?.error, undefined);
  assert.equal(reconciledJob.items[0]?.pagesDone, 24);
  assert.equal(reconciledJob.items[0]?.pagesTotal, 24);

  // Queue item display status for 'completed' and 'skipped_existing' MUST show "Importado (24/24 págs)", NEVER "Na fila"
  const completedItemDisplay = deriveQueueItemDisplayStatus(reconciledJob.items[0]!, reconciledJob.status);
  assert.equal(completedItemDisplay.isDone, true);
  assert.equal(completedItemDisplay.pct, 100);
  assert.equal(completedItemDisplay.statusLabel, 'Importado (24/24 págs)');

  const skippedExistingDisplay = deriveQueueItemDisplayStatus(
    {
      url: 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1',
      status: 'skipped_existing',
      pagesDone: 24,
      pagesTotal: 24,
      libraryEntry: {
        cbzPath: 'C:\\Users\\Pheli\\AppData\\Roaming\\AetheraStudio\\recap-library\\nano-machine\\cap-1.cbz',
        pageCount: 24,
      },
    },
    'completed',
  );
  assert.equal(skippedExistingDisplay.isDone, true);
  assert.equal(skippedExistingDisplay.statusLabel, 'Importado (24/24 págs)');

  // 3. Workflow steps after validated CBZ import:
  // - Capítulos MUST be 'ready' ("Pronta"), even if the old failedRecord were still passed!
  // - Análise (03), Roteiro (04), and Narração (05) MUST all be 'pending' ("Pendente")!
  const stepsAfterValidImport = deriveWorkflowSteps({
    hasSeriesOrProject: true,
    hasChapterSource: true,
    chapterArchiveValidated: true,
    hasActiveImportError: false,
    isProducing: false,
    record: failedRecord,
    sceneCount: 0,
    hasLowConfidenceScenes: false,
    hasAudiovisualPlan: false,
    hasRenderedVideo: false,
  });

  assert.equal(stepsAfterValidImport.find((s) => s.id === 'projeto')?.status, 'ready');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'capitulos')?.status, 'ready');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'analise')?.status, 'pending');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'roteiro')?.status, 'pending');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'narracao')?.status, 'pending');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'storyboard')?.status, 'pending');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'producao')?.status, 'pending');
  assert.equal(stepsAfterValidImport.find((s) => s.id === 'revisao')?.status, 'pending');

  // 4. Separated Import vs Production status keeps the old failure as historical and reports current import as validated
  const separated = deriveSeparatedImportAndProductionStatus({
    hasChapterSource: true,
    chapterArchiveValidated: true,
    archivePageCount: 24,
    isImportingChapter: false,
    importError: null,
    isProducing: false,
    activeProject: failedRecord,
    sceneCount: 0,
  });
  assert.equal(separated.importStatus.state, 'validated');
  assert.equal(separated.importStatus.tone, 'success');
  assert.equal(separated.productionStatus.state, 'ready_to_start');
  assert.equal(separated.isHistoricalFailedRecord, true);

  const pausedByBudget = deriveSeparatedImportAndProductionStatus({
    hasChapterSource: true,
    chapterArchiveValidated: true,
    archivePageCount: 24,
    isImportingChapter: false,
    importError: null,
    isProducing: false,
    activeProject: makeRecord({ state: 'paused_budget', currentStage: 'vision', completedSteps: ['import', 'gate-f'] }),
    sceneCount: 0,
  });
  assert.equal(pausedByBudget.productionStatus.state, 'paused');
  assert.equal(pausedByBudget.productionStatus.tone, 'warning');

  // 5. If CBZ integrity check fails (missing/corrupted on disk), Capítulos becomes 'error' and blocks ready state
  const stepsCorruptedCbz = deriveWorkflowSteps({
    hasSeriesOrProject: true,
    hasChapterSource: true,
    chapterArchiveValidated: false,
    isProducing: false,
    record: null,
    sceneCount: 0,
    hasLowConfidenceScenes: false,
    hasAudiovisualPlan: false,
    hasRenderedVideo: false,
  });
  assert.equal(stepsCorruptedCbz.find((s) => s.id === 'capitulos')?.status, 'error');

  // 6. Narração only becomes 'ready' when valid scenes and narration/audiovisual artifacts exist
  const stepsWithRealNarration = deriveWorkflowSteps({
    hasSeriesOrProject: true,
    hasChapterSource: true,
    chapterArchiveValidated: true,
    isProducing: false,
    record: makeRecord({
      state: 'awaiting_preview_approval',
      completedSteps: ['import', 'gate-f', 'vision', 'continuity', 'script', 'humanize', 'motion', 'gate-h'],
      gateFVerdict: 'pass',
      gateGVerdict: 'pass',
      gateHVerdict: 'pass',
    }),
    sceneCount: 6,
    hasLowConfidenceScenes: false,
    hasValidNarrationArtifacts: true,
    gateGVerdict: 'pass',
    gateHVerdict: 'pass',
    hasAudiovisualPlan: true,
    hasRenderedVideo: true,
  });
  assert.equal(stepsWithRealNarration.find((s) => s.id === 'analise')?.status, 'ready');
  assert.equal(stepsWithRealNarration.find((s) => s.id === 'roteiro')?.status, 'ready');
  assert.equal(stepsWithRealNarration.find((s) => s.id === 'narracao')?.status, 'ready');
  assert.equal(stepsWithRealNarration.find((s) => s.id === 'storyboard')?.status, 'ready');
});
