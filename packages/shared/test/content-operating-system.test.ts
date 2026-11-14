import { describe, expect, it } from 'vitest';
import { contentProjectSchema, deriveProjectNextAction, isPublicPublicationApprovalRequired } from '../src/content-operating-system.js';

const project = contentProjectSchema.parse({
  id: 'project-1', workspaceId: 'workspace-1', channelId: null, videoProjectId: null, title: 'A história do Aethera', brief: null, status: 'active', autonomy: 'assisted', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
});

describe('Aethera content operating system contracts', () => {
  it('accepts a project without an advanced channel configuration', () => {
    expect(project.channelId).toBeNull();
    expect(project.autonomy).toBe('assisted');
  });

  it('rejects unsupported autonomy values', () => {
    expect(() => contentProjectSchema.parse({ ...project, autonomy: 'automatic' })).toThrow();
  });

  it('offers a first action when a project has no execution', () => {
    expect(deriveProjectNextAction(project, [], [], [])).toEqual({ id: 'briefing', label: 'Completar briefing', kind: 'briefing' });
  });

  it('offers recovery after a failed execution without hiding its history', () => {
    expect(deriveProjectNextAction(project, [{ status: 'failed' }], [], [])).toEqual({ id: 'production-retry', label: 'Retomar produção', kind: 'production' });
  });

  it('does not skip the script after a brief is saved', () => {
    const briefProject = contentProjectSchema.parse({ ...project, brief: { topic: 'Tema', audience: 'Público', promise: 'Promessa', format: 'youtube-long', durationSeconds: 600, tone: 'Claro', callToAction: '' } });
    expect(deriveProjectNextAction(briefProject, [], [], [])).toEqual({ id: 'script', label: 'Criar roteiro', kind: 'script' });
    expect(deriveProjectNextAction({ ...briefProject, script: { hook: 'Gancho', outline: 'Estrutura', narration: 'Narração', status: 'draft' } }, [], [], [])).toEqual({ id: 'script', label: 'Aprovar roteiro', kind: 'script' });
  });

  it('allows production only after an approved script', () => {
    const ready = contentProjectSchema.parse({ ...project, brief: { topic: 'Tema', audience: 'Público', promise: 'Promessa', format: 'youtube-long', durationSeconds: 600, tone: 'Claro', callToAction: '' }, script: { hook: 'Gancho', outline: 'Estrutura', narration: 'Narração', status: 'approved' } });
    expect(deriveProjectNextAction(ready, [], [], [])).toEqual({ id: 'production-start', label: 'Iniciar produção', kind: 'production' });
  });

  it('requires a thumbnail before moving an approved production to publication', () => {
    const ready = contentProjectSchema.parse({ ...project, brief: { topic: 'Tema', audience: 'Público', promise: 'Promessa', format: 'youtube-long', durationSeconds: 600, tone: 'Claro', callToAction: '' }, script: { hook: 'Gancho', outline: 'Estrutura', narration: 'Narração', status: 'approved' } });
    const execution = [{ status: 'completed' as const }];
    expect(deriveProjectNextAction(ready, execution, [{ status: 'approved' as const, thumbnailAssetId: null }], [])).toEqual({ id: 'publication-thumbnail', label: 'Escolher thumbnail', kind: 'thumbnail' });
    expect(deriveProjectNextAction(ready, execution, [{ status: 'approved' as const, thumbnailAssetId: 'asset-1' }], [])).toEqual({ id: 'publication-schedule', label: 'Agendar vídeo', kind: 'publication' });
  });

  it('requires approval before a public publication', () => {
    expect(isPublicPublicationApprovalRequired('autonomous', 'public')).toBe(true);
    expect(isPublicPublicationApprovalRequired('manual', 'private')).toBe(true);
    expect(isPublicPublicationApprovalRequired('assisted', 'private')).toBe(false);
  });
});
