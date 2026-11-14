import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BrainService, GLOBAL_SCOPE, HybridSearch, projectScope, RagEngine, saveProjectProfile, USER_SCOPE, type Scope } from '@neuralbridge/brain';
import { azureDevOpsCache, azureDevOpsConnections, memories, openDatabase, projects, taskSteps, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer, UNTRUSTED_NOTICE } from '../src/server.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const TOOLS = ['azure_devops_cached', 'azure_devops_connections', 'azure_devops_draft_task', 'azure_devops_draft_user_story', 'azure_devops_review_pr', 'brain_delete', 'brain_links', 'brain_list', 'brain_rag_search', 'brain_recall', 'brain_search', 'brain_store', 'orchestrator_status', 'project_profile', 'task_status'];

let handle: DatabaseHandle;
const clients: Client[] = [];
const storeEvents: string[] = [];

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-mcp-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db
    .insert(projects)
    .values([
      { id: 'api', name: 'api', rootPath: 'C:\\src\\api' },
      { id: 'web', name: 'web', rootPath: 'C:\\src\\web' },
    ])
    .run();
});

afterEach(async () => {
  storeEvents.length = 0;
  while (clients.length) await clients.pop()?.close();
  handle.close();
});

async function connect(scope: Scope, clientName = 'claude-code'): Promise<Client> {
  const brain = new BrainService(handle);
  const server = createMcpServer({ handle, brain, search: new HybridSearch(brain, null), rag: new RagEngine(handle), scope, onStored: () => storeEvents.push(clientName) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

/** Parses the JSON body after the untrusted-data notice. */
function data<T = Record<string, unknown>>(result: ToolResult): T {
  const text = result.content[0]?.text ?? '';
  expect(result.isError ?? false).toBe(false);
  expect(text.startsWith(UNTRUSTED_NOTICE)).toBe(true);
  return JSON.parse(text.slice(UNTRUSTED_NOTICE.length)) as T;
}

describe('NeuralBridge MCP server', () => {
  it('exposes cached TFS context to Claude/Codex without allowing writes', async () => {
    const connectionId = '11111111-1111-4111-8111-111111111111';
    handle.db.insert(azureDevOpsConnections).values({ id: connectionId, baseUrl: 'https://tfs.example.test/tfs', collection: 'CONFEA', project: 'Sistema Unificado', readOnly: true, status: 'connected', capabilities: '{}', updatedAt: '2026-11-04T12:00:00.000Z' }).run();
    handle.db.insert(azureDevOpsCache).values({ connectionId, entityType: 'pull-request', entityId: '2532', payload: JSON.stringify({ title: 'Ajuste' }), fetchedAt: '2026-11-04T12:00:00.000Z' }).run();
    const client = await connect(projectScope('api'), 'codex-mcp-client');
    const result = data<{ entries: Array<{ kind: string; key: string; value: { title: string } }> }>(await call(client, 'azure_devops_cached', { connection_id: connectionId, kind: 'pull-request' }));
    expect(result.entries).toMatchObject([{ kind: 'pull-request', key: '2532', value: { title: 'Ajuste' } }]);
  });

  it('lists safe TFS connection metadata without credentials', async () => {
    const connectionId = '33333333-3333-4333-8333-333333333333';
    handle.db.insert(azureDevOpsConnections).values({ id: connectionId, baseUrl: 'https://tfs.example.test/tfs', collection: 'CONFEA', project: 'Sistema Unificado', readOnly: true, status: 'connected', capabilities: '{}', updatedAt: '2026-11-04T12:00:00.000Z' }).run();
    const client = await connect(projectScope('api'));
    const connections = data<{ id: string; baseUrl: string; project: string }[]>(await call(client, 'azure_devops_connections'));
    expect(connections).toMatchObject([{ id: connectionId, baseUrl: 'https://tfs.example.test/tfs', project: 'Sistema Unificado' }]);
    expect(JSON.stringify(connections)).not.toMatch(/password|token|secret/i);
  });

  it('drafts User Stories and tasks without publishing them', async () => {
    const client = await connect(projectScope('api'));
    const story = data<{ state: string; published: boolean; acceptanceCriteria: string[] }>(await call(client, 'azure_devops_draft_user_story', { title: 'Filtros no backlog', user_need: 'filtrar itens por sprint', acceptance_criteria: ['A lista mostra apenas itens da sprint selecionada.'], context: 'Time de desenvolvimento' }));
    expect(story).toMatchObject({ state: 'draft', published: false, acceptanceCriteria: ['A lista mostra apenas itens da sprint selecionada.'] });
    const task = data<{ type: string; relatedPullRequest: number | null; requiresHumanApproval: boolean }>(await call(client, 'azure_devops_draft_task', { title: 'Adicionar teste de filtros', objective: 'Cobrir o filtro de sprint no componente de backlog.', done_when: ['Teste automatizado passa.', 'Sem regressão visual.'], related_pr: 2532 }));
    expect(task).toMatchObject({ type: 'Task', relatedPullRequest: 2532, requiresHumanApproval: true });
  });

  it('assembles a cached pull request review without write capabilities', async () => {
    const connectionId = '22222222-2222-4222-8222-222222222222';
    handle.db.insert(azureDevOpsConnections).values({ id: connectionId, baseUrl: 'https://tfs.example.test/tfs', collection: 'CONFEA', project: 'Sistema Unificado', readOnly: true, status: 'connected', capabilities: '{}', updatedAt: '2026-11-04T12:00:00.000Z' }).run();
    handle.db.insert(azureDevOpsCache).values([
      { connectionId, entityType: 'pull-request-detail', entityId: '2532', payload: JSON.stringify({ title: 'Ajuste' }), fetchedAt: '2026-11-04T12:00:00.000Z' },
      { connectionId, entityType: 'pull-request-threads', entityId: '2532', payload: JSON.stringify([{ id: 1 }]), fetchedAt: '2026-11-04T12:00:01.000Z' },
      { connectionId, entityType: 'pull-request-change', entityId: '2532:/src/index.ts', payload: JSON.stringify({ path: '/src/index.ts', changeType: 'edit' }), fetchedAt: '2026-11-04T12:00:02.000Z' },
    ]).run();
    const client = await connect(projectScope('api'), 'codex-mcp-client');
    const review = data<{ detail: { title: string }; changes: Array<{ path: string }>; reviewable: boolean; requiresHumanApprovalForWrites: boolean }>(await call(client, 'azure_devops_review_pr', { connection_id: connectionId, pull_request_id: 2532 }));
    expect(review).toMatchObject({ detail: { title: 'Ajuste' }, changes: [{ path: '/src/index.ts' }], reviewable: true, requiresHumanApprovalForWrites: true });
  });

  it('lists exactly the documented tools, with descriptions and input schemas', async () => {
    const client = await connect(projectScope('api'));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('stores, recalls, searches, lists and links memories within the project', async () => {
    const client = await connect(projectScope('api'));
    const stored = data<{ created: boolean; memory: { id: string; projectId: string; source: { kind: string } } }>(
      await call(client, 'brain_store', { title: 'Cache strategy', content: 'Use [[Redis]] for sessions', type: 'decision', tags: ['infra'] }),
    );
    expect(stored).toMatchObject({ created: true, memory: { projectId: 'api', source: { kind: 'claude' } } });

    await call(client, 'brain_store', { title: 'Redis', content: 'In-memory store', type: 'documentation' });
    expect(data(await call(client, 'brain_recall', { id_or_title: 'cache strategy' }))).toMatchObject({ title: 'Cache strategy', pending: [] });
    const found = data<{ hits: { title: string; matchedBy: string[] }[]; mode: string; degraded: string | null }>(await call(client, 'brain_search', { query: 'sessions' }));
    expect(found).toMatchObject({ mode: 'fts', degraded: 'disabled', hits: [{ title: 'Cache strategy', matchedBy: ['text'] }] });
    expect(storeEvents.filter((name) => name === 'claude-code').length).toBeGreaterThanOrEqual(2);
    expect(data<{ items: unknown[] }>(await call(client, 'brain_list', { tags: ['infra'] })).items).toHaveLength(1);
    expect(data<{ backlinks: { title: string }[] }>(await call(client, 'brain_links', { id_or_title: 'Redis' })).backlinks.map((link) => link.title)).toEqual([
      'Cache strategy',
    ]);
  });

  it('writes global memories only through global: true', async () => {
    const client = await connect(projectScope('api'));
    expect(data(await call(client, 'brain_store', { title: 'Team style', content: 'x', type: 'preference', global: true }))).toMatchObject({
      memory: { projectId: null },
    });
  });

  it('isolates projects: one project server cannot see or change another project memories', async () => {
    const api = await connect(projectScope('api'), 'claude-code');
    const web = await connect(projectScope('web'), 'codex-mcp-client');
    const { memory } = data<{ memory: { id: string } }>(await call(api, 'brain_store', { title: 'API secret plan', content: 'x', type: 'decision' }));

    expect(data(await call(web, 'brain_recall', { id_or_title: 'API secret plan' }))).toEqual({ found: false });
    expect(data<{ hits: unknown[] }>(await call(web, 'brain_search', { query: 'secret' })).hits).toEqual([]);
    const deleteAttempt = await call(web, 'brain_delete', { id: memory.id });
    expect(deleteAttempt.isError).toBe(true);
    expect(deleteAttempt.content[0]?.text).toMatch(/^not_found:/);
  });

  it('a global server sees only global memories', async () => {
    const api = await connect(projectScope('api'));
    await call(api, 'brain_store', { title: 'Project note', content: 'x', type: 'learning' });
    await call(api, 'brain_store', { title: 'Shared note', content: 'x', type: 'learning', global: true });
    const global = await connect(GLOBAL_SCOPE);
    expect(data<{ items: { title: string }[] }>(await call(global, 'brain_list')).items.map((item) => item.title)).toEqual(['Shared note']);
  });

  it('refuses to store credentials, saying why, and stores nothing', async () => {
    const client = await connect(projectScope('api'), 'claude-code');
    const refused = await call(client, 'brain_store', { title: 'Banco de produção', content: 'Use postgres://app:Sup3rSenha@db/loja', type: 'project_context' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/^invalid: .*credential.*url-credentials/);
    expect(data(await call(client, 'brain_recall', { id_or_title: 'Banco de produção' }))).toEqual({ found: false });
  });

  it('records which client wrote a memory', async () => {
    const codex = await connect(projectScope('api'), 'codex-mcp-client');
    expect(data(await call(codex, 'brain_store', { title: 'Retry policy', content: 'x', type: 'code_pattern' }))).toMatchObject({ memory: { source: { kind: 'codex' } } });
    const other = await connect(projectScope('api'), 'cursor');
    expect(data(await call(other, 'brain_store', { title: 'Other', content: 'x', type: 'code_pattern' }))).toMatchObject({ memory: { source: { kind: 'mcp' } } });
  });

  it('soft-deletes only: the row stays for the user to restore or purge', async () => {
    const client = await connect(projectScope('api'));
    const { memory } = data<{ memory: { id: string } }>(await call(client, 'brain_store', { title: 'Temp', content: 'x', type: 'learning' }));
    expect(data(await call(client, 'brain_delete', { id: memory.id }))).toEqual({ deleted: true, id: memory.id });
    expect(handle.db.select({ deletedAt: memories.deletedAt }).from(memories).all()).toEqual([{ deletedAt: expect.any(String) }]);
    expect(new BrainService(handle).recall(memory.id, USER_SCOPE, { kind: 'user', client: 'test' })).toBeNull();
  });

  it('rejects invalid arguments and reports domain errors without breaking the session', async () => {
    const client = await connect(projectScope('api'));
    const invalidType = await call(client, 'brain_store', { title: 'X', content: 'x', type: 'gossip' });
    expect(invalidType.isError).toBe(true);
    const badTitle = await call(client, 'brain_store', { title: 'a [[b]]', content: 'x', type: 'decision' });
    expect(badTitle).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^invalid:/) }] });
    const missing = await call(client, 'brain_recall', {});
    expect(missing.isError).toBe(true);
    expect((await client.listTools()).tools).toHaveLength(TOOLS.length);
  });

  it('reports orchestrator and task status for the scope only', async () => {
    handle.db
      .insert(tasks)
      .values([
        { id: 't1', prompt: 'Optimise queries', projectId: 'api', mode: 'auto', status: 'running', startedAt: '2026-10-28T12:00:00.000Z' },
        { id: 't2', prompt: 'Fix CSS', projectId: 'web', mode: 'codex', status: 'completed' },
        { id: 't3', prompt: 'Old run', projectId: 'api', mode: 'claude', status: 'failed', error: 'timeout' },
      ])
      .run();
    handle.db.insert(taskSteps).values({ id: 's1', taskId: 't1', position: 0, agent: 'claude', kind: 'plan', status: 'completed', inputTokens: 120, outputTokens: 40 }).run();

    const api = await connect(projectScope('api'));
    expect(data(await call(api, 'orchestrator_status'))).toEqual({
      counts: { running: 1, failed: 1 },
      active: [{ id: 't1', prompt: 'Optimise queries', status: 'running', mode: 'auto', startedAt: '2026-10-28T12:00:00.000Z' }],
    });
    expect(data(await call(api, 'task_status', { task_id: 't1' }))).toMatchObject({
      task: { id: 't1', status: 'running' },
      steps: [{ position: 0, agent: 'claude', kind: 'plan', status: 'completed', inputTokens: 120, outputTokens: 40 }],
    });
    const hidden = await call(api, 'task_status', { task_id: 't2' });
    expect(hidden).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^not_found:/) }] });
  });
});

describe('memory confidence over MCP (Phase 20)', () => {
  it('agents see confidence and evidence, can point to where a memory comes from, but never raise its confidence', async () => {
    const client = await connect(projectScope('api'));
    const stored = data<{ memory: { id: string; confidence: string; evidence: { kind: string; ref: string }[] } }>(
      await call(client, 'brain_store', { title: 'Pool de conexões', content: 'O pool do checkout tem 20 conexões.', type: 'decision', source_ref: 'src/db/pool.ts:12' }),
    );
    expect(stored.memory).toMatchObject({ confidence: 'unverified', evidence: [{ kind: 'file', ref: 'src/db/pool.ts:12' }] });
    expect(data(await call(client, 'brain_recall', { id_or_title: 'Pool de conexões' }))).toMatchObject({ confidence: 'unverified', evidence: [{ kind: 'file', ref: 'src/db/pool.ts:12' }] });
    // A credential in the reference is refused like one in the content.
    expect((await call(client, 'brain_store', { title: 'x', content: 'y', type: 'decision', source_ref: 'https://x.dev/?token=ghp_abcdefghijklmnopqrstuvwxyz0123456789' })).isError).toBe(true);
  });

  it('a stale memory reaches agents marked as stale and after a current one', async () => {
    const client = await connect(projectScope('api'));
    const brain = new BrainService(handle);
    const user = { kind: 'user' as const, client: 'electron' };
    const old = brain.store({ title: 'Fila de pedidos no Redis', content: 'Pedidos vão para uma fila Redis.', type: 'decision', projectId: 'api' }, projectScope('api'), user).memory;
    const current = brain.store({ title: 'Fila de pedidos no RabbitMQ', content: 'Pedidos vão para uma fila RabbitMQ, não Redis.', type: 'decision', projectId: 'api' }, projectScope('api'), user).memory;
    brain.setConfidence(old.id, 'stale');
    const { hits } = data<{ hits: { id: string; confidence: string }[] }>(await call(client, 'brain_search', { query: 'fila pedidos' }));
    expect(hits.map((hit) => [hit.id, hit.confidence])).toEqual([
      [current.id, 'unverified'],
      [old.id, 'stale'],
    ]);
  });
});

describe('project profile over MCP (Phase 21)', () => {
  const profile = (projectId: string) => ({
    projectId,
    generatedAt: '2026-10-29T12:00:00.000Z',
    index: { files: 1, indexed: 1, skipped: 0, removed: 0, tooLarge: 0, limited: false },
    stack: null,
    modules: [{ path: 'src', files: 1, symbolCount: 1, symbols: [`main_${projectId}`] }],
    dependencies: [],
    decisions: [],
    problems: [],
    changes: null,
  });

  it('gives the agent the profile of its own project only, and none for the global scope', async () => {
    saveProjectProfile(handle, profile('api'));
    saveProjectProfile(handle, profile('web'));
    const api = data<{ projectId: string; modules: { symbols: string[] }[] }>(await call(await connect(projectScope('api')), 'project_profile'));
    expect(api).toMatchObject({ projectId: 'api', modules: [{ symbols: ['main_api'] }] });
    expect(JSON.stringify(api)).not.toContain('main_web');
    const global = await call(await connect(GLOBAL_SCOPE), 'project_profile');
    expect(global.isError).toBe(true);
    expect(global.content[0]?.text).toMatch(/projeto/);
  });

  it('says when the project has no profile yet', async () => {
    expect(data(await call(await connect(projectScope('web')), 'project_profile'))).toEqual({ found: false, hint: expect.stringContaining('Perfil técnico') });
  });
});
