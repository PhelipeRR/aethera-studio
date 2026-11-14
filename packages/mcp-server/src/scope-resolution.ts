import { posix, win32 } from 'node:path';
import type { Scope } from '@neuralbridge/brain';

export interface ScopeOptions {
  /** --project <id> */
  projectArg?: string | undefined;
  /** Working directory the client started the server in. */
  cwd: string;
  /** false with --no-global. */
  includeGlobal: boolean;
}

export interface ProjectRoot {
  id: string;
  rootPath: string;
}

export interface ResolvedScope {
  scope: Scope;
  matchedBy: 'arg' | 'cwd' | 'none';
}

/**
 * Which memories this server process may use: the --project given, else the registered project whose
 * folder contains the working directory (deepest wins), else global memories only.
 */
export function resolveScope(options: ScopeOptions, projects: readonly ProjectRoot[], platform: NodeJS.Platform = process.platform): ResolvedScope {
  if (options.projectArg !== undefined) {
    const project = projects.find((candidate) => candidate.id === options.projectArg);
    if (!project) throw new Error(`Unknown project "${options.projectArg}". Register it in NeuralBridge first, or omit --project.`);
    return { scope: { kind: 'project', projectId: project.id, includeGlobal: options.includeGlobal }, matchedBy: 'arg' };
  }

  const paths = platform === 'win32' ? win32 : posix;
  const normalise = (value: string) => {
    const resolved = paths.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const cwd = normalise(options.cwd);
  const match = projects
    .map((project) => ({ project, root: normalise(project.rootPath) }))
    .filter(({ root }) => cwd === root || cwd.startsWith(root.endsWith(paths.sep) ? root : root + paths.sep))
    .sort((a, b) => b.root.length - a.root.length)[0];

  if (!match) return { scope: { kind: 'global' }, matchedBy: 'none' };
  return { scope: { kind: 'project', projectId: match.project.id, includeGlobal: options.includeGlobal }, matchedBy: 'cwd' };
}
