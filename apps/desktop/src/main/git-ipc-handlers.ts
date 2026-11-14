type GitProjectsService = {
  stage(id: string, paths: string[], token: string): Promise<{ ok: true }>;
  unstage(id: string, paths: string[], token: string): Promise<{ ok: true }>;
  createBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
  switchBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
  renameBranch(id: string, oldName: string, newName: string, token: string): Promise<{ ok: true }>;
  deleteBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
  createStash(id: string, message: string, includeUntracked: boolean, token: string): Promise<{ ok: true }>;
  applyStash(id: string, ref: string, pop: boolean, token: string): Promise<{ ok: true }>;
  dropStash(id: string, ref: string, token: string): Promise<{ ok: true }>;
  commit(id: string, message: string, token: string): Promise<{ ok: true }>;
  push(id: string, remote: string | undefined, token: string): Promise<{ ok: true }>;
  revert(id: string, commit: string, mainline: number | undefined, token: string): Promise<{ ok: true }>;
  cherryPick(id: string, commit: string, mainline: number | undefined, token: string): Promise<{ ok: true }>;
  resolveOperation(id: string, operation: 'revert' | 'cherry-pick', action: 'continue' | 'abort', token: string): Promise<{ ok: true }>;
  authorizePatch(id: string, patch: string): Promise<{ token: string; expiresAt: string }>;
  applyPatch(id: string, patch: string, token: string): Promise<{ ok: true }>;
};

export function createGitIpcHandlers(projects: GitProjectsService) {
  return {
    stage: (input: { id: string; paths: string[]; token: string }) => projects.stage(input.id, input.paths, input.token),
    unstage: (input: { id: string; paths: string[]; token: string }) => projects.unstage(input.id, input.paths, input.token),
    branchCreate: (input: { id: string; name: string; token: string }) => projects.createBranch(input.id, input.name, input.token),
    branchSwitch: (input: { id: string; name: string; token: string }) => projects.switchBranch(input.id, input.name, input.token),
    branchRename: (input: { id: string; oldName: string; newName: string; token: string }) => projects.renameBranch(input.id, input.oldName, input.newName, input.token),
    branchDelete: (input: { id: string; name: string; token: string }) => projects.deleteBranch(input.id, input.name, input.token),
    stashCreate: (input: { id: string; message: string; includeUntracked: boolean; token: string }) => projects.createStash(input.id, input.message, input.includeUntracked, input.token),
    stashApply: (input: { id: string; ref: string; pop: boolean; token: string }) => projects.applyStash(input.id, input.ref, input.pop, input.token),
    stashDrop: (input: { id: string; ref: string; token: string }) => projects.dropStash(input.id, input.ref, input.token),
    commit: (input: { id: string; message: string; token: string }) => projects.commit(input.id, input.message, input.token),
    push: (input: { id: string; remote?: string | undefined; token: string }) => projects.push(input.id, input.remote, input.token),
    revert: (input: { id: string; commit: string; mainline?: number | undefined; token: string }) => projects.revert(input.id, input.commit, input.mainline, input.token),
    cherryPick: (input: { id: string; commit: string; mainline?: number | undefined; token: string }) => projects.cherryPick(input.id, input.commit, input.mainline, input.token),
    resolve: (input: { id: string; operation: 'revert' | 'cherry-pick'; action: 'continue' | 'abort'; token: string }) => projects.resolveOperation(input.id, input.operation, input.action, input.token),
    authorizePatch: (input: { id: string; patch: string }) => projects.authorizePatch(input.id, input.patch),
    applyPatch: (input: { id: string; patch: string; token: string }) => projects.applyPatch(input.id, input.patch, input.token),
  };
}
import { IpcChannel } from '@neuralbridge/shared';
import { registerIpcHandler, type IpcMainLike } from './ipc/handle.js';


export function registerGitIpcHandlers(ipc: IpcMainLike, projects: GitProjectsService, isTrustedSender: (url: string) => boolean): void {
  const handlers = createGitIpcHandlers(projects);
  registerIpcHandler(ipc, IpcChannel.projectsGitStage, handlers.stage, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitUnstage, handlers.unstage, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitBranchCreate, handlers.branchCreate, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitBranchSwitch, handlers.branchSwitch, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitBranchRename, handlers.branchRename, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitBranchDelete, handlers.branchDelete, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitStashCreate, handlers.stashCreate, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitStashApply, handlers.stashApply, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitStashDrop, handlers.stashDrop, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitCommit, handlers.commit, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitPush, handlers.push, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitRevert, handlers.revert, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitCherryPick, handlers.cherryPick, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitOperationResolve, handlers.resolve, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitAuthorizePatch, handlers.authorizePatch, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.projectsGitApplyPatch, handlers.applyPatch, isTrustedSender);
}
