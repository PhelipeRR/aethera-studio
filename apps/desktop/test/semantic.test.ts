import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrainService, projectScope, readSemanticSettings } from '@neuralbridge/brain';
import { openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSemanticService, type ModelProvider } from '../src/main/semantic.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');

/** Both fakes share one "disk", like real providers pointing at the same models folder. */
const disk = { downloaded: false };

class FakeModel implements ModelProvider {
  readonly model = 'fake';
  readonly dim = 2;
  prepared = 0;
  constructor(private readonly allowDownload: boolean) {}
  get downloaded() {
    return disk.downloaded;
  }
  isDownloaded() {
    return disk.downloaded;
  }
  async prepare() {
    if (!this.allowDownload && !disk.downloaded) throw new Error('not downloaded');
    if (this.allowDownload) this.prepared++;
    disk.downloaded = true;
  }
  async unload() {}
  async availability() {
    return this.downloaded ? ({ ok: true } as const) : ({ ok: false, reason: 'model_missing' } as const);
  }
  async embedPassages(texts: string[]) {
    return texts.map(() => Float32Array.from([1, 0]));
  }
  async embedQuery() {
    return Float32Array.from([1, 0]);
  }
}

let handle: DatabaseHandle;
let models: { download: FakeModel; local: FakeModel };

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-semantic-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'api', rootPath: 'C:\\src\\api' }).run();
  new BrainService(handle).store({ title: 'Banco', content: 'postgres', type: 'decision' }, projectScope('api'), { kind: 'user', client: 'test' });
  disk.downloaded = false;
  models = { download: new FakeModel(true), local: new FakeModel(false) };
});

afterEach(() => handle.close());

function service() {
  return createSemanticService({
    handle,
    modelsDir: 'C:\\data\\models',
    createProvider: ({ allowDownload }) => (allowDownload ? models.download : models.local),
    intervalMs: 0,
  });
}

describe('semantic search service', () => {
  it('starts disabled, with nothing downloaded and the memory waiting for a vector', async () => {
    expect(await service().status()).toMatchObject({ enabled: false, downloaded: false, indexed: 0, pending: 1, failed: 0, modelsDir: 'C:\\data\\models' });
  });

  it('downloads the model only when enabled, then indexes existing memories', async () => {
    const semantic = service();
    const status = await semantic.enable();
    expect(models.download.prepared).toBe(1);
    expect(status).toMatchObject({ enabled: true, downloaded: true });
    expect(readSemanticSettings(handle)).toMatchObject({ enabled: true, consentedAt: expect.any(String) });
    await semantic.idle();
    expect(await semantic.status()).toMatchObject({ indexed: 1, pending: 0 });
  });

  it('does not download again when the model is already on disk, and can be switched off', async () => {
    disk.downloaded = true;
    const semantic = service();
    await semantic.enable();
    expect(models.download.prepared).toBe(0);
    expect(await semantic.disable()).toMatchObject({ enabled: false, downloaded: true });
  });

  it('refuses to enable without a database', async () => {
    const semantic = createSemanticService({ handle: null, modelsDir: 'x', createProvider: () => models.local, intervalMs: 0 });
    await expect(semantic.enable()).rejects.toThrow(/database/);
    expect(await semantic.status()).toMatchObject({ enabled: false, indexed: 0, pending: 0 });
  });
});
