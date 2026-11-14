import type { SkillCapabilityDescriptor, SkillIntegrationMatrixEntry } from './contracts.js';

export const existingSkillCapabilities = [
  'scan local Claude, Codex, Agents and plugin roots',
  'parse SKILL.md frontmatter and expose valid/invalid state',
  'detect duplicate names and installation scripts without executing them',
  'persist skill preferences and allowlisted HTTPS hosts atomically',
  'install approved local/remote content with size, path and symlink protections',
  'map enabled skills to task types and agents',
  'run the reviewed Velix motion-composition suggestion as a read-only TaskEngine capability',
] as const;

export const builtInSkillCapabilities: readonly SkillCapabilityDescriptor[] = [
  { id: 'neuralbridge:motion-composition', name: 'Aethera Motion Composition', capability: 'motion-composition', description: 'Sugere cenas title/card para um roteiro aprovado sem publicar ou renderizar automaticamente.', readOnly: true, requiresHumanReview: true },
  { id: 'neuralbridge:velix-channel-optimizer', name: 'Aethera Channel Optimizer', capability: 'publication-optimizer', description: 'Sugere títulos, descrição e tags para revisão humana a partir de referências do nicho, que são dados não confiáveis; nunca publica nem altera o canal.', readOnly: true, requiresHumanReview: true },
];

export const skillIntegrationMatrix: readonly SkillIntegrationMatrixEntry[] = [
  { subsystem: 'skills-manager', currentContract: 'scanSkills, toSkillListing, SkillPreference, installRemoteSkillRepository', phase41Role: 'reuse', evidence: 'packages/workspace/src/skills.ts and existing skills tests' },
  { subsystem: 'task-engine', currentContract: 'TaskEngine, persisted task events and structured read-only capability', phase41Role: 'reuse', evidence: 'packages/orchestrator/src/engine.ts and video-motion.ts' },
  { subsystem: 'workflow-builder', currentContract: 'versioned workflow definitions and workflow runner', phase41Role: 'extend-later', evidence: 'apps/desktop/src/main/workflows.ts and packages/orchestrator/src/workflow-runner.ts' },
  { subsystem: 'git-intelligence', currentContract: 'read-only Git context and protected writes', phase41Role: 'reuse', evidence: 'packages/workspace/src/git.ts and git-write.ts' },
  { subsystem: 'brain-rag', currentContract: 'BrainService/RAG context with untrusted-data delimiters', phase41Role: 'reuse', evidence: 'packages/brain and packages/orchestrator/src/engine.ts' },
  { subsystem: 'token-optimizer', currentContract: 'existing context/token budgeting', phase41Role: 'extend-later', evidence: 'orchestrator task context contracts' },
  { subsystem: 'ipc', currentContract: 'skills:list/settings/install/update channels', phase41Role: 'do-not-change-in-lot-1', evidence: 'apps/desktop/src/preload/index.ts and main IPC registration' },
  { subsystem: 'persistence', currentContract: 'preferences file plus existing database migrations', phase41Role: 'do-not-change-in-lot-1', evidence: 'existing skills settings persistence and migration policy' },
] as const;
