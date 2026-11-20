import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { RemoteScope } from './contracts/v1';

export interface SecurityConfig {
  bindHost: string;
  allowNonLoopback: boolean;
  authTokenHash: string;
  signingSecret: string;
  allowedOrigins: string[];
  allowedRoots: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  onAudit?: (entry: {
    method: string;
    path: string;
    remoteIp: string;
    actor: string;
    statusCode: number;
    detail: string;
  }) => void;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function assertSafeBindHost(bindHost: string, allowNonLoopback: boolean): void {
  const normalized = bindHost.trim().toLowerCase();
  const isLoopback = normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
  if (!isLoopback && !allowNonLoopback) {
    throw new Error(
      `Recusado bind inseguro em "${bindHost}". O Aethera Remote Host deve escutar em 127.0.0.1 e ser exposto apenas via túnel HTTPS (ngrok/Cloudflare).`,
    );
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_API_KEY]')
    .replace(/(AIza[0-9A-Za-z_-]{20,})/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/(ANTHROPIC_(?:API_KEY|AUTH_TOKEN)\s*=\s*)[^\s'"]+/gi, '$1[REDACTED]')
    .replace(/(ELEVENLABS_API_KEY\s*=\s*)[^\s'"]+/gi, '$1[REDACTED]');
}

export function isPathInsideAllowedRoots(candidatePath: string, allowedRoots: readonly string[]): boolean {
  if (!candidatePath || allowedRoots.length === 0) return false;
  const resolvedCandidate = fs.existsSync(candidatePath)
    ? fs.realpathSync(candidatePath)
    : path.resolve(candidatePath);

  return allowedRoots.some((root) => {
    const resolvedRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    const rel = path.relative(resolvedRoot, resolvedCandidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

export interface SignedArtifactTicket {
  artifactId: string;
  exp: number;
  sig: string;
}

export function createArtifactTicket(
  artifactId: string,
  signingSecret: string,
  ttlSeconds = 60,
): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${artifactId}.${exp}`;
  const sig = crypto.createHmac('sha256', signingSecret).update(payload).digest('base64url');
  return {
    token: `${exp}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyArtifactTicket(
  artifactId: string,
  token: string | undefined,
  signingSecret: string,
): boolean {
  if (!token) return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const expStr = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(`${artifactId}.${exp}`)
    .digest('base64url');
  return constantTimeEqualHex(sig, expected);
}

export function createCorsMiddleware(allowedOrigins: readonly string[]) {
  const normalizedAllowed = allowedOrigins.map((o) => o.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);

  return (req: Request, res: Response, next: NextFunction): void => {
    const originHeader = req.headers.origin;
    if (!originHeader) {
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    const normalizedOrigin = originHeader.trim().replace(/\/+$/, '').toLowerCase();
    const isAllowed = normalizedAllowed.some((allowed) => {
      if (allowed === normalizedOrigin) return true;
      if (allowed.startsWith('https://*.')) {
        const suffix = allowed.slice('https://*'.length);
        return normalizedOrigin.startsWith('https://') && normalizedOrigin.endsWith(suffix);
      }
      return false;
    });

    if (!isAllowed) {
      res.status(403).json({
        error: `Origem CORS não autorizada: ${originHeader}. Configure AETHERA_ALLOWED_ORIGINS no Remote Host.`,
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, Accept, Last-Event-ID, Idempotency-Key, X-Aethera-Client, ngrok-skip-browser-warning',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Disposition');
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function createRateLimiter(windowMs: number, maxRequests: number) {
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const prev = buckets.get(ip) ?? [];
    const recent = prev.filter((ts) => ts > cutoff);
    recent.push(now);
    buckets.set(ip, recent);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - recent.length)));

    if (recent.length > maxRequests) {
      res.status(429).json({
        error: 'Limite de requisições excedido (rate limiting). Aguarde alguns segundos antes de tentar novamente.',
      });
      return;
    }
    next();
  };
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function createAuthMiddleware(config: SecurityConfig) {
  return (requiredScope: RemoteScope) =>
    (req: Request, res: Response, next: NextFunction): void => {
      const token = extractBearerToken(req);
      const remoteIp = req.ip || req.socket.remoteAddress || 'unknown';

      if (!token) {
        config.onAudit?.({
          method: req.method,
          path: req.path,
          remoteIp,
          actor: 'anonymous',
          statusCode: 401,
          detail: `Token Bearer ausente para escopo ${requiredScope}`,
        });
        res.status(401).json({ error: 'Autenticação obrigatória (Authorization: Bearer <token>).' });
        return;
      }

      const providedHash = sha256Hex(token);
      if (!constantTimeEqualHex(providedHash, config.authTokenHash)) {
        config.onAudit?.({
          method: req.method,
          path: req.path,
          remoteIp,
          actor: 'invalid-token',
          statusCode: 403,
          detail: `Token inválido rejeitado para escopo ${requiredScope}`,
        });
        res.status(403).json({ error: 'Token de acesso remoto inválido ou revogado.' });
        return;
      }

      config.onAudit?.({
        method: req.method,
        path: req.path,
        remoteIp,
        actor: 'remote-owner',
        statusCode: 200,
        detail: `Autorizado (${requiredScope})`,
      });
      next();
    };
}
