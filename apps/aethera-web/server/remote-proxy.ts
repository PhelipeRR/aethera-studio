import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Express, Request, Response } from 'express';
import type {
  ArtifactTicketResponse,
  CreateRemoteJobRequest,
  RemoteAgentsResponse,
  RemoteHealthResponse,
  RemoteHostStatusResponse,
  RemoteJobDetailResponse,
  RemoteJobsListResponse,
  RemoteOperationType,
  RemoteProjectsResponse,
  SyncMediaTicketResponse,
  SyncSnapshotResponse,
} from '../../aethera-remote-host/src/contracts/v1';
import { getClientIp, type AuthenticatedRequest } from './auth-middleware';
import type { AuthStore, UserRemoteHostWithSecret } from './auth-store';
import { redactSensitiveText } from './crypto-vault';
import { validateSafeRemoteHostUrl, type SsrfValidationOptions } from './ssrf-guard';

const ALLOWED_REMOTE_OPERATIONS = new Set<RemoteOperationType>([
  'cinema.produce',
  'agent.run',
  'cinema.humanize',
  'cinema.youtube_audit',
  'media.acquire',
  'render.ffmpeg',
  'media.probe',
]);

export interface RemoteProxyOptions {
  ssrfOptions?: SsrfValidationOptions;
}

async function fetchRemoteGuarded(
  baseUrl: string,
  endpointPath: string,
  bearerToken: string,
  init: RequestInit & { timeoutMs?: number } = {},
  ssrfOptions?: SsrfValidationOptions,
): Promise<globalThis.Response> {
  // Always re-validate target against SSRF + DNS rebinding before outbound call
  const validated = await validateSafeRemoteHostUrl(baseUrl, ssrfOptions);
  const url = `${validated.normalizedUrl}${endpointPath}`;
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 20_000;
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const upstream = await fetch(url, {
      ...init,
      redirect: 'manual', // CRITICAL anti-SSRF: never follow 30x redirects to internal hosts!
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'ngrok-skip-browser-warning': '1',
        ...(init.headers ?? {}),
      },
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      throw new Error('Redirecionamento HTTP do Remote Host bloqueado pela política anti-SSRF.');
    }

    return upstream;
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

export async function probeRemoteHostConnection(
  baseUrl: string,
  bearerToken: string,
  ssrfOptions?: SsrfValidationOptions,
): Promise<{
  ok: boolean;
  offline?: boolean;
  error?: string;
  health?: RemoteHealthResponse;
  hostStatus?: RemoteHostStatusResponse;
}> {
  try {
    const [healthRes, statusRes] = await Promise.all([
      fetchRemoteGuarded(baseUrl, '/api/health', bearerToken, { method: 'GET', timeoutMs: 8_000 }, ssrfOptions),
      fetchRemoteGuarded(baseUrl, '/api/host/status', bearerToken, { method: 'GET', timeoutMs: 8_000 }, ssrfOptions),
    ]);

    if (statusRes.status === 401 || statusRes.status === 403) {
      return {
        ok: false,
        offline: false,
        error: 'Credencial do Remote Host recusada (HTTP 401/403). Verifique ou rotacione o token.',
      };
    }

    if (!healthRes.ok || !statusRes.ok) {
      return {
        ok: false,
        offline: true,
        error: `Remote Host respondeu HTTP ${statusRes.status}.`,
      };
    }

    const health = (await healthRes.json()) as RemoteHealthResponse;
    const hostStatus = (await statusRes.json()) as RemoteHostStatusResponse;
    return { ok: true, health, hostStatus };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSsrf = /SSRF|HTTPS|Porta|domínio|IP privado|Redirecionamento/i.test(msg);
    return {
      ok: false,
      offline: !isSsrf,
      error: isSsrf ? msg : 'PC Windows indisponível ou desligado no momento.',
    };
  }
}

/**
 * Registers ONLY explicitly authorized remote-host proxy endpoints on the authenticated Express app.
 * No generic HTTP proxy; permanent Remote Host Bearer tokens NEVER leave the backend.
 */
export function registerRemoteProxyRoutes(
  app: Express,
  authStore: AuthStore,
  requireAuth: (req: Request, res: Response, next: () => void) => void,
  requireCsrf: (req: Request, res: Response, next: () => void) => void,
  opts: RemoteProxyOptions = {},
): void {
  const getTarget = (req: AuthenticatedRequest): UserRemoteHostWithSecret | null => {
    const userId = req.auth!.user.id;
    const requestedComputerId =
      typeof req.query.computerId === 'string' && req.query.computerId.trim()
        ? req.query.computerId.trim()
        : undefined;
    return authStore.getActiveComputerWithSecret(userId, requestedComputerId);
  };

  // --- 1. Full Authenticated Bootstrap / Auto-Reconnect Status ---
  app.get('/api/remote-proxy/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth!.user.id;
    const computers = authStore.listComputersForUser(userId);
    const target = getTarget(req);

    if (!target) {
      res.json({
        configured: computers.length > 0,
        connected: false,
        offline: false,
        computer: computers[0] ?? null,
        computers,
        error:
          computers.length > 0
            ? 'Nenhum computador ativo com credencial válida. Ative ou rotacione a credencial em Configurações > Meus Computadores.'
            : null,
      });
      return;
    }

    const { computer, bearerToken } = target;
    try {
      const [healthRes, statusRes, agentsRes, projectsRes, jobsRes, syncRes] = await Promise.all([
        fetchRemoteGuarded(computer.baseUrl, '/api/health', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions),
        fetchRemoteGuarded(computer.baseUrl, '/api/host/status', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions),
        fetchRemoteGuarded(computer.baseUrl, '/api/agents', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions),
        fetchRemoteGuarded(computer.baseUrl, '/api/projects', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions),
        fetchRemoteGuarded(computer.baseUrl, '/api/jobs', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions),
        fetchRemoteGuarded(computer.baseUrl, '/api/sync/snapshot', bearerToken, { method: 'GET', timeoutMs: 10_000 }, opts.ssrfOptions).catch(() => null),
      ]);

      if (statusRes.status === 401 || statusRes.status === 403) {
        const errMsg = 'Token do Remote Host inválido ou revogado no PC Windows.';
        authStore.updateComputerConnectionTelemetry(userId, computer.id, 'error', { error: errMsg });
        res.json({
          configured: true,
          connected: false,
          offline: false,
          authFailed: true,
          computer: authStore.getComputerPublic(userId, computer.id),
          computers: authStore.listComputersForUser(userId),
          error: errMsg,
        });
        return;
      }

      if (!healthRes.ok || !statusRes.ok) {
        const errMsg = `Remote Host respondeu HTTP ${statusRes.status}.`;
        authStore.updateComputerConnectionTelemetry(userId, computer.id, 'offline', { error: errMsg });
        res.json({
          configured: true,
          connected: false,
          offline: true,
          computer: authStore.getComputerPublic(userId, computer.id),
          computers: authStore.listComputersForUser(userId),
          error: 'PC Windows offline ou inacessível no túnel configurado.',
        });
        return;
      }

      const health = (await healthRes.json()) as RemoteHealthResponse;
      const hostStatus = (await statusRes.json()) as RemoteHostStatusResponse;
      const agentsInfo = agentsRes.ok ? ((await agentsRes.json()) as RemoteAgentsResponse) : null;
      const projectsInfo = projectsRes.ok ? ((await projectsRes.json()) as RemoteProjectsResponse) : null;
      const jobsData = jobsRes.ok ? ((await jobsRes.json()) as RemoteJobsListResponse) : { jobs: [] };
      const syncSnapshot =
        syncRes && syncRes.ok ? ((await syncRes.json()) as SyncSnapshotResponse) : null;

      authStore.updateComputerConnectionTelemetry(userId, computer.id, 'online', {
        stableHostId: hostStatus.hostname ? `host_${hostStatus.hostname.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}` : undefined,
      });

      res.json({
        configured: true,
        connected: true,
        offline: false,
        computer: authStore.getComputerPublic(userId, computer.id),
        computers: authStore.listComputersForUser(userId),
        health,
        hostStatus,
        agentsInfo,
        projectsInfo,
        jobs: jobsData.jobs,
        syncSnapshot,
      });
    } catch (err) {
      const safeErr = redactSensitiveText(err instanceof Error ? err.message : String(err));
      const isSsrf = /SSRF|HTTPS|Porta|domínio|IP privado|Redirecionamento/i.test(safeErr);
      authStore.updateComputerConnectionTelemetry(userId, computer.id, isSsrf ? 'error' : 'offline', {
        error: isSsrf ? safeErr : 'PC Offline / sem resposta do túnel.',
      });
      res.json({
        configured: true,
        connected: false,
        offline: !isSsrf,
        computer: authStore.getComputerPublic(userId, computer.id),
        computers: authStore.listComputersForUser(userId),
        error: isSsrf ? safeErr : 'PC Windows offline. Tentando reconectar automaticamente...',
      });
    }
  });

  // --- 2. Jobs List, Create (Closed Operation Catalog), Detail, Cancel, Approve ---
  app.get('/api/remote-proxy/jobs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        '/api/jobs',
        target.bearerToken,
        { method: 'GET' },
        opts.ssrfOptions,
      );
      const body = await upstream.json().catch(() => ({ error: 'Resposta inválida do Remote Host.' }));
      res.status(upstream.status).json(body);
    } catch {
      res.status(502).json({ error: 'PC Windows offline ao consultar fila de jobs.' });
    }
  });

  app.post('/api/remote-proxy/jobs', requireAuth, requireCsrf, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    const body = req.body as Partial<CreateRemoteJobRequest>;
    if (!body?.operation || !ALLOWED_REMOTE_OPERATIONS.has(body.operation)) {
      res.status(400).json({
        error: 'Operação não permitida pelo catálogo fechado do proxy Aethera.',
      });
      return;
    }

    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        '/api/jobs',
        target.bearerToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts.ssrfOptions,
      );
      const data = await upstream.json().catch(() => ({ error: 'Erro ao criar job remoto.' }));
      if (upstream.ok) {
        authStore.recordAudit({
          userId: req.auth!.user.id,
          eventType: 'remote_job_submitted',
          ipAddress: getClientIp(req),
          userAgent: String(req.headers['user-agent'] ?? ''),
          detail: `Job ${body.operation} enviado ao computador "${target.computer.name}" (${target.computer.id}).`,
        });
      }
      res.status(upstream.status).json(data);
    } catch {
      res.status(502).json({ error: 'Falha ao enviar job: PC Windows offline.' });
    }
  });

  app.get('/api/remote-proxy/jobs/:jobId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    const jobId = encodeURIComponent(String(req.params.jobId));
    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        `/api/jobs/${jobId}`,
        target.bearerToken,
        { method: 'GET' },
        opts.ssrfOptions,
      );
      const data = (await upstream.json().catch(() => ({ error: 'Erro ao ler job.' }))) as RemoteJobDetailResponse;
      res.status(upstream.status).json(data);
    } catch {
      res.status(502).json({ error: 'PC Windows offline ao consultar detalhes do job.' });
    }
  });

  app.post(
    '/api/remote-proxy/jobs/:jobId/cancel',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const jobId = encodeURIComponent(String(req.params.jobId));
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          `/api/jobs/${jobId}/cancel`,
          target.bearerToken,
          { method: 'POST' },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao cancelar job.' }));
        authStore.recordAudit({
          userId: req.auth!.user.id,
          eventType: 'remote_job_cancelled',
          ipAddress: getClientIp(req),
          detail: `Cancelamento solicitado para job ${req.params.jobId} em "${target.computer.name}".`,
        });
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline ao cancelar job.' });
      }
    },
  );

  app.post(
    '/api/remote-proxy/jobs/:jobId/approve',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const jobId = encodeURIComponent(String(req.params.jobId));
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          `/api/jobs/${jobId}/approve`,
          target.bearerToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body ?? {}),
          },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro na aprovação humana.' }));
        authStore.recordAudit({
          userId: req.auth!.user.id,
          eventType: 'remote_job_approval',
          ipAddress: getClientIp(req),
          detail: `Aprovação humana registrada para job ${req.params.jobId}.`,
        });
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline ao aprovar job.' });
      }
    },
  );

  // --- 3. Authenticated SSE Proxies (Job Events & Bidirectional Sync Events with Last-Event-ID) ---
  const pipeSseUpstream = async (
    req: AuthenticatedRequest,
    res: Response,
    target: UserRemoteHostWithSecret,
    upstreamPath: string,
  ) => {
    const abortCtrl = new AbortController();
    let nodeStream: Readable | null = null;
    res.on('close', () => {
      abortCtrl.abort();
      if (nodeStream && !nodeStream.destroyed) {
        nodeStream.destroy();
      }
    });

    const lastEventId =
      typeof req.headers['last-event-id'] === 'string'
        ? req.headers['last-event-id']
        : typeof req.query.lastEventId === 'string'
          ? req.query.lastEventId
          : undefined;

    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        upstreamPath,
        target.bearerToken,
        {
          method: 'GET',
          timeoutMs: 0, // Persistent SSE stream
          signal: abortCtrl.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
          },
        },
        opts.ssrfOptions,
      );

      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({ error: 'Falha ao abrir stream SSE no Remote Host.' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.on('end', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream SSE indisponível (PC offline).' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };

  app.get('/api/remote-proxy/jobs/:jobId/events', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    const jobId = encodeURIComponent(String(req.params.jobId));
    await pipeSseUpstream(req, res, target, `/api/jobs/${jobId}/events`);
  });

  // ─── Recap production jobs (executed by the desktop host; Web only observes and requests control) ───
  const proxyRecapGet = async (req: AuthenticatedRequest, res: Response, upstreamPath: string) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    try {
      const upstream = await fetchRemoteGuarded(target.computer.baseUrl, upstreamPath, target.bearerToken, { method: 'GET' }, opts.ssrfOptions);
      res.status(upstream.status).json(await upstream.json().catch(() => ({ error: 'Resposta inválida do Remote Host.' })));
    } catch {
      res.status(502).json({ error: 'PC Windows offline ao consultar produções Recap.' });
    }
  };

  app.get('/api/remote-proxy/recap/jobs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const includeFinished = req.query.includeFinished === '1' ? '?includeFinished=1' : '';
    await proxyRecapGet(req, res, `/api/recap/jobs${includeFinished}`);
  });

  app.get('/api/remote-proxy/recap/jobs/:jobId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    await proxyRecapGet(req, res, `/api/recap/jobs/${encodeURIComponent(String(req.params.jobId))}`);
  });

  // Closing this stream aborts only the upstream SSE fetch, never the production job.
  app.get('/api/remote-proxy/recap/jobs/:jobId/events', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    await pipeSseUpstream(req, res, target, `/api/recap/jobs/${encodeURIComponent(String(req.params.jobId))}/events`);
  });

  app.post(
    '/api/remote-proxy/recap/jobs/:jobId/:action',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const action = String(req.params.action);
      if (!['pause', 'resume', 'cancel'].includes(action)) {
        res.status(400).json({ error: 'Ação inválida. Use pause, resume ou cancel.' });
        return;
      }
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const jobId = encodeURIComponent(String(req.params.jobId));
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          `/api/recap/jobs/${jobId}/${action}`,
          target.bearerToken,
          { method: 'POST' },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao controlar produção Recap.' }));
        authStore.recordAudit({
          userId: req.auth!.user.id,
          eventType: 'remote_recap_job_control',
          ipAddress: getClientIp(req),
          detail: `Pedido "${action}" para produção Recap ${req.params.jobId} em "${target.computer.name}".`,
        });
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline ao controlar produção Recap.' });
      }
    },
  );

  app.get('/api/remote-proxy/sync/events', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    await pipeSseUpstream(req, res, target, '/api/sync/events');
  });

  // --- 4. Bidirectional Sync Authorized Proxy Endpoints ---
  app.get('/api/remote-proxy/sync/snapshot', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        '/api/sync/snapshot',
        target.bearerToken,
        { method: 'GET' },
        opts.ssrfOptions,
      );
      const data = await upstream.json().catch(() => ({ error: 'Erro ao obter snapshot de sync.' }));
      res.status(upstream.status).json(data);
    } catch {
      res.status(502).json({ error: 'PC Windows offline.' });
    }
  });

  app.get('/api/remote-proxy/sync/changes', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }
    const since = Number(req.query.since ?? 0) || 0;
    try {
      const upstream = await fetchRemoteGuarded(
        target.computer.baseUrl,
        `/api/sync/changes?since=${encodeURIComponent(String(since))}`,
        target.bearerToken,
        { method: 'GET' },
        opts.ssrfOptions,
      );
      const data = await upstream.json().catch(() => ({ error: 'Erro ao consultar mudanças de sync.' }));
      res.status(upstream.status).json(data);
    } catch {
      res.status(502).json({ error: 'PC Windows offline.' });
    }
  });

  app.post(
    '/api/remote-proxy/sync/projects',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const idem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          '/api/sync/projects',
          target.bearerToken,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idem ? { 'Idempotency-Key': idem } : {}),
            },
            body: JSON.stringify(req.body ?? {}),
          },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao criar projeto sincronizado.' }));
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline.' });
      }
    },
  );

  app.put(
    '/api/remote-proxy/sync/projects/:projectId',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const projectId = encodeURIComponent(String(req.params.projectId));
      const idem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          `/api/sync/projects/${projectId}`,
          target.bearerToken,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(idem ? { 'Idempotency-Key': idem } : {}),
            },
            body: JSON.stringify(req.body ?? {}),
          },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao atualizar projeto sincronizado.' }));
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline.' });
      }
    },
  );

  app.post(
    '/api/remote-proxy/sync/projects/:projectId/resolve-conflict',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      const projectId = encodeURIComponent(String(req.params.projectId));
      const idem = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          `/api/sync/projects/${projectId}/resolve-conflict`,
          target.bearerToken,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idem ? { 'Idempotency-Key': idem } : {}),
            },
            body: JSON.stringify(req.body ?? {}),
          },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao resolver conflito.' }));
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline.' });
      }
    },
  );

  app.post(
    '/api/remote-proxy/sync/desktop-ingest',
    requireAuth,
    requireCsrf,
    async (req: AuthenticatedRequest, res: Response) => {
      const target = getTarget(req);
      if (!target) {
        res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
        return;
      }
      try {
        const upstream = await fetchRemoteGuarded(
          target.computer.baseUrl,
          '/api/sync/desktop-ingest',
          target.bearerToken,
          { method: 'POST' },
          opts.ssrfOptions,
        );
        const data = await upstream.json().catch(() => ({ error: 'Erro ao importar projetos do Desktop.' }));
        res.status(upstream.status).json(data);
      } catch {
        res.status(502).json({ error: 'PC Windows offline.' });
      }
    },
  );

  // --- 5. Authenticated Media & Artifact Streaming / Download Proxy (HTTP Range 206, zero token/URL exposure) ---
  const proxyMediaViaTicket = async (
    req: AuthenticatedRequest,
    res: Response,
    ticketEndpoint: string,
    mode: 'stream' | 'download',
  ) => {
    const target = getTarget(req);
    if (!target) {
      res.status(404).json({ error: 'Nenhum computador vinculado ativo.' });
      return;
    }

    try {
      const ticketRes = await fetchRemoteGuarded(
        target.computer.baseUrl,
        ticketEndpoint,
        target.bearerToken,
        { method: 'POST' },
        opts.ssrfOptions,
      );
      if (!ticketRes.ok) {
        const errBody = await ticketRes.json().catch(() => ({ error: 'Mídia não encontrada no Remote Host.' }));
        res.status(ticketRes.status).json(errBody);
        return;
      }
      const ticket = (await ticketRes.json()) as ArtifactTicketResponse | SyncMediaTicketResponse;
      const mediaPath = mode === 'download' ? ticket.downloadPath : ticket.streamPath;

      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const mediaRes = await fetchRemoteGuarded(
        target.computer.baseUrl,
        mediaPath,
        target.bearerToken,
        {
          method: 'GET',
          timeoutMs: 0,
          headers: rangeHeader ? { Range: rangeHeader } : {},
        },
        opts.ssrfOptions,
      );

      res.status(mediaRes.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
        const val = mediaRes.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      res.setHeader('Cache-Control', 'private, no-store');

      if (!mediaRes.body) {
        res.end();
        return;
      }
      const stream = Readable.fromWeb(mediaRes.body as unknown as NodeReadableStream);
      stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Falha ao transmitir mídia do PC Windows.' });
      }
    }
  };

  app.get('/api/remote-proxy/artifacts/:artifactId/stream', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const id = encodeURIComponent(String(req.params.artifactId));
    await proxyMediaViaTicket(req, res, `/api/artifacts/${id}/ticket`, 'stream');
  });

  app.get('/api/remote-proxy/artifacts/:artifactId/download', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const id = encodeURIComponent(String(req.params.artifactId));
    await proxyMediaViaTicket(req, res, `/api/artifacts/${id}/ticket`, 'download');
  });

  app.get('/api/remote-proxy/sync/media/:mediaRefId/stream', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const id = encodeURIComponent(String(req.params.mediaRefId));
    await proxyMediaViaTicket(req, res, `/api/sync/media/${id}/ticket`, 'stream');
  });

  app.get('/api/remote-proxy/sync/media/:mediaRefId/download', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const id = encodeURIComponent(String(req.params.mediaRefId));
    await proxyMediaViaTicket(req, res, `/api/sync/media/${id}/ticket`, 'download');
  });
}
