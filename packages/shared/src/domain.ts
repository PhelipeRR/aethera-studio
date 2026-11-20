// Domain vocabularies shared by the database, the brain, the MCP server and the UI.

export const MEMORY_TYPES = [
  'decision',
  'code_pattern',
  'project_context',
  'bug_fix',
  'learning',
  'preference',
  'documentation',
  'execution_summary',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const TRUST_STATES = ['unverified', 'reviewed', 'rejected'] as const;
export type Trust = (typeof TRUST_STATES)[number];

export const CONFIDENCE_STATES = ['unverified', 'reviewed', 'stale'] as const;
export type Confidence = (typeof CONFIDENCE_STATES)[number];

export const SOURCE_KINDS = ['user', 'claude', 'codex', 'mcp', 'extractor'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const EMBEDDING_STATES = ['pending', 'ready', 'failed'] as const;
export type EmbeddingState = (typeof EMBEDDING_STATES)[number];

export const TASK_STATUSES = [
  'pending',
  'planning',
  'running',
  'awaiting_approval',
  'validating',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AGENT_IDS = ['claude', 'codex', 'claude-gateway'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const RUN_MODES = ['auto', 'claude', 'codex', 'collab'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** Learning proposals: waiting for the user, stored, discarded, or held back because they contain a secret. */
export const LEARNING_STATUSES = ['pending', 'approved', 'rejected', 'blocked'] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];
