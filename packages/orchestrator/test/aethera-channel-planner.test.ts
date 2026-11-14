import { describe, expect, it } from 'vitest';
import {
  detectScheduleConflicts,
  generateVideoMetadata,
  planEditorialCalendar,
  refineMetadataByPrompt,
  rescheduleCalendarItem,
  type AetheraChannelProfile,
} from '../src/aethera/channel-planner.js';
import { interpretPromptToBrief } from '../src/aethera/prompt-to-production.js';

const GAMES_CHANNEL: AetheraChannelProfile = {
  id: 'ch-games',
  platform: 'youtube',
  name: 'Games BR',
  language: 'pt-BR',
  audience: 'gamers',
  visualStyle: 'cinematográfico',
  connected: true,
  autopilot: {
    enabled: true,
    frequencyPerWeek: 3,
    preferredWeekdays: [1, 3, 5],
    preferredTime: '18:00',
    timezone: 'America/Sao_Paulo',
    themes: ['Games e RPGs'],
    approvalPolicy: 'autopilot',
  },
};

describe('AETHERA-CHANNEL-01 planner & metadata', () => {
  it('parses Mon/Wed/Fri 18h schedule and avoids duplicate topics', () => {
    const startDate = new Date('2026-11-16T10:00:00'); // Monday
    const prompt = 'Quero publicar três vídeos por semana no meu canal de games para segunda, quarta e sexta, às 18h';
    const items = planEditorialCalendar({
      prompt,
      channel: GAMES_CHANNEL,
      startDate,
      weeks: 1,
      existingTopics: [`${prompt} — Episódio 1 (Games e RPGs)`],
    });

    expect(items).toHaveLength(3);
    expect(items.map((i) => new Date(i.scheduledAtIso).getDay())).toEqual([1, 3, 5]);
    expect(items.every((i) => new Date(i.scheduledAtIso).getHours() === 18)).toBe(true);
    expect(items[0]?.topic).not.toBe(`${prompt} — Episódio 1 (Games e RPGs)`);
    expect(items.every((i) => !i.hasConflict)).toBe(true);
  });

  it('detects conflicts and clears them after drag-and-drop rescheduling', () => {
    const startDate = new Date('2026-11-16T18:00:00');
    const items = planEditorialCalendar({
      prompt: 'dois vídeos por semana segunda e quarta às 18h',
      channel: GAMES_CHANNEL,
      startDate,
      weeks: 1,
    });

    const secondId = items[1]?.id ?? '';
    const firstIso = items[0]?.scheduledAtIso ?? '';
    const conflicted = rescheduleCalendarItem(items, secondId, firstIso);
    expect(conflicted.every((i) => i.hasConflict)).toBe(true);

    const resolved = detectScheduleConflicts(
      rescheduleCalendarItem(conflicted, secondId, '2026-11-18T18:00:00.000Z'),
    );
    expect(resolved.every((i) => !i.hasConflict)).toBe(true);
  });

  it('generates full YouTube metadata and refines it by prompt', () => {
    const brief = interpretPromptToBrief('Top 10 chefes mais difíceis de Elden Ring em 10 minutos');
    const meta = generateVideoMetadata(brief, { channelName: 'Games BR' });

    expect(meta.title).toContain('Elden Ring');
    expect(meta.chapters[0]?.timestamp).toBe('00:00');
    expect(meta.chapters.length).toBeGreaterThanOrEqual(4);
    expect(meta.hashtags.length).toBeGreaterThan(0);
    expect(meta.alternativeTitles.length).toBe(3);

    const refined = refineMetadataByPrompt(meta, 'Deixe o título mais curto e adicione tags soulslike');
    expect(refined.title).toBe(meta.alternativeTitles[0]);
    expect(refined.tags).toContain('soulslike');
  });
});
