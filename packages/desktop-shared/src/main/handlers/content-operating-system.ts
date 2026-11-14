import { deriveProjectNextAction, IpcChannel, parseIpcOutput, type ContentAnalyticsSnapshot, type ContentAsset, type ContentProject, type ProductionExecution, type PublicationPackage } from '@neuralbridge/shared';
import type { ContentOperatingSystemRepository } from '@neuralbridge/database';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export function registerContentOperatingSystemIpcHandlers(ipc: IpcMainLike, repository: ContentOperatingSystemRepository, isTrustedSender: (url: string) => boolean, startProduction?: (project: ContentProject) => Promise<ProductionExecution>, publishPackage?: (project: ContentProject, publication: { package: PublicationPackage; outputRelativePath: string; thumbnailRelativePath?: string; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null }) => Promise<{ id: string; youtubeVideoId: string }>, listAssets?: (project: ContentProject) => Promise<ContentAsset[]>, generateScript?: (project: ContentProject, agent: 'claude' | 'codex') => Promise<ContentProject>, syncAnalytics?: (project: ContentProject) => Promise<ContentAnalyticsSnapshot[]>): void {
  registerIpcHandler(ipc, IpcChannel.contentChannelsList, async () => parseIpcOutput(IpcChannel.contentChannelsList, repository.listChannels()), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentIdeasList, async ({ workspaceId }) => parseIpcOutput(IpcChannel.contentIdeasList, repository.listIdeas(workspaceId)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentIdeaCreate, async (input) => parseIpcOutput(IpcChannel.contentIdeaCreate, repository.createIdea({ ...input, angle: input.angle ?? '', source: input.source ?? 'manual' })), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentIdeaConvert, async (input) => parseIpcOutput(IpcChannel.contentIdeaConvert, repository.convertIdea(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentIdeaFromAnalytics, async (input) => { const project = repository.project(input.projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); return parseIpcOutput(IpcChannel.contentIdeaFromAnalytics, repository.createIdea({ id: input.id, workspaceId: project.workspaceId, channelId: project.channelId, title: input.title, angle: input.angle, source: 'analytics' })); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentLibraryList, async ({ projectId }) => { const project = repository.project(projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); if (!listAssets) throw new Error('unavailable: biblioteca ainda não está configurada.'); return parseIpcOutput(IpcChannel.contentLibraryList, await listAssets(project)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentChannelCreate, async (input) => parseIpcOutput(IpcChannel.contentChannelCreate, repository.createChannel(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentChannelUpdate, async (input) => parseIpcOutput(IpcChannel.contentChannelUpdate, repository.updateChannel(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentChannelDelete, async ({ channelId }) => parseIpcOutput(IpcChannel.contentChannelDelete, repository.deleteChannel(channelId)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectsList, async ({ workspaceId }) => parseIpcOutput(IpcChannel.contentProjectsList, repository.listProjects(workspaceId)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentQueueList, async ({ workspaceId }) => {
    const items = repository.listProjects(workspaceId).map((project) => {
      const executions = repository.listExecutions(project.id);
      const packages = repository.listPublicationPackages(project.id);
      const publications = repository.listPublications(project.id);
      return { project, nextAction: deriveProjectNextAction(project, executions, packages, publications), latestExecutionStatus: executions.at(-1)?.status ?? null, latestPackageStatus: packages.at(-1)?.status ?? null, latestPublicationStatus: publications.at(-1)?.status ?? null, latestPublicationScheduledAt: publications.at(-1)?.scheduledAt ?? null };
    });
    return parseIpcOutput(IpcChannel.contentQueueList, items);
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectCreate, async (input) => parseIpcOutput(IpcChannel.contentProjectCreate, repository.createProject(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectDelete, async ({ projectId }) => parseIpcOutput(IpcChannel.contentProjectDelete, repository.deleteProject(projectId)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectBriefSave, async (input) => parseIpcOutput(IpcChannel.contentProjectBriefSave, repository.saveBrief(input.projectId, input.brief)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectScriptSave, async (input) => parseIpcOutput(IpcChannel.contentProjectScriptSave, repository.saveScript(input.projectId, input.script)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectScriptGenerate, async (input) => { const project = repository.project(input.projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); if (!generateScript) throw new Error('unavailable: geração de roteiro ainda não está configurada.'); return parseIpcOutput(IpcChannel.contentProjectScriptGenerate, await generateScript(project, input.agent ?? 'claude')); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentAnalyticsList, async ({ projectId }) => parseIpcOutput(IpcChannel.contentAnalyticsList, repository.listAnalyticsSnapshots(projectId)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentAnalyticsSnapshotSave, async (input) => parseIpcOutput(IpcChannel.contentAnalyticsSnapshotSave, repository.saveAnalyticsSnapshot(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentAnalyticsSync, async ({ projectId }) => { const project = repository.project(projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); if (!syncAnalytics) throw new Error('unavailable: analytics do YouTube ainda não está configurado.'); return parseIpcOutput(IpcChannel.contentAnalyticsSync, await syncAnalytics(project)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentPublicationPublish, async (input) => { const project = repository.project(input.projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); const publicationPackage = repository.publicationPackage(input.packageId); if (!publicationPackage || publicationPackage.projectId !== project.id) throw new Error('not_found: pacote de publicação não pertence ao projeto.'); if (publicationPackage.status !== 'approved') throw new Error('approval_required: aprove o pacote antes de publicar.'); if (!publishPackage) throw new Error('unavailable: publicação YouTube ainda não está configurada.'); const result = await publishPackage(project, { package: publicationPackage, outputRelativePath: input.outputRelativePath, ...(input.thumbnailRelativePath ? { thumbnailRelativePath: input.thumbnailRelativePath } : {}), privacy: input.privacy, publishAt: input.publishAt }); repository.recordPublishedPublication({ id: result.id, projectId: project.id, packageId: publicationPackage.id, platform: 'youtube', visibility: input.privacy, publishedAt: new Date().toISOString() }); return parseIpcOutput(IpcChannel.contentPublicationPublish, result); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProjectDashboard, async ({ projectId }) => {
    const project = repository.project(projectId);
    if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.');
    const executions = repository.listExecutions(projectId);
    const packages = repository.listPublicationPackages(projectId);
    const publications = repository.listPublications(projectId);
    const approvals = packages.flatMap((publicationPackage) => repository.listPublicationApprovals(publicationPackage.id));
    return parseIpcOutput(IpcChannel.contentProjectDashboard, { project, executions, packages, publications, approvals, nextAction: deriveProjectNextAction(project, executions, packages, publications) });
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentPublicationPackageSave, async (input) => {
    const { thumbnailAssetId, ...rest } = input;
    const packageInput = { ...rest, description: input.description ?? '' };
    return parseIpcOutput(IpcChannel.contentPublicationPackageSave, repository.savePublicationPackage(
      thumbnailAssetId === undefined ? packageInput : { ...packageInput, thumbnailAssetId },
    ));
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentPublicationPackageApprove, async ({ id, approvedBy, note }) => { if (!repository.approvePublicationPackage(id, approvedBy, note)) throw new Error('not_found: pacote de publicação não encontrado.'); return parseIpcOutput(IpcChannel.contentPublicationPackageApprove, { approved: true }); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentPublicationSchedule, async (input) => parseIpcOutput(IpcChannel.contentPublicationSchedule, repository.schedulePublication(input)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.contentProductionStart, async (input) => { const project = repository.project(input.projectId); if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.'); if (!project.videoProjectId) throw new Error('invalid: associe o projeto a um projeto de vídeo antes de iniciar a produção.'); const execution = startProduction ? await startProduction(project) : repository.startProduction(input); return parseIpcOutput(IpcChannel.contentProductionStart, execution); }, isTrustedSender);
}
