import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  BrainError,
  BrainService,
  GLOBAL_SCOPE,
  HybridSearch,
  projectScope,
  USER_SCOPE,
  type Actor,
  type EmbeddingProvider,
  type Scope,
} from '@neuralbridge/brain';
import { accessLog, embeddings, links, memories, memoryTags, projects, tags, type DatabaseHandle } from '@neuralbridge/database';
import { fromBlob } from '@neuralbridge/brain';
import type { Brain3DGraph, BrainActivityEntry, BrainSimilarity, Confidence, EvidenceCheck, GalaxySnapshot } from '@neuralbridge/shared';
import { checkEvidence } from './evidence.js';
import { GRAPH_LIMIT, type BrainGraph, type BrainOverview, type BrainSearchInput, type ListFilter, type MemoryType, type ProjectRef, type StoreInput, type TagCount } from '@neuralbridge/shared';

export const SNIPPET_MARKERS = ['\u0002', '\u0003'] as const;

/** Same cut-off the hybrid search uses for meaning matches (calibrated in Phase 6). */
const SIMILARITY_THRESHOLD = 0.75;
const SIMILARITY_TOP_K = 3;
/** Pairwise comparison is quadratic: the 1,500 most recent memories take well under a second. */
const SIMILARITY_LIMIT = 1_500;
const ACTIVITY_LIMIT = 200;

/** Everything the user does in the app is done as the user, who sees all projects including private ones. */
const USER: Actor = { kind: 'user', client: 'electron' };

/** Keeps the domain error code at the start of the message: IPC only carries the message across. */
function rethrow(error: unknown): never {
  if (error instanceof BrainError) throw new Error(`${error.code}: ${error.message}`);
  throw error;
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    rethrow(error);
  }
}

export interface BrainServiceOptions {
  handle: DatabaseHandle | null;
  /** Semantic search provider (gated by the user's setting); null = keyword search only. */
  provider: EmbeddingProvider | null;
  /** Called after any write, e.g. to schedule embedding. */
  onChange?: () => void;
  clock?: () => Date;
}

/** The Neural Brain as the app's main process exposes it to the UI. */
export function createBrainService(options: BrainServiceOptions) {
  const { handle } = options;
  const brain = handle ? new BrainService(handle, options.clock ? { clock: options.clock } : {}) : null;
  // Control characters as highlight markers: memory text may itself contain [ ] (e.g. [[links]]).
  const search = brain ? new HybridSearch(brain, options.provider, { snippetMarkers: SNIPPET_MARKERS }) : null;

  function need(): { handle: DatabaseHandle; brain: BrainService; search: HybridSearch } {
    if (!handle || !brain || !search) throw new Error('unavailable: O banco de dados está indisponível.');
    return { handle, brain, search };
  }

  const live = isNull(memories.deletedAt);

  return {
    overview(): BrainOverview {
      const { handle, brain } = need();
      const db = handle.db;
      const total = db.select({ n: sql<number>`count(*)` }).from(memories).where(live).get()?.n ?? 0;
      const byType = db
        .select({ type: memories.type, count: sql<number>`count(*)` })
        .from(memories)
        .where(live)
        .groupBy(memories.type)
        .orderBy(asc(memories.type))
        .all() as { type: MemoryType; count: number }[];
      const byProject = db
        .select({ projectId: memories.projectId, name: projects.name, count: sql<number>`count(*)` })
        .from(memories)
        .leftJoin(projects, eq(projects.id, memories.projectId))
        .where(live)
        .groupBy(memories.projectId, projects.name)
        .orderBy(desc(sql`count(*)`), sql`${memories.projectId} IS NULL`, asc(projects.name))
        .all();
      const linkCount = (resolved: boolean) =>
        db
          .select({ n: sql<number>`count(*)` })
          .from(links)
          .innerJoin(memories, eq(memories.id, links.sourceId))
          .where(and(live, resolved ? isNotNull(links.targetId) : isNull(links.targetId)))
          .get()?.n ?? 0;
      const states = db
        .select({ status: memories.embeddingStatus, n: sql<number>`count(*)` })
        .from(memories)
        .where(live)
        .groupBy(memories.embeddingStatus)
        .all();
      const state = (status: string) => states.find((row) => row.status === status)?.n ?? 0;
      return {
        total,
        byType,
        byProject,
        links: { resolved: linkCount(true), pending: linkCount(false) },
        embeddings: { indexed: state('ready'), pending: state('pending'), failed: state('failed') },
        recent: brain.list({ limit: 5 }, USER_SCOPE).items,
      };
    },

    async search(input: BrainSearchInput) {
      const { search } = need();
      const scope: Scope =
        input.projectId === undefined ? USER_SCOPE : input.projectId === null ? GLOBAL_SCOPE : projectScope(input.projectId, false);
      try {
        return await search.search(
          input.query,
          { ...(input.type ? { type: input.type } : {}), ...(input.tags ? { tags: input.tags } : {}), ...(input.limit ? { limit: input.limit } : {}) },
          scope,
          USER,
        );
      } catch (error) {
        rethrow(error);
      }
    },

    list(filter: ListFilter) {
      return guard(() => need().brain.list(filter, USER_SCOPE));
    },

    get(id: string) {
      return guard(() => need().brain.recall(id, USER_SCOPE, USER));
    },

    versions(id: string) {
      return guard(() => need().brain.versions(id, USER_SCOPE));
    },

    store(input: StoreInput) {
      const result = guard(() => need().brain.store(input, USER_SCOPE, USER));
      options.onChange?.();
      return result;
    },

    remove(id: string, hard: boolean): { deleted: true } {
      guard(() => need().brain.delete(id, USER_SCOPE, USER, { hard }));
      options.onChange?.();
      return { deleted: true };
    },

    /** The user's own judgement of a memory: reviewed, stale, or back to unverified. */
    setConfidence(id: string, confidence: Confidence): { confidence: Confidence } {
      const result = need().brain.setConfidence(id, confidence);
      options.onChange?.();
      return result;
    },

    /**
     * Checks the memory's file evidence in its project folder. A missing or changed file makes it stale;
     * evidence that still holds never raises the confidence, which only the user does.
     */
    revalidate(id: string): { confidence: Confidence; findings: EvidenceCheck[] } {
      const { handle, brain } = need();
      const memory = brain.recall(id, USER_SCOPE, USER);
      if (!memory) throw new BrainError('not_found', 'Memória não encontrada.');
      const root = memory.projectId ? (handle.db.select({ rootPath: projects.rootPath }).from(projects).where(eq(projects.id, memory.projectId)).get()?.rootPath ?? null) : null;
      const findings = checkEvidence(memory.evidence, root, memory.updatedAt);
      if (memory.confidence !== 'stale' && findings.some((finding) => finding.status === 'missing' || finding.status === 'changed')) {
        brain.setConfidence(id, 'stale');
        options.onChange?.();
        return { confidence: 'stale', findings };
      }
      return { confidence: memory.confidence, findings };
    },

    /** Snapshot for the graph view: most recently updated memories first, up to GRAPH_LIMIT. */
    graph(): BrainGraph {
      const db = need().handle.db;
      const rows = db
        .select({ id: memories.id, title: memories.title, type: memories.type, projectId: memories.projectId })
        .from(memories)
        .where(live)
        .orderBy(desc(memories.updatedAt))
        .limit(GRAPH_LIMIT + 1)
        .all();
      const shown = rows.slice(0, GRAPH_LIMIT);
      const ids = new Set(shown.map((row) => row.id));
      const tagsById = new Map<string, string[]>();
      for (const row of db
        .select({ memoryId: memoryTags.memoryId, name: tags.name })
        .from(memoryTags)
        .innerJoin(tags, eq(tags.id, memoryTags.tagId))
        .innerJoin(memories, eq(memories.id, memoryTags.memoryId))
        .where(live)
        .orderBy(asc(tags.name))
        .all()) {
        if (ids.has(row.memoryId)) tagsById.set(row.memoryId, [...(tagsById.get(row.memoryId) ?? []), row.name]);
      }
      const graphLinks = db
        .select({ sourceId: links.sourceId, targetId: links.targetId, targetTitle: links.targetTitle, relation: links.relation })
        .from(links)
        .innerJoin(memories, eq(memories.id, links.sourceId))
        .where(live)
        .all()
        // Links to memories outside the snapshot are dropped rather than shown as pending, which they are not.
        .filter((link) => ids.has(link.sourceId) && (link.targetId === null || ids.has(link.targetId)));
      return {
        memories: shown.map((row) => ({ ...row, tags: tagsById.get(row.id) ?? [] })),
        links: graphLinks,
        truncated: rows.length > GRAPH_LIMIT,
      };
    },

    /** Snapshot for the 3D brain: memory facts the scene shows (no content) and links between them. */
    graph3d(): Brain3DGraph {
      const db = need().handle.db;
      const rows = db
        .select({
          id: memories.id,
          title: memories.title,
          type: memories.type,
          projectId: memories.projectId,
          projectName: projects.name,
          trust: memories.trust,
          sourceKind: memories.sourceKind,
          updatedAt: memories.updatedAt,
        })
        .from(memories)
        .leftJoin(projects, eq(projects.id, memories.projectId))
        .where(live)
        .orderBy(desc(memories.updatedAt))
        .limit(GRAPH_LIMIT + 1)
        .all();
      const shown = rows.slice(0, GRAPH_LIMIT);
      const ids = new Set(shown.map((row) => row.id));
      const tagsById = new Map<string, string[]>();
      for (const row of db.select({ memoryId: memoryTags.memoryId, name: tags.name }).from(memoryTags).innerJoin(tags, eq(tags.id, memoryTags.tagId)).orderBy(asc(tags.name)).all()) {
        if (ids.has(row.memoryId)) tagsById.set(row.memoryId, [...(tagsById.get(row.memoryId) ?? []), row.name]);
      }
      const resolved = db
        .select({ sourceId: links.sourceId, targetId: links.targetId, relation: links.relation, origin: links.origin })
        .from(links)
        .where(isNotNull(links.targetId))
        .orderBy(asc(links.id))
        .all()
        .flatMap((link) => (link.targetId && ids.has(link.sourceId) && ids.has(link.targetId) ? [{ ...link, targetId: link.targetId }] : []));
      return { memories: shown.map((row) => ({ ...row, tags: tagsById.get(row.id) ?? [] })), links: resolved, truncated: rows.length > GRAPH_LIMIT };
    },

    /**
     * Memory Galaxy snapshot (lote 50.06): the most recent live memories (one star each, no content), the stored
     * links between them, the real total, and their stored embeddings so the renderer worker can lay out by meaning.
     * Nothing is computed here beyond reading rows: projection and clustering run in a renderer Web Worker.
     */
    galaxy(): GalaxySnapshot {
      const db = need().handle.db;
      const rows = db
        .select({
          id: memories.id,
          title: memories.title,
          type: memories.type,
          projectId: memories.projectId,
          projectName: projects.name,
          trust: memories.trust,
          confidence: memories.confidence,
          sourceKind: memories.sourceKind,
          createdAt: memories.createdAt,
          updatedAt: memories.updatedAt,
        })
        .from(memories)
        .leftJoin(projects, eq(projects.id, memories.projectId))
        .where(live)
        .orderBy(desc(memories.updatedAt))
        .limit(GRAPH_LIMIT + 1)
        .all();
      const shown = rows.slice(0, GRAPH_LIMIT);
      const ids = new Set(shown.map((row) => row.id));
      const total = db.select({ n: sql<number>`count(*)` }).from(memories).where(live).get()?.n ?? shown.length;
      const tagsById = new Map<string, string[]>();
      for (const row of db.select({ memoryId: memoryTags.memoryId, name: tags.name }).from(memoryTags).innerJoin(tags, eq(tags.id, memoryTags.tagId)).orderBy(asc(tags.name)).all()) {
        if (ids.has(row.memoryId)) tagsById.set(row.memoryId, [...(tagsById.get(row.memoryId) ?? []), row.name]);
      }
      const resolved = db
        .select({ sourceId: links.sourceId, targetId: links.targetId, relation: links.relation, origin: links.origin })
        .from(links)
        .where(isNotNull(links.targetId))
        .orderBy(asc(links.id))
        .all()
        .flatMap((link) => (link.targetId && ids.has(link.sourceId) && ids.has(link.targetId) ? [{ ...link, targetId: link.targetId }] : []));

      // Stored vectors only (never computed here). One model: the active provider's when it has rows, else the
      // model most memories were embedded with, so vectors of different spaces never mix.
      const stored = db
        .select({ memoryId: embeddings.memoryId, model: embeddings.model, dim: embeddings.dim, vector: embeddings.vector })
        .from(embeddings)
        .innerJoin(memories, eq(memories.id, embeddings.memoryId))
        .where(and(live, eq(memories.embeddingStatus, 'ready')))
        .all()
        .filter((row) => ids.has(row.memoryId));
      const perModel = new Map<string, number>();
      for (const row of stored) perModel.set(row.model, (perModel.get(row.model) ?? 0) + 1);
      const preferred = options.provider && perModel.has(options.provider.model) ? options.provider.model : [...perModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const chosen = preferred ? stored.filter((row) => row.model === preferred) : [];
      const dim = chosen[0]?.dim ?? 0;
      const usable = chosen.filter((row) => row.dim === dim && row.vector.byteLength === dim * 4);
      let galaxyEmbeddings: GalaxySnapshot['embeddings'] = null;
      if (preferred && dim > 0 && usable.length > 0) {
        const bytes = new Uint8Array(usable.length * dim * 4);
        usable.forEach((row, index) => bytes.set(new Uint8Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength), index * dim * 4));
        galaxyEmbeddings = { model: preferred, dim, ids: usable.map((row) => row.memoryId), vectors: bytes };
      }
      return { memories: shown.map((row) => ({ ...row, tags: tagsById.get(row.id) ?? [] })), links: resolved, total, truncated: rows.length > GRAPH_LIMIT, embeddings: galaxyEmbeddings };
    },

    /**
     * Pairs of memories whose embeddings are close (cosine of unit vectors), the strongest few per memory.
     * Calculated on request and never stored; only the most recent memories are compared to bound the cost.
     */
    async similarity(): Promise<BrainSimilarity> {
      const base = { threshold: SIMILARITY_THRESHOLD, topK: SIMILARITY_TOP_K, considered: 0, truncated: false, edges: [] };
      const availability = options.provider ? await options.provider.availability() : null;
      if (!options.provider || !availability?.ok) return { ...base, available: false, reason: 'disabled' };
      const rows = need()
        .handle.db.select({ id: memories.id, vector: embeddings.vector })
        .from(memories)
        .innerJoin(embeddings, and(eq(embeddings.memoryId, memories.id), eq(embeddings.model, options.provider.model)))
        .where(and(live, eq(memories.embeddingStatus, 'ready')))
        .orderBy(desc(memories.updatedAt))
        .limit(SIMILARITY_LIMIT + 1)
        .all();
      if (!rows.length) return { ...base, available: false, reason: 'no_embeddings' };
      const compared = rows.slice(0, SIMILARITY_LIMIT);
      const vectors = compared.map((row) => fromBlob(row.vector));
      const best = new Map<string, { a: number; b: number; score: number }>();
      for (let i = 0; i < vectors.length; i++) {
        const scores: { j: number; score: number }[] = [];
        for (let j = 0; j < vectors.length; j++) {
          if (i === j) continue;
          let score = 0;
          const a = vectors[i];
          const b = vectors[j];
          if (!a || !b) continue;
          for (let k = 0; k < a.length; k++) score += (a[k] ?? 0) * (b[k] ?? 0);
          if (score >= SIMILARITY_THRESHOLD) scores.push({ j, score });
        }
        for (const { j, score } of scores.sort((x, y) => y.score - x.score).slice(0, SIMILARITY_TOP_K)) {
          const key = i < j ? `${i}:${j}` : `${j}:${i}`;
          if (!best.has(key)) best.set(key, { a: Math.min(i, j), b: Math.max(i, j), score });
        }
      }
      return {
        ...base,
        available: true,
        reason: null,
        considered: compared.length,
        truncated: rows.length > SIMILARITY_LIMIT,
        edges: [...best.values()].map((edge) => ({ sourceId: compared[edge.a]?.id ?? '', targetId: compared[edge.b]?.id ?? '', score: Math.round(edge.score * 1000) / 1000 })),
      };
    },

    /** Recent access-log rows (who recalled or found which memory, when), oldest first; never the content. */
    activity(since: string): BrainActivityEntry[] {
      return need()
        .handle.db.select({ id: accessLog.id, memoryId: accessLog.memoryId, title: memories.title, client: accessLog.client, action: accessLog.action, at: accessLog.at })
        .from(accessLog)
        .innerJoin(memories, eq(memories.id, accessLog.memoryId))
        .where(and(gt(accessLog.at, since), live))
        .orderBy(desc(accessLog.at), desc(accessLog.id))
        .limit(ACTIVITY_LIMIT)
        .all()
        .reverse();
    },

    projects(): ProjectRef[] {
      return need()
        .handle.db.select({ id: projects.id, name: projects.name, isPrivate: projects.isPrivate })
        .from(projects)
        .orderBy(asc(projects.name))
        .all();
    },

    tags(): TagCount[] {
      return need()
        .handle.db.select({ name: tags.name, count: sql<number>`count(*)` })
        .from(tags)
        .innerJoin(memoryTags, eq(memoryTags.tagId, tags.id))
        .innerJoin(memories, eq(memories.id, memoryTags.memoryId))
        .where(live)
        .groupBy(tags.name)
        .orderBy(desc(sql`count(*)`), asc(tags.name))
        .all();
    },
  };
}
