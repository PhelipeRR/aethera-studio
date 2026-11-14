import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrainService, USER_SCOPE } from '@neuralbridge/brain';
import { openDatabase, projects as projectsTable, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectService } from '../src/main/projects.js';
import { registerGitIpcHandlers } from '../src/main/git-ipc-handlers.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-projects-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
});
afterEach(() => handle.close());

function folder(name: string, files: Record<string, string> = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-projects-')), name);
  mkdirSync(root, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

describe('project service', () => {
  it('applies a confirmed AI patch only through the production IPC handlers', async () => {
    const service = createProjectService({ handle }); const root = folder('git-review-patch', { 'app.ts': 'export const value = 1;\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Review', '-c', 'user.email=review@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); const head = git('rev-parse', 'HEAD').trim();
    const patch = 'diff --git a/app.ts b/app.ts\nindex 5f5c8f5..c4d4f4f 100644\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>();
    registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true);
    const authorize = callbacks.get('projects:git:authorize-patch'); const apply = callbacks.get('projects:git:apply-patch'); if (!authorize || !apply) throw new Error('production patch handlers were not registered');
    const event = { senderFrame: { url: 'app://renderer' } };
    await expect(apply(event, { id: project.id, patch, token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/);
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toContain('value = 1'); expect(git('rev-parse', 'HEAD').trim()).toBe(head);
    const staleGrant = await authorize(event, { id: project.id, patch });
    writeFileSync(join(root, 'app.ts'), 'export const value = local;\n');
    await expect(apply(event, { id: project.id, patch, token: (staleGrant as { token: string }).token })).rejects.toThrow(/authorization/);
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toContain('value = local');
    writeFileSync(join(root, 'app.ts'), 'export const value = 1;\n');
    const grant = await authorize(event, { id: project.id, patch });
    await apply(event, { id: project.id, patch, token: (grant as { token: string }).token });
    expect(readFileSync(join(root, 'app.ts'), 'utf8').replaceAll('\r\n', '\n')).toContain('value = 2'); expect(git('rev-parse', 'HEAD').trim()).toBe(head); expect(git('diff', '--cached')).toBe('');
  });

  it('rejects protected Git writes at the main-process service boundary without a grant', async () => {
    const service = createProjectService({ handle }); const root = folder('git-guard', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Guard', '-c', 'user.email=guard@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'changed\n');
    const project = await service.add(root); const beforeStatus = git('status', '--porcelain').trim();
    await expect(service.stage(project.id, ['tracked.txt'], 'missing-grant-token')).rejects.toThrow(/authorization/);
    expect(git('status', '--porcelain').trim()).toBe(beforeStatus);
    const grant = await service.authorize(project.id, 'stage', { paths: ['tracked.txt'] });
    await expect(service.stage(project.id, ['other.txt'], grant.token)).rejects.toThrow(/authorization/);
    expect(git('status', '--porcelain').trim()).toBe(beforeStatus);
  });

  it('invokes the production Git IPC handler mapping against the real project service', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'changed\n');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>();
    registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true);
    const stage = callbacks.get('projects:git:stage'); if (!stage) throw new Error('production stage handler was not registered');
    const event = { senderFrame: { url: 'app://renderer' } }; await expect(stage(event, { id: project.id, paths: ['tracked.txt'], token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/);
    const grant = await service.authorize(project.id, 'stage', { paths: ['tracked.txt'] }); await stage(event, { id: project.id, paths: ['tracked.txt'], token: grant.token });
    expect(git('status', '--porcelain').trim()).toContain('M  tracked.txt');
  });

  it('rejects an untrusted sender before a protected Git callback can write', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-untrusted', { 'tracked.txt': 'before\n' }); const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'changed\n'); const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, (url) => url.startsWith('app://renderer')); const stage = callbacks.get('projects:git:stage'); if (!stage) throw new Error('production stage handler was not registered'); const before = git('status', '--porcelain').trim();
    await expect(stage({ senderFrame: { url: 'https://evil.example/' } }, { id: project.id, paths: ['tracked.txt'], token: 'missing-grant-token-1234567890' })).rejects.toThrow(/Untrusted sender/); expect(git('status', '--porcelain').trim()).toBe(before); expect(git('diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('invokes the registered Unstage callback and preserves the index on rejection', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-unstage', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'changed\n'); git('add', 'tracked.txt');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true);
    const handler = callbacks.get('projects:git:unstage'); if (!handler) throw new Error('production unstage handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    await expect(handler(event, { id: project.id, paths: ['tracked.txt'], token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); const stagedStatus = git('status', '--porcelain').trim(); expect(stagedStatus).toContain('M  tracked.txt');
    const grant = await service.authorize(project.id, 'unstage', { paths: ['tracked.txt'] }); await handler(event, { id: project.id, paths: ['tracked.txt'], token: grant.token }); expect(git('status', '--porcelain').trim()).not.toBe(stagedStatus); expect(git('diff', '--name-only').trim()).toBe('tracked.txt');
  });

  it('invokes the registered Commit callback only with a valid grant', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-commit', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'committed\n'); git('add', 'tracked.txt');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true);
    const handler = callbacks.get('projects:git:commit'); if (!handler) throw new Error('production commit handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    await expect(handler(event, { id: project.id, message: 'should reject', token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(git('log', '-1', '--format=%s').trim()).toBe('base');
    const grant = await service.authorize(project.id, 'commit', { message: 'IPC commit' }); await handler(event, { id: project.id, message: 'IPC commit', token: grant.token }); expect(git('log', '-1', '--format=%s').trim()).toBe('IPC commit');
  });

  it('invokes the registered Branch Delete callback with authorization and preserves the ref on rejection', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-branch', { 'tracked.txt': 'base\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); git('branch', 'remove-me');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true);
    const handler = callbacks.get('projects:git:branch:delete'); if (!handler) throw new Error('production branch delete handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    await expect(handler(event, { id: project.id, name: 'remove-me', token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(git('branch', '--list', 'remove-me').trim()).toContain('remove-me');
    const grant = await service.authorize(project.id, 'branch-delete', { name: 'remove-me' }); await handler(event, { id: project.id, name: 'remove-me', token: grant.token }); expect(git('branch', '--list', 'remove-me').trim()).toBe('');
  });

  it('invokes registered Stash create and drop callbacks with real stash refs', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-stash', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'stash me\n');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const event = { senderFrame: { url: 'app://renderer' } };
    const create = callbacks.get('projects:git:stash:create'); const drop = callbacks.get('projects:git:stash:drop'); if (!create || !drop) throw new Error('production stash handlers were not registered');
    await expect(create(event, { id: project.id, message: 'missing', includeUntracked: false, token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(git('status', '--porcelain').trim()).toContain('M tracked.txt');
    const createGrant = await service.authorize(project.id, 'stash', { message: 'IPC stash', includeUntracked: 'false' }); await create(event, { id: project.id, message: 'IPC stash', includeUntracked: false, token: createGrant.token }); expect(git('status', '--porcelain').trim()).toBe('');
    const dropGrant = await service.authorize(project.id, 'stash', { ref: 'stash@{0}' }); await drop(event, { id: project.id, ref: 'stash@{0}', token: dropGrant.token }); expect(git('stash', 'list').trim()).toBe('');
  });

  it('invokes registered branch create, switch and rename callbacks with real refs', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-branches', { 'tracked.txt': 'base\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const event = { senderFrame: { url: 'app://renderer' } };
    const create = callbacks.get('projects:git:branch:create'); const switchBranch = callbacks.get('projects:git:branch:switch'); const rename = callbacks.get('projects:git:branch:rename'); if (!create || !switchBranch || !rename) throw new Error('production branch handlers were not registered');
    await expect(create(event, { id: project.id, name: 'ipc-feature', token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/);
    const createGrant = await service.authorize(project.id, 'branch-create', { name: 'ipc-feature' }); await create(event, { id: project.id, name: 'ipc-feature', token: createGrant.token });
    const switchGrant = await service.authorize(project.id, 'branch-switch', { name: 'ipc-feature' }); await switchBranch(event, { id: project.id, name: 'ipc-feature', token: switchGrant.token }); expect(git('branch', '--show-current').trim()).toBe('ipc-feature');
    const renameGrant = await service.authorize(project.id, 'branch-rename', { oldName: 'ipc-feature', newName: 'ipc-renamed' }); await rename(event, { id: project.id, name: 'ipc-feature', oldName: 'ipc-feature', newName: 'ipc-renamed', token: renameGrant.token }); expect(git('branch', '--show-current').trim()).toBe('ipc-renamed');
  });

  it('invokes registered Stash apply/pop callbacks against a real stash', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-stash-apply', { 'tracked.txt': 'before\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'stash apply\n'); git('stash', 'push', '-q', '-m', 'external stash');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const event = { senderFrame: { url: 'app://renderer' } };
    const handler = callbacks.get('projects:git:stash:apply'); if (!handler) throw new Error('production stash apply handler was not registered');
    await expect(handler(event, { id: project.id, ref: 'stash@{0}', pop: false, token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(git('stash', 'list').trim()).toContain('external stash');
    const grant = await service.authorize(project.id, 'stash', { ref: 'stash@{0}', pop: 'false' }); await handler(event, { id: project.id, ref: 'stash@{0}', pop: false, token: grant.token }); expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toContain('stash apply'); expect(git('stash', 'list').trim()).toContain('external stash');
    git('stash', 'push', '-q', '-m', 'pop stash'); const popGrant = await service.authorize(project.id, 'stash', { ref: 'stash@{0}', pop: 'true' }); await handler(event, { id: project.id, ref: 'stash@{0}', pop: true, token: popGrant.token }); expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toContain('stash apply'); expect(git('stash', 'list').trim()).toContain('external stash');
  });

  it('invokes registered Revert and Cherry-pick callbacks with real commits', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-history', { 'tracked.txt': 'base\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); writeFileSync(join(root, 'tracked.txt'), 'revert me\n'); git('add', '.'); git('commit', '-q', '-m', 'revert target'); const revertCommit = git('rev-parse', 'HEAD').trim();
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const event = { senderFrame: { url: 'app://renderer' } };
    const revert = callbacks.get('projects:git:revert'); const cherry = callbacks.get('projects:git:cherry-pick'); if (!revert || !cherry) throw new Error('production history handlers were not registered');
    await expect(revert(event, { id: project.id, commit: revertCommit, token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(git('rev-parse', 'HEAD').trim()).toBe(revertCommit);
    const revertGrant = await service.authorize(project.id, 'revert', { commit: revertCommit, mainline: '' }); await revert(event, { id: project.id, commit: revertCommit, token: revertGrant.token }); expect(git('log', '-1', '--format=%s').trim()).toContain('Revert');
    git('switch', '-q', '-c', 'feature'); writeFileSync(join(root, 'feature.txt'), 'feature\n'); git('add', '.'); git('commit', '-q', '-m', 'cherry target'); const cherryCommit = git('rev-parse', 'HEAD').trim(); git('switch', '-q', 'main');
    const cherryGrant = await service.authorize(project.id, 'cherry-pick', { commit: cherryCommit, mainline: '' }); await cherry(event, { id: project.id, commit: cherryCommit, token: cherryGrant.token }); expect(readFileSync(join(root, 'feature.txt'), 'utf8')).toContain('feature');
  });

  it('invokes registered operation resolve Abort for a real pending cherry-pick', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-resolve', { 'tracked.txt': 'base\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); git('switch', '-q', '-c', 'feature'); writeFileSync(join(root, 'tracked.txt'), 'feature\n'); git('commit', '-q', '-am', 'feature'); const commit = git('rev-parse', 'HEAD').trim(); git('switch', '-q', 'main'); writeFileSync(join(root, 'tracked.txt'), 'main\n'); git('commit', '-q', '-am', 'main'); try { git('cherry-pick', commit); } catch { /* expected conflict */ }
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const handler = callbacks.get('projects:git:operation-resolve'); if (!handler) throw new Error('production resolve handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    await expect(handler(event, { id: project.id, operation: 'cherry-pick', action: 'abort', token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); expect(existsSync(join(root, '.git', 'CHERRY_PICK_HEAD'))).toBe(true); const grant = await service.authorize(project.id, 'cherry-pick', { action: 'abort' }); await handler(event, { id: project.id, operation: 'cherry-pick', action: 'abort', token: grant.token }); expect(existsSync(join(root, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('invokes registered operation resolve Continue after real conflict resolution', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-continue', { 'tracked.txt': 'base\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); git('switch', '-q', '-c', 'feature'); writeFileSync(join(root, 'tracked.txt'), 'feature\n'); git('commit', '-q', '-am', 'feature'); const commit = git('rev-parse', 'HEAD').trim(); git('switch', '-q', 'main'); writeFileSync(join(root, 'tracked.txt'), 'main\n'); git('commit', '-q', '-am', 'main'); try { git('cherry-pick', commit); } catch { /* expected conflict */ }
    writeFileSync(join(root, 'tracked.txt'), 'resolved\n'); git('add', 'tracked.txt'); const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const handler = callbacks.get('projects:git:operation-resolve'); if (!handler) throw new Error('production resolve handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    await expect(handler(event, { id: project.id, operation: 'cherry-pick', action: 'continue', token: 'missing-grant-token-1234567890' })).rejects.toThrow(/authorization/); const grant = await service.authorize(project.id, 'cherry-pick', { action: 'continue' }); await handler(event, { id: project.id, operation: 'cherry-pick', action: 'continue', token: grant.token }); expect(git('status', '--porcelain').trim()).toBe(''); expect(git('log', '-1', '--format=%s').trim()).toContain('feature');
  });

  it('keeps two distinct authorized IPC grants consistent when staging concurrently', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-concurrent', { 'one.txt': '1\n', 'two.txt': '2\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); const baseHead = git('rev-parse', 'HEAD').trim(); writeFileSync(join(root, 'one.txt'), 'one changed\n'); writeFileSync(join(root, 'two.txt'), 'two changed\n'); const project = await service.add(root);
    const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const handler = callbacks.get('projects:git:stage'); if (!handler) throw new Error('production stage handler was not registered'); const event = { senderFrame: { url: 'app://renderer' } };
    const first = await service.authorize(project.id, 'stage', { paths: ['one.txt'] }); const second = await service.authorize(project.id, 'stage', { paths: ['two.txt'] }); await Promise.all([handler(event, { id: project.id, paths: ['one.txt'], token: first.token }), handler(event, { id: project.id, paths: ['two.txt'], token: second.token })]);
    expect(git('diff', '--cached', '--name-only').split(/\r?\n/).filter(Boolean).sort()).toEqual(['one.txt', 'two.txt']); expect(git('rev-parse', 'HEAD').trim()).toBe(baseHead);
  });

  it('serializes a concurrent Commit and Stage through the repository write queue', async () => {
    const service = createProjectService({ handle }); const root = folder('git-ipc-commit-stage', { 'one.txt': '1\n', 'two.txt': '2\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'base'); const baseHead = git('rev-parse', 'HEAD').trim(); writeFileSync(join(root, 'one.txt'), 'one staged\n'); writeFileSync(join(root, 'two.txt'), 'two pending\n'); git('add', 'one.txt');
    const project = await service.add(root); const callbacks = new Map<string, (event: { senderFrame: { url: string } }, payload: unknown) => Promise<unknown>>(); registerGitIpcHandlers({ handle: (channel, callback) => callbacks.set(channel, callback) }, service, () => true); const event = { senderFrame: { url: 'app://renderer' } }; const commit = callbacks.get('projects:git:commit'); const stage = callbacks.get('projects:git:stage'); if (!commit || !stage) throw new Error('production commit/stage handlers were not registered');
    const commitGrant = await service.authorize(project.id, 'commit', { message: 'serialized commit' }); const stageGrant = await service.authorize(project.id, 'stage', { paths: ['two.txt'] }); const results = await Promise.allSettled([commit(event, { id: project.id, message: 'serialized commit', token: commitGrant.token }), stage(event, { id: project.id, paths: ['two.txt'], token: stageGrant.token })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter((result) => result.status === 'rejected').map((result) => String(result.reason))).toEqual([expect.stringMatching(/authorization/)]); expect(git('rev-parse', 'HEAD').trim()).not.toBe(baseHead); expect(git('status', '--porcelain').trim()).not.toContain('UU');
  });

  it('serializes ref changes across two real worktrees sharing one common-dir', async () => {
    const root = folder('git-ipc-worktree-race', { 'tracked.txt': 'base\n' }); let firstAcquired!: () => void; let secondQueued!: () => void; let releaseFirst!: () => void; let firstBlocked = false; let firstReleased = false; let secondStartedEarly = false;
    const firstReady = new Promise<void>((resolve) => { firstAcquired = resolve; }); const secondReady = new Promise<void>((resolve) => { secondQueued = resolve; }); const firstGate = new Promise<void>((resolve) => { releaseFirst = () => { firstReleased = true; resolve(); }; });
    const service = createProjectService({ handle, gitWriteHooks: { onQueued: ({ repository }) => { if (repository === linked) secondQueued(); }, beforeAction: async ({ repository }) => { if (repository === root && !firstBlocked) { firstBlocked = true; firstAcquired(); await firstGate; } if (repository === linked && !firstReleased) secondStartedEarly = true; } } });
    const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: dir, encoding: 'utf8' });
    git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'base'); git(root, 'branch', 'shared'); git(root, 'branch', 'idle'); const linked = `${root}-linked`; git(root, 'worktree', 'add', '-q', linked, 'shared');
    const primary = await service.add(root); const secondary = await service.add(linked); const first = await service.authorize(primary.id, 'branch-rename', { oldName: 'idle', newName: 'idle-a' }); const second = await service.authorize(secondary.id, 'branch-rename', { oldName: 'idle', newName: 'idle-b' });
    const firstOperation = service.renameBranch(primary.id, 'idle', 'idle-a', first.token); await firstReady; const secondOperation = service.renameBranch(secondary.id, 'idle', 'idle-b', second.token); await secondReady; releaseFirst(); const results = await Promise.allSettled([firstOperation, secondOperation]);
    expect(secondStartedEarly).toBe(false); expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1); expect(git(root, 'show-ref', '--heads').toString()).toMatch(/refs\/heads\/idle-(a|b)/); expect(git(root, 'show-ref', '--heads').toString()).not.toMatch(/refs\/heads\/idle\s/); expect(git(root, 'branch', '--show-current').trim()).toBe('main'); expect(git(linked, 'branch', '--show-current').trim()).toBe('shared');
  });

  it('serializes independent HEAD changes across two worktrees with distinct grants', async () => {
    const root = folder('git-ipc-worktree-heads', { 'tracked.txt': 'base\n' }); const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: dir, encoding: 'utf8' });
    git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'base'); git(root, 'branch', 'primary-target'); git(root, 'branch', 'linked-target'); const linked = `${root}-linked`; git(root, 'worktree', 'add', '-q', linked, 'linked-target'); git(root, 'switch', '-q', 'main');
    let firstAcquired!: () => void; let secondQueued!: () => void; let releaseFirst!: () => void; let firstBlocked = false; let firstReleased = false; let secondStartedEarly = false; const firstReady = new Promise<void>((resolve) => { firstAcquired = resolve; }); const secondReady = new Promise<void>((resolve) => { secondQueued = resolve; }); const firstGate = new Promise<void>((resolve) => { releaseFirst = () => { firstReleased = true; resolve(); }; });
    const service = createProjectService({ handle, gitWriteHooks: { onQueued: ({ repository }) => { if (repository === linked) secondQueued(); }, beforeAction: async ({ repository }) => { if (repository === root && !firstBlocked) { firstBlocked = true; firstAcquired(); await firstGate; } if (repository === linked && !firstReleased) secondStartedEarly = true; } } }); const primary = await service.add(root); const secondary = await service.add(linked);
    const first = await service.authorize(primary.id, 'branch-switch', { name: 'primary-target' }); const second = await service.authorize(secondary.id, 'branch-switch', { name: 'linked-target' }); const firstOperation = service.switchBranch(primary.id, 'primary-target', first.token); await firstReady; const secondOperation = service.switchBranch(secondary.id, 'linked-target', second.token); await secondReady; releaseFirst(); const results = await Promise.allSettled([firstOperation, secondOperation]);
    expect(secondStartedEarly).toBe(false); expect(results.every((result) => result.status === 'fulfilled')).toBe(true); expect(git(root, 'branch', '--show-current').trim()).toBe('primary-target'); expect(git(linked, 'branch', '--show-current').trim()).toBe('linked-target'); expect(git(root, 'status', '--porcelain').trim()).toBe(''); expect(git(linked, 'status', '--porcelain').trim()).toBe('');
  });

  it('serializes a worktree branch switch with an index write without mixing worktree state', async () => {
    const root = folder('git-ipc-worktree-index', { 'tracked.txt': 'base\n' }); const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=IPC', '-c', 'user.email=ipc@example.dev', ...args], { cwd: dir, encoding: 'utf8' });
    git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'base'); git(root, 'branch', 'feature'); git(root, 'branch', 'switch-target'); const linked = `${root}-linked`; git(root, 'worktree', 'add', '-q', linked, 'feature'); writeFileSync(join(linked, 'linked.txt'), 'only in linked index\n');
    let firstAcquired!: () => void; let secondQueued!: () => void; let releaseFirst!: () => void; let firstBlocked = false; let firstReleased = false; let secondStartedEarly = false; const firstReady = new Promise<void>((resolve) => { firstAcquired = resolve; }); const secondReady = new Promise<void>((resolve) => { secondQueued = resolve; }); const firstGate = new Promise<void>((resolve) => { releaseFirst = () => { firstReleased = true; resolve(); }; });
    const service = createProjectService({ handle, gitWriteHooks: { onQueued: ({ repository }) => { if (repository === linked) secondQueued(); }, beforeAction: async ({ repository }) => { if (repository === root && !firstBlocked) { firstBlocked = true; firstAcquired(); await firstGate; } if (repository === linked && !firstReleased) secondStartedEarly = true; } } }); const primary = await service.add(root); const secondary = await service.add(linked);
    const first = await service.authorize(primary.id, 'branch-switch', { name: 'switch-target' }); const second = await service.authorize(secondary.id, 'stage', { paths: ['linked.txt'] }); const firstOperation = service.switchBranch(primary.id, 'switch-target', first.token); await firstReady; const secondOperation = service.stage(secondary.id, ['linked.txt'], second.token); await secondReady; releaseFirst(); const results = await Promise.allSettled([firstOperation, secondOperation]);
    expect(secondStartedEarly).toBe(false); expect(results.every((result) => result.status === 'fulfilled')).toBe(true); expect(git(root, 'branch', '--show-current').trim()).toBe('switch-target'); expect(git(linked, 'branch', '--show-current').trim()).toBe('feature'); expect(git(linked, 'diff', '--cached', '--name-only').trim()).toBe('linked.txt'); expect(git(root, 'status', '--porcelain').trim()).toBe('');
  });

  it('adds a folder with a readable id, its name and detected stack', async () => {
    const service = createProjectService({ handle });
    const root = folder('Loja Ação API', { 'package.json': JSON.stringify({ dependencies: { next: '15', react: '19' } }), 'README.md': '# Loja' });
    const project = await service.add(root);
    expect(project).toMatchObject({ id: 'loja-acao-api', name: 'Loja Ação API', rootPath: root, preferredAgent: 'auto', exists: true, memoryCount: 0 });
    expect(project.stack?.stacks).toEqual(['node', 'react', 'nextjs']);
    expect(project.files).toEqual(['README.md', 'package.json']);
    expect(project.git).toMatchObject({ isRepo: false });
  });

  it('keeps ids unique and refuses the same folder twice, whatever the letter case', async () => {
    const service = createProjectService({ handle });
    const first = folder('api');
    await service.add(first);
    expect((await service.add(folder('api'))).id).toBe('api-2');
    await expect(service.add(first.toUpperCase())).rejects.toThrow(/já está cadastrada/);
  });

  it('explains why a folder cannot be a project', async () => {
    await expect(createProjectService({ handle }).add('C:\\')).rejects.toThrow(/disco inteiro/);
  });

  it('builds the technical profile from the incremental index and the manifests, and keeps it per project', async () => {
    const service = createProjectService({ handle });
    const { id } = await service.add(folder('perfil', { 'package.json': JSON.stringify({ dependencies: { react: '19.3.0' } }), 'src/app.ts': 'export function main() {}' }));
    expect(service.profile(id)).toBeNull();
    const profile = await service.refreshProfile(id);
    expect(profile).toMatchObject({ projectId: id, index: { files: 1, indexed: 1 }, dependencies: [{ name: 'react', source: 'package.json' }], modules: [{ path: 'src', symbols: ['main'] }], changes: null });
    expect(service.profile(id)).toEqual(profile);
    // The next refresh reads only what changed and says what moved.
    const next = await service.refreshProfile(id);
    expect(next).toMatchObject({ index: { indexed: 0, skipped: 1 }, changes: { modulesAdded: [], modulesRemoved: [] } });
    // Two refreshes at once share one run.
    const [a, b] = await Promise.all([service.refreshProfile(id), service.refreshProfile(id)]);
    expect(a).toBe(b);
  });

  it('indexes the Git history by delta, searches it, and relates a commit to what NeuralBridge knows', async () => {
    const service = createProjectService({ handle });
    const root = folder('historico', { 'src/app.ts': 'export const a = 1;\n' });
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'Configura o retry do pagamento');
    const { id } = await service.add(root);
    expect(await service.indexGit(id)).toMatchObject({ commits: 1, alreadyKnown: 0 });
    expect(await service.indexGit(id)).toMatchObject({ commits: 0 });
    const [hit] = service.searchGit(id, 'retry pagamento');
    expect(hit).toMatchObject({ subject: 'Configura o retry do pagamento', file: null });
    expect(service.commitRelations(id, hit?.hash ?? '')).toMatchObject({ files: ['src/app.ts'] });
    await expect(service.indexGit((await service.add(folder('sem-git'))).id)).resolves.toMatchObject({ isRepo: false, commits: 0 });
  });

  it('updates settings and re-detects the stack on request', async () => {
    const service = createProjectService({ handle });
    const root = folder('api');
    const { id } = await service.add(root);
    await service.update(id, { name: 'API da Loja', preferredAgent: 'codex', rules: 'Sempre rodar os testes.', isPrivate: true });
    writeFileSync(join(root, 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"/>');
    const refreshed = await service.refresh(id);
    expect(refreshed).toMatchObject({ name: 'API da Loja', preferredAgent: 'codex', rules: 'Sempre rodar os testes.', isPrivate: true });
    expect(refreshed.stack?.stacks).toEqual(['dotnet', 'aspnetcore']);
  });

  it('starts at the standard permission level and keeps the level and commands the user sets', async () => {
    const service = createProjectService({ handle });
    const { id, permissionLevel, allowedCommands } = await service.add(folder('perms'));
    expect({ permissionLevel, allowedCommands }).toEqual({ permissionLevel: 'standard', allowedCommands: [] });
    await service.update(id, { permissionLevel: 'commands', allowedCommands: ['npm run e2e', 'npm run e2e', ' dotnet ef '] });
    expect(service.list().find((project) => project.id === id)).toMatchObject({ permissionLevel: 'commands', allowedCommands: ['npm run e2e', 'dotnet ef'] });
    await service.update(id, { permissionLevel: 'full' });
    expect(await service.get(id)).toMatchObject({ permissionLevel: 'full', allowedCommands: ['npm run e2e', 'dotnet ef'] });
  });

  it('shows git state and diffs, only for paths inside the project', async () => {
    const service = createProjectService({ handle });
    const root = folder('repo', { 'a.txt': 'um\n' });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'x', '--allow-empty'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'arquivo'], { cwd: root });
    writeFileSync(join(root, 'a.txt'), 'um\ndois\n');
    const { id } = await service.add(root);
    expect((await service.get(id)).git).toMatchObject({ branch: 'main', changes: [{ path: 'a.txt', status: 'modified' }] });
    expect((await service.diff(id, 'a.txt')).text).toContain('+dois');
    await expect(service.diff(id, '../fora.txt')).rejects.toThrow(/fora do projeto/);
  });

  it('previews files but never secrets', async () => {
    const service = createProjectService({ handle });
    const { id } = await service.add(folder('api', { 'README.md': '# Olá', '.env': 'TOKEN=x' }));
    expect(service.readFile(id, 'README.md')).toEqual({ ok: true, content: '# Olá' });
    expect(service.readFile(id, '.env')).toMatchObject({ ok: false });
  });

  it('reports what removing a project deletes, and removes it with its memories', async () => {
    const service = createProjectService({ handle });
    const { id } = await service.add(folder('api'));
    const brain = new BrainService(handle);
    brain.store({ title: 'Regra', content: 'x', type: 'decision', projectId: id }, USER_SCOPE, { kind: 'user', client: 'test' });
    brain.store({ title: 'Global', content: 'x', type: 'decision', projectId: null }, USER_SCOPE, { kind: 'user', client: 'test' });
    expect(service.impact(id)).toEqual({ memories: 1 });
    expect(service.list()[0]?.memoryCount).toBe(1);
    expect(service.remove(id)).toEqual({ removed: true, memories: 1 });
    expect(service.list()).toEqual([]);
    expect(brain.list({}, USER_SCOPE).items.map((item) => item.title)).toEqual(['Global']);
  });

  it('notices when a project folder was moved or deleted', async () => {
    const service = createProjectService({ handle });
    const root = folder('api');
    const { id } = await service.add(root);
    renameSync(root, `${root}-movida`);
    expect(service.list()[0]).toMatchObject({ id, exists: false });
    expect(await service.get(id)).toMatchObject({ exists: false, git: null, files: [] });
    expect(handle.db.select().from(projectsTable).all()).toHaveLength(1);
  });
});
