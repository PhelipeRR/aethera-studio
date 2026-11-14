export type SkillAgent = 'claude' | 'codex';
export type SkillSource = 'claude' | 'codex' | 'agents' | 'plugin' | 'custom' | 'project' | 'remote';
export type SkillCapability = 'discovery' | 'recommendation' | 'trust' | 'installation' | 'studio' | 'task-engine' | 'workflow' | 'git' | 'brain-rag' | 'analytics' | 'motion-composition' | 'publication-optimizer';
export type TrustAssessmentKind = 'automatic' | 'heuristic' | 'unverified';
export type TrustSeverity = 'info' | 'warning' | 'high' | 'critical';
export type SkillTrustCategory = 'origin' | 'integrity' | 'structure' | 'permissions' | 'behavior' | 'compatibility' | 'limitations';
export type SkillTrustStatus = 'verified' | 'attention' | 'risk' | 'not-verified' | 'blocked';

export interface SkillReference {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  agents: SkillAgent[];
  capabilities: SkillCapability[];
  installed: boolean;
  path?: string;
}

export interface SkillCapabilityDescriptor {
  id: string;
  name: string;
  capability: SkillCapability;
  description: string;
  readOnly: true;
  requiresHumanReview: true;
}

export interface SkillTrustCheck {
  id: string;
  label: string;
  kind: TrustAssessmentKind;
  severity: TrustSeverity;
  status: 'pass' | 'fail' | 'warning' | 'unknown';
  detail: string;
}

export interface SkillTrustEvidence { kind: 'fact' | 'heuristic' | 'declared' | 'unavailable'; value: string; path?: string; }
export interface SkillTrustFinding {
  id: string;
  category: SkillTrustCategory;
  severity: TrustSeverity;
  status: SkillTrustStatus;
  evidence: SkillTrustEvidence[];
  relatedPath?: string;
  rule: string;
  result: string;
  limitation: string;
  recommendedAction: string;
}
export interface SkillTrustPolicy {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxDepth: number;
  allowedHosts: string[];
  blockCritical: true;
}
export interface SkillTrustDecision { allowed: boolean; requiresExplicitApproval: true; blockedBy: string[]; warnings: string[]; }
export interface SkillTrustAssessment {
  skillId: string;
  evaluatedAt: string;
  ruleVersion: string;
  contentFingerprint: string;
  origin: { kind: 'local' | 'remote'; value: string; normalized: string; host: string | null; allowlisted: boolean | null };
  scope: 'global' | 'project' | 'unknown';
  inspectedFiles: Array<{ path: string; size: number; hash: string | null }>;
  findings: SkillTrustFinding[];
  checks: SkillTrustCheck[];
  decision: SkillTrustDecision;
  valid: boolean;
}
export interface SkillInstallPreview { skillId: string; destination: string; files: Array<{ path: string; size: number; overwrite: boolean }>; totalBytes: number; findings: SkillTrustFinding[]; blockedBy: string[]; warnings: string[]; checks: SkillTrustCheck[]; assessmentFingerprint: string; readOnly: true; }

export interface SkillMetadata {
  name: string;
  description: string;
  objective: string;
  triggers: string[];
  agents: SkillAgent[];
  dependencies: string[];
  permissions: string[];
  examples: string[];
}
export interface SkillDraftFile { path: string; content: string; }
export interface SkillDraft {
  id: string;
  skillId: string;
  metadata: SkillMetadata;
  instructions: string;
  files: SkillDraftFile[];
  scope: 'global' | 'project';
  projectId: string | null;
  sourcePath: string | null;
  baseFingerprint: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface SkillDraftSummary {
  id: string;
  skillId: string;
  name: string;
  description: string;
  scope: 'global' | 'project';
  projectId: string | null;
  revision: number;
  updatedAt: string;
}
export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fingerprint: string;
  manifest: { name: string; description: string };
  trust: SkillTrustAssessment;
}
export interface SkillEditorState { draft: SkillDraft; markdown: string; validation: SkillValidationResult | null; }
export interface SkillVersion { id: string; skillId: string; version: number; createdAt: string; origin: 'created' | 'edited' | 'imported' | 'restored'; fingerprint: string; path: string; current: boolean; }
export interface SkillChangeSet { skillId: string; fromVersionId: string | null; toVersionId: string; added: string[]; removed: string[]; changed: string[]; summary: string; }
export interface SkillExportResult { skillId: string; versionId: string; path: string; format: 'directory'; files: string[]; totalBytes: number; fingerprint: string; }
export interface SkillImportPreview { sourcePath: string; skillId: string; metadata: SkillMetadata; files: SkillDraftFile[]; totalBytes: number; validation: SkillValidationResult; conflict: 'none' | 'existing-draft' | 'existing-published'; }
export interface SkillRecommendationSimulation { recommendations: Array<{ skillId: string; name: string; relevance: number; reasons: string[]; evidence: string[] }>; excluded: Array<{ skillId: string; name: string; reasons: string[] }>; }

export interface SkillTrustSummary {
  skillId: string;
  checks: SkillTrustCheck[];
  requiresExplicitApproval: boolean;
  contentIsUntrusted: true;
}

export interface SkillIntegrationMatrixEntry {
  subsystem: 'skills-manager' | 'task-engine' | 'workflow-builder' | 'git-intelligence' | 'brain-rag' | 'token-optimizer' | 'ipc' | 'persistence';
  currentContract: string;
  phase41Role: 'reuse' | 'extend-later' | 'do-not-change-in-lot-1';
  evidence: string;
}

export interface SkillsIntelligenceAudit {
  phase: 41;
  lot: 1;
  existingCapabilities: string[];
  plannedCapabilities: SkillCapability[];
  matrix: SkillIntegrationMatrixEntry[];
  trustBaseline: SkillTrustSummary;
}
