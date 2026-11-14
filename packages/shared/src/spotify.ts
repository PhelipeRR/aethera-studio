import { z } from 'zod';

export const SPOTIFY_HISTORY_SCOPE = 'user-read-recently-played';
export const SPOTIFY_LIBRARY_SCOPE = 'user-library-read';
export const SPOTIFY_FOLLOW_SCOPE = 'user-follow-read';
export const SPOTIFY_PLAYLIST_READ_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'] as const;
export const SPOTIFY_READ_SCOPES = ['user-read-playback-state', 'user-read-currently-playing', SPOTIFY_HISTORY_SCOPE, SPOTIFY_LIBRARY_SCOPE, SPOTIFY_FOLLOW_SCOPE, ...SPOTIFY_PLAYLIST_READ_SCOPES] as const;
/** Requested only after the user turns playback controls on. */
export const SPOTIFY_CONTROL_SCOPE = 'user-modify-playback-state';
/** Spotify rejects "localhost" and needs an exact match, so this literal is what the Developer App must register. */
export const SPOTIFY_REDIRECT_PORT = 43879;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;

export const SPOTIFY_ERROR_CODES = ['auth_denied', 'auth_invalid', 'auth_timeout', 'port_in_use', 'revoked', 'forbidden', 'premium_required', 'no_device', 'rate_limited', 'quota_exceeded', 'network', 'unknown'] as const;
export type SpotifyErrorCode = (typeof SPOTIFY_ERROR_CODES)[number];

export const spotifyDeviceSchema = z.strictObject({ id: z.string().min(1).max(200), name: z.string().max(200), type: z.string().max(50), isActive: z.boolean() });
export type SpotifyDevice = z.infer<typeof spotifyDeviceSchema>;

export const SPOTIFY_CONTROL_BLOCKS = ['disabled', 'reauthorize', 'no_device', 'restricted'] as const;
export type SpotifyControlBlock = (typeof SPOTIFY_CONTROL_BLOCKS)[number];

export const spotifyClientIdSchema = z.string().regex(/^[a-f0-9]{32}$/i);

export const spotifyPlaybackSchema = z.strictObject({
  trackId: z.string().max(200).nullable(),
  title: z.string().min(1).max(500),
  artists: z.string().max(500),
  /** A data: URL fetched by the main process; the renderer's CSP allows no remote image. */
  cover: z.string().max(1_000_000).nullable(),
  isPlaying: z.boolean(),
  progressMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** When the progress was sampled, so the display can advance it without another request. */
  sampledAt: z.number().int().nonnegative(),
  /** Beats per minute, when Spotify still serves audio features to this app; the mascot dances to it. */
  tempoBpm: z.number().positive().max(400).nullable().optional(),
  device: z.string().max(200).nullable(),
  /** Null when the device has no remote volume. */
  volume: z.number().int().min(0).max(100).nullable(),
  canPause: z.boolean(),
  canResume: z.boolean(),
  canNext: z.boolean(),
  canPrevious: z.boolean(),
  hasLink: z.boolean(),
  /** The last thing played, shown while nothing is: there is no live player behind it. */
  remembered: z.boolean().default(false),
});
export type SpotifyPlayback = z.infer<typeof spotifyPlaybackSchema>;

export const spotifyStatusSchema = z.strictObject({
  connection: z.enum(['disabled', 'unconfigured', 'disconnected', 'connecting', 'connected']),
  clientId: spotifyClientIdSchema.nullable(),
  controlsEnabled: z.boolean(),
  /** Why playback controls cannot be used right now; null when they can. */
  controlBlock: z.enum(SPOTIFY_CONTROL_BLOCKS).nullable(),
  /** False when the OS offers no secure storage, so the connection lasts only until the app closes. */
  persistent: z.boolean(),
  playback: spotifyPlaybackSchema.nullable(),
  error: z.enum(SPOTIFY_ERROR_CODES).nullable(),
  /** Epoch ms before which no request is sent, after a rate limit. */
  retryAt: z.number().int().nonnegative().nullable(),
});
export type SpotifyStatus = z.infer<typeof spotifyStatusSchema>;

export const spotifyConfigureSchema = z.strictObject({
  enabled: z.boolean().optional(),
  clientId: spotifyClientIdSchema.nullable().optional(),
  controlsEnabled: z.boolean().optional(),
});
export type SpotifyConfigure = z.infer<typeof spotifyConfigureSchema>;

export const spotifyControlSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.enum(['play', 'pause', 'next', 'previous']) }),
  z.strictObject({ action: z.literal('volume'), volume: z.number().int().min(0).max(100) }),
  z.strictObject({ action: z.literal('transfer'), deviceId: z.string().min(1).max(200) }),
]);
export type SpotifyControl = z.infer<typeof spotifyControlSchema>;

/** Everything the Web API can report, plus what a typed command can run into before reaching it. */
export const SPOTIFY_COMMAND_ERROR_CODES = [...SPOTIFY_ERROR_CODES, 'not_connected', 'controls_disabled', 'reauthorize', 'restricted', 'invalid_response'] as const;
export type SpotifyCommandErrorCode = (typeof SPOTIFY_COMMAND_ERROR_CODES)[number];

export const SPOTIFY_SEARCH_TYPES = ['track', 'album', 'artist', 'playlist'] as const;
export type SpotifySearchType = (typeof SPOTIFY_SEARCH_TYPES)[number];
/** The Web API accepts at most 10 results per type. */
export const SPOTIFY_SEARCH_LIMIT_MAX = 10;

export const spotifyUriSchema = z.string().regex(/^spotify:(track|album|artist|playlist):[A-Za-z0-9]{22}$/);

export const spotifySearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  types: z.array(z.enum(SPOTIFY_SEARCH_TYPES)).min(1).max(SPOTIFY_SEARCH_TYPES.length),
  limit: z.number().int().min(1).max(SPOTIFY_SEARCH_LIMIT_MAX),
});
export type SpotifySearchInput = z.infer<typeof spotifySearchInputSchema>;

export const spotifySearchResultSchema = z.strictObject({
  items: z.array(z.strictObject({
    uri: spotifyUriSchema,
    type: z.enum(SPOTIFY_SEARCH_TYPES),
    name: z.string().min(1).max(500),
    subtitle: z.string().max(500),
  })).max(SPOTIFY_SEARCH_LIMIT_MAX * SPOTIFY_SEARCH_TYPES.length),
});
export type SpotifySearchResult = z.infer<typeof spotifySearchResultSchema>;
export const spotifyPlaylistSchema = z.strictObject({ uri: z.string().regex(/^spotify:playlist:[A-Za-z0-9]{22}$/), name: z.string().min(1).max(500), owner: z.string().max(500), tracks: z.number().int().nonnegative() });
export type SpotifyPlaylist = z.infer<typeof spotifyPlaylistSchema>;
export const spotifyPlaylistsResultSchema = z.strictObject({ items: z.array(spotifyPlaylistSchema).max(50) });
export type SpotifyPlaylistsResult = z.infer<typeof spotifyPlaylistsResultSchema>;
export const spotifySavedTracksResultSchema = z.strictObject({ items: z.array(z.strictObject({ name: z.string().min(1).max(500), artist: z.string().max(500), uri: spotifyUriSchema })).max(50) });
export type SpotifySavedTracksResult = z.infer<typeof spotifySavedTracksResultSchema>;
export const spotifyFollowedArtistsResultSchema = z.strictObject({ items: z.array(z.strictObject({ name: z.string().min(1).max(500), uri: spotifyUriSchema })).max(50) });
export type SpotifyFollowedArtistsResult = z.infer<typeof spotifyFollowedArtistsResultSchema>;
export const spotifyDevicesResultSchema = z.strictObject({ items: z.array(spotifyDeviceSchema).max(50) });
export type SpotifyDevicesResult = z.infer<typeof spotifyDevicesResultSchema>;

export const spotifyPlaybackStateSchema = z.strictObject({
  playback: spotifyPlaybackSchema.nullable(),
  /** False when the command was accepted but the follow-up read failed: never a reason to send the command again. */
  refreshed: z.boolean(),
});
export type SpotifyPlaybackState = z.infer<typeof spotifyPlaybackStateSchema>;

export const spotifyCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('play'), uri: spotifyUriSchema.optional() }),
  z.strictObject({ action: z.enum(['pause', 'next', 'previous']) }),
  z.strictObject({ action: z.literal('volume'), volume: z.number().int().min(0).max(100) }),
  z.strictObject({ action: z.literal('search'), ...spotifySearchInputSchema.shape }),
  z.strictObject({ action: z.literal('playlists') }),
  z.strictObject({ action: z.literal('saved_tracks') }),
  z.strictObject({ action: z.literal('followed_artists') }),
  z.strictObject({ action: z.literal('devices') }),
  z.strictObject({ action: z.literal('transfer'), deviceId: z.string().trim().min(1).max(200) }),
  z.strictObject({ action: z.literal('current') }),
]);
export type SpotifyCommand = z.infer<typeof spotifyCommandSchema>;

export const spotifyCommandResultSchema = z.union([spotifySearchResultSchema, spotifyPlaybackStateSchema, spotifyPlaylistsResultSchema, spotifySavedTracksResultSchema, spotifyFollowedArtistsResultSchema, spotifyDevicesResultSchema]);
export type SpotifyCommandResult = z.infer<typeof spotifyCommandResultSchema>;
