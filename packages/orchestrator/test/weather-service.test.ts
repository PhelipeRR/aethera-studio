import { describe, expect, it, vi } from 'vitest';
import { OpenMeteoWeatherService } from '../src/weather-service.js';

describe('OpenMeteoWeatherService', () => {
  it('formats current weather in Portuguese from a consented location', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: { temperature_2m: 23.4, wind_speed_10m: 8, weather_code: 1, time: '2026-11-02T19:15' } }) });
    const service = new OpenMeteoWeatherService({ location: async () => ({ label: 'São Paulo', latitude: -23.5, longitude: -46.6 }), fetcher });

    await expect(service.current('pt-BR')).resolves.toContain('São Paulo');
    await expect(service.current('pt-BR')).resolves.toContain('23,4');
    await expect(service.current('pt-BR')).resolves.toContain('Open-Meteo');
    await expect(service.current('pt-BR')).resolves.toContain('19:15');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('latitude=-23.5'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reuses a fresh location cache and serves stale data during a provider outage', async () => {
    let now = 1_000;
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ current: { temperature_2m: 23.4, wind_speed_10m: 8, weather_code: 1, time: '2026-11-02T19:15' } }) })
      .mockRejectedValueOnce(new Error('network down'));
    const service = new OpenMeteoWeatherService({
      location: async () => ({ label: 'São Paulo', latitude: -23.5, longitude: -46.6 }),
      fetcher,
      cacheTtlMs: 300_000,
      now: () => now,
    });

    await expect(service.current('en-US')).resolves.toContain('23.4');
    await expect(service.current('en-US')).resolves.toContain('23.4');
    expect(fetcher).toHaveBeenCalledOnce();

    now = 301_001;
    await expect(service.current('en-US')).resolves.toContain('cached');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports provider failures instead of inventing a forecast', async () => {
    const service = new OpenMeteoWeatherService({ location: async () => ({ label: 'São Paulo', latitude: -23.5, longitude: -46.6 }), fetcher: async () => ({ ok: false, json: async () => ({}) }) });

    await expect(service.current('pt-BR')).rejects.toThrow('weather_unavailable');
  });

  it('aborts a provider that exceeds the response deadline', async () => {
    const service = new OpenMeteoWeatherService({
      location: async () => ({ label: 'São Paulo', latitude: -23.5, longitude: -46.6 }),
      timeoutMs: 10,
      fetcher: async (_url, options) => await new Promise((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) throw new Error('missing signal');
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });

    await expect(service.current('pt-BR')).rejects.toThrow('weather_timeout');
  });
});
