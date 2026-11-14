import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { GatedProvider, LocalEmbeddingProvider, readSemanticSettings } from '@neuralbridge/brain';
import { AuthService, bearerMatches, defaultTailscaleExec, EventLog, findTailscale, HttpError, matchPath, readJson, sendJson, serveSse, TailscaleRemote, type AuthPrincipal, type CoreDomain, type DomainContext, type Health, type RequestContext } from '@neuralbridge/core';
import { IdempotencyStore, projects, type DatabaseHandle } from '@neuralbridge/database';
import { newInstanceId, type TaskEngine, type TaskUpdate } from '@neuralbridge/orchestrator';
import { IpcChannel, parseIpcInput, type IpcChannelName, type TaskStatus } from '@neuralbridge/shared';
import {
  approvalDecisionRequestSchema, authorize as authorizeGrant, cancelTaskRequestSchema, canonicalJson, commandAllowed, continueTaskRequestSchema, CORE_ROUTES, createTaskRequestSchema,
  idempotencyKeySchema, IDEMPOTENCY, RATE_LIMIT_CLASSES, recoverTaskRequestSchema, taskListQuerySchema, type RateLimitClass, type Scope, type TaskCommand,
} from '@neuralbridge/shared/core-api';
import { createBrainAdmin } from '../main/brain-admin.js';
import { initDatabase } from '../main/database.js';
import { composeTaskEngine } from '../main/task-composition.js';
import { readPreferences } from '../main/preferences.js';
import { createTaskService, type TaskService } from '../main/tasks.js';
import { toCoreTask } from './task-mapping.js';
import { createAuthRoutes, createPrincipalResolver, remoteEnabled, toHttpError } from './auth-routes.js';

/*
 * CORE-05: the desktop's task domain inside the Singularity Core. The Core composes the same TaskEngine as the main
 * process (task-composition.ts) on the same database and serves it:
 * - /internal/v1/tasks/<command> and /internal/v1/engine-events: the desktop adapter (CORE-06), with the exact IPC
 *   input schemas and the raw engine updates, so the desktop behaves exactly as before;
 * - /api/v1/tasks… and /api/v1/streams/…: the public CORE-02 contract, with idempotency keys.
 * Every route needs the desktop bearer (received on the IPC pipe) until CORE-07 adds device tokens.
 */

const INTERNAL_COMMANDS: Record<string, { channel: IpcChannelName; run: (service: TaskService, input: never) => unknown }> = {
  start: { channel: IpcChannel.tasksStart, run: (service, input: Parameters<TaskService['start']>[0]) => service.start(input) },
  'git-review-start': { channel: IpcChannel.tasksGitReviewStart, run: (service, input: Parameters<TaskService['startGitReview']>[0]) => service.startGitReview(input) },
  'smart-commit-start': { channel: IpcChannel.tasksSmartCommitStart, run: (service, input: Parameters<TaskService['startSmartCommit']>[0]) => service.startSmartCommit(input) },
  resume: { channel: IpcChannel.tasksResume, run: (service, input: { id: string; prompt: string; images?: Parameters<TaskService['resume']>[2] }) => service.resume(input.id, input.prompt, input.images) },
  heal: { channel: IpcChannel.tasksHeal, run: (service, input: { id: string }) => service.heal(input.id) },
  approve: { channel: IpcChannel.tasksApprove, run: (service, input: { id: string }) => (service.approve(input.id), { ok: true }) },
  cancel: { channel: IpcChannel.tasksCancel, run: (service, input: { id: string }) => (service.cancel(input.id), { ok: true }) },
  pause: { channel: IpcChannel.tasksPause, run: (service, input: { id: string }) => (service.pause(input.id), { ok: true }) },
  'resume-paused': { channel: IpcChannel.tasksResumePaused, run: (service, input: { id: string }) => (service.resumePaused(input.id), { ok: true }) },
  'retry-capacity': { channel: IpcChannel.tasksRetryCapacity, run: (service, input: { id: string }) => (service.retryCapacity(input.id), { ok: true }) },
  'capacity-auto-resume': { channel: IpcChannel.tasksCapacityAutoResume, run: (service, input: { id: string; enabled: boolean }) => (service.setCapacityAutoResume(input.id, input.enabled), { ok: true }) },
};

const STARTS_WORK = new Set(['start', 'git-review-start', 'smart-commit-start', 'resume', 'heal']);

function restoreImages(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { images?: unknown }).images)) return raw;
  const images = (raw as { images: unknown[] }).images.map((image) => {
    const entry = image as { name?: unknown; dataBase64?: unknown };
    return typeof entry.dataBase64 === 'string' ? { name: entry.name, data: new Uint8Array(Buffer.from(entry.dataBase64, 'base64')) } : image;
  });
  return { ...(raw as object), images };
}

/** Who is calling (CORE-07): the desktop on loopback, or a paired device with its grant. Throws when nobody valid. */
type Resolve = (request: IncomingMessage, path: string, context: RequestContext) => AuthPrincipal;

export interface TaskDomainParts {
  handle: DatabaseHandle;
  engine: TaskEngine;
  service: TaskService;
  events: EventLog;
  /** Current per-task token budget (preferences). */
  tokenBudget?: () => number;
  /** CORE-07: per-principal rate limit (devices only; the local desktop is exempt). Throws when over. */
  rateLimit?: (principalId: string, cls: RateLimitClass) => void;
}

/** Routes over an already composed engine; separated from the composition so tests can drive it with fakes. */
export function createTaskRoutes(parts: TaskDomainParts, resolve: Resolve) {
  const { handle, engine, service, events } = parts;
  // The user may change the per-task budget at any time in the desktop; every new run reads it, as the desktop's own engine does.
  const refreshBudget = (): void => { if (parts.tokenBudget) engine.setTokenBudget(parts.tokenBudget()); };
  const idempotency = new IdempotencyStore(handle);
  /** Open SSE connections by principal, so revoking a device closes its streams at once. */
  const openStreams = new Map<string, Set<() => void>>();
  const track = (principalId: string) => (close: () => void) => { const set = openStreams.get(principalId) ?? new Set(); set.add(close); openStreams.set(principalId, set); return () => set.delete(close); };

  engine.on('task', (update: TaskUpdate) => {
    events.append('engine', update.kind, update);
    if (update.kind === 'status') {
      const payload = { type: 'task.status', taskId: update.taskId, from: null, to: update.status, error: update.error };
      events.append('tasks', 'task.status', payload);
      events.append(`task:${update.taskId}`, 'task.status', payload);
      const final: Partial<Record<TaskStatus, string>> = { completed: 'task.completed', failed: 'task.failed', cancelled: 'task.cancelled' };
      const type = final[update.status];
      if (type) events.append(`task:${update.taskId}`, type, type === 'task.completed' ? { type, taskId: update.taskId, summary: null } : type === 'task.failed' ? { type, taskId: update.taskId, error: update.error ?? 'Falhou.', recoverable: true } : { type, taskId: update.taskId, reason: null });
    } else if (update.kind === 'event') {
      const kind = String(update.event.kind).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'event';
      const text = 'text' in update.event && typeof update.event.text === 'string' ? update.event.text.slice(0, 4000) : null;
      events.append(`task:${update.taskId}`, 'task.log', { type: 'task.log', taskId: update.taskId, stepId: update.stepId, kind: /^[a-z]/.test(kind) ? kind : `e_${kind}`.slice(0, 40), text, data: {} });
    }
  });

  const publicTask = (id: string) => toCoreTask(service.get(id), handle, engine.leases, events.lastId(`task:${id}`));

  /** Runs a state change once per Idempotency-Key (CORE-02 C2-5). */
  async function once(principal: AuthPrincipal, request: IncomingMessage, response: ServerResponse, route: string, body: unknown, run: () => Promise<{ status: number; body: unknown }>): Promise<void> {
    const raw = request.headers[IDEMPOTENCY.header.toLowerCase()];
    const key = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!key.success) throw new HttpError('idempotency_key_required', 'Envie o cabeçalho Idempotency-Key.');
    const scope = `${principal.kind}:${principal.id}:${route}`;
    const fingerprint = createHash('sha256').update(canonicalJson(body)).digest('hex');
    const claim = idempotency.claim(scope, key.data, fingerprint);
    if (claim.state === 'conflict') throw new HttpError('idempotency_conflict', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
    if (claim.state === 'in_progress') throw new HttpError('conflict', 'A primeira requisição com esta chave ainda está em andamento.');
    if (claim.state === 'replay') {
      const replayed = claim.response && typeof claim.response === 'object' && 'replayed' in claim.response ? { ...claim.response, replayed: true } : claim.response;
      sendJson(response, claim.statusCode, replayed);
      return;
    }
    try {
      const result = await run();
      idempotency.complete(scope, key.data, result.status, result.body);
      sendJson(response, result.status, result.body);
    } catch (error) {
      idempotency.release(scope, key.data);
      throw error;
    }
  }

  function requireCommand(id: string, command: TaskCommand): void {
    const status = service.get(id).status;
    if (!commandAllowed(command, status)) throw new HttpError('invalid_transition', `Comando indisponível no status ${status}.`);
  }

  async function route(request: IncomingMessage, response: ServerResponse, path: string, context: RequestContext): Promise<boolean> {
    if (!path.startsWith('/internal/v1/') && !path.startsWith('/api/v1/')) return false;
    const principal = resolve(request, path, context);
    const method = request.method ?? 'GET';
    if (path.startsWith('/internal/') && principal.kind !== 'desktop') throw new HttpError('forbidden', 'Disponível só no desktop.');
    if (principal.kind !== 'desktop' && parts.rateLimit) {
      const creates = method === 'POST' && (path === CORE_ROUTES.tasksCreate.path || path.endsWith('/messages') || path.endsWith('/recover'));
      parts.rateLimit(principal.id, path.startsWith('/api/v1/streams/') ? 'stream' : method === 'GET' ? 'read' : creates ? 'taskCreate' : 'command');
    }
    const projectOf = (projectId: string | null) => (projectId ? handle.db.select({ id: projects.id, isPrivate: projects.isPrivate, permissionLevel: projects.permissionLevel }).from(projects).where(eq(projects.id, projectId)).get() ?? null : null);
    /** Scope and resource checks (CORE-02 authorize): a task the caller may not see answers not_found (no IDOR). */
    const allow = (scope: Scope, projectId: string | null): void => {
      const project = projectOf(projectId);
      if (projectId && !project) throw new HttpError('not_found', 'Não encontrado.');
      const verdict = authorizeGrant(principal.grant, scope, project ? { id: project.id, isPrivate: project.isPrivate } : null);
      if (verdict === 'scope_required') throw new HttpError('scope_required', `Este aparelho não tem o escopo ${scope}.`, { details: { requiredScope: scope } });
      if (verdict === 'not_visible') throw new HttpError('not_found', 'Não encontrado.');
    };
    const allowTask = (taskId: string, scope: Scope): void => {
      let projectId: string | null;
      try { projectId = service.get(taskId).projectId; } catch { throw new HttpError('not_found', 'Não encontrado.'); }
      allow(scope, projectId);
    };

    // Desktop adapter (CORE-06): same inputs as the IPC, validated by the same schemas.
    const internal = matchPath('/internal/v1/tasks/{command}', path);
    if (internal && method === 'POST') {
      const command = INTERNAL_COMMANDS[internal['command'] ?? ''];
      if (!command) throw new HttpError('not_found', 'Comando desconhecido.');
      // Images travel as base64 in tasks.start/resume: room for 6 images of 5 MB, restored to bytes before validation.
      const raw = restoreImages(await readJson(request, z.unknown(), 48 * 1024 * 1024));
      let input: unknown;
      try { input = parseIpcInput(command.channel, raw); } catch { throw new HttpError('invalid_request', 'Requisição inválida.'); }
      if (STARTS_WORK.has(internal['command'] ?? '')) refreshBudget();
      sendJson(response, 200, await command.run(service, input as never));
      return true;
    }
    if (path === '/internal/v1/engine-events' && method === 'GET') { serveSse(request, response, events, 'engine', track(principal.id)); return true; }
    if (path === '/internal/v1/executor' && method === 'GET') { sendJson(response, 200, { instanceId: engine.leases.instanceId }); return true; }

    // Public CORE-02 contract.
    if (path === CORE_ROUTES.tasksCreate.path && method === 'POST') {
      const body = await readJson(request, createTaskRequestSchema);
      allow('task:create', body.projectId);
      // CORE-02: remote clients default to read-only; editing where commands run freely needs task:full-access.
      const access = body.access ?? (principal.kind === 'desktop' ? undefined : 'read-only');
      const level = projectOf(body.projectId)?.permissionLevel ?? 'standard';
      if (access !== 'read-only' && level !== 'standard') allow('task:full-access', body.projectId);
      await once(principal, request, response, 'tasks.create', body, async () => {
        refreshBudget();
        const id = await engine.start({ prompt: body.prompt, projectId: body.projectId, mode: body.mode, ...(access ? { access } : {}), ...(body.model !== undefined ? { model: body.model } : {}), ...(body.skillIds ? { skillIds: body.skillIds } : {}), ...(body.participants ? { participants: body.participants } : {}), ...(body.externalRef ? { externalRef: body.externalRef } : {}) });
        return { status: 201, body: { task: publicTask(id), replayed: false } };
      });
      return true;
    }
    if (path === CORE_ROUTES.tasksList.path && method === 'GET') {
      const query = taskListQuerySchema.safeParse(Object.fromEntries(new URL(request.url ?? '/', 'http://127.0.0.1').searchParams));
      if (!query.success) throw new HttpError('invalid_request', 'Filtro inválido.');
      allow('read', null);
      const visible = (projectId: string | null) => { try { allow('read', projectId); return true; } catch { return false; } };
      const items = service.list({ ...(query.data.status ? { status: query.data.status } : {}), ...(query.data.projectId ? { projectId: query.data.projectId } : {}), ...(query.data.agent ? { agent: query.data.agent } : {}), ...(query.data.query ? { query: query.data.query } : {}), ...(query.data.externalSystem ? { externalSystem: query.data.externalSystem } : {}), limit: query.data.limit });
      sendJson(response, 200, { items: items.filter((task) => visible(task.projectId)).map((task) => toCoreTask(task, handle, engine.leases, events.lastId(`task:${task.id}`))), nextCursor: null });
      return true;
    }
    const byId = matchPath(CORE_ROUTES.tasksGet.path, path);
    if (byId && method === 'GET') {
      const id = byId['id'] ?? '';
      allowTask(id, 'read');
      sendJson(response, 200, { ...publicTask(id), steps: service.get(id).steps.map((step) => ({ ...step, startedAt: step.startedAt && new Date(step.startedAt).toISOString(), finishedAt: step.finishedAt && new Date(step.finishedAt).toISOString() })) });
      return true;
    }
    const command = (pattern: string) => (method === 'POST' ? matchPath(pattern, path)?.['id'] ?? null : null);
    let id: string | null;
    if ((id = command(CORE_ROUTES.tasksCancel.path))) { const taskId = id; allowTask(taskId, 'task:cancel'); const body = await readJson(request, cancelTaskRequestSchema); await once(principal, request, response, `tasks.cancel:${taskId}`, body, async () => { requireCommand(taskId, 'cancel'); service.cancel(taskId); return { status: 200, body: publicTask(taskId) }; }); return true; }
    if ((id = command(CORE_ROUTES.tasksApproval.path))) {
      const taskId = id; allowTask(taskId, 'task:approve'); const body = await readJson(request, approvalDecisionRequestSchema);
      await once(principal, request, response, `tasks.approval:${taskId}`, body, async () => { requireCommand(taskId, 'approve'); if (body.decision === 'approve') service.approve(taskId); else service.cancel(taskId); return { status: 200, body: publicTask(taskId) }; });
      return true;
    }
    if ((id = command(CORE_ROUTES.tasksPause.path))) { const taskId = id; allowTask(taskId, 'task:cancel'); await once(principal, request, response, `tasks.pause:${taskId}`, {}, async () => { requireCommand(taskId, 'pause'); service.pause(taskId); return { status: 200, body: publicTask(taskId) }; }); return true; }
    if ((id = command(CORE_ROUTES.tasksResumePaused.path))) { const taskId = id; allowTask(taskId, 'task:cancel'); await once(principal, request, response, `tasks.resume:${taskId}`, {}, async () => { requireCommand(taskId, 'resumePaused'); service.resumePaused(taskId); return { status: 200, body: publicTask(taskId) }; }); return true; }
    if ((id = command(CORE_ROUTES.tasksContinue.path))) {
      const taskId = id; allowTask(taskId, 'task:create'); const body = await readJson(request, continueTaskRequestSchema);
      await once(principal, request, response, `tasks.continue:${taskId}`, body, async () => { requireCommand(taskId, 'continue'); refreshBudget(); const next = await service.resume(taskId, body.prompt); return { status: 201, body: { task: publicTask(next.id), replayed: false } }; });
      return true;
    }
    if ((id = command(CORE_ROUTES.tasksRecover.path))) {
      const taskId = id; allowTask(taskId, 'task:create'); const body = await readJson(request, recoverTaskRequestSchema);
      await once(principal, request, response, `tasks.recover:${taskId}`, body, async () => {
        requireCommand(taskId, 'recover');
        refreshBudget();
        const next = body.action === 'heal' ? await service.heal(taskId) : await service.resume(taskId, body.action === 'retry' ? service.get(taskId).prompt : 'Continue de onde parou.');
        return { status: 201, body: { task: publicTask(next.id), replayed: false } };
      });
      return true;
    }
    const stream = matchPath(CORE_ROUTES.sse.path, path);
    if (stream && method === 'GET') {
      const name = stream['stream'] ?? '';
      if (name !== 'tasks' && !/^task:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new HttpError('not_found', 'Stream desconhecido.');
      // The all-tasks stream would show every project: only for callers that see all of them.
      if (name === 'tasks') { allow('read', null); if (principal.grant.projects.projects !== 'all' || !principal.grant.projects.includePrivate) throw new HttpError('forbidden', 'Use o stream de cada tarefa.'); }
      else allowTask(name.slice(5), 'read');
      serveSse(request, response, events, name, track(principal.id));
      return true;
    }
    return false;
  }

  const closeFor = (principalIds: readonly string[] | null): number => {
    let closed = 0;
    for (const [id, set] of openStreams) if (!principalIds || principalIds.includes(id)) for (const close of [...set]) { close(); closed += 1; }
    return closed;
  };
  return { handle: route, closeStreams: () => closeFor(null), closeFor };
}

/** The real composition for the Core process: database, semantic search provider (no indexer), learnings, engine. */
export async function composeDesktopDomain(context: DomainContext): Promise<CoreDomain> {
  const dataDir = context.config.dataDir;
  const migrations = join(__dirname, 'migrations');
  const database = initDatabase(dataDir, migrations, (message) => context.log.log('error', 'core.database', { message }));
  if (!database.handle) throw new Error('Banco de dados indisponível.');
  const handle = database.handle;
  // Search only: the desktop keeps the one embedding indexer, so the Core never indexes the same memories twice.
  const semanticProvider = new GatedProvider(new LocalEmbeddingProvider({ cacheDir: join(dataDir, 'models'), allowDownload: false }), () => readSemanticSettings(handle).enabled);
  const brainAdmin = createBrainAdmin({ handle, backupsDir: join(dataDir, 'backups', 'brain'), migrationsFolder: migrations, onMemoriesChanged: () => undefined });
  const engine = composeTaskEngine({
    handle,
    adapters: { claude: new ClaudeCliAdapter(), codex: new CodexCliAdapter() },
    appExecutable: process.execPath,
    serverScript: join(__dirname, 'mcp-server.js'),
    dataDir: process.env['NB_DATA_DIR'],
    homeDir: homedir(),
    userDataDir: dataDir,
    preferencesFile: join(dataDir, 'preferences.json'),
    semanticProvider,
    propose: (proposals, meta) => { brainAdmin.propose(proposals, meta); },
    projectRoot: (projectId) => {
      const root = handle.db.select({ rootPath: projects.rootPath }).from(projects).where(eq(projects.id, projectId)).get()?.rootPath;
      if (!root) throw new Error('not_found: Projeto não encontrado.');
      return root;
    },
    instanceId: newInstanceId(),
  });
  const service = createTaskService({ handle, engine, notify: () => undefined, attachmentsDir: join(dataDir, 'attachments') });
  const events = new EventLog();
  // CORE-07: device auth and remote access. The Core identity is random, kept in the data folder, never sent anywhere but
  // the pairing screen (as a fingerprint), so the phone can compare it with the desktop.
  const identity = coreIdentity(dataDir);
  let routes: ReturnType<typeof createTaskRoutes> | null = null;
  const auth = new AuthService({ handle, coreId: identity.coreId, fingerprint: identity.fingerprint, onRevoked: (ids) => routes?.closeFor(ids) ?? 0 });
  const binary = findTailscale();
  const remote = new TailscaleRemote(binary ? defaultTailscaleExec(binary) : null);
  const resolve = createPrincipalResolver(auth, (request) => bearerMatches(request, context.desktopToken));
  routes = createTaskRoutes({ handle, engine, service, events, tokenBudget: () => readPreferences(join(dataDir, 'preferences.json')).tokenBudget, rateLimit: (principalId, cls) => { try { auth.limiter.check(`${cls}:${principalId}`, RATE_LIMIT_CLASSES[cls]); } catch (error) { throw toHttpError(error); } } }, resolve);
  let port: number | null = null;
  let health: (() => Health) | null = null;
  const remoteHost: { value: string | null } = { value: null };
  // CORE-08 observability and control for the desktop: process figures and a clean stop of a standalone Core.
  let lastCpu = process.cpuUsage();
  let lastAt = Date.now();
  const runtimeRoute = async (request: IncomingMessage, response: ServerResponse, path: string, requestContext: RequestContext): Promise<boolean> => {
    if (path !== '/internal/v1/status' && path !== '/internal/v1/shutdown') return false;
    if (resolve(request, path, requestContext).kind !== 'desktop') throw new HttpError('forbidden', 'Disponível só no desktop.');
    if (path === '/internal/v1/shutdown' && request.method === 'POST') { sendJson(response, 200, { ok: true }); setTimeout(() => context.requestShutdown('desktop-request'), 50); return true; }
    const cpu = process.cpuUsage(lastCpu);
    const elapsed = Math.max(1, Date.now() - lastAt);
    lastCpu = process.cpuUsage();
    lastAt = Date.now();
    const running = handle.sqlite.prepare("SELECT COUNT(*) AS n FROM tasks WHERE owner_instance_id = ? AND status IN ('pending','planning','running','awaiting_approval','validating','paused')").get(engine.leases.instanceId) as { n: number };
    sendJson(response, 200, { mode: context.config.mode, pid: process.pid, version: context.config.version, uptimeMs: Date.now() - context.startedAt, memoryBytes: process.memoryUsage().rss, cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsed) * 1000) / 10, tasksRunning: running.n, remote: remoteHost.value !== null });
    return true;
  };
  const authRoutes = createAuthRoutes({ auth, remote, dataDir, principal: resolve, health: () => health?.() ?? null, port: () => port, remoteHost });
  const taskRoutes = routes;
  context.log.log('info', 'core.domain_ready', { executor: engine.leases.instanceId.split(':')[0] ?? null, tailscale: binary !== null });
  return {
    handle: async (request, response, path, requestContext) => (await runtimeRoute(request, response, path, requestContext)) || (await authRoutes.route(request, response, path, requestContext)) || taskRoutes.handle(request, response, path, requestContext),
    executorId: engine.leases.instanceId,
    remoteHosts: () => (remoteHost.value ? [remoteHost.value] : []),
    started: (listening, healthOf) => {
      port = listening;
      health = healthOf;
      // Remote access follows the dynamic port: re-published on every start while the user keeps it on.
      if (remoteEnabled(dataDir)) void authRoutes.applyRemote(true).then((state) => context.log.log('info', 'core.remote', { state: String((state as { state?: unknown }).state ?? 'unknown') }), () => context.log.log('warn', 'core.remote_failed', {}));
    },
    async shutdown() {
      taskRoutes.closeStreams();
      if (remoteHost.value) await remote.disable().catch(() => undefined);
      // Same as the desktop on quit: running tasks are cancelled and recovered on the next start.
      engine.cancelAll();
      await Promise.race([engine.idle(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
      handle.close();
    },
  };
}

/** A random Core identity kept in the data folder; its fingerprint is what both screens show during pairing. */
function coreIdentity(dataDir: string): { coreId: string; fingerprint: string } {
  const file = join(dataDir, 'core-identity.json');
  try {
    if (existsSync(file)) {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { coreId?: unknown; secret?: unknown };
      if (typeof stored.coreId === 'string' && typeof stored.secret === 'string') return { coreId: stored.coreId, fingerprint: createHash('sha256').update(stored.secret).digest('hex') };
    }
  } catch { /* regenerate below */ }
  const created = { coreId: randomUUID(), secret: randomBytes(32).toString('hex') };
  writeFileSync(file, JSON.stringify(created));
  return { coreId: created.coreId, fingerprint: createHash('sha256').update(created.secret).digest('hex') };
}
