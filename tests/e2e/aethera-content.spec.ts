import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test.setTimeout(60_000);

test('Aethera runs the guided content journey without external credentials', async () => {
  const { app, page } = await launchApp(undefined, { freshInstall: true });
  try {
    const channel = await page.evaluate(() => window.neuralbridge.content.createChannel({ id: crypto.randomUUID(), workspaceId: 'workspace-e2e', name: 'Canal E2E', autonomy: 'assisted' }));
    const idea = await page.evaluate((channelId) => window.neuralbridge.content.createIdea({ id: crypto.randomUUID(), workspaceId: 'workspace-e2e', channelId, title: 'Como organizar um pipeline de vídeos', angle: 'Da ideia à publicação', source: 'e2e' }), channel.id);
    const project = await page.evaluate((ideaId) => window.neuralbridge.content.convertIdea({ ideaId, projectId: crypto.randomUUID(), videoProjectId: null, autonomy: 'assisted' }), idea.id);
    await page.evaluate(({ id, title }) => window.neuralbridge.content.saveBrief({ projectId: id, brief: { topic: title, audience: 'Criadores', promise: 'Um fluxo claro', format: 'youtube-long', durationSeconds: 300, tone: 'Claro', callToAction: 'Inscreva-se' } }), { id: project.id, title: project.title });
    await page.evaluate((id) => window.neuralbridge.content.saveScript({ projectId: id, script: { hook: 'Você não precisa começar pelo editor.', outline: 'Ideia; briefing; produção; publicação.', narration: 'Este é um roteiro de teste.', status: 'approved' } }), project.id);
    const draft = await page.evaluate(({ id, title }) => window.neuralbridge.content.savePublicationPackage({ id: crypto.randomUUID(), projectId: id, version: 1, title, description: 'Descrição de teste', tags: ['aethera', 'pipeline'], thumbnailAssetId: 'thumbnail-e2e' }), { id: project.id, title: project.title });
    await page.evaluate((id) => window.neuralbridge.content.approvePublicationPackage(id), draft.id);
    await page.evaluate(({ projectId, packageId }) => window.neuralbridge.content.schedulePublication({ id: crypto.randomUUID(), projectId, packageId, platform: 'youtube', visibility: 'public', scheduledAt: '2027-01-10T15:00:00.000Z', approved: true }), { projectId: project.id, packageId: draft.id });
    const result = await page.evaluate((id) => window.neuralbridge.content.dashboard(id), project.id);
    expect(result.project.title).toBe('Como organizar um pipeline de vídeos');
    expect(result.project.script?.status).toBe('approved');
    expect(result.packages[0]?.status).toBe('approved');
    expect(result.publications[0]).toMatchObject({ platform: 'youtube', status: 'scheduled', scheduledAt: '2027-01-10T15:00:00.000Z' });
    const queue = await page.evaluate(() => window.neuralbridge.content.queue('workspace-e2e'));
    expect(queue).toEqual(expect.arrayContaining([expect.objectContaining({ project: expect.objectContaining({ id: project.id }), nextAction: expect.objectContaining({ kind: 'production' }), latestPublicationScheduledAt: '2027-01-10T15:00:00.000Z' })]));
  } finally { await app.close(); }
});
