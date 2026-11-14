import { describe, expect, it } from 'vitest';
import { VIDEO_FORMATS, type VerifiedSubject } from '@neuralbridge/shared';
import { createAetheraRankingProject, rankingTemplateCacheKey, rankingTemplateFrameSnapshot, rankingTemplateVisualSnapshot } from '../src/aethera-ranking-templates.js';

const subject = (id: string, title: string, releaseDate: string, platforms: string[]): VerifiedSubject => ({
  schemaVersion: 1,
  id,
  kind: 'game',
  title,
  aliases: [],
  releaseDate,
  datePrecision: 'day',
  platforms,
  companies: ['Estúdio verificado'],
  externalIds: { igdb: id },
  verification: 'confirmed',
  evidenceIds: [`evidence-${id}`],
  checkedAt: '2026-11-11T00:00:00.000Z',
});

const input = {
  title: 'Os melhores jogos de 2026',
  criteria: 'lançamentos mais marcantes',
  period: '2026',
  entries: [
    { rank: 10, subject: subject('game-10', 'Jogo Dez', '2026-02-10', ['PC', 'Xbox']) },
    { rank: 9, subject: subject('game-9', 'Jogo Nove', '2026-03-15', ['PlayStation 5']) },
  ],
};

const format = (id: keyof typeof VIDEO_FORMATS) => VIDEO_FORMATS[id];

describe('Aethera ranking templates', () => {
  it('builds the complete 16:9 sequence from verified subjects at 1080p30', () => {
    const project = createAetheraRankingProject({ ...input, format: format('youtube-long') });

    expect(project).toMatchObject({ templateId: 'aethera-ranking', templateVersion: 1, width: 1920, height: 1080, fps: 30 });
    expect(project.ranking.safeArea).toEqual(format('youtube-long').safeArea);
    expect(project.ranking.entries.map((entry) => [entry.rank, entry.subject.title])).toEqual([[10, 'Jogo Dez'], [9, 'Jogo Nove']]);
    expect(project.ranking.scenes.map((scene) => scene.kind)).toEqual(['opening', 'position', 'transition', 'position', 'lower-third', 'closing']);
    expect(project.ranking.scenes.filter((scene) => scene.kind === 'position').map((scene) => scene.rank)).toEqual([10, 9]);
    expect(project.scenes.reduce((total, scene) => total + scene.durationInFrames, 0) / project.fps).toBe(15);
  });

  it('keeps the platform-safe area and subject data when composing 9:16', () => {
    const project = createAetheraRankingProject({ ...input, format: format('youtube-short') });

    expect(project).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(project.ranking.safeArea).toEqual(format('youtube-short').safeArea);
    expect(project.ranking.entries[0]?.subject.releaseDate).toBe('2026-02-10');
    expect(project.ranking.entries[0]?.subject.platforms).toEqual(['PC', 'Xbox']);
  });

  it('makes reduced motion a deterministic render parameter', () => {
    const animated = createAetheraRankingProject({ ...input, format: format('youtube-long') });
    const reduced = createAetheraRankingProject({ ...input, format: format('youtube-long'), reducedMotion: true });

    expect(animated.ranking.reducedMotion).toBe(false);
    expect(reduced.ranking.reducedMotion).toBe(true);
    expect(rankingTemplateFrameSnapshot(animated, 10).motion).toMatchObject({ opacity: 0.5, translateY: 12, scale: 1 });
    expect(rankingTemplateFrameSnapshot(reduced, 10).motion).toEqual({ opacity: 1, translateY: 0, scale: 1, transitionOpacity: 1 });
  });

  it('keeps visual snapshots and cache keys stable while including the template version', () => {
    const project = createAetheraRankingProject({ ...input, format: format('youtube-long') });
    const parsed = JSON.parse(JSON.stringify(project)) as typeof project;

    expect(rankingTemplateCacheKey(project)).toBe(rankingTemplateCacheKey(parsed));
    const nextTemplateVersion = { ...project, templateVersion: 2 } as unknown as typeof project;
    expect(rankingTemplateCacheKey(nextTemplateVersion)).not.toBe(rankingTemplateCacheKey(project));
    expect(rankingTemplateVisualSnapshot(project)).toMatchInlineSnapshot(`
      [
        {
          "frame": 0,
          "kind": "opening",
          "safeArea": {
            "bottom": 54,
            "left": 96,
            "right": 96,
            "top": 54,
          },
          "text": [
            "Os melhores jogos de 2026",
            "lançamentos mais marcantes",
          ],
        },
        {
          "frame": 90,
          "kind": "position",
          "rank": 10,
          "safeArea": {
            "bottom": 54,
            "left": 96,
            "right": 96,
            "top": 54,
          },
          "text": [
            "#10",
            "Jogo Dez",
            "10/02/2026",
            "PC · Xbox",
          ],
        },
      ]
    `);
  });
});
