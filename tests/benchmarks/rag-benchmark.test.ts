import { performance } from 'node:perf_hooks';
import { copyFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '@neuralbridge/database';
import { RagEngine, buildRagContext } from '@neuralbridge/brain';
import { FakeProvider } from '../../packages/brain/test/fake-provider.js';

const migrations = fileURLToPath(new URL('../../packages/database/migrations', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/rag-benchmark', import.meta.url));
const queries = [{ query: 'postgres schema migration', relevant: ['docs/database.md'] }, { query: 'OAuth login credentials', relevant: ['docs/authentication.md'] }, { query: 'React interface layout', relevant: ['docs/ui.ts'] }];

function metrics(rows: { path: string }[], relevant: string[], k = 3) {
  const top = rows.slice(0, k); const found = top.filter((row) => relevant.includes(row.path)).length;
  const first = top.findIndex((row) => relevant.includes(row.path));
  return { recall: found / relevant.length, precision: found / k, reciprocalRank: first < 0 ? 0 : 1 / (first + 1) };
}

describe('RAG reproducible benchmark', () => {
  it('measures FTS, semantic and hybrid retrieval without inventing unavailable results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-rag-benchmark-')); await mkdir(join(root, 'docs'));
    for (const file of ['database.md', 'authentication.md', 'ui.ts']) await copyFile(join(fixture, file), join(root, 'docs', file));
    const db = openDatabase(join(root, 'brain.db'), { migrationsFolder: migrations });
    db.sqlite.prepare("INSERT INTO projects (id, name, root_path) VALUES ('p', 'benchmark', ?)").run(root);
    const engine = new RagEngine(db); const started = performance.now(); const indexed = await engine.indexProject('p', root); const indexMs = performance.now() - started;
    const provider = new FakeProvider(); await engine.indexEmbeddings(provider, 'p');
    const fts: ReturnType<typeof metrics>[] = []; const semantic: ReturnType<typeof metrics>[] = []; const hybrid: ReturnType<typeof metrics>[] = []; const latencies: number[] = []; let contextTokens = 0;
    for (const item of queries) {
      const t = performance.now(); const text = engine.search('p', item.query, 3); const meaning = await engine.semanticSearch(provider, 'p', item.query, 3); const combined = [...text, ...meaning.filter((hit) => !text.some((row) => row.id === hit.id))]; contextTokens += buildRagContext(combined, 128).estimatedTokens; latencies.push(performance.now() - t);
      fts.push(metrics(text, item.relevant)); semantic.push(metrics(meaning, item.relevant)); hybrid.push(metrics(combined, item.relevant));
    }
    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...latencies].sort((a, b) => a - b);
    const result = { environment: { node: process.version, platform: process.platform }, dataset: queries.length, indexed, indexMs, fts: { recall: avg(fts.map((x) => x.recall)), precision: avg(fts.map((x) => x.precision)), mrr: avg(fts.map((x) => x.reciprocalRank)) }, semantic: { recall: avg(semantic.map((x) => x.recall)), precision: avg(semantic.map((x) => x.precision)), mrr: avg(semantic.map((x) => x.reciprocalRank)) }, hybrid: { recall: avg(hybrid.map((x) => x.recall)), precision: avg(hybrid.map((x) => x.precision)), mrr: avg(hybrid.map((x) => x.reciprocalRank)) }, latencyMs: { p50: sorted[1] ?? sorted[0] ?? 0, p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0 }, estimatedContextTokens: contextTokens };
    await mkdir(fileURLToPath(new URL('.', import.meta.url)), { recursive: true }); await writeFile(fileURLToPath(new URL('./latest-results.json', import.meta.url)), JSON.stringify(result, null, 2) + '\n');
    expect(indexed.indexed).toBeGreaterThan(0); expect(result.hybrid.recall).toBeGreaterThanOrEqual(0); expect(result.latencyMs.p95).toBeGreaterThanOrEqual(result.latencyMs.p50);
    db.sqlite.close();
  });
});
