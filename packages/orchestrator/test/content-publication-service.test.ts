import { describe, expect, it } from 'vitest';
import { createPublicationPackage, evaluatePublicationPolicy, publicationApprovalStatus, toYouTubePublicationRequest } from '../src/content-publication-service.js';

const brief = { topic: 'Tema', audience: 'Público', promise: 'Uma promessa clara', format: 'youtube-long' as const, durationSeconds: 120, tone: 'Direto', callToAction: '' };

describe('content publication service', () => {
  it('normalizes tags and orders chapters without external providers', () => {
    const result = createPublicationPackage({ brief, title: 'Título', description: 'Descrição', tags: [' Aethera ', 'aethera', 'produção'], chapters: [{ time: 60, title: 'Fim' }, { time: 0, title: 'Começo' }] });
    expect(result.tags).toEqual(['aethera', 'produção']);
    expect(result.chapters.map((chapter) => chapter.time)).toEqual([0, 60]);
  });

  it('blocks over-budget work and gates public publication', () => {
    expect(evaluatePublicationPolicy({ mode: 'autonomous', visibility: 'public', estimatedCostUsd: 11, budgetUsd: 10 })).toMatchObject({ allowed: false });
    const policy = evaluatePublicationPolicy({ mode: 'autonomous', visibility: 'public', estimatedCostUsd: 1, budgetUsd: 10 });
    expect(policy).toMatchObject({ allowed: true, approvalRequired: true });
    expect(publicationApprovalStatus(policy, false)).toBe('awaiting_approval');
    expect(publicationApprovalStatus(policy, true)).toBe('approved');
  });

  it('rejects chapters outside the video duration', () => {
    expect(() => createPublicationPackage({ brief, title: 'Título', description: '', tags: ['tag'], chapters: [{ time: 120, title: 'Inválido' }] })).toThrow(/capítulos/);
  });

  it('maps an approved package to the existing YouTube contract without calling OAuth', () => {
    const result = toYouTubePublicationRequest({ projectId: 'project-1', outputRelativePath: 'renders/final.mp4', package: { brief, title: 'Título', description: 'Descrição', tags: ['tag'], chapters: [] }, privacy: 'private', publishAt: null });
    expect(result).toMatchObject({ projectId: 'project-1', outputRelativePath: 'renders/final.mp4', confirmed: true });
  });
});
