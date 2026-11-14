/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContentOperatingSystemRepository, openDatabase } from '@neuralbridge/database';
import { IpcChannel } from '@neuralbridge/shared';
import { registerContentOperatingSystemIpcHandlers } from '../src/main/handlers/content-operating-system.js';

describe('Aethera content IPC', () => {
  it('exposes a project dashboard with one next action', async () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ipc-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../../packages/database/migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const handlers = new Map<string, (event: any, payload: any) => Promise<unknown>>();
    registerContentOperatingSystemIpcHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn) }, repository, () => true);
    await handlers.get(IpcChannel.contentProjectCreate)?.({ senderFrame: { url: 'app://trusted' } }, { id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'Primeiro vídeo', autonomy: 'assisted' });
    await expect(handlers.get(IpcChannel.contentProjectDashboard)?.({ senderFrame: { url: 'app://trusted' } }, { projectId: 'project-1' })).resolves.toMatchObject({ project: { title: 'Primeiro vídeo' }, nextAction: { kind: 'briefing', label: 'Completar briefing' } });
    handle.close();
  });

  it('rejects an untrusted renderer through the shared IPC guard', async () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ipc-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../../packages/database/migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const handlers = new Map<string, (event: any, payload: any) => Promise<unknown>>();
    registerContentOperatingSystemIpcHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn) }, repository, () => false);
    await expect(handlers.get(IpcChannel.contentChannelsList)?.({ senderFrame: { url: 'https://evil.example' } }, undefined)).rejects.toThrow(/Untrusted sender/);
    handle.close();
  });

  it('converts an idea through the protected IPC contract', async () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ipc-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../../packages/database/migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createIdea({ id: 'idea-1', workspaceId: 'workspace-1', channelId: null, title: 'Ideia de vídeo', angle: '', source: 'manual' });
    const handlers = new Map<string, (event: any, payload: any) => Promise<unknown>>();
    registerContentOperatingSystemIpcHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn) }, repository, () => true);
    await expect(handlers.get(IpcChannel.contentIdeaConvert)?.({ senderFrame: { url: 'app://trusted' } }, { ideaId: 'idea-1', projectId: 'project-1', videoProjectId: null, autonomy: 'assisted' })).resolves.toMatchObject({ title: 'Ideia de vídeo', brief: null });
    handle.close();
  });

  it('creates an analytics-sourced idea without mutating the project', async () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ipc-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../../packages/database/migrations') });
    const repository = new ContentOperatingSystemRepository(handle.db);
    repository.createProject({ id: 'project-analytics', workspaceId: 'workspace-analytics', channelId: null, videoProjectId: null, title: 'Vídeo publicado', autonomy: 'assisted' });
    const handlers = new Map<string, (event: any, payload: any) => Promise<unknown>>();
    registerContentOperatingSystemIpcHandlers({ handle: (channel: string, fn: any) => handlers.set(channel, fn) }, repository, () => true);
    await expect(handlers.get(IpcChannel.contentIdeaFromAnalytics)?.({ senderFrame: { url: 'app://trusted' } }, { id: 'idea-analytics', projectId: 'project-analytics', title: 'Novo teste', angle: 'Investigar retenção' })).resolves.toMatchObject({ workspaceId: 'workspace-analytics', channelId: null, source: 'analytics' });
    expect(repository.project('project-analytics')?.title).toBe('Vídeo publicado');
    handle.close();
  });
});
