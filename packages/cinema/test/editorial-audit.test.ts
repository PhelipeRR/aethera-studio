import { describe, expect, it } from 'vitest';
import {
  buildEditorialScript,
  buildEditorialTraceabilityGraph,
  buildSemanticDecupagem,
  interpretProductionPrompt,
  repairSemanticDecupagem,
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
    expect(report.issues.find((i) => i.code === 'query_contains_full_prompt')?.category).toBe('traceability');
    expect(report.issues.find((i) => i.code === 'approved_media_without_visual_evidence')?.category).toBe('identity');
    expect(report.issues.some((i) => i.code === 'boss_repetition_without_justification')).toBe(false);
  });

  it('Cyberpunk 2077 cyberware upgrades: classifies semantic intents, avoids boss_fight templates & entity recycling, and isolates from prior Elden Ring run', () => {
    const erInterp = interpretProductionPrompt('Crie um vídeo sobre os 2 chefes mais difíceis de Elden Ring em 3 minutos.');
    expect(erInterp.domain).toBe('gaming');

    const cpPrompt = 'Crie um vídeo cinematográfico sobre os 4 melhores upgrades de cibernética de Cyberpunk 2077 em 5 minutos.';
    const cpInterp = interpretProductionPrompt(cpPrompt);
    expect(cpInterp.workTitle).toBe('Cyberpunk 2077');
    expect(cpInterp.requestedCount).toBe(4);
    expect(cpInterp.rankingCriteria.join(' ').toLowerCase()).not.toContain('ataque');

    const cpDossier: EditorialResearchDossier = {
      dossierId: 'dossier_cp_4',
      dossierHash: 'h_cp_4',
      promptHash: cpInterp.promptHash,
      workTitle: 'Cyberpunk 2077',
      theme: 'Melhores upgrades de cibernética',
      rankingCriteria: cpInterp.rankingCriteria,
      entities: [
        {
          entityName: 'Sandevistan',
          workTitle: 'Cyberpunk 2077',
          role: 'cyberware',
          rankPosition: 1,
          verifiedFacts: ['Desacelera a percepção de tempo em combate e deslocamento.'],
          mechanicsOrEvents: ['Time dilation sprint e reflexos acelerados'],
          uncertainties: [],
          sources: [{ title: 'Cyberpunk Wiki', kind: 'community' }],
        },
        {
          entityName: 'Optical Camo',
          workTitle: 'Cyberpunk 2077',
          role: 'cyberware',
          rankPosition: 2,
          verifiedFacts: ['Torna V quase invisível temporariamente para infiltração furtiva.'],
          mechanicsOrEvents: ['Camuflagem óptica furtiva'],
          uncertainties: [],
          sources: [{ title: 'Cyberpunk Wiki', kind: 'community' }],
        },
        {
          entityName: 'Projectile Launch System',
          workTitle: 'Cyberpunk 2077',
          role: 'cyberware',
          rankPosition: 3,
          verifiedFacts: ['Lança projéteis explosivos diretamente do antebraço.'],
          mechanicsOrEvents: ['Disparo explosivo do sistema de braço'],
          uncertainties: [],
          sources: [{ title: 'Cyberpunk Wiki', kind: 'community' }],
        },
        {
          entityName: 'Mantis Blades',
          workTitle: 'Cyberpunk 2077',
          role: 'cyberware',
          rankPosition: 4,
          verifiedFacts: ['Lâminas retráteis para ataques corpo a corpo rápidos.'],
          mechanicsOrEvents: ['Investida com Lâminas Louva-a-Deus'],
          uncertainties: [],
          sources: [{ title: 'Cyberpunk Wiki', kind: 'community' }],
        },
      ],
      uncertainties: [],
      sourcesUsed: ['Cyberpunk Wiki'],
      createdAt: '2026-11-15T00:00:00.000Z',
    };

    const cpScript = buildEditorialScript({
      scriptId: 'scr_cp_4',
      dossierHash: cpDossier.dossierHash,
      topic: cpPrompt,
      targetDurationSec: 300,
      segments: [
        { segmentId: 'seg_1', beatId: 'b1', stage: 'hook', title: 'Abertura Night City', spokenText: 'Night City recompensa quem domina os implantes certos.', estimatedDurationSec: 40 },
        { segmentId: 'seg_2', beatId: 'b2', stage: 'progression', title: '#4 Lâminas Louva-a-Deus', spokenText: 'As Lâminas Louva-a-Deus transformam o combate corpo a corpo com cortes velozes.', estimatedDurationSec: 60 },
        { segmentId: 'seg_3', beatId: 'b3', stage: 'progression', title: '#3 Sistema de Lançamento de Projéteis', spokenText: 'O sistema de lançamento de projéteis traz poder explosivo imediato no braço.', estimatedDurationSec: 60 },
        { segmentId: 'seg_4', beatId: 'b4', stage: 'progression', title: '#2 Camuflagem Óptica', spokenText: 'Com a Camuflagem Óptica você desaparece na infiltração furtiva sem disparar alarmes.', estimatedDurationSec: 60 },
        { segmentId: 'seg_5', beatId: 'b5', stage: 'climax', title: '#1 Sandevistan', spokenText: 'O Sandevistan acelera seus reflexos e desacelera o tempo ao redor.', estimatedDurationSec: 50 },
        { segmentId: 'seg_6', beatId: 'b6', stage: 'cta', title: 'Conclusão', spokenText: 'Qual desses implantes é indispensável na sua build em Night City?', estimatedDurationSec: 30 },
      ],
    });

    const cuts = buildSemanticDecupagem(cpScript, cpDossier, cpInterp);
    expect(cuts).toHaveLength(6);
    expect(cuts[0]!.visualIntent).toBe('cinematic_intro');
    expect(cuts[0]!.entities).toEqual([]);
    expect(cuts[1]!.entities).toEqual(['Mantis Blades']);
    expect(cuts[1]!.visualIntent).toBe('cyberware_demonstration');
    expect(cuts[2]!.entities).toEqual(['Projectile Launch System']);
    expect(cuts[2]!.visualIntent).toBe('cyberware_demonstration');
    expect(cuts[3]!.entities).toEqual(['Optical Camo']);
    expect(cuts[3]!.visualIntent).toBe('stealth_demonstration');
    expect(cuts[4]!.entities).toEqual(['Sandevistan']);
    expect(cuts[4]!.visualIntent).toBe('mobility_demonstration');
    expect(cuts[5]!.visualIntent).toBe('cinematic_outro');
    expect(cuts[5]!.entities).toEqual([]);

    for (const c of cuts) {
      expect(c.visualIntent).not.toBe('gameplay_boss_fight');
      expect(c.mediaQueries.join(' ').toLowerCase()).not.toContain('boss fight');
      expect(c.mediaQueries.join(' ').toLowerCase()).not.toContain('phase 2');
      expect(c.startSec).toBeTypeOf('number');
      expect(c.endSec).toBeGreaterThan(c.startSec!);
    }

    const trail = buildEditorialTraceabilityGraph({
      projectId: 'proj_cp',
      dossier: cpDossier,
      script: cpScript,
      decupagem: cuts,
    });
    const report = runEditorialIntegrityChecks({ interpretation: cpInterp, dossier: cpDossier, trail });
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('supports technology and documentary domains without gaming/boss assumptions', () => {
    const techPrompt = 'Crie um vídeo de tecnologia comparando os 2 melhores notebooks Apple MacBook Pro M4 e Dell XPS em 3 minutos.';
    const techInterp = interpretProductionPrompt(techPrompt);
    expect(techInterp.domain).toBe('technology');

    const techDossier: EditorialResearchDossier = {
      dossierId: 'd_tech',
      dossierHash: 'h_tech',
      promptHash: techInterp.promptHash,
      workTitle: 'Apple MacBook Pro M4',
      theme: 'Comparativo de notebooks',
      rankingCriteria: techInterp.rankingCriteria,
      entities: [
        {
          entityName: 'MacBook Pro M4',
          workTitle: 'Apple MacBook Pro M4',
          role: 'product',
          verifiedFacts: ['Chip M4 com alta eficiência energética.'],
          mechanicsOrEvents: ['Benchmark de renderização e bateria'],
          uncertainties: [],
          sources: [{ title: 'Apple Specs', kind: 'official' }],
        },
      ],
      uncertainties: [],
      sourcesUsed: ['Apple Specs'],
      createdAt: '2026-11-15T00:00:00.000Z',
    };
    const techScript = buildEditorialScript({
      scriptId: 'scr_tech',
      dossierHash: techDossier.dossierHash,
      topic: techPrompt,
      targetDurationSec: 180,
      segments: [
        { segmentId: 't1', beatId: 'b1', stage: 'progression', title: 'MacBook Pro M4 Benchmark', spokenText: 'Nos testes de benchmark e desempenho, o MacBook Pro M4 entrega bateria o dia todo.', estimatedDurationSec: 180 },
      ],
    });
    const techCuts = buildSemanticDecupagem(techScript, techDossier, techInterp);
    expect(techCuts[0]!.visualIntent).toBe('hardware_benchmark');
    expect(techCuts[0]!.mediaQueries.join(' ').toLowerCase()).not.toContain('boss');

    const docPrompt = 'Documentário sobre a história da missão Apollo 11 na ciência espacial em 4 minutos.';
    const docInterp = interpretProductionPrompt(docPrompt);
    expect(docInterp.domain).toBe('documentary');
    const docDossier: EditorialResearchDossier = {
      dossierId: 'd_doc',
      dossierHash: 'h_doc',
      promptHash: docInterp.promptHash,
      workTitle: 'Apollo 11',
      theme: 'História da Apollo 11',
      rankingCriteria: docInterp.rankingCriteria,
      entities: [
        {
          entityName: 'Saturn V',
          workTitle: 'Apollo 11',
          role: 'historical_vehicle',
          verifiedFacts: ['Foguete lançador da missão lunar de 1969.'],
          mechanicsOrEvents: ['Lançamento histórico de arquivo em 1969'],
          uncertainties: [],
          sources: [{ title: 'NASA Archive', kind: 'official' }],
        },
      ],
      uncertainties: [],
      sourcesUsed: ['NASA Archive'],
      createdAt: '2026-11-15T00:00:00.000Z',
    };
    const docScript = buildEditorialScript({
      scriptId: 'scr_doc',
      dossierHash: docDossier.dossierHash,
      topic: docPrompt,
      targetDurationSec: 240,
      segments: [
        { segmentId: 'd1', beatId: 'b1', stage: 'progression', title: 'O Foguete Saturn V', spokenText: 'O registro histórico do foguete Saturn V marcou a década de 1960.', estimatedDurationSec: 240 },
      ],
    });
    const docCuts = buildSemanticDecupagem(docScript, docDossier, docInterp);
    expect(docCuts[0]!.visualIntent).toBe('archival_footage');
    expect(docCuts[0]!.mediaQueries[0]!.toLowerCase()).toContain('archival footage');
  });

  it('repairSemanticDecupagem fixes contaminated scenes with bounded attempts without altering healthy scenes', () => {
    const cpPrompt = 'Crie um vídeo sobre os 2 melhores upgrades de Cyberpunk 2077 em 3 minutos.';
    const cpInterp = interpretProductionPrompt(cpPrompt);
    const cpDossier: EditorialResearchDossier = {
      dossierId: 'd_rep',
      dossierHash: 'h_rep',
      promptHash: cpInterp.promptHash,
      workTitle: 'Cyberpunk 2077',
      theme: 'Upgrades',
      rankingCriteria: cpInterp.rankingCriteria,
      entities: [
        {
          entityName: 'Optical Camo',
          workTitle: 'Cyberpunk 2077',
          role: 'cyberware',
          verifiedFacts: ['Invisibilidade tática.'],
          mechanicsOrEvents: ['Stealth infiltration'],
          uncertainties: [],
          sources: [{ title: 'Wiki', kind: 'community' }],
        },
      ],
      uncertainties: [],
      sourcesUsed: ['Wiki'],
      createdAt: '2026-11-15T00:00:00.000Z',
    };
    const cpScript = buildEditorialScript({
      scriptId: 'scr_rep',
      dossierHash: cpDossier.dossierHash,
      topic: cpPrompt,
      targetDurationSec: 180,
      segments: [
        { segmentId: 's1', beatId: 'b1', stage: 'progression', title: 'Camuflagem Óptica', spokenText: 'A Optical Camo garante stealth completo.', estimatedDurationSec: 180 },
      ],
    });
    const clean = buildSemanticDecupagem(cpScript, cpDossier, cpInterp);
    const contaminated = [
      {
        ...clean[0]!,
        visualIntent: 'gameplay_boss_fight' as const,
        mediaQueries: ['Cyberpunk 2077 Optical Camo boss fight no commentary'],
      },
    ];
    const repaired = repairSemanticDecupagem({
      projectId: 'p_rep',
      script: cpScript,
      dossier: cpDossier,
      interpretation: cpInterp,
      decupagem: contaminated,
      maxAttempts: 2,
    });
    expect(repaired.attempts).toBe(1);
    expect(repaired.repairedSceneIds.length).toBe(1);
    expect(repaired.decupagem[0]!.visualIntent).toBe('stealth_demonstration');
    expect(repaired.decupagem[0]!.mediaQueries.join(' ').toLowerCase()).not.toContain('boss fight');
    expect(repaired.report.issues.some((i) => i.code === 'incompatible_visual_intent')).toBe(false);
  });

  it('traces a contextual reference work separately from ranked entities', () => {
    const prompt = 'TOP 5 animes com sistemas de magia incríveis para quem gostou de Black Clover';
    const interpretation = interpretProductionPrompt(prompt);
    const referenceDossier: EditorialResearchDossier = {
      dossierId: 'd_reference_work',
      dossierHash: 'h_reference_work',
      promptHash: interpretation.promptHash,
      workTitle: interpretation.workTitle,
      theme: 'Sistemas de magia',
      rankingCriteria: ['Criatividade'],
      entities: [
        {
          entityName: 'Mashle',
          workTitle: 'Mashle',
          role: 'anime',
          rankPosition: 1,
          verifiedFacts: ['Uma obra de fantasia com magia.'],
          mechanicsOrEvents: ['Conflito entre força física e magia.'],
          uncertainties: [],
          sources: [{ title: 'Mashle source', kind: 'community' }],
        },
      ],
      uncertainties: [],
      sourcesUsed: ['Mashle source'],
      createdAt: '2026-11-16T00:00:00.000Z',
    };
    const script = buildEditorialScript({
      scriptId: 'scr_reference_work',
      source: 'agent',
      treatment: prompt,
      academyRulesApplied: [],
      segments: [
        {
          segmentId: 'seg_reference',
          beatId: 'beat_reference',
          stage: 'hook',
          title: 'Para quem gostou de Black Clover',
          spokenText: 'Se você gostou de Black Clover, esta lista apresenta outros animes com magia criativa.',
          estimatedDurationSec: 12,
          approved: true,
        },
      ],
    });
    const scenes = buildSemanticDecupagem(script, referenceDossier, interpretation);
    const trail = buildEditorialTraceabilityGraph({
      projectId: 'project_reference_work',
      dossier: referenceDossier,
      script,
      decupagem: scenes,
    });
    const report = runEditorialIntegrityChecks({ interpretation, dossier: referenceDossier, trail });

    expect(trail.scenes[0]?.subjectResolution).toBe('reference');
    expect(trail.scenes[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(trail.sources.some((source) => source.scope === 'contextual_reference' && source.title.includes('Black Clover'))).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'entity_missing_in_dossier')).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'entity_narration_divergence')).toBe(false);
  });
});
