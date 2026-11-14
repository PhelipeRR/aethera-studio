import { describe, expect, it } from 'vitest';
import { AzureDevOpsClient } from '../src/integrations/azure-devops-client.js';
import { withCorrelation } from '../src/correlation.js';

const response = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Denied', headers: { 'content-type': 'application/json', ...extraHeaders } });
const connection = { baseUrl: 'https://tfs.example.test/tfs', collection: 'CONFEA', project: 'Sistema Unificado', readOnly: true } as const;

describe('AzureDevOpsClient', () => {
  it('maps tolerant PR and work item payloads without leaking raw provider objects', async () => {
    const client = new AzureDevOpsClient(connection, { http: async (url) => url.includes('pullrequests') ? response({ value: [{ pullRequestId: 12, title: 'Ajuste', status: 'active', sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/develop', createdBy: { displayName: 'Pessoa' }, extra: 'ignored' }] }) : response({ value: [{ id: 7, fields: { 'System.Title': 'Task', 'System.Description': '<p>Descrição do item</p>', 'System.State': 'New', 'System.WorkItemType': 'Task' }, extra: 'ignored' }] }) });
    expect(await client.listPullRequests('repo')).toEqual([{ id: 12, title: 'Ajuste', status: 'active', createdBy: 'Pessoa', sourceRef: 'refs/heads/feature/x', targetRef: 'refs/heads/develop', url: null, updatedAt: null }]);
    expect(await client.getWorkItems([7])).toEqual([{ id: 7, title: 'Task', description: '<p>Descrição do item</p>', state: 'New', type: 'Task', assignedTo: null, parentId: null, url: null, originalEstimate: null, remainingWork: null, completedWork: null, commits: [], attachments: [] }]);
  });
  it('translates authentication and permission failures', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({}, 401) });
    await expect(client.listProjects()).rejects.toMatchObject({ azureDevOps: { code: 'login_required', status: 401 } });
  });
  it('reports endpoint capabilities without failing the whole probe', async () => {
    const client = new AzureDevOpsClient(connection, { http: async (url) => url.includes('/_apis/git/') ? response({}, 403) : response({ value: [] }) });
    expect(await client.capabilities()).toMatchObject({ projects: true, repositories: false, pullRequests: false, workItems: true, boards: true, iterations: true });
  });
  it('maps pull request detail and review threads into safe review contracts', async () => {
    const client = new AzureDevOpsClient(connection, { http: async (url) => url.includes('/threads')
      ? response({ value: [{ id: 4, status: 'active', comments: [{ id: 9, author: { displayName: 'Revisor' }, content: 'Ajustar validação', publishedDate: '2026-11-04T10:00:00Z' }] }] })
      : response({ pullRequestId: 12, title: 'Ajuste', status: 'active', sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/develop', createdBy: { displayName: 'Pessoa' }, description: 'Detalhes', mergeStatus: 'succeeded', reviewers: [{ displayName: 'Revisor' }] }) });
    await expect(client.pullRequestDetail('repo', 12)).resolves.toEqual({ id: 12, title: 'Ajuste', status: 'active', createdBy: 'Pessoa', sourceRef: 'refs/heads/feature/x', targetRef: 'refs/heads/develop', url: null, updatedAt: null, description: 'Detalhes', mergeStatus: 'succeeded', reviewers: ['Revisor'] });
    await expect(client.pullRequestThreads('repo', 12)).resolves.toEqual([{ id: 4, status: 'active', comments: [{ id: 9, author: 'Revisor', content: 'Ajustar validação', publishedAt: '2026-11-04T10:00:00Z' }] }]);
  });
  it('maps boards for the project work area', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({ value: [{ id: 'board-1', name: 'Sprint Board', url: 'https://tfs.example.test/board', extra: 'ignored' }] }) });
    await expect(client.listBoards()).resolves.toEqual([{ id: 'board-1', name: 'Sprint Board', url: 'https://tfs.example.test/board' }]);
  });
  it('maps changed files from the first pull request iteration', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({ changeEntries: [{ item: { path: '/src/index.ts', objectId: 'abc', url: 'https://tfs.example.test/file' }, changeType: 'edit', extra: 'ignored' }] }) });
    await expect(client.pullRequestChanges('repo', 12)).resolves.toEqual([{ path: '/src/index.ts', changeType: 'edit', objectId: 'abc', url: 'https://tfs.example.test/file', content: null, baseContent: null, targetContent: null }]);
  });
  it('builds a real base/target diff from PR commits', async () => {
    const client = new AzureDevOpsClient(connection, { http: async (url) => {
      if (url.includes('/items?')) return url.includes('versionDescriptor.version=target') ? new Response('const value = 2;') : new Response('const value = 1;');
      if (url.includes('/iterations/1/changes')) return response({ changeEntries: [{ item: { path: '/src/index.ts', objectId: 'target' }, changeType: 'edit' }] });
      return response({ lastMergeSourceCommit: { commitId: 'source' }, lastMergeTargetCommit: { commitId: 'target' } });
    } });
    await expect(client.pullRequestChanges('repo', 12)).resolves.toEqual([{ path: '/src/index.ts', changeType: 'edit', objectId: 'target', url: null, content: '--- a/src/index.ts\n+++ b/src/index.ts\n-const value = 1;\n+const value = 2;', baseContent: 'const value = 1;', targetContent: 'const value = 2;' }]);
  });
  it('passes AbortSignal through every read request', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const client = new AzureDevOpsClient(connection, { signal: controller.signal, http: async (_url, init) => { received = init?.signal as AbortSignal | undefined; return response({ value: [] }); } });
    await client.listProjects();
    expect(received).toBe(controller.signal);
  });
  it('uses an explicit PAT authorization header without exposing the token in the domain contract', async () => {
    let init: RequestInit | undefined;
    const client = new AzureDevOpsClient(connection, { authorization: 'Basic dGVzdA==', http: async (_url, request) => { init = request; return response({ value: [] }); } });
    await client.listProjects();
    expect(init?.headers).toEqual({ authorization: 'Basic dGVzdA==' });
  });
  it('follows TFS continuation tokens for collection reads', async () => {
    const urls: string[] = [];
    const client = new AzureDevOpsClient(connection, { http: async (url) => { urls.push(url); return urls.length === 1 ? response({ value: [{ id: 'p1', name: 'One' }] }, 200, { 'x-ms-continuationtoken': 'next-page' }) : response({ value: [{ id: 'p2', name: 'Two' }] }); } });
    await expect(client.listProjects()).resolves.toEqual([{ id: 'p1', name: 'One', url: null, state: null }, { id: 'p2', name: 'Two', url: null, state: null }]);
    expect(urls[1]).toContain('continuationToken=next-page');
  });
  it('rejects writes while the connection is read-only', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({}) });
    await expect(client.commentPullRequest('repo', 12, 'comentário')).rejects.toMatchObject({ azureDevOps: { code: 'read_only' } });
  });
  it('sends confirmed write transport with typed payloads when enabled', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AzureDevOpsClient({ ...connection, readOnly: false }, { writeHttp: async (url, init) => { requests.push({ url, init }); return response({ id: 99 }); } });
    await expect(client.commentPullRequest('repo', 12, 'Ajustar validação')).resolves.toEqual({ id: 99 });
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(requests[0]?.init?.body).toContain('Ajustar validação');
  });
  it('sends the current correlation id as X-TFS-Session and keeps authorization', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const client = new AzureDevOpsClient(connection, { authorization: 'Basic abc', http: async (_url, init) => { seen.push(init); return response({ value: [] }); } });
    await withCorrelation('2b1f6f0e-6f0b-4b7a-9d1e-0a6c2f6b8e11', () => client.listProjects());
    await withCorrelation('not-a-guid', () => client.listProjects());
    await client.listProjects();
    expect(seen[0]?.headers).toMatchObject({ authorization: 'Basic abc', 'x-tfs-session': '2b1f6f0e-6f0b-4b7a-9d1e-0a6c2f6b8e11' });
    expect(seen[1]?.headers).not.toHaveProperty('x-tfs-session');
    expect(seen[2]?.headers).not.toHaveProperty('x-tfs-session');
  });
  it('returns only normalized write results, never the provider payload', async () => {
    const raw = { pullRequestId: 12, status: 'abandoned', createdBy: { uniqueName: 'pessoa@empresa.example', imageUrl: 'x' }, _links: { self: { href: 'https://tfs' } }, id: 7, fields: { 'System.AssignedTo': 'pessoa@empresa.example' } };
    const client = new AzureDevOpsClient({ ...connection, readOnly: false }, { http: async () => response(raw) });
    await expect(client.setPullRequestStatus('repo', 12, 'abandoned')).resolves.toEqual({ pullRequestId: 12, status: 'abandoned' });
    await expect(client.updateWorkItem(7, { state: 'Active' })).resolves.toEqual({ id: 7 });
  });
  it('fails the probe as login_required when every endpoint is unauthorized, instead of reporting connected', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({}, 401) });
    await expect(client.capabilities()).rejects.toMatchObject({ azureDevOps: { code: 'login_required', status: 401 } });
  });
  it('fails the probe as forbidden when every endpoint is forbidden', async () => {
    const client = new AzureDevOpsClient(connection, { http: async () => response({}, 403) });
    await expect(client.capabilities()).rejects.toMatchObject({ azureDevOps: { code: 'forbidden' } });
  });
});
