import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

function fixture() {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-write-')), 'repo'); mkdirSync(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); writeFileSync(join(root, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-q', '-m', 'Base');
  return { root, git };
}

function remoteFixture() {
  const value = fixture();
  const remote = join(mkdtempSync(join(tmpdir(), 'nb-e2e-remote-')), 'origin.git'); mkdirSync(remote, { recursive: true });
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  value.git('remote', 'add', 'origin', remote); value.git('push', '-q', '-u', 'origin', 'main');
  writeFileSync(join(value.root, 'a.txt'), 'pending commit\n'); value.git('commit', '-q', '-am', 'Pending remote commit');
  return { ...value, remote };
}

function cherryFixture() {
  const value = fixture(); value.git('switch', '-q', '-c', 'feature/e2e'); writeFileSync(join(value.root, 'feature.txt'), 'feature\n'); value.git('add', '.'); value.git('commit', '-q', '-m', 'Feature commit'); const commit = value.git('rev-parse', 'HEAD').trim(); value.git('switch', '-q', 'main'); return { ...value, commit };
}

function conflictFixture() {
  const value = fixture(); value.git('switch', '-q', '-c', 'feature/e2e'); writeFileSync(join(value.root, 'a.txt'), 'feature conflict\n'); value.git('commit', '-q', '-am', 'Feature conflict'); const commit = value.git('rev-parse', 'HEAD').trim(); value.git('switch', '-q', 'main'); writeFileSync(join(value.root, 'a.txt'), 'main conflict\n'); value.git('commit', '-q', '-am', 'Main conflict'); try { value.git('cherry-pick', commit); } catch { /* expected real conflict */ } return { ...value, commit };
}

function mergeFixture() {
  const value = fixture();
  value.git('switch', '-q', '-c', 'feature/merge'); writeFileSync(join(value.root, 'feature.txt'), 'feature\n'); value.git('add', '.'); value.git('commit', '-q', '-m', 'Merge feature change');
  value.git('switch', '-q', 'main'); writeFileSync(join(value.root, 'main.txt'), 'main\n'); value.git('add', '.'); value.git('commit', '-q', '-m', 'Merge main change');
  value.git('merge', '--no-ff', '-q', 'feature/merge', '-m', 'Merge feature commit');
  return value;
}

async function openGitProject(root: string) {
  const launched = await launchApp(freshDataDir()); const { app, page } = launched; const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await expect(page.getByLabel('Selecionar projeto')).toBeVisible(); await page.getByLabel('Selecionar projeto').selectOption(id); return { app, page, id };
}

function cancelFirstConfirmation(page: Page, pattern: RegExp): () => boolean {
  let cancelled = false; page.on('dialog', (dialog) => { if (!cancelled && pattern.test(dialog.message())) { cancelled = true; void dialog.dismiss(); } else void dialog.accept(); }); return () => cancelled;
}

function gitRef(git: (...args: string[]) => string, name: string): string {
  try { return git('rev-parse', '-q', '--verify', name).trim(); } catch { return ''; }
}

test('Git write manager stages, commits and updates the real repository', async () => {
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'changed\n');
  const { app, page } = await launchApp(freshDataDir());
  page.on('dialog', (dialog) => void dialog.accept());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id);
  await expect(page.getByText(/a\.txt/).first()).toBeVisible(); await page.getByRole('button', { name: 'Stage', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('1 arquivo(s) staged')).toBeVisible(); await page.getByLabel('Mensagem do commit').fill('Persist real change'); await page.getByRole('button', { name: 'Criar commit' }).click();
  await expect.poll(() => git('log', '-1', '--format=%s').trim()).toBe('Persist real change'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toContain('changed'); await app.close();
});

test('Git operations shows pending commits and pushes only after explicit confirmation', async () => {
  const { root, remote, git } = remoteFixture(); const { app, page } = await openGitProject(root); page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' });
  await expect(operations.getByText('1')).toBeVisible(); await expect(operations.getByRole('list', { name: 'Commits pendentes para subir' })).toContainText('Pending remote commit');
  await operations.getByRole('button', { name: 'Subir commits' }).click();
  await expect.poll(() => execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: remote, encoding: 'utf8' }).trim()).toBe(git('rev-parse', 'HEAD').trim());
  await expect(operations.getByText('Nenhum commit local pendente neste upstream.')).toBeVisible(); await app.close();
});

test('diagnostic: commit cancellation checkpoints reach the contextual confirmation', async ({ page: _unusedPage }, testInfo) => {
  void _unusedPage;
  test.setTimeout(30_000);
  const checkpoints: string[] = []; const mark = (name: string) => { checkpoints.push(name); console.log(`[cancel-checkpoint] ${name}`); }; const sanitize = (value: string) => value.replace(/\s+/g, ' ').replace(/[A-Z]:\\[^ ]+/g, '<path>').slice(0, 500);
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'cancelled change\n'); let app: Awaited<ReturnType<typeof launchApp>>['app'] | undefined;
  try {
    mark('fixture-ready'); const launched = await launchApp(freshDataDir()); app = launched.app; const { page } = launched; mark('window-ready');
    page.on('console', (message) => console.log(`[cancel-renderer] ${message.type()} ${sanitize(message.text())}`)); page.on('pageerror', (error) => console.log(`[cancel-renderer-error] ${sanitize(error.message)}`)); const main = app.process(); main.stdout?.on('data', (chunk: Buffer) => console.log(`[cancel-main] ${sanitize(chunk.toString())}`)); main.stderr?.on('data', (chunk: Buffer) => console.log(`[cancel-main-error] ${sanitize(chunk.toString())}`));
    let commitDialogSeen = false; let cancelCommit = true; page.on('dialog', (dialog) => { const message = sanitize(dialog.message()); console.log(`[cancel-dialog] ${message}`); if (message.startsWith('Criar o commit')) { commitDialogSeen = true; if (cancelCommit) { cancelCommit = false; void dialog.dismiss(); } else void dialog.accept(); } else void dialog.accept(); });
    const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root); mark('project-added'); await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await expect(page.getByLabel('Selecionar projeto')).toBeVisible(); await page.getByLabel('Selecionar projeto').selectOption(id); mark('project-open');
    const stageButton = page.getByRole('button', { name: 'Stage', exact: true }).first(); await expect(stageButton).toBeVisible(); mark('stage-button'); await stageButton.click(); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('1 arquivo(s) staged')).toBeVisible(); mark('stage-complete'); const operations = page.getByRole('region', { name: 'Operações Git' });
    const headBefore = git('rev-parse', 'HEAD').trim(); const indexBefore = git('diff', '--cached', '--name-only').trim(); const commitButton = operations.getByRole('button', { name: 'Criar commit' }); await expect(commitButton).toBeEnabled(); mark('commit-button'); await operations.getByLabel('Mensagem do commit').fill('cancelled commit'); mark('commit-prepared'); await commitButton.click(); await expect.poll(() => commitDialogSeen).toBe(true); mark('confirmation-opened-and-cancelled'); await expect.poll(() => git('rev-parse', 'HEAD').trim()).toBe(headBefore); expect(git('diff', '--cached', '--name-only').trim()).toBe(indexBefore); mark('git-state-preserved'); await commitButton.click(); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toBe('cancelled commit'); mark('new-confirmation-executed');
  } finally {
    await testInfo.attach('cancel-checkpoints.txt', { body: checkpoints.join('\n'), contentType: 'text/plain' }); if (app) await app.close();
  }
});

test('Branch Manager creates and switches a real branch without bypassing confirmation', async () => {
  const { root, git } = fixture(); const { app, page } = await launchApp(freshDataDir());
  page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id);
  await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); await page.getByLabel('Nova branch').fill('feature/e2e'); await operations.getByRole('button', { name: 'Criar', exact: true }).click(); await expect(operations.getByText('feature/e2e')).toBeVisible();
  await operations.getByRole('button', { name: 'Alternar' }).click(); await expect.poll(() => git('branch', '--show-current').trim()).toBe('feature/e2e'); await app.close();
});

test('cancelling branch deletion preserves the ref until a new confirmation', async () => {
  const { root, git } = fixture(); git('branch', 'delete-me'); const { app, page } = await openGitProject(root); const cancelled = cancelFirstConfirmation(page, /Excluir delete-me/); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); const row = operations.getByRole('listitem').filter({ hasText: 'delete-me' }); await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Excluir' }).click(); await expect.poll(cancelled).toBe(true); await expect(row).toBeVisible(); expect(git('branch', '--list', 'delete-me').trim()).toContain('delete-me'); await row.getByRole('button', { name: 'Excluir' }).click(); await expect.poll(() => git('branch', '--list', 'delete-me').trim()).toBe(''); await app.close();
});

test('Stash Manager persists, applies, pops and drops real entries', async () => {
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'stash me\n'); writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
  const { app, page } = await launchApp(freshDataDir()); page.on('dialog', (dialog) => void dialog.accept());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root); await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id);
  await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); await operations.getByLabel('Descrição do stash').fill('E2E stash'); await operations.getByLabel('incluir não rastreados').check(); await operations.getByRole('button', { name: 'Guardar' }).click();
  const stashList = () => { try { return git('stash', 'list').trim(); } catch (error) { if (error instanceof Error && error.message.includes('bad revision')) return ''; throw error; } };
  await expect.poll(() => git('stash', 'list', '--format=%s').trim()).toContain('E2E stash'); await expect.poll(() => git('status', '--porcelain').trim()).toBe('');
  await operations.getByRole('button', { name: 'Aplicar' }).click(); await expect.poll(() => git('status', '--porcelain').trim()).toContain('a.txt'); await expect.poll(stashList).not.toBe('');
  await operations.getByRole('button', { name: 'Excluir' }).click(); await expect.poll(stashList).toBe('');
  writeFileSync(join(root, 'a.txt'), 'stash again\n'); await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('tab', { name: 'Operações' }).click(); await operations.getByLabel('Descrição do stash').fill('E2E pop'); await operations.getByRole('button', { name: 'Guardar' }).click(); await expect.poll(() => git('stash', 'list', '--format=%s').trim()).toContain('E2E pop');
  await operations.getByRole('button', { name: 'Pop' }).click(); await expect.poll(stashList).toBe(''); await app.close();
});

test('cancelling stash drop preserves the entry until a new confirmation', async () => {
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'stash cancellation\n'); git('stash', 'push', '-q', '-m', 'cancel drop'); const { app, page } = await openGitProject(root); const cancelled = cancelFirstConfirmation(page, /Excluir stash@\{0\}/); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); const row = operations.getByRole('listitem').filter({ hasText: 'cancel drop' }); await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Excluir' }).click(); await expect.poll(cancelled).toBe(true); await expect(row).toBeVisible(); expect(git('stash', 'list').trim()).toContain('cancel drop'); await row.getByRole('button', { name: 'Excluir' }).click(); await expect.poll(() => git('stash', 'list').trim()).toBe(''); await app.close();
});

test('Revert updates the real history and working tree through the Electron UI', async () => {
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'changed\n'); git('commit', '-q', '-am', 'Change to revert'); const commit = git('rev-parse', 'HEAD').trim();
  const { app, page } = await launchApp(freshDataDir()); page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('button', { name: /Change to revert/ }).click(); await page.getByRole('tab', { name: 'Operações' }).click(); await page.getByRole('button', { name: 'Reverter' }).click();
  await expect.poll(() => git('log', '-1', '--format=%s').trim()).toContain('Revert'); expect(git('rev-parse', 'HEAD^').trim()).toBe(commit); expect(readFileSync(join(root, 'a.txt'), 'utf8').replaceAll('\r\n', '\n')).toBe('base\n'); await app.close();
});

test('cancelling revert preserves HEAD until a new confirmation', async () => {
  const { root, git } = fixture(); writeFileSync(join(root, 'a.txt'), 'revert cancellation\n'); git('commit', '-q', '-am', 'Change to cancel revert'); const commit = git('rev-parse', 'HEAD').trim(); const { app, page } = await openGitProject(root); await page.getByRole('button', { name: /Change to cancel revert/ }).click(); const cancelled = cancelFirstConfirmation(page, /Reverter o commit/); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); await operations.getByRole('button', { name: 'Reverter' }).click(); await expect.poll(cancelled).toBe(true); await expect.poll(() => git('rev-parse', 'HEAD').trim()).toBe(commit); await operations.getByRole('button', { name: 'Reverter' }).click(); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toContain('Revert'); await app.close();
});

test('Cherry-pick applies a real feature commit through the Electron UI', async () => {
  const { root, git, commit } = cherryFixture(); const { app, page } = await launchApp(freshDataDir()); page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); await operations.getByRole('button', { name: 'Alternar' }).click(); await expect.poll(() => git('branch', '--show-current').trim()).toBe('feature/e2e'); await page.getByRole('tab', { name: 'Visão geral' }).click(); await page.getByRole('button', { name: /Feature commit/ }).click(); await page.getByRole('tab', { name: 'Operações' }).click(); await operations.getByRole('button', { name: 'Alternar' }).click();
  await expect.poll(() => git('branch', '--show-current').trim()).toBe('main'); await page.getByRole('tab', { name: 'Visão geral' }).click(); await page.getByRole('button', { name: /Feature commit/ }).click(); await page.getByRole('tab', { name: 'Operações' }).click(); await operations.getByRole('button', { name: 'Cherry-pick' }).click(); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toBe('Feature commit'); expect(readFileSync(join(root, 'feature.txt'), 'utf8')).toContain('feature'); expect(git('rev-parse', 'HEAD^').trim()).not.toBe(commit); await app.close();
});

test('cancelling cherry-pick preserves HEAD until a new confirmation', async () => {
  const { root, git, commit } = cherryFixture(); const { app, page } = await openGitProject(root); await page.getByRole('button', { name: /Feature commit/ }).click(); const cancelled = cancelFirstConfirmation(page, /Aplicar o commit/); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' }); await operations.getByRole('button', { name: 'Cherry-pick' }).click(); await expect.poll(cancelled).toBe(true); expect(git('rev-parse', 'HEAD').trim()).not.toBe(commit); expect(git('log', '-1', '--format=%s').trim()).toBe('Base'); expect(git('status', '--porcelain').trim()).toBe(''); await operations.getByRole('button', { name: 'Cherry-pick' }).click(); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toBe('Feature commit'); await app.close();
});

test('Conflict recovery panel exposes a real pending operation and safe abort', async () => {
  const { root, git } = conflictFixture(); const { app, page } = await launchApp(freshDataDir()); page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('tab', { name: 'Operações' }).click();
  await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible(); await expect(page.getByText(/Conflitos:.*a\.txt/)).toBeVisible(); await page.screenshot({ path: 'C:/dev/neuralbridge/prints/git-conflict-1280.png', fullPage: true });
  await page.setViewportSize({ width: 800, height: 700 }); await page.screenshot({ path: 'C:/dev/neuralbridge/prints/git-conflict-800.png', fullPage: true }); const abort = page.getByRole('button', { name: 'Abortar' }); await expect(abort).toBeEnabled(); await abort.click(); await expect(page.getByText('Operação em andamento: cherry-pick')).toHaveCount(0); await expect.poll(() => git('status', '--porcelain').trim()).toBe(''); await expect.poll(() => { try { return git('rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD').trim(); } catch { return ''; } }).toBe(''); await app.close();
});

test('cancelling conflict abort preserves the pending operation until a new confirmation', async () => {
  const { root, git } = conflictFixture(); const { app, page } = await openGitProject(root); const cancelled = cancelFirstConfirmation(page, /Abortar a operação/); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible(); const operations = page.getByRole('region', { name: 'Operações Git' }); await operations.getByRole('button', { name: 'Abortar' }).click(); await expect.poll(cancelled).toBe(true); await expect.poll(() => gitRef(git, 'CHERRY_PICK_HEAD')).not.toBe(''); await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible(); await operations.getByRole('button', { name: 'Abortar' }).click(); await expect.poll(() => gitRef(git, 'CHERRY_PICK_HEAD')).toBe(''); await expect.poll(() => git('status', '--porcelain').trim()).toBe(''); await app.close();
});

test('Conflict recovery continues after manual resolution and staging', async () => {
  const { root, git, commit } = conflictFixture(); const { app, page } = await launchApp(freshDataDir()); page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible();
  writeFileSync(join(root, 'a.txt'), 'resolved by operator\n'); await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('button', { name: 'Stage', exact: true }).first().click(); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('1 arquivo(s) staged')).toBeVisible(); const operations = page.getByRole('region', { name: 'Operações Git' }); await expect(operations.getByRole('button', { name: 'Continuar' })).toBeEnabled(); await operations.getByRole('button', { name: 'Continuar' }).click();
  await expect.poll(() => git('log', '-1', '--format=%s').trim()).toContain('Feature conflict'); await expect.poll(() => git('status', '--porcelain').trim()).toBe(''); expect(git('rev-parse', 'HEAD').trim()).not.toBe(commit); await expect(operations.getByText(/Operação em andamento/)).toHaveCount(0); await app.close();
});

test('cancelling conflict continue preserves the pending operation until a new confirmation', async () => {
  const { root, git } = conflictFixture(); const { app, page, id } = await openGitProject(root); const cancelled = cancelFirstConfirmation(page, /Continuar a operação/); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible(); writeFileSync(join(root, 'a.txt'), 'resolved for cancel test\n'); await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id); await page.getByRole('button', { name: 'Stage', exact: true }).first().click(); await page.getByRole('tab', { name: 'Operações' }).click(); await expect(page.getByText('1 arquivo(s) staged')).toBeVisible(); const operations = page.getByRole('region', { name: 'Operações Git' }); await expect(operations.getByRole('button', { name: 'Continuar' })).toBeEnabled(); await operations.getByRole('button', { name: 'Continuar' }).click(); await expect.poll(cancelled).toBe(true); await expect.poll(() => gitRef(git, 'CHERRY_PICK_HEAD')).not.toBe(''); await expect(page.getByText('Operação em andamento: cherry-pick')).toBeVisible(); await operations.getByRole('button', { name: 'Continuar' }).click(); await expect.poll(() => gitRef(git, 'CHERRY_PICK_HEAD')).toBe(''); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toContain('Feature conflict'); await app.close();
});

test('Merge history action requires an explicit valid mainline in the Electron UI', async () => {
  const { root, git } = mergeFixture(); const { app, page } = await launchApp(freshDataDir());
  page.on('dialog', (dialog) => void dialog.accept()); const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload(); await page.evaluate(() => { location.hash = '#/git-intelligence'; }); await page.getByLabel('Selecionar projeto').selectOption(id);
  await page.getByRole('button', { name: /Merge feature commit/ }).click(); await page.getByRole('tab', { name: 'Operações' }).click(); const operations = page.getByRole('region', { name: 'Operações Git' });
  await expect(operations.getByLabel('Mainline do merge')).toBeVisible(); await operations.getByLabel('Mainline do merge').fill('0'); await operations.getByRole('button', { name: 'Reverter' }).click();
  await expect(operations.getByRole('alert')).toContainText('mainline entre 1 e 2'); expect(git('log', '-1', '--format=%s').trim()).toBe('Merge feature commit');
  await operations.getByLabel('Mainline do merge').fill('1'); await operations.getByRole('button', { name: 'Reverter' }).click(); await expect.poll(() => git('log', '-1', '--format=%s').trim()).toContain('Revert');
  expect(git('status', '--porcelain').trim()).toBe(''); await app.close();
});




