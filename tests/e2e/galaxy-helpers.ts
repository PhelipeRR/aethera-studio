import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { embeddings, links, memories, memoryTags, openDatabase, projects, tags } from '@neuralbridge/database';

// Test fixture for the Memory Galaxy (lote 50.06): writes memories straight into the real schema of a fresh data
// dir before the app starts, so 5,000 memories take seconds instead of 5,000 IPC round trips. The vectors are a
// fixture too: unit vectors around a few topic centres, the shape real sentence embeddings have. Nothing here ships.

const TOPICS = ['keycloak', 'redis', 'filas', 'react', 'migracoes', 'observabilidade', 'pagamentos', 'testes'] as const;
const TYPES = ['decision', 'code_pattern', 'project_context', 'bug_fix', 'learning', 'preference', 'documentation', 'execution_summary'] as const;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export interface SeededGalaxy {
  ids: string[];
  titles: string[];
  byType: Record<string, number>;
  projectIds: string[];
  createdToday: number;
}

export function seedGalaxy(dataDir: string, options: { count: number; withEmbeddings: boolean; dim?: number }): SeededGalaxy {
  const dim = options.dim ?? 384;
  const random = lcg(42);
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  const db = handle.db;
  const projectIds = ['portal', 'api-pagamentos', 'app-mobile'].map((name) => {
    const id = randomUUID();
    db.insert(projects).values({ id, name, rootPath: `C:\\fixture\\${name}` }).run();
    return id;
  });
  const tagIds = TOPICS.map((topic) => db.insert(tags).values({ name: topic }).returning({ id: tags.id }).get().id);
  const centres = TOPICS.map(() => Array.from({ length: dim }, () => random() - 0.5));
  const now = Date.now();
  const seeded: SeededGalaxy = { ids: [], titles: [], byType: {}, projectIds, createdToday: 0 };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  db.transaction((tx) => {
    for (let i = 0; i < options.count; i++) {
      const topic = i % TOPICS.length;
      const type = TYPES[Math.floor(random() * TYPES.length)] ?? 'decision';
      const id = randomUUID();
      const title = `Fixture ${i} · ${TOPICS[topic]}`;
      // Spread over 120 days; the first few land earlier today so the timeline has real rows to show.
      const created = i < 6 ? new Date(startOfToday.getTime() + (i + 1) * 60 * 60 * 1000) : new Date(now - (1 + random() * 119) * 24 * 60 * 60 * 1000);
      if (i < 6) seeded.createdToday++;
      const iso = created.toISOString();
      tx.insert(memories).values({ id, title, content: `Fixture de teste sobre ${TOPICS[topic]}. Ver [[Fixture ${(i + 8) % options.count} · ${TOPICS[(i + 8) % options.count % TOPICS.length]}]].`, type, projectId: i % 4 === 3 ? null : projectIds[i % 3] ?? null, sourceKind: 'user', embeddingStatus: options.withEmbeddings ? 'ready' : 'pending', createdAt: iso, updatedAt: iso }).run();
      tx.insert(memoryTags).values({ memoryId: id, tagId: tagIds[topic] ?? 1 }).run();
      if (options.withEmbeddings) {
        const centre = centres[topic] ?? [];
        const vector = centre.map((value) => value + (random() - 0.5) * 0.7);
        const norm = Math.hypot(...vector);
        const unit = Float32Array.from(vector.map((value) => value / norm));
        tx.insert(embeddings).values({ memoryId: id, model: 'fixture-model', dim, vector: Buffer.from(unit.buffer), contentHash: 'fixture' }).run();
      }
      seeded.ids.push(id);
      seeded.titles.push(title);
      seeded.byType[type] = (seeded.byType[type] ?? 0) + 1;
    }
    // Explicit links between neighbours of the same topic: a few hundred real rows for the gold lines.
    for (let i = 0; i + 8 < Math.min(options.count, 800); i += 3) {
      tx.insert(links).values({ sourceId: seeded.ids[i] ?? '', targetId: seeded.ids[i + 8] ?? null, targetTitle: seeded.titles[i + 8] ?? '', relation: 'relates', origin: 'explicit' }).run();
    }
  });
  handle.close();
  return seeded;
}
