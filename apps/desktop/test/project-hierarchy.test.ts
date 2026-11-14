import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RagEngine } from '@neuralbridge/brain';
import { memories, openDatabase, projects, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectService } from '../src/main/projects.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;
let root: string;
let service: ReturnType<typeof createProjectService>;

const write = (path: string, content = 'x') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(root, dir) });
function repository(dir: string) {
  mkdirSync(join(root, dir), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  write(`${dir}/README.md`, 'leia');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'inicial');
}
const row = (id: string) => handle.db.select().from(projects).where(eq(projects.id, id)).get();
async function confirmAll() {
  const report = await service.discover(root);
  return service.confirmDiscovery(root, report.candidates.map(({ path, selected, classification, parentPath }) => ({ path, selected, classification, parentPath })));
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-hierarchy-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = join(realpathSync(mkdtempSync(join(tmpdir(), 'nb-hierarchy-'))), 'Hepta');
  mkdirSync(root);
  service = createProjectService({ handle });
});
afterEach(() => handle.close());

describe('project hierarchy', () => {
  it('registers a workspace with its projects and leaves auxiliary folders out', async () => {
    repository('backoffice');
    repository('suporte-ms');
    write('sql/a.sql', 'select 1');
    await confirmAll();
    const list = service.list();
    expect(list.map((project) => project.name).sort()).toEqual(['Hepta', 'backoffice', 'suporte-ms']);
    const workspace = list.find((project) => project.name === 'Hepta');
    expect(workspace).toMatchObject({ kind: 'workspace', projectType: 'workspace', parentProjectId: null });
    expect(list.find((project) => project.name === 'backoffice')).toMatchObject({ projectType: 'child', parentProjectId: workspace?.id, gitRoot: join(root, 'backoffice') });
  });

  it('keeps ids, settings and memories of projects registered before, and links them', async () => {
    repository('INS');
    repository('outro');
    const old = await service.add(join(root, 'INS'));
    await service.update(old.id, { rules: 'minhas regras', permissionLevel: 'commands' });
    handle.db.insert(memories).values({ id: 'm1', title: 't', content: 'c', type: 'decision', projectId: old.id, sourceKind: 'user' }).run();
    handle.db.insert(tasks).values({ id: 't1', prompt: 'p', projectId: old.id, mode: 'auto', status: 'completed' }).run();
    await confirmAll();
    const linked = row(old.id);
    expect(linked).toMatchObject({ id: old.id, rules: 'minhas regras', permissionLevel: 'commands' });
    expect(linked?.parentProjectId).not.toBeNull();
    expect(service.list().find((project) => project.id === old.id)?.memoryCount).toBe(1);
    expect(handle.db.select().from(tasks).where(eq(tasks.id, 't1')).get()?.projectId).toBe(old.id);
  });

  it('turns a folder added on its own into a workspace, keeping id and settings', async () => {
    repository('backoffice');
    repository('suporte-ms');
    const hepta = await service.add(root);
    await service.update(hepta.id, { permissionLevel: 'full', rules: 'minhas regras' });
    await confirmAll();
    expect(row(hepta.id)).toMatchObject({ kind: 'workspace', permissionLevel: 'full', rules: 'minhas regras' });
    expect(service.list().filter((project) => project.parentProjectId === hepta.id).map((project) => project.name).sort()).toEqual(['backoffice', 'suporte-ms']);
  });

  it('keeps a project in its workspace when detection starts from that project', async () => {
    repository('grupo/um');
    repository('grupo/dois');
    repository('solto');
    const first = await service.discover(root);
    await service.confirmDiscovery(root, first.candidates.map(({ path, classification, parentPath }) => ({ path, selected: true, classification, parentPath })));
    const grupo = service.list().find((project) => project.name === 'grupo');
    expect(grupo?.parentProjectId).toEqual(expect.any(String));
    const report = await service.discover(join(root, 'grupo'));
    await service.confirmDiscovery(report.root, report.candidates.map(({ path, selected, classification, parentPath }) => ({ path, selected, classification, parentPath })));
    expect(row(grupo?.id ?? '')?.parentProjectId).toBe(grupo?.parentProjectId);
  });

  it('registers a whole workspace once, however often it is scanned', async () => {
    repository('a');
    repository('b');
    await confirmAll();
    const second = await confirmAll();
    expect(second.created).toEqual([]);
    expect(service.list()).toHaveLength(3);
  });

  it('remembers a correction in the next scan', async () => {
    repository('a');
    repository('b');
    write('sql/a.sql', 'select 1');
    const report = await service.discover(root);
    await service.confirmDiscovery(root, report.candidates.map((candidate) => (candidate.relativePath === 'sql' ? { path: candidate.path, selected: true, classification: 'CONFIRMED_PROJECT' as const, parentPath: candidate.parentPath } : { path: candidate.path, selected: candidate.selected, classification: candidate.classification, parentPath: candidate.parentPath })));
    const next = await service.discover(root);
    expect(next.candidates.find((candidate) => candidate.relativePath === 'sql')).toMatchObject({ classification: 'CONFIRMED_PROJECT', overridden: true });
  });

  it('refuses paths outside the scanned folder', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'nb-fora-')));
    await expect(service.confirmDiscovery(root, [{ path: outside, selected: true, classification: 'CONFIRMED_PROJECT', parentPath: null }])).rejects.toThrow(/fora/);
  });

  it('moves a project between workspaces and refuses a cycle', async () => {
    repository('a');
    repository('b');
    await confirmAll();
    const [workspace, a] = [service.list().find((item) => item.name === 'Hepta'), service.list().find((item) => item.name === 'a')];
    if (!workspace || !a) throw new Error('fixture');
    expect(() => service.move(workspace.id, a.id)).toThrow(/ciclo/);
    expect(() => service.move(a.id, a.id)).toThrow(/ciclo/);
    service.move(a.id, null);
    expect(row(a.id)?.parentProjectId).toBeNull();
  });

  it('removing a workspace keeps its projects and their folders', async () => {
    repository('a');
    repository('b');
    await confirmAll();
    const workspace = service.list().find((item) => item.name === 'Hepta');
    if (!workspace) throw new Error('fixture');
    service.remove(workspace.id);
    expect(service.list().map((item) => item.projectType)).toEqual(['standalone', 'standalone']);
    expect(existsSync(join(root, 'a', 'README.md'))).toBe(true);
  });
});

describe('new projects', () => {
  it('creates inside a workspace, with Git, and registers it', async () => {
    repository('a');
    repository('b');
    await confirmAll();
    const workspace = service.list().find((item) => item.name === 'Hepta');
    const created = await service.create({ name: 'NovoProjeto', parent: root, technology: 'node', parentProjectId: workspace?.id ?? null, allowNested: false });
    expect(existsSync(join(root, 'NovoProjeto', '.git'))).toBe(true);
    expect(service.list().find((item) => item.id === created.id)).toMatchObject({ projectType: 'child', gitRoot: join(root, 'NovoProjeto') });
  });

  it('starts Git in an existing project on request', async () => {
    write('solto/main.py');
    const project = await service.add(join(root, 'solto'));
    await service.initGit(project.id, false);
    expect(service.list()[0]?.gitRoot).toBe(join(root, 'solto'));
  });
});

describe('shared repository', () => {
  it('filters history by path, and reads each repository once', async () => {
    repository('mono');
    write('mono/apps/web/package.json', JSON.stringify({ name: 'web', scripts: {} }));
    write('mono/apps/web/src/a.ts');
    git('mono', 'add', '.');
    git('mono', 'commit', '-q', '-m', 'web');
    write('mono/apps/api/package.json', JSON.stringify({ name: 'api', scripts: {} }));
    write('mono/apps/api/src/b.ts');
    git('mono', 'add', '.');
    git('mono', 'commit', '-q', '-m', 'api');
    const report = await service.discover(join(root, 'mono'));
    await service.confirmDiscovery(join(root, 'mono'), report.candidates.map(({ path, classification, parentPath }) => ({ path, selected: true, classification, parentPath })));
    const web = service.list().find((item) => item.name === 'web');
    if (!web) throw new Error('fixture');
    expect(web.gitRoot).toBe(join(root, 'mono'));
    const history = await service.history(web.id);
    expect(history.commits.map((commit) => commit.subject)).toEqual(['web']);
    const state = await service.gitState();
    expect(state[web.id]).toMatchObject({ own: false, branch: 'main' });
  });
});

describe('RAG', () => {
  it('gives each file one owner, and searches the workspace across its projects', async () => {
    repository('a');
    repository('b');
    write('a/src/fila.ts', 'export const filaDePedidos = 1;\n');
    write('b/src/nota.ts', 'export const notaFiscal = 2;\n');
    write('LEIA.md', 'manual solto do workspace');
    await confirmAll();
    const [workspace, a, b] = ['Hepta', 'a', 'b'].map((name) => service.list().find((item) => item.name === name));
    if (!workspace || !a || !b) throw new Error('fixture');
    await service.refreshProfile(workspace.id);
    const rag = new RagEngine(handle);
    expect(rag.search(workspace.id, 'filaDePedidos')).toEqual([]);
    expect(rag.search(a.id, 'filaDePedidos')).toHaveLength(1);
    expect(rag.search(workspace.id, 'manual')).toHaveLength(1);
    const hits = service.searchWorkspace(workspace.id, 'filaDePedidos notaFiscal');
    expect(hits.map((hit) => hit.projectName).sort()).toEqual(['a', 'b']);
  });

  it('keeps a private project out of the workspace search', async () => {
    repository('a');
    repository('b');
    write('a/src/x.ts', 'export const segredoDoProjeto = 1;\n');
    await confirmAll();
    const [workspace, a] = ['Hepta', 'a'].map((name) => service.list().find((item) => item.name === name));
    if (!workspace || !a) throw new Error('fixture');
    await service.update(a.id, { isPrivate: true });
    await service.refreshProfile(workspace.id);
    expect(service.searchWorkspace(workspace.id, 'segredoDoProjeto')).toEqual([]);
  });
});
