import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecapCheckpoint } from './recap-types.js';
import { recapCheckpointSchema } from './recap-types.js';

const CHECKPOINT_FILENAME = 'recap-checkpoint.json';

/**
 * Saves a checkpoint for the recap pipeline.
 * Creates the parent directory if it doesn't exist.
 */
export function saveCheckpoint(checkpointDir: string, checkpoint: RecapCheckpoint): void {
  if (!existsSync(checkpointDir)) {
    mkdirSync(checkpointDir, { recursive: true });
  }
  const filePath = join(checkpointDir, CHECKPOINT_FILENAME);
  const validated = recapCheckpointSchema.parse(checkpoint);
  writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');
}

/**
 * Loads a checkpoint from disk. Returns null if no checkpoint exists or validation fails.
 * Never throws — callers should treat missing/invalid checkpoints as "start fresh".
 */
export function loadCheckpoint(checkpointDir: string): RecapCheckpoint | null {
  const filePath = join(checkpointDir, CHECKPOINT_FILENAME);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return recapCheckpointSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}