import { z } from 'zod';
import { MEMORY_TYPES, type LearningStatus, type MemoryType } from './domain.js';

/**
 * manual: agents' proposals are ignored (memories come only from the user and explicit brain_store calls).
 * confirm: every proposal waits in the review queue.
 * categories: proposals of the authorised types are stored at once; the rest wait.
 */
export const LEARNING_MODES = ['manual', 'confirm', 'categories'] as const;
export type LearningMode = (typeof LEARNING_MODES)[number];

export const brainSettingsSchema = z.strictObject({
  learning: z.strictObject({
    mode: z.enum(LEARNING_MODES),
    categories: z.array(z.enum(MEMORY_TYPES)).max(MEMORY_TYPES.length),
  }),
  backup: z.strictObject({
    /** 0 turns automatic backups off. */
    intervalHours: z.number().int().min(0).max(24 * 30),
    /** Newest backups kept; older ones are deleted. */
    keep: z.number().int().min(1).max(100),
  }),
  retention: z.strictObject({
    /** Deleted memories are erased for good after this many days; 0 keeps them. */
    trashDays: z.number().int().min(0).max(3650),
    /** Finished tasks and their logs are erased after this many days; 0 keeps them. */
    taskDays: z.number().int().min(0).max(3650),
  }),
});
export type BrainSettings = z.infer<typeof brainSettingsSchema>;

export const DEFAULT_BRAIN_SETTINGS: BrainSettings = {
  learning: { mode: 'confirm', categories: [] },
  backup: { intervalHours: 24, keep: 7 },
  retention: { trashDays: 30, taskDays: 0 },
};

export interface LearningCandidate {
  id: string;
  taskId: string | null;
  projectId: string | null;
  projectName: string | null;
  agent: 'claude' | 'codex' | null;
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
  status: LearningStatus;
  reason: string | null;
  mergeTarget: { id: string; title: string } | null;
  memoryId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface BackupInfo {
  file: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  /** automatic, manual, or taken right before a restore. */
  kind: 'auto' | 'manual' | 'before-restore';
}

export interface RetentionResult {
  memoriesErased: number;
  tasksErased: number;
}

export interface ImportResult {
  imported: number;
  skipped: { title: string; reason: string }[];
}
