export type NavSectionId =
  | 'home'
  | 'manual_projects'
  | 'production'
  | 'console'
  | 'creative'
  | 'editor'
  | 'library'
  | 'agents'
  | 'review'
  | 'pipeline'
  | 'calendar'
  | 'publishing'
  | 'remote'
  | 'settings';

export type ManualProjectSubView = 'overview' | 'package' | 'variants' | 'analytics';

export type ProductionStatus =
  | 'briefing'
  | 'producing'
  | 'awaiting_review'
  | 'approved'
  | 'scheduled';

export type PipelineStageId =
  | 'interpretation'
  | 'research'
  | 'script'
  | 'decoupage'
  | 'media_acquisition'
  | 'coverage_plan'
  | 'assembly'
  | 'audio_sfx'
  | 'preview_render';

export type StageState = 'pending' | 'running' | 'completed' | 'paused';

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  agent: string;
  state: StageState;
  summary: string;
  durationSec: number;
}

export interface SceneItem {
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
}

export interface ReviewComment {
  id: string;
  timestampSec: number;
  author: string;
  text: string;
  resolved: boolean;
  createdAt: string;
}

export interface ReleaseChecklistItem {
  id: string;
  label: string;
  category: 'audio' | 'visual' | 'editorial' | 'direitos';
  passed: boolean;
}

export interface RevisionPlan {
  id: string;
  instruction: string;
  summary: string;
  affectedStages: PipelineStageId[];
  createdAt: string;
}

export interface PublicationPackage {
  version: number;
  title: string;
  description: string;
  tags: string[];
  thumbnailArtId: string | null;
  visibility: 'private' | 'unlisted' | 'public';
  approvalStatus: 'draft' | 'approved' | 'rejected';
  approvedAt: string | null;
  youtubeAuditScore?: number;
  youtubeAuditNotes?: string[];
  updatedAt: string;
}

export interface DerivativeVariant {
  id: string;
  formatId: 'youtube-short' | 'instagram-reels' | 'tiktok';
  title: string;
  hookText: string;
  durationSec: number;
  status: 'candidate' | 'approved' | 'rejected' | 'promoted';
  childProjectId: string | null;
  createdAt: string;
}

export interface AnalyticsSnapshot {
  id: string;
  platform: 'YouTube' | 'Instagram Reels' | 'TikTok';
  capturedAt: string;
  metrics: {
    views: number;
    ctrPct: number;
    avgRetentionPct: number;
    watchTimeHours: number;
  };
  note: string;
}

export interface RenderProbeMetrics {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  bitrateKbps: number;
  fileSizeBytes: number;
  loudnessLufs: number | null;
}

export interface RenderJob {
  id: string;
  projectId: string;
  projectTitle: string;
  preset: ProductionProject['qualityPreset'];
  aspectRatio: '16:9' | '9:16';
  status: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  progressPct: number;
  stageMessage: string;
  outputFilename: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  probeMetrics: RenderProbeMetrics | null;
  engine: 'ffmpeg_real';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface ProductionProject {
  id: string;
  title: string;
  briefing: string;
  creationMode: 'ai' | 'manual';
  channelId: string | null;
  format: 'youtube_1080p' | 'youtube_4k' | 'shorts_9_16' | 'documentary_wide';
  style: 'Video Essay' | 'Documentário' | 'Top 10' | 'Análise Técnica' | 'Comédia Narrada';
  aspectRatio: '16:9' | '9:16';
  language: string;
  durationMin: number;
  humorLevel: number;
  ttsProvider: 'voicestudio' | 'elevenlabs' | 'webspeech';
  ttsVoice: string;
  qualityPreset: 'review_720p' | 'master_1080p' | 'cinema_4k';
  status: ProductionStatus;
  stages: PipelineStage[];
  scenes: SceneItem[];
  comments: ReviewComment[];
  checklist: ReleaseChecklistItem[];
  revisions: RevisionPlan[];
  scheduledDate: string | null;
  humanizedScript: string | null;
  publicationPackage: PublicationPackage;
  derivatives: DerivativeVariant[];
  analyticsSnapshots: AnalyticsSnapshot[];
  latestRenderJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  niche: string;
  targetAudience: string;
  toneOfVoice: string;
  language: string;
  monthlyBudgetUsd: number;
  maxConcurrentProductions: number;
  editorialStrategy: string;
  autonomyLevel: 'manual' | 'assisted' | 'autonomous';
  oauthStatus: 'not_configured' | 'ready' | 'connected';
  createdAt: string;
  updatedAt: string;
}

export type AgentProviderId =
  | 'antigravity-cli'
  | 'claude-cli'
  | 'codex-cli'
  | 'claude-gateway'
  | 'ollama-vlm';

export interface AgentProviderConfig {
  id: AgentProviderId;
  label: string;
  role: string;
  command: string;
  enabled: boolean;
  priority: number;
  installed: boolean;
  lastTestStatus: 'untested' | 'ok' | 'cli_not_installed' | 'auth_failed' | 'error';
  lastTestMessage: string;
  lastTestedAt: string | null;
}

export interface AgentRunRecord {
  id: string;
  taskKind: 'provider_test' | 'humanize' | 'youtube_agent' | 'pipeline_stage';
  providerUsed: string;
  executionMode: 'real_cli' | 'deterministic_fallback' | 'blocked';
  projectId: string | null;
  summary: string;
  createdAt: string;
}

export interface CapabilityItem {
  id: string;
  label: string;
  available: boolean;
  status: 'funcional' | 'parcial' | 'bloqueada';
  detail: string;
  version?: string;
}

export interface SystemCapabilities {
  dbPath: string;
  rendersDir: string;
  nodeVersion: string;
  checkedAt: string;
  items: CapabilityItem[];
  missingWorkspacePackages: string[];
  presentWorkspacePackages: string[];
}

export interface TrendIdea {
  id: string;
  title: string;
  source: 'YouTube' | 'Google News' | 'Reddit' | 'Analytics';
  angle: string;
  suggestedDurationMin: number;
  suggestedStyle: ProductionProject['style'];
  score: number;
  briefingTemplate: string;
}

export type CreativeArtType = 'thumbnail' | 'banner' | 'avatar' | 'watermark';

export interface BrandKit {
  id: string;
  name: string;
  primaryBg: string;
  secondaryBg: string;
  accentColor: string;
  textColor: string;
  monogram: string;
}

export interface CreativeLayer {
  id: string;
  kind: 'background' | 'badge' | 'headline' | 'subheadline' | 'watermark';
  label: string;
  text?: string;
  color: string;
  visible: boolean;
  xPct: number;
  yPct: number;
  scale: number;
}

export interface CreativeAudit {
  score: number;
  passed: boolean;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
}

export interface CreativeArtProject {
  id: string;
  artType: CreativeArtType;
  prompt: string;
  headline: string;
  fidelity: 'conceptual_art' | 'content_faithful' | 'authentic_gameplay';
  brandKitId: string;
  variantLabel?: 'A' | 'B' | 'C';
  archetype: string;
  layers: CreativeLayer[];
  approved: boolean;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image' | 'script';
  durationLabel: string;
  license: 'Original' | 'Creative Commons' | 'Licenciado' | 'Uso Editorial';
  tags: string[];
  projectId: string | null;
  sourceUrl?: string | null;
  addedAt: string;
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  scope: 'pipeline' | 'creative' | 'review' | 'editor' | 'calendar' | 'render' | 'agents' | 'publishing' | 'media';
  level: 'info' | 'success' | 'warn';
  projectId?: string;
  message: string;
}

export interface StudioPreferences {
  defaultTtsProvider: ProductionProject['ttsProvider'];
  defaultQuality: ProductionProject['qualityPreset'];
  defaultLanguage: string;
  autoAdvancePipeline: boolean;
}

export interface StudioBootstrapState {
  projects: ProductionProject[];
  channels: ChannelConfig[];
  trendIdeas: TrendIdea[];
  brandKits: BrandKit[];
  creativeProjects: CreativeArtProject[];
  mediaAssets: MediaAsset[];
  renderJobs: RenderJob[];
  agentProviders: AgentProviderConfig[];
  agentRuns: AgentRunRecord[];
  consoleLogs: ConsoleLogEntry[];
  preferences: StudioPreferences;
  capabilities: SystemCapabilities;
}
