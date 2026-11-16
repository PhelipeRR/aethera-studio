import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  ConceptDrivenEngine,
  QualityGateService,
  SharpSvgCompositionEngine,
  type AuthenticMediaRequest,
  type AuthenticMediaSource,
  type ExternalImageAdapter,
} from '../src/index.js';

let root: string;
let stillPath: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cs9-authentic-'));
  // Deterministic photographic-like still (gradients + texture) standing in for an acquired screenshot.
  const W = 1024;
  const H = 576;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 3;
      const n = ((x * 7919 + y * 104729) % 97) - 48;
      raw[o] = Math.max(0, Math.min(255, 40 + (x / W) * 160 + n));
      raw[o + 1] = Math.max(0, Math.min(255, 30 + (y / H) * 120 + ((x >> 5) % 2) * 40 + n));
      raw[o + 2] = Math.max(0, Math.min(255, 90 + Math.sin(x / 37) * 60 + Math.cos(y / 23) * 50));
    }
  }
  stillPath = join(root, 'elden-ring-malenia-screenshot.png');
  writeFileSync(stillPath, await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeEngine(source: AuthenticMediaSource | null, adapter: ExternalImageAdapter | null) {
  const ingestion = new AssetIngestionService({ storageRoot: join(root, `storage-${Math.random().toString(36).slice(2, 8)}`) });
  const engine = new SharpSvgCompositionEngine(ingestion);
  return new ConceptDrivenEngine(ingestion, engine, new QualityGateService(engine), {
    imageAdapter: adapter,
    providers: [],
    authenticMediaSource: source,
  });
}

const input = {
  title: 'Elden Ring: Malenia',
  headline: 'I AM MALENIA',
  prompt: 'Malenia, Blade of Miquella, boss fight',
  genre: 'games' as const,
  width: 1280,
  height: 720,
};

describe('CS-9 — Concept engine uses existing authentic sources before synthetic generation', () => {
  it('content_faithful: acquires from the authentic source, keeps its provenance and never calls the image generator', async () => {
    const requests: AuthenticMediaRequest[] = [];
    let generatorCalls = 0;
    const source: AuthenticMediaSource = {
      id: 'test-existing-sources',
      acquire: async (req) => {
        requests.push(req);
        return { imagePath: stillPath, provenance: 'licensed_reference', origin: 'local_library', sourceUrl: `file://${stillPath}`, license: 'user_owned', title: 'elden-ring-malenia-screenshot.png' };
      },
    };
    const adapter: ExternalImageAdapter = {
      id: 'should-not-run',
      isAvailable: async () => true,
      generateImage: async () => {
        generatorCalls += 1;
        throw new Error('synthetic generation must not run when authentic media exists');
      },
    } as unknown as ExternalImageAdapter;

    const engine = makeEngine(source, adapter);
    const { concepts } = await engine.ideateConcepts({ ...input, fidelityMode: 'content_faithful' });
    const [concept] = concepts;
    if (!concept) throw new Error('no concept ideated');
    const acquired = await engine.acquireConceptMedia(concept, { ...input, fidelityMode: 'content_faithful' });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]?.query).toContain('Elden Ring');
    expect(requests[0]?.query).toContain('Malenia');
    expect(generatorCalls).toBe(0);
    for (const item of acquired) {
      expect(item.provenance).toBe('licensed_reference');
      expect(item.source).toMatchObject({ origin: 'local_library', license: 'user_owned' });
    }
  });

  it('authentic_gameplay: blocks explicitly when no authentic source returns media (no synthetic substitute)', async () => {
    const source: AuthenticMediaSource = { id: 'empty', acquire: async () => null };
    const engine = makeEngine(source, null);
    const { concepts } = await engine.ideateConcepts({ ...input, fidelityMode: 'authentic_gameplay' });
    const [concept] = concepts;
    if (!concept) throw new Error('no concept ideated');
    await expect(engine.acquireConceptMedia(concept, { ...input, fidelityMode: 'authentic_gameplay' })).rejects.toThrow(
      /Gameplay Autêntico exige mídia real/,
    );
  });
});
