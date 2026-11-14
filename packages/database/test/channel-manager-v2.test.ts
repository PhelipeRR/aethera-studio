import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canChannelAutoPublish,
  evaluateChannelCompleteness,
  normalizeChannelConfig,
  renderChannelDescriptionPreview,
  renderChannelTitlePreview,
} from '@neuralbridge/shared';
import { ContentOperatingSystemRepository, openDatabase } from '../src/index.js';

describe('Channel Manager 2.0 — Isolation, Migration, Permissions & Persistence', () => {
  it('migrates legacy channels with { brief } cleanly without data loss', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ch2-')), 'db.sqlite'), {
      migrationsFolder: resolve(import.meta.dirname, '../migrations'),
    });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const legacy = repository.createChannel({
      id: 'legacy-1',
      workspaceId: 'default',
      name: 'Canal Legado',
      niche: 'Games',
      audience: 'Gamers BR',
      tone: 'Analítico',
      autonomy: 'assisted',
      editorialStrategy: { brief: 'Vídeos semanais de RPGs.' },
    });

    const normalized = normalizeChannelConfig(legacy);
    expect(normalized.editorialStrategy.brief).toBe('Vídeos semanais de RPGs.');
    expect(normalized.editorialStrategy.narrativeTone).toBe('Analítico');
    expect(normalized.identity.brandKit.primaryColor).toBe('#8b5cf6');
    expect(normalized.editorialStrategy.production.requireHumanApprovalForExternalPublish).toBe(true);
    handle.close();
  });

  it('persists updates and maintains strict isolation between multiple channels', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ch2-iso-')), 'db.sqlite'), {
      migrationsFolder: resolve(import.meta.dirname, '../migrations'),
    });
    const repository = new ContentOperatingSystemRepository(handle.db);

    repository.createChannel({
      id: 'ch-games',
      workspaceId: 'default',
      name: 'Aethera Games',
      niche: 'RPGs',
      audience: 'Hardcore',
      tone: 'Cinematográfico',
      autonomy: 'assisted',
      budgetUsd: 10,
      concurrencyLimit: 2,
      identity: { handle: '@aetheragames', brandKit: { primaryColor: '#112233' } },
    });

    repository.createChannel({
      id: 'ch-news',
      workspaceId: 'default',
      name: 'Aethera News',
      niche: 'Notícias Tech',
      audience: 'Geral',
      tone: 'Direto',
      autonomy: 'manual',
      budgetUsd: 3,
      concurrencyLimit: 1,
      identity: { handle: '@aetheranews', brandKit: { primaryColor: '#ff0055' } },
    });

    const updatedGames = repository.updateChannel({
      id: 'ch-games',
      name: 'Aethera Games BR',
      identity: { handle: '@aetheragamesbr', brandKit: { primaryColor: '#445566' } },
    });

    expect(updatedGames.name).toBe('Aethera Games BR');
    const news = repository.channel('ch-news');
    expect(news?.name).toBe('Aethera News');
    expect((news?.identity as { handle?: string }).handle).toBe('@aetheranews');
    expect(((news?.identity as { brandKit?: { primaryColor?: string } }).brandKit)?.primaryColor).toBe('#ff0055');

    expect(repository.deleteChannel('ch-news')).toEqual({ deleted: true });
    expect(repository.listChannels().map((c) => c.id)).toEqual(['ch-games']);
    handle.close();
  });

  it('enforces human approval for external publishing unless explicitly authorized', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ch2-perm-')), 'db.sqlite'), {
      migrationsFolder: resolve(import.meta.dirname, '../migrations'),
    });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const ch = repository.createChannel({
      id: 'ch-perm',
      workspaceId: 'default',
      name: 'Canal Seguro',
      niche: 'Games',
      audience: 'BR',
      tone: 'Sério',
      autonomy: 'autonomous',
    });

    expect(canChannelAutoPublish(ch, false)).toBe(false);
    expect(canChannelAutoPublish(ch, true)).toBe(false);

    const authorized = repository.updateChannel({
      id: 'ch-perm',
      editorialStrategy: {
        production: {
          requireHumanApprovalForExternalPublish: false,
          explicitExternalAutoPublishAuthorized: true,
        },
      },
    });
    expect(canChannelAutoPublish(authorized, false)).toBe(false);
    expect(canChannelAutoPublish(authorized, true)).toBe(true);
    handle.close();
  });

  it('evaluates completeness and renders publication title/description previews', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-ch2-prev-')), 'db.sqlite'), {
      migrationsFolder: resolve(import.meta.dirname, '../migrations'),
    });
    const repository = new ContentOperatingSystemRepository(handle.db);
    const incomplete = repository.createChannel({
      id: 'ch-inc',
      workspaceId: 'default',
      name: 'Rascunho',
      autonomy: 'manual',
    });

    const report = evaluateChannelCompleteness(incomplete);
    expect(report.readyForProduction).toBe(false);
    expect(report.missingRequired).toContain('Nicho');

    expect(renderChannelTitlePreview('{title} | {channel}', 'Elden Ring', 'Aethera')).toBe('Elden Ring | Aethera');
    expect(
      renderChannelDescriptionPreview('{summary}\n{hashtags}', 'Análise completa.', 'Aethera', ['games', '#rpg'], 'Por {channel}'),
    ).toBe('Análise completa.\n#games #rpg\n\nPor Aethera');
    handle.close();
  });
});
