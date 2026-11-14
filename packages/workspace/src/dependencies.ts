import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ProjectDependency } from '@neuralbridge/shared';

// Dependencies declared in a project's manifests (npm package.json, .NET *.csproj), each with the file that
// declares it. Read-only, bounded, and never through links: links could point anywhere on the machine.

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', 'coverage', 'test-results', '.next', '.nuxt', 'vendor']);
const MAX_DEPTH = 4;
const MAX_MANIFESTS = 100;
const MAX_MANIFEST_BYTES = 256 * 1024;

async function manifests(root: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_MANIFESTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      // Dirent.isDirectory() is false for symbolic links and junctions, which are never followed.
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) await visit(path, depth + 1);
      } else if (entry.isFile() && (entry.name === 'package.json' || entry.name.endsWith('.csproj')) && found.length < MAX_MANIFESTS) {
        found.push(path);
      }
    }
  };
  await visit(root, 0);
  return found;
}

function fromPackageJson(text: string, source: string): ProjectDependency[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const section = (key: string, kind: ProjectDependency['kind']) => {
    const deps = record[key];
    if (typeof deps !== 'object' || deps === null) return [];
    return Object.entries(deps as Record<string, unknown>).map(([name, version]) => ({ name, version: typeof version === 'string' ? version : null, kind, source }));
  };
  return [...section('dependencies', 'runtime'), ...section('devDependencies', 'dev')];
}

function fromCsproj(text: string, source: string): ProjectDependency[] {
  return [...text.matchAll(/<PackageReference\s+([^>]*?)\/?>/g)].flatMap((match) => {
    const attributes = match[1] ?? '';
    const name = /Include="([^"]+)"/.exec(attributes)?.[1];
    if (!name) return [];
    return [{ name, version: /Version="([^"]+)"/.exec(attributes)?.[1] ?? null, kind: 'runtime' as const, source }];
  });
}

export async function readDependencies(root: string): Promise<ProjectDependency[]> {
  const result: ProjectDependency[] = [];
  for (const path of await manifests(root)) {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    if (text.length > MAX_MANIFEST_BYTES) continue;
    const source = relative(root, path).replaceAll('\\', '/');
    result.push(...(path.endsWith('.csproj') ? fromCsproj(text, source) : fromPackageJson(text, source)));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.source.localeCompare(b.source));
}
