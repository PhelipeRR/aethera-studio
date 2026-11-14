import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStack } from '../src/stack.js';
import { gitDiff, gitInfo, gitLineStats } from '../src/git.js';
import { isInsideProject, isSensitiveFile, validateProjectRoot } from '../src/project-paths.js';
import { readProjectFile, relevantFiles } from '../src/project-files.js';

function project(files: Record<string, string> = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-proj-')), 'meu projeto ação');
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  mkdirSync(root, { recursive: true });
  return root;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });

function repo(files: Record<string, string>): string {
  const root = project(files);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'primeiro commit');
  return root;
}

/** Hash of every file, .git included: proves an operation wrote nothing. */
function fingerprint(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(full).update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

describe('validateProjectRoot', () => {
  it('accepts an existing local folder and returns its canonical path', () => {
    const root = project({ 'a.txt': 'x' });
    expect(validateProjectRoot(join(root, 'sub', '..'))).toEqual({ ok: true, path: root });
  });

  it.each([
    ['relative paths', 'meu-projeto'],
    ['UNC network paths', '\\\\servidor\\compartilhado\\projeto'],
    ['device paths', '\\\\?\\C:\\projeto'],
    ['drive roots', 'C:\\'],
    ['the home folder itself', homedir()],
    ['Windows system folders', process.env['SystemRoot'] ?? 'C:\\Windows'],
    ['Program Files', process.env['ProgramFiles'] ?? 'C:\\Program Files'],
    ['missing folders', join(tmpdir(), 'nb-does-not-exist-12345')],
  ])('rejects %s', (_label, path) => {
    expect(validateProjectRoot(path)).toMatchObject({ ok: false, reason: expect.any(String) });
  });

  it('rejects files', () => {
    const root = project({ 'a.txt': 'x' });
    expect(validateProjectRoot(join(root, 'a.txt'))).toMatchObject({ ok: false });
  });
});

describe('isInsideProject', () => {
  it('accepts paths inside, case-insensitively, and rejects escapes with .. or look-alike siblings', () => {
    const root = project({ 'src/app.ts': 'x' });
    expect(isInsideProject(root, 'src/app.ts')).toBe(true);
    expect(isInsideProject(root, join(root.toUpperCase(), 'SRC', 'novo.ts'))).toBe(true);
    expect(isInsideProject(root, '../fora.txt')).toBe(false);
    expect(isInsideProject(root, 'src/../../fora.txt')).toBe(false);
    expect(isInsideProject(root, `${root}-irmao\\x.txt`)).toBe(false);
    expect(isInsideProject(root, '\\\\servidor\\x')).toBe(false);
  });

  it('follows junctions: a link inside the project that points outside is outside', () => {
    const root = project({ 'src/a.ts': 'x' });
    const outside = project({ 'segredo.txt': 'x' });
    symlinkSync(outside, join(root, 'atalho'), 'junction');
    expect(isInsideProject(root, 'atalho/segredo.txt')).toBe(false);
  });
});

describe('isSensitiveFile', () => {
  it.each(['.env', '.env.local', 'config/.env.production', 'id_rsa', 'certs/server.pem', 'app.pfx', 'appsettings.Development.json', '.npmrc', '.git-credentials', 'secrets.json', 'credentials.json'])(
    'treats %s as sensitive',
    (file) => expect(isSensitiveFile(file)).toBe(true),
  );
  it.each(['.env.example', '.env.sample', 'README.md', 'src/env.ts', 'package.json'])('allows %s', (file) => expect(isSensitiveFile(file)).toBe(false));
});

describe('detectStack', () => {
  it('ASP.NET Core with EF Core on SQL Server', async () => {
    const root = project({
      'Loja.sln': '',
      'src/Loja.Api/Loja.Api.csproj':
        '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="9.0.0" /></ItemGroup></Project>',
      'src/Loja.Api/appsettings.json': '{"ConnectionStrings":{"Default":"Server=.;Database=Loja;Password=hunter2"}}',
    });
    const stack = await detectStack(root);
    expect(stack.stacks).toEqual(['dotnet', 'aspnetcore', 'efcore', 'sqlserver']);
    expect(stack.evidence['aspnetcore']).toBe('src/Loja.Api/Loja.Api.csproj');
    expect(JSON.stringify(stack)).not.toContain('hunter2');
  });

  it('.NET with Npgsql is PostgreSQL', async () => {
    const root = project({ 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>' });
    expect((await detectStack(root)).stacks).toEqual(['dotnet', 'efcore', 'postgresql']);
  });

  it('Next.js with TypeScript, Drizzle and Postgres via pnpm', async () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { next: '15', react: '19', 'drizzle-orm': '0.45', pg: '8' }, devDependencies: { typescript: '6' } }),
      'pnpm-lock.yaml': '',
      'tsconfig.json': '{}',
    });
    expect(await detectStack(root)).toMatchObject({ stacks: ['node', 'typescript', 'react', 'nextjs', 'drizzle', 'postgresql'], packageManager: 'pnpm' });
  });

  it('Nuxt and Vue', async () => {
    const root = project({ 'package.json': JSON.stringify({ dependencies: { nuxt: '4', vue: '3' } }), 'package-lock.json': '{}' });
    expect(await detectStack(root)).toMatchObject({ stacks: ['node', 'vue', 'nuxt'], packageManager: 'npm' });
  });

  it('Remotion and Prisma on SQL Server in a nested package', async () => {
    const root = project({
      'apps/video/package.json': JSON.stringify({ dependencies: { remotion: '4', '@remotion/cli': '4', react: '19' } }),
      'apps/api/package.json': JSON.stringify({ dependencies: { '@prisma/client': '6' } }),
      'apps/api/prisma/schema.prisma': 'datasource db {\n  provider = "sqlserver"\n  url = env("DATABASE_URL")\n}',
    });
    expect((await detectStack(root)).stacks).toEqual(['node', 'react', 'remotion', 'prisma', 'sqlserver']);
  });

  it('ignores dependency and build folders', async () => {
    const root = project({ 'node_modules/next/package.json': JSON.stringify({ dependencies: { react: '19' } }), 'bin/Debug/x.csproj': '<Project/>' });
    expect((await detectStack(root)).stacks).toEqual([]);
  });
});

describe('git', () => {
  it('reports branch, changes and the last commit', async () => {
    const root = repo({ 'a.txt': 'um\n', 'b.txt': 'b\n' });
    writeFileSync(join(root, 'a.txt'), 'um\ndois\n');
    writeFileSync(join(root, 'novo.txt'), 'x');
    const info = await gitInfo(root);
    expect(info).toMatchObject({ isRepo: true, branch: 'main', lastCommit: { subject: 'primeiro commit' } });
    expect(info.changes).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'novo.txt', status: 'untracked' },
    ]);
    const diff = await gitDiff(root, 'a.txt');
    expect(diff).toMatchObject({ truncated: false });
    expect(diff.text).toContain('+dois');
  });

  it('counts added and removed lines per tracked file, with binaries and deletions', async () => {
    const root = repo({ 'a.txt': 'um\ndois\ntrês\n', 'b.txt': 'b\n', 'img.bin': '\u0000\u0001' });
    writeFileSync(join(root, 'a.txt'), 'um\nquatro\n');
    execFileSync('cmd', ['/c', 'del', '/q', join(root, 'b.txt')]);
    writeFileSync(join(root, 'img.bin'), '\u0000\u0002\u0003');
    writeFileSync(join(root, 'novo.txt'), 'x\n');
    const before = fingerprint(root);
    expect(await gitLineStats(root)).toEqual([
      { path: 'a.txt', added: 1, removed: 2 },
      { path: 'b.txt', added: 0, removed: 1 },
      { path: 'img.bin', added: 0, removed: 0 },
    ]);
    expect(fingerprint(root)).toBe(before);
  });

  it('has no line counts outside a repository or before the first commit', async () => {
    expect(await gitLineStats(project({ 'a.txt': 'x' }))).toEqual([]);
    const fresh = project({ 'a.txt': 'x\n' });
    git(fresh, 'init', '-q', '-b', 'main');
    expect(await gitLineStats(fresh)).toEqual([]);
  });

  it('says when a folder is not a repository', async () => {
    expect(await gitInfo(project({ 'a.txt': 'x' }))).toEqual({ isRepo: false, branch: null, changes: [], lastCommit: null });
  });

  it('never runs commands configured by the repository (fsmonitor, external diff, textconv)', async () => {
    const root = repo({ 'a.txt': 'um\n', '.gitattributes': 'a.txt diff=evil\n' });
    const marker = join(root, 'PWNED');
    const hook = join(root, '.git', 'evil.sh').replaceAll('\\', '/');
    writeFileSync(hook, `#!/bin/sh\necho x > "${marker.replaceAll('\\', '/')}"\n`);
    // git runs these through a shell: quote the path, which has spaces ("meu projeto ação").
    git(root, 'config', 'core.fsmonitor', `"${hook}"`);
    git(root, 'config', 'diff.external', `"${hook}"`);
    git(root, 'config', 'diff.evil.textconv', `"${hook}"`);
    writeFileSync(join(root, 'a.txt'), 'dois\n');

    // Control: plain git really does run it, so the test below proves something.
    execFileSync('git', ['diff'], { cwd: root });
    expect(existsSync(marker)).toBe(true);
    execFileSync('cmd', ['/c', 'del', '/q', marker]);

    await gitInfo(root);
    await gitDiff(root);
    await gitDiff(root, 'a.txt');
    expect(existsSync(marker)).toBe(false);
  });

  it('does not write anything in the project, .git included', async () => {
    const root = repo({ 'package.json': '{"dependencies":{"react":"19"}}', 'README.md': '# x', 'src/a.ts': 'x' });
    writeFileSync(join(root, 'src/a.ts'), 'y');
    const before = fingerprint(root);
    await detectStack(root);
    await gitInfo(root);
    await gitDiff(root);
    await relevantFiles(root);
    readProjectFile(root, 'README.md');
    expect(fingerprint(root)).toBe(before);
  });
});

describe('project files', () => {
  it('lists the files that describe a project, never secrets', async () => {
    const root = project({ 'README.md': '# x', 'AGENTS.md': 'regras', '.env': 'SECRET=1', '.env.example': 'SECRET=', 'package.json': '{}', 'src/Api/Api.csproj': '<Project/>', 'src/a.ts': 'x' });
    expect(await relevantFiles(root)).toEqual(['AGENTS.md', 'README.md', 'package.json', '.env.example', 'src/Api/Api.csproj']);
  });

  it('reads small text files inside the project only', () => {
    const root = project({ 'README.md': '# Olá', '.env': 'SECRET=1', 'bin.dat': 'a\u0000b', 'big.txt': 'x'.repeat(300 * 1024) });
    expect(readProjectFile(root, 'README.md')).toEqual({ ok: true, content: '# Olá' });
    expect(readProjectFile(root, '.env')).toMatchObject({ ok: false, reason: expect.stringContaining('sensível') });
    expect(readProjectFile(root, '../fora.txt')).toMatchObject({ ok: false, reason: expect.stringContaining('fora do projeto') });
    expect(readProjectFile(root, 'bin.dat')).toMatchObject({ ok: false, reason: expect.stringContaining('binário') });
    expect(readProjectFile(root, 'big.txt')).toMatchObject({ ok: false, reason: expect.stringContaining('grande') });
    expect(readProjectFile(root, 'nao-existe.md')).toMatchObject({ ok: false });
  });
});

describe('gitDiff with untracked files', () => {
  it('shows new files as additions, but never sensitive ones, and still writes nothing', async () => {
    const root = repo({ 'a.txt': 'um\n' });
    writeFileSync(join(root, 'novo.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, '.env'), 'TOKEN=segredo');
    const before = fingerprint(root);
    const plain = await gitDiff(root);
    expect(plain.text).not.toContain('novo.ts');
    const full = await gitDiff(root, undefined, { includeUntracked: true });
    expect(full.text).toContain('+++ b/novo.ts');
    expect(full.text).toContain('+export const x = 1;');
    expect(full.text).toContain('.env');
    expect(full.text).not.toContain('segredo');
    expect(fingerprint(root)).toBe(before);
  });
});
