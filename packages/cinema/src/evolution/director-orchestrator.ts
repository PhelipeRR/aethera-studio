import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CinemaProductionPackage } from '../index.js';
import type { AudioTimelineEvent } from '../audio/sound-director.js';
import {
  runDirectorSpecialtyCheck,
  type DirectorExecutionResult,
} from './director-registry.js';
import type { AetheraEvolutionCore, DirectorId } from './evolution-core.js';

export interface OrchestrationNode {
  nodeId: string;
  directorIds: DirectorId[];
  dependsOn: string[];
  maxRetries: number;
  timeoutMs: number;
}

export interface ConflictProposal {
  directorId: DirectorId;
  proposal: string;
  impactScore: number; // 0..100
  preservesClipBounds: boolean;
}

export interface CollaborativeConflictResolution {
  conflictId: string;
  raisedBy: DirectorId;
  issue: string;
  proposals: ConflictProposal[];
  chosenBy: DirectorId;
  chosenProposal: ConflictProposal;
  validatedByQuality: boolean;
  rationale: string;
  recordedAt: string;
}

export interface OrchestratorCheckpoint {
  runId: string;
  projectId: string;
  status: 'running' | 'completed' | 'blocked' | 'cancelled' | 'failed';
  completedNodes: string[];
  results: Record<string, DirectorExecutionResult[]>;
  resolutions: CollaborativeConflictResolution[];
  updatedAt: string;
}

export const DEFAULT_CINEMA_DAG: OrchestrationNode[] = [
  { nodeId: 'brief_vision', directorIds: ['general_director'], dependsOn: [], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'research_media', directorIds: ['research_media_director'], dependsOn: ['brief_vision'], maxRetries: 2, timeoutMs: 15_000 },
  { nodeId: 'narrative_comedy', directorIds: ['narrative_director', 'comedy_director'], dependsOn: ['brief_vision'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'art_cinematography', directorIds: ['art_director', 'cinematography_director'], dependsOn: ['brief_vision'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'editing_motion', directorIds: ['editing_director', 'motion_director', 'continuity_director'], dependsOn: ['research_media', 'narrative_comedy', 'art_cinematography'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'vfx_color', directorIds: ['vfx_director', 'color_director'], dependsOn: ['editing_motion'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'music_narration', directorIds: ['music_director', 'narration_director'], dependsOn: ['narrative_comedy', 'editing_motion'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'sound_director_gate', directorIds: ['sound_director'], dependsOn: ['music_narration', 'vfx_color'], maxRetries: 1, timeoutMs: 10_000 },
  { nodeId: 'quality_director_gate', directorIds: ['quality_director'], dependsOn: ['sound_director_gate'], maxRetries: 1, timeoutMs: 10_000 },
];

export function resolveNarrationDurationConflict(input: {
  sceneId: string;
  narrationDurationMs: number;
  sceneDurationMs: number;
  rawClipMaxDurationMs: number;
  evolution: AetheraEvolutionCore;
  projectId: string;
}): CollaborativeConflictResolution {
  const overflowMs = input.narrationDurationMs - input.sceneDurationMs;
  const canExtendClip = input.rawClipMaxDurationMs >= input.narrationDurationMs + 250;

  const editingProposal: ConflictProposal = {
    directorId: 'editing_director',
    proposal: canExtendClip
      ? `Estender a tomada "${input.sceneId}" em +${overflowMs + 250}ms (dentro do limite bruto de ${input.rawClipMaxDurationMs}ms).`
      : `Tomada "${input.sceneId}" não tem folga bruta suficiente (${input.rawClipMaxDurationMs}ms) para estender.`,
    impactScore: canExtendClip ? 88 : 25,
    preservesClipBounds: canExtendClip,
  };

  const narrativeProposal: ConflictProposal = {
    directorId: 'narrative_director',
    proposal: `Condensar o texto da cena "${input.sceneId}" para caber em <= ${Math.max(1000, input.sceneDurationMs - 250)}ms preservando o gancho.`,
    impactScore: canExtendClip ? 74 : 92,
    preservesClipBounds: true,
  };

  const proposals = [editingProposal, narrativeProposal];
  const chosen = [...proposals].sort((a, b) => b.impactScore - a.impactScore)[0] ?? narrativeProposal;

  const resolution: CollaborativeConflictResolution = {
    conflictId: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    raisedBy: 'sound_director',
    issue: `Narração de "${input.sceneId}" (${input.narrationDurationMs}ms) ultrapassa janela da cena (${input.sceneDurationMs}ms).`,
    proposals,
    chosenBy: 'general_director',
    chosenProposal: chosen,
    validatedByQuality: chosen.preservesClipBounds,
    rationale: canExtendClip
      ? 'Diretor-Geral optou por estender a tomada (Montagem) para preservar a frase completa sem corte.'
      : 'Diretor-Geral optou por condensar o texto (Narrativa) pois o clipe bruto não possui margem suficiente.',
    recordedAt: new Date().toISOString(),
  };

  input.evolution.recordDecision({
    projectId: input.projectId,
    directorId: 'general_director',
    action: 'collaborative_conflict_resolution',
    rationale: `${resolution.issue} -> ${resolution.rationale}`,
    consultedMemoryIds: [],
    consultedAcademyIds: [],
    outcome: resolution.validatedByQuality ? 'applied' : 'blocked',
  });

  return resolution;
}

export async function runDirectorOrchestrationDag(input: {
  runId: string;
  projectId: string;
  prompt: string;
  genre: string;
  pkg: CinemaProductionPackage;
  evolution: AetheraEvolutionCore;
  audioEvents?: AudioTimelineEvent[];
  totalDurationMs?: number;
  academyHints?: Array<{ knowledgeId: string; title: string; technique: string }>;
  checkpointPath?: string;
  signal?: AbortSignal;
}): Promise<OrchestratorCheckpoint> {
  let checkpoint: OrchestratorCheckpoint = {
    runId: input.runId,
    projectId: input.projectId,
    status: 'running',
    completedNodes: [],
    results: {},
    resolutions: [],
    updatedAt: new Date().toISOString(),
  };

  if (input.checkpointPath && existsSync(input.checkpointPath)) {
    try {
      const saved = JSON.parse(readFileSync(input.checkpointPath, 'utf8')) as OrchestratorCheckpoint;
      if (saved.runId === input.runId && saved.projectId === input.projectId) {
        checkpoint = { ...saved, status: 'running' };
      }
    } catch {
      // start fresh
    }
  }

  const saveCheckpoint = () => {
    if (!input.checkpointPath) return;
    mkdirSync(dirname(input.checkpointPath), { recursive: true });
    const tmp = `${input.checkpointPath}.tmp`;
    checkpoint.updatedAt = new Date().toISOString();
    writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), 'utf8');
    renameSync(tmp, input.checkpointPath);
  };

  const completed = new Set(checkpoint.completedNodes);
  while (completed.size < DEFAULT_CINEMA_DAG.length) {
    if (input.signal?.aborted) {
      checkpoint.status = 'cancelled';
      saveCheckpoint();
      return checkpoint;
    }

    const readyWave = DEFAULT_CINEMA_DAG.filter(
      (n) => !completed.has(n.nodeId) && n.dependsOn.every((dep) => completed.has(dep)),
    );
    if (readyWave.length === 0) {
      checkpoint.status = 'failed';
      saveCheckpoint();
      throw new Error('Ciclo ou dependência não resolvida no grafo de diretores.');
    }

    const waveResults = await Promise.all(
      readyWave.map(async (node) => {
        const dirResults = node.directorIds.map((directorId) =>
          runDirectorSpecialtyCheck(directorId, {
            projectId: input.projectId,
            prompt: input.prompt,
            genre: input.genre,
            pkg: input.pkg,
            evolution: input.evolution,
            ...(input.audioEvents ? { audioEvents: input.audioEvents } : {}),
            ...(input.totalDurationMs ? { totalDurationMs: input.totalDurationMs } : {}),
            ...(input.academyHints ? { academyHints: input.academyHints } : {}),
          }),
        );
        return { nodeId: node.nodeId, dirResults };
      }),
    );

    let waveBlocked = false;
    for (const w of waveResults) {
      checkpoint.results[w.nodeId] = w.dirResults;
      completed.add(w.nodeId);
      checkpoint.completedNodes = Array.from(completed);
      if (w.dirResults.some((r) => r.status === 'blocked')) {
        waveBlocked = true;
      }
    }

    if (waveBlocked) {
      checkpoint.status = 'blocked';
      saveCheckpoint();
      return checkpoint;
    }

    saveCheckpoint();
  }

  checkpoint.status = 'completed';
  saveCheckpoint();
  return checkpoint;
}
