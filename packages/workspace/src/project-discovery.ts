import { opendir, readFile, realpath, stat } from 'node:fs/promises';
import type { DiscoveryCandidate, DiscoveryClassification, DiscoveryGit, DiscoveryReport } from '@neuralbridge/shared';
import { join, relative } from 'node:path';
import { FRAMEWORK_LABELS, PROJECT_DETECTORS, SKIPPED_FOLDERS, SOURCE_FILE, SOURCE_FOLDERS } from './project-detectors.js';
import { gitRun } from './git.js';

export type { DiscoveryCandidate, DiscoveryClassification, DiscoveryGit, DiscoveryReport };
export interface DiscoveryOverride { classification: DiscoveryClassification; parentPath: string | null }
export interface DiscoveryOptions {
  maxDepth?: number;
  maxEntries?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { scanned: number; path: string }) => void;
  /** Lower-case canonical path -> the person's decision. */
  overrides?: ReadonlyMap<string, DiscoveryOverride>;
  /** Lower-case canonical path -> project already registered there. */
  existing?: ReadonlyMap<string, string>;
}

const CONFIRMED = 60;
const PROBABLE = 30;
const MANIFEST_LIMIT = 256 * 1024;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Git decides, never the presence of the folder: Windows paths compare case-insensitively. */
async function readGit(path: string): Promise<DiscoveryGit | null> {
  const top = await gitRun(path, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return null;
  const root = await realpath(lines(top.stdout)[0] ?? path).catch(() => path);
  const [dir, common, superproject, branch] = await Promise.all([
    gitRun(path, ['rev-parse', '--absolute-git-dir']),
    gitRun(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    gitRun(path, ['rev-parse', '--show-superproject-working-tree']),
    gitRun(path, ['symbolic-ref', '--short', '-q', 'HEAD']),
  ]);
  const kind = lines(superproject.stdout)[0] ? 'submodule' : (lines(dir.stdout)[0] ?? '').replaceAll('\\', '/').toLowerCase() !== (lines(common.stdout)[0] ?? '').replaceAll('\\', '/').toLowerCase() ? 'worktree' : 'repository';
  return { root, kind, branch: lines(branch.stdout)[0] ?? null };
}

async function packageSignals(path: string): Promise<{ points: number; technologies: string[]; workspaces: boolean; detail: string }> {
  try {
    const file = join(path, 'package.json');
    if ((await stat(file)).size > MANIFEST_LIMIT) return { points: 10, technologies: ['Node.js'], workspaces: false, detail: 'package.json grande demais para ler' };
    const manifest = JSON.parse(await readFile(file, 'utf8')) as { name?: unknown; scripts?: unknown; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; workspaces?: unknown };
    const named = typeof manifest.name === 'string' || (typeof manifest.scripts === 'object' && manifest.scripts !== null);
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    const frameworks = Object.keys(FRAMEWORK_LABELS).filter((name) => name in dependencies).map((name) => FRAMEWORK_LABELS[name] as string);
    return { points: named ? 40 : 10, technologies: ['Node.js', ...frameworks], workspaces: manifest.workspaces !== undefined, detail: named ? 'package.json com nome ou scripts' : 'package.json vazio' };
  } catch {
    return { points: 10, technologies: ['Node.js'], workspaces: false, detail: 'package.json ilegível' };
  }
}

type Scored = DiscoveryCandidate & { depth: number; monorepo: boolean };

/**
 * Reads a folder tree and says what looks like a project, with the evidence. It only reads: nothing is
 * installed, built or run, no repository is created, and links are not followed. Nothing is registered here.
 */
export async function discoverProjects(input: string, options: DiscoveryOptions = {}): Promise<DiscoveryReport> {
  const root = await realpath(input);
  const { maxDepth = 8, maxEntries = 200_000, maxDurationMs = 60_000, signal, onProgress } = options;
  const deadline = Date.now() + maxDurationMs;
  const skipped: DiscoveryReport['skipped'] = [];
  const found: Scored[] = [];
  const seen = new Set<string>();
  let limited = false;
  let entries = 0;
  const stop = () => { if (signal?.aborted) throw new Error('cancelled: Varredura cancelada.'); };

  const queue: { path: string; depth: number; inProject: boolean }[] = [{ path: root, depth: 0, inProject: false }];
  for (let next = queue.shift(); next; next = queue.shift()) {
    stop();
    if (Date.now() > deadline || entries > maxEntries) { limited = true; break; }
    const { path, depth, inProject } = next;
    const canonical = await realpath(path).catch(() => path);
    if (seen.has(canonical.toLowerCase())) continue;
    seen.add(canonical.toLowerCase());
    const files: string[] = [];
    const folders: string[] = [];
    let gitMarker = false;
    try {
      for await (const entry of await opendir(path)) {
        entries += 1;
        if (entry.name === '.git') gitMarker = true;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) folders.push(entry.name);
        else if (entry.isFile()) files.push(entry.name);
      }
    } catch {
      skipped.push({ path, reason: 'Pasta inacessível.' });
      continue;
    }
    onProgress?.({ scanned: seen.size, path });

    const evidence: DiscoveryCandidate['evidence'] = [];
    const technologies = new Set<string>();
    let monorepo = false;
    for (const detector of PROJECT_DETECTORS) {
      const file = files.find(detector.matches);
      if (!file) continue;
      evidence.push({ signal: detector.id, detail: `${file} encontrado`, points: detector.points });
      technologies.add(detector.label);
      monorepo ||= detector.monorepo === true;
    }
    if (files.includes('package.json')) {
      const manifest = await packageSignals(path);
      evidence.push({ signal: 'package', detail: manifest.detail, points: manifest.points });
      for (const technology of manifest.technologies) technologies.add(technology);
      monorepo ||= manifest.workspaces;
    }
    let git: DiscoveryGit | null = null;
    if (gitMarker) {
      git = await readGit(path);
      if (git && same(git.root, canonical)) evidence.push({ signal: 'git', detail: `Repositório Git validado (${git.kind})`, points: 60 });
      else if (!git) evidence.push({ signal: 'git-invalid', detail: '.git presente, mas não é um repositório válido', points: 0 });
    }
    const hasSource = files.some((name) => SOURCE_FILE.test(name)) || folders.some((name) => SOURCE_FOLDERS.has(name));
    const manifests = evidence.some((item) => item.points >= 30 && item.signal !== 'git');
    const ownGit = evidence.some((item) => item.signal === 'git');
    if (manifests && !hasSource && !ownGit && !monorepo) evidence.push({ signal: 'no-source', detail: 'Manifesto sem código-fonte: provável cópia ou sobra', points: -30 });
    const sql = files.filter((name) => /\.sql$/i.test(name)).length;
    if (sql > 0 && !hasSource && !ownGit) evidence.push({ signal: 'sql-only', detail: `${sql} script(s) SQL, sem projeto`, points: -20 });
    if (evidence.length === 0) evidence.push({ signal: 'none', detail: 'Nenhum manifesto de projeto identificado', points: 0 });

    const score = evidence.reduce((sum, item) => sum + item.points, 0);
    const classification: DiscoveryClassification = score >= CONFIRMED ? 'CONFIRMED_PROJECT' : score >= PROBABLE ? 'PROBABLE_PROJECT' : score < 0 || !manifests ? 'AUXILIARY_DIRECTORY' : 'UNKNOWN';
    const relativePath = relative(root, path).replaceAll('\\', '/');
    found.push({ path, relativePath, name: relativePath.split('/').at(-1) || (path.split(/[\\/]/).at(-1) ?? path), classification, confidence: clamp(score), evidence, technologies: [...technologies], git, parentPath: null, existingProjectId: options.existing?.get(canonical.toLowerCase()) ?? null, overridden: false, selected: false, depth, monorepo });

    if (depth >= maxDepth) {
      if (!inProject && classification !== 'CONFIRMED_PROJECT' && folders.some((name) => !name.startsWith('.') && !SKIPPED_FOLDERS.has(name))) limited = true;
      continue;
    }
    for (const name of folders) if (!name.startsWith('.') && !SKIPPED_FOLDERS.has(name)) queue.push({ path: join(path, name), depth: depth + 1, inProject: inProject || classification === 'CONFIRMED_PROJECT' });
  }

  const qualifies = (item: Scored) => item.classification === 'CONFIRMED_PROJECT' || item.classification === 'PROBABLE_PROJECT' || item.classification === 'WORKSPACE';
  const ancestorsOf = (item: Scored) => found.filter((other) => other !== item && item.path.toLowerCase().startsWith(`${other.path.toLowerCase()}\\`) || (other !== item && item.path.toLowerCase().startsWith(`${other.path.toLowerCase()}/`)));

  const ownRepository = (item: Scored) => item.git !== null && same(item.git.root, item.path);
  // Deepest first, so a nested workspace counts as one child of the workspace above it.
  for (const item of [...found].sort((a, b) => b.depth - a.depth)) {
    if (ownRepository(item) || ancestorsOf(item).some(ownRepository)) continue;
    const inner = found.filter((other) => qualifies(other) && ancestorsOf(other).includes(item) && !ancestorsOf(other).some((ancestor) => ancestor !== item && ancestor.depth > item.depth && qualifies(ancestor)));
    // A manifest at the top does not make a project of a folder that holds several repositories.
    const repositories = inner.filter((other) => ownRepository(other) || other.classification === 'WORKSPACE').length;
    if (repositories >= 2 || (!qualifies(item) && inner.length >= 2)) {
      item.classification = 'WORKSPACE';
      item.confidence = 80;
      item.evidence.push({ signal: 'children', detail: `Agrupa ${inner.length} projetos`, points: 0 });
    }
  }

  for (const item of found) {
    const override = options.overrides?.get(item.path.toLowerCase());
    if (override) { item.classification = override.classification; item.overridden = true; }
  }
  for (const item of found) {
    const nearest = ancestorsOf(item).filter(qualifies).sort((a, b) => b.depth - a.depth)[0];
    const override = options.overrides?.get(item.path.toLowerCase());
    item.parentPath = override?.parentPath ?? nearest?.path ?? (item.depth > 0 ? root : null);
    const insideSharedRepository = nearest?.git && item.git ? same(nearest.git.root, item.git.root) : false;
    // Members of a monorepo or solution exist, but ticking them all would flood the list.
    const member = !ownRepository(item) && (nearest?.monorepo === true || (nearest !== undefined && (insideSharedRepository || nearest.classification !== 'WORKSPACE')));
    item.selected = (item.overridden ? qualifies(item) : (item.classification === 'CONFIRMED_PROJECT' || item.classification === 'PROBABLE_PROJECT') && !member) || (item.depth === 0 && item.classification === 'WORKSPACE') || (item.existingProjectId !== null && !item.overridden);
  }
  // Inner repositories keep a Git root of their own even when no marker was read for a member folder.
  for (const item of found) {
    if (item.git) continue;
    const nearest = ancestorsOf(item).filter((other) => other.git).sort((a, b) => b.depth - a.depth)[0];
    if (nearest?.git && qualifies(item)) item.git = nearest.git;
  }

  const visible = found.filter((item) => qualifies(item) || item.depth <= 1 || item.overridden);
  return {
    root,
    candidates: visible.map((item) => {
      const candidate: DiscoveryCandidate & Partial<Scored> = { ...item };
      delete candidate.depth;
      delete candidate.monorepo;
      return candidate;
    }),
    skipped,
    limited,
  };
}
