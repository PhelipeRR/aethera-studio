export interface WeatherLocation {
  label: string;
  latitude: number;
  longitude: number;
}

export interface WeatherResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type WeatherFetcher = (url: string, options?: { signal?: AbortSignal }) => Promise<WeatherResponse>;
export type WeatherLocationProvider = () => Promise<WeatherLocation | null>;

interface OpenMeteoCurrent {
  temperature_2m?: unknown;
  wind_speed_10m?: unknown;
  weather_code?: unknown;
  time?: unknown;
}

interface OpenMeteoPayload { current?: OpenMeteoCurrent; }

interface WeatherCacheEntry {
  place: WeatherLocation;
  current: OpenMeteoCurrent;
  expiresAt: number;
}

const WEATHER_CODES: Record<number, { pt: string; en: string }> = {
  0: { pt: 'céu limpo', en: 'clear sky' },
  1: { pt: 'predominantemente limpo', en: 'mainly clear' },
  2: { pt: 'parcialmente nublado', en: 'partly cloudy' },
  3: { pt: 'nublado', en: 'overcast' },
  45: { pt: 'névoa', en: 'fog' },
  48: { pt: 'névoa congelante', en: 'freezing fog' },
  51: { pt: 'garoa fraca', en: 'light drizzle' },
  53: { pt: 'garoa', en: 'drizzle' },
  55: { pt: 'garoa forte', en: 'heavy drizzle' },
  61: { pt: 'chuva fraca', en: 'light rain' },
  63: { pt: 'chuva', en: 'rain' },
  65: { pt: 'chuva forte', en: 'heavy rain' },
  71: { pt: 'neve fraca', en: 'light snow' },
  73: { pt: 'neve', en: 'snow' },
  75: { pt: 'neve forte', en: 'heavy snow' },
  80: { pt: 'pancadas de chuva fracas', en: 'light rain showers' },
  81: { pt: 'pancadas de chuva', en: 'rain showers' },
  82: { pt: 'pancadas de chuva fortes', en: 'heavy rain showers' },
  95: { pt: 'trovoada', en: 'thunderstorm' },
  96: { pt: 'trovoada com granizo fraco', en: 'thunderstorm with light hail' },
  99: { pt: 'trovoada com granizo', en: 'thunderstorm with hail' },
};

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function locale(language: string): 'pt-BR' | 'en-US' {
  return language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
}

function formatNumber(value: number, language: 'pt-BR' | 'en-US'): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

/** Reads only the provider's current conditions; it never guesses a location or forecast. */
export class OpenMeteoWeatherService {
  private readonly fetcher: WeatherFetcher;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, WeatherCacheEntry>();

  constructor(private readonly options: { location: WeatherLocationProvider; fetcher?: WeatherFetcher; cacheTtlMs?: number; timeoutMs?: number; now?: () => number }) {
    this.fetcher = options.fetcher ?? ((url, request) => globalThis.fetch(url, request));
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 5 * 60_000);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
  }

  async current(language: string): Promise<string> {
    const place = await this.options.location();
    if (!place) throw new Error('weather_location_required');
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) throw new Error('weather_location_invalid');
    const key = `${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return this.format(place, cached.current, language, false);

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(place.latitude));
    url.searchParams.set('longitude', String(place.longitude));
    url.searchParams.set('current', 'temperature_2m,wind_speed_10m,weather_code');
    url.searchParams.set('timezone', 'auto');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error('weather_unavailable');
      const payload = await response.json() as OpenMeteoPayload;
      const current = payload.current;
      const temperature = number(current?.temperature_2m);
      const wind = number(current?.wind_speed_10m);
      const code = number(current?.weather_code);
      if (temperature === null || wind === null || code === null) throw new Error('weather_invalid_response');
      this.cache.set(key, { place, current: current ?? {}, expiresAt: this.now() + this.cacheTtlMs });
      return this.format(place, current ?? {}, language, false);
    } catch (error) {
      if (cached) return this.format(cached.place, cached.current, language, true);
      if (controller.signal.aborted) throw new Error('weather_timeout', { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private format(place: WeatherLocation, current: OpenMeteoCurrent, language: string, stale: boolean): string {
    const temperature = number(current.temperature_2m) ?? 0;
    const wind = number(current.wind_speed_10m) ?? 0;
    const code = number(current.weather_code) ?? -1;
    const languageTag = locale(language);
    const condition = WEATHER_CODES[code]?.[languageTag === 'pt-BR' ? 'pt' : 'en'] ?? (languageTag === 'pt-BR' ? 'condição não informada' : 'condition unavailable');
    const update = typeof current.time === 'string' && current.time.length >= 16 ? current.time.slice(11, 16) : null;
    if (languageTag === 'pt-BR') return `Em ${place.label}, agora está ${condition}, ${formatNumber(temperature, languageTag)} °C, com vento de ${formatNumber(wind, languageTag)} km/h. Fonte: Open-Meteo${update ? `, atualização ${update}` : ''}${stale ? ', dados em cache por indisponibilidade temporária' : ''}.`;
    return `In ${place.label}, it is currently ${condition}, ${formatNumber(temperature, languageTag)} °C, with wind at ${formatNumber(wind, languageTag)} km/h. Source: Open-Meteo${update ? `, updated ${update}` : ''}${stale ? ', cached because the provider is temporarily unavailable' : ''}.`;
  }
}
