import type { AgentId, RunMode, TaskStatus } from './domain.js';

export const STEP_KINDS = ['plan', 'implement', 'review', 'fix', 'validate'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Statuses after which a task no longer changes. */
export const FINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export interface TaskTokens {
  /** null when no step reported usage. */
  input: number | null;
  output: number | null;
  cached: number | null;
  /** Provider's API-equivalent price: an estimate on subscription plans. */
  costUsd: number | null;
}

export interface TaskSummary {
  id: string;
  prompt: string;
  projectId: string | null;
  projectName: string | null;
  mode: RunMode;
  status: TaskStatus;
  parentTaskId: string | null;
  /** First task of the conversation this one belongs to (itself when not a continuation). */
  threadId: string;
  /** Name the user gave the conversation; null shows its first request. */
  threadTitle: string | null;
  /** Model requested from the chosen CLI; null means the CLI default. */
  model: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  agents: AgentId[];
  tokens: TaskTokens;
  filesChanged: number;
  /** Images attached to the request; read them with tasks.image(id, index). */
  images: TaskImage[];
}

export interface TaskStep {
  id: string;
  position: number;
  agent: AgentId;
  kind: StepKind;
  status: TaskStatus;
  tokens: TaskTokens;
  filesChanged: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A stored event; data is the redacted payload without its kind. */
export interface TaskEvent {
  id: number;
  stepId: string | null;
  at: string;
  kind: string;
  data: Record<string, unknown>;
}

export interface TaskDetail extends TaskSummary {
  steps: TaskStep[];
  events: TaskEvent[];
  executionSnapshot: ExecutionSnapshot | null;
}

export interface TaskStartInput {
  prompt: string;
  projectId: string | null;
  mode: RunMode;
  /** Explicit execution boundary; reviews and suggestions must remain read-only. */
  access?: 'read-only' | 'edit' | undefined;
  /** Only for mode claude or codex; passed to the CLI as is. Omitted or null: the CLI default. */
  model?: string | null | undefined;
  /** Images to send with the request; the main process checks their real type and size. */
  images?: ImageUpload[] | undefined;
  /** Optional explicit skill ids selected with a /skill command in the Chat composer. */
  skillIds?: string[] | undefined;
  /** Projects of the workspace this task also concerns; they add context, not permissions. */
  participants?: string[] | undefined;
  /** Optional stable owner reference for Core-backed adapters; retries must reuse the same revision. */
  externalRef?: { system: string; id: string; revision: number } | undefined;
}

export const CONVERSATION_TITLE_MAX = 120;

/** Model names each CLI has reported in its sessions, or the user requested before. Never a guessed list. */
export type KnownModels = Record<AgentId, string[]>;

export interface TaskListFilter {
  status?: TaskStatus | undefined;
  projectId?: string | undefined;
  agent?: AgentId | undefined;
  query?: string | undefined;
  externalSystem?: string | undefined;
  limit?: number | undefined;
}

/** Pushed to the windows while tasks run: the task changed, fetch it again. */
export interface TaskChanged {
  taskId: string;
  status: TaskStatus | null;
}

/**
 * Durable execution state shared by the main process and recovery surfaces.
 *
 * Contract (enforced by TaskEngine and covered by engine-execution-contract tests):
 * - `attempt` counts entries into agent execution; it never moves backwards and is preserved by recovery.
 * - `approval` moves pending → approved | cancelled; an approve that arrives while no approval is pending is ignored.
 * - `cancellation` is `requested` as soon as the user cancels and `acknowledged` once the task has stopped.
 * - `checkpoint` is `paused` while a running task is paused; the phase keeps its last valid value.
 * - Resume never replays side effects in place: recovery marks an interrupted task `failed` with
 *   `recoveryAction: 'resume'`, and resuming starts a child task that continues the agent sessions.
 * - Evidence is written at most once per {@link ExecutionEventIdentity.sideEffectKey}.
 * - `correlationId` links the task to the IPC request that started it, its evidence and integration calls.
 */
export interface ExecutionSnapshot {
  taskId: string;
  phase: 'pending' | 'planning' | 'awaiting_approval' | 'executing' | 'validating' | 'completed' | 'failed' | 'cancelled';
  attempt: number;
  checkpoint: string | null;
  correlationId: string | null;
  approval: 'not-required' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  cancellation: 'none' | 'requested' | 'acknowledged';
  failureCategory: 'none' | 'timeout' | 'provider' | 'database' | 'filesystem' | 'permission' | 'configuration' | 'unknown';
  evidenceIds: string[];
  recoveryAction: 'none' | 'resume' | 'retry' | 'manual-review' | 'restore-backup';
  updatedAt: string;
}

/** Event identity used to make replay and duplicate side-effect handling explicit. */
export interface ExecutionEventIdentity {
  eventId: string;
  taskId: string;
  attempt: number;
  sideEffectKey: string | null;
}

/** Stable key for a side effect: the same identity always maps to the same key, so a replay is detectable. */
export function executionSideEffectKey(identity: Pick<ExecutionEventIdentity, 'taskId' | 'attempt' | 'eventId'> & { scope: string }): string {
  return `${identity.scope}:${identity.taskId}:${identity.attempt}:${identity.eventId}`;
}

/** One result of the security review of a task's changes (Phase 28). evidence never holds a secret. */
export interface GuardianFinding {
  rule: 'secret' | 'sensitive_file' | 'dangerous_code' | 'dangerous_command' | 'outside_project' | 'ci_change' | 'new_dependency' | 'large_change' | 'lockfile' | 'not_analyzed';
  severity: 'high' | 'medium' | 'low';
  file: string | null;
  line: number | null;
  message: string;
  evidence: string;
}

/** high: the task waits for the user's decision; medium and low only inform. */
export interface GuardianReport {
  risk: 'none' | 'low' | 'medium' | 'high';
  findings: GuardianFinding[];
  files: number;
  addedLines: number;
}

/** Tokens of one group (agent, step kind or project), as the providers reported them. */
export interface TokenBreakdown {
  key: string;
  label: string;
  input: number;
  output: number;
  cached: number;
  steps: number;
}

/** A rule over the reported numbers that deserves attention (Phase 22), with what to do about it. */
export interface TokenAlert {
  kind: 'budget' | 'context' | 'repeated' | 'review_loop' | 'cache' | 'missing';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  recommendation: string;
  taskIds: string[];
}

/**
 * Token diagnostics for a period. input/output/cached are provider-reported (real); estimatedContext is
 * NeuralBridge's own estimate of the context it added; tasks without reported usage are counted apart.
 */
export interface TokenReport {
  since: string;
  generatedAt: string;
  totals: { input: number; output: number; cached: number; estimatedContext: number; tasks: number; tasksWithData: number; tasksWithoutData: number };
  /** cached / input, when anything was reported. */
  cacheRate: number | null;
  byAgent: TokenBreakdown[];
  byStep: TokenBreakdown[];
  byProject: TokenBreakdown[];
  alerts: TokenAlert[];
}

/** Image types the chat accepts, by their real content (never SVG, which can carry script); value: file extension. */
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
export type ImageMime = keyof typeof IMAGE_TYPES;
/** Per image: the Claude API's own limit for an image block. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGES_PER_MESSAGE = 6;

/** An image the user attached to a request, as the screens see it (the file stays in the main process). */
export interface TaskImage {
  name: string;
  mime: ImageMime;
  size: number;
}

/** An image as the renderer sends it with a request. */
export interface ImageUpload {
  name: string;
  data: Uint8Array;
}

/** Types Windows runs instead of showing when opened; such outputs are only revealed in their folder. */
const RUNS_WHEN_OPENED = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|cpl|hta|lnk|url|reg|jar|msc|appref-ms|application|gadget|inf|scf|sct|ws|vb)$/i;

/** Whether a run's output file may be opened with its default app (files without an extension may not). */
export function canOpenOutput(path: string): boolean {
  return /\.[^\\/.]+$/.test(path) && !RUNS_WHEN_OPENED.test(path);
}

/** Fenced block in which agents return what is worth remembering (decision A9), at no extra request. */
export const LEARNINGS_FENCE = 'neuralbridge-learnings';
const LEARNINGS_BLOCK = /\n?```neuralbridge-learnings[^\n]*\n([\s\S]*?)(?:```|$)/g;

/** Separates the learnings block from an agent's answer; a malformed block yields no proposals. */
export function splitLearnings(text: string): { text: string; proposals: unknown[] } {
  const proposals: unknown[] = [];
  for (const match of text.matchAll(LEARNINGS_BLOCK)) {
    try {
      const value: unknown = JSON.parse(match[1] ?? '');
      if (Array.isArray(value)) proposals.push(...value);
    } catch {
      // Not JSON: nothing to propose, but the block is still hidden.
    }
  }
  return { text: text.replace(LEARNINGS_BLOCK, '').trimEnd(), proposals };
}
