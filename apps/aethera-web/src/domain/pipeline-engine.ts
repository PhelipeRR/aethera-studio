import type {
  BrandKit,
  CreativeArtProject,
  CreativeArtType,
  CreativeAudit,
  CreativeLayer,
  DerivativeVariant,
  PipelineStage,
  PipelineStageId,
  ProductionProject,
  PublicationPackage,
  ReleaseChecklistItem,
} from './types';

export const PIPELINE_BLUEPRINT: ReadonlyArray<{
  id: PipelineStageId;
  label: string;
  agent: string;
  summary: string;
  durationSec: number;
}> = [
  { id: 'interpretation', label: '1. Interpretação', agent: 'Antigravity', summary: 'Entidades, tom e critérios do briefing extraídos.', durationSec: 4 },
  { id: 'research', label: '2. Pesquisa Editorial', agent: 'Antigravity', summary: 'Dossiê factual validado com fontes verificadas.', durationSec: 12 },
  { id: 'script', label: '3. Roteiro', agent: 'Claude Code', summary: 'Roteiro estruturado em 5 atos com checkpoint.', durationSec: 16 },
  { id: 'decoupage', label: '4. Decupagem', agent: 'Claude Code', summary: 'Consultas visuais específicas geradas por cena.', durationSec: 9 },
  { id: 'media_acquisition', label: '5. Aquisição & Visão', agent: 'VisionRouter', summary: 'Frames validados por aderência semântica.', durationSec: 18 },
  { id: 'coverage_plan', label: '6. Cobertura Anti-Repetição', agent: 'Cinema Engine', summary: 'Distribuição visual sem repetição consecutiva.', durationSec: 6 },
  { id: 'assembly', label: '7. Montagem', agent: 'Cinema Engine', summary: 'Timeline multifaixa e transições montadas.', durationSec: 11 },
  { id: 'audio_sfx', label: '8. Narração, Trilha & SFX', agent: 'VoiceStudio', summary: 'Narração sincronizada + ducking musical -14 LUFS.', durationSec: 14 },
  { id: 'preview_render', label: '9. Prévia & QC', agent: 'FFmpeg + QC', summary: 'Prévia MP4 auditada com FFprobe pronta para Revisão.', durationSec: 15 },
];

export function createInitialStages(completedCount = 0): PipelineStage[] {
  return PIPELINE_BLUEPRINT.map((spec, idx) => ({
    ...spec,
    state:
      idx < completedCount
        ? 'completed'
        : idx === completedCount && completedCount > 0 && completedCount < PIPELINE_BLUEPRINT.length
          ? 'running'
          : 'pending',
  }));
}

export function createDefaultChecklist(readyForReview = false): ReleaseChecklistItem[] {
  return [
    { id: 'chk-audio', label: 'Loudness calibrado (-14 LUFS) sem clipping', category: 'audio', passed: readyForReview },
    { id: 'chk-sync', label: 'Sincronia narração × legendas validada', category: 'audio', passed: readyForReview },
    { id: 'chk-visual', label: 'Zero repetição consecutiva de B-roll', category: 'visual', passed: readyForReview },
    { id: 'chk-hook', label: 'Gancho dos primeiros 15 segundos aprovado', category: 'editorial', passed: readyForReview },
    { id: 'chk-rights', label: 'Origem e licença editorial de todas as mídias registradas', category: 'direitos', passed: true },
  ];
}

export function createDefaultPublicationPackage(title: string, briefing: string, tags: string[] = []): PublicationPackage {
  return {
    version: 1,
    title,
    description: briefing,
    tags: tags.length > 0 ? tags : ['aethera', 'youtube', 'cinema'],
    thumbnailArtId: null,
    visibility: 'private',
    approvalStatus: 'draft',
    approvedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getPipelineProgressPct(stages: ReadonlyArray<PipelineStage>): number {
  if (stages.length === 0) return 0;
  const completed = stages.filter((s) => s.state === 'completed').length;
  const running = stages.some((s) => s.state === 'running') ? 0.5 : 0;
  return Math.min(100, Math.round(((completed + running) / stages.length) * 100));
}

export function advancePipelineOneStage(project: ProductionProject): {
  nextProject: ProductionProject;
  completedStageLabel: string | null;
  reachedReview: boolean;
} {
  const stages = project.stages.map((s) => ({ ...s }));
  const nextIndex = stages.findIndex((s) => s.state !== 'completed');
  if (nextIndex === -1) {
    return { nextProject: project, completedStageLabel: null, reachedReview: false };
  }

  stages[nextIndex].state = 'completed';
  if (nextIndex + 1 < stages.length) {
    stages[nextIndex + 1].state = 'running';
  }

  const allDone = stages.every((s) => s.state === 'completed');
  const nextStatus = allDone ? 'awaiting_review' : 'producing';
  const nextScenes =
    stages[nextIndex].id === 'media_acquisition' || allDone
      ? project.scenes.map((sc) => ({ ...sc, mediaMatched: true }))
      : project.scenes;
  const nextChecklist = allDone
    ? project.checklist.map((item) => ({ ...item, passed: true }))
    : project.checklist;

  return {
    nextProject: {
      ...project,
      status: project.status === 'approved' || project.status === 'scheduled' ? project.status : nextStatus,
      stages,
      scenes: nextScenes,
      checklist: nextChecklist,
      updatedAt: new Date().toISOString(),
    },
    completedStageLabel: stages[nextIndex].label,
    reachedReview: allDone,
  };
}

export function completeEntirePipeline(project: ProductionProject): ProductionProject {
  return {
    ...project,
    status: project.status === 'approved' || project.status === 'scheduled' ? project.status : 'awaiting_review',
    stages: project.stages.map((s) => ({ ...s, state: 'completed' })),
    scenes: project.scenes.map((sc) => ({ ...sc, mediaMatched: true })),
    checklist: project.checklist.map((c) => ({ ...c, passed: true })),
    updatedAt: new Date().toISOString(),
  };
}

export function computeQualityScore(project: ProductionProject): number {
  const checklistWeight = 0.5;
  const pipelineWeight = 0.3;
  const mediaWeight = 0.2;

  const passedChecks = project.checklist.filter((c) => c.passed).length;
  const checkRatio = project.checklist.length > 0 ? passedChecks / project.checklist.length : 0;
  const pipelineRatio = getPipelineProgressPct(project.stages) / 100;
  const matchedScenes = project.scenes.filter((s) => s.mediaMatched).length;
  const mediaRatio = project.scenes.length > 0 ? matchedScenes / project.scenes.length : 0;

  return Math.round((checkRatio * checklistWeight + pipelineRatio * pipelineWeight + mediaRatio * mediaWeight) * 100);
}

export function detectCalendarConflicts(
  projects: ReadonlyArray<ProductionProject>,
  dateIso: string,
  ignoreProjectId?: string,
): ProductionProject[] {
  return projects.filter((p) => p.scheduledDate === dateIso && p.id !== ignoreProjectId);
}

export function generateDerivativeVariant(
  project: ProductionProject,
  formatId: DerivativeVariant['formatId'],
): DerivativeVariant {
  const labelMap: Record<DerivativeVariant['formatId'], string> = {
    'youtube-short': 'YouTube Short (9:16)',
    'instagram-reels': 'Instagram Reel (9:16)',
    tiktok: 'TikTok Corte (9:16)',
  };
  const climaxScene = project.scenes[3] ?? project.scenes[0];
  return {
    id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    formatId,
    title: `${project.title.slice(0, 38)} — ${labelMap[formatId]}`,
    hookText: climaxScene ? climaxScene.caption : `Destaque vertical de ${project.title}`,
    durationSec: formatId === 'youtube-short' ? 52 : formatId === 'instagram-reels' ? 45 : 38,
    status: 'candidate',
    childProjectId: null,
    createdAt: new Date().toISOString(),
  };
}

export function buildCreativeLayers(
  artType: CreativeArtType,
  headline: string,
  prompt: string,
  kit: BrandKit,
  archetype: string,
): CreativeLayer[] {
  const cleanHeadline = (headline.trim() || prompt.trim().slice(0, 26) || 'NOVO EPISÓDIO').toUpperCase();
  const subText =
    artType === 'banner'
      ? 'NOVOS VÍDEOS TODA SEMANA • AETHERA STUDIO'
      : artType === 'avatar'
        ? kit.monogram
        : archetype.toUpperCase();

  return [
    {
      id: 'layer-bg',
      kind: 'background',
      label: 'Fundo Cinematográfico',
      color: kit.primaryBg,
      visible: true,
      xPct: 0,
      yPct: 0,
      scale: 1,
    },
    {
      id: 'layer-badge',
      kind: 'badge',
      label: 'Selo de Curiosidade',
      text: subText,
      color: kit.accentColor,
      visible: artType !== 'watermark',
      xPct: 8,
      yPct: 14,
      scale: 1,
    },
    {
      id: 'layer-headline',
      kind: 'headline',
      label: 'Tipografia Principal',
      text: artType === 'avatar' || artType === 'watermark' ? kit.monogram : cleanHeadline,
      color: kit.textColor,
      visible: true,
      xPct: 8,
      yPct: 58,
      scale: 1,
    },
    {
      id: 'layer-watermark',
      kind: 'watermark',
      label: "Marca d'Água do Canal",
      text: kit.monogram,
      color: kit.accentColor,
      visible: artType !== 'avatar',
      xPct: 86,
      yPct: 84,
      scale: 1,
    },
  ];
}

export function generateThumbnailLabVariants(
  prompt: string,
  headline: string,
  fidelity: CreativeArtProject['fidelity'],
  kit: BrandKit,
): CreativeArtProject[] {
  const now = new Date().toISOString();
  const variants: Array<{ label: 'A' | 'B' | 'C'; archetype: string; primaryBg: string; accent: string }> = [
    { label: 'A', archetype: 'Contraste Editorial', primaryBg: '#22131d', accent: '#f9a8d4' },
    { label: 'B', archetype: 'Tensão & Mistério', primaryBg: '#1b1238', accent: '#b8a4f4' },
    { label: 'C', archetype: 'Impacto Neon Lima', primaryBg: '#0f1714', accent: '#d8fb4f' },
  ];

  return variants.map((v, idx) => {
    const customKit: BrandKit = {
      ...kit,
      primaryBg: v.primaryBg,
      accentColor: v.accent,
    };
    return {
      id: `art-lab-${Date.now()}-${idx}`,
      artType: 'thumbnail',
      prompt,
      headline: headline.trim() || prompt.trim().slice(0, 26) || 'DESTAQUE DO CANAL',
      fidelity,
      brandKitId: kit.id,
      variantLabel: v.label,
      archetype: v.archetype,
      layers: buildCreativeLayers('thumbnail', headline, prompt, customKit, v.archetype),
      approved: false,
      createdAt: now,
    };
  });
}

export function auditCreativeProject(art: CreativeArtProject): CreativeAudit {
  const headlineLayer = art.layers.find((l) => l.kind === 'headline');
  const headlineWords = (headlineLayer?.text ?? '').trim().split(/\s+/).filter(Boolean).length;
  const visibleCount = art.layers.filter((l) => l.visible).length;
  const hasWatermark = art.layers.some((l) => l.kind === 'watermark' && l.visible);

  const checks = [
    {
      label: 'Legibilidade mobile (≤ 5 palavras)',
      ok: headlineWords >= 1 && headlineWords <= 5,
      detail: `${headlineWords} palavra(s) na manchete principal`,
    },
    {
      label: 'Hierarquia de camadas equilibrada',
      ok: visibleCount >= 2,
      detail: `${visibleCount} camadas ativas na composição`,
    },
    {
      label: 'Identidade visual / Brand Kit aplicada',
      ok: Boolean(art.brandKitId) && (hasWatermark || art.artType === 'avatar'),
      detail: hasWatermark ? "Marca d'água ativa" : 'Avatar focado em monograma',
    },
    {
      label: 'Direção criativa preenchida',
      ok: art.prompt.trim().length >= 6,
      detail: art.prompt.trim().length >= 6 ? 'Prompt verificado' : 'Adicione contexto ao prompt',
    },
  ];

  const okCount = checks.filter((c) => c.ok).length;
  const score = Math.round((okCount / checks.length) * 100);
  return {
    score,
    passed: score >= 75,
    checks,
  };
}
