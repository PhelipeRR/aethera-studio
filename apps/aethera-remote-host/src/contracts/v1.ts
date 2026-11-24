export const REMOTE_CONTRACT_VERSION = '1.1.0' as const;

export type RemoteScope =
  | 'host:read'
  | 'agents:read'
  | 'projects:read'
  | 'projects:write'
  | 'sync:read'
  | 'sync:write'
  | 'jobs:read'
  | 'jobs:write'
  | 'jobs:control'
  | 'jobs:approve'
  | 'artifacts:read';

export const ALL_REMOTE_SCOPES: readonly RemoteScope[] = [
  'host:read',
  'agents:read',
  'projects:read',
  'projects:write',
  'sync:read',
  'sync:write',
  'jobs:read',
  'jobs:write',
  'jobs:control',
  'jobs:approve',
  'artifacts:read',
];

export type RemoteEngineMode = 'monorepo_cinema' | 'standalone_host';

export interface RemoteHealthResponse {
  ok: true;
  service: 'aethera-remote-host';
  version: string;
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  uptimeSec: number;
  engineMode: RemoteEngineMode;
  timestamp: string;
}

export interface GpuInfo {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown';
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  utilizationPct: number | null;
  driverVersion: string | null;
  nvencSupported: boolean;
}

export interface BinaryToolStatus {
  id: 'ffmpeg' | 'ffprobe' | 'yt-dlp' | 'nvidia-smi';
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface RemoteHostStatusResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  online: true;
  checkedAt: string;
  hostname: string;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  nodeVersion: string;
  uptimeSec: number;
  bindHost: string;
  port: number;
  engineMode: RemoteEngineMode;
  monorepoPackages: {
    cinema: boolean;
    database: boolean;
    agents: boolean;
    workspace: boolean;
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg1m: number;
    usagePct: number;
  };
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    usagePct: number;
  };
  gpus: GpuInfo[];
  tools: BinaryToolStatus[];
  allowedRoots: string[];
  activeJobsCount: number;
  queuedJobsCount: number;
  awaitingApprovalCount: number;
}

export type RemoteAgentId =
  | 'antigravity-cli'
  | 'claude-cli'
  | 'claude-gateway'
  | 'codex-cli'
  | 'ollama';

export type RemoteAgentCapability =
  | 'research'
  | 'script'
  | 'humanize'
  | 'youtube_audit'
  | 'creative_direction'
  | 'technical_qc'
  | 'revision';

export type RemoteAgentFailureKind =
  | 'cli_not_installed'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'auth_failed'
  | 'config_error'
  | 'timeout'
  | 'stalled'
  | 'network_error'
  | 'invalid_response'
  | 'cancelled'
  | 'unknown';

export interface RemoteAgentStatus {
  id: RemoteAgentId;
  label: string;
  command: string;
  priority: number;
  available: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
  authenticated: boolean | null;
  models: string[];
  capabilities: RemoteAgentCapability[];
  inCooldown: boolean;
  cooldownReason: RemoteAgentFailureKind | null;
  problem: string | null;
  checkedAt: string;
  /** Optional capability handshake; omitted for legacy agents that cannot prove vision support. */
  vision?: RemoteVisionCapability;
}

export interface RemoteGpuCapability {
  available: boolean | null;
  name: string | null;
  vramMb: number | null;
}

export interface RemoteVisionCapability {
  available: boolean;
  multimodal: boolean | null;
  /** Configured model selected for Recap; availability is false when this exact model is absent. */
  selectedModel: string | null;
  models: string[];
  maxImagesPerCall: number | null;
  gpu: RemoteGpuCapability;
  telemetry: {
    tokens: boolean;
    cache: boolean;
    effectiveApiCost: boolean;
    estimatedCost: boolean;
    cliQuota: boolean;
  };
  /** Local OCR capability handshake; model availability is intentionally separate from Python package availability. */
  ocr?: {
    available: boolean | null;
    engine: 'paddleocr' | null;
    version: string | null;
    cpuPreferred: boolean;
  };
  worker?: {
    maxConcurrent: number | null;
    active: number | null;
  };
  vramLimitMb?: number | null;
  host: 'remote_host';
}

export interface RemoteAgentsResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  checkedAt: string;
  fallbackOrder: RemoteAgentId[];
  availableCount: number;
  soloModeReady: boolean;
  agents: RemoteAgentStatus[];
}

export interface RemoteProjectSummary {
  id: string;
  title: string;
  source: 'desktop_sqlite' | 'remote_host' | 'workspace_dir';
  aspectRatio: '16:9' | '9:16';
  style: string;
  status: string;
  updatedAt: string;
  outputArtifactId: string | null;
  sceneCount: number;
}

export interface RemoteProjectsResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  projects: RemoteProjectSummary[];
  sourcesChecked: Array<{
    source: 'desktop_sqlite' | 'remote_host' | 'workspace_dir';
    available: boolean;
    detail: string;
  }>;
}

export type RemoteOperationType =
  | 'cinema.produce'
  | 'agent.run'
  | 'cinema.humanize'
  | 'cinema.youtube_audit'
  | 'media.acquire'
  | 'render.ffmpeg'
  | 'media.probe';

export type RemoteJobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted_on_restart';

export interface RemoteJobStageRecord {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';
  engine: 'monorepo_cinema' | 'agent_cli' | 'ffmpeg_gpu' | 'ffmpeg_cpu' | 'yt_dlp' | 'ffprobe' | 'host_native';
  startedAt: string | null;
  completedAt: string | null;
  detail: string;
}

export interface RemoteArtifactRecord {
  id: string;
  jobId: string;
  kind: 'video_mp4' | 'thumbnail_jpg' | 'script_json' | 'log_txt' | 'media_download';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  loudnessLufs: number | null;
  encoderUsed: string | null;
  createdAt: string;
}

export interface CreateRemoteJobRequest {
  operation: RemoteOperationType;
  title?: string;
  projectId?: string;
  prompt?: string;
  preferredAgent?: RemoteAgentId | 'auto';
  agentTask?: RemoteAgentCapability;
  style?: string;
  aspectRatio?: '16:9' | '9:16';
  durationMin?: number;
  qualityPreset?: 'draft_540p' | 'review_720p' | 'master_1080p' | 'cinema_4k';
  useGpu?: boolean;
  scenes?: Array<{
    index: number;
    title: string;
    narration: string;
    caption: string;
    accentHex?: string;
  }>;
  mediaQuery?: string;
  mediaUrl?: string;
  artifactId?: string;
  requireApproval?: boolean;
}

export interface RemoteJobRecord {
  id: string;
  operation: RemoteOperationType;
  title: string;
  projectId: string | null;
  status: RemoteJobStatus;
  requiresApproval: boolean;
  approvalState: 'not_required' | 'pending' | 'approved' | 'rejected';
  approvalNote: string | null;
  engineMode: RemoteEngineMode;
  agentUsed: RemoteAgentId | null;
  encoderUsed: string | null;
  progressMode: 'real_ffmpeg' | 'real_stages' | 'indeterminate';
  progressPct: number | null;
  currentStage: string;
  stages: RemoteJobStageRecord[];
  resultSummary: string | null;
  outputText: string | null;
  error: string | null;
  artifacts: RemoteArtifactRecord[];
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface RemoteJobEvent {
  seq: number;
  jobId: string;
  type:
    | 'job_created'
    | 'job_status'
    | 'stage_update'
    | 'progress'
    | 'log'
    | 'artifact_ready'
    | 'approval_required'
    | 'approval_resolved'
    | 'heartbeat';
  level: 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  progressPct: number | null;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface RemoteJobsListResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  jobs: RemoteJobRecord[];
}

export interface RemoteJobDetailResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  job: RemoteJobRecord;
  recentEvents: RemoteJobEvent[];
}

export interface ArtifactTicketResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  artifactId: string;
  expiresAt: string;
  streamPath: string;
  downloadPath: string;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  remoteIp: string;
  actor: string;
  statusCode: number;
  detail: string;
}

// ============================================================================
// Bidirectional Sync Contracts (Web <-> Remote Host Authority <-> Desktop)
// ============================================================================

export type SyncActor = 'web' | 'desktop' | 'remote_host';

export type ProjectSyncBadgeState = 'local_only' | 'synced' | 'pending' | 'conflict';

export interface SyncedSceneItem {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualQuery: string;
  durationSec: number;
  transition: 'corte_seco' | 'dissolve' | 'whip_pan' | 'fade_black';
  mediaMatched: boolean;
  caption: string;
  accentHex: string;
  mediaRefId?: string | null;
}

export interface SyncedRevisionRecord {
  id: string;
  instruction: string;
  summary: string;
  affectedStages: string[];
  createdAt: string;
  author: SyncActor;
}

export interface SyncedMediaRef {
  mediaRefId: string;
  projectId: string;
  kind: 'video_mp4' | 'audio' | 'image' | 'thumbnail' | 'subtitle' | 'other';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  available: boolean;
  source: 'desktop_render' | 'desktop_media' | 'remote_artifact';
  updatedAt: string;
}

export interface SyncedProjectData {
  title: string;
  briefing: string;
  creationMode: 'ai' | 'manual';
  format: 'youtube_1080p' | 'youtube_4k' | 'shorts_9_16' | 'documentary_wide';
  style: 'Video Essay' | 'Documentário' | 'Top 10' | 'Análise Técnica' | 'Comédia Narrada';
  aspectRatio: '16:9' | '9:16';
  language: string;
  durationMin: number;
  humorLevel: number;
  ttsProvider: 'voicestudio' | 'elevenlabs' | 'webspeech';
  ttsVoice: string;
  qualityPreset: 'review_720p' | 'master_1080p' | 'cinema_4k';
  status: 'briefing' | 'producing' | 'awaiting_review' | 'approved' | 'scheduled';
  scheduledDate: string | null;
  humanizedScript: string | null;
  scenes: SyncedSceneItem[];
  revisions: SyncedRevisionRecord[];
  latestJobId: string | null;
  latestRenderMediaRefId: string | null;
  mediaRefs: SyncedMediaRef[];
  settings?: Record<string, unknown>;
}

export interface SyncedProjectRecord {
  id: string;
  version: number;
  contentHash: string;
  origin: SyncActor;
  updatedBy: SyncActor;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  desktopProjectedAt: string | null;
  data: SyncedProjectData;
}

export interface UpsertSyncedProjectRequest {
  id?: string;
  expectedVersion?: number | null;
  actor: SyncActor;
  idempotencyKey?: string;
  data: SyncedProjectData;
}

export interface SyncConflictPayload {
  code: 'SYNC_VERSION_CONFLICT';
  error: string;
  projectId: string;
  expectedVersion: number | null;
  serverVersion: number;
  changedFields: string[];
  serverProject: SyncedProjectRecord;
  incomingData: SyncedProjectData;
}

export interface ResolveSyncConflictRequest {
  strategy: 'keep_server' | 'force_client' | 'fork_copy';
  actor: SyncActor;
  idempotencyKey?: string;
  clientData?: SyncedProjectData;
}

export interface SyncChangeEvent {
  seq: number;
  projectId: string;
  eventType: 'project_created' | 'project_updated' | 'project_deleted' | 'desktop_ingested' | 'media_ready' | 'conflict_resolved';
  version: number;
  actor: SyncActor;
  timestamp: string;
  summary: string;
  project?: SyncedProjectRecord;
}

export interface SyncBackupSummary {
  id: string;
  createdAt: string;
  fileCount: number;
  reason: string;
  manifestSha256: string;
}

export interface SyncSnapshotResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  authorityId: string;
  currentSeq: number;
  desktopBridgeStatus: {
    desktopUserDataDetected: boolean;
    cinemaProjectsCount: number;
    watcherActive: boolean;
    lastBackup: SyncBackupSummary | null;
  };
  projects: SyncedProjectRecord[];
}

export interface SyncChangesResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  sinceSeq: number;
  currentSeq: number;
  changes: SyncChangeEvent[];
}

export interface SyncMediaTicketResponse {
  schemaVersion: typeof REMOTE_CONTRACT_VERSION;
  mediaRefId: string;
  expiresAt: string;
  streamPath: string;
  downloadPath: string;
}

