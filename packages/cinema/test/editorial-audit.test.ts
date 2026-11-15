import { describe, expect, it } from 'vitest';
import {
  buildEditorialScript,
  buildEditorialTraceabilityGraph,
  buildSemanticDecupagem,
  interpretProductionPrompt,
  runEditorialIntegrityChecks,
  type EditorialResearchDossier,
} from '../src/index.js';

describe('Editorial Audit & Traceability Chain', () => {
  const PROMPT = 'Crie um vídeo sobre os 2 chefes mais difíceis de Elden Ring em 3 minutos.';
  const interpretation = interpretProductionPrompt(PROMPT);

  const dossier: EditorialResearchDossier = {
    dossierId: 'dossier_test_er',
    dossierHash: 'h_er_2',
    promptHash: interpretation.promptHash,
    workTitle: 'Elden Ring',
    theme: 'Top 2 chefes mais difíceis',
    rankingCriteria: ['Complexidade mecânica'],
    entities: [
      {
        entityName: 'Malenia, Blade of Miquella',
        workTitle: 'Elden Ring',
        role: 'boss',
        rankPosition: 1,
        verifiedFacts: ['Chefe opcional em Elphael.'],
        mechanicsOrEvents: ['Waterfowl Dance', 'Scarlet Aeonia'],
        uncertainties: [],
        sources: [{ title: 'Elden Ring Wiki', kind: 'community', url: 'https://eldenring.wiki.fextralife.com/Malenia' }],
      },
      {
        entityName: 'Promised Consort Radahn',
        workTitle: 'Elden Ring',
        role: 'boss',
        rankPosition: 2,
        verifiedFacts: ['Chefe final de Shadow of the Erdtree.'],
        mechanicsOrEvents: ['Cross-slash combo', 'Light of Miquella'],
        uncertainties: [],
        sources: [{ title: 'FromSoftware Patch Notes', kind: 'official' }],
      },
    ],
    uncertainties: [],
    sourcesUsed: ['Elden Ring Wiki', 'FromSoftware Patch Notes'],
    createdAt: '2026-11-14T21:00:00.000Z',
  };

  it('builds explicit traceability links and passes integrity checks when evidence is valid', () => {
    const script = buildEditorialScript({
      scriptId: 'scr_er_2',
      source: 'agent',
      treatment: 'Top 2 Elden Ring',
      academyRulesApplied: [],
      segments: [
        {
          segmentId: 'seg_1',
          beatId: 'b_1',
          stage: 'progression',
          title: '#2 Radahn',
          spokenText: 'Promised Consort Radahn domina com combos de gravidade e luz.',
          estimatedDurationSec: 90,
          approved: true,
        },
        {
          segmentId: 'seg_2',
          beatId: 'b_2',
          stage: 'climax',
          title: '#1 Malenia',
          spokenText: 'Malenia, Blade of Miquella pune qualquer erro com Waterfowl Dance.',
          estimatedDurationSec: 90,
          approved: true,
        },
      ],
    });

    const decupagem = buildSemanticDecupagem(script, dossier, interpretation);
    const trail = buildEditorialTraceabilityGraph({
      projectId: 'proj_audit_1',
      dossier,
      script,
      decupagem,
    });

    expect(trail.sources).toHaveLength(2);
    expect(trail.facts.length).toBeGreaterThanOrEqual(4);
    expect(trail.scriptBlocks).toHaveLength(2);
    expect(trail.scenes).toHaveLength(2);
    expect(trail.scenes[0]!.scriptBlockId).toBe(trail.scriptBlocks[0]!.blockId);
    expect(trail.scenes[1]!.factIds.length).toBeGreaterThan(0);

    // Simulate executed queries, candidates, grounding evidences, and placements
    for (const sc of trail.scenes) {
      const qId = `qry_${sc.sceneId}`;
      const cId = `cand_${sc.sceneId}`;
      const evId = `ev_${sc.sceneId}`;
      trail.queries.push({
        queryId: qId,
        sceneId: sc.sceneId,
        scriptBlockId: sc.scriptBlockId,
        narrationExcerpt: sc.narrationText,
        queryText: sc.mediaQueries[0]!,
        provider: 'yt_dlp',
        attemptNumber: 1,
        startedAt: '2026-11-14T21:01:00.000Z',
        finishedAt: '2026-11-14T21:01:02.000Z',
        durationMs: 2000,
        status: 'success',
        resultsCount: 1,
        candidateIds: [cId],
        isPlannedOnly: false,
      });
      trail.candidates.push({
        candidateId: cId,
        queryId: qId,
        sceneId: sc.sceneId,
        title: `${sc.entities[0]} boss fight`,
        url: 'https://example.com/boss.mp4',
        provider: 'yt_dlp',
        durationSec: sc.durationSec,
        status: 'approved',
      });
      trail.groundingEvidences.push({
        evidenceId: evId,
        candidateId: cId,
        sceneId: sc.sceneId,
        scriptBlockId: sc.scriptBlockId,
        expectedWork: sc.workTitle,
        expectedEvent: sc.expectedEvent,
        framesAnalyzed: [{ timestampSec: 4, summary: 'Boss combat confirmed', matchedEntities: sc.entities, matchedActions: [sc.expectedEvent], isPositive: true }],
        positiveEvidences: ['Visual match confirmed'],
        negativeEvidences: [],
        confidence: 0.88,
        approvedIntervals: [{ startSec: 0, endSec: sc.durationSec, reason: 'Confirmed' }],
        rejectedIntervals: [],
        decision: 'approved',
        decisionReason: 'Confirmed by frame analysis',
        narrationRelation: sc.narrationText,
        humanReview: { status: 'pending' },
      });
      trail.timelinePlacements.push({
        placementId: `pl_${sc.sceneId}`,
        sceneId: sc.sceneId,
        candidateId: cId,
        evidenceId: evId,
        clipId: `clip_${sc.sceneId}`,
        startSec: 0,
        endSec: sc.durationSec,
        durationSec: sc.durationSec,
        placementHash: 'abc123',
      });
    }

    const report = runEditorialIntegrityChecks({ interpretation, dossier, trail });
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it('allows repeated boss scenes with distinct events and flags integrity violations', () => {
    const script = buildEditorialScript({
      scriptId: 'scr_er_bad',
      source: 'agent',
      treatment: 'Test integrity checks',
      academyRulesApplied: [],
      segments: [
        {
          segmentId: 'seg_1',
          beatId: 'b_1',
          stage: 'progression',
          title: 'Malenia Phase 1',
          spokenText: 'Malenia usa Waterfowl Dance na primeira fase.',
          estimatedDurationSec: 60,
          approved: true,
        },
        {
          segmentId: 'seg_2',
          beatId: 'b_2',
          stage: 'climax',
          title: 'Malenia Phase 2',
          spokenText: 'Malenia libera Scarlet Aeonia na segunda fase.',
          estimatedDurationSec: 60,
          approved: true,
        },
      ],
    });

    const decupagem = buildSemanticDecupagem(script, dossier, interpretation);
    // Distinct events for Malenia
    decupagem[0]!.expectedEvent = 'Waterfowl Dance';
    decupagem[1]!.expectedEvent = 'Scarlet Aeonia';

    const trail = buildEditorialTraceabilityGraph({
      projectId: 'proj_audit_2',
      dossier,
      script,
      decupagem,
    });

    // Inject full-prompt query and approved candidate without visual evidence
    trail.queries.push({
      queryId: 'q_bad',
      sceneId: trail.scenes[0]!.sceneId,
      scriptBlockId: trail.scenes[0]!.scriptBlockId,
      narrationExcerpt: trail.scenes[0]!.narrationText,
      queryText: PROMPT,
      provider: 'yt_dlp',
      attemptNumber: 1,
      startedAt: '2026-11-14T21:01:00.000Z',
      status: 'success',
      resultsCount: 1,
      candidateIds: ['c_no_ev'],
      isPlannedOnly: false,
    });
    trail.candidates.push({
      candidateId: 'c_no_ev',
      queryId: 'q_bad',
      sceneId: trail.scenes[0]!.sceneId,
      title: 'Unverified clip',
      url: 'https://example.com/unverified.mp4',
      provider: 'yt_dlp',
      status: 'approved',
    });

    const report = runEditorialIntegrityChecks({ interpretation, dossier, trail });
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.code === 'query_contains_full_prompt')).toBe(true);
    expect(report.issues.some((i) => i.code === 'approved_media_without_visual_evidence')).toBe(true);
    expect(report.issues.some((i) => i.code === 'boss_repetition_without_justification')).toBe(false);
  });
});
