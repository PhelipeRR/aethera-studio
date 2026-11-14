import { describe, expect, it } from 'vitest';
import { SPOTIFY_COMMAND_ERROR_CODES, SPOTIFY_ERROR_CODES, spotifyCommandSchema, spotifySearchInputSchema, spotifySearchResultSchema, spotifyUriSchema } from '../src/index.js';

const track = 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6';

describe('Spotify command contracts', () => {
  it('accepts the voice commands', () => {
    expect(spotifyCommandSchema.parse({ action: 'pause' })).toEqual({ action: 'pause' });
    expect(spotifyCommandSchema.parse({ action: 'next' })).toEqual({ action: 'next' });
    expect(spotifyCommandSchema.parse({ action: 'volume', volume: 40 })).toEqual({ action: 'volume', volume: 40 });
    expect(spotifyCommandSchema.parse({ action: 'play', uri: track })).toEqual({ action: 'play', uri: track });
    expect(spotifyCommandSchema.parse({ action: 'play' })).toEqual({ action: 'play' });
    expect(spotifyCommandSchema.parse({ action: 'search', query: 'Djavan', types: ['track'], limit: 5 })).toMatchObject({ limit: 5 });
    expect(spotifyCommandSchema.parse({ action: 'saved_tracks' })).toEqual({ action: 'saved_tracks' });
    expect(spotifyCommandSchema.parse({ action: 'devices' })).toEqual({ action: 'devices' });
    expect(spotifyCommandSchema.parse({ action: 'transfer', deviceId: 'device-1' })).toEqual({ action: 'transfer', deviceId: 'device-1' });
  });

  it('rejects anything that is not an official Spotify identifier or command', () => {
    expect(spotifyUriSchema.safeParse('https://evil.example/track').success).toBe(false);
    expect(spotifyUriSchema.safeParse('spotify:track:../../me').success).toBe(false);
    expect(spotifyCommandSchema.safeParse({ action: 'click', x: 1, y: 2 }).success).toBe(false);
    expect(spotifyCommandSchema.safeParse({ action: 'volume', volume: 101 }).success).toBe(false);
  });

  it('bounds searches', () => {
    expect(spotifySearchInputSchema.safeParse({ query: '   ', types: ['track'], limit: 5 }).success).toBe(false);
    expect(spotifySearchInputSchema.safeParse({ query: 'x'.repeat(201), types: ['track'], limit: 5 }).success).toBe(false);
    expect(spotifySearchInputSchema.safeParse({ query: 'x', types: ['track'], limit: 11 }).success).toBe(false);
    expect(spotifySearchInputSchema.safeParse({ query: 'x', types: [], limit: 5 }).success).toBe(false);
    expect(spotifySearchResultSchema.parse({ items: [{ uri: track, type: 'track', name: 'Oceano', subtitle: 'Djavan' }] }).items).toHaveLength(1);
  });

  it('extends the provider error codes without changing the ones the HUD already maps', () => {
    expect(SPOTIFY_ERROR_CODES).not.toContain('not_connected');
    expect(SPOTIFY_COMMAND_ERROR_CODES).toEqual(expect.arrayContaining([...SPOTIFY_ERROR_CODES, 'not_connected', 'controls_disabled', 'reauthorize', 'restricted', 'invalid_response']));
  });
});
