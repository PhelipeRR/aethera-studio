import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContentOperatingSystemRepository, openDatabase } from '../src/index.js';

describe('ContentOperatingSystemRepository', () => {
  it('creates a default channel and project without requiring advanced configuration', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const channel = repository.createChannel({ id: 'channel-1', workspaceId: 'workspace-1', name: 'Canal principal', autonomy: 'assisted', budgetUsd: 25, concurrencyLimit: 3 });
    const project = repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Primeiro vídeo', autonomy: 'assisted' });
    expect(channel.name).toBe('Canal principal');
    expect(repository.listChannels()[0]).toMatchObject({ budgetUsd: 25, concurrencyLimit: 3 });
    expect(project.channelId).toBeNull();
    handle.close();
  });

  it('preserves multiple executions and package versions for one project', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'manual' });
    repository.addExecution({ id: 'run-1', projectId: 'project-1', status: 'failed' });
    repository.addExecution({ id: 'run-2', projectId: 'project-1', status: 'completed' });
    repository.savePublicationPackage({ id: 'package-1', projectId: 'project-1', version: 1, title: 'Título 1', tags: [] });
    repository.savePublicationPackage({ id: 'package-2', projectId: 'project-1', version: 2, title: 'Título 2', tags: [] });
    expect(repository.listExecutions('project-1')).toHaveLength(2);
    expect(repository.listPublicationPackages('project-1').map((item) => item.version)).toEqual([1, 2]);
    handle.close();
  });

  it('records package approval as a separate transition', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'assisted' });
    repository.savePublicationPackage({ id: 'package-1', projectId: 'project-1', version: 1, title: 'Título', tags: [], thumbnailAssetId: 'thumbnail-1' });
    expect(repository.approvePublicationPackage('package-1', 'user', 'Pacote revisado')).toBe(true);
    expect(repository.listPublicationPackages('project-1')[0]?.status).toBe('approved');
    expect(repository.listPublicationApprovals('package-1')[0]).toMatchObject({ packageVersion: 1, decision: 'approved', approvedBy: 'user', note: 'Pacote revisado' });
    handle.close();
  });

  it('only schedules an approved package', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'assisted' });
    repository.savePublicationPackage({ id: 'package-1', projectId: 'project-1', version: 1, title: 'Título', tags: [], thumbnailAssetId: 'thumbnail-1' });
    expect(() => repository.schedulePublication({ id: 'publication-1', projectId: 'project-1', packageId: 'package-1', platform: 'youtube', visibility: 'public', scheduledAt: null, approved: true })).toThrow(/aprove/);
    repository.approvePublicationPackage('package-1');
    expect(repository.schedulePublication({ id: 'publication-1', projectId: 'project-1', packageId: 'package-1', platform: 'youtube', visibility: 'public', scheduledAt: null, approved: true })).toMatchObject({ status: 'scheduled', visibility: 'public' });
    handle.close();
  });

  it('requires an approved thumbnail for public scheduling', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-public', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo público', autonomy: 'assisted' });
    repository.savePublicationPackage({ id: 'package-public', projectId: 'project-public', version: 1, title: 'Título', tags: [] });
    repository.approvePublicationPackage('package-public');
    expect(() => repository.schedulePublication({ id: 'publication-public', projectId: 'project-public', packageId: 'package-public', platform: 'youtube', visibility: 'public', scheduledAt: null, approved: true })).toThrow(/thumbnail/);
    handle.close();
  });

  it('starts a draft production only for an existing project', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'assisted' });
    expect(repository.startProduction({ id: 'run-1', projectId: 'project-1' }).status).toBe('draft');
    expect(() => repository.startProduction({ id: 'run-2', projectId: 'missing' })).toThrow(/projeto/);
    handle.close();
  });

  it('stores analytics snapshots without changing project state', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'assisted' });
    repository.saveAnalyticsSnapshot({ id: 'analytics-1', projectId: 'project-1', publicationId: null, platform: 'youtube', capturedAt: '2026-11-10T00:00:00.000Z', metrics: { views: 42, retention: 0.5 }, notes: 'Importado do canal conectado.' });
    expect(repository.listAnalyticsSnapshots('project-1')[0]).toMatchObject({ metrics: { views: 42, retention: 0.5 } });
    expect(repository.project('project-1')?.status).toBe('active');
    handle.close();
  });

  it('follows the production run status so the project never shows a stale execution', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Vídeo', autonomy: 'manual' });
    repository.addExecution({ id: 'run-1', projectId: 'project-1', status: 'draft' });
    expect(repository.updateExecutionStatus('run-1', 'failed')?.status).toBe('failed');
    expect(repository.listExecutions('project-1')[0]?.status).toBe('failed');
    expect(repository.updateExecutionStatus('run-unknown', 'running')).toBeNull();
    expect(repository.listOpenExecutions()).toEqual([]);
    handle.close();
  });

  it('counts in-progress executions across every project of a channel', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createChannel({ id: 'channel-1', workspaceId: 'workspace-1', name: 'Canal', autonomy: 'assisted', concurrencyLimit: 2 });
    repository.createProject({ id: 'project-a', workspaceId: 'workspace-1', channelId: 'channel-1', videoProjectId: null, title: 'A', autonomy: 'assisted' });
    repository.createProject({ id: 'project-b', workspaceId: 'workspace-1', channelId: 'channel-1', videoProjectId: null, title: 'B', autonomy: 'assisted' });
    repository.createProject({ id: 'project-c', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'C', autonomy: 'assisted' });
    repository.addExecution({ id: 'run-a', projectId: 'project-a', status: 'running' });
    repository.addExecution({ id: 'run-b', projectId: 'project-b', status: 'awaiting_approval' });
    repository.addExecution({ id: 'run-b-old', projectId: 'project-b', status: 'completed' });
    repository.addExecution({ id: 'run-c', projectId: 'project-c', status: 'running' });
    expect(repository.countActiveExecutions({ channelId: 'channel-1' })).toBe(2);
    expect(repository.countActiveExecutions({ projectId: 'project-c' })).toBe(1);
    expect(repository.listOpenExecutions().map((execution) => execution.id).sort()).toEqual(['run-a', 'run-b', 'run-c']);
    handle.close();
  });

  it('converts an idea into a project while retaining the idea history', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-content-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createIdea({ id: 'idea-1', workspaceId: 'workspace-1', channelId: null, title: 'Como funciona o Aethera', angle: 'explicação', source: 'manual' });
    const project = repository.convertIdea({ ideaId: 'idea-1', projectId: 'project-1', videoProjectId: null, autonomy: 'assisted' });
    expect(project.title).toBe('Como funciona o Aethera');
    expect(repository.listIdeas('workspace-1')[0]?.status).toBe('converted');
    handle.close();
  });
});
