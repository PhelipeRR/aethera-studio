// Project types shared by the main process (detection, git) and the UI. Pure types and constants.

export const STACKS = [
  'dotnet',
  'aspnetcore',
  'efcore',
  'node',
  'typescript',
  'react',
  'nextjs',
  'vue',
  'nuxt',
  'remotion',
  'electron',
  'drizzle',
  'prisma',
  'sqlserver',
  'postgresql',
  'python',
] as const;
export type StackId = (typeof STACKS)[number];

export const STACK_LABEL: Record<StackId, string> = {
  dotnet: '.NET',
  aspnetcore: 'ASP.NET Core',
  efcore: 'EF Core',
  node: 'Node.js',
  typescript: 'TypeScript',
  react: 'React',
  nextjs: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  remotion: 'Remotion',
  electron: 'Electron',
  drizzle: 'Drizzle',
  prisma: 'Prisma',
  sqlserver: 'SQL Server',
  postgresql: 'PostgreSQL',
  python: 'Python',
};

export interface StackInfo {
  stacks: StackId[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  /** Stack -> the file that revealed it (relative, forward slashes). */
  evidence: Partial<Record<StackId, string>>;
}

/** A dependency a project declares, with the manifest that declares it (relative path). */
export interface ProjectDependency {
  name: string;
  version: string | null;
  kind: 'runtime' | 'dev';
  source: string;
}

/** A source folder of the project, from the file index: how many files, and some symbols it defines. */
export interface ProfileModule {
  path: string;
  files: number;
  symbolCount: number;
  /** Up to eight, sorted. */
  symbols: string[];
}

/** A memory the profile points to, with how far it has been checked. */
export interface ProfileMemoryRef {
  id: string;
  title: string;
  confidence: 'unverified' | 'reviewed' | 'stale';
}

/** A tag shared by two or more bug fixes of the project. */
export interface ProfileProblem {
  tag: string;
  occurrences: number;
  memories: ProfileMemoryRef[];
}

/**
 * What NeuralBridge knows about a project (Phase 21), each part traceable to its source: modules to the
 * file index, dependencies to their manifest, decisions and problems to memories. Rebuilt on request from
 * an incremental index; `changes` says what moved since the previous profile.
 */
export interface ProjectProfile {
  projectId: string;
  generatedAt: string;
  index: { files: number; indexed: number; skipped: number; removed: number; tooLarge: number; limited: boolean };
  stack: StackInfo | null;
  modules: ProfileModule[];
  dependencies: ProjectDependency[];
  decisions: ProfileMemoryRef[];
  problems: ProfileProblem[];
  changes: { modulesAdded: string[]; modulesRemoved: string[]; dependenciesAdded: string[]; dependenciesRemoved: string[] } | null;
}

/** Phase 25: a project's Git history as read (read-only, bounded, no author e-mail). */
export interface GitHistoryFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** First line of the new version that the change touches; null for pure renames, deletions and binaries. */
  line: number | null;
  binary: boolean;
  /** The hunks (from the first @@), cut at the patch limit. */
  patch: string;
  truncated: boolean;
}

export interface GitHistoryCommit {
  hash: string;
  author: string;
  date: string;
  parents: string[];
  subject: string;
  body: string;
  files: GitHistoryFile[];
}

export interface GitHistoryRef {
  name: string;
  kind: 'local' | 'remote' | 'tag';
  hash: string;
}

export interface GitHistory {
  isRepo: boolean;
  branches: { name: string; head: string }[];
  refs?: GitHistoryRef[];
  head?: string | null;
  /** New commits, newest first (children before parents). */
  commits: GitHistoryCommit[];
  /** More new commits than maxCommits: the oldest were left for the next run. */
  limited: boolean;
  nextCursor?: string | null;
}

export interface GitRefComparisonFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  added: number;
  removed: number;
}

export interface GitRefComparison {
  left: string;
  right: string;
  mode: 'direct' | 'merge-base';
  mergeBase: string | null;
  files: GitRefComparisonFile[];
  added: number;
  removed: number;
}

export interface GitWorkingTreeFile {
  path: string;
  status: 'staged' | 'unstaged' | 'untracked' | 'conflict';
  staged: boolean;
  unstaged: boolean;
}
export interface GitBranchInfo { name: string; current: boolean; remote: boolean; worktree: boolean; }
export interface GitStashInfo { ref: string; message: string; }
export interface GitPendingCommit { hash: string; subject: string; date: string; }
export interface GitSyncStatus {
  branch: string | null;
  upstream: string | null;
  remote: string | null;
  remotes: string[];
  ahead: number;
  behind: number;
  pending: GitPendingCommit[];
}

export interface GitIndexReport {
  commits: number;
  files: number;
  alreadyKnown: number;
  limited: boolean;
  branches: number;
}

export interface GitSearchHit {
  hash: string;
  /** null for the commit itself (message); a path for one of its file changes. */
  file: string | null;
  subject: string;
  author: string;
  date: string;
  /** git://<hash>/<file>:<line>-<line>, the verifiable reference given to agents. */
  reference: string;
  excerpt: string;
}

/** What NeuralBridge knows about a commit's files. */
export interface CommitRelations {
  files: string[];
  memories: ProfileMemoryRef[];
  tasks: { id: string; prompt: string }[];
}

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  changes: { path: string; status: ChangeStatus }[];
  lastCommit: { hash: string; subject: string; date: string } | null;
}

export const PREFERRED_AGENTS = ['auto', 'claude', 'codex'] as const;
export type PreferredAgent = (typeof PREFERRED_AGENTS)[number];

/**
 * What agents may do in a project's edit runs (read-only runs never change). standard: file edits and the
 * built-in test/build commands; commands: also the user's command list for Claude and the network for
 * Codex's sandbox; full: no permission checks and no Codex sandbox, at the user's explicit risk.
 */
export const PERMISSION_LEVELS = ['standard', 'commands', 'full'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** A command prefix Claude may run in "commands" projects: words only, nothing that chains, expands or globs. */
export const ALLOWED_COMMAND = /^[A-Za-z0-9][A-Za-z0-9 ._/:=@+,-]{0,79}$/;
export const ALLOWED_COMMANDS_MAX = 30;

export type ProjectKind = 'project' | 'workspace';
/** Derived from kind and parent, so the two can never disagree. */
export type ProjectType = 'standalone' | 'workspace' | 'child' | 'nested-workspace';
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = { standalone: 'Projeto', workspace: 'Workspace', child: 'Projeto filho', 'nested-workspace': 'Workspace interno' };
export const projectTypeOf = (kind: ProjectKind, parentProjectId: string | null): ProjectType => (kind === 'workspace' ? (parentProjectId ? 'nested-workspace' : 'workspace') : parentProjectId ? 'child' : 'standalone');

export type DiscoveryClassification = 'CONFIRMED_PROJECT' | 'PROBABLE_PROJECT' | 'WORKSPACE' | 'AUXILIARY_DIRECTORY' | 'UNKNOWN';
export const DISCOVERY_LABEL: Record<DiscoveryClassification, string> = { CONFIRMED_PROJECT: 'Projeto', PROBABLE_PROJECT: 'Provável projeto', WORKSPACE: 'Workspace', AUXILIARY_DIRECTORY: 'Pasta auxiliar', UNKNOWN: 'Indefinido' };
export type DiscoveryGit = { root: string; kind: 'repository' | 'worktree' | 'submodule'; branch: string | null };
export interface DiscoveryCandidate {
  path: string;
  /** Forward slashes; '' for the folder scanned. */
  relativePath: string;
  name: string;
  classification: DiscoveryClassification;
  confidence: number;
  evidence: { signal: string; detail: string; points: number }[];
  technologies: string[];
  git: DiscoveryGit | null;
  parentPath: string | null;
  existingProjectId: string | null;
  overridden: boolean;
  /** Offered ticked in the preview. Nothing is saved until the person confirms. */
  selected: boolean;
}
export interface DiscoveryReport { root: string; candidates: DiscoveryCandidate[]; skipped: { path: string; reason: string }[]; limited: boolean }
/** One line of the confirmed preview. */
export interface DiscoveryChoice { path: string; selected: boolean; classification: DiscoveryClassification; parentPath: string | null }

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  isPrivate: boolean;
  preferredAgent: PreferredAgent;
  permissionLevel: PermissionLevel;
  /** Command prefixes for the "commands" level, e.g. "npm run e2e". */
  allowedCommands: string[];
  stack: StackInfo | null;
  memoryCount: number;
  /** False when the folder was moved or deleted since it was added. */
  exists: boolean;
  kind: ProjectKind;
  parentProjectId: string | null;
  projectType: ProjectType;
  detectionConfidence: number | null;
  /** Where its repository is, if it has one; another project's when the repository is shared. */
  gitRoot: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  rules: string;
  detectedAt: string | null;
  git: GitInfo | null;
  files: string[];
}

/** Fields left undefined are not changed. */
export interface ProjectUpdate {
  name?: string | undefined;
  preferredAgent?: PreferredAgent | undefined;
  rules?: string | undefined;
  isPrivate?: boolean | undefined;
  permissionLevel?: PermissionLevel | undefined;
  allowedCommands?: string[] | undefined;
}
