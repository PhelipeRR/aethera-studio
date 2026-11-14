import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AetheraEvolutionCore } from '../src/evolution/evolution-core.js';
import {
  PRESET_NICHES,
  TrendRadarEngine,
  isDuplicateIdeaTitle,
  isWithinPeriod,
  type TrendRadarConnectors,
  type TrendSearchConfig,
} from '../../../apps/aethera-desktop/src/main/trend-radar.js';
import { formatBriefingToProductionPrompt } from '../../../packages/desktop-shared/src/renderer/src/features/video/TrendRadarPanel.js';

const tempDirs: string[] = [];

function createTestEngine(connectors: TrendRadarConnectors = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-trend-radar-'));
  tempDirs.push(dir);
  const evolution = new AetheraEvolutionCore(join(dir, 'evolution.json'));
  return {
    dir,
    engine: new TrendRadarEngine(dir, evolution, connectors),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('TrendRadarEngine', () => {
  it('supports all 10 preset niches and free custom niches', async () => {
    expect(PRESET_NICHES).toHaveLength(10);
    const { engine } = createTestEngine({
      searchNews: async (query) => [
        {
          title: `Avanço recente em ${query}`,
          url: 'https://example.com/custom-niche-news',
          publishedAt: new Date().toISOString(),
          source: 'Revista Especializada',
          origin: 'news',
        },
      ],
    });

    const session = await engine.searchTrends({
      niche: 'Aviação Militar Histórica',
      subniche: 'Caças supersônicos dos anos 70',
      country: 'BR',
      language: 'pt-BR',
      period: '30d',
      format: 'documentary',
      ideaCount: 5,
      targetDurationMin: 12,
    });

    expect(session.config.niche).toBe('Aviação Militar Histórica');
    expect(session.config.subniche).toBe('Caças supersônicos dos anos 70');
    expect(session.ideas).toHaveLength(5);
    expect(session.ideas[0].evidences.length).toBeGreaterThan(0);
    expect(session.ideas[0].evidences[0].url).toBe('https://example.com/custom-niche-news');
  });

  it('handles absence of sources honestly without fabricating URLs or fake metrics', async () => {
    const { engine } = createTestEngine({
      searchYouTube: async () => [],
      searchNews: async () => [],
      searchReddit: async () => [],
    });

    const session = await engine.searchTrends({
      niche: 'Mistérios',
      country: 'BR',
      language: 'pt-BR',
      period: '24h',
      format: 'auto',
      ideaCount: 5,
      targetDurationMin: 8,
    });

    expect(session.sources).toHaveLength(0);
    expect(session.noSourcesFound).toBe(true);
    expect(session.ideas).toHaveLength(0);
  });

  it('survives provider failures and records warnings while returning surviving sources', async () => {
    const { engine } = createTestEngine({
      searchYouTube: async () => {
        throw new Error('yt-dlp offline');
      },
      searchNews: async () => [
        {
          title: 'Novo motor de IA local anunciado hoje',
          url: 'https://example.com/ai-news',
          publishedAt: new Date().toISOString(),
          source: 'TechPortal',
          origin: 'news',
        },
      ],
      searchReddit: async () => {
        throw new Error('Reddit 429 rate limit');
      },
    });

    const session = await engine.searchTrends({
      niche: 'Tecnologia e IA',
      country: 'BR',
      language: 'pt-BR',
      period: '7d',
      format: 'analysis',
      ideaCount: 5,
      targetDurationMin: 10,
    });

    expect(session.providerWarnings.length).toBeGreaterThanOrEqual(2);
    expect(session.sources).toHaveLength(1);
    expect(session.sources[0].url).toBe('https://example.com/ai-news');
    expect(session.ideas).toHaveLength(5);
  });

  it('filters out sources outside the selected period window', async () => {
    const now = Date.now();
    const within24h = new Date(now - 3 * 3600_000).toISOString();
    const tenDaysAgo = new Date(now - 10 * 24 * 3600_000).toISOString();

    expect(isWithinPeriod(within24h, '24h', now)).toBe(true);
    expect(isWithinPeriod(tenDaysAgo, '24h', now)).toBe(false);
    expect(isWithinPeriod(tenDaysAgo, '30d', now)).toBe(true);

    const { engine } = createTestEngine({
      searchNews: async () => [
        {
          title: 'Notícia de hoje',
          url: 'https://example.com/today',
          publishedAt: within24h,
          source: 'NewsToday',
          origin: 'news',
        },
        {
          title: 'Notícia antiga de 10 dias atrás',
          url: 'https://example.com/old',
          publishedAt: tenDaysAgo,
          source: 'OldNews',
          origin: 'news',
        },
      ],
    });

    const session = await engine.searchTrends({
      niche: 'Ciência',
      country: 'BR',
      language: 'pt-BR',
      period: '24h',
      format: 'news',
      ideaCount: 5,
      targetDurationMin: 6,
    });

    expect(session.sources).toHaveLength(1);
    expect(session.sources[0].title).toBe('Notícia de hoje');
  });

  it('avoids duplicating ideas across searches and appendMore requests', async () => {
    expect(
      isDuplicateIdeaTitle(
        'Os bastidores de Elden Ring',
        ['Os Bastidores de Elden Ring!'],
      ),
    ).toBe(true);

    const { engine } = createTestEngine({
      searchNews: async () =>
        Array.from({ length: 10 }, (_, idx) => ({
          title: `Lançamento surpreendente #${idx + 1} na indústria de games`,
          url: `https://example.com/game-launch-${idx + 1}`,
          publishedAt: new Date().toISOString(),
          source: 'GameDaily',
          origin: 'news' as const,
        })),
    });

    const baseConfig: TrendSearchConfig = {
      niche: 'Games',
      country: 'BR',
      language: 'pt-BR',
      period: '7d',
      format: 'auto',
      ideaCount: 5,
      targetDurationMin: 10,
    };

    const first = await engine.searchTrends(baseConfig);
    const expanded = await engine.searchTrends(baseConfig, {
      appendToSessionId: first.sessionId,
    });

    expect(expanded.ideas.length).toBe(10);
    const normalizedTitles = new Set(
      expanded.ideas.map((idea) => idea.title.toLowerCase().trim()),
    );
    expect(normalizedTitles.size).toBe(10);
  });

  it('generates an editable 12-field cinematic briefing, supports refinement, and formats production prompt', async () => {
    const { engine } = createTestEngine({
      searchYouTube: async () => [
        {
          title: 'Análise técnica do novo trailer',
          url: 'https://youtube.com/watch?v=abc123',
          publishedAt: new Date().toISOString(),
          source: 'YouTube',
          origin: 'youtube',
        },
      ],
    });

    const session = await engine.searchTrends({
      niche: 'Cinema e Séries',
      country: 'BR',
      language: 'pt-BR',
      period: '30d',
      format: 'documentary',
      ideaCount: 5,
      targetDurationMin: 12,
    });

    const targetIdea = session.ideas[0];
    const briefing = await engine.generateBriefing(session.sessionId, targetIdea.ideaId);

    expect(briefing.objective.length).toBeGreaterThan(10);
    expect(briefing.targetAudience.length).toBeGreaterThan(5);
    expect(briefing.openingHook.length).toBeGreaterThan(10);
    expect(briefing.narrativeStructure.length).toBeGreaterThan(10);
    expect(briefing.factsAndTopics.length).toBeGreaterThan(5);
    expect(briefing.verifiableReferences.length).toBeGreaterThan(0);
    expect(briefing.sceneProposal.length).toBeGreaterThan(5);
    expect(briefing.editingStyle.length).toBeGreaterThan(5);
    expect(briefing.narrationAndMusic.length).toBeGreaterThan(5);
    expect(briefing.sfxVfxMotion.length).toBeGreaterThan(5);
    expect(briefing.contextualHumor.length).toBeGreaterThan(5);
    expect(briefing.durationAndFormat.length).toBeGreaterThan(5);

    const refined = await engine.refineBriefing(
      session.sessionId,
      targetIdea.ideaId,
      'Focar mais em ritmo ágil',
      { editingStyle: 'Cortes rápidos com J-cuts e L-cuts' },
    );
    expect(refined.editingStyle).toBe('Cortes rápidos com J-cuts e L-cuts');

    const promptText = formatBriefingToProductionPrompt(targetIdea, refined);
    expect(promptText).toContain(targetIdea.title);
    expect(promptText).toContain('Cortes rápidos com J-cuts e L-cuts');
  });

  it('persists sessions to disk and recovers them on a new TrendRadarEngine instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-trend-persist-'));
    tempDirs.push(dir);
    const evolution = new AetheraEvolutionCore(join(dir, 'evolution.json'));

    const engineA = new TrendRadarEngine(dir, evolution, {
      searchNews: async () => [
        {
          title: 'Descoberta arqueológica recente',
          url: 'https://example.com/history',
          publishedAt: new Date().toISOString(),
          source: 'HistoryOrg',
          origin: 'news',
        },
      ],
    });
    const created = await engineA.searchTrends({
      niche: 'História',
      country: 'BR',
      language: 'pt-BR',
      period: '90d',
      format: 'documentary',
      ideaCount: 5,
      targetDurationMin: 15,
    });
    await engineA.generateBriefing(created.sessionId, created.ideas[0].ideaId);

    const engineB = new TrendRadarEngine(dir, evolution, {});
    const recovered = engineB.listSessions();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].sessionId).toBe(created.sessionId);
    expect(recovered[0].ideas).toHaveLength(5);
    expect(recovered[0].briefings[created.ideas[0].ideaId]).toBeDefined();
  });
});
