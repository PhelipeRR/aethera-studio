import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CORE_API_PREFIX, CORE_ERROR_CODES, CORE_ROUTES, eventPayloadSchema, RATE_LIMIT_CLASSES, SCOPES, type RouteContract } from '../src/core-api/index.js';

const routes = Object.entries(CORE_ROUTES) as Array<[string, RouteContract]>;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The v1 surface as first published (contract 1.0.0). Inside v1 the contract only grows: removing or renaming a route
 * or an event type here is a breaking change and belongs in /api/v2 (see version.ts).
 */
const V1_ROUTES = ['health', 'pairingStart', 'pairingClaim', 'pairingStatus', 'pairingDecide', 'token', 'devicesList', 'devicesRevoke', 'auditList', 'tasksCreate', 'tasksList', 'tasksGet', 'tasksContinue', 'tasksApproval', 'tasksCancel', 'tasksPause', 'tasksResumePaused', 'tasksRecover', 'memoriesList', 'memoriesGet', 'memoriesCreate', 'memoriesUpdate', 'memoriesDelete', 'memoriesSearch', 'projectKnowledgeSearch', 'indexStatus', 'indexJobsCreate', 'indexJobsGet', 'metricsSnapshot', 'websocket', 'sse', 'orchestratorsRegister', 'orchestratorsReconcile'];
const V1_EVENTS = ['task.created', 'task.status', 'task.step', 'task.log', 'task.approval_required', 'task.lease', 'task.cancelled', 'task.completed', 'task.failed', 'task.external_ref', 'memory.changed', 'memory.recalled', 'index.progress', 'metrics.sample', 'system.capability', 'system.shutdown'];

describe('core-api route catalog', () => {
  it('keeps every v1 route and event type (additive changes only)', () => {
    expect(Object.keys(CORE_ROUTES)).toEqual(expect.arrayContaining(V1_ROUTES));
    expect(eventPayloadSchema.options.map((option) => option.shape.type.value)).toEqual(expect.arrayContaining(V1_EVENTS));
  });

  it('serves everything under /api/v1 with unique method + path', () => {
    const keys = routes.map(([, route]) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [name, route] of routes) expect(route.path.startsWith(`${CORE_API_PREFIX}/`), name).toBe(true);
  });

  it('requires an Idempotency-Key on every state change (the token endpoint rotates instead)', () => {
    // POST without a state change: the searches only use POST to carry the query in the body.
    const safePosts = new Set(['token', 'memoriesSearch', 'projectKnowledgeSearch']);
    for (const [name, route] of routes) {
      if (!MUTATING.has(route.method) || safePosts.has(name)) expect(route.idempotencyKey, name).toBe('none');
      else expect(route.idempotencyKey, name).toBe('required');
    }
  });

  it('declares a scope everywhere except the health check and the pairing/token handshake', () => {
    expect(routes.filter(([, route]) => route.scope === null).map(([name]) => name).sort()).toEqual(['health', 'pairingClaim', 'pairingStatus', 'token']);
    for (const [name, route] of routes) {
      if (route.scope && SCOPES[route.scope].local) expect(route.localOnly, `${name} uses a local scope`).toBe(true);
      if (route.localOnly) expect(route.scope, name).toBe('devices:manage');
    }
  });

  it('puts dangerous operations behind their own scopes', () => {
    expect(CORE_ROUTES.tasksApproval.scope).toBe('task:approve');
    expect(CORE_ROUTES.tasksCancel.scope).toBe('task:cancel');
    expect(CORE_ROUTES.tasksCreate.scope).toBe('task:create');
    expect(CORE_ROUTES.memoriesCreate.scope).toBe('memory:write');
    expect(CORE_ROUTES.pairingStart.localOnly).toBe(true);
    expect(CORE_ROUTES.devicesRevoke.localOnly).toBe(true);
  });

  it('uses only known error codes and rate-limit classes, with strict request bodies', () => {
    for (const [name, route] of routes) {
      for (const code of route.errors) expect(code in CORE_ERROR_CODES, `${name}: ${code}`).toBe(true);
      expect(route.rateLimit in RATE_LIMIT_CLASSES, name).toBe(true);
      if (route.body) expect(route.body.safeParse({ unexpectedField: true }).success, `${name} accepts unknown fields`).toBe(false);
      if (MUTATING.has(route.method) && route.method !== 'DELETE') expect(route.body, `${name} has no body schema`).toBeDefined();
    }
  });

  it('can be turned into JSON Schema for the OpenAPI document (CORE-03)', () => {
    for (const [name, route] of routes) {
      for (const [part, schema] of Object.entries({ params: route.params, query: route.query, body: route.body, response: route.response })) {
        if (!schema) continue;
        expect(() => z.toJSONSchema(schema, { io: part === 'response' ? 'output' : 'input', unrepresentable: 'throw' }), `${name}.${part}`).not.toThrow();
      }
    }
  });
});
