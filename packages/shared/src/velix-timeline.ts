import { splitSentences } from './velix-long-script.js';
import type { StoryboardIssue, StoryboardScene } from './velix-storyboard.js';

/**
 * The multitrack view of a storyboard: one lane per kind of material, every item on the storyboard's clock, with the
 * markers a person must see on the scene itself (rights, claims, quality). Pure: the editor draws it, edits go back to
 * the storyboard as versioned operations.
 */

export const timelineTracks = ['narration', 'video', 'images', 'graphics', 'text', 'captions', 'music', 'sfx'] as const;
export type TimelineTrackId = (typeof timelineTracks)[number];
export const TIMELINE_TRACK_LABELS: Record<TimelineTrackId, string> = { narration: 'Narração', video: 'Vídeo', images: 'Imagens', graphics: 'Gráficos', text: 'Texto', captions: 'Legendas', music: 'Música', sfx: 'Efeitos' };

export type TimelineMarker = 'rights' | 'claim' | 'quality' | 'locked' | 'estimated';
export interface TimelineItem { id: string; sceneId: string; startMs: number; endMs: number; label: string; markers: TimelineMarker[] }
export interface TimelineTrack { id: TimelineTrackId; label: string; items: TimelineItem[]; planned: boolean }
export interface Timeline { durationMs: number; measured: boolean; tracks: TimelineTrack[] }

const RIGHTS = new Set(['unauthorized_asset', 'no_visual']);
const CLAIMS = new Set(['unsupported_claim']);

/** Caption cues of a scene from its clip's words (one per sentence), or from its interval when there is no clip. */
function sceneCaptions(scene: StoryboardScene): Array<{ text: string; startMs: number; endMs: number }> {
  const sentences = splitSentences(scene.narration);
  const words = scene.audio?.words ?? [];
  if (!words.length) return sentences.length ? [{ text: sentences.join(' '), startMs: scene.startMs, endMs: scene.endMs }] : [];
  let offset = 0;
  return sentences.flatMap((sentence) => {
    const count = sentence.split(/\s+/u).filter(Boolean).length;
    const slice = words.slice(offset, offset + count);
    offset += count;
    const first = slice[0];
    const last = slice.at(-1);
    return first && last ? [{ text: sentence, startMs: scene.startMs + first.startMs, endMs: scene.startMs + last.endMs }] : [];
  });
}

export function buildTimeline(input: { scenes: readonly StoryboardScene[]; issues: readonly StoryboardIssue[]; timing: 'estimated' | 'measured' }): Timeline {
  const markersOf = (scene: StoryboardScene): TimelineMarker[] => {
    const codes = input.issues.filter((issue) => issue.sceneId === scene.id).map((issue) => issue.code);
    const markers: TimelineMarker[] = [];
    if (codes.some((code) => RIGHTS.has(code))) markers.push('rights');
    if (codes.some((code) => CLAIMS.has(code))) markers.push('claim');
    if (codes.some((code) => !RIGHTS.has(code) && !CLAIMS.has(code))) markers.push('quality');
    if (scene.locked) markers.push('locked');
    if (input.timing !== 'measured') markers.push('estimated');
    return markers;
  };
  const item = (scene: StoryboardScene, track: TimelineTrackId, label: string, startMs = scene.startMs, endMs = scene.endMs, index = 0): TimelineItem => ({ id: `${track}:${scene.id}:${index}`, sceneId: scene.id, startMs, endMs, label, markers: markersOf(scene) });
  const lanes: Record<TimelineTrackId, TimelineItem[]> = { narration: [], video: [], images: [], graphics: [], text: [], captions: [], music: [], sfx: [] };
  for (const scene of input.scenes) {
    lanes.narration.push(item(scene, 'narration', scene.audio ? `Clipe de ${(scene.audio.durationMs / 1_000).toFixed(1)} s` : 'Sem clipe medido'));
    if (scene.visual.type === 'asset') lanes[scene.visual.kind === 'image' ? 'images' : 'video'].push(item(scene, scene.visual.kind === 'image' ? 'images' : 'video', scene.visual.title));
    else if (scene.visual.type === 'fallback') lanes.graphics.push(item(scene, 'graphics', { typography: 'Tipografia', document: 'Documento', chart: 'Gráfico', animation: 'Animação' }[scene.visual.kind]));
    if (scene.onScreenText.trim()) lanes.text.push(item(scene, 'text', scene.onScreenText.trim()));
    sceneCaptions(scene).forEach((cue, index) => lanes.captions.push(item(scene, 'captions', cue.text, cue.startMs, cue.endMs, index)));
  }
  return {
    durationMs: input.scenes.at(-1)?.endMs ?? 0,
    measured: input.timing === 'measured',
    tracks: timelineTracks.map((id) => ({ id, label: TIMELINE_TRACK_LABELS[id], items: lanes[id], planned: id === 'music' || id === 'sfx' })),
  };
}
