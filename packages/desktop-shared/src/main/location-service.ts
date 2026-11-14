import type { WeatherLocation, WeatherResponse } from '@neuralbridge/orchestrator';

export interface LocationWindow {
  isDestroyed(): boolean;
  webContents: { executeJavaScript(script: string): Promise<unknown> };
}

export interface DesktopLocationProviderOptions {
  consent(): boolean;
  window(): LocationWindow | undefined;
  fallbackPlace?(): string | null;
  fetcher?: (url: string) => Promise<WeatherResponse>;
  timeoutMs?: number;
}

const GEOLOCATION_SCRIPT = `new Promise((resolve) => {
  if (!navigator.geolocation) { resolve(null); return; }
  navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 }
  );
})`;

function validLocation(value: unknown): value is { latitude: number; longitude: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { latitude?: unknown; longitude?: unknown };
  return typeof candidate.latitude === 'number' && Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90 && typeof candidate.longitude === 'number' && Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180;
}

async function geocode(place: string, fetcher: (url: string) => Promise<WeatherResponse>): Promise<WeatherLocation | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', place);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('format', 'json');
  try {
    const response = await fetcher(url.toString());
    if (!response.ok) return null;
    const body = await response.json() as { results?: Array<{ name?: unknown; latitude?: unknown; longitude?: unknown }> };
    const result = body.results?.[0];
    const label = result?.name;
    if (!result || typeof label !== 'string' || !validLocation(result)) return null;
    return { label, latitude: result.latitude, longitude: result.longitude };
  } catch {
    return null;
  }
}

/** Requests a coarse browser/Windows location only after the user enabled the weather consent. */
export function createDesktopLocationProvider(options: DesktopLocationProviderOptions): () => Promise<WeatherLocation | null> {
  return async () => {
    if (!options.consent()) return null;
    const window = options.window();
    if (window && !window.isDestroyed()) {
      try {
        const result = await Promise.race([
          window.webContents.executeJavaScript(GEOLOCATION_SCRIPT),
          new Promise<null>((resolve) => { const timer = setTimeout(() => resolve(null), options.timeoutMs ?? 12_000); timer.unref?.(); }),
        ]);
        if (validLocation(result)) return { ...result, label: 'sua localização' };
      } catch { /* Fall through to the explicit city fallback. */ }
    }
    const place = options.fallbackPlace?.()?.trim();
    return place ? geocode(place, options.fetcher ?? ((url) => globalThis.fetch(url))) : null;
  };
}
