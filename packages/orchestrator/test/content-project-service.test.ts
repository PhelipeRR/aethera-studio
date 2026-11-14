import { describe, expect, it } from 'vitest';
import { createPublicationDraft, productionBriefFromContentProject, publicationPolicy, validateContentBrief } from '../src/content-project-service.js';

const brief = { topic: 'Como criar um canal', audience: 'Criadores iniciantes', promise: 'Um caminho prático', format: 'youtube-long' as const, durationSeconds: 600, tone: 'claro', callToAction: 'Inscreva-se' };

describe('content project service', () => {
  it('validates a structured briefing', () => expect(validateContentBrief(brief)).toEqual(brief));
  it('deduplicates tags while preserving the publication draft contract', () => expect(createPublicationDraft({ brief, title: 'Título', description: 'Descrição', tags: ['IA', 'IA', ' vídeo '], chapters: [] }).tags).toEqual(['IA', 'vídeo']));
  it('keeps public publication approval in every autonomy mode', () => {
    expect(publicationPolicy('autonomous', 'public')).toEqual({ approvalRequired: true, reason: 'Publicações públicas exigem aprovação explícita.' });
    expect(publicationPolicy('assisted', 'private')).toEqual({ approvalRequired: false, reason: null });
  });
  it('builds the production brief from the saved project briefing and the channel budget', () => {
    const production = productionBriefFromContentProject({ title: 'Projeto', brief: { ...brief, format: 'youtube-short', durationSeconds: 45 } }, 'video-1', { budgetUsd: 12, audience: 'Canal', tone: 'direto' });
    expect(production).toMatchObject({ projectId: 'video-1', topic: 'Como criar um canal', targetDurationSeconds: 45, audience: 'Criadores iniciantes', tone: 'claro', budgetUsd: 12 });
    expect(production.format.id).toBe('youtube-short');
    expect(production.format.height).toBeGreaterThan(production.format.width);
  });
  it('falls back to the channel profile when the project has no briefing yet', () => {
    const production = productionBriefFromContentProject({ title: 'Projeto sem briefing', brief: null }, 'video-1', { budgetUsd: 0, audience: 'Gamers', tone: 'empolgado' });
    expect(production).toMatchObject({ topic: 'Projeto sem briefing', targetDurationSeconds: 600, audience: 'Gamers', tone: 'empolgado', budgetUsd: 0 });
    expect(production.format.id).toBe('youtube-long');
  });
});
