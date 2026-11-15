/**
 * Real connectivity, search and acquisition check for the Aethera media providers.
 *
 *   npx tsx scripts/media-providers-live-check.mts
 *
 * Keyless providers (Steam, nekos.best, kawaii.red, Hugging Face) always run. Keyed providers run only when their
 * environment variable is set: PEXELS_API_KEY, PIXABAY_API_KEY, YOUTUBE_API_KEY, IGDB_CLIENT_ID + IGDB_CLIENT_SECRET.
 * Keys are never printed. Evidence (no secrets) is written to artifacts/media-providers-live/.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  createDefaultMediaProviderAdapters,
  MediaProviderRegistry,
  type MediaProviderKey,
  type ProviderTelemetryEvent,
} from '../packages/cinema/src/index.js';
import { IgdbClient } from '../packages/orchestrator/src/aethera/game-sources.js';

const run = promisify(execFile);
const outDir = join(process.cwd(), 'artifacts', 'media-providers-live');
const mediaDir = join(outDir, 'media');
mkdirSync(mediaDir, { recursive: true });

const env = (k: string) => process.env[k]?.trim() || null;
const igdbCreds = env('IGDB_CLIENT_ID') && env('IGDB_CLIENT_SECRET') ? { clientId: env('IGDB_CLIENT_ID')!, clientSecret: env('IGDB_CLIENT_SECRET')! } : null;
const igdbClient = new IgdbClient({ credentials: () => igdbCreds });
const ffmpeg = existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg';

const events: Array<ProviderTelemetryEvent & { at: string }> = [];
const registry = new MediaProviderRegistry({
  adapters: createDefaultMediaProviderAdapters({
    igdb: { configured: () => igdbCreds !== null, searchGames: (t, s) => igdbClient.searchGames(t, s), gameVideos: (id, s) => igdbClient.gameVideos(id, s) },
    youtubeApiKey: () => env('YOUTUBE_API_KEY'),
    pexelsApiKey: () => env('PEXELS_API_KEY'),
    pixabayApiKey: () => env('PIXABAY_API_KEY'),
  }),
  onEvent: (e) => {
    if (e.type !== 'download_progress') events.push({ ...e, at: new Date().toISOString() });
  },
  // HLS trailers (Steam): capture a short real clip with ffmpeg.
  externalAcquire: async (item, destDir, options) => {
    if (!item.acquisition.url) return null;
    const out = join(destDir, `${options.fileStem ?? item.providerItemId}.mp4`);
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', item.acquisition.url, '-t', '12', '-c', 'copy', out], { timeout: 120_000, ...(options.signal ? { signal: options.signal } : {}) });
    return existsSync(out) ? out : null;
  },
});

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), health: {}, searches: {}, acquisitions: [] as unknown[], scenes: {} };

for (const p of registry.status()) {
  (report.health as Record<string, unknown>)[p.id] = await registry.healthCheck(p.id);
}

async function searchOne(id: MediaProviderKey, query: string, kinds?: Array<'video' | 'image' | 'gif' | 'dataset'>) {
  try {
    const page = await registry.search(id, { query, perPage: 5, ...(kinds ? { kinds } : {}), context: { jobId: 'live-check' } });
    (report.searches as Record<string, unknown>)[id] = {
      query,
      count: page.items.length,
      hasMore: page.hasMore,
      sample: page.items.slice(0, 3).map((i) => ({ id: i.id, kind: i.kind, title: i.title, classification: i.classification, license: i.license.licenseId, acquisition: i.acquisition.method, pageUrl: i.pageUrl })),
    };
    return page.items;
  } catch (error) {
    (report.searches as Record<string, unknown>)[id] = { query, error: (error as Error).message };
    return [];
  }
}

const steamItems = [...(await searchOne('steam', 'Cyberpunk 2077', ['video'])), ...(await registry.search('steam', { query: 'Cyberpunk 2077', kinds: ['image'], perPage: 5 })).items];
await searchOne('nekos_best', 'hug', ['gif']);
await searchOne('kawaii_red', 'hug');
await searchOne('huggingface_datasets', 'gameplay');
if (env('PEXELS_API_KEY')) await searchOne('pexels', 'data center');
if (env('PIXABAY_API_KEY')) await searchOne('pixabay', 'computer');
if (env('YOUTUBE_API_KEY')) await searchOne('youtube', 'Cyberpunk 2077 official trailer');
if (igdbCreds) await searchOne('igdb', 'Cyberpunk 2077');

// Real acquisitions: one Steam screenshot (direct HTTP, streamed with progress) and one Steam trailer (HLS → ffmpeg).
for (const item of [steamItems.find((i) => i.classification === 'official_screenshot'), steamItems.find((i) => i.kind === 'video')]) {
  if (!item) continue;
  try {
    const res = await registry.acquire(item, mediaDir, { jobId: 'live-check', fileStem: item.providerItemId });
    (report.acquisitions as unknown[]).push({ id: item.id, method: item.acquisition.method, file: res.filePath, bytes: statSync(res.filePath).size, durationMs: res.durationMs });
  } catch (error) {
    (report.acquisitions as unknown[]).push({ id: item.id, method: item.acquisition.method, error: (error as Error).message });
  }
}

// Scene-aware selection with fallback (keyed providers missing in this environment are skipped and logged).
const scenes = {
  cyberpunk: { query: 'Cyberpunk 2077 Night City', ctx: { jobId: 'live-check', sceneId: 'cyberpunk', prompt: 'Análise de Cyberpunk 2077', entities: ['Cyberpunk 2077'] } },
  top10_2027: { query: 'Cyberpunk 2077', ctx: { jobId: 'live-check', sceneId: 'top10', prompt: 'TOP 10 jogos de 2027', genre: 'top_list' } },
  tecnologia: { query: 'data center servers', ctx: { jobId: 'live-check', sceneId: 'tech', prompt: 'Como a tecnologia mudou a internet', narrationText: 'servidores em um data center' } },
  anime_reacao: { query: 'hug', ctx: { jobId: 'live-check', sceneId: 'anime-reaction', prompt: 'anime', genre: 'anime', narrationText: 'aquela reação de abraço' } },
};
for (const [name, s] of Object.entries(scenes)) {
  const res = await registry.searchForScene(s.query, s.ctx);
  (report.scenes as Record<string, unknown>)[name] = {
    intent: res.plan.intent,
    providers: res.plan.providers,
    attempts: res.attempts,
    accepted: res.accepted.slice(0, 4).map((a) => ({ id: a.item.id, classification: a.item.classification, license: a.license.status, score: a.score })),
    rejected: res.rejected.slice(0, 4).map((r) => ({ id: r.item.id, stage: r.stage, code: r.code, reason: r.reason })),
  };
}

report.finishedAt = new Date().toISOString();
report.status = registry.status().map((s) => ({ id: s.id, enabled: s.enabled, configured: s.configured, connectivity: s.connectivity, lastError: s.lastError }));
report.events = events;
writeFileSync(join(outDir, 'live-check-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ health: report.health, searches: Object.fromEntries(Object.entries(report.searches as Record<string, { count?: number; error?: string }>).map(([k, v]) => [k, v.count ?? v.error])), acquisitions: report.acquisitions, scenes: Object.fromEntries(Object.entries(report.scenes as Record<string, { intent: string; attempts: unknown[]; accepted: unknown[] }>).map(([k, v]) => [k, { intent: v.intent, attempts: v.attempts, accepted: v.accepted.length }])) }, null, 1));
