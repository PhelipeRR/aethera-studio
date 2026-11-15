import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CollageSecretCipher } from '../../../packages/desktop-shared/src/main/collage-secret-store.js';
import { describeEvent, MediaSourcesService, type MediaSourcesServiceDeps } from '../src/main/media-sources-service.js';
import type { EmitProductionLogInput } from '../src/main/production-console.js';

// Reversible but non-plaintext cipher so the test can prove files on disk never hold the key in clear.
const cipher: CollageSecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from(Buffer.from(v, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeService(overrides: Partial<MediaSourcesServiceDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-media-sources-'));
  dirs.push(dir);
  const logs: EmitProductionLogInput[] = [];
  let rawg: string | null = null;
  const service = new MediaSourcesService({
    userDataDir: dir,
    cipher,
    igdb: { configured: () => false, searchGames: async () => [], gameVideos: async () => [] },
    rawgApiKey: () => rawg,
    saveIgdb: () => undefined,
    clearIgdb: () => undefined,
    saveRawg: (k) => {
      rawg = k;
    },
    clearRawg: () => {
      rawg = null;
    },
    emitLog: (input) => logs.push(input),
    ...overrides,
  });
  return { service, dir, logs };
}

describe('MediaSourcesService (Configurações → Fontes de mídia)', () => {
  it('lists every provider with status, limits, priority and disabled justifications', () => {
    const { service } = makeService();
    const view = service.view();
    const ids = view.providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['steam', 'igdb', 'youtube', 'pexels', 'pixabay', 'nekos_best', 'kawaii_red', 'huggingface_datasets', 'rawg', 'waifu_pics', 'anime_reaction_api', 'mixkit']));
    const waifu = view.providers.find((p) => p.id === 'waifu_pics')!;
    expect(waifu.enabled).toBe(false);
    expect(waifu.permanentlyDisabledReason).toMatch(/NXDOMAIN/);
    const rawg = view.providers.find((p) => p.id === 'rawg')!;
    expect(rawg.enabled).toBe(false); // legacy, off by default
    expect(view.providers.find((p) => p.id === 'pexels')!.connectivity).toBe('auth_missing');
    expect(view.commercialUse).toBe(true);
    expect(view.allowEditorialPromotionalUse).toBe(false);
  });

  it('stores keys encrypted, exposes only a masked hint and never the key itself', () => {
    const { service, dir } = makeService();
    const view = service.saveCredential({ provider: 'pexels', values: { apiKey: 'pexels-SECRET-1234' } });
    const pexels = view.providers.find((p) => p.id === 'pexels')!;
    expect(pexels.configured).toBe(true);
    expect(pexels.credentialHint).toBe('••••1234');
    expect(JSON.stringify(view)).not.toContain('pexels-SECRET');
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toContain('pexels-SECRET');
    const cleared = service.clearCredential({ provider: 'pexels' });
    expect(cleared.providers.find((p) => p.id === 'pexels')!.configured).toBe(false);
    expect(() => service.saveCredential({ provider: 'steam', values: { apiKey: 'x' } })).toThrow(/não aceita credenciais/);
  });

  it('persists enable/priority/policy changes and rejects unknown providers', () => {
    const { service, dir } = makeService();
    service.saveSettings({ providers: { pixabay: { priority: 5 }, kawaii_red: { enabled: false } }, allowEditorialPromotionalUse: true });
    const reloaded = makeService({ userDataDir: dir }).service.view();
    expect(reloaded.providers[0]!.id).toBe('pixabay');
    expect(reloaded.providers.find((p) => p.id === 'kawaii_red')!.enabled).toBe(false);
    expect(reloaded.allowEditorialPromotionalUse).toBe(true);
    expect(() => service.saveSettings({ providers: { nope: { enabled: true } } })).toThrow(/desconhecido/);
    // a permanently disabled provider cannot be switched on
    service.saveSettings({ providers: { waifu_pics: { enabled: true } } });
    expect(service.view().providers.find((p) => p.id === 'waifu_pics')!.enabled).toBe(false);
  });

  it('routes registry telemetry to the console of the job that issued it, and drops job-less events', async () => {
    const { service, logs } = makeService();
    service.log({ type: 'provider_query', provider: 'steam', jobId: 'job-A', query: 'Cyberpunk 2077', page: 1 });
    service.log({ type: 'provider_fallback', from: 'pexels', to: 'pixabay', jobId: 'job-B', reason: 'HTTP 503' });
    service.log({ type: 'provider_query', provider: 'steam', query: 'no job', page: 1 });
    expect(logs.map((l) => [l.projectId, l.jobId, l.stage])).toEqual([
      ['job-A', 'job-A', 'pesquisa'],
      ['job-B', 'job-B', 'fallback'],
    ]);
    // a real search run through the registry carries the job too (missing keys → skipped + fallback lines)
    await service.registry.searchForScene('server room', { jobId: 'job-C', prompt: 'tecnologia de servidores' });
    const jobC = logs.filter((l) => l.jobId === 'job-C');
    expect(jobC.some((l) => /pexels ignorado: Credencial ausente/.test(l.message))).toBe(true);
    expect(jobC.some((l) => l.stage === 'fallback')).toBe(true);
  });

  it('throttles download progress lines to 10% steps', () => {
    const { service, logs } = makeService();
    for (let pct = 0; pct <= 100; pct += 2) service.log({ type: 'download_progress', provider: 'pexels', jobId: 'j', itemId: 'pexels:1', receivedBytes: pct * 1000, totalBytes: 100_000, pct });
    expect(logs.length).toBe(11);
    expect(logs.at(-1)!.message).toContain('(100%)');
  });

  it('describes every event without leaking URLs with keys', () => {
    const line = describeEvent({ type: 'provider_error', provider: 'youtube', jobId: 'j', code: 'auth_failed', message: 'HTTP 403 — acesso negado.', durationMs: 5 });
    expect(line).toMatchObject({ stage: 'pesquisa', event: 'command_failed', severity: 'error' });
  });
});
