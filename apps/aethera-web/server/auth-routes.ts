import type { Express, Request, Response } from 'express';
import {
  BruteForceGuard,
  clearSessionCookie,
  getClientIp,
  parseCookies,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  type AuthenticatedRequest,
} from './auth-middleware';
import type { AuthStore } from './auth-store';
import { timingSafeEqualString } from './crypto-vault';
import { probeRemoteHostConnection } from './remote-proxy';
import { validateSafeRemoteHostUrl, type SsrfValidationOptions } from './ssrf-guard';

export interface AuthRoutesOptions {
  /** Deployment-level secret protecting initial admin bootstrap. Required in production. */
  adminSetupToken?: string;
  isProduction?: boolean;
  ssrfOptions?: SsrfValidationOptions;
  /** Optional hook for tests or out-of-band email delivery when a password reset code is created. */
  onPasswordResetIssued?: (payload: { email: string; userId: string; rawCode: string; expiresAt: string }) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'A senha deve ter no mínimo 10 caracteres.';
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'A senha deve incluir letras e números.';
  }
  return null;
}

export function registerAuthAndComputerRoutes(
  app: Express,
  authStore: AuthStore,
  requireAuth: (req: Request, res: Response, next: () => void) => void,
  requireCsrf: (req: Request, res: Response, next: () => void) => void,
  opts: AuthRoutesOptions = {},
): void {
  const isProd = opts.isProduction ?? process.env.NODE_ENV === 'production';
  const setupToken = (opts.adminSetupToken ?? process.env.AETHERA_ADMIN_SETUP_TOKEN ?? '').trim();
  const setupTokenRequired = Boolean(setupToken) || isProd;

  const loginGuard = new BruteForceGuard(5, 15 * 60 * 1000);
  const resetGuard = new BruteForceGuard(5, 15 * 60 * 1000);

  // --- Public Auth Status & Session Hydration ---
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const userCount = authStore.countUsers();
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (rawToken) {
      const validated = authStore.validateSessionToken(rawToken);
      if (validated) {
        if (validated.renewed) {
          setSessionCookie(req, res, rawToken, 30 * 24 * 60 * 60);
        }
        const computers = authStore.listComputersForUser(validated.user.id);
        res.json({
          authenticated: true,
          setupRequired: false,
          setupTokenRequired,
          user: validated.user,
          sessionId: validated.session.id,
          csrfToken: validated.session.csrfToken,
          computers,
        });
        return;
      }
      clearSessionCookie(req, res);
    }

    res.json({
      authenticated: false,
      setupRequired: userCount === 0,
      setupTokenRequired,
      user: null,
      sessionId: null,
      csrfToken: null,
      computers: [],
    });
  });

  // --- Initial Admin Bootstrap (strictly protected; NO indiscriminate public registration) ---
  app.post('/api/auth/setup-admin', async (req: Request, res: Response) => {
    if (authStore.countUsers() > 0) {
      res.status(403).json({
        error: 'O cadastro público está desativado. O administrador inicial já foi configurado.',
        code: 'SIGNUP_DISABLED',
      });
      return;
    }

    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] ?? '');
    const ipCheck = loginGuard.isBlocked(`setup:${ip}`);
    if (ipCheck.blocked) {
      res.status(429).json({
        error: `Muitas tentativas. Aguarde ${ipCheck.retryAfterSec}s antes de tentar novamente.`,
      });
      return;
    }

    const body = req.body as {
      email?: string;
      name?: string;
      password?: string;
      setupToken?: string;
    };

    if (setupTokenRequired) {
      if (!setupToken) {
        res.status(503).json({
          error:
            'AETHERA_ADMIN_SETUP_TOKEN não está configurado no servidor de produção. Defina a variável de ambiente para criar o administrador.',
        });
        return;
      }
      const provided = String(body.setupToken ?? '').trim();
      if (!provided || !timingSafeEqualString(provided, setupToken)) {
        loginGuard.recordFailure(`setup:${ip}`);
        authStore.recordAudit({
          eventType: 'admin_setup_denied',
          ipAddress: ip,
          userAgent: ua,
          detail: 'Tentativa de cadastro inicial com token de implantação inválido.',
        });
        res.status(403).json({ error: 'Token de implantação inválido.' });
        return;
      }
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    const password = String(body.password ?? '');

    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
      return;
    }
    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) {
      res.status(400).json({ error: pwdErr });
      return;
    }

    try {
      const user = await authStore.createUser({
        email,
        name: name || email.split('@')[0],
        password,
        role: 'admin',
      });
      const { rawToken, session, maxAgeSec } = authStore.createSession({
        userId: user.id,
        ipAddress: ip,
        userAgent: ua,
      });

      setSessionCookie(req, res, rawToken, maxAgeSec);
      loginGuard.reset(`setup:${ip}`);
      authStore.recordAudit({
        userId: user.id,
        eventType: 'admin_setup_completed',
        ipAddress: ip,
        userAgent: ua,
        detail: `Administrador inicial configurado (${user.email}). Cadastro público bloqueado.`,
      });

      res.status(201).json({
        authenticated: true,
        user,
        sessionId: session.id,
        csrfToken: session.csrfToken,
        computers: [],
      });
    } catch {
      res.status(409).json({ error: 'Não foi possível concluir o cadastro inicial.' });
    }
  });

  // --- Login (Argon2id + Brute-force Protection + Anti-Enumeration) ---
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] ?? '');
    const body = req.body as { email?: string; password?: string };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    const ipKey = `login:ip:${ip}`;
    const emailKey = `login:email:${email}`;
    const ipStatus = loginGuard.isBlocked(ipKey);
    const emailStatus = email ? loginGuard.isBlocked(emailKey) : { blocked: false, retryAfterSec: 0 };

    if (ipStatus.blocked || emailStatus.blocked) {
      const waitSec = Math.max(ipStatus.retryAfterSec, emailStatus.retryAfterSec);
      res.setHeader('Retry-After', String(waitSec));
      res.status(429).json({
        error: `Muitas tentativas de login. Aguarde ${waitSec}s antes de tentar novamente.`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    if (!EMAIL_REGEX.test(email) || !password) {
      loginGuard.recordFailure(ipKey);
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      return;
    }

    const user = await authStore.verifyCredentials(email, password);
    if (!user) {
      loginGuard.recordFailure(ipKey);
      loginGuard.recordFailure(emailKey);
      authStore.recordAudit({
        eventType: 'login_failed',
        ipAddress: ip,
        userAgent: ua,
        detail: 'Credenciais inválidas informadas no login.',
      });
      // Identical generic message prevents user enumeration
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
      return;
    }

    loginGuard.reset(ipKey);
    loginGuard.reset(emailKey);

    const { rawToken, session, maxAgeSec } = authStore.createSession({
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
    });
    setSessionCookie(req, res, rawToken, maxAgeSec);

    authStore.recordAudit({
      userId: user.id,
      eventType: 'login_success',
      ipAddress: ip,
      userAgent: ua,
      detail: `Sessão criada (${session.deviceLabel}).`,
    });

    res.json({
      authenticated: true,
      user,
      sessionId: session.id,
      csrfToken: session.csrfToken,
      computers: authStore.listComputersForUser(user.id),
    });
  });

  // --- Logout & Session Revocation ---
  app.post('/api/auth/logout', requireAuth, requireCsrf, (req: AuthenticatedRequest, res: Response) => {
    const { user, session } = req.auth!;
    authStore.revokeSession(session.id, user.id);
    clearSessionCookie(req, res);
    authStore.recordAudit({
      userId: user.id,
      eventType: 'logout',
      ipAddress: getClientIp(req),
      userAgent: String(req.headers['user-agent'] ?? ''),
      detail: `Sessão ${session.id} encerrada pelo usuário.`,
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-all', requireAuth, requireCsrf, (req: AuthenticatedRequest, res: Response) => {
    const { user, session } = req.auth!;
    const includeCurrent = Boolean((req.body as { includeCurrent?: boolean })?.includeCurrent);
    const revoked = authStore.revokeAllSessionsForUser(user.id, includeCurrent ? undefined : session.id);
    if (includeCurrent) {
      clearSessionCookie(req, res);
    }
    authStore.recordAudit({
      userId: user.id,
      eventType: 'sessions_revoked_all',
      ipAddress: getClientIp(req),
      detail: `${revoked} sessão(ões) revogada(s)${includeCurrent ? ' (incluindo atual)' : ' (outros dispositivos)'}.`,
    });
    res.json({ ok: true, revokedCount: revoked });
  });

  app.get('/api/auth/sessions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { user, session } = req.auth!;
    res.json({
      sessions: authStore.listSessionsForUser(user.id, session.id),
      auditLogs: authStore.listAuditLogsForUser(user.id, 25),
    });
  });

  app.delete(
    '/api/auth/sessions/:sessionId',
    requireAuth,
    requireCsrf,
    (req: AuthenticatedRequest, res: Response) => {
      const { user, session } = req.auth!;
      const targetId = String(req.params.sessionId);
      const revoked = authStore.revokeSession(targetId, user.id);
      if (!revoked) {
        res.status(404).json({ error: 'Sessão não encontrada.' });
        return;
      }
      if (targetId === session.id) {
        clearSessionCookie(req, res);
      }
      authStore.recordAudit({
        userId: user.id,
        eventType: 'session_revoked',
        ipAddress: getClientIp(req),
        detail: `Sessão ${targetId} revogada manualmente.`,
      });
      res.json({ ok: true, revokedCurrent: targetId === session.id });
    },
  );

  // --- Change Password (Authenticated) ---
  app.post(
    '/api/auth/change-password',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const { user, session } = req.auth!;
      const body = req.body as { currentPassword?: string; newPassword?: string };
      const verified = await authStore.verifyCredentials(user.email, String(body.currentPassword ?? ''));
      if (!verified) {
        res.status(401).json({ error: 'Senha atual incorreta.' });
        return;
      }
      const pwdErr = validatePasswordStrength(String(body.newPassword ?? ''));
      if (pwdErr) {
        res.status(400).json({ error: pwdErr });
        return;
      }
      await authStore.updatePassword(user.id, String(body.newPassword));
      authStore.revokeAllSessionsForUser(user.id, session.id);
      authStore.recordAudit({
        userId: user.id,
        eventType: 'password_changed',
        ipAddress: getClientIp(req),
        detail: 'Senha atualizada com Argon2id; outras sessões foram revogadas.',
      });
      res.json({ ok: true });
    },
  );

  // --- Password Recovery (Anti-Enumeration + Zero Token Exposure in HTTP Response) ---
  app.post('/api/auth/password-reset/request', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const check = resetGuard.isBlocked(`reset:${ip}`);
    if (check.blocked) {
      res.status(429).json({
        error: `Muitas solicitações de recuperação. Aguarde ${check.retryAfterSec}s.`,
      });
      return;
    }
    resetGuard.recordFailure(`reset:${ip}`);

    const email = String((req.body as { email?: string })?.email ?? '').trim().toLowerCase();
    if (EMAIL_REGEX.test(email)) {
      const created = authStore.createPasswordResetByEmail(email);
      if (created.created && created.userId && created.rawCode && created.expiresAt) {
        authStore.recordAudit({
          userId: created.userId,
          eventType: 'password_reset_requested',
          ipAddress: ip,
          detail: 'Código seguro de recuperação gerado (expira em 30 min; nunca exposto na resposta HTTP).',
        });
        // Out-of-band delivery hook (server-side only; NEVER returned in HTTP response)
        opts.onPasswordResetIssued?.({
          email,
          userId: created.userId,
          rawCode: created.rawCode,
          expiresAt: created.expiresAt,
        });
      }
    }

    // Always identical response to prevent user enumeration and never expose tokens
    res.json({
      ok: true,
      message:
        'Se o e-mail estiver cadastrado, um código temporário de recuperação foi emitido pelo canal seguro do servidor.',
    });
  });

  app.post('/api/auth/password-reset/confirm', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const check = resetGuard.isBlocked(`reset-confirm:${ip}`);
    if (check.blocked) {
      res.status(429).json({
        error: `Muitas tentativas inválidas. Aguarde ${check.retryAfterSec}s.`,
      });
      return;
    }

    const body = req.body as { code?: string; newPassword?: string };
    const code = String(body.code ?? '').trim();
    const newPassword = String(body.newPassword ?? '');

    const pwdErr = validatePasswordStrength(newPassword);
    if (pwdErr) {
      res.status(400).json({ error: pwdErr });
      return;
    }

    const userId = await authStore.consumePasswordReset(code, newPassword);
    if (!userId) {
      resetGuard.recordFailure(`reset-confirm:${ip}`);
      res.status(400).json({ error: 'Código de recuperação inválido ou expirado.' });
      return;
    }

    resetGuard.reset(`reset-confirm:${ip}`);
    authStore.recordAudit({
      userId,
      eventType: 'password_reset_completed',
      ipAddress: ip,
      detail: 'Senha redefinida via código seguro; todas as sessões anteriores foram revogadas.',
    });
    res.json({ ok: true });
  });

  // --- Admin-Only Member Creation (Optional multi-user without public signup) ---
  app.post('/api/auth/users', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    if (req.auth!.user.role !== 'admin') {
      res.status(403).json({ error: 'Apenas administradores podem adicionar contas.' });
      return;
    }
    const body = req.body as { email?: string; name?: string; password?: string; role?: 'admin' | 'member' };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'E-mail inválido.' });
      return;
    }
    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) {
      res.status(400).json({ error: pwdErr });
      return;
    }
    try {
      const created = await authStore.createUser({
        email,
        name: String(body.name ?? '').trim() || email.split('@')[0],
        password,
        role: body.role === 'admin' ? 'admin' : 'member',
      });
      authStore.recordAudit({
        userId: req.auth!.user.id,
        eventType: 'user_created',
        ipAddress: getClientIp(req),
        detail: `Conta criada para ${created.email} (${created.role}).`,
      });
      res.status(201).json({ user: created });
    } catch {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
    }
  });

  // ============================================================================
  // Meus Computadores (Encrypted Remote Host Binding per Authenticated User)
  // ============================================================================

  app.get('/api/computers', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      computers: authStore.listComputersForUser(req.auth!.user.id),
    });
  });

  app.post('/api/computers', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const body = req.body as {
      name?: string;
      baseUrl?: string;
      bearerToken?: string;
      stableHostId?: string;
      autoConnect?: boolean;
      setActive?: boolean;
    };

    const name = String(body.name ?? '').trim();
    const rawUrl = String(body.baseUrl ?? '').trim();
    const bearerToken = String(body.bearerToken ?? '').trim();

    if (name.length < 2) {
      res.status(400).json({ error: 'Informe um nome para o computador (ex.: PC Principal Windows).' });
      return;
    }
    if (bearerToken.length < 12) {
      res.status(400).json({ error: 'Informe a credencial (token Bearer) válida do Aethera Remote Host.' });
      return;
    }

    let normalizedUrl: string;
    try {
      const validated = await validateSafeRemoteHostUrl(rawUrl, opts.ssrfOptions);
      normalizedUrl = validated.normalizedUrl;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'URL recusada pela proteção anti-SSRF.' });
      return;
    }

    const computer = authStore.createComputer({
      userId,
      name,
      baseUrl: normalizedUrl,
      bearerToken,
      stableHostId: body.stableHostId,
      autoConnect: body.autoConnect !== false,
      setActive: body.setActive !== false,
    });

    // Probe immediately so user gets real connection status right away (non-blocking if offline)
    const probe = await probeRemoteHostConnection(normalizedUrl, bearerToken, opts.ssrfOptions);
    if (probe.ok) {
      authStore.updateComputerConnectionTelemetry(userId, computer.id, 'online', {
        stableHostId: probe.hostStatus?.hostname
          ? `host_${probe.hostStatus.hostname.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`
          : undefined,
      });
    } else {
      authStore.updateComputerConnectionTelemetry(userId, computer.id, probe.offline ? 'offline' : 'error', {
        error: probe.error ?? 'PC offline.',
      });
    }

    authStore.recordAudit({
      userId,
      eventType: 'computer_linked',
      ipAddress: getClientIp(req),
      detail: `Computador "${computer.name}" vinculado com credencial criptografada AES-256-GCM (${computer.tokenFingerprint}).`,
    });

    res.status(201).json({
      computer: authStore.getComputerPublic(userId, computer.id),
      probe: { ok: probe.ok, offline: probe.offline ?? false, error: probe.error ?? null },
    });
  });

  app.patch('/api/computers/:id', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computerId = String(req.params.id);
    const body = req.body as {
      name?: string;
      baseUrl?: string;
      autoConnect?: boolean;
      isActive?: boolean;
      stableHostId?: string;
    };

    let normalizedUrl: string | undefined;
    if (body.baseUrl !== undefined) {
      try {
        const validated = await validateSafeRemoteHostUrl(body.baseUrl, opts.ssrfOptions);
        normalizedUrl = validated.normalizedUrl;
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'URL recusada pela proteção anti-SSRF.' });
        return;
      }
    }

    const updated = authStore.updateComputer(userId, computerId, {
      name: body.name,
      baseUrl: normalizedUrl,
      autoConnect: body.autoConnect,
      isActive: body.isActive,
      stableHostId: body.stableHostId,
    });
    if (!updated) {
      res.status(404).json({ error: 'Computador não encontrado.' });
      return;
    }

    authStore.recordAudit({
      userId,
      eventType: 'computer_updated',
      ipAddress: getClientIp(req),
      detail: `Configuração do computador "${updated.name}" atualizada.`,
    });
    res.json({ computer: updated });
  });

  app.post('/api/computers/:id/rotate', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computerId = String(req.params.id);
    const body = req.body as { bearerToken?: string; baseUrl?: string };
    const newToken = String(body.bearerToken ?? '').trim();
    if (newToken.length < 12) {
      res.status(400).json({ error: 'Informe uma nova credencial válida do Remote Host.' });
      return;
    }

    let normalizedUrl: string | undefined;
    if (body.baseUrl?.trim()) {
      try {
        const validated = await validateSafeRemoteHostUrl(body.baseUrl, opts.ssrfOptions);
        normalizedUrl = validated.normalizedUrl;
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'URL inválida.' });
        return;
      }
    }

    const updated = authStore.rotateComputerCredential(userId, computerId, newToken, normalizedUrl);
    if (!updated) {
      res.status(404).json({ error: 'Computador não encontrado.' });
      return;
    }

    authStore.recordAudit({
      userId,
      eventType: 'computer_credential_rotated',
      ipAddress: getClientIp(req),
      detail: `Credencial do computador "${updated.name}" rotacionada (${updated.tokenFingerprint}).`,
    });
    res.json({ computer: updated });
  });

  app.post('/api/computers/:id/revoke', requireAuth, requireCsrf, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computerId = String(req.params.id);
    const revoked = authStore.revokeComputerCredential(userId, computerId);
    if (!revoked) {
      res.status(404).json({ error: 'Computador não encontrado.' });
      return;
    }
    authStore.recordAudit({
      userId,
      eventType: 'computer_credential_revoked',
      ipAddress: getClientIp(req),
      detail: `Credencial do computador "${revoked.name}" revogada e desconectada.`,
    });
    res.json({ computer: revoked });
  });

  app.post('/api/computers/:id/test', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computerId = String(req.params.id);
    const target = authStore.getActiveComputerWithSecret(userId, computerId);
    if (!target) {
      res.status(404).json({ error: 'Computador sem credencial ativa ou não encontrado.' });
      return;
    }

    const probe = await probeRemoteHostConnection(target.computer.baseUrl, target.bearerToken, opts.ssrfOptions);
    if (probe.ok) {
      authStore.updateComputerConnectionTelemetry(userId, computerId, 'online', {
        stableHostId: probe.hostStatus?.hostname
          ? `host_${probe.hostStatus.hostname.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`
          : undefined,
      });
    } else {
      authStore.updateComputerConnectionTelemetry(userId, computerId, probe.offline ? 'offline' : 'error', {
        error: probe.error ?? 'PC offline.',
      });
    }

    res.json({
      ok: probe.ok,
      offline: probe.offline ?? false,
      error: probe.error ?? null,
      computer: authStore.getComputerPublic(userId, computerId),
    });
  });

  app.delete('/api/computers/:id', requireAuth, requireCsrf, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computerId = String(req.params.id);
    const existing = authStore.getComputerPublic(userId, computerId);
    if (!existing) {
      res.status(404).json({ error: 'Computador não encontrado.' });
      return;
    }
    authStore.deleteComputer(userId, computerId);
    authStore.recordAudit({
      userId,
      eventType: 'computer_deleted',
      ipAddress: getClientIp(req),
      detail: `Computador "${existing.name}" removido da conta.`,
    });
    res.json({ ok: true });
  });
}
