import { z } from 'zod';
import { MEMORY_TYPES, TRUST_STATES, type Confidence, type EmbeddingState, type MemoryType, type SourceKind, type Trust } from './domain.js';

export const LIMITS = {
  titleLength: 200,
  contentLength: 100_000,
  tags: 20,
  tagLength: 40,
  explicitLinks: 50,
  relationLength: 40,
  listPage: 100,
  excerptLength: 240,
  searchResults: 20,
  searchQueryLength: 500,
  searchTerms: 12,
} as const;

export const memoryTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.titleLength)
  .refine((title) => !/[\r\n]/.test(title) && !title.includes('[[') && !title.includes(']]'), {
    message: 'Title must be a single line without [[ or ]]',
  });

const tagSchema = z.string().trim().toLowerCase().min(1).max(LIMITS.tagLength);
const idSchema = z.string().trim().min(1).max(64);

export const storeInputSchema = z.strictObject({
  /** Update this memory. Without it, a live memory with the same title in the target project is updated. */
  id: idSchema.optional(),
  title: memoryTitleSchema,
  content: z.string().max(LIMITS.contentLength),
  type: z.enum(MEMORY_TYPES),
  tags: z.array(tagSchema).max(LIMITS.tags).default([]),
  /** Omitted: the caller's project (or global). null: global. */
  projectId: idSchema.nullable().optional(),
  links: z
    .array(z.strictObject({ target: memoryTitleSchema, relation: z.string().trim().min(1).max(LIMITS.relationLength).default('references') }))
    .max(LIMITS.explicitLinks)
    .default([]),
  /** Honoured only for the user; agent writes are always unverified. */
  trust: z.enum(TRUST_STATES).optional(),
  sourceRef: z.string().trim().max(500).optional(),
});
export type StoreInput = z.input<typeof storeInputSchema>;
export type ParsedStoreInput = z.output<typeof storeInputSchema>;

export const listFilterSchema = z.strictObject({
  projectId: idSchema.nullable().optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  tags: z.array(tagSchema).max(LIMITS.tags).default([]),
  trust: z.enum(TRUST_STATES).optional(),
  limit: z.number().int().min(1).max(LIMITS.listPage).default(20),
  cursor: z.string().max(200).optional(),
});
export type ListFilter = z.input<typeof listFilterSchema>;

export const searchFilterSchema = z.strictObject({
  type: z.enum(MEMORY_TYPES).optional(),
  tags: z.array(tagSchema).max(LIMITS.tags).default([]),
  limit: z.number().int().min(1).max(LIMITS.searchResults).default(8),
});
export type SearchFilter = z.input<typeof searchFilterSchema>;

export interface SearchHit {
  id: string;
  title: string;
  type: MemoryType;
  projectId: string | null;
  tags: string[];
  /** Matching fragment, terms wrapped in [ and ]. */
  snippet: string;
  /** Higher is more relevant. Comparable only within one result list. */
  score: number;
  /** Which retrievers found it: keywords (FTS5) and/or meaning (embeddings). */
  matchedBy: ('text' | 'semantic')[];
  /** How far the memory has been checked; stale ones rank lower and are flagged to agents. */
  confidence: Confidence;
}

/** One piece of a memory's evidence after checking it against the project folder. */
export interface EvidenceCheck {
  kind: Memory['evidence'][number]['kind'];
  ref: string;
  /** missing or changed make the memory stale; unchecked: not a file inside the memory's project. */
  status: 'ok' | 'missing' | 'changed' | 'unchecked';
}

/** Why semantic search did not run; the search fell back to keywords only. */
export type SemanticUnavailable = 'disabled' | 'model_missing' | 'model_error';

export interface SearchResult {
  hits: SearchHit[];
  mode: 'hybrid' | 'fts';
  degraded: SemanticUnavailable | null;
}

export interface Memory {
  id: string;
  title: string;
  content: string;
  type: MemoryType;
  projectId: string | null;
  tags: string[];
  trust: Trust;
  confidence: Confidence;
  evidence: Array<{ kind: 'file' | 'url' | 'task' | 'conversation'; ref: string; createdAt: string }>;
  source: { kind: SourceKind; ref: string | null };
  version: number;
  embeddingStatus: EmbeddingState;
  createdAt: string;
  updatedAt: string;
}

export interface LinkRef {
  /** null when the target does not exist yet (pending). */
  id: string | null;
  title: string;
  relation: string;
  origin: 'wikilink' | 'explicit';
}

export interface MemoryDetail extends Memory {
  outgoing: LinkRef[];
  backlinks: LinkRef[];
  /** Titles linked from this memory that do not resolve yet. */
  pending: string[];
}

export interface MemorySummary {
  id: string;
  title: string;
  type: MemoryType;
  projectId: string | null;
  tags: string[];
  trust: Trust;
  confidence: Confidence;
  excerpt: string;
  updatedAt: string;
}

export interface MemoryVersion {
  version: number;
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
  changedBy: SourceKind;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Search as the app offers it: projectId undefined = everything, null = global memories only. */
export const brainSearchInputSchema = z.strictObject({
  query: z.string().max(LIMITS.searchQueryLength),
  type: z.enum(MEMORY_TYPES).optional(),
  tags: z.array(tagSchema).max(LIMITS.tags).optional(),
  projectId: idSchema.nullable().optional(),
  limit: z.number().int().min(1).max(LIMITS.searchResults).optional(),
});
export type BrainSearchInput = z.input<typeof brainSearchInputSchema>;

export interface BrainOverview {
  total: number;
  byType: { type: MemoryType; count: number }[];
  byProject: { projectId: string | null; name: string | null; count: number }[];
  links: { resolved: number; pending: number };
  embeddings: { indexed: number; pending: number; failed: number };
  recent: MemorySummary[];
}

export interface ProjectRef {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface TagCount {
  name: string;
  count: number;
}

/** Whole-brain snapshot for the graph view; filtering happens in the UI. */
export interface GraphMemory {
  id: string;
  title: string;
  type: MemoryType;
  projectId: string | null;
  tags: string[];
}

export interface GraphLink {
  sourceId: string;
  /** null = pending: no memory has this title yet. */
  targetId: string | null;
  targetTitle: string;
  relation: string;
}

export interface BrainGraph {
  memories: GraphMemory[];
  links: GraphLink[];
  /** More memories exist than the graph limit; the most recently updated are shown. */
  truncated: boolean;
}

export const GRAPH_LIMIT = 5000;
