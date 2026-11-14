import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AetheraRankingProject, RankingTemplateScene } from '@neuralbridge/shared/motion';

const BASE = { background: '#07111f', surface: '#10233d', text: '#e0f2fe', muted: '#93c5fd', accent: '#22d3ee' };
const FONT = '"IBM Plex Sans", "Segoe UI", sans-serif';

const dateLabel = (value: string | null): string => {
  if (!value) return 'Data não confirmada';
  const parts = value.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return parts[0] ?? value;
};

const platformLabel = (platforms: readonly string[]) => platforms.length ? platforms.join(' · ') : 'Plataformas não confirmadas';

function useSceneMotion(project: AetheraRankingProject, scene: RankingTemplateScene) {
  const frame = useCurrentFrame();
  if (project.ranking.reducedMotion) return { opacity: 1, transform: 'none' };
  const entrance = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const transition = scene.kind === 'transition' ? interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  return { opacity: entrance * transition, transform: `translateY(${(1 - entrance) * 24}px)` };
}

function SafeFrame({ project, children }: { project: AetheraRankingProject; children: React.ReactNode }) {
  const safe = project.ranking.safeArea;
  return <div style={{ padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`, boxSizing: 'border-box', width: '100%', height: '100%' }}>{children}</div>;
}

function RankingScene({ project, scene }: { project: AetheraRankingProject; scene: RankingTemplateScene }) {
  const motion = useSceneMotion(project, scene);
  const { width } = useVideoConfig();
  const entry = scene.kind === 'position' ? project.ranking.entries.find((item) => item.rank === scene.rank) : undefined;
  const content = scene.kind === 'opening'
    ? <div><div style={{ fontSize: width * 0.07, fontWeight: 800, lineHeight: 1.05 }}>{project.ranking.title}</div><div style={{ marginTop: width * 0.02, fontSize: width * 0.03, color: BASE.accent }}>{project.ranking.criteria}</div>{project.ranking.period && <div style={{ marginTop: width * 0.012, fontSize: width * 0.018, color: BASE.muted }}>{project.ranking.period}</div>}</div>
    : scene.kind === 'position' && entry
      ? <div style={{ background: BASE.surface, border: `${Math.max(1, width * 0.002)}px solid ${BASE.accent}`, padding: width * 0.04, borderRadius: width * 0.012 }}><div style={{ color: BASE.accent, fontSize: width * 0.065, fontWeight: 800 }}>#{entry.rank}</div><div style={{ marginTop: width * 0.018, fontSize: width * 0.05, fontWeight: 700 }}>{entry.subject.title}</div><div style={{ marginTop: width * 0.018, fontSize: width * 0.024, color: BASE.muted }}>{dateLabel(entry.subject.releaseDate)} · {platformLabel(entry.subject.platforms)}</div></div>
      : scene.kind === 'transition'
        ? <div style={{ color: BASE.accent, fontSize: width * 0.04, fontWeight: 700 }}>Próxima posição</div>
        : scene.kind === 'lower-third'
          ? <div style={{ borderLeft: `${Math.max(2, width * 0.008)}px solid ${BASE.accent}`, paddingLeft: width * 0.02 }}><div style={{ fontSize: width * 0.04, fontWeight: 700 }}>Ranking verificado</div>{project.ranking.period && <div style={{ marginTop: width * 0.01, fontSize: width * 0.024, color: BASE.muted }}>Período: {project.ranking.period}</div>}</div>
          : <div><div style={{ fontSize: width * 0.06, fontWeight: 800 }}>Até o próximo ranking</div><div style={{ marginTop: width * 0.018, fontSize: width * 0.026, color: BASE.accent }}>{project.ranking.title}</div></div>;
  return <SafeFrame project={project}><div style={{ display: 'flex', alignItems: scene.kind === 'lower-third' ? 'flex-end' : 'center', justifyContent: 'center', width: '100%', height: '100%', color: BASE.text, fontFamily: FONT, ...motion }}>{content}</div></SafeFrame>;
}

/** Remotion composition for the ranking family. All copy comes from verified subjects and the approved ranking input. */
export function RankingComposition({ project }: { project: AetheraRankingProject }) {
  return <AbsoluteFill style={{ background: BASE.background, color: BASE.text, fontFamily: FONT }}>
    {project.ranking.scenes.map((scene, index) => {
      const timelineScene = project.scenes[index];
      if (!timelineScene) return null;
      let from = 0;
      for (let cursor = 0; cursor < index; cursor += 1) from += project.scenes[cursor]?.durationInFrames ?? 0;
      return <Sequence key={scene.id} from={from} durationInFrames={timelineScene.durationInFrames}><RankingScene project={project} scene={scene} /></Sequence>;
    })}
  </AbsoluteFill>;
}
