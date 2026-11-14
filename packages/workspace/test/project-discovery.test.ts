import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { discoverProjects, type DiscoveryCandidate } from '../src/project-discovery.js';

let root: string;
const write = (path: string, content = '') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(root, dir) });
function repository(dir: string) {
  mkdirSync(join(root, dir), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  write(`${dir}/README.md`, 'x');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'inicial');
}
const byName = (candidates: DiscoveryCandidate[]) => Object.fromEntries(candidates.map((candidate) => [candidate.relativePath, candidate]));
const discover = async (options: Parameters<typeof discoverProjects>[1] = {}) => byName((await discoverProjects(root, options)).candidates);

beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-discovery-'))); });

describe('project discovery', () => {
  it('treats a validated repository as the main evidence', async () => {
    repository('backoffice');
    const found = await discover();
    expect(found['backoffice']).toMatchObject({ classification: 'CONFIRMED_PROJECT', selected: true, git: { root: join(root, 'backoffice'), kind: 'repository' } });
    expect(found['backoffice']?.evidence.some((item) => item.signal === 'git')).toBe(true);
  });

  it('does not take an invalid .git folder as proof', async () => {
    mkdirSync(join(root, 'quebrado', '.git'), { recursive: true });
    write('quebrado/notas.txt', 'x');
    const found = await discover();
    expect(found['quebrado']?.classification).not.toBe('CONFIRMED_PROJECT');
    expect(found['quebrado']?.git).toBeNull();
  });

  it('recognises a worktree through its .git file', async () => {
    repository('app');
    git('app', 'worktree', 'add', '-q', '-b', 'outra', join(root, 'app-wt'));
    expect((await discover())['app-wt']?.git?.kind).toBe('worktree');
  });

  it('finds repositories inside a project and inside a repository', async () => {
    repository('RNU');
    repository('RNU/Ru');
    write('RNU/database/schema.sql', 'select 1');
    const found = await discover();
    expect(found['RNU/Ru']).toMatchObject({ classification: 'CONFIRMED_PROJECT', parentPath: join(root, 'RNU') });
  });

  it('sees a folder of projects as a workspace, with or without Git of its own', async () => {
    repository('a');
    repository('b');
    expect((await discover())['']).toMatchObject({ classification: 'WORKSPACE' });
    git('', 'init', '-q', '-b', 'main');
    const owned = await discover();
    expect(owned['a']?.git?.root).toBe(join(root, 'a'));
    expect(owned['b']?.classification).toBe('CONFIRMED_PROJECT');
  });

  it('sees a folder of repositories as a workspace even with a stray manifest at its root', async () => {
    repository('a');
    repository('b');
    write('Solta.sln');
    write('Program.cs');
    expect((await discover())['']).toMatchObject({ classification: 'WORKSPACE', selected: true });
  });

  it('does not call a folder inside a repository a workspace', async () => {
    repository('ms');
    write('ms/src/Um/Um.csproj');
    write('ms/src/Um/A.cs');
    write('ms/src/Dois/Dois.csproj');
    write('ms/src/Dois/B.cs');
    const found = await discover();
    expect(found['ms/src']?.classification).not.toBe('WORKSPACE');
    expect(found['ms/src/Um']?.parentPath).toBe(join(root, 'ms'));
  });

  it('offers a registered project ticked, whatever the folder looks like now', async () => {
    write('INS/notas.txt');
    const found = await discover({ existing: new Map([[join(root, 'INS').toLowerCase(), 'ins']]) });
    expect(found['INS']).toMatchObject({ existingProjectId: 'ins', selected: true });
  });

  it('does not warn about depth inside a project it already found', async () => {
    repository('app');
    write('app/a/b/c/d/e.ts');
    expect((await discoverProjects(root, { maxDepth: 2 })).limited).toBe(false);
  });

  it('nests a workspace inside a workspace', async () => {
    repository('grupo/um');
    repository('grupo/dois');
    repository('solto');
    const found = await discover();
    expect(found['grupo']).toMatchObject({ classification: 'WORKSPACE', parentPath: root });
    expect(found['grupo/um']?.parentPath).toBe(join(root, 'grupo'));
  });

  it('reads manifests without Git, and names the technology', async () => {
    write('front/package.json', JSON.stringify({ name: 'front', dependencies: { next: '15', react: '19' } }));
    write('front/src/index.tsx');
    write('api/Api.csproj', '<Project/>');
    write('api/Program.cs');
    write('py/pyproject.toml');
    write('py/main.py');
    write('rs/Cargo.toml');
    write('rs/src/main.rs');
    write('go/go.mod');
    write('go/main.go');
    write('java/pom.xml');
    write('java/src/App.java');
    const found = await discover();
    expect(found['front']?.technologies).toEqual(expect.arrayContaining(['Node.js', 'Next.js', 'React']));
    expect(found['api']?.technologies).toContain('.NET');
    expect(found['py']?.technologies).toContain('Python');
    expect(found['rs']?.technologies).toContain('Rust');
    expect(found['go']?.technologies).toContain('Go');
    expect(found['java']?.technologies).toContain('Java');
    for (const name of ['front', 'api', 'py', 'rs', 'go', 'java']) expect(found[name]?.classification).not.toBe('UNKNOWN');
  });

  it('keeps the members of a monorepo, not pre-selected', async () => {
    repository('mono');
    write('mono/pnpm-workspace.yaml', 'packages:\n  - packages/*');
    write('mono/package.json', JSON.stringify({ name: 'mono' }));
    write('mono/packages/lib/package.json', JSON.stringify({ name: 'lib', scripts: {} }));
    write('mono/packages/lib/src/index.ts');
    const found = await discover();
    expect(found['mono']?.selected).toBe(true);
    expect(found['mono/packages/lib']).toMatchObject({ selected: false, parentPath: join(root, 'mono') });
    expect(found['mono/packages/lib']?.git?.root).toBe(join(root, 'mono'));
  });

  it('keeps a .NET solution as one project with its members inside', async () => {
    repository('sln');
    write('sln/App.sln');
    write('sln/Web/Web.csproj');
    write('sln/Web/Program.cs');
    write('sln/Core/Core.csproj');
    write('sln/Core/Lib.cs');
    const found = await discover();
    expect(found['sln']?.selected).toBe(true);
    expect(found['sln/Web']?.selected).toBe(false);
  });

  it('leaves auxiliary folders out by default, by content and not by name', async () => {
    repository('app');
    write('sql/a.sql', 'select 1');
    write('sql/b.sql', 'select 2');
    write('backups/copia.zip');
    write('wiki/README.md');
    const found = await discover();
    expect(found['sql']).toMatchObject({ classification: 'AUXILIARY_DIRECTORY', selected: false });
    expect(found['backups']?.selected).toBe(false);
    expect(found['wiki']?.selected).toBe(false);
  });

  it('finds a real project inside a folder named like an auxiliary one', async () => {
    repository('backups/velho');
    write('docs/site/package.json', JSON.stringify({ name: 'site', scripts: { dev: 'x' } }));
    write('docs/site/src/index.ts');
    const found = await discover();
    expect(found['backups/velho']?.classification).toBe('CONFIRMED_PROJECT');
    expect(found['docs/site']?.classification).not.toBe('UNKNOWN');
  });

  it('is not fooled by a manifest alone or by README and Dockerfile', async () => {
    write('sobra/package.json', '{}');
    write('docker/Dockerfile');
    write('docker/README.md');
    const found = await discover();
    expect(found['sobra']?.selected).toBe(false);
    expect(found['docker']?.selected).toBe(false);
  });

  it('skips generated folders and hidden contents', async () => {
    repository('app');
    write('app/node_modules/dep/package.json', JSON.stringify({ name: 'dep' }));
    write('app/dist/package.json', JSON.stringify({ name: 'x' }));
    const found = await discover();
    expect(Object.keys(found).some((name) => name.includes('node_modules') || name.includes('dist'))).toBe(false);
  });

  it('does not follow junctions, even in a loop', async () => {
    repository('app');
    symlinkSync(root, join(root, 'app', 'volta'), 'junction');
    const report = await discoverProjects(root);
    expect(report.candidates.filter((candidate) => candidate.relativePath === 'app')).toHaveLength(1);
    expect(report.candidates.some((candidate) => candidate.relativePath.includes('volta'))).toBe(false);
  });

  it('respects manual decisions', async () => {
    repository('app');
    write('sql/a.sql', 'select 1');
    const found = await discover({ overrides: new Map([[join(root, 'sql').toLowerCase(), { classification: 'CONFIRMED_PROJECT', parentPath: null }], [join(root, 'app').toLowerCase(), { classification: 'AUXILIARY_DIRECTORY', parentPath: null }]]) });
    expect(found['sql']).toMatchObject({ classification: 'CONFIRMED_PROJECT', selected: true, overridden: true });
    expect(found['app']).toMatchObject({ classification: 'AUXILIARY_DIRECTORY', selected: false, overridden: true });
  });

  it('marks what is already registered', async () => {
    repository('app');
    const found = await discover({ existing: new Map([[join(root, 'app').toLowerCase(), 'id-antigo']]) });
    expect(found['app']?.existingProjectId).toBe('id-antigo');
  });

  it('stops at the limits and says so', async () => {
    repository('fundo/a/b/c');
    const shallow = await discoverProjects(root, { maxDepth: 1 });
    expect(shallow.limited).toBe(true);
    expect(shallow.candidates.some((candidate) => candidate.relativePath === 'fundo/a/b/c')).toBe(false);
  });

  it('can be cancelled', async () => {
    repository('app');
    const controller = new AbortController();
    controller.abort();
    await expect(discoverProjects(root, { signal: controller.signal })).rejects.toThrow(/cancel/i);
  });

  it('writes nothing to the folder', async () => {
    repository('app');
    const before = readdirSync(root, { recursive: true }).length;
    await discoverProjects(root);
    expect(readdirSync(root, { recursive: true })).toHaveLength(before);
  });
});
