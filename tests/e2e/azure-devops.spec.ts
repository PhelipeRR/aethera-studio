import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

let server: Server;
let baseUrl = '';
const writes: Array<{ method: string; path: string; body: string }> = [];

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && url.pathname.includes('/pullrequests/2532/threads')) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => { writes.push({ method: request.method ?? 'POST', path: url.pathname, body: Buffer.concat(chunks).toString('utf8') }); response.end(JSON.stringify({ id: 99 })); });
      return;
    }
    if (request.method === 'POST' && url.pathname.includes('/_apis/wit/wiql')) return void response.end(JSON.stringify({ workItems: [{ id: 42 }] }));
    if (url.pathname.endsWith('/_apis/projects')) return void response.end(JSON.stringify({ value: [{ id: 'project-1', name: 'Sistema Unificado', state: 'wellFormed' }] }));
    if (url.pathname.endsWith('/_apis/git/repositories')) return void response.end(JSON.stringify({ value: [{ id: 'repo-1', name: 'root' }] }));
    if (url.pathname.includes('/_apis/work/') && url.pathname.endsWith('/boards')) return void response.end(JSON.stringify({ value: [{ id: 'board-1', name: 'Sprint Board', url: 'http://127.0.0.1/board' }] }));
    if (url.pathname.includes('/pullrequests/2532/iterations/1/changes')) return void response.end(JSON.stringify({ changeEntries: [{ item: { path: '/src/TermConsent/index.tsx', objectId: 'abc', url: 'http://127.0.0.1/file' }, changeType: 'edit' }] }));
    if (url.pathname.includes('/pullrequests/2532/threads')) return void response.end(JSON.stringify({ value: [{ id: 4, status: 'active', comments: [{ id: 1, author: { displayName: 'Revisor' }, content: 'Verificar a validação.', publishedDate: '2026-11-04T10:00:00Z' }] }] }));
    if (url.pathname.includes('/pullrequests/2532')) return void response.end(JSON.stringify({ pullRequestId: 2532, title: 'Ajuste do termo', status: 'active', sourceRefName: 'refs/heads/feature/13525', targetRefName: 'refs/heads/develop', createdBy: { displayName: 'Autor' }, description: 'Descrição da revisão.', mergeStatus: 'succeeded', reviewers: [{ displayName: 'Revisor' }] }));
    if (url.pathname.endsWith('/pullrequests')) return void response.end(JSON.stringify({ value: [{ pullRequestId: 2532, title: 'Ajuste do termo', status: 'active', sourceRefName: 'refs/heads/feature/13525', targetRefName: 'refs/heads/develop', createdBy: { displayName: 'Autor' } }] }));
    if (url.pathname.endsWith('/workitems')) return void response.end(JSON.stringify({ value: [{ id: 42, fields: { 'System.Title': 'Revisar consentimento', 'System.State': 'New', 'System.WorkItemType': 'Task', 'System.AssignedTo': { displayName: 'Pessoa' } } }] }));
    if (url.pathname.endsWith('/iterations')) return void response.end(JSON.stringify({ value: [{ id: 'iteration-1', name: 'Sprint 24', path: 'Projeto\\Sprint 24', attributes: { startDate: '2026-11-01', finishDate: '2026-11-15', timeFrame: 'current' } }] }));
    response.statusCode = 404; response.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake TFS não iniciou');
  baseUrl = `http://127.0.0.1:${address.port}/tfs`;
});

test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test('TFS read-only: conecta, consulta projeto, PR, comentários, task e sprint', async () => {
  test.setTimeout(60_000);
  const app = await launchApp(freshDataDir(), { env: { NB_YOUTUBE_API_KEY: '' } });
  await app.page.evaluate(() => { window.location.hash = '#/azure-devops'; });
  await expect(app.page.getByRole('heading', { name: 'Azure / TFS' })).toBeVisible();
  await expect(app.page.getByLabel('URL do TFS')).toBeVisible();
  await app.page.getByLabel('URL do TFS').fill(baseUrl);
  await app.page.getByLabel('Collection do TFS').fill('CONFEA');
  await app.page.getByLabel('Projeto do TFS').fill('Sistema Unificado');
  await app.page.getByRole('button', { name: 'Salvar conexão' }).click();
  await expect(app.page.getByRole('list', { name: 'Projetos do TFS' })).toContainText('Sistema Unificado');
  const connectionId = await app.page.evaluate(() => localStorage.getItem('azure-devops-connection-id'));
  expect(connectionId).toBeTruthy();
  const readOnly = await app.page.evaluate(async (id) => {
    if (!id) throw new Error('missing connection id');
    const api = window.neuralbridge.azureDevOps;
    const [projects, boards, repositories, pullRequests, iterations, workItems] = await Promise.all([
      api.azureDevOpsProjects(id),
      api.azureDevOpsBoards(id),
      api.azureDevOpsRepositories(id),
      api.azureDevOpsPullRequests({ id, repositoryId: 'repo-1' }),
      api.azureDevOpsIterations(id),
      api.azureDevOpsWorkItems({ id, ids: [42] }),
    ]);
    return { projects, boards, repositories, pullRequests, iterations, workItems };
  }, connectionId);
  expect(readOnly.projects).toContainEqual(expect.objectContaining({ name: 'Sistema Unificado' }));
  expect(readOnly.boards).toContainEqual(expect.objectContaining({ name: 'Sprint Board' }));
  expect(readOnly.repositories).toContainEqual(expect.objectContaining({ id: 'repo-1' }));
  expect(readOnly.pullRequests).toContainEqual(expect.objectContaining({ title: 'Ajuste do termo' }));
  expect(readOnly.iterations).toContainEqual(expect.objectContaining({ name: 'Sprint 24' }));
  expect(readOnly.workItems).toContainEqual(expect.objectContaining({ title: 'Revisar consentimento' }));
  await app.app.close();
});

test('TFS escrita: prepara comentário e só publica após confirmação nativa', async () => {
  test.setTimeout(60_000);
  writes.length = 0;
  const app = await launchApp(freshDataDir(), { env: { NB_YOUTUBE_API_KEY: '' } });
  await app.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await app.page.evaluate(() => { window.location.hash = '#/azure-devops'; });
  await expect(app.page.getByRole('heading', { name: 'Azure / TFS' })).toBeVisible();
  const connection = await app.page.evaluate((input) => window.neuralbridge.azureDevOps.azureDevOpsConnectionSave(input), { baseUrl, collection: 'CONFEA', project: 'Sistema Unificado', readOnly: false });
  await app.page.evaluate((id) => { localStorage.setItem('azure-devops-connection-id', id); }, connection.id);
  const draft = await app.page.evaluate((id) => window.neuralbridge.azureDevOps.azureDevOpsWritePrepare({ id, request: { action: 'comment_pr', repositoryId: 'repo-1', pullRequestId: 2532, content: 'Comentário preparado para homologação.' } }), connection.id);
  expect(writes).toHaveLength(0);
  await app.page.evaluate(({ id, operationId }) => window.neuralbridge.azureDevOps.azureDevOpsWriteExecute({ id, operationId }), { id: connection.id, operationId: draft.operationId });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: 'POST', path: expect.stringContaining('/pullrequests/2532/threads') });
  expect(JSON.parse(writes[0]?.body ?? '{}')).toMatchObject({ comments: [{ content: 'Comentário preparado para homologação.' }], status: 'active' });
  await app.app.close();
});
