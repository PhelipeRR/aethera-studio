import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, win32 } from 'node:path';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { gitRepositories, memories, projectDiscoveryOverrides, projects, type DatabaseHandle } from '@neuralbridge/database';
import { buildProjectProfile, commitRelations, indexGitHistory, knownCommits, loadProjectProfile, RagEngine, saveProjectProfile, searchGitHistory } from '@neuralbridge/brain';
import { projectTypeOf, type DiscoveryCandidate, type DiscoveryChoice, type DiscoveryClassification, type DiscoveryReport, type GitIndexReport, type GitSearchHit, type ProjectDetail, type ProjectProfile, type ProjectSummary, type ProjectUpdate, type StackInfo } from '@neuralbridge/shared';
import { GitAuthorizationService, type GitOperation, type GitRisk } from './git-authorization';
import { cloneRepository, createProjectFolder, detectStack, discoverProjects, gitApplyPatch, gitCherryPick, gitCommit, gitCommitDiff, gitCompareRefs, gitCreateBranch, gitDeleteBranch, gitDiff, gitBranches, gitLineStats, gitInfo, gitOperationState, gitPush, gitRenameBranch, gitRevert, gitRun, gitStage, gitStashApply, gitStashCreate, gitStashDrop, gitStashes, gitSwitchBranch, gitSyncStatus, gitUnstage, gitWorkingTree, gitResolveOperation, initRepository, isInsideProject, readDependencies, readGitHistory, readProjectFile, relevantFiles, validateGitPatch, validateProjectRoot, type DiscoveryOverride, type ProjectTechnology } from '@neuralbridge/workspace';

type Row = typeof projects.$inferSelect;
type GitWriteContext = { repository: string; commonDir: string; operation: string };
type GitWriteHooks = { onQueued?: (context: GitWriteContext) => void; beforeAction?: (context: GitWriteContext) => void | Promise<void> };

/** Readable, stable id from the folder name: used in MCP --project arguments and URLs. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'projeto';
}

/**
 * Projects the user registered. Reads project folders but never writes to them; all git access is
 * read-only (see @neuralbridge/workspace git.ts).
 */
/** Stored command list; anything unreadable counts as none, never as more access. */
function parseCommands(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function createProjectService({ handle, gitWriteHooks }: { handle: DatabaseHandle | null; gitWriteHooks?: GitWriteHooks }) {
  const authorization = new GitAuthorizationService();
  const gitWriteQueues = new Map<string, Promise<void>>();
  const gitWriteArrivalQueues = new Map<string, Promise<void>>();
  function need(): DatabaseHandle {
    if (!handle) throw new Error('unavailable: O banco de dados está indisponível.');
    return handle;
  }

  function row(id: string): Row {
    const found = need().db.select().from(projects).where(eq(projects.id, id)).get();
    if (!found) throw new Error('not_found: Projeto não encontrado.');
    return found;
  }

  function patchHash(patch: string): string {
    validateGitPatch(patch);
    return createHash('sha256').update(patch, 'utf8').digest('hex');
  }

  async function issueAuthorization(id: string, operation: string, parameters: Record<string, string | string[]>) {
    const project = row(id);
    const info = await gitInfo(project.rootPath);
    const workingTree = await gitWorkingTree(project.rootPath);
    const scopedPaths = operation === 'stage' || operation === 'unstage' ? new Set(parameters.paths ?? []) : null;
    const changes = workingTree.filter((change) => !scopedPaths || scopedPaths.has(change.path)).map((change) => `${change.path}:${change.status}:${change.staged}:${change.unstaged}`).sort();
    const request = { repository: project.rootPath, operation: operation as GitOperation, risk: operation === 'branch-delete' ? 'destructive' as GitRisk : 'reversible' as GitRisk, parameters, stateFingerprint: JSON.stringify({ branch: info.branch, lastCommit: info.lastCommit?.hash ?? null, changes }) };
    return { request, grant: authorization.issue(request) };
  }

  async function consume(id: string, operation: string, parameters: Record<string, string | string[]>, token: string): Promise<void> {
    const { request } = await issueAuthorization(id, operation, parameters);
    authorization.consume(token, request);
  }

  async function protectedWrite<T>(id: string, operation: string, parameters: Record<string, string | string[]>, token: string, action: (root: string) => Promise<T>): Promise<T> {
    const root = row(id).rootPath;
    const rootKey = root.toLowerCase();
    const previousArrival = gitWriteArrivalQueues.get(rootKey) ?? Promise.resolve();
    let releaseArrival!: () => void;
    const arrivalGate = new Promise<void>((resolve) => { releaseArrival = resolve; });
    const queuedArrival = previousArrival.then(() => arrivalGate);
    gitWriteArrivalQueues.set(rootKey, queuedArrival);
    await previousArrival;
    try {
      const commonDirResult = await gitRun(root, ['rev-parse', '--git-common-dir']);
      const rawCommonDir = commonDirResult.code === 0 ? commonDirResult.stdout.trim() : root;
      const commonDir = realpathSync(isAbsolute(rawCommonDir) ? rawCommonDir : win32.resolve(root, rawCommonDir)).toLowerCase();
      const previous = gitWriteQueues.get(commonDir) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const queued = previous.then(() => gate);
      gitWriteQueues.set(commonDir, queued);
      const context = { repository: root, commonDir, operation };
      gitWriteHooks?.onQueued?.(context);
      await previous;
      try {
        await gitWriteHooks?.beforeAction?.(context);
        await consume(id, operation, parameters, token);
        return await action(root);
      } finally {
        release();
        if (gitWriteQueues.get(commonDir) === queued) gitWriteQueues.delete(commonDir);
      }
    } finally {
      releaseArrival();
      if (gitWriteArrivalQueues.get(rootKey) === queuedArrival) gitWriteArrivalQueues.delete(rootKey);
    }
  }

  function memoryCounts(): Map<string, number> {
    return new Map(
      need()
        .db.select({ projectId: memories.projectId, n: sql<number>`count(*)` })
        .from(memories)
        .where(isNull(memories.deletedAt))
        .groupBy(memories.projectId)
        .all()
        .flatMap((entry) => (entry.projectId ? [[entry.projectId, entry.n] as const] : [])),
    );
  }

  const repositoryRoots = () => new Map(need().db.select({ id: gitRepositories.id, root: gitRepositories.gitRoot }).from(gitRepositories).all().map((entry) => [entry.id, entry.root]));

  /** Saves where the repository of a folder is, once per repository however many projects share it. */
  async function linkRepository(id: string, rootPath: string): Promise<void> {
    const top = await gitRun(rootPath, ['rev-parse', '--show-toplevel']);
    const db = need().db;
    if (top.code !== 0) {
      db.update(projects).set({ gitRepositoryId: null }).where(eq(projects.id, id)).run();
      return;
    }
    const gitRoot = realpathSync(top.stdout.trim());
    const found = db.select({ id: gitRepositories.id }).from(gitRepositories).all().find((entry) => db.select().from(gitRepositories).where(eq(gitRepositories.id, entry.id)).get()?.gitRoot.toLowerCase() === gitRoot.toLowerCase());
    const repositoryId = found?.id ?? randomUUID();
    if (!found) db.insert(gitRepositories).values({ id: repositoryId, gitRoot, lastVerifiedAt: new Date().toISOString() }).run();
    db.update(projects).set({ gitRepositoryId: repositoryId }).where(eq(projects.id, id)).run();
  }

  function newId(name: string): string {
    const taken = new Set(need().db.select({ id: projects.id }).from(projects).all().map((entry) => entry.id));
    const base = slugify(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** The project that holds a repository's commits, so a shared repository is indexed once. */
  function gitOwner(project: Row): Row {
    if (!project.gitRepositoryId) return project;
    const rows = need().db.select().from(projects).where(eq(projects.gitRepositoryId, project.gitRepositoryId)).orderBy(asc(projects.id)).all();
    const gitRoot = repositoryRoots().get(project.gitRepositoryId)?.toLowerCase();
    return rows.find((entry) => entry.rootPath.toLowerCase() === gitRoot) ?? rows[0] ?? project;
  }

  /** The folder of the project inside its repository; '' when they are the same. */
  function repositoryPrefix(project: Row): string {
    const gitRoot = project.gitRepositoryId ? repositoryRoots().get(project.gitRepositoryId) : undefined;
    if (!gitRoot || gitRoot.toLowerCase() === project.rootPath.toLowerCase()) return '';
    return win32.relative(gitRoot, project.rootPath).replaceAll('\\', '/');
  }

  const childrenOf = (id: string) => need().db.select().from(projects).where(eq(projects.parentProjectId, id)).all();
  function descendantsOf(id: string): Row[] {
    const found: Row[] = [];
    for (const stack = childrenOf(id); stack.length; ) {
      const next = stack.pop();
      if (!next || found.some((item) => item.id === next.id)) continue;
      found.push(next);
      stack.push(...childrenOf(next.id));
    }
    return found;
  }

  let discovery: AbortController | null = null;
  const lastReports = new Map<string, DiscoveryReport>();

  function summary(project: Row, counts: Map<string, number>, roots = repositoryRoots()): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      isPrivate: project.isPrivate,
      preferredAgent: project.preferredAgent,
      permissionLevel: project.permissionLevel,
      allowedCommands: parseCommands(project.allowedCommands),
      stack: project.stack ? (JSON.parse(project.stack) as StackInfo) : null,
      memoryCount: counts.get(project.id) ?? 0,
      exists: existsSync(project.rootPath),
      kind: project.kind,
      parentProjectId: project.parentProjectId,
      projectType: projectTypeOf(project.kind, project.parentProjectId),
      detectionConfidence: project.detectionConfidence,
      gitRoot: project.gitRepositoryId ? (roots.get(project.gitRepositoryId) ?? null) : null,
    };
  }

  async function detail(id: string): Promise<ProjectDetail> {
    const project = row(id);
    const base = summary(project, memoryCounts());
    return {
      ...base,
      rules: project.rules,
      detectedAt: project.detectedAt,
      git: base.exists ? await gitInfo(project.rootPath) : null,
      files: base.exists ? await relevantFiles(project.rootPath) : [],
    };
  }

  const refreshing = new Map<string, Promise<ProjectProfile>>();
  const indexingGit = new Map<string, Promise<GitIndexReport & { isRepo: boolean }>>();

  function insideOrThrow(root: string, path: string): void {
    if (!isInsideProject(root, path)) throw new Error('forbidden: Caminho fora do projeto.');
  }

  return {
    list(): ProjectSummary[] {
      const counts = memoryCounts();
      return need()
        .db.select()
        .from(projects)
        .orderBy(asc(projects.name))
        .all()
        .map((project) => summary(project, counts));
    },

    async add(path: string): Promise<ProjectDetail> {
      const db = need().db;
      const check = validateProjectRoot(path);
      if (!check.ok) throw new Error(`invalid: ${check.reason}`);
      const existing = db.select({ rootPath: projects.rootPath }).from(projects).all();
      if (existing.some((entry) => entry.rootPath.toLowerCase() === check.path.toLowerCase())) {
        throw new Error('conflict: Esta pasta já está cadastrada como projeto.');
      }
      const name = win32.basename(check.path);
      const taken = new Set(db.select({ id: projects.id }).from(projects).all().map((entry) => entry.id));
      const base = slugify(name);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const stack = await detectStack(check.path);
      db.insert(projects).values({ id, name, rootPath: check.path, stack: JSON.stringify(stack), detectedAt: new Date().toISOString() }).run();
      await linkRepository(id, check.path);
      return detail(id);
    },

    get: detail,

    async refresh(id: string): Promise<ProjectDetail> {
      const project = row(id);
      if (existsSync(project.rootPath)) {
        const stack = await detectStack(project.rootPath);
        need().db.update(projects).set({ stack: JSON.stringify(stack), detectedAt: new Date().toISOString() }).where(eq(projects.id, id)).run();
      }
      return detail(id);
    },

    async update(id: string, changes: ProjectUpdate): Promise<ProjectDetail> {
      row(id);
      const { allowedCommands, ...rest } = changes;
      const commands = allowedCommands === undefined ? undefined : JSON.stringify([...new Set(allowedCommands.map((command) => command.trim()).filter(Boolean))]);
      need()
        .db.update(projects)
        .set({ ...rest, ...(commands === undefined ? {} : { allowedCommands: commands }), updatedAt: new Date().toISOString() })
        .where(eq(projects.id, id))
        .run();
      return detail(id);
    },

    /** What removing the project would delete, for the confirmation dialog. */
    impact(id: string): { memories: number } {
      row(id);
      return { memories: memoryCounts().get(id) ?? 0 };
    },

    /** Removes the project and, through the foreign key, its memories. The folder is not touched. */
    remove(id: string): { removed: true; memories: number } {
      const count = this.impact(id).memories;
      const removed = row(id);
      // Projects inside it stay registered, one level up.
      need().db.update(projects).set({ parentProjectId: removed.parentProjectId }).where(eq(projects.parentProjectId, id)).run();
      need().db.delete(projects).where(eq(projects.id, id)).run();
      return { removed: true, memories: count };
    },

    /** The last technical profile built for the project (Phase 21), or null before the first. */
    profile(id: string): ProjectProfile | null {
      row(id);
      return loadProjectProfile(need(), id);
    },

    /**
     * Rebuilds the profile: the file index is updated by delta (only changed files are read), the manifests
     * are read again, and the result says what changed. Concurrent requests for a project share one run.
     */
    refreshProfile(id: string): Promise<ProjectProfile> {
      const running = refreshing.get(id);
      if (running) return running;
      const run = (async () => {
        const project = row(id);
        if (!existsSync(project.rootPath)) throw new Error('not_found: A pasta do projeto não existe mais.');
        const handle = need();
        const engine = new RagEngine(handle);
        // Children first: their files stay searchable while the parent lets go of them.
        const inside = descendantsOf(id);
        for (const child of childrenOf(id)) if (existsSync(child.rootPath) && isInsideProject(project.rootPath, child.rootPath)) await this.refreshProfile(child.id);
        const exclude = inside.filter((child) => isInsideProject(project.rootPath, child.rootPath)).map((child) => win32.relative(project.rootPath, child.rootPath).replaceAll('\\', '/'));
        const index = await engine.indexProject(id, project.rootPath, { exclude });
        const profile = buildProjectProfile(handle, {
          projectId: id,
          stack: project.stack ? (JSON.parse(project.stack) as StackInfo) : null,
          dependencies: await readDependencies(project.rootPath),
          index,
          previous: loadProjectProfile(handle, id),
          now: new Date().toISOString(),
        });
        saveProjectProfile(handle, profile);
        return profile;
      })().finally(() => refreshing.delete(id));
      refreshing.set(id, run);
      return run;
    },

    /** Phase 25: indexes new commits of every local branch (read-only, bounded); one run per project at a time. */
    indexGit(id: string): Promise<GitIndexReport & { isRepo: boolean }> {
      const running = indexingGit.get(id);
      if (running) return running;
      const owner = gitOwner(row(id));
      if (owner.id !== id) return this.indexGit(owner.id);
      const run = (async () => {
        const project = row(id);
        if (!existsSync(project.rootPath)) throw new Error('not_found: A pasta do projeto não existe mais.');
        const handle = need();
        const history = await readGitHistory(project.rootPath, { known: knownCommits(handle, id) });
        if (!history.isRepo) return { isRepo: false, commits: 0, files: 0, alreadyKnown: 0, limited: false, branches: 0 };
        return { isRepo: true, ...indexGitHistory(handle, id, history) };
      })().finally(() => indexingGit.delete(id));
      indexingGit.set(id, run);
      return run;
    },

    searchGit(id: string, query: string): GitSearchHit[] {
      return searchGitHistory(need(), gitOwner(row(id)).id, query);
    },

    async history(id: string, cursor?: string) {
      const project = row(id);
      if (!existsSync(project.rootPath)) return { isRepo: false, branches: [], commits: [], limited: false };
      const prefix = repositoryPrefix(project);
      const history = await readGitHistory(project.rootPath, { known: new Set(), maxCommits: 200, ...(cursor ? { cursor } : {}) });
      if (!prefix) return history;
      return { ...history, commits: history.commits.filter((commit) => commit.files.some((file) => file.path.startsWith(`${prefix}/`))) };
    },
    async compare(id: string, left: string, right: string, mode: 'direct' | 'merge-base') {
      const project = row(id);
      if (!existsSync(project.rootPath)) throw new Error('not_found: A pasta do projeto não existe mais.');
      return gitCompareRefs(project.rootPath, left, right, mode);
    },
    async syncStatus(id: string) { return gitSyncStatus(row(id).rootPath); },

    /** Reads a folder and proposes what to register. Nothing is saved, and it only reads the folder. */
    async discover(path: string, onProgress?: (scanned: number) => void): Promise<DiscoveryReport> {
      const check = validateProjectRoot(path);
      if (!check.ok) throw new Error(`invalid: ${check.reason}`);
      discovery?.abort();
      const controller = new AbortController();
      discovery = controller;
      const overrides = new Map<string, DiscoveryOverride>(need().db.select().from(projectDiscoveryOverrides).all().map((entry) => [entry.path, { classification: entry.classification as DiscoveryClassification, parentPath: entry.parentPath }]));
      const existing = new Map(need().db.select({ id: projects.id, rootPath: projects.rootPath }).from(projects).all().map((entry) => [entry.rootPath.toLowerCase(), entry.id]));
      try {
        const report = await discoverProjects(check.path, { signal: controller.signal, overrides, existing, ...(onProgress ? { onProgress: ({ scanned }) => onProgress(scanned) } : {}) });
        lastReports.set(report.root.toLowerCase(), report);
        return report;
      } finally {
        if (discovery === controller) discovery = null;
      }
    },

    cancelDiscovery(): { ok: true } {
      discovery?.abort();
      return { ok: true };
    },

    /** Saves what the person confirmed. Registered projects keep their id and settings. */
    async confirmDiscovery(rootPath: string, choices: readonly DiscoveryChoice[]): Promise<{ created: string[]; linked: string[] }> {
      const check = validateProjectRoot(rootPath);
      if (!check.ok) throw new Error(`invalid: ${check.reason}`);
      const scanned = check.path;
      const inside = (path: string) => path.toLowerCase() === scanned.toLowerCase() || isInsideProject(scanned, path);
      for (const choice of choices) if (!inside(choice.path) || (choice.parentPath !== null && !inside(choice.parentPath))) throw new Error('forbidden: Caminho fora da pasta analisada.');
      const detected = new Map<string, DiscoveryCandidate>(lastReports.get(scanned.toLowerCase())?.candidates.map((candidate) => [candidate.path.toLowerCase(), candidate]) ?? []);
      const db = need().db;
      const created: string[] = [];
      const linked: string[] = [];
      const ids = new Map(db.select({ id: projects.id, rootPath: projects.rootPath }).from(projects).all().map((entry) => [entry.rootPath.toLowerCase(), entry.id]));
      const chosen = choices.filter((choice) => choice.selected).sort((a, b) => a.path.length - b.path.length);
      const canonical = chosen.map((choice) => {
        const valid = validateProjectRoot(choice.path);
        if (!valid.ok) throw new Error(`invalid: ${choice.path}: ${valid.reason}`);
        return { ...choice, path: valid.path };
      });
      need().sqlite.transaction(() => {
        for (const choice of choices) {
          const was = detected.get(choice.path.toLowerCase());
          if (!was || (was.classification === choice.classification && was.parentPath === choice.parentPath)) continue;
          const values = { classification: choice.classification, parentPath: choice.parentPath };
          db.insert(projectDiscoveryOverrides).values({ path: choice.path.toLowerCase(), ...values }).onConflictDoUpdate({ target: projectDiscoveryOverrides.path, set: values }).run();
        }
        for (const choice of canonical) {
          const was = detected.get(choice.path.toLowerCase());
          const kind = choice.classification === 'WORKSPACE' ? ('workspace' as const) : ('project' as const);
          // Nearest registered folder above it; a parent left unticked is skipped, not a broken link.
          const parent = [...ids.entries()].filter(([path]) => choice.path.toLowerCase().startsWith(`${path}\\`) && inside(path)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null;
          const parentId = choice.parentPath && ids.get(choice.parentPath.toLowerCase()) ? (ids.get(choice.parentPath.toLowerCase()) ?? null) : parent;
          const fields = { kind, detectionConfidence: was?.confidence ?? null, detectionEvidence: was ? JSON.stringify(was.evidence) : null, detectedAt: new Date().toISOString() };
          const known = ids.get(choice.path.toLowerCase());
          if (known) {
            // A scan sees nothing above its own root: the place of that folder in the hierarchy stays as it was.
            const isRoot = choice.path.toLowerCase() === scanned.toLowerCase();
            db.update(projects).set(isRoot ? fields : { ...fields, parentProjectId: parentId }).where(eq(projects.id, known)).run();
            linked.push(known);
            continue;
          }
          const name = win32.basename(choice.path);
          const id = newId(name);
          db.insert(projects).values({ id, name, rootPath: choice.path, detectionSource: 'scan', parentProjectId: parentId, ...fields }).run();
          ids.set(choice.path.toLowerCase(), id);
          created.push(id);
        }
      }).immediate();
      for (const choice of canonical) {
        const id = ids.get(choice.path.toLowerCase());
        if (id) await linkRepository(id, choice.path);
      }
      // Technology detection reads whole trees: it should not hold the confirmation up.
      for (const id of created) void this.refresh(id).catch((error: unknown) => console.error('[projects] stack detection failed', error));
      return { created, linked };
    },

    /** Changes the logical link only: no file moves. */
    move(id: string, parentId: string | null): { ok: true } {
      row(id);
      if (parentId !== null) {
        row(parentId);
        if (parentId === id || descendantsOf(id).some((item) => item.id === parentId)) throw new Error('invalid: Mover aqui criaria um ciclo na hierarquia.');
      }
      need().db.update(projects).set({ parentProjectId: parentId, updatedAt: new Date().toISOString() }).where(eq(projects.id, id)).run();
      return { ok: true };
    },

    setKind(id: string, kind: 'project' | 'workspace'): { ok: true } {
      row(id);
      need().db.update(projects).set({ kind, updatedAt: new Date().toISOString() }).where(eq(projects.id, id)).run();
      return { ok: true };
    },

    /** Current branch per project, each repository read once. */
    async gitState(): Promise<Record<string, { branch: string | null; own: boolean }>> {
      const rows = need().db.select().from(projects).all().filter((project) => project.gitRepositoryId);
      const roots = repositoryRoots();
      const branches = new Map<string, Promise<string | null>>();
      const state: Record<string, { branch: string | null; own: boolean }> = {};
      for (const project of rows) {
        const key = project.gitRepositoryId ?? '';
        const root = roots.get(key);
        if (!root || !existsSync(root)) continue;
        if (!branches.has(key)) branches.set(key, gitInfo(root).then((info) => info.branch));
        state[project.id] = { branch: (await branches.get(key)) ?? null, own: root.toLowerCase() === project.rootPath.toLowerCase() };
      }
      return state;
    },

    async create(input: { name: string; parent: string; technology: ProjectTechnology; parentProjectId: string | null; allowNested: boolean }): Promise<{ id: string }> {
      const check = validateProjectRoot(input.parent);
      if (!check.ok) throw new Error(`invalid: ${check.reason}`);
      if (input.parentProjectId) row(input.parentProjectId);
      const { path } = await createProjectFolder({ parent: check.path, name: input.name, technology: input.technology, allowNested: input.allowNested });
      const id = (await this.add(path)).id;
      if (input.parentProjectId) this.move(id, input.parentProjectId);
      return { id };
    },

    async clone(input: { url: string; parent: string; name: string; parentProjectId: string | null }): Promise<{ id: string }> {
      const check = validateProjectRoot(input.parent);
      if (!check.ok) throw new Error(`invalid: ${check.reason}`);
      if (input.parentProjectId) row(input.parentProjectId);
      if (/[<>:"/\\|?*]/.test(input.name) || input.name === '.' || input.name === '..') throw new Error('invalid: Nome de pasta inválido.');
      const target = win32.join(check.path, input.name);
      await cloneRepository(input.url, target);
      const id = (await this.add(target)).id;
      if (input.parentProjectId) this.move(id, input.parentProjectId);
      return { id };
    },

    async initGit(id: string, allowNested: boolean): Promise<{ ok: true }> {
      const project = row(id);
      await initRepository(project.rootPath, { allowNested });
      await linkRepository(id, project.rootPath);
      return { ok: true };
    },

    /** Search over a workspace: its own files plus each project inside, naming the source of every hit. Private projects stay out. */
    searchWorkspace(id: string, query: string, limit = 8) {
      const rag = new RagEngine(need());
      const sources = [row(id), ...descendantsOf(id).filter((project) => !project.isPrivate)];
      const hits = sources.flatMap((project) => rag.search(project.id, query, limit).map((hit) => ({ ...hit, projectName: project.name })));
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    commitRelations(id: string, hash: string) {
      row(id);
      return commitRelations(need(), id, hash);
    },

    async lineStats(id: string): Promise<{ path: string; added: number; removed: number }[]> {
      const project = row(id);
      return existsSync(project.rootPath) ? gitLineStats(project.rootPath) : [];
    },

    /** Root folder of a project, for checks made elsewhere (a task's outputs). */
    root(id: string): string {
      return row(id).rootPath;
    },

    async diff(id: string, path?: string, commit?: string): Promise<{ text: string; truncated: boolean }> {
      const project = row(id);
      if (path !== undefined) insideOrThrow(project.rootPath, path);
      return commit ? gitCommitDiff(project.rootPath, commit, path) : gitDiff(project.rootPath, path);
    },

    async authorize(id: string, operation: string, parameters: Record<string, string | string[]>) { return (await issueAuthorization(id, operation, parameters)).grant; },
    async authorizePatch(id: string, patch: string) { return (await issueAuthorization(id, 'apply-patch', { patchHash: patchHash(patch) })).grant; },
    async applyPatch(id: string, patch: string, token: string) {
      const hash = patchHash(patch);
      return protectedWrite(id, 'apply-patch', { patchHash: hash }, token, async (root) => { await gitApplyPatch(root, patch); return { ok: true as const }; });
    },
    async workingTree(id: string) { return gitWorkingTree(row(id).rootPath); },
    async stage(id: string, paths: string[], token: string) { return protectedWrite(id, 'stage', { paths }, token, async (root) => { await gitStage(root, paths); return { ok: true as const }; }); },
    async unstage(id: string, paths: string[], token: string) { return protectedWrite(id, 'unstage', { paths }, token, async (root) => { await gitUnstage(root, paths); return { ok: true as const }; }); },
    async branches(id: string) { return gitBranches(row(id).rootPath); },
    async createBranch(id: string, name: string, token: string) { return protectedWrite(id, 'branch-create', { name }, token, async (root) => { await gitCreateBranch(root, name); return { ok: true as const }; }); },
    async switchBranch(id: string, name: string, token: string) { return protectedWrite(id, 'branch-switch', { name }, token, async (root) => { await gitSwitchBranch(root, name); return { ok: true as const }; }); },
    async renameBranch(id: string, oldName: string, newName: string, token: string) { return protectedWrite(id, 'branch-rename', { oldName, newName }, token, async (root) => { await gitRenameBranch(root, oldName, newName); return { ok: true as const }; }); },
    async deleteBranch(id: string, name: string, token: string) { return protectedWrite(id, 'branch-delete', { name }, token, async (root) => { await gitDeleteBranch(root, name); return { ok: true as const }; }); },
    async stashes(id: string) { return gitStashes(row(id).rootPath); },
    async createStash(id: string, message: string, includeUntracked: boolean, token: string) { return protectedWrite(id, 'stash', { message, includeUntracked: String(includeUntracked) }, token, async (root) => { await gitStashCreate(root, message, includeUntracked); return { ok: true as const }; }); },
    async applyStash(id: string, ref: string, pop: boolean, token: string) { return protectedWrite(id, 'stash', { ref, pop: String(pop) }, token, async (root) => { await gitStashApply(root, ref, pop); return { ok: true as const }; }); },
    async dropStash(id: string, ref: string, token: string) { return protectedWrite(id, 'stash', { ref }, token, async (root) => { await gitStashDrop(root, ref); return { ok: true as const }; }); },
    async commit(id: string, message: string, token: string) { return protectedWrite(id, 'commit', { message }, token, async (root) => { await gitCommit(root, message); return { ok: true as const }; }); },
    async push(id: string, remote: string | undefined, token: string) { return protectedWrite(id, 'push', { remote: remote ?? '' }, token, async (root) => { await gitPush(root, remote); return { ok: true as const }; }); },
    async operationState(id: string) { return gitOperationState(row(id).rootPath); },
    async revert(id: string, commit: string, mainline: number | undefined, token: string) { return protectedWrite(id, 'revert', { commit, mainline: String(mainline ?? '') }, token, async (root) => { await gitRevert(root, commit, mainline); return { ok: true as const }; }); },
    async cherryPick(id: string, commit: string, mainline: number | undefined, token: string) { return protectedWrite(id, 'cherry-pick', { commit, mainline: String(mainline ?? '') }, token, async (root) => { await gitCherryPick(root, commit, mainline); return { ok: true as const }; }); },
    async resolveOperation(id: string, operation: 'revert' | 'cherry-pick', action: 'continue' | 'abort', token: string) { return protectedWrite(id, operation, { action }, token, async (root) => { await gitResolveOperation(root, operation, action); return { ok: true as const }; }); },

    readFile(id: string, path: string) {
      return readProjectFile(row(id).rootPath, path);
    },
  };
}
