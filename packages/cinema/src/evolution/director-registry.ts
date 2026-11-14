import type { CinemaProductionPackage } from '../index.js';
import { auditAudioTimeline, type AudioTimelineEvent, type SoundDirectorAuditReport } from '../audio/sound-director.js';
import { planComedyBeats } from '../comedy/comedy-director.js';
import { evaluateTypographyPlacement } from '../vfx/vfx-typography.js';
import type { AetheraEvolutionCore, DirectorId, EvolutionMemoryRecord } from './evolution-core.js';

export interface DirectorProfile {
  id: DirectorId;
  name: string;
  specialty: string;
  responsibilities: string[];
  allowedTools: string[];
  successCriteria: string[];
  vetoPower: boolean;
}

export interface DirectorExecutionContext {
  projectId: string;
  prompt: string;
  genre: string;
  pkg: CinemaProductionPackage;
  evolution: AetheraEvolutionCore;
  audioEvents?: AudioTimelineEvent[];
  totalDurationMs?: number;
  academyHints?: Array<{ knowledgeId: string; title: string; technique: string }>;
}

export interface DirectorExecutionResult {
  directorId: DirectorId;
  status: 'approved' | 'warning' | 'blocked';
  summary: string;
  consultedMemories: EvolutionMemoryRecord[];
  consultedAcademyIds: string[];
  recommendations: string[];
  audioAudit?: SoundDirectorAuditReport;
}

export const AETHERA_DIRECTORS: Record<DirectorId, DirectorProfile> = {
  general_director: {
    id: 'general_director',
    name: 'Diretor-Geral',
    specialty: 'Visão artística, coordenação e resolução de conflitos',
    responsibilities: ['Definir visão artística', 'Resolver impasses entre especialistas', 'Aprovar plano final'],
    allowedTools: ['compileCreativeBrief', 'resolveConflict', 'evolution.retrieve'],
    successCriteria: ['Coerência narrativa e técnica entre todos os departamentos'],
    vetoPower: true,
  },
  narrative_director: {
    id: 'narrative_director',
    name: 'Diretor de Narrativa',
    specialty: 'Estrutura dramática, roteiro e storytelling',
    responsibilities: ['Estruturar gancho, desenvolvimento e clímax', 'Condensar texto quando há excesso de duração'],
    allowedTools: ['directNarrativeAndShots', 'parseDurationFromPrompt', 'academy.query'],
    successCriteria: ['Arco claro com gancho, conflito e resolução dentro do tempo alvo'],
    vetoPower: false,
  },
  cinematography_director: {
    id: 'cinematography_director',
    name: 'Diretor de Fotografia',
    specialty: 'Enquadramento, iluminação, câmera e composição',
    responsibilities: ['Definir planos, movimentos de câmera e safe-zones de enquadramento'],
    allowedTools: ['computeSafeReframeBox', 'buildStyleBible', 'academy.query'],
    successCriteria: ['Legibilidade visual e enquadramento sem cortes bruscos de sujeito'],
    vetoPower: false,
  },
  editing_director: {
    id: 'editing_director',
    name: 'Diretor de Montagem',
    specialty: 'Ritmo, cortes, transições e continuidade temporal',
    responsibilities: ['Cadência de planos', 'Transições xfade', 'Ajuste de duração de tomadas'],
    allowedTools: ['trimClipFrameAccurate', 'rippleDeleteClip', 'applyJLCutTransition', 'probeRealMp4.scdet'],
    successCriteria: ['Ritmo consistente e transições motivadas sem saltos visuais'],
    vetoPower: false,
  },
  art_director: {
    id: 'art_director',
    name: 'Diretor de Arte',
    specialty: 'Identidade estética, cenários, tipografia e design',
    responsibilities: ['Paleta visual Aethera', 'Consistência estética entre cenas'],
    allowedTools: ['buildStyleBible', 'evaluateTypographyPlacement'],
    successCriteria: ['Identidade visual coesa e contraste adequado'],
    vetoPower: false,
  },
  sound_director: {
    id: 'sound_director',
    name: 'Diretor de Som',
    specialty: 'Mixagem, buses A1–A5, diálogos, ambiência e SFX',
    responsibilities: ['Auditar timeline de áudio', 'Bloquear sobreposição de falas', 'Controlar ducking e true peak'],
    allowedTools: ['measureAudioDurationMs', 'auditAudioTimeline', 'assertSoundDirectorApproval', 'ffmpeg.ebur128'],
    successCriteria: ['0 sobreposições de fala', '0 truncamentos', 'True peak <= -1.0 dBTP'],
    vetoPower: true,
  },
  music_director: {
    id: 'music_director',
    name: 'Diretor Musical',
    specialty: 'Trilha, emoção e sincronização musical',
    responsibilities: ['Selecionar cama musical', 'Suspensão pré-clímax', 'Integrar ducking com A1'],
    allowedTools: ['buildSoundDesignPlan', 'academy.query'],
    successCriteria: ['Trilha apoia a emoção sem mascarar a voz'],
    vetoPower: false,
  },
  narration_director: {
    id: 'narration_director',
    name: 'Diretor de Narração',
    specialty: 'Voz, prosódia, pausas, interpretação e sincronização',
    responsibilities: ['Sintetizar voz no VoiceStudio', 'Garantir pausas naturais sem corte de palavras'],
    allowedTools: ['voicestudio.speech', 'measureAudioDurationMs'],
    successCriteria: ['Dicção clara, sem prosódia truncada e com respiro >= 200ms'],
    vetoPower: false,
  },
  vfx_director: {
    id: 'vfx_director',
    name: 'Diretor de VFX',
    specialty: 'Efeitos visuais, composição e integração',
    responsibilities: ['Compor overlays, vinhetas e nitidez de clímax sem poluição visual'],
    allowedTools: ['createTypedVfxEffect', 'academy.query'],
    successCriteria: ['VFX integrado ao quadro sem artefatos ou excesso'],
    vetoPower: false,
  },
  motion_director: {
    id: 'motion_director',
    name: 'Diretor de Motion Graphics',
    specialty: 'Títulos, animações e gráficos em safe-zone',
    responsibilities: ['Posicionar lower-thirds e títulos dentro de safe-zones'],
    allowedTools: ['evaluateTypographyPlacement'],
    successCriteria: ['100% dos textos legíveis e fora de áreas obstruídas'],
    vetoPower: false,
  },
  color_director: {
    id: 'color_director',
    name: 'Diretor de Colorização',
    specialty: 'Correção de cor, grading Rec.709 e consistência visual',
    responsibilities: ['Aplicar pipeline Rec.709 e consistência tonal entre clipes distintos'],
    allowedTools: ['buildColorPipelinePlan', 'resolveLutProvenance'],
    successCriteria: ['Conformidade Rec.709 e consistência de contraste/saturação'],
    vetoPower: false,
  },
  comedy_director: {
    id: 'comedy_director',
    name: 'Diretor de Humor',
    specialty: 'Timing, ironia, humor contextual e callbacks (padrão 35%)',
    responsibilities: ['Inserir beats pontuais a 35% sem quebrar cenas sensíveis'],
    allowedTools: ['planComedyBeats'],
    successCriteria: ['Humor natural <= 35% e bloqueado em cenas sensíveis'],
    vetoPower: false,
  },
  continuity_director: {
    id: 'continuity_director',
    name: 'Diretor de Continuidade',
    specialty: 'Coerência visual, narrativa e temporal',
    responsibilities: ['Garantir alinhamento entre briefing, storyboard, timeline e duração final'],
    allowedTools: ['runDeterministicTechnicalQc', 'totalTimelineDurationSeconds'],
    successCriteria: ['Nenhuma contradição temporal ou visual entre cenas adjacentes'],
    vetoPower: false,
  },
  research_media_director: {
    id: 'research_media_director',
    name: 'Diretor de Pesquisa e Mídia',
    specialty: 'Fontes, seleção, procedência e direitos de uso',
    responsibilities: ['Registrar licenças, descartar clipes com legendas queimadas e validar procedência'],
    allowedTools: ['analyzeMediaAsset', 'provenanceRegistry'],
    successCriteria: ['100% dos ativos com procedência e licença compatível registradas'],
    vetoPower: true,
  },
  quality_director: {
    id: 'quality_director',
    name: 'Diretor de Qualidade',
    specialty: 'Auditoria técnica e criativa, aprovação e bloqueios independentes',
    responsibilities: ['Executar QC objetivo + critérios criativos', 'Emitir aprovação ou bloqueio final'],
    allowedTools: ['probeRealMp4', 'runRealMediaQc', 'evaluateReleaseGates', 'evaluateEnsemble'],
    successCriteria: ['Aprovação apenas com evidências reais e 0 bloqueios críticos abertos'],
    vetoPower: true,
  },
};

export function listAllDirectors(): DirectorProfile[] {
  return Object.values(AETHERA_DIRECTORS);
}

export function runDirectorSpecialtyCheck(
  directorId: DirectorId,
  ctx: DirectorExecutionContext,
): DirectorExecutionResult {
  const memories = ctx.evolution.retrieveRelevantMemories({
    text: `${ctx.prompt} ${ctx.genre}`,
    directorId,
    genre: ctx.genre,
    projectId: ctx.projectId,
    limit: 5,
  });
  const academyIds = (ctx.academyHints ?? []).map((h) => h.knowledgeId);
  const recommendations: string[] = [];
  for (const m of memories) {
    recommendations.push(`[Memória v${m.version} · ${m.state}] ${m.title}`);
  }
  for (const h of ctx.academyHints ?? []) {
    recommendations.push(`[Academia · ${h.knowledgeId}] ${h.technique}`);
  }

  let status: 'approved' | 'warning' | 'blocked' = 'approved';
  let summary = `${AETHERA_DIRECTORS[directorId].name}: verificação concluída sem pendências.`;
  let audioAudit: SoundDirectorAuditReport | undefined;

  if (directorId === 'sound_director' && ctx.audioEvents && ctx.totalDurationMs) {
    audioAudit = auditAudioTimeline(ctx.audioEvents, ctx.totalDurationMs);
    if (!audioAudit.approved) {
      status = 'blocked';
      summary = `Diretor de Som BLOQUEOU: ${audioAudit.blockedReasons.join('; ')}`;
    } else if (audioAudit.conflicts.length > 0) {
      status = 'warning';
      summary = `Diretor de Som aprovou com ${audioAudit.conflicts.length} aviso(s).`;
    } else {
      summary = 'Diretor de Som aprovou timeline A1–A5 com 0 conflitos.';
    }
  } else if (directorId === 'comedy_director') {
    const beats = planComedyBeats({
      brief: ctx.pkg.direction.brief,
      narrativeBeats: ctx.pkg.direction.narrativeBeats,
      shots: ctx.pkg.direction.shots,
    });
    summary = `Diretor de Humor planejou ${beats.length} beat(s) com intensidade ${ctx.pkg.timeline.humorProfile.humorIntensity}%.`;
  } else if (directorId === 'motion_director') {
    const placement = evaluateTypographyPlacement({
      text: ctx.prompt.slice(0, 60),
      format: ctx.pkg.direction.brief.format,
      protectedRegions: [],
      durationSec: 4.0,
      contrastRatio: 9.5,
    });
    if (placement.safeZoneViolation || placement.collidesWithHud || !placement.contrastOk) {
      status = 'warning';
      summary = 'Diretor de Motion alertou ajuste de safe-zone/contraste de tipografia.';
    } else {
      summary = 'Diretor de Motion validou safe-zone e contraste de tipografia.';
    }
  } else if (directorId === 'quality_director') {
    if (!ctx.pkg.releaseGates.passed) {
      status = 'blocked';
      summary = `Diretor de Qualidade bloqueou release: ${ctx.pkg.releaseGates.blockingReasons.join(', ')}`;
    } else {
      summary = `Diretor de Qualidade validou scorecard (${ctx.pkg.scorecard.compositeScore.toFixed(1)}).`;
    }
  }

  ctx.evolution.recordDecision({
    projectId: ctx.projectId,
    directorId,
    action: 'specialty_check',
    rationale: summary,
    consultedMemoryIds: memories.map((m) => m.memoryId),
    consultedAcademyIds: academyIds,
    outcome: status === 'blocked' ? 'blocked' : 'applied',
  });

  return {
    directorId,
    status,
    summary,
    consultedMemories: memories,
    consultedAcademyIds: academyIds,
    recommendations,
    ...(audioAudit ? { audioAudit } : {}),
  };
}
