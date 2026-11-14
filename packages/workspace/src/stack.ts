import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STACKS, type StackId, type StackInfo } from '@neuralbridge/shared';

export type { StackId, StackInfo };

const IGNORED = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', 'build', '.next', '.nuxt', '.output', 'target', 'vendor', 'coverage', '.venv', 'venv', 'packages-cache']);
const MAX_DEPTH = 3;
const MAX_ENTRIES = 5000;

/** Relative paths (forward slashes) of files up to three folders deep, skipping dependencies and build output. */
export async function scanProject(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (found.length >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_ENTRIES) return;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORED.has(entry.name.toLowerCase())) await walk(join(dir, entry.name), relative, depth + 1);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  };
  await walk(root, '', 0);
  return found.sort();
}

const PACKAGE_HINTS: [StackId, (name: string) => boolean][] = [
  ['typescript', (name) => name === 'typescript'],
  ['react', (name) => name === 'react'],
  ['nextjs', (name) => name === 'next'],
  ['vue', (name) => name === 'vue'],
  ['nuxt', (name) => name === 'nuxt'],
  ['remotion', (name) => name === 'remotion' || name.startsWith('@remotion/')],
  ['electron', (name) => name === 'electron'],
  ['drizzle', (name) => name === 'drizzle-orm'],
  ['prisma', (name) => name === 'prisma' || name === '@prisma/client'],
  ['postgresql', (name) => ['pg', 'postgres', '@neondatabase/serverless', 'pg-promise'].includes(name)],
  ['sqlserver', (name) => ['mssql', 'tedious'].includes(name)],
];

const NUGET_HINTS: [StackId, RegExp][] = [
  ['efcore', /Include="Microsoft\.EntityFrameworkCore|Include="Npgsql\.EntityFrameworkCore/i],
  ['sqlserver', /Include="(Microsoft\.EntityFrameworkCore\.SqlServer|Microsoft\.Data\.SqlClient|System\.Data\.SqlClient)"/i],
  ['postgresql', /Include="Npgsql/i],
];

/**
 * Detects the technologies of a project from manifest files only. Reads package.json, *.csproj,
 * schema.prisma and tsconfig; never reads appsettings or .env (connection strings carry passwords).
 */
export async function detectStack(root: string): Promise<StackInfo> {
  const files = await scanProject(root);
  const evidence: Partial<Record<StackId, string>> = {};
  const mark = (stack: StackId, file: string) => {
    evidence[stack] ??= file;
  };
  const read = (file: string) => readFile(join(root, ...file.split('/')), 'utf8').catch(() => '');

  for (const file of files) {
    const name = file.split('/').pop()?.toLowerCase() ?? '';
    if (name.endsWith('.sln') || name.endsWith('.slnx')) mark('dotnet', file);
    if (name.endsWith('.csproj') || name.endsWith('.fsproj')) {
      mark('dotnet', file);
      const xml = await read(file);
      if (/Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(xml) || /Include="Microsoft\.AspNetCore/i.test(xml)) mark('aspnetcore', file);
      for (const [stack, pattern] of NUGET_HINTS) if (pattern.test(xml)) mark(stack, file);
    }
    if (name === 'package.json') {
      mark('node', file);
      try {
        const manifest = JSON.parse(await read(file)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
        for (const [stack, matches] of PACKAGE_HINTS) if (names.some(matches)) mark(stack, file);
      } catch {
        // unreadable manifest: the file still shows it is a Node project
      }
    }
    if (name === 'tsconfig.json') mark('typescript', file);
    if (name === 'schema.prisma') {
      mark('prisma', file);
      const provider = /provider\s*=\s*"(\w+)"/.exec((await read(file)).replace(/generator[\s\S]*?}/g, ''))?.[1];
      if (provider === 'sqlserver') mark('sqlserver', file);
      if (provider === 'postgresql') mark('postgresql', file);
    }
    if (['pyproject.toml', 'requirements.txt', 'setup.py'].includes(name)) mark('python', file);
  }

  const has = (lockfile: string) => files.includes(lockfile);
  const packageManager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : has('package-lock.json') ? 'npm' : null;
  return { stacks: STACKS.filter((stack) => evidence[stack]), packageManager, evidence };
}
