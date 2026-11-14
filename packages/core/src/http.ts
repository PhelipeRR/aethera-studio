import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BODY_LIMITS, CORE_CONTRACT_VERSION, coreError, httpStatusOf, VERSION_HEADERS, type CoreError, type CoreErrorCode } from '@neuralbridge/shared/core-api';
import type { ZodType } from 'zod';

/*
 * CORE-05: small HTTP helpers shared by the Core's domain routes. JSON only; bodies are size-capped and validated with
 * the CORE-02 schemas; every failure is the contract error envelope.
 */

export class HttpError extends Error {
  constructor(readonly code: CoreErrorCode, message: string, readonly extra: Partial<CoreError['error']> = {}) { super(message); }
}

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', [VERSION_HEADERS.server]: CORE_CONTRACT_VERSION, ...headers });
  response.end(payload);
}

export function sendError(response: ServerResponse, error: unknown, correlationId: string | null = null): void {
  if (error instanceof HttpError) {
    sendJson(response, httpStatusOf(error.code), coreError(error.code, error.message.slice(0, 500), { correlationId, ...error.extra }));
    return;
  }
  // Domain errors use the existing "code: message" convention (not_found:, invalid:, forbidden:, unavailable:).
  const message = error instanceof Error ? error.message : 'Erro interno.';
  const prefix = /^([a-z_]+):\s*/.exec(message);
  const mapped: Record<string, CoreErrorCode> = { not_found: 'not_found', invalid: 'invalid_request', forbidden: 'forbidden', unavailable: 'host_unavailable', conflict: 'conflict' };
  const key = prefix?.[1];
  const code: CoreErrorCode = (key ? mapped[key] : undefined) ?? 'internal';
  sendJson(response, httpStatusOf(code), coreError(code, code === 'internal' ? 'Erro interno no Core.' : message.slice(prefix?.[0].length ?? 0, 500) || 'Erro.', { correlationId }));
}

export async function readJson<T>(request: IncomingMessage, schema: ZodType<T>, limit: number = BODY_LIMITS.defaultBytes): Promise<T> {
  const type = request.headers['content-type'] ?? '';
  // Requiring JSON also forces a CORS preflight on any browser request, which the Core never answers.
  if (!/^application\/json\b/i.test(type)) throw new HttpError('invalid_request', 'Envie Content-Type: application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError('payload_too_large', `Corpo acima de ${limit} bytes.`);
    chunks.push(chunk as Buffer);
  }
  let raw: unknown;
  try { raw = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw new HttpError('invalid_request', 'JSON inválido.'); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError('invalid_request', 'Requisição inválida.', { details: { fields: parsed.error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join('.').slice(0, 200), message: issue.message.slice(0, 200) })) } });
  return parsed.data;
}

/** Constant-time check of `Authorization: Bearer <token>`. */
export function bearerMatches(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? '';
  const match = /^Bearer\s+([A-Za-z0-9._~-]{16,512})$/.exec(header);
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A route pattern like /api/v1/tasks/{id}/cancel → params, or null. Segment by segment, no regex from input. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] ?? '';
    const got = actual[index] ?? '';
    const name = /^\{([a-zA-Z]+)\}$/.exec(want)?.[1];
    if (name) {
      if (!got) return null;
      try { params[name] = decodeURIComponent(got); } catch { return null; }
    } else if (want !== got) return null;
  }
  return params;
}
