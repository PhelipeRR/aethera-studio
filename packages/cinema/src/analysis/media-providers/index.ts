export * from './types.js';
export * from './resilience.js';
export * from './licensing.js';
export * from './classification.js';
export * from './source-selection.js';
export * from './registry.js';
export * from './http.js';
export * from './adapters/steam.js';
export * from './adapters/igdb.js';
export * from './adapters/youtube.js';
export * from './adapters/stock.js';
export * from './adapters/anime-reactions.js';
export * from './adapters/huggingface.js';
export * from './adapters/rawg.js';
export * from './adapters/disabled.js';

import { IgdbAdapter, type IgdbPort } from './adapters/igdb.js';
import { SteamAdapter } from './adapters/steam.js';
import { YouTubeAdapter } from './adapters/youtube.js';
import { PexelsAdapter, PixabayAdapter } from './adapters/stock.js';
import { KawaiiRedAdapter, NekosBestAdapter } from './adapters/anime-reactions.js';
import { HuggingFaceDatasetsAdapter } from './adapters/huggingface.js';
import { RawgLegacyAdapter } from './adapters/rawg.js';
import { DISABLED_DESCRIPTORS, DisabledProviderAdapter } from './adapters/disabled.js';
import type { MediaProviderAdapter } from './types.js';

export interface DefaultProviderCredentials {
  igdb?: IgdbPort;
  youtubeApiKey?: () => string | null;
  pexelsApiKey?: () => string | null;
  pixabayApiKey?: () => string | null;
  kawaiiRedToken?: () => string | null;
  huggingFaceToken?: () => string | null;
  rawgApiKey?: () => string | null;
  fetchImpl?: typeof fetch;
}

/** Every adapter Aethera knows, in default priority order. Credentials are read lazily on each call. */
export function createDefaultMediaProviderAdapters(c: DefaultProviderCredentials = {}): MediaProviderAdapter[] {
  const f = c.fetchImpl ? { fetchImpl: c.fetchImpl } : {};
  const none = () => null;
  return [
    new SteamAdapter(f),
    new IgdbAdapter(c.igdb ?? { configured: () => false, searchGames: async () => [], gameVideos: async () => [] }),
    new YouTubeAdapter({ apiKey: c.youtubeApiKey ?? none, ...f }),
    new PexelsAdapter({ apiKey: c.pexelsApiKey ?? none, ...f }),
    new PixabayAdapter({ apiKey: c.pixabayApiKey ?? none, ...f }),
    new NekosBestAdapter(f),
    new KawaiiRedAdapter({ token: c.kawaiiRedToken ?? none, ...f }),
    new HuggingFaceDatasetsAdapter({ token: c.huggingFaceToken ?? none, ...f }),
    new RawgLegacyAdapter({ apiKey: c.rawgApiKey ?? none, ...f }),
    ...DISABLED_DESCRIPTORS.map((d) => new DisabledProviderAdapter(d)),
  ];
}
