import { sql, type SQL } from 'drizzle-orm';
import { type AnySQLiteColumn, blob, check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  AGENT_IDS,
  EMBEDDING_STATES,
  LEARNING_STATUSES,
  MEMORY_TYPES,
  RUN_MODES,
  SOURCE_KINDS,
  TASK_STATUSES,
  TRUST_STATES,
} from '@neuralbridge/shared/domain';

// ISO-8601 UTC with milliseconds, so text ordering matches time ordering.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text('created_at').notNull().default(now);
const updatedAt = () => text('updated_at').notNull().default(now);

function oneOf(column: string, values: readonly string[]): SQL {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(', ')})`);
}

/** A Git repository once, however many registered projects live in it. */
export const gitRepositories = sqliteTable('git_repositories', {
  id: text('id').primaryKey(),
  gitRoot: text('git_root').notNull().unique(),
  kind: text('kind', { enum: ['repository', 'worktree', 'submodule'] }).notNull().default('repository'),
  lastVerifiedAt: text('last_verified_at'),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull().unique(),
  /** Private projects are visible only to callers scoped to that project. */
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  /** Agent the router prefers for this project; 'auto' lets the router decide. */
  preferredAgent: text('preferred_agent', { enum: ['auto', 'claude', 'codex'] }).notNull().default('auto'),
  /** What agents may do in edit runs; see PERMISSION_LEVELS. 'full' only by the user's explicit choice. */
  permissionLevel: text('permission_level', { enum: ['standard', 'commands', 'full'] }).notNull().default('standard'),
  /** JSON array of command prefixes Claude may run at the 'commands' level. */
  allowedCommands: text('allowed_commands').notNull().default('[]'),
  /** Project rules in Markdown, given to agents with every task in this project. */
  rules: text('rules').notNull().default(''),
  /** JSON StackInfo from the last detection. */
  stack: text('stack'),
  detectedAt: text('detected_at'),
  /** 'workspace' only groups other projects. The four types the UI shows derive from this and the parent. */
  kind: text('kind', { enum: ['project', 'workspace'] }).notNull().default('project'),
  parentProjectId: text('parent_project_id').references((): AnySQLiteColumn => projects.id, { onDelete: 'set null' }),
  detectionConfidence: integer('detection_confidence'),
  /** JSON evidence that led to the classification. */
  detectionEvidence: text('detection_evidence'),
  detectionSource: text('detection_source', { enum: ['manual', 'scan', 'migration'] }).notNull().default('manual'),
  gitRepositoryId: text('git_repository_id').references(() => gitRepositories.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Conversations imported from local agent history. Kept separate from NeuralBridge tasks. */
export const importedConversations = sqliteTable(
  'imported_conversations',
  {
    id: text('id').primaryKey(),
    agent: text('agent', { enum: ['claude', 'codex'] }).notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    sourcePath: text('source_path').notNull(),
    sourceHash: text('source_hash').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    projectPath: text('project_path'),
    association: text('association', { enum: ['associated', 'unassociated'] }).notNull().default('unassociated'),
    updatedAt: text('updated_at'),
    importedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('imported_conversations_agent_external').on(t.agent, t.externalId),
    index('imported_conversations_project_idx').on(t.projectId, t.updatedAt),
  ],
);

export const memories = sqliteTable(
  'memories',
  {
    /** Stable integer rowid: the FTS index is keyed on it, and VACUUM may renumber implicit rowids. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    type: text('type', { enum: MEMORY_TYPES }).notNull(),
    /** null = global memory, visible from every project. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    trust: text('trust', { enum: TRUST_STATES }).notNull().default('unverified'),
    confidence: text('confidence', { enum: ['unverified', 'reviewed', 'stale'] }).notNull().default('unverified'),
    sourceKind: text('source_kind', { enum: SOURCE_KINDS }).notNull(),
    sourceRef: text('source_ref'),
    version: integer('version').notNull().default(1),
    embeddingStatus: text('embedding_status', { enum: EMBEDDING_STATES }).notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete; hard delete removes the row. */
    deletedAt: text('deleted_at'),
  },
  (t) => [
    check('memories_type_check', oneOf('type', MEMORY_TYPES)),
    check('memories_trust_check', oneOf('trust', TRUST_STATES)),
    check('memories_source_kind_check', oneOf('source_kind', SOURCE_KINDS)),
    check('memories_embedding_status_check', oneOf('embedding_status', EMBEDDING_STATES)),
    // memories_live_title_unique (one live title per project, case-insensitive) is created in a hand-written
    // migration: drizzle-kit 0.31 splits multi-argument expressions such as coalesce(a, b) into invalid SQL.
    index('memories_project_idx').on(t.projectId, t.updatedAt),
    index('memories_embedding_status_idx').on(t.embeddingStatus),
  ],
);

export const memoryVersions = sqliteTable(
  'memory_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    type: text('type', { enum: MEMORY_TYPES }).notNull(),
    /** JSON array of tag names at that version. */
    tags: text('tags').notNull(),
    changedBy: text('changed_by', { enum: SOURCE_KINDS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memory_versions_unique').on(t.memoryId, t.version)],
);

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Stored normalised (lower case, trimmed). */
  name: text('name').notNull().unique(),
});

export const memoryTags = sqliteTable(
  'memory_tags',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.tagId] }), index('memory_tags_tag_idx').on(t.tagId)],
);

export const links = sqliteTable(
  'links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    /** null while the target title does not resolve to a memory (a pending node in the graph). */
    targetId: text('target_id').references(() => memories.id, { onDelete: 'set null' }),
    targetTitle: text('target_title').notNull(),
    relation: text('relation').notNull().default('references'),
    origin: text('origin', { enum: ['wikilink', 'explicit'] }).notNull().default('wikilink'),
    createdAt: createdAt(),
  },
  (t) => [
    check('links_origin_check', oneOf('origin', ['wikilink', 'explicit'])),
    uniqueIndex('links_unique').on(t.sourceId, sql`lower(${t.targetTitle})`, t.relation),
    index('links_target_idx').on(t.targetId),
    index('links_pending_idx').on(sql`lower(${t.targetTitle})`).where(sql`${t.targetId} IS NULL`),
  ],
);

export const embeddings = sqliteTable('embeddings', {
  memoryId: text('memory_id')
    .primaryKey()
    .references(() => memories.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  /** Float32Array bytes, little endian. */
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  /** Hash of the text that was embedded, to detect stale vectors. */
  contentHash: text('content_hash').notNull(),
  createdAt: createdAt(),
});

/** Evidence a memory was derived from: files, URLs, task runs. Distinct from the memory's origin (source_kind). */
/** Latest technical profile of a project (Phase 21): JSON ProjectProfile, rebuilt on request. */
export const projectProfiles = sqliteTable('project_profiles', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  profile: text('profile').notNull(),
  generatedAt: text('generated_at').notNull(),
});

/** Versioned, validated workflow definitions. Runtime executions continue to use tasks. */
export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    definition: text('definition').notNull(),
    layout: text('layout'),
    templateId: text('template_id'),
    templateVersion: integer('template_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('workflows_project_idx').on(t.projectId, t.updatedAt)],
);

export const workflowTemplates = sqliteTable('workflow_templates', {
  id: text('id').primaryKey(), version: integer('version').notNull(), name: text('name').notNull(), category: text('category').notNull(), description: text('description').notNull(), requirements: text('requirements').notNull(), definition: text('definition').notNull(), source: text('source').notNull().default('builtin'), createdAt: createdAt(),
});
export const workflowTemplateFavorites = sqliteTable('workflow_template_favorites', {
  templateId: text('template_id').notNull().references(() => workflowTemplates.id, { onDelete: 'cascade' }), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.templateId] })]);

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'running', 'waiting_approval', 'paused', 'retrying', 'interrupted', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
    approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
    currentLayer: integer('current_layer').notNull().default(0),
    taskIds: text('task_ids').notNull().default('[]'),
    error: text('error'),
    definitionSnapshot: text('definition_snapshot'),
    definitionVersion: integer('definition_version'),
    inputs: text('inputs').notNull().default('{}'),
    trigger: text('trigger'),
    recoveryState: text('recovery_state'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('workflow_runs_workflow_idx').on(t.workflowId, t.updatedAt), index('workflow_runs_status_idx').on(t.status)],
);

export const workflowRunSteps = sqliteTable('workflow_run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull(),
  status: text('status').notNull(),
  taskId: text('task_id'),
  output: text('output'),
  error: text('error'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: createdAt(),
}, (t) => [index('workflow_run_steps_run_idx').on(t.runId, t.createdAt)]);

export const videoProjects = sqliteTable('video_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const workflowCheckpoints = sqliteTable('workflow_checkpoints', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }), workflowId: text('workflow_id').notNull(), definitionVersion: integer('definition_version').notNull(), sequence: integer('sequence').notNull(), completed: text('completed').notNull(), pending: text('pending').notNull(), artifacts: text('artifacts').notNull().default('[]'), provider: text('provider'), approvalState: text('approval_state'), recoveryMeta: text('recovery_meta').notNull().default('{}'), createdAt: createdAt(),
});
export const workflowStepAttempts = sqliteTable('workflow_step_attempts', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }), stepId: text('step_id').notNull(), attempt: integer('attempt').notNull(), provider: text('provider'), taskId: text('task_id'), failureKind: text('failure_kind'), delayMs: integer('delay_ms'), decision: text('decision'), reason: text('reason'), startedAt: text('started_at'), finishedAt: text('finished_at'),
}, (t) => [index('workflow_step_attempts_run_idx').on(t.runId, t.stepId, t.attempt)]);

/** A task paused because no agent has capacity. Tasks keep the 'paused' status: this row says why and until when. */
export const taskCapacityWaits = sqliteTable('task_capacity_waits', {
  taskId: text('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['waiting', 'resumed', 'cancelled'] }).notNull().default('waiting'),
  agents: text('agents').notNull().default('[]'),
  retryAt: text('retry_at'),
  autoResume: integer('auto_resume', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('task_capacity_waits_status_idx').on(t.status)]);

/** What the person decided about a folder. Auxiliary folders are not projects, so this cannot live in `projects`. */
export const projectDiscoveryOverrides = sqliteTable('project_discovery_overrides', {
  path: text('path').primaryKey(),
  classification: text('classification').notNull(),
  parentPath: text('parent_path'),
  createdAt: createdAt(),
});

export const autonomousMissions = sqliteTable('autonomous_missions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('running'),
  acceptance: text('acceptance').notNull(),
  maxAttempts: integer('max_attempts').notNull().default(3),
  maxDurationMs: integer('max_duration_ms').notNull(),
  maxCostUsd: real('max_cost_usd').notNull().default(0),
  startedAt: text('started_at').notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const autonomousMissionTasks = sqliteTable('autonomous_mission_tasks', {
  id: text('id').primaryKey(),
  missionId: text('mission_id').notNull().references(() => autonomousMissions.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  dependsOn: text('depends_on').notNull().default('[]'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  taskId: text('task_id'),
  acceptance: text('acceptance').notNull(),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('autonomous_mission_tasks_mission_idx').on(t.missionId, t.status)]);

export const gitAutomations = sqliteTable('git_automations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  concurrencyLimit: integer('concurrency_limit').notNull().default(1),
  hourlyLimit: integer('hourly_limit').notNull().default(20),
  failureBreaker: integer('failure_breaker').notNull().default(5),
  createdAt: createdAt(),
});

export const gitAutomationEvents = sqliteTable('git_automation_events', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => gitAutomations.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull(),
  kind: text('kind').notNull(),
  ref: text('ref'),
  commitHash: text('commit_hash'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  runId: text('run_id'),
  status: text('status').notNull(),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const gitRefCursors = sqliteTable('git_ref_cursors', {
  automationId: text('automation_id').notNull().references(() => gitAutomations.id, { onDelete: 'cascade' }),
  ref: text('ref').notNull(),
  commitHash: text('commit_hash'),
  statusHash: text('status_hash'),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.automationId, t.ref] })]);

export const videoCompositions = sqliteTable('video_compositions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  composition: text('composition').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('video_compositions_project_idx').on(t.projectId, t.updatedAt)]);

export const memorySources = sqliteTable(
  'memory_sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['file', 'url', 'task', 'conversation'] }).notNull(),
    ref: text('ref').notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('memory_sources_kind_check', oneOf('kind', ['file', 'url', 'task', 'conversation'])), index('memory_sources_memory_idx').on(t.memoryId)],
);

export const accessLog = sqliteTable(
  'access_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    /** electron | mcp:<client name> */
    client: text('client').notNull(),
    action: text('action', { enum: ['recall', 'search_hit', 'context', 'update'] }).notNull(),
    at: text('at').notNull().default(now),
  },
  (t) => [index('access_log_memory_idx').on(t.memoryId, t.at)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    prompt: text('prompt').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    mode: text('mode', { enum: RUN_MODES }).notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('pending'),
    /** Whether this run belongs to the user's workspace or is an internal assistant exchange. */
    origin: text('origin', { enum: ['user', 'neura'] }).notNull().default('user'),
    /** Task this one continues, when resumed from a previous run. */
    parentTaskId: text('parent_task_id'),
    /** Name the user gave the conversation (on its first task); null shows the first request. */
    title: text('title'),
    /** Model requested from an explicitly chosen agent; null lets the CLI use its configured default. */
    model: text('model'),
    /** JSON array of the images attached to the request: { path, name, mime, size } in the app's attachments folder. */
    images: text('images').notNull().default('[]'),
    summary: text('summary'),
    error: text('error'),
    createdAt: createdAt(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    /** CORE-04: the executor holding this task's lease; only it may run steps until lease_expires_at. */
    ownerInstanceId: text('owner_instance_id'),
    leaseExpiresAt: text('lease_expires_at'),
    /** CORE-04: correlation with a task in another system (orchestrator); system + id is unique. */
    externalSystem: text('external_system'),
    externalId: text('external_id'),
    externalRevision: integer('external_revision'),
    /** CORE-05: the boundary the task was asked with; null (older rows) means edit, the engine's default. */
    access: text('access', { enum: ['read-only', 'edit'] }),
  },
  (t) => [
    check('tasks_mode_check', oneOf('mode', RUN_MODES)),
    check('tasks_status_check', oneOf('status', TASK_STATUSES)),
    index('tasks_status_idx').on(t.status),
    index('tasks_project_idx').on(t.projectId, t.createdAt),
    uniqueIndex('tasks_external_ref_idx').on(t.externalSystem, t.externalId).where(sql`${t.externalSystem} IS NOT NULL`),
  ],
);

/** CORE-04: remembered results of state-changing API requests, by Idempotency-Key (CORE-02 C2-5). */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    state: text('state', { enum: ['in_progress', 'completed'] }).notNull().default('in_progress'),
    statusCode: integer('status_code'),
    response: text('response'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_keys_expiry_idx').on(t.expiresAt)],
);

export const taskSteps = sqliteTable(
  'task_steps',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    agent: text('agent', { enum: AGENT_IDS }).notNull(),
    kind: text('kind', { enum: ['plan', 'implement', 'review', 'fix', 'validate'] }).notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('pending'),
    /** CLI session id, used to resume the conversation. */
    sessionId: text('session_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedTokens: integer('cached_tokens'),
    /** Provider-reported API-equivalent cost; null when unavailable. */
    costUsd: real('cost_usd'),
    /** JSON array of relative paths. */
    filesChanged: text('files_changed'),
    error: text('error'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [
    check('task_steps_agent_check', oneOf('agent', AGENT_IDS)),
    check('task_steps_status_check', oneOf('status', TASK_STATUSES)),
    uniqueIndex('task_steps_position_unique').on(t.taskId, t.position),
  ],
);

export const taskEvents = sqliteTable(
  'task_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    stepId: text('step_id').references(() => taskSteps.id, { onDelete: 'cascade' }),
    at: text('at').notNull().default(now),
    kind: text('kind').notNull(),
    /** JSON payload, already redacted. */
    data: text('data').notNull(),
  },
  (t) => [index('task_events_task_idx').on(t.taskId, t.id)],
);

export const executionSnapshots = sqliteTable('execution_snapshots', {
  taskId: text('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(), attempt: integer('attempt').notNull().default(0), checkpoint: text('checkpoint'),
  approval: text('approval').notNull().default('not-required'), cancellation: text('cancellation').notNull().default('none'),
  failureCategory: text('failure_category').notNull().default('none'), evidenceIds: text('evidence_ids').notNull().default('[]'),
  recoveryAction: text('recovery_action').notNull().default('none'), updatedAt: text('updated_at').notNull(),
  correlationId: text('correlation_id'),
});
export const taskEvidence = sqliteTable('task_evidence', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(), correlationId: text('correlation_id').notNull(), payload: text('payload').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('task_evidence_task_idx').on(t.taskId, t.createdAt)]);

export const extensions = sqliteTable('extensions', {
  id: text('id').primaryKey(), manifest: text('manifest').notNull(), state: text('state').notNull().default('enabled'),
  installedAt: text('installed_at').notNull(), updatedAt: text('updated_at').notNull(), previousManifest: text('previous_manifest'),
}, (t) => [index('extensions_state_idx').on(t.state, t.updatedAt)]);

/** Persisted Companion projection; execution truth remains in tasks/task_steps/task_events. */
export const companionSessions = sqliteTable(
  'companion_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    agent: text('agent').notNull(),
    providerSessionId: text('provider_session_id'),
    status: text('status').notNull(),
    connection: text('connection').notNull(),
    startedAt: text('started_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastSequence: integer('last_sequence').notNull().default(-1),
    endedAt: text('ended_at'),
  },
  (t) => [index('companion_sessions_task_idx').on(t.taskId, t.updatedAt), index('companion_sessions_project_idx').on(t.projectId, t.updatedAt)],
);

export const companionEvents = sqliteTable(
  'companion_events',
  {
    eventId: text('event_id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => companionSessions.sessionId, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    sequence: integer('sequence').notNull(),
    occurredAt: text('occurred_at').notNull(),
    receivedAt: text('received_at').notNull(),
    kind: text('kind').notNull(),
    data: text('data').notNull(),
  },
  (t) => [uniqueIndex('companion_events_session_sequence_unique').on(t.sessionId, t.sequence), index('companion_events_task_idx').on(t.taskId, t.receivedAt)],
);

/** Persisted separation between provider-reported usage and NeuralBridge context estimates. */
export const tokenAnalytics = sqliteTable(
  'token_analytics',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    stepId: text('step_id').references(() => taskSteps.id, { onDelete: 'cascade' }),
    agent: text('agent', { enum: AGENT_IDS }),
    estimatedContextTokens: integer('estimated_context_tokens'),
    reportedInputTokens: integer('reported_input_tokens'),
    reportedOutputTokens: integer('reported_output_tokens'),
    cachedTokens: integer('cached_tokens'),
    costUsd: real('cost_usd'),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('token_analytics_task_idx').on(t.taskId, t.id)],
);

/** What an agent proposed to remember at the end of a task (decision A9), before or after review. */
export const learningCandidates = sqliteTable(
  'learning_candidates',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    agent: text('agent', { enum: AGENT_IDS }),
    title: text('title').notNull(),
    /** Secrets are masked before a blocked proposal is stored. */
    content: text('content').notNull(),
    type: text('type', { enum: MEMORY_TYPES }).notNull(),
    /** JSON array of tag names. */
    tags: text('tags').notNull().default('[]'),
    status: text('status', { enum: LEARNING_STATUSES }).notNull().default('pending'),
    /** Why it waits or was blocked, in plain language. */
    reason: text('reason'),
    /** Existing memory this looks like: approving merges into it. */
    mergeTargetId: text('merge_target_id'),
    /** The memory created or updated on approval. */
    memoryId: text('memory_id'),
    createdAt: createdAt(),
    decidedAt: text('decided_at'),
  },
  (t) => [
    check('learning_candidates_status_check', oneOf('status', LEARNING_STATUSES)),
    check('learning_candidates_type_check', oneOf('type', MEMORY_TYPES)),
    index('learning_candidates_status_idx').on(t.status, t.createdAt),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON-encoded value. */
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

export const videoRenderJobs = sqliteTable('video_render_jobs', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
  error: text('error'),
  origin: text('origin').notNull().default('studio'),
  agent: text('agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('video_render_jobs_status_idx').on(t.status, t.updatedAt)]);

export const videoAssets = sqliteTable('video_assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  kind: text('kind', { enum: ['image', 'audio', 'video', 'font'] }).notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: createdAt(),
}, (t) => [index('video_assets_project_idx').on(t.projectId, t.path)]);

export const velixDiscoverySearches = sqliteTable('velix_discovery_searches', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }),
  niche: text('niche').notNull(), query: text('query').notNull(), provider: text('provider').notNull(), status: text('status').notNull(), filters: text('filters'), cacheKey: text('cache_key'), results: text('results'), nextPageToken: text('next_page_token'), expiresAt: text('expires_at'), createdAt: createdAt(),
}, (t) => [index('velix_discovery_searches_project_idx').on(t.projectId, t.createdAt)]);

export const velixMediaReferences = sqliteTable('velix_media_references', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), searchId: text('search_id').references(() => velixDiscoverySearches.id, { onDelete: 'set null' }),
  url: text('url').notNull(), kind: text('kind').notNull(), title: text('title').notNull(), publisher: text('publisher').notNull(), publishedAt: text('published_at'), language: text('language'), reviewStatus: text('review_status').notNull().default('approved'), ideaId: text('idea_id'), agent: text('agent'), executionId: text('execution_id'), retrievedAt: text('retrieved_at').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_media_references_project_idx').on(t.projectId, t.createdAt)]);

export const velixMediaRights = sqliteTable('velix_media_rights', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), referenceId: text('reference_id').notNull().references(() => velixMediaReferences.id, { onDelete: 'cascade' }), owner: text('owner').notNull(), sourceUrl: text('source_url').notNull(), license: text('license').notNull(), evidence: text('evidence'), verifiedAt: text('verified_at'), credit: text('credit'), restrictions: text('restrictions').notNull().default('[]'), status: text('status').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_media_rights_reference_idx').on(t.referenceId)]);

export const velixClipSuggestions = sqliteTable('velix_clip_suggestions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), referenceId: text('reference_id').notNull().references(() => velixMediaReferences.id, { onDelete: 'cascade' }), start: real('start').notNull(), end: real('end').notNull(), confidence: real('confidence').notNull(), criteria: text('criteria').notNull().default('[]'), accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false), favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false), orderIndex: integer('order_index').notNull().default(0), createdAt: createdAt(),
}, (t) => [index('velix_clip_suggestions_project_idx').on(t.projectId, t.createdAt)]);

export const velixLocalAssets = sqliteTable('velix_local_assets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), path: text('path').notNull(), bytes: integer('bytes').notNull(), sha256: text('sha256').notNull(), rightsStatus: text('rights_status').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_local_assets_project_idx').on(t.projectId, t.createdAt)]);

export const velixMediaAnalyses = sqliteTable('velix_media_analyses', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), assetId: text('asset_id').notNull().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), metadata: text('metadata').notNull(), sceneCuts: text('scene_cuts').notNull(), silences: text('silences').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_media_analyses_asset_idx').on(t.assetId)]);

export const velixMotionProjects = sqliteTable('velix_motion_projects', {
  projectId: text('project_id').primaryKey().references(() => videoProjects.id, { onDelete: 'cascade' }), data: text('data').notNull(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
export const velixMotionJobs = sqliteTable('velix_motion_jobs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), editorialVersionId: text('editorial_version_id').notNull(), scriptHash: text('script_hash'), compositionHash: text('composition_hash'), status: text('status').notNull(), outputPath: text('output_path'), error: text('error'), createdAt: createdAt(),
}, (t) => [index('velix_motion_jobs_project_idx').on(t.projectId, t.createdAt)]);

export const velixProductionIdeas = sqliteTable('velix_production_ideas', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), mode: text('mode').notNull(), topic: text('topic').notNull(), style: text('style').notNull(), status: text('status').notNull().default('draft'), payload: text('payload'), agent: text('agent'), model: text('model'), executionId: text('execution_id'), generatedAt: text('generated_at'), createdAt: createdAt(),
});
export const velixCollageJobs = sqliteTable('velix_collage_jobs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), prompt: text('prompt').notNull(), aspectRatio: text('aspect_ratio').notNull(), durationSeconds: real('duration_seconds').notNull(), status: text('status').notNull(), metaphor: text('metaphor'), stillPath: text('still_path'), clipPath: text('clip_path'), rightsReferenceId: text('rights_reference_id'), estimatedCostUsd: real('estimated_cost_usd').notNull(), error: text('error'), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_collage_jobs_project_idx').on(t.projectId, t.createdAt)]);
export const velixEditorialVersions = sqliteTable('velix_editorial_versions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), ideaId: text('idea_id').references(() => velixProductionIdeas.id, { onDelete: 'set null' }), sourceVersionId: text('source_version_id'), kind: text('kind').notNull(), version: integer('version').notNull(), content: text('content').notNull(), approved: integer('approved', { mode: 'boolean' }).notNull().default(false), agent: text('agent', { enum: ['claude', 'codex'] }), model: text('model'), executionId: text('execution_id'), generatedAt: text('generated_at'), createdAt: createdAt(),
});
export const velixEditorialDecisions = sqliteTable('velix_editorial_decisions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), versionId: text('version_id').notNull().references(() => velixEditorialVersions.id, { onDelete: 'cascade' }), decision: text('decision').notNull(), note: text('note'), createdAt: createdAt(),
});
export const velixBrandIdentities = sqliteTable('velix_brand_identities', {
  projectId: text('project_id').primaryKey().references(() => videoProjects.id, { onDelete: 'cascade' }), data: text('data').notNull(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
export const velixPublications = sqliteTable('velix_publications', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), status: text('status').notNull(), youtubeVideoId: text('youtube_video_id'), publishAt: text('publish_at'), data: text('data').notNull(), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_publications_project_date_idx').on(t.projectId, t.publishAt)]);
export const velixPublicationJobs = sqliteTable('velix_publication_jobs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), publicationId: text('publication_id').notNull(), status: text('status').notNull(), progress: integer('progress').notNull().default(0), error: text('error'), checkpoint: text('checkpoint'), checkpointOffset: integer('checkpoint_offset'), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_publication_jobs_project_status_idx').on(t.projectId, t.status, t.updatedAt)]);
export const velixAgendaItems = sqliteTable('velix_agenda_items', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), data: text('data').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_agenda_items_project_date_idx').on(t.projectId, t.createdAt)]);
export const velixNicheReferences = sqliteTable('velix_niche_references', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), data: text('data').notNull(), createdAt: createdAt(),
}, (t) => [index('velix_niche_references_project_idx').on(t.projectId, t.createdAt)]);

export const velixProductionRuns = sqliteTable('velix_production_runs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), brief: text('brief').notNull(), contractVersion: integer('contract_version').notNull().default(1), status: text('status').notNull(), agent: text('agent', { enum: ['claude', 'codex'] }), estimatedCostUsd: real('estimated_cost_usd').notNull().default(0), actualCostUsd: real('actual_cost_usd').notNull().default(0), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_production_runs_project_idx').on(t.projectId, t.createdAt)]);
export const velixProductionStages = sqliteTable('velix_production_stages', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), kind: text('kind').notNull(), status: text('status').notNull(), inputHash: text('input_hash').notNull(), outputArtifactIds: text('output_artifact_ids').notNull().default('[]'), progress: real('progress').notNull().default(0), retryCount: integer('retry_count').notNull().default(0), costEstimateUsd: real('cost_estimate_usd').notNull().default(0), actualCostUsd: real('actual_cost_usd').notNull().default(0), checkpoint: text('checkpoint').notNull().default('{}'), error: text('error'), taskId: text('task_id'), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_production_stages_run_idx').on(t.runId, t.createdAt)]);
export const velixProductionArtifacts = sqliteTable('velix_production_artifacts', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), stageId: text('stage_id').notNull().references(() => velixProductionStages.id, { onDelete: 'cascade' }), kind: text('kind').notNull(), relativePath: text('relative_path'), contentHash: text('content_hash').notNull(), mime: text('mime'), metadata: text('metadata').notNull().default('{}'), createdAt: createdAt(),
}, (t) => [index('velix_production_artifacts_run_idx').on(t.runId, t.createdAt)]);
export const velixProductionBudgets = sqliteTable('velix_production_budgets', {
  runId: text('run_id').primaryKey().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), currency: text('currency').notNull().default('USD'), limitUsd: real('limit_usd').notNull(), reserveUsd: real('reserve_usd').notNull().default(0), consumedUsd: real('consumed_usd').notNull().default(0), policy: text('policy').notNull().default('approval_required'), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
export const velixProductionApprovals = sqliteTable('velix_production_approvals', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), stageId: text('stage_id'), decision: text('decision').notNull(), note: text('note'), gate: text('gate'), version: text('version'), createdAt: createdAt(),
}, (t) => [index('velix_production_approvals_run_idx').on(t.runId, t.createdAt)]);
export const velixQualityReports = sqliteTable('velix_quality_reports', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), stageId: text('stage_id'), blocking: integer('blocking', { mode: 'boolean' }).notNull().default(true), checks: text('checks').notNull().default('[]'), exportable: integer('exportable', { mode: 'boolean' }).notNull().default(false), createdAt: createdAt(),
}, (t) => [index('velix_quality_reports_run_idx').on(t.runId, t.createdAt)]);
export const velixEditorialClaims = sqliteTable('velix_editorial_claims', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), stageId: text('stage_id').references(() => velixProductionStages.id, { onDelete: 'set null' }), chapter: integer('chapter'), segmentHash: text('segment_hash').notNull(), text: text('text').notNull(), textHash: text('text_hash').notNull(), kind: text('kind').notNull(), kindSource: text('kind_source').notNull().default('agent'), confidence: real('confidence').notNull().default(0), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('velix_editorial_claims_run_text_idx').on(t.runId, t.textHash)]);
export const velixClaimEvidence = sqliteTable('velix_claim_evidence', {
  id: text('id').primaryKey(), claimId: text('claim_id').notNull().references(() => velixEditorialClaims.id, { onDelete: 'cascade' }), referenceId: text('reference_id').references(() => velixMediaReferences.id, { onDelete: 'set null' }), url: text('url').notNull(), title: text('title').notNull().default(''), publisher: text('publisher').notNull().default(''), publishedAt: text('published_at'), excerpt: text('excerpt').notNull().default(''), confidence: real('confidence').notNull().default(0), classification: text('classification').notNull(), status: text('status').notNull().default('candidate'), note: text('note'), decidedAt: text('decided_at'), createdAt: createdAt(),
}, (t) => [uniqueIndex('velix_claim_evidence_claim_url_idx').on(t.claimId, t.url)]);
export const velixResearchCache = sqliteTable('velix_research_cache', {
  projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), segmentHash: text('segment_hash').notNull(), sourcesHash: text('sources_hash').notNull(), answer: text('answer').notNull(), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.projectId, t.segmentHash, t.sourcesHash] })]);
export const velixStoryboards = sqliteTable('velix_storyboards', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), version: integer('version').notNull(), content: text('content').notNull(), source: text('source').notNull(), edit: text('edit'), createdAt: createdAt(),
}, (t) => [uniqueIndex('velix_storyboards_run_version_idx').on(t.runId, t.version)]);
export const velixDerivatives = sqliteTable('velix_derivatives', {
  id: text('id').primaryKey(), parentRunId: text('parent_run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), childRunId: text('child_run_id').references(() => velixProductionRuns.id, { onDelete: 'set null' }), storyboardVersion: integer('storyboard_version').notNull(), formatId: text('format_id').notNull(), sceneIds: text('scene_ids').notNull(), startMs: integer('start_ms').notNull(), endMs: integer('end_ms').notNull(), title: text('title').notNull(), score: real('score').notNull(), reason: text('reason').notNull(), claimIds: text('claim_ids').notNull().default('[]'), status: text('status').notNull().default('candidate'), createdAt: createdAt(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('velix_derivatives_parent_idx').on(t.parentRunId, t.startMs)]);

export const azureDevOpsConnections = sqliteTable('azure_devops_connections', {
  id: text('id').primaryKey(), baseUrl: text('base_url').notNull(), collection: text('collection').notNull(), project: text('project').notNull(), status: text('status').notNull().default('disconnected'), readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(true), capabilities: text('capabilities').notNull().default('{}'), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('azure_devops_connections_origin_idx').on(t.baseUrl, t.collection, t.project)]);
export const azureDevOpsCache = sqliteTable('azure_devops_cache', {
  connectionId: text('connection_id').notNull().references(() => azureDevOpsConnections.id, { onDelete: 'cascade' }), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), payload: text('payload').notNull(), fetchedAt: text('fetched_at').notNull(),
}, (t) => [primaryKey({ columns: [t.connectionId, t.entityType, t.entityId] }), index('azure_devops_cache_type_idx').on(t.connectionId, t.entityType, t.fetchedAt)]);
/** The style of each video (Fase 48); `video_name` '' holds the project default. No row means the Dossiê, as before. */
export const velixVideoStyles = sqliteTable('velix_video_styles', {
  projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), videoName: text('video_name').notNull().default(''), data: text('data').notNull(), updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [primaryKey({ columns: [t.projectId, t.videoName] })]);

/** Durable Neura runtime state; raw audio is intentionally not persisted here. */
export const neuraSessions = sqliteTable('neura_sessions', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['voice', 'meeting', 'general'] }).notNull(),
  status: text('status', { enum: ['idle', 'listening', 'processing', 'paused', 'completed', 'failed'] }).notNull(),
  consent: integer('consent', { mode: 'boolean' }).notNull().default(false),
  meetingLanguage: text('meeting_language'),
  userPreferredLanguage: text('user_preferred_language'),
  startedAt: text('started_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  endedAt: text('ended_at'),
}, (t) => [index('neura_sessions_status_idx').on(t.status, t.updatedAt)]);

export const neuraSuggestions = sqliteTable('neura_suggestions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => neuraSessions.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  language: text('language').notNull(),
  sourceExcerpt: text('source_excerpt'),
  decision: text('decision'),
  confidence: real('confidence').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'edited', 'copied', 'spoken', 'dismissed', 'expired'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
}, (t) => [index('neura_suggestions_session_idx').on(t.sessionId, t.createdAt), index('neura_suggestions_status_idx').on(t.status, t.createdAt)]);

export const neuraActionAudits = sqliteTable('neura_action_audits', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => neuraSessions.id, { onDelete: 'set null' }),
  actionType: text('action_type').notNull(),
  risk: text('risk', { enum: ['safe', 'confirm', 'blocked'] }).notNull(),
  status: text('status', { enum: ['requested', 'approved', 'denied', 'expired', 'cancelled', 'completed', 'failed', 'blocked'] }).notNull(),
  fingerprint: text('fingerprint').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  decidedAt: text('decided_at'),
  completedAt: text('completed_at'),
}, (t) => [uniqueIndex('neura_action_audits_fingerprint_unique').on(t.fingerprint), index('neura_action_audits_session_idx').on(t.sessionId, t.createdAt)]);

export const personalAccounts = sqliteTable('personal_accounts', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), identifier: text('identifier').notNull(), scopesJson: text('scopes_json').notNull(), state: text('state').notNull(), tokenFile: text('token_file').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('personal_accounts_provider_identifier_idx').on(t.provider, t.identifier)]);

export const personalSyncState = sqliteTable('personal_sync_state', {
  accountId: text('account_id').notNull().references(() => personalAccounts.id, { onDelete: 'cascade' }), resource: text('resource').notNull(), cursor: text('cursor'), updatedAt: text('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountId, t.resource] })]);

export const personalProcessedEvents = sqliteTable('personal_processed_events', {
  accountId: text('account_id').notNull().references(() => personalAccounts.id, { onDelete: 'cascade' }), eventKey: text('event_key').notNull(), processedAt: text('processed_at').notNull(),
}, (t) => [primaryKey({ columns: [t.accountId, t.eventKey] })]);

export const personalAutomations = sqliteTable('personal_automations', {
  id: text('id').primaryKey(), name: text('name').notNull(), triggerJson: text('trigger_json').notNull(), conditionJson: text('condition_json').notNull(), actionJson: text('action_json').notNull(), timezone: text('timezone').notNull(), state: text('state').notNull(), sourceText: text('source_text'), nextRunAt: text('next_run_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('personal_automations_next_run_idx').on(t.state, t.nextRunAt)]);

export const personalAutomationRuns = sqliteTable('personal_automation_runs', {
  id: text('id').primaryKey(), automationId: text('automation_id').notNull().references(() => personalAutomations.id, { onDelete: 'cascade' }), attempt: integer('attempt').notNull().default(1), state: text('state').notNull(), error: text('error'), taskId: text('task_id'), durationMs: integer('duration_ms'), idempotencyKey: text('idempotency_key').notNull(), startedAt: text('started_at').notNull(), finishedAt: text('finished_at'),
}, (t) => [uniqueIndex('personal_automation_runs_idempotency_idx').on(t.idempotencyKey), index('personal_automation_runs_automation_idx').on(t.automationId, t.startedAt)]);

export const personalNotifications = sqliteTable('personal_notifications', {
  id: text('id').primaryKey(), priority: text('priority').notNull(), channel: text('channel').notNull(), groupKey: text('group_key'), title: text('title').notNull(), metadataJson: text('metadata_json').notNull(), dedupeKey: text('dedupe_key').notNull(), readAt: text('read_at'), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('personal_notifications_dedupe_idx').on(t.dedupeKey), index('personal_notifications_created_idx').on(t.readAt, t.createdAt)]);

export const personalNotificationPrefs = sqliteTable('personal_notification_prefs', {
  id: text('id').primaryKey(), channelsJson: text('channels_json').notNull(), quietFrom: text('quiet_from'), quietTo: text('quiet_to'), lockedScreen: integer('locked_screen', { mode: 'boolean' }).notNull().default(false), updatedAt: text('updated_at').notNull(),
});

/** Product-level content entities. These deliberately sit beside, rather than replace, the Velix tables. */
export const contentChannels = sqliteTable('content_channels', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), name: text('name').notNull(), niche: text('niche').notNull().default(''), audience: text('audience').notNull().default(''), tone: text('tone').notNull().default(''), autonomy: text('autonomy').notNull().default('assisted'), budgetUsd: real('budget_usd').notNull().default(0), concurrencyLimit: integer('concurrency_limit').notNull().default(1), identityJson: text('identity_json').notNull().default('{}'), editorialStrategyJson: text('editorial_strategy_json').notNull().default('{}'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('content_channels_workspace_idx').on(t.workspaceId, t.updatedAt)]);

export const contentIdeas = sqliteTable('content_ideas', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), channelId: text('channel_id').references(() => contentChannels.id, { onDelete: 'set null' }), title: text('title').notNull(), angle: text('angle').notNull().default(''), source: text('source').notNull().default('manual'), status: text('status').notNull().default('new'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('content_ideas_workspace_idx').on(t.workspaceId, t.updatedAt)]);

export const contentProjects = sqliteTable('content_projects', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), channelId: text('channel_id').references(() => contentChannels.id, { onDelete: 'set null' }), videoProjectId: text('video_project_id').references(() => projects.id, { onDelete: 'set null' }), title: text('title').notNull(), briefJson: text('brief_json').notNull().default('{}'), scriptJson: text('script_json').notNull().default('{}'), status: text('status').notNull().default('active'), autonomy: text('autonomy').notNull().default('assisted'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('content_projects_workspace_idx').on(t.workspaceId, t.updatedAt), index('content_projects_channel_idx').on(t.channelId, t.updatedAt)]);

export const contentExecutions = sqliteTable('content_executions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => contentProjects.id, { onDelete: 'cascade' }), status: text('status').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('content_executions_project_idx').on(t.projectId, t.updatedAt)]);

export const contentPublicationPackages = sqliteTable('content_publication_packages', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => contentProjects.id, { onDelete: 'cascade' }), version: integer('version').notNull(), title: text('title').notNull().default(''), description: text('description').notNull().default(''), tagsJson: text('tags_json').notNull().default('[]'), chaptersJson: text('chapters_json').notNull().default('[]'), thumbnailAssetId: text('thumbnail_asset_id'), status: text('status').notNull().default('draft'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('content_publication_packages_project_version_idx').on(t.projectId, t.version), index('content_publication_packages_project_idx').on(t.projectId, t.updatedAt)]);

export const contentPublicationApprovals = sqliteTable('content_publication_approvals', {
  id: text('id').primaryKey(), packageId: text('package_id').notNull().references(() => contentPublicationPackages.id, { onDelete: 'cascade' }), projectId: text('project_id').notNull().references(() => contentProjects.id, { onDelete: 'cascade' }), packageVersion: integer('package_version').notNull(), decision: text('decision').notNull(), approvedBy: text('approved_by').notNull(), note: text('note').notNull().default(''), createdAt: text('created_at').notNull(),
}, (t) => [index('content_publication_approvals_package_idx').on(t.packageId, t.createdAt)]);

export const contentPublications = sqliteTable('content_publications', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => contentProjects.id, { onDelete: 'cascade' }), packageId: text('package_id').notNull().references(() => contentPublicationPackages.id, { onDelete: 'restrict' }), platform: text('platform').notNull(), visibility: text('visibility').notNull(), status: text('status').notNull(), approvalRequired: integer('approval_required', { mode: 'boolean' }).notNull().default(true), scheduledAt: text('scheduled_at'), publishedAt: text('published_at'),
}, (t) => [index('content_publications_project_idx').on(t.projectId, t.status)]);

export const contentAnalyticsSnapshots = sqliteTable('content_analytics_snapshots', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => contentProjects.id, { onDelete: 'cascade' }), publicationId: text('publication_id').references(() => contentPublications.id, { onDelete: 'set null' }), platform: text('platform').notNull(), capturedAt: text('captured_at').notNull(), metricsJson: text('metrics_json').notNull().default('{}'), notes: text('notes').notNull().default(''),
}, (t) => [index('content_analytics_project_idx').on(t.projectId, t.capturedAt)]);

// Aethera Autonomous Studio (0108): additive tables beside the production run; JSON columns hold the Zod contracts.
export const aetheraSubjects = sqliteTable('aethera_subjects', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), kind: text('kind').notNull(), title: text('title').notNull(), dataJson: text('data_json').notNull(), verification: text('verification').notNull(), checkedAt: text('checked_at').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [index('aethera_subjects_run_idx').on(t.runId, t.createdAt)]);
export const aetheraMediaAcquisitions = sqliteTable('aethera_media_acquisitions', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), subjectId: text('subject_id').references(() => aetheraSubjects.id, { onDelete: 'set null' }), referenceId: text('reference_id').notNull(), adapter: text('adapter').notNull(), idempotencyKey: text('idempotency_key').notNull(), status: text('status').notNull(), attempt: integer('attempt').notNull().default(0), bytesDone: integer('bytes_done').notNull().default(0), bytesTotal: integer('bytes_total'), partialPath: text('partial_path'), resultJson: text('result_json'), errorJson: text('error_json'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('aethera_media_acquisitions_key_idx').on(t.runId, t.idempotencyKey)]);
export const aetheraMediaProvenance = sqliteTable('aethera_media_provenance', {
  assetId: text('asset_id').primaryKey().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), url: text('url').notNull(), platform: text('platform').notNull(), publisher: text('publisher').notNull(), official: integer('official', { mode: 'boolean' }).notNull(), publishedAt: text('published_at'), license: text('license'), knownRestrictionsJson: text('known_restrictions_json').notNull().default('[]'), adapter: text('adapter').notNull(), adapterVersion: text('adapter_version').notNull(), acquiredAt: text('acquired_at').notNull(), usage: text('usage').notNull(), legalClearance: text('legal_clearance').notNull().default('unknown'), updatedAt: text('updated_at').notNull(),
});
export const aetheraMediaSegments = sqliteTable('aethera_media_segments', {
  id: text('id').primaryKey(), assetId: text('asset_id').notNull().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), startMs: integer('start_ms').notNull(), endMs: integer('end_ms').notNull(), kind: text('kind').notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('aethera_media_segments_asset_idx').on(t.assetId, t.startMs)]);
export const aetheraSubjectIdentities = sqliteTable('aethera_subject_identities', {
  id: text('id').primaryKey(), assetId: text('asset_id').notNull().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), segmentId: text('segment_id').references(() => aetheraMediaSegments.id, { onDelete: 'cascade' }), subjectId: text('subject_id').notNull().references(() => aetheraSubjects.id, { onDelete: 'cascade' }), status: text('status').notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('aethera_subject_identities_subject_idx').on(t.subjectId, t.createdAt)]);
export const aetheraVisionCache = sqliteTable('aethera_vision_cache', {
  key: text('key').primaryKey(), provider: text('provider').notNull(), model: text('model').notNull(), promptVersion: text('prompt_version').notNull(), task: text('task').notNull(), resultJson: text('result_json').notNull(), createdAt: text('created_at').notNull(),
});
export const aetheraVisionBenchmarks = sqliteTable('aethera_vision_benchmarks', {
  id: text('id').primaryKey(), datasetVersion: text('dataset_version').notNull(), category: text('category').notNull(), synthetic: integer('synthetic', { mode: 'boolean' }).notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('aethera_vision_benchmarks_dataset_idx').on(t.datasetVersion, t.category)]);
export const aetheraVisionSpend = sqliteTable('aethera_vision_spend', {
  runId: text('run_id').primaryKey().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), amountUsd: real('amount_usd').notNull().default(0), updatedAt: text('updated_at').notNull(),
});
/** AP-02: the person's decision to use third-party media editorially in a video project (off unless recorded). */
export const aetheraEditorialPolicies = sqliteTable('aethera_editorial_policies', {
  projectId: text('project_id').primaryKey().references(() => videoProjects.id, { onDelete: 'cascade' }), thirdPartyEditorialUse: integer('third_party_editorial_use', { mode: 'boolean' }).notNull().default(false), note: text('note').notNull(), decidedBy: text('decided_by').notNull(), decidedAt: text('decided_at').notNull(),
});
/** AP-02: the person's decision on one acquired asset that needed review; never a licence. */
export const aetheraMediaEditorialDecisions = sqliteTable('aethera_media_editorial_decisions', {
  assetId: text('asset_id').notNull().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), decision: text('decision').notNull(), note: text('note').notNull(), decidedBy: text('decided_by').notNull(), decidedAt: text('decided_at').notNull(),
}, (t) => [primaryKey({ columns: [t.assetId, t.projectId] })]);
/** Aethera channel voice: designed synthetic voices (no person cloned), saved per video project. */
export const aetheraVoicePresets = sqliteTable('aethera_voice_presets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
});
/** Persistent, revocable authorization to narrate with a preset, tied to the provider's declared licence. */
export const aetheraVoiceAuthorizations = sqliteTable('aethera_voice_authorizations', {
  id: text('id').primaryKey(), presetId: text('preset_id').notNull().references(() => aetheraVoicePresets.id, { onDelete: 'cascade' }), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), dataJson: text('data_json').notNull(), grantedAt: text('granted_at').notNull(), revokedAt: text('revoked_at'),
});
/** Per-scene narration direction (speed, pause after). */
export const aetheraNarrationDirections = sqliteTable('aethera_narration_directions', {
  runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), sceneId: text('scene_id').notNull(), dataJson: text('data_json').notNull(),
}, (t) => [primaryKey({ columns: [t.runId, t.sceneId] })]);
/** AP-03: immutable versions of the structured editing timeline. */
export const aetheraTimelines = sqliteTable('aethera_timelines', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), version: integer('version').notNull(), documentJson: text('document_json').notNull(), hash: text('hash').notNull(), source: text('source').notNull(), author: text('author').notNull(), changeJson: text('change_json'), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('aethera_timelines_run_version_idx').on(t.runId, t.version), index('aethera_timelines_run_created_idx').on(t.runId, t.createdAt)]);
/** AP-04: local proxy metadata; originals and Rights Manager records are untouched. */
export const aetheraMediaProxies = sqliteTable('aethera_media_proxies', {
  id: text('id').primaryKey(), assetId: text('asset_id').notNull().references(() => velixLocalAssets.id, { onDelete: 'cascade' }), originalHash: text('original_hash').notNull(), relativePath: text('relative_path').notNull(), width: integer('width').notNull(), height: integer('height').notNull(), fps: real('fps').notNull(), codec: text('codec').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('aethera_media_proxies_asset_hash_idx').on(t.assetId, t.originalHash), index('aethera_media_proxies_asset_idx').on(t.assetId)]);
/** AP-05: only tracks with a persisted license record are eligible for a production mix. */
export const aetheraMusicLibrary = sqliteTable('aethera_music_library', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => videoProjects.id, { onDelete: 'cascade' }), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('aethera_music_library_project_track_idx').on(t.projectId, t.id), index('aethera_music_library_project_idx').on(t.projectId, t.updatedAt)]);
/** AP-06: versioned preset grammars and deterministic DirectorPlans. */
export const aetheraPresets = sqliteTable('aethera_presets', {
  id: text('id').primaryKey(), version: integer('version').notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('aethera_presets_id_version_idx').on(t.id, t.version)]);
export const aetheraDirectorPlans = sqliteTable('aethera_director_plans', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), version: integer('version').notNull(), presetId: text('preset_id').notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('aethera_director_plans_run_version_idx').on(t.runId, t.version), index('aethera_director_plans_run_created_idx').on(t.runId, t.createdAt)]);
/** Smart Director: versioned editorial plans per run; an approved version is never rewritten. */
export const aetheraEditorialPlans = sqliteTable('aethera_editorial_plans', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), version: integer('version').notNull(), status: text('status').notNull(), hash: text('hash').notNull(), scriptKey: text('script_key').notNull(), dataJson: text('data_json').notNull(), approvedBy: text('approved_by'), approvedAt: text('approved_at'), createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('aethera_editorial_plans_run_version_idx').on(t.runId, t.version), index('aethera_editorial_plans_run_script_idx').on(t.runId, t.scriptKey)]);
/** AP-10: immutable deterministic review findings bound to the reviewed timeline hash. */
export const aetheraReviewReports = sqliteTable('aethera_review_reports', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), timelineVersion: integer('timeline_version').notNull(), timelineHash: text('timeline_hash').notNull(), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(),
}, (t) => [index('aethera_review_reports_run_created_idx').on(t.runId, t.createdAt), index('aethera_review_reports_run_version_idx').on(t.runId, t.timelineVersion)]);
export const aetheraMediaCandidates = sqliteTable('aethera_media_candidates', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), subjectId: text('subject_id').notNull().references(() => aetheraSubjects.id, { onDelete: 'cascade' }), referenceId: text('reference_id').references(() => velixMediaReferences.id, { onDelete: 'set null' }), url: text('url').notNull(), source: text('source').notNull(), kind: text('kind').notNull(), status: text('status').notNull(), score: real('score').notNull().default(0), identity: text('identity'), dataJson: text('data_json').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('aethera_media_candidates_run_url_idx').on(t.runId, t.url), index('aethera_media_candidates_subject_idx').on(t.subjectId, t.score)]);
export const aetheraMediaUsageEvents = sqliteTable('aethera_media_usage_events', {
  id: text('id').primaryKey(), runId: text('run_id').notNull().references(() => velixProductionRuns.id, { onDelete: 'cascade' }), assetId: text('asset_id').references(() => velixLocalAssets.id, { onDelete: 'cascade' }), candidateId: text('candidate_id').references(() => aetheraMediaCandidates.id, { onDelete: 'set null' }), subjectId: text('subject_id'), event: text('event').notNull(), detail: text('detail').notNull().default(''), createdAt: text('created_at').notNull(),
}, (t) => [index('aethera_media_usage_events_asset_idx').on(t.assetId, t.createdAt), index('aethera_media_usage_events_run_idx').on(t.runId, t.createdAt)]);
