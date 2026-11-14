import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { accessLog, embeddings, links, memories, memorySources, memoryTags, memoryVersions, projects, tags, type DatabaseHandle } from '@neuralbridge/database';
import {
  LIMITS,
  listFilterSchema,
  searchFilterSchema,
  storeInputSchema,
  type LinkRef,
  type ListFilter,
  type SearchFilter,
  type SearchHit,
  type Memory,
  type MemoryDetail,
  type MemorySummary,
  type MemoryVersion,
  type Page,
  type ParsedStoreInput,
  type StoreInput,
} from '@neuralbridge/shared';
import type { z } from 'zod';
import { BrainError } from './errors.js';
import { newId } from './ids.js';
import { targetProject, visibleTo, type Actor, type Scope } from './scope.js';
import { parseWikiLinks } from './wikilinks.js';

type MemoryRow = typeof memories.$inferSelect;

export interface StoreResult {
  memory: Memory;
  created: boolean;
  /** false when the input matched the stored memory exactly: no new version was written. */
  changed: boolean;
}

export interface LinkSet {
  outgoing: LinkRef[];
  backlinks: LinkRef[];
  pending: string[];
}

const lower = (value: SQL | typeof memories.title | typeof links.targetTitle) => sql`lower(${value})`;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BrainError('invalid', `${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data;
}

function isLiveTitleConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message) && /memories_live_title_unique|memories\.title/.test(error.message);
}

function encodeCursor(row: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.updatedAt, row.id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'string')) return value as [string, string];
  } catch {
    // fall through
  }
  throw new BrainError('invalid', 'cursor: not a cursor returned by list');
}

// Portuguese and English function words: as ORed prefix terms they match nearly every memory and
// drown the real matches (measured in tests/integration/relevance.test.ts).
export const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem e ou que se ao aos à às é ser como onde quando qual quais ' +
    'mais menos muito não sim seu sua seus suas meu minha isso isto esse essa este esta the an of to in on at by for with from and or is are be ' +
    'was were it its this that these those how what when where which who why do does did not no yes'
  ).split(' '),
);

/**
 * Turns free text into a safe FTS5 expression: word tokens only (stopwords dropped), ORed; words of three
 * or more characters also match as prefixes. User input never reaches MATCH as syntax (columns, NEAR, quotes).
 */
export function toFtsQuery(query: string): string | null {
  const words = query.slice(0, LIMITS.searchQueryLength).toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const terms = [...new Set(words.filter((word) => !STOPWORDS.has(word)))].slice(0, LIMITS.searchTerms);
  return terms.length ? terms.map((term) => (term.length >= 3 ? `"${term}"*` : `"${term}"`)).join(' OR ') : null;
}

const hasTag = (tag: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${memoryTags} JOIN ${tags} ON ${tags.id} = ${memoryTags.tagId} WHERE ${memoryTags.memoryId} = ${memories.id} AND ${tags.name} = ${tag})`;

export type ParsedSearchFilter = z.output<typeof searchFilterSchema>;

/** Strings wrapped around matched terms in snippets. [ ] reads well for agents; the app uses control characters. */
export type SnippetMarkers = readonly [open: string, close: string];
export const DEFAULT_MARKERS: SnippetMarkers = ['[', ']'];

export function parseSearchFilter(filter: SearchFilter): ParsedSearchFilter {
  return parse(searchFilterSchema, filter);
}

export interface TextCandidate {
  id: string;
  title: string;
  type: SearchHit['type'];
  projectId: string | null;
  rank: number;
  snippet: string;
}

export interface VectorCandidate {
  id: string;
  title: string;
  type: SearchHit['type'];
  projectId: string | null;
  content: string;
  vector: Buffer;
}

const linkKey = (title: string, relation: string) => `${title.toLowerCase()}\u0000${relation}`;

/**
 * The Neural Brain's memory store: create/update with versioning, [[wiki links]] with pending targets,
 * project scoping and soft/hard delete. Synchronous: better-sqlite3 transactions are synchronous.
 */
export class BrainService {
  private readonly db: DatabaseHandle['db'];
  private readonly clock: () => Date;

  constructor(
    private readonly handle: DatabaseHandle,
    options: { clock?: () => Date } = {},
  ) {
    this.db = handle.db;
    this.clock = options.clock ?? (() => new Date());
  }

  store(input: StoreInput, scope: Scope, actor: Actor): StoreResult {
    const parsed = parse(storeInputSchema, input);
    try {
      // IMMEDIATE takes the write lock up front, so another process (app or MCP server) cannot
      // create the same title between our lookup and our insert; it waits on busy_timeout instead.
      return this.handle.sqlite.transaction(() => this.storeOnce(parsed, scope, actor)).immediate();
    } catch (error) {
      if (isLiveTitleConflict(error)) throw new BrainError('conflict', `A memory titled "${parsed.title}" already exists here.`);
      throw error;
    }
  }

  recall(idOrTitle: string, scope: Scope, actor: Actor): MemoryDetail | null {
    const key = idOrTitle.trim();
    const row =
      this.db.select().from(memories).where(and(visibleTo(scope), eq(memories.id, key))).get() ??
      this.db
        .select()
        .from(memories)
        .where(and(visibleTo(scope), eq(lower(memories.title), key.toLowerCase())))
        .orderBy(sql`${memories.projectId} IS NULL`)
        .get();
    if (!row) return null;
    this.db.insert(accessLog).values({ memoryId: row.id, client: actor.client, action: 'recall', at: this.now() }).run();
    return { ...this.toMemory(row), ...this.linkSet(row, scope) };
  }

  /**
   * Full-text search (FTS5, bm25 with titles weighted 4:1). Accent- and case-insensitive, prefix matching;
   * no stemming, so singular and plural forms may not match each other. Phase 6 adds semantic search here.
   */
  search(query: string, filter: SearchFilter, scope: Scope, actor: Actor): SearchHit[] {
    const parsed = parseSearchFilter(filter);
    const rows = this.textCandidates(query, parsed, scope, parsed.limit);
    this.logSearchHits(
      rows.map((row) => row.id),
      actor,
    );
    return this.toSearchHits(rows.map((row) => ({ ...row, score: -row.rank, matchedBy: ['text'] })));
  }

  /** Keyword candidates, best first (lower bm25 rank is better). Building block for HybridSearch. */
  textCandidates(query: string, filter: ParsedSearchFilter, scope: Scope, limit: number, markers: SnippetMarkers = DEFAULT_MARKERS): TextCandidate[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    return this.db.all<TextCandidate>(sql`
      SELECT ${memories.id} AS id, ${memories.title} AS title, ${memories.type} AS type, ${memories.projectId} AS projectId,
             bm25(memories_fts, 4.0, 1.0) AS rank,
             snippet(memories_fts, 1, ${markers[0]}, ${markers[1]}, '…', 16) AS snippet
      FROM memories_fts JOIN ${memories} ON ${memories.seq} = memories_fts.rowid
      WHERE ${and(sql`memories_fts MATCH ${match}`, ...this.searchConditions(filter, scope))}
      ORDER BY rank
      LIMIT ${limit}`);
  }

  /** Memories in scope with a ready vector from `model`. Building block for HybridSearch. */
  vectorCandidates(filter: ParsedSearchFilter, scope: Scope, model: string): VectorCandidate[] {
    return this.db
      .select({ id: memories.id, title: memories.title, type: memories.type, projectId: memories.projectId, content: memories.content, vector: embeddings.vector })
      .from(memories)
      .innerJoin(embeddings, and(eq(embeddings.memoryId, memories.id), eq(embeddings.model, model)))
      .where(and(eq(memories.embeddingStatus, 'ready'), ...this.searchConditions(filter, scope)))
      .all();
  }

  logSearchHits(ids: string[], actor: Actor): void {
    if (!ids.length) return;
    const at = this.now();
    this.db.insert(accessLog).values(ids.map((memoryId) => ({ memoryId, client: actor.client, action: 'search_hit' as const, at }))).run();
  }

/**
   * Sets how far a memory has been checked. Only people (the app) and the evidence check call this:
   * nothing an agent writes raises it.
   */
  setConfidence(id: string, confidence: 'unverified' | 'reviewed' | 'stale'): { confidence: 'unverified' | 'reviewed' | 'stale' } {
    const row = this.db.select({ id: memories.id }).from(memories).where(and(eq(memories.id, id), isNull(memories.deletedAt))).get();
    if (!row) throw new BrainError('not_found', 'Memória não encontrada.');
    this.db.update(memories).set({ confidence, updatedAt: this.now() }).where(eq(memories.id, id)).run();
    return { confidence };
  }

  /** Confidence metadata used by the RAG ranker without exposing it as prompt content. */
  confidenceFor(ids: readonly string[]): Map<string, 'unverified' | 'reviewed' | 'stale'> {
    if (!ids.length) return new Map();
    return new Map(this.db.select({ id: memories.id, confidence: memories.confidence }).from(memories).where(inArray(memories.id, [...ids])).all().map((row) => [row.id, row.confidence] as const));
  }

  toSearchHits(entries: Omit<SearchHit, 'tags' | 'confidence'>[]): SearchHit[] {
    const tagsById = this.tagsFor(entries.map((entry) => entry.id));
    const confidence = this.confidenceFor(entries.map((entry) => entry.id));
    return entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      projectId: entry.projectId,
      tags: tagsById.get(entry.id) ?? [],
      snippet: entry.snippet,
      score: entry.score,
      matchedBy: entry.matchedBy,
      confidence: confidence.get(entry.id) ?? 'unverified',
    }));
  }

  private searchConditions(filter: ParsedSearchFilter, scope: Scope): SQL[] {
    const conditions: SQL[] = [visibleTo(scope)];
    if (filter.type) conditions.push(eq(memories.type, filter.type));
    for (const tag of new Set(filter.tags)) conditions.push(hasTag(tag));
    return conditions;
  }

  list(filter: ListFilter, scope: Scope): Page<MemorySummary> {
    const parsed = parse(listFilterSchema, filter);
    const conditions: (SQL | undefined)[] = [visibleTo(scope)];
    if (parsed.projectId !== undefined) conditions.push(parsed.projectId === null ? isNull(memories.projectId) : eq(memories.projectId, parsed.projectId));
    if (parsed.type) conditions.push(eq(memories.type, parsed.type));
    if (parsed.trust) conditions.push(eq(memories.trust, parsed.trust));
    for (const tag of new Set(parsed.tags)) conditions.push(hasTag(tag));
    if (parsed.cursor) {
      const [updatedAt, id] = decodeCursor(parsed.cursor);
      conditions.push(or(lt(memories.updatedAt, updatedAt), and(eq(memories.updatedAt, updatedAt), lt(memories.id, id))));
    }

    const rows = this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt), desc(memories.id))
      .limit(parsed.limit + 1)
      .all();
    const page = rows.slice(0, parsed.limit);
    const tagsById = this.tagsFor(page.map((row) => row.id));
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        projectId: row.projectId,
        tags: tagsById.get(row.id) ?? [],
        trust: row.trust,
        confidence: row.confidence,
        excerpt: row.content.slice(0, LIMITS.excerptLength),
        updatedAt: row.updatedAt,
      })),
      nextCursor: rows.length > parsed.limit && last ? encodeCursor(last) : null,
    };
  }

  delete(id: string, scope: Scope, _actor: Actor, options: { hard?: boolean } = {}): void {
    const row = this.requireVisible(id, scope);
    this.handle.sqlite
      .transaction(() => {
        if (options.hard) {
          this.db.delete(memories).where(eq(memories.id, row.id)).run();
          return;
        }
        this.db.update(memories).set({ deletedAt: this.now(), updatedAt: this.now() }).where(eq(memories.id, row.id)).run();
        // A deleted memory is no longer a link target: links to it become pending again.
        this.db.update(links).set({ targetId: null }).where(eq(links.targetId, row.id)).run();
      })
      .immediate();
  }

  links(id: string, scope: Scope): LinkSet {
    return this.linkSet(this.requireVisible(id, scope), scope);
  }

  versions(id: string, scope: Scope): MemoryVersion[] {
    const row = this.requireVisible(id, scope);
    return this.db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.memoryId, row.id))
      .orderBy(desc(memoryVersions.version))
      .all()
      .map((version) => ({
        version: version.version,
        title: version.title,
        content: version.content,
        type: version.type,
        tags: JSON.parse(version.tags) as string[],
        changedBy: version.changedBy,
        createdAt: version.createdAt,
      }));
  }

  /** Rebuilds a memory's links from its content and the explicit links given, and points pending links elsewhere at it (imports). */
  rebuildLinks(id: string, explicit: { target: string; relation: string }[]): void {
    const row = this.requireRow(id);
    this.writeLinks(row, explicit);
    this.resolvePendingLinksTo(row);
  }

  // --- store internals -------------------------------------------------------------------------

  private storeOnce(input: ParsedStoreInput, scope: Scope, actor: Actor): StoreResult {
    let existing: MemoryRow | undefined;
    let projectId: string | null;

    if (input.id) {
      existing = this.db.select().from(memories).where(and(visibleTo(scope), eq(memories.id, input.id))).get();
      if (!existing) throw new BrainError('not_found', `No memory with id ${input.id}.`);
      if (input.projectId !== undefined && input.projectId !== existing.projectId) {
        throw new BrainError('invalid', 'projectId: a memory cannot be moved to another project.');
      }
      projectId = existing.projectId;
    } else {
      const target = targetProject(input.projectId, scope);
      if ('forbidden' in target) throw new BrainError('forbidden', target.forbidden);
      projectId = target.projectId;
      if (projectId !== null && !this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
        throw new BrainError('not_found', `No project with id ${projectId}.`);
      }
      existing = this.findLiveByTitle(input.title, projectId);
    }

    const tagNames = [...new Set(input.tags)].sort();
    const explicit = new Map<string, { target: string; relation: string }>();
    for (const link of input.links) explicit.set(linkKey(link.target, link.relation), link);
    const now = this.now();

    if (!existing) {
      const id = newId(this.clock().getTime());
      this.db
        .insert(memories)
        .values({
          id,
          title: input.title,
          content: input.content,
          type: input.type,
          projectId,
          trust: actor.kind === 'user' ? (input.trust ?? 'unverified') : 'unverified',
          confidence: actor.kind === 'user' ? (input.trust === 'reviewed' ? 'reviewed' : 'unverified') : 'unverified',
          sourceKind: actor.kind,
          sourceRef: input.sourceRef ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const row = this.requireRow(id);
      this.writeTags(id, tagNames);
      this.writeLinks(row, [...explicit.values()]);
      this.writeEvidence(id, input.sourceRef);
      this.writeVersion(row, tagNames, actor);
      this.resolvePendingLinksTo(row);
      return { memory: this.toMemory(row), created: true, changed: true };
    }

    const textChanged = input.title !== existing.title || input.content !== existing.content;
    const trust = actor.kind === 'user' ? (input.trust ?? existing.trust) : textChanged ? 'unverified' : existing.trust;
    const currentExplicit = this.db
      .select({ title: links.targetTitle, relation: links.relation })
      .from(links)
      .where(and(eq(links.sourceId, existing.id), eq(links.origin, 'explicit')))
      .all();
    const explicitChanged =
      currentExplicit.length !== explicit.size || currentExplicit.some((link) => !explicit.has(linkKey(link.title, link.relation)));
    const changed =
      textChanged ||
      explicitChanged ||
      input.type !== existing.type ||
      trust !== existing.trust ||
      (input.sourceRef !== undefined && input.sourceRef !== existing.sourceRef) ||
      (this.tagsFor([existing.id]).get(existing.id) ?? []).join('\u0000') !== tagNames.join('\u0000');

    if (!changed) return { memory: this.toMemory(existing), created: false, changed: false };

    this.db
      .update(memories)
      .set({
        title: input.title,
        content: input.content,
        type: input.type,
        trust,
        confidence: actor.kind === 'user' && input.trust === 'reviewed' ? 'reviewed' : textChanged ? 'unverified' : existing.confidence,
        sourceRef: input.sourceRef ?? existing.sourceRef,
        version: existing.version + 1,
        embeddingStatus: textChanged ? 'pending' : existing.embeddingStatus,
        updatedAt: now,
      })
      .where(eq(memories.id, existing.id))
      .run();
    const row = this.requireRow(existing.id);
    this.writeTags(row.id, tagNames);
    this.writeLinks(row, [...explicit.values()]);
    if (input.sourceRef !== undefined) this.writeEvidence(row.id, input.sourceRef);
    this.writeVersion(row, tagNames, actor);
    if (input.title !== existing.title) this.resolvePendingLinksTo(row);
    return { memory: this.toMemory(row), created: false, changed: true };
  }

  /** Separate method so tests can act between the lookup and the write. */
  private findLiveByTitle(title: string, projectId: string | null): MemoryRow | undefined {
    return this.db
      .select()
      .from(memories)
      .where(
        and(
          isNull(memories.deletedAt),
          projectId === null ? isNull(memories.projectId) : eq(memories.projectId, projectId),
          eq(lower(memories.title), title.toLowerCase()),
        ),
      )
      .get();
  }

  private writeTags(memoryId: string, names: string[]): void {
    this.db.delete(memoryTags).where(eq(memoryTags.memoryId, memoryId)).run();
    for (const name of names) {
      this.db.insert(tags).values({ name }).onConflictDoNothing().run();
      const tag = this.db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
      if (tag) this.db.insert(memoryTags).values({ memoryId, tagId: tag.id }).run();
    }
  }

  /** Replaces the memory's outgoing links: [[wiki links]] from the content, then explicit links. */
  private writeLinks(source: MemoryRow, explicit: { target: string; relation: string }[]): void {
    this.db.delete(links).where(eq(links.sourceId, source.id)).run();
    const seen = new Set<string>();
    const add = (title: string, relation: string, origin: 'wikilink' | 'explicit') => {
      const key = linkKey(title, relation);
      if (seen.has(key)) return;
      seen.add(key);
      const target = this.findLiveByTitle(title, source.projectId) ?? (source.projectId !== null ? this.findLiveByTitle(title, null) : undefined);
      this.db.insert(links).values({ sourceId: source.id, targetId: target?.id ?? null, targetTitle: title, relation, origin, createdAt: this.now() }).run();
    };
    for (const title of parseWikiLinks(source.content)) add(title, 'references', 'wikilink');
    for (const link of explicit) add(link.target, link.relation, 'explicit');
  }

  /** Points pending links at a memory that now carries their title: same project, or anywhere for a global memory. */
  private resolvePendingLinksTo(target: MemoryRow): void {
    const sources = this.db
      .select({ id: memories.id })
      .from(memories)
      .where(and(isNull(memories.deletedAt), target.projectId === null ? undefined : eq(memories.projectId, target.projectId)));
    this.db
      .update(links)
      .set({ targetId: target.id })
      .where(and(isNull(links.targetId), eq(lower(links.targetTitle), target.title.toLowerCase()), inArray(links.sourceId, sources)))
      .run();
  }

  private writeVersion(row: MemoryRow, tagNames: string[], actor: Actor): void {
    this.db
      .insert(memoryVersions)
      .values({
        memoryId: row.id,
        version: row.version,
        title: row.title,
        content: row.content,
        type: row.type,
        tags: JSON.stringify(tagNames),
        changedBy: actor.kind,
        createdAt: row.updatedAt,
      })
      .run();
  }

  // --- read internals --------------------------------------------------------------------------

  private linkSet(row: MemoryRow, scope: Scope): LinkSet {
    const outgoing = this.db
      .select({ id: links.targetId, title: links.targetTitle, relation: links.relation, origin: links.origin })
      .from(links)
      .where(eq(links.sourceId, row.id))
      .orderBy(asc(links.id))
      .all();
    const backlinks = this.db
      .select({ id: memories.id, title: memories.title, relation: links.relation, origin: links.origin })
      .from(links)
      .innerJoin(memories, eq(memories.id, links.sourceId))
      .where(and(eq(links.targetId, row.id), visibleTo(scope)))
      .orderBy(asc(links.id))
      .all();
    const pending = [...new Map(outgoing.filter((link) => link.id === null).map((link) => [link.title.toLowerCase(), link.title])).values()];
    return { outgoing, backlinks, pending };
  }

  private requireVisible(id: string, scope: Scope): MemoryRow {
    const row = this.db.select().from(memories).where(and(visibleTo(scope), eq(memories.id, id))).get();
    if (!row) throw new BrainError('not_found', `No memory with id ${id}.`);
    return row;
  }

  private requireRow(id: string): MemoryRow {
    const row = this.db.select().from(memories).where(eq(memories.id, id)).get();
    if (!row) throw new Error(`Memory ${id} vanished inside its own transaction`);
    return row;
  }

  private tagsFor(ids: string[]): Map<string, string[]> {
    const byId = new Map<string, string[]>();
    if (ids.length === 0) return byId;
    const rows = this.db
      .select({ memoryId: memoryTags.memoryId, name: tags.name })
      .from(memoryTags)
      .innerJoin(tags, eq(tags.id, memoryTags.tagId))
      .where(inArray(memoryTags.memoryId, ids))
      .orderBy(asc(tags.name))
      .all();
    for (const row of rows) byId.set(row.memoryId, [...(byId.get(row.memoryId) ?? []), row.name]);
    return byId;
  }

  private writeEvidence(memoryId: string, sourceRef: string | undefined): void {
    if (!sourceRef) return;
    const kind = sourceRef.startsWith('task:') ? 'task' : sourceRef.startsWith('conversation:') ? 'conversation' : sourceRef.startsWith('http') ? 'url' : 'file';
    const exists = this.db.select({ id: memorySources.id }).from(memorySources).where(and(eq(memorySources.memoryId, memoryId), eq(memorySources.ref, sourceRef))).get();
    if (!exists) this.db.insert(memorySources).values({ memoryId, kind, ref: sourceRef }).run();
  }

  private toMemory(row: MemoryRow): Memory {
    const evidence = this.db.select().from(memorySources).where(eq(memorySources.memoryId, row.id)).orderBy(asc(memorySources.id)).all();
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      projectId: row.projectId,
      tags: this.tagsFor([row.id]).get(row.id) ?? [],
      trust: row.trust,
      confidence: row.confidence,
      evidence: evidence.map((item) => ({ kind: item.kind, ref: item.ref, createdAt: item.createdAt })),
      source: { kind: row.sourceKind, ref: row.sourceRef },
      version: row.version,
      embeddingStatus: row.embeddingStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
