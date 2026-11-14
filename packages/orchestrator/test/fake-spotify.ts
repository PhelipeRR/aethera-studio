import type { SpotifyPlayback, SpotifyStatus } from '@neuralbridge/shared';
import type { SpotifyApiRequest, SpotifyApiResponse, SpotifyGateway } from '../src/integrations/spotify-adapter.js';

export const playback: SpotifyPlayback = { trackId: 't1', title: 'Oceano', artists: 'Djavan', cover: null, isPlaying: true, progressMs: 1, durationMs: 2, sampledAt: 3, device: 'Desktop', volume: 50, canPause: true, canResume: true, canNext: true, canPrevious: true, hasLink: false, remembered: false };
export const connected: SpotifyStatus = { connection: 'connected', clientId: null, controlsEnabled: true, controlBlock: null, persistent: true, playback, error: null, retryAt: null };

export function response(status: number, body: unknown = null, headers: Record<string, string> = {}): SpotifyApiResponse {
  return { status, json: () => Promise.resolve(body), headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

/** Stands in for the desktop SpotifyService, which owns the tokens. */
export class FakeSpotifyGateway implements SpotifyGateway {
  requests: SpotifyApiRequest[] = [];
  /** The real gateway reports a failed read through status and answers with the last known playback. */
  statusAfterRefresh: SpotifyStatus | null = null;
  statusValue: SpotifyStatus = connected;
  next: SpotifyApiResponse | Error = response(204);
  refreshed: SpotifyPlayback | null | Error = playback;
  resumed: SpotifyPlayback | null | Error = playback;

  status(): SpotifyStatus { return this.statusValue; }
  request(request: SpotifyApiRequest): Promise<SpotifyApiResponse> {
    this.requests.push(request);
    return this.next instanceof Error ? Promise.reject(this.next) : Promise.resolve(this.next);
  }
  refresh(): Promise<SpotifyPlayback | null> {
    if (this.statusAfterRefresh) this.statusValue = this.statusAfterRefresh;
    return this.refreshed instanceof Error ? Promise.reject(this.refreshed) : Promise.resolve(this.refreshed);
  }
  resume(): Promise<SpotifyPlayback | null> {
    return this.resumed instanceof Error ? Promise.reject(this.resumed) : Promise.resolve(this.resumed);
  }
}
