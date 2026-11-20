import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqualString } from './crypto-vault';
import type { AuthSessionInternal, AuthStore, AuthUserPublic } from './auth-store';

export const SESSION_COOKIE_NAME = 'aethera_sid';

export interface AuthenticatedRequest extends Request {
  auth?: {
    user: AuthUserPublic;
    session: AuthSessionInternal;
  };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export function setSessionCookie(req: Request, res: Response, rawToken: string, maxAgeSec: number): void {
  const secure = isSecureRequest(req);
  // Over HTTPS (including AI Studio preview iframe + direct HTTPS + mobile), SameSite=None; Secure works reliably
  // and is protected by Synchronizer Token CSRF + Origin verification. Over plain HTTP localhost dev, use SameSite=Lax.
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureRequest(req);
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createHttpsEnforcementMiddleware(enforceHttps: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enforceHttps) {
      next();
      return;
    }
    if (req.path === '/api/health') {
      next();
      return;
    }
    if (!isSecureRequest(req)) {
      res.status(403).json({
        error: 'Conexão HTTPS obrigatória em produção.',
      });
      return;
    }
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function createRestrictiveCorsMiddleware(allowedOrigins: string[]) {
  const allowSet = new Set(allowedOrigins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    const cleanOrigin = origin.replace(/\/+$/, '');
    const hostHeader = req.headers.host;
    const sameOriginHttp = hostHeader ? `http://${hostHeader}` : '';
    const sameOriginHttps = hostHeader ? `https://${hostHeader}` : '';

    if (cleanOrigin === sameOriginHttp || cleanOrigin === sameOriginHttps || allowSet.has(cleanOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Idempotency-Key, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    res.status(403).json({ error: 'Origem CORS não autorizada.' });
  };
}

export class BruteForceGuard {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  public isBlocked(key: string): { blocked: boolean; retryAfterSec: number } {
    const now = Date.now();
    const rec = this.buckets.get(key);
    if (!rec) return { blocked: false, retryAfterSec: 0 };
    if (rec.resetAt <= now) {
      this.buckets.delete(key);
      return { blocked: false, retryAfterSec: 0 };
    }
    if (rec.count >= this.maxAttempts) {
      return { blocked: true, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  public recordFailure(key: string): void {
    const now = Date.now();
    const rec = this.buckets.get(key);
    if (!rec || rec.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    rec.count += 1;
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }
}

export function createGeneralRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getClientIp(req);
    const now = Date.now();
    const rec = buckets.get(key);
    if (!rec || rec.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    rec.count += 1;
    if (rec.count > maxRequests) {
      res.status(429).json({ error: 'Limite de requisições excedido. Tente novamente em instantes.' });
      return;
    }
    next();
  };
}

export function createRequireAuthMiddleware(authStore: AuthStore) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken) {
      res.status(401).json({ error: 'Autenticação necessária.', code: 'UNAUTHENTICATED' });
      return;
    }

    const validated = authStore.validateSessionToken(rawToken);
    if (!validated) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Sessão expirada ou revogada. Faça login novamente.', code: 'SESSION_INVALID' });
      return;
    }

    if (validated.renewed) {
      setSessionCookie(req, res, rawToken, 30 * 24 * 60 * 60);
    }

    req.auth = {
      user: validated.user,
      session: validated.session,
    };
    next();
  };
}

export function createRequireCsrfMiddleware(allowedOrigins: string[]) {
  const allowSet = new Set(allowedOrigins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    if (!req.auth) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    // 1. Validate Origin header when provided by browser
    const origin = req.headers.origin;
    if (origin) {
      const cleanOrigin = origin.replace(/\/+$/, '');
      const hostHeader = req.headers.host;
      const sameOriginHttp = hostHeader ? `http://${hostHeader}` : '';
      const sameOriginHttps = hostHeader ? `https://${hostHeader}` : '';
      if (cleanOrigin !== sameOriginHttp && cleanOrigin !== sameOriginHttps && !allowSet.has(cleanOrigin)) {
        res.status(403).json({ error: 'Origem CSRF inválida.', code: 'CSRF_ORIGIN_MISMATCH' });
        return;
      }
    }

    // 2. Validate Synchronizer CSRF Token bound to the server-side session
    const headerToken = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'].trim() : '';
    if (!headerToken || !timingSafeEqualString(headerToken, req.auth.session.csrfToken)) {
      res.status(403).json({ error: 'Token CSRF ausente ou inválido.', code: 'CSRF_INVALID' });
      return;
    }

    next();
  };
}
