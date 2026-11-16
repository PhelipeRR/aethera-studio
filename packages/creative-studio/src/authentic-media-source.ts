/**
 * CS-9 — Authentic media acquisition port for the Concept-Driven Engine.
 *
 * The creative-studio package stays independent of the cinema stack: it only declares this port. The desktop
 * app implements it with the sources Aethera Studio already ships (local media library, Wikimedia Commons,
 * Internet Archive, Sakugabooru for anime, yt-dlp search/acquire, ffmpeg frame extraction), see
 * apps/aethera-desktop/src/main/creative-authentic-media.ts.
 */
export type AuthenticProvenance = 'real_video_frame' | 'official_media' | 'licensed_reference';

export interface AuthenticMediaRequest {
  /** Search query built from the franchise/subject, e.g. "Elden Ring Malenia". */
  query: string;
  /** Character/subject whose identity the media must show, e.g. "Malenia". Its name must appear in the metadata. */
  subject?: string;
  role: string;
  genre?: 'games' | 'anime' | 'documentary' | 'general';
  signal?: AbortSignal;
}

export interface AuthenticMediaResult {
  /** Local still image (PNG/JPG/WebP). Video sources must already be reduced to a frame by the implementation. */
  imagePath: string;
  provenance: AuthenticProvenance;
  origin: string;
  sourceUrl: string;
  license: string;
  title?: string;
  /** Timestamp of the extracted frame when the source was a video. */
  frameTimestampSec?: number;
}

export interface AuthenticMediaSource {
  readonly id: string;
  acquire(request: AuthenticMediaRequest): Promise<AuthenticMediaResult | null>;
}
