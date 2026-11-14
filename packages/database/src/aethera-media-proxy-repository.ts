import { and, desc, eq } from 'drizzle-orm';
import { aetheraMediaProxySchema, aetheraMediaProxyId, type AetheraMediaProxy } from '@neuralbridge/shared';
import type { Db } from './open.js';
import { aetheraMediaProxies } from './schema.js';

/** Persists proxy metadata only; it never changes local-asset rights or the Rights Manager. */
export class AetheraMediaProxyRepository {
  constructor(private readonly db: Db) {}

  save(input: AetheraMediaProxy): AetheraMediaProxy {
    const proxy = aetheraMediaProxySchema.parse(input);
    this.db.insert(aetheraMediaProxies).values({ id: aetheraMediaProxyId(proxy.assetId, proxy.originalHash), assetId: proxy.assetId, originalHash: proxy.originalHash, relativePath: proxy.relativePath, width: proxy.width, height: proxy.height, fps: proxy.fps, codec: proxy.codec, createdAt: proxy.createdAt }).onConflictDoUpdate({ target: [aetheraMediaProxies.assetId, aetheraMediaProxies.originalHash], set: { relativePath: proxy.relativePath, width: proxy.width, height: proxy.height, fps: proxy.fps, codec: proxy.codec, createdAt: proxy.createdAt } }).run();
    return proxy;
  }

  get(assetId: string, originalHash: string): AetheraMediaProxy | null {
    const row = this.db.select().from(aetheraMediaProxies).where(and(eq(aetheraMediaProxies.assetId, assetId), eq(aetheraMediaProxies.originalHash, originalHash))).orderBy(desc(aetheraMediaProxies.createdAt)).get();
    return row ? this.parse(row) : null;
  }

  list(assetId: string): AetheraMediaProxy[] {
    return this.db.select().from(aetheraMediaProxies).where(eq(aetheraMediaProxies.assetId, assetId)).orderBy(desc(aetheraMediaProxies.createdAt)).all().map((row) => this.parse(row));
  }

  private parse(row: typeof aetheraMediaProxies.$inferSelect): AetheraMediaProxy {
    return aetheraMediaProxySchema.parse({ schemaVersion: 1, assetId: row.assetId, originalHash: row.originalHash, relativePath: row.relativePath, width: row.width, height: row.height, fps: row.fps, codec: row.codec, createdAt: row.createdAt });
  }
}
