import { Composition, registerRoot } from 'remotion';
import { motionDuration, type MotionProject } from '@neuralbridge/shared/motion';
import { MotionComposition } from '../src/renderer/src/features/video/motion/MotionComposition';
import { RankingComposition } from '../src/renderer/src/features/video/motion/RankingComposition';
import { AetheraTimelineComposition } from '../src/renderer/src/features/video/motion/AetheraTimelineComposition';
import type { AetheraTimelineCompositionProps } from '@neuralbridge/shared/aethera-timeline-composition';

const SAMPLE: MotionProject = { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 1280, height: 720, fps: 30, captions: [], scenes: [{ id: 'sample', kind: 'title', text: 'Velix', durationInFrames: 30, transition: 'cut' }] };
const RANKING_SAMPLE: MotionProject = { schemaVersion: 2, templateId: 'aethera-ranking', templateVersion: 1, width: 1920, height: 1080, fps: 30, captions: [], scenes: [
  { id: 'abertura', kind: 'title', text: 'Ranking', subtitle: 'Critério', durationInFrames: 90, transition: 'cut' },
  { id: 'posicao-1', kind: 'card', heading: '#1 Jogo', body: '2026 · PC', durationInFrames: 90, transition: 'fade' },
  { id: 'terco-inferior', kind: 'lower-third', name: 'Ranking verificado', role: 'Período: 2026', durationInFrames: 60, transition: 'fade' },
  { id: 'encerramento', kind: 'title', text: 'Até o próximo ranking', subtitle: 'Ranking', durationInFrames: 90, transition: 'fade' },
], style: { background: { kind: 'solid', color: '#07111f' }, font: 'ibm-plex-sans', accent: '#22d3ee', preset: 'data-storytelling' }, narration: null, licenses: [], ranking: {
  schemaVersion: 1, title: 'Ranking', criteria: 'Critério', period: '2026', entries: [{ rank: 1, subject: { schemaVersion: 1, id: 'sample-game', kind: 'game', title: 'Jogo', aliases: [], releaseDate: '2026', datePrecision: 'year', platforms: ['PC'], companies: ['Estúdio'], externalIds: { igdb: 'sample-game' }, verification: 'confirmed', evidenceIds: ['sample-evidence'], checkedAt: '2026-11-11T00:00:00.000Z' } }], scenes: [
    { id: 'abertura', kind: 'opening', durationInFrames: 90, transition: 'cut' }, { id: 'posicao-1', kind: 'position', rank: 1, durationInFrames: 90, transition: 'fade' }, { id: 'terco-inferior', kind: 'lower-third', durationInFrames: 60, transition: 'fade' }, { id: 'encerramento', kind: 'closing', durationInFrames: 90, transition: 'fade' },
  ], safeArea: { top: 54, right: 96, bottom: 54, left: 96 }, reducedMotion: false,
} };
const AETHERA_TIMELINE_SAMPLE: AetheraTimelineCompositionProps = { schemaVersion: 1, compositionId: 'aethera-timeline', timelineId: 'sample', timelineVersion: 1, timelineHash: '0000000000000000', window: { fromMs: 0, durationMs: 1_000 }, format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, background: { kind: 'gradient', from: '#0d3b3e', to: '#102126', angle: 135 }, layers: [] };

function Root() {
  const metadata = ({ props }: { props: { project: MotionProject } }) => ({ durationInFrames: motionDuration(props.project), fps: props.project.fps, width: props.project.width, height: props.project.height });
  // Remotion passes the composition props ({ props }) as `props`; the timeline props live one level down, as in the component.
  const timelineMetadata = ({ props: { props } }: { props: { props: AetheraTimelineCompositionProps } }) => ({ durationInFrames: Math.max(1, Math.round(props.window.durationMs * props.format.fps / 1_000)), fps: props.format.fps, width: props.format.width, height: props.format.height });
  return <><Composition id="velix-base" component={MotionComposition} defaultProps={{ project: SAMPLE }} calculateMetadata={metadata} /><Composition id="velix-editorial" component={MotionComposition} defaultProps={{ project: { ...SAMPLE, templateId: 'velix-editorial' } }} calculateMetadata={metadata} /><Composition id="one-take" component={MotionComposition} defaultProps={{ project: { ...SAMPLE, templateId: 'one-take' } }} calculateMetadata={metadata} /><Composition id="aethera-ranking" component={RankingComposition} defaultProps={{ project: RANKING_SAMPLE }} calculateMetadata={metadata} /><Composition id="aethera-timeline" component={AetheraTimelineComposition} defaultProps={{ props: AETHERA_TIMELINE_SAMPLE }} calculateMetadata={timelineMetadata} /></>;
}

registerRoot(Root);
