import { Player, type PlayerRef } from '@remotion/player';
import { forwardRef } from 'react';
import type { AetheraTimelineCompositionProps } from '@neuralbridge/shared/aethera-timeline-composition';
import { AetheraTimelineComposition } from './AetheraTimelineComposition';

/** Player seam for AP-04: callers provide the exact serialized props sent to the render worker. */
export type AetheraTimelinePreviewRef = PlayerRef;
const AetheraTimelinePreview = forwardRef<AetheraTimelinePreviewRef, { props: AetheraTimelineCompositionProps }>(function AetheraTimelinePreview({ props }, ref) {
  const durationInFrames = Math.max(1, Math.round(props.window.durationMs * props.format.fps / 1_000));
  return <div aria-label="Prévia da timeline Aethera" role="region" className="overflow-hidden rounded-lg border"><Player ref={ref} component={AetheraTimelineComposition} inputProps={{ props }} durationInFrames={durationInFrames} fps={props.format.fps} compositionWidth={props.format.width} compositionHeight={props.format.height} controls style={{ width: '100%' }} /></div>;
});

export default AetheraTimelinePreview;
