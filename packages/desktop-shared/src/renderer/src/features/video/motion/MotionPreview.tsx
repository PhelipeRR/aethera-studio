import { Player, type PlayerRef } from '@remotion/player';
import { forwardRef } from 'react';
import { motionDuration, type MotionProject } from '@neuralbridge/shared/motion';
import { MotionComposition } from './MotionComposition';

/** Read-only preview: the same composition the render bundle draws. Loaded on demand because the player is heavy. */
export type MotionPreviewRef = PlayerRef;
const MotionPreview = forwardRef<MotionPreviewRef, { project: MotionProject }>(function MotionPreview({ project }, ref) {
  const durationInFrames = Math.max(motionDuration(project), 1);
  // Only the preview follows the system setting: the rendered file stays the approved composition.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return <div aria-label="Prévia Motion" role="region" className="overflow-hidden rounded-lg border"><Player ref={ref} component={MotionComposition} inputProps={{ project, reducedMotion }} durationInFrames={durationInFrames} fps={project.fps} compositionWidth={project.width} compositionHeight={project.height} controls style={{ width: '100%' }} /></div>;
});
export default MotionPreview;
