export type EditorElementKind = 'video' | 'image' | 'audio' | 'text' | 'vfx';

export type PreviewPlayerState =
  | 'rendering'
  | 'rendered_mp4'
  | 'live_timeline'
  | 'media_unavailable';

export interface CompositionClipInput {
  clipId: string;
  trackId?: string | undefined;
  label: string;
  startSec: number;
  durationSec: number;
  speed: number;
  sourceMediaId?: string | undefined;
  mediaId?: string | undefined;
  mediaUrl?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
  transitionIn?: string | undefined;
  transitionDurationSec?: number | undefined;
}

export interface SourceMediaLookup {
  mediaId: string;
  kind: string;
  uri?: string;
  width?: number;
  height?: number;
  license: string;
}

/**
 * Converts a local file path or URI into a playable `media://` or `http(s)://` URL.
 */
export function resolveMediaPlayUrl(uri?: string | null): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('media://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }
  const normalized = trimmed.replace(/\\/g, '/');
  return `media://local/${encodeURIComponent(normalized)}`;
}

/**
 * Determines the contextual element type for the Properties Inspector.
 */
export function resolveSelectedElementKind(
  clip: CompositionClipInput | null | undefined,
  sourceMedia?: Record<string, SourceMediaLookup>,
): EditorElementKind {
  if (!clip) return 'video';
  const track = (clip.trackId ?? 'v1').toLowerCase();
  if (track.startsWith('a_')) return 'audio';
  if (track === 'sub1' || track === 'text' || clip.clipId.startsWith('text:')) return 'text';
  if (track === 'vfx1' || track === 'v3' || /vfx|overlay|hud|fx/i.test(clip.label)) {
    return 'vfx';
  }
  const sm = (clip.sourceMediaId && sourceMedia?.[clip.sourceMediaId]) ||
    (clip.mediaId && sourceMedia?.[clip.mediaId]) ||
    undefined;
  if (sm) {
    if (sm.kind === 'audio') return 'audio';
    if (sm.kind === 'image') return 'image';
    if (sm.kind === 'text' || sm.kind === 'title') return 'text';
  }
  const uri = (sm?.uri ?? clip.mediaUrl ?? '').toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/.test(uri)) return 'image';
  if (/\.(wav|mp3|ogg|flac|aac|m4a)(\?|$)/.test(uri)) return 'audio';
  return 'video';
}

/**
 * Computes the explicit player status and active media URL at a given playhead time.
 * Never returns a silent placeholder when media is missing.
 */
export function resolveLivePreviewState(input: {
  rendering: boolean;
  previewMode: 'timeline' | 'mp4';
  hasRenderedMp4: boolean;
  activeClip: CompositionClipInput | null;
  resolvedMediaUrl: string | null;
}): {
  state: PreviewPlayerState;
  badgeLabel: string;
  mediaUrl: string | null;
} {
  if (input.rendering) {
    return {
      state: 'rendering',
      badgeLabel: 'Renderização em andamento',
      mediaUrl: input.resolvedMediaUrl,
    };
  }
  if (input.previewMode === 'mp4' && input.hasRenderedMp4) {
    return {
      state: 'rendered_mp4',
      badgeLabel: 'MP4 Renderizado',
      mediaUrl: input.resolvedMediaUrl,
    };
  }
  if (!input.activeClip || !input.resolvedMediaUrl) {
    return {
      state: 'media_unavailable',
      badgeLabel: 'Mídia Indisponível',
      mediaUrl: null,
    };
  }
  return {
    state: 'live_timeline',
    badgeLabel: 'Preview Timeline (Ao Vivo)',
    mediaUrl: input.resolvedMediaUrl,
  };
}
