import { httpStatusError, toProviderError } from './resilience.js';
import { MediaProviderError, type MediaProviderKey, type ProviderHealthResult } from './types.js';

export const PROVIDER_USER_AGENT = 'AetheraStudio/0.1 (desktop media acquisition; +https://github.com/neuralbridge)';

export interface HttpJsonResult<T> {
  data: T;
  headers: Headers;
  status: number;
}

/** GET/POST JSON with typed provider errors. Never puts credentials in the error text. */
export async function requestJson<T>(
  provider: MediaProviderKey,
  url: string,
  init: { fetchImpl?: typeof fetch; headers?: Record<string, string>; signal?: AbortSignal; method?: string; body?: string; redact?: string[] },
): Promise<HttpJsonResult<T>> {
  const fetchFn = init.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: init.method ?? 'GET',
      headers: { 'User-Agent': PROVIDER_USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    throw redactError(toProviderError(provider, error, init.signal), init.redact);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = httpStatusError(provider, res.status, res.headers, redact(body, init.redact));
    if (err) throw err;
  }
  try {
    return { data: (await res.json()) as T, headers: res.headers, status: res.status };
  } catch {
    throw new MediaProviderError('invalid_response', provider, 'resposta não é JSON válido.', false);
  }
}

function redact(text: string, secrets: string[] | undefined): string {
  let out = text;
  for (const s of secrets ?? []) if (s && s.length >= 4) out = out.split(s).join('••••');
  return out;
}

function redactError(err: MediaProviderError, secrets: string[] | undefined): MediaProviderError {
  if (!secrets?.length) return err;
  const message = redact(err.message.replace(/^[^:]+: [^:]+: /, ''), secrets);
  return new MediaProviderError(err.code, err.provider, message, err.retryable, err.retryAfterMs);
}

export async function healthFromProbe(provider: MediaProviderKey, probe: () => Promise<number>, now = () => Date.now()): Promise<ProviderHealthResult> {
  const started = now();
  try {
    const count = await probe();
    return { connectivity: 'ok', latencyMs: now() - started, detail: `Conectado (${count} resultado(s) na consulta de teste).`, checkedAt: new Date().toISOString() };
  } catch (error) {
    const err = toProviderError(provider, error);
    const connectivity =
      err.code === 'auth_failed' ? 'auth_failed' : err.code === 'auth_missing' ? 'auth_missing' : err.code === 'rate_limited' ? 'rate_limited' : 'down';
    return { connectivity, latencyMs: now() - started, detail: err.message, checkedAt: new Date().toISOString() };
  }
}

export const nowIso = () => new Date().toISOString();
