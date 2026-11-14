import type { Confidence, MemoryType, SourceKind, Trust } from './domain.js';

/** What the 3D brain shows of each memory (no content: details open in the Inspector). */
export interface Brain3DMemory {
  id: string;
  title: string;
  type: MemoryType;
  projectId: string | null;
  projectName: string | null;
  trust: Trust;
  sourceKind: SourceKind;
  tags: string[];
  updatedAt: string;
}

/** A stored link between two memories in the snapshot (pending links are not drawn). */
export interface Brain3DLink {
  sourceId: string;
  targetId: string;
  relation: string;
  origin: 'wikilink' | 'explicit';
}

export interface Brain3DGraph {
  memories: Brain3DMemory[];
  links: Brain3DLink[];
  /** More live memories exist than the snapshot holds. */
  truncated: boolean;
}

/** Similarity calculated from embeddings in the main process; never stored as a link. */
export interface BrainSimilarity {
  available: boolean;
  /** Why it is unavailable: semantic search off, or no memory has an embedding yet. */
  reason: 'disabled' | 'no_embeddings' | null;
  threshold: number;
  topK: number;
  /** Memories with a ready embedding that were compared. */
  considered: number;
  /** Only the most recent memories were compared. */
  truncated: boolean;
  edges: { sourceId: string; targetId: string; score: number }[];
}

/** One access-log row: a memory recalled or found, by whom and when (never the content). */
export interface BrainActivityEntry {
  id: number;
  memoryId: string;
  title: string;
  client: string;
  action: 'recall' | 'search_hit' | 'context' | 'update';
  at: string;
}

/** Lote 50.06: what the Memory Galaxy draws of each memory. Every star is one live memory; no content travels. */
export interface GalaxyMemory extends Brain3DMemory {
  createdAt: string;
  confidence: Confidence;
}

/** Stored embeddings of the memories in the snapshot, for the layout worker. */
export interface GalaxyEmbeddings {
  model: string;
  dim: number;
  /** Memory ids, in the order of the vectors. */
  ids: string[];
  /** ids.length x dim Float32 values, little endian. */
  vectors: Uint8Array;
}

export interface GalaxySnapshot {
  memories: GalaxyMemory[];
  links: Brain3DLink[];
  /** Live memories in the database; above memories.length the snapshot is a sample of the most recent. */
  total: number;
  truncated: boolean;
  /** null when no memory in the snapshot has a stored embedding. */
  embeddings: GalaxyEmbeddings | null;
}
