import { createHash } from 'node:crypto';
import type { EditorialScript } from './editorial-integrity.js';
import type {
  EditorialResearchDossier,
  PromptInterpretation,
  SemanticSceneCut,
} from './research-and-decupagem.js';
import {
  buildSemanticDecupagem,
  doesNarrationMatchEntity,
} from './research-and-decupagem.js';

function sha12(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

export interface ResearchSource {
  sourceId: string;
  dossierId: string;
  title: string;
  kind: 'official' | 'community' | 'agent_synthesis';
  url?: string;
  versionHash: string;
}

export interface ResearchFact {
  factId: string;
  dossierId: string;
  sourceIds: string[];
  entityName: string;
  rankPosition?: number;
  factKind: 'verified_fact' | 'mechanic_or_event' | 'attack_pattern';
  statement: string;
  uncertainty?: string;
  versionHash: string;
}

export interface ScriptBlock {
  blockId: string;
  scriptId: string;
  segmentId: string;
  beatId: string;
  stage: string;
  title: string;
  narrationText: string;
  estimatedDurationSec: number;
  sourceFactIds: string[];
  sourceIds: string[];
  versionHash: string;
}

export interface MediaQueryRecord {
  queryId: string;
  sceneId: string;
  scriptBlockId: string;
  narrationExcerpt: string;
  queryText: string;
  reformulatedFromQueryId?: string;
  provider: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'success' | 'empty' | 'error' | 'timeout';
  errorMessage?: string;
  resultsCount: number;
  candidateIds: string[];
  isPlannedOnly: false;
}

export interface MediaCandidateRecord {
  candidateId: string;
  queryId: string;
  sceneId: string;
  title: string;
  url: string;
  localUri?: string;
  provider: string;
  durationSec?: number;
  metadata?: Record<string, unknown>;
  status: 'approved' | 'rejected' | 'pending' | 'download_failed';
  rejectionReason?: string;
}

export interface GroundingFrameEvidence {
  timestampSec: number;
  framePath?: string;
  summary: string;
  matchedEntities: string[];
  matchedActions: string[];
  isPositive: boolean;
}

export interface GroundingIntervalDecision {
  startSec: number;
  endSec: number;
  reason: string;
}

export interface GroundingEvidenceRecord {
  evidenceId: string;
  candidateId: string;
  sceneId: string;
  scriptBlockId: string;
  expectedWork: string;
  expectedEvent: string;
  framesAnalyzed: GroundingFrameEvidence[];
  positiveEvidences: string[];
  negativeEvidences: string[];
  confidence: number;
  approvedIntervals: GroundingIntervalDecision[];
  rejectedIntervals: GroundingIntervalDecision[];
  decision: 'approved' | 'rejected' | 'needs_review';
  decisionReason: string;
  narrationRelation: string;
  humanReview: {
    status: 'pending' | 'approved' | 'rejected';
    reviewerNote?: string;
    reviewedAt?: string;
  };
}

export interface TimelinePlacementRecord {
  placementId: string;
  sceneId: string;
  candidateId: string;
  evidenceId: string;
  clipId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  placementHash: string;
}

export type EditorialIntegrityCheckCode =
  | 'query_contains_full_prompt'
  | 'scene_without_script_link'
  | 'entity_missing_in_dossier'
  | 'entity_narration_divergence'
  | 'incompatible_visual_intent'
  | 'boss_repetition_without_justification'
  | 'ranking_count_mismatch'
  | 'narration_media_divergence'
  | 'approved_media_without_visual_evidence'
  | 'scene_insufficient_coverage';

export interface EditorialIntegrityIssue {
  code: EditorialIntegrityCheckCode;
  severity: 'error' | 'warning';
  sceneId?: string;
  queryId?: string;
  candidateId?: string;
  message: string;
}

export interface EditorialIntegrityReport {
  checkedAt: string;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: EditorialIntegrityIssue[];
}

export interface EditorialAuditEvent {
  eventId: string;
  timestamp: string;
  stage: 'pesquisa' | 'roteiro' | 'decupagem' | 'aquisicao' | 'validacao_visual' | 'timeline' | 'human_review' | 'integridade';
  sceneId?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface EditorialAuditTrail {
  version: number;
  projectId: string;
  sources: ResearchSource[];
  facts: ResearchFact[];
  scriptBlocks: ScriptBlock[];
  scenes: Array<SemanticSceneCut & { scriptBlockId: string; factIds: string[]; sourceIds: string[] }>;
  queries: MediaQueryRecord[];
  candidates: MediaCandidateRecord[];
  groundingEvidences: GroundingEvidenceRecord[];
  timelinePlacements: TimelinePlacementRecord[];
  events: EditorialAuditEvent[];
  integrityReport?: EditorialIntegrityReport;
}

export function createEmptyEditorialAuditTrail(projectId: string): EditorialAuditTrail {
  return {
    version: 1,
    projectId,
    sources: [],
    facts: [],
    scriptBlocks: [],
    scenes: [],
    queries: [],
    candidates: [],
    groundingEvidences: [],
    timelinePlacements: [],
    events: [],
  };
}

export function buildEditorialTraceabilityGraph(input: {
  projectId: string;
  dossier: EditorialResearchDossier;
  script: EditorialScript;
  decupagem: SemanticSceneCut[];
  previousTrail?: EditorialAuditTrail;
}): EditorialAuditTrail {
  const trail = input.previousTrail
    ? { ...input.previousTrail }
    : createEmptyEditorialAuditTrail(input.projectId);

  const sourceMap = new Map<string, ResearchSource>();
  const facts: ResearchFact[] = [];
  const entityFactIds = new Map<string, string[]>();
  const entitySourceIds = new Map<string, string[]>();

  for (const ent of input.dossier.entities) {
    const entSourceIds: string[] = [];
    for (const src of ent.sources) {
      const sourceId = `src_${sha12({ dossierId: input.dossier.dossierId, title: src.title, url: src.url ?? '' })}`;
      if (!sourceMap.has(sourceId)) {
        sourceMap.set(sourceId, {
          sourceId,
          dossierId: input.dossier.dossierId,
          title: src.title,
          kind: src.kind,
          ...(src.url ? { url: src.url } : {}),
          versionHash: sha12({ sourceId, title: src.title, kind: src.kind, url: src.url ?? '' }),
        });
      }
      entSourceIds.push(sourceId);
    }
    entitySourceIds.set(ent.entityName, [...new Set(entSourceIds)]);

    const factIdsForEntity: string[] = [];
    const addFact = (factKind: ResearchFact['factKind'], statement: string) => {
      const factId = `fact_${sha12({ dossierId: input.dossier.dossierId, entityName: ent.entityName, factKind, statement })}`;
      factIdsForEntity.push(factId);
      facts.push({
        factId,
        dossierId: input.dossier.dossierId,
        sourceIds: [...new Set(entSourceIds)],
        entityName: ent.entityName,
        ...(ent.rankPosition !== undefined ? { rankPosition: ent.rankPosition } : {}),
        factKind,
        statement,
        ...(ent.uncertainties[0] ? { uncertainty: ent.uncertainties[0] } : {}),
        versionHash: sha12({ factId, statement, entSourceIds }),
      });
    };

    for (const f of ent.verifiedFacts) addFact('verified_fact', f);
    for (const m of ent.mechanicsOrEvents) addFact('mechanic_or_event', m);
    for (const p of ent.attackPatternsOrPhases ?? []) addFact('attack_pattern', p);

    entityFactIds.set(ent.entityName, factIdsForEntity);
  }

  const scriptBlocks: ScriptBlock[] = input.script.segments.map((seg, idx) => {
    const cut = input.decupagem[idx];
    const linkedEntities = cut?.entities ?? [];
    const sourceFactIds = linkedEntities.flatMap((name) => entityFactIds.get(name) ?? []);
    const sourceIds = linkedEntities.flatMap((name) => entitySourceIds.get(name) ?? []);
    const blockId = `blk_${input.script.scriptId}_${seg.segmentId}`;
    return {
      blockId,
      scriptId: input.script.scriptId,
      segmentId: seg.segmentId,
      beatId: seg.beatId,
      stage: seg.stage,
      title: seg.title,
      narrationText: seg.spokenText,
      estimatedDurationSec: seg.estimatedDurationSec,
      sourceFactIds: [...new Set(sourceFactIds)],
      sourceIds: [...new Set(sourceIds)],
      versionHash: sha12({ blockId, narrationText: seg.spokenText, sourceFactIds }),
    };
  });

  const scenes = input.decupagem.map((cut, idx) => {
    const block = scriptBlocks[idx];
    const factIds = cut.entities.flatMap((name) => entityFactIds.get(name) ?? []);
    const sourceIds = cut.entities.flatMap((name) => entitySourceIds.get(name) ?? []);
    return {
      ...cut,
      scriptBlockId: block?.blockId ?? `unlinked_${cut.sceneId}`,
      factIds: [...new Set(factIds)],
      sourceIds: [...new Set(sourceIds)],
    };
  });

  return {
    ...trail,
    sources: Array.from(sourceMap.values()),
    facts,
    scriptBlocks,
    scenes,
  };
}

export function runEditorialIntegrityChecks(input: {
  interpretation?: PromptInterpretation;
  dossier?: EditorialResearchDossier;
  trail: EditorialAuditTrail;
}): EditorialIntegrityReport {
  const issues: EditorialIntegrityIssue[] = [];
  const rawPromptLower = input.interpretation?.originalPrompt.trim().toLowerCase() ?? '';
  const dossierEntities = new Set((input.dossier?.entities ?? []).map((e) => e.entityName.toLowerCase()));
  const blockIds = new Set(input.trail.scriptBlocks.map((b) => b.blockId));

  // 1. Ranking count mismatch
  if (
    input.interpretation?.requestedCount &&
    input.dossier &&
    input.dossier.entities.length !== input.interpretation.requestedCount
  ) {
    issues.push({
      code: 'ranking_count_mismatch',
      severity: 'error',
      message: `Ranking esperava ${input.interpretation.requestedCount} entidades, mas dossiê possui ${input.dossier.entities.length}.`,
    });
  }

  // 2. Queries containing full prompt
  for (const q of input.trail.queries) {
    if (rawPromptLower.length >= 24 && q.queryText.toLowerCase().includes(rawPromptLower)) {
      issues.push({
        code: 'query_contains_full_prompt',
        severity: 'error',
        sceneId: q.sceneId,
        queryId: q.queryId,
        message: `Consulta executada contém o prompt inteiro: "${q.queryText.slice(0, 80)}..."`,
      });
    }
  }

  // 3 & 4. Scene without script link + entity missing in dossier + narration/entity divergence + incompatible visual intent + repeated entity check
  const blockById = new Map(input.trail.scriptBlocks.map((b) => [b.blockId, b]));
  const dossierEntityByLower = new Map(
    (input.dossier?.entities ?? []).map((e) => [e.entityName.toLowerCase(), e]),
  );
  const seenEntityEvents = new Map<string, Array<{ sceneId: string; expectedEvent: string }>>();
  for (const scene of input.trail.scenes) {
    if (!scene.scriptBlockId || !blockIds.has(scene.scriptBlockId)) {
      issues.push({
        code: 'scene_without_script_link',
        severity: 'error',
        sceneId: scene.sceneId,
        message: `Cena ${scene.sceneId} não possui vínculo explícito com um bloco do roteiro.`,
      });
    }
    const linkedBlock = scene.scriptBlockId ? blockById.get(scene.scriptBlockId) : undefined;
    const blockNarrationAndTitle = `${linkedBlock?.title ?? ''} ${linkedBlock?.narrationText ?? scene.narrationText}`;
    const hasBossRole = scene.entities.some((ent) => {
      const role = dossierEntityByLower.get(ent.toLowerCase())?.role ?? '';
      return /\b(boss|chefe)\b/i.test(role);
    });
    const hasBossContext =
      hasBossRole ||
      /\b(boss|chefe|chefes|bosses|phase\s*2|fase\s*2|segunda\s*fase)\b/i.test(
        `${blockNarrationAndTitle} ${scene.expectedEvent}`,
      );
    if (
      scene.visualIntent === 'gameplay_boss_fight' &&
      !hasBossContext
    ) {
      issues.push({
        code: 'incompatible_visual_intent',
        severity: 'error',
        sceneId: scene.sceneId,
        message: `Cena ${scene.sceneId} classificada como "gameplay_boss_fight" sem contexto de chefe/boss na narração.`,
      });
    } else if (
      scene.visualIntent !== 'gameplay_boss_fight' &&
      scene.mediaQueries.some((q) => /\b(boss fight|phase 2)\b/i.test(q))
    ) {
      issues.push({
        code: 'incompatible_visual_intent',
        severity: 'error',
        sceneId: scene.sceneId,
        message: `Cena ${scene.sceneId} (${scene.visualIntent}) contém consultas de boss fight/phase 2 incompatíveis com a intenção visual.`,
      });
    }

    for (const ent of scene.entities) {
      if (dossierEntities.size > 0 && !dossierEntities.has(ent.toLowerCase())) {
        issues.push({
          code: 'entity_missing_in_dossier',
          severity: 'error',
          sceneId: scene.sceneId,
          message: `Entidade "${ent}" na cena ${scene.sceneId} não existe no dossiê factual.`,
        });
      }
      if (!doesNarrationMatchEntity(blockNarrationAndTitle, ent, scene.workTitle)) {
        issues.push({
          code: 'entity_narration_divergence',
          severity: 'error',
          sceneId: scene.sceneId,
          message: `Entidade "${ent}" na cena ${scene.sceneId} não corresponde ao conteúdo narrado no bloco correspondente.`,
        });
      }
      const key = ent.toLowerCase();
      const prev = seenEntityEvents.get(key) ?? [];
      const sameEvent = prev.find(
        (p) => p.expectedEvent.trim().toLowerCase() === scene.expectedEvent.trim().toLowerCase(),
      );
      if (sameEvent) {
        issues.push({
          code: 'boss_repetition_without_justification',
          severity: 'warning',
          sceneId: scene.sceneId,
          message: `Entidade "${ent}" repetida na cena ${scene.sceneId} com o mesmo evento ("${scene.expectedEvent}") da cena ${sameEvent.sceneId} sem justificativa narrativa distinta.`,
        });
      }
      prev.push({ sceneId: scene.sceneId, expectedEvent: scene.expectedEvent });
      seenEntityEvents.set(key, prev);
    }

    // 8. Scene insufficient coverage
    const placements = input.trail.timelinePlacements.filter((p) => p.sceneId === scene.sceneId);
    const coveredSec = placements.reduce((sum, p) => sum + Math.max(0, p.durationSec), 0);
    if (placements.length === 0 || coveredSec < scene.durationSec * 0.5) {
      issues.push({
        code: 'scene_insufficient_coverage',
        severity: 'warning',
        sceneId: scene.sceneId,
        message: `Cena ${scene.sceneId} com cobertura insuficiente (${Math.round(coveredSec)}s / ${Math.round(scene.durationSec)}s esperados).`,
      });
    }
  }

  // 6 & 7. Narration-media divergence + approved media without visual evidence
  const evidenceByCandidate = new Map<string, GroundingEvidenceRecord>();
  for (const ev of input.trail.groundingEvidences) {
    evidenceByCandidate.set(ev.candidateId, ev);
  }
  for (const cand of input.trail.candidates) {
    if (cand.status !== 'approved') continue;
    const ev = evidenceByCandidate.get(cand.candidateId);
    if (!ev || ev.framesAnalyzed.length === 0 || ev.positiveEvidences.length === 0) {
      issues.push({
        code: 'approved_media_without_visual_evidence',
        severity: 'error',
        sceneId: cand.sceneId,
        candidateId: cand.candidateId,
        message: `Mídia aprovada "${cand.title}" (${cand.candidateId}) não possui evidência visual por frame suficiente.`,
      });
    } else if (ev.decision !== 'approved' || ev.confidence < 0.7) {
      issues.push({
        code: 'narration_media_divergence',
        severity: 'error',
        sceneId: cand.sceneId,
        candidateId: cand.candidateId,
        message: `Divergência entre narração e mídia aprovada "${cand.title}" (confiança ${(ev.confidence * 100).toFixed(0)}%, decisão ${ev.decision}).`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  return {
    checkedAt: new Date().toISOString(),
    passed: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}

const REPAIRABLE_CODES = new Set<EditorialIntegrityCheckCode>([
  'incompatible_visual_intent',
  'entity_narration_divergence',
  'boss_repetition_without_justification',
  'query_contains_full_prompt',
  'entity_missing_in_dossier',
]);

/**
 * Bounded auto-repair for semantic decupagem: rebuilds only scenes flagged by editorial integrity checks,
 * re-runs traceability + integrity audit up to `maxAttempts` (default 2), and never loops indefinitely.
 */
export function repairSemanticDecupagem(input: {
  projectId: string;
  script: EditorialScript;
  dossier: EditorialResearchDossier;
  interpretation: PromptInterpretation;
  decupagem: SemanticSceneCut[];
  previousTrail?: EditorialAuditTrail;
  maxAttempts?: number;
}): {
  decupagem: SemanticSceneCut[];
  trail: EditorialAuditTrail;
  report: EditorialIntegrityReport;
  attempts: number;
  repairedSceneIds: string[];
} {
  const maxAttempts = Math.max(1, Math.min(3, input.maxAttempts ?? 2));
  let currentDecupagem = input.decupagem;
  const repairedSet = new Set<string>();
  let attempts = 0;

  let trail = buildEditorialTraceabilityGraph({
    projectId: input.projectId,
    dossier: input.dossier,
    script: input.script,
    decupagem: currentDecupagem,
    ...(input.previousTrail ? { previousTrail: input.previousTrail } : {}),
  });
  let report = runEditorialIntegrityChecks({
    interpretation: input.interpretation,
    dossier: input.dossier,
    trail,
  });

  while (attempts < maxAttempts) {
    const affectedSceneIds = new Set(
      report.issues
        .filter((i) => i.sceneId && REPAIRABLE_CODES.has(i.code))
        .map((i) => i.sceneId as string),
    );
    if (affectedSceneIds.size === 0) break;

    attempts += 1;
    const rebuilt = buildSemanticDecupagem(input.script, input.dossier, input.interpretation);
    currentDecupagem = currentDecupagem.map((scene, idx) => {
      if (!affectedSceneIds.has(scene.sceneId)) return scene;
      const fresh = rebuilt[idx];
      if (!fresh) return scene;
      repairedSet.add(fresh.sceneId);
      return fresh;
    });

    trail = buildEditorialTraceabilityGraph({
      projectId: input.projectId,
      dossier: input.dossier,
      script: input.script,
      decupagem: currentDecupagem,
      previousTrail: trail,
    });
    report = runEditorialIntegrityChecks({
      interpretation: input.interpretation,
      dossier: input.dossier,
      trail,
    });
  }

  return {
    decupagem: currentDecupagem,
    trail,
    report,
    attempts,
    repairedSceneIds: [...repairedSet],
  };
}
