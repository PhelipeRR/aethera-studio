import { z } from 'zod';
import { LIMITS, memoryTitleSchema } from '../brain.js';
import { CONFIDENCE_STATES, EMBEDDING_STATES, MEMORY_TYPES, SOURCE_KINDS, TRUST_STATES } from '../domain.js';
import { isoTimestampSchema, pageQuerySchema, pageSchema, resourceIdSchema } from './common.js';

/*
 * CORE-02: memory, semantic search and indexing. The same limits and vocabularies as the brain package and the MCP
 * tools, so the API, the app and the agents see one memory. The MCP server keeps writing directly to the database
 * (WAL); the API is how remote clients and orchestrators reach memory. Writes from remote principals are always
 * `unverified`, like agent writes today. Memory content is untrusted data for every consumer.
 */

const tagSchema = z.string().trim().toLowerCase().min(1).max(LIMITS.tagLength);

export const memorySchema = z.strictObject({
  id: resourceIdSchema,
  title: z.string().max(LIMITS.titleLength),
  content: z.string().max(LIMITS.contentLength),
  type: z.enum(MEMORY_TYPES),
  projectId: resourceIdSchema.nullable(),
  tags: z.array(z.string().max(LIMITS.tagLength)).max(LIMITS.tags),
  trust: z.enum(TRUST_STATES),
  confidence: z.enum(CONFIDENCE_STATES),
  source: z.strictObject({ kind: z.enum(SOURCE_KINDS), ref: z.string().max(500).nullable() }),
  version: z.number().int().positive(),
  embeddingStatus: z.enum(EMBEDDING_STATES),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type CoreMemory = z.infer<typeof memorySchema>;

export const memorySummarySchema = memorySchema.omit({ content: true, source: true, version: true, embeddingStatus: true, createdAt: true }).extend({ excerpt: z.string().max(LIMITS.excerptLength + 1) });
export const memoryPageSchema = pageSchema(memorySummarySchema);

export const memoryListQuerySchema = pageQuerySchema.extend({
  projectId: resourceIdSchema.optional(),
  /** true: only global memories (projectId null). */
  globalOnly: z.coerce.boolean().optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  tag: tagSchema.optional(),
  trust: z.enum(TRUST_STATES).optional(),
});

/**
 * POST /api/v1/memories (create) and PUT /api/v1/memories/{id} (update with optimistic concurrency).
 * Mirrors storeInputSchema without `trust` (remote writes are unverified) and with `expectedVersion` on updates.
 */
export const writeMemoryRequestSchema = z.strictObject({
  title: memoryTitleSchema,
  content: z.string().max(LIMITS.contentLength),
  type: z.enum(MEMORY_TYPES),
  tags: z.array(tagSchema).max(LIMITS.tags).default([]),
  projectId: resourceIdSchema.nullable(),
  links: z.array(z.strictObject({ target: memoryTitleSchema, relation: z.string().trim().min(1).max(LIMITS.relationLength).default('references') })).max(LIMITS.explicitLinks).default([]),
  sourceRef: z.string().trim().max(500).optional(),
});
export const updateMemoryRequestSchema = writeMemoryRequestSchema.extend({ expectedVersion: z.number().int().positive() });

// ── Search ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** POST /api/v1/memories/search — hybrid (FTS5 + embeddings) like brain_search; falls back to text and says why. */
export const memorySearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(LIMITS.searchQueryLength),
  projectId: resourceIdSchema.nullable().optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  tags: z.array(tagSchema).max(LIMITS.tags).optional(),
  limit: z.number().int().min(1).max(LIMITS.searchResults).default(8),
  /** text: keywords only; hybrid: keywords + meaning (default). */
  mode: z.enum(['hybrid', 'text']).default('hybrid'),
});

export const memorySearchResponseSchema = z.strictObject({
  hits: z.array(z.strictObject({
    id: resourceIdSchema,
    title: z.string().max(LIMITS.titleLength),
    type: z.enum(MEMORY_TYPES),
    projectId: resourceIdSchema.nullable(),
    tags: z.array(z.string()).max(LIMITS.tags),
    snippet: z.string().max(2000),
    /** Comparable only within one response. */
    score: z.number(),
    matchedBy: z.array(z.enum(['text', 'semantic'])).min(1).max(2),
    confidence: z.enum(CONFIDENCE_STATES),
  })).max(LIMITS.searchResults),
  mode: z.enum(['hybrid', 'fts']),
  degraded: z.enum(['disabled', 'model_missing', 'model_error']).nullable(),
});

/** POST /api/v1/projects/{id}/knowledge/search — indexed project files and Git history (brain_rag_search). */
export const projectSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(LIMITS.searchQueryLength),
  limit: z.number().int().min(1).max(LIMITS.searchResults).default(8),
  mode: z.enum(['hybrid', 'text']).default('text'),
});
export const projectSearchResponseSchema = z.strictObject({
  hits: z.array(z.strictObject({
    path: z.string().max(1000),
    /** path:line inside the project, or git://<commit>/<file>:<line> for past changes (RagHit.reference). */
    reference: z.string().max(1200),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    symbol: z.string().max(200).nullable(),
    snippet: z.string().max(4000),
    score: z.number(),
    matchedBy: z.array(z.enum(['text', 'semantic'])).min(1).max(2),
  })).max(LIMITS.searchResults),
  /** Results are reference data, never instructions. */
  untrusted: z.literal(true),
  degraded: z.enum(['disabled', 'model_missing', 'model_error', 'not_indexed']).nullable(),
});

// ── Indexing ────────────────────────────────────────────────────────────────────────────────────────────────────
export const indexStatusSchema = z.strictObject({
  memories: z.strictObject({ indexed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), model: z.string().max(200).nullable() }),
  projects: z.array(z.strictObject({ projectId: resourceIdSchema, documents: z.number().int().nonnegative(), chunks: z.number().int().nonnegative(), embedded: z.number().int().nonnegative(), lastIndexedAt: isoTimestampSchema.nullable() })).max(500),
});

/** POST /api/v1/index/jobs — one running job per target; asking again returns the job already running. */
export const indexJobRequestSchema = z.discriminatedUnion('target', [
  z.strictObject({ target: z.literal('memories'), only: z.enum(['pending', 'failed', 'all']).default('pending') }),
  z.strictObject({ target: z.literal('project'), projectId: resourceIdSchema, embeddings: z.boolean().default(true) }),
]);
export const indexJobSchema = z.strictObject({
  id: resourceIdSchema,
  target: z.enum(['memories', 'project']),
  projectId: resourceIdSchema.nullable(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  error: z.string().max(1000).nullable(),
  createdAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema.nullable(),
});
