import { motionProjectSchema, rankingTemplateDataSchema, verifiedSubjectSchema, type AetheraRankingProject, type RankingTemplateScene, type VerifiedSubject } from '@neuralbridge/shared';
import type { VideoFormat } from '@neuralbridge/shared/velix-production';

export const AETHERA_RANKING_TEMPLATE_ID = 'aethera-ranking' as const;
export const AETHERA_RANKING_TEMPLATE_VERSION = 1 as const;

export type RankingEntryInput = { rank: number; subject: VerifiedSubject };
export type RankingTemplateInput = {
  title: string;
  criteria: string;
  period?: string | null;
  entries: readonly RankingEntryInput[];
  format: VideoFormat;
  reducedMotion?: boolean;
};

const OPENING_FRAMES = 90;
const POSITION_FRAMES = 90;
const TRANSITION_FRAMES = 30;
const LOWER_THIRD_FRAMES = 60;
const CLOSING_FRAMES = 90;

const clean = (value: string, max: number) => value.trim().slice(0, max);
const dateLabel = (value: string | null): string => {
  if (!value) return 'Data não confirmada';
  const parts = value.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return parts[0] ?? value;
};
const platformLabel = (subject: VerifiedSubject): string => subject.platforms.length ? subject.platforms.join(' · ') : 'Plataformas não confirmadas';
const positionId = (rank: number) => `posicao-${rank}`;

function rankingScene(kind: RankingTemplateScene['kind'], id: string, durationInFrames: number, rank?: number): RankingTemplateScene {
  if (kind === 'position') return { id, kind, durationInFrames, transition: 'fade', rank: rank ?? 1 };
  return { id, kind, durationInFrames, transition: kind === 'opening' ? 'cut' : 'fade' };
}

function motionScene(scene: RankingTemplateScene, input: RankingTemplateInput) {
  const base = { id: scene.id, durationInFrames: scene.durationInFrames, transition: scene.transition } as const;
  const entry = scene.kind === 'position' ? input.entries.find((item) => item.rank === scene.rank) : undefined;
  if (scene.kind === 'opening') return { ...base, kind: 'title' as const, text: clean(input.title, 120), subtitle: clean(input.criteria, 200) };
  if (scene.kind === 'position' && entry) return { ...base, kind: 'card' as const, heading: `#${entry.rank} ${clean(entry.subject.title, 80)}`, body: `${dateLabel(entry.subject.releaseDate)} · ${platformLabel(entry.subject)}` };
  if (scene.kind === 'transition') return { ...base, kind: 'title' as const, text: 'Próxima posição', subtitle: 'Entre posições' };
  if (scene.kind === 'lower-third') return { ...base, kind: 'lower-third' as const, name: 'Ranking verificado', role: input.period ? `Período: ${clean(input.period, 40)}` : undefined };
  return { ...base, kind: 'title' as const, text: 'Até o próximo ranking', subtitle: clean(input.title, 120) };
}

function scenesFor(input: RankingTemplateInput): RankingTemplateScene[] {
  const scenes: RankingTemplateScene[] = [rankingScene('opening', 'abertura', OPENING_FRAMES)];
  input.entries.forEach((entry, index) => {
    scenes.push(rankingScene('position', positionId(entry.rank), POSITION_FRAMES, entry.rank));
    if (index < input.entries.length - 1) scenes.push(rankingScene('transition', `transicao-${entry.rank}`, TRANSITION_FRAMES));
  });
  scenes.push(rankingScene('lower-third', 'terco-inferior', LOWER_THIRD_FRAMES));
  scenes.push(rankingScene('closing', 'encerramento', CLOSING_FRAMES));
  return scenes;
}

function hash(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code ^ (index & 0xff), 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Builds the ranking composition from the verified research output; no provider, clock or random value is consulted. */
export function createAetheraRankingProject(input: RankingTemplateInput): AetheraRankingProject {
  const entries = [...input.entries].sort((a, b) => b.rank - a.rank).map((entry) => ({ rank: entry.rank, subject: verifiedSubjectSchema.parse(entry.subject) }));
  const scenes = scenesFor({ ...input, entries });
  const ranking = rankingTemplateDataSchema.parse({ schemaVersion: 1, title: clean(input.title, 120), criteria: clean(input.criteria, 200), period: input.period === undefined ? null : input.period === null ? null : clean(input.period, 40), entries, scenes, safeArea: input.format.safeArea, reducedMotion: input.reducedMotion === true });
  const project = {
    schemaVersion: 2 as const,
    templateId: AETHERA_RANKING_TEMPLATE_ID,
    templateVersion: AETHERA_RANKING_TEMPLATE_VERSION,
    width: input.format.width,
    height: input.format.height,
    fps: 30 as const,
    scenes: scenes.map((scene) => motionScene(scene, { ...input, entries })),
    captions: [],
    style: { background: { kind: 'solid' as const, color: '#07111f' }, font: 'ibm-plex-sans' as const, accent: '#22d3ee', preset: 'data-storytelling' as const },
    narration: null,
    licenses: [],
    ranking,
  };
  return motionProjectSchema.parse(project) as AetheraRankingProject;
}

export type RankingFrameSnapshot = {
  frame: number;
  kind: RankingTemplateScene['kind'];
  rank?: number;
  text: string[];
  safeArea: AetheraRankingProject['ranking']['safeArea'];
  motion: { opacity: number; translateY: number; scale: number; transitionOpacity: number };
};

/** Pure frame model shared by visual snapshots and the Remotion composition. */
export function rankingTemplateFrameSnapshot(project: AetheraRankingProject, frame: number): RankingFrameSnapshot {
  const requested = Math.max(0, Math.floor(frame));
  let cursor = 0;
  let scene = project.ranking.scenes[0];
  let local = 0;
  for (const candidate of project.ranking.scenes) {
    if (requested < cursor + candidate.durationInFrames) { scene = candidate; local = requested - cursor; break; }
    cursor += candidate.durationInFrames;
  }
  if (!scene) throw new Error('invalid: ranking sem cenas.');
  const entry = scene.kind === 'position' ? project.ranking.entries.find((item) => item.rank === scene.rank) : undefined;
  const text = scene.kind === 'opening'
    ? [project.ranking.title, project.ranking.criteria]
    : scene.kind === 'position' && entry
      ? [`#${entry.rank}`, entry.subject.title, dateLabel(entry.subject.releaseDate), platformLabel(entry.subject)]
      : scene.kind === 'transition'
        ? ['Próxima posição']
        : scene.kind === 'lower-third'
          ? ['Ranking verificado', ...(project.ranking.period ? [`Período: ${project.ranking.period}`] : [])]
          : ['Até o próximo ranking', project.ranking.title];
  const progress = project.ranking.reducedMotion ? 1 : Math.min(1, local / 20);
  const transitionOpacity = project.ranking.reducedMotion || scene.kind !== 'transition' ? 1 : Math.min(1, local / 15);
  return { frame: requested, kind: scene.kind, ...(scene.kind === 'position' ? { rank: scene.rank } : {}), text, safeArea: project.ranking.safeArea, motion: { opacity: progress, translateY: Math.round((1 - progress) * 24), scale: 1, transitionOpacity } };
}

export function rankingTemplateVisualSnapshot(project: AetheraRankingProject): Array<Pick<RankingFrameSnapshot, 'frame' | 'kind' | 'rank' | 'text' | 'safeArea'>> {
  const opening = project.ranking.scenes[0];
  const frames = [0, opening?.durationInFrames ?? 0];
  return frames.map((frame) => {
    const snapshot = rankingTemplateFrameSnapshot(project, frame);
    return { frame, kind: snapshot.kind, ...(snapshot.rank === undefined ? {} : { rank: snapshot.rank }), text: snapshot.text, safeArea: snapshot.safeArea };
  });
}

/** The template version is part of the key, so changing the Remotion composition cannot reuse an old render. */
export function rankingTemplateCacheKey(project: AetheraRankingProject): string {
  return `${project.templateId}@${project.templateVersion}-${hash(stableJson(project))}`;
}
