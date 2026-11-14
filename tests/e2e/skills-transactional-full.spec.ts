import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { URL } from 'node:url';
import selfsigned from 'selfsigned';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

function git(cwd: string, ...args: string[]): void { execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true }); }

async function createHttpsGitFixture(): Promise<{ root: string; source: string; caFile: string; close: () => Promise<void>; publish: (version: string) => void }> {
  const root = mkdtempSync(join(tmpdir(), 'nb-e2e-git-')); const repo = join(root, 'repo.git'); const work = join(root, 'work'); mkdirSync(work, { recursive: true });
  git(root, 'init', '--bare', repo); git(work, 'init'); git(work, 'config', 'user.email', 'e2e@example.test'); git(work, 'config', 'user.name', 'E2E');
  const publish = (version: string) => { writeFileSync(join(work, 'SKILL.md'), `---\nname: Fixture Skill\ndescription: Controlled ${version}\n---\n\nVersion ${version}.\n`, 'utf8'); writeFileSync(join(work, 'install.ps1'), 'Write-Output "must never execute"\n', 'utf8'); git(work, 'add', 'SKILL.md', 'install.ps1'); git(work, 'commit', '-m', version); git(work, 'branch', '-M', 'main'); git(work, 'push', '--force', repo, 'main'); git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main'); git(repo, 'update-server-info'); };
  publish('v1');
  const keyPair = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }] });
  const caFile = join(root, 'ca.pem'); writeFileSync(caFile, keyPair.cert, 'utf8');
  const server = createServer({ key: keyPair.private, cert: keyPair.cert }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost'); const requested = normalize(join(root, decodeURIComponent(url.pathname.replace(/^\//u, ''))));
    if (!requested.startsWith(resolve(root))) { response.writeHead(403); response.end(); return; }
    if (!existsSync(requested)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': extname(requested) === '.pack' ? 'application/octet-stream' : 'text/plain' }); response.end(readFileSync(requested));
  });
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server address unavailable');
  return { root, source: `https://localhost:${address.port}/repo.git`, caFile, close: () => new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())), publish };
}

test('transactional install, update backup, rollback and cancellation use an isolated HTTPS Git fixture', async () => {
  const fixture = await createHttpsGitFixture(); const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-data-')); writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', skillSettings: { allowlistedHosts: ['localhost'], preferences: [] } }), 'utf8');
  const { app, page } = await launchApp(dataDir, { env: { NB_SKILL_TEST_CA_FILE: fixture.caFile } });
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click(); page.on('dialog', (dialog) => void dialog.accept());
    const source = fixture.source;
    await page.getByLabel('Repositório HTTPS da skill').fill(source); await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('button', { name: 'Preparar instalação' })).toBeEnabled();
    await expect(page.locator('p[role="status"]')).toHaveText('Skill instalada/atualizada com backup transacional.');
    const installed = join(dataDir, 'managed-skills', 'repo', 'SKILL.md'); expect(readFileSync(installed, 'utf8')).toContain('Controlled v1');
    fixture.publish('v2'); await page.getByLabel('Repositório HTTPS da skill').fill(source); await page.getByRole('button', { name: 'Preparar instalação' }).click(); await expect(page.getByRole('button', { name: 'Preparar instalação' })).toBeEnabled(); await expect(page.locator('p[role="status"]')).toHaveText('Skill instalada/atualizada com backup transacional.'); expect(readFileSync(installed, 'utf8')).toContain('Controlled v2');
    const history = await page.evaluate(() => window.neuralbridge.skills.installHistory()); const update = history.find((item) => item.operation === 'update' && item.state === 'completed'); if (!update) throw new Error('completed update transaction missing'); expect(update.backupAvailable).toBe(true);
    const rolledBack = await page.evaluate((id) => window.neuralbridge.skills.rollbackInstall(id), update.id); expect(rolledBack.state).toBe('rolled_back'); expect(readFileSync(installed, 'utf8')).toContain('Controlled v1');
    const prepared = await page.evaluate((input) => window.neuralbridge.skills.prepareInstall(input), { skillId: 'repo', source, scope: 'global' as const }); const cancelled = await page.evaluate((id) => window.neuralbridge.skills.cancelInstall(id), prepared.operationId); expect(cancelled.state).toBe('cancelled'); expect(readFileSync(installed, 'utf8')).toContain('Controlled v1');
  } finally { await app.close(); await fixture.close(); }
});

test('transactional recovery marks an interrupted journal without starting installation', async () => {
  const fixture = await createHttpsGitFixture(); const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-data-')); writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', skillSettings: { allowlistedHosts: ['localhost'], preferences: [] } }), 'utf8');
  const first = await launchApp(dataDir, { env: { NB_SKILL_TEST_CA_FILE: fixture.caFile } });
  let operationId = '';
  try { operationId = await first.page.evaluate((source) => window.neuralbridge.skills.prepareInstall({ skillId: 'repo', source, scope: 'global' }).then((prepared) => prepared.operationId), fixture.source); } finally { await first.app.close(); await fixture.close(); }
  const journal = join(dataDir, 'skill-transactions', `${operationId}.json`); const transaction = JSON.parse(readFileSync(journal, 'utf8')) as { state: string; authorization: unknown }; transaction.state = 'committing'; transaction.authorization = null; writeFileSync(journal, JSON.stringify(transaction), 'utf8');
  const second = await launchApp(dataDir); try { const recovery = await second.page.evaluate(() => window.neuralbridge.skills.installRecovery()); expect(recovery.find((item) => item.id === operationId)?.state).toBe('recovery_required'); expect(existsSync(join(dataDir, 'managed-skills', 'repo'))).toBe(false); } finally { await second.app.close(); }
});

test('transactional destination lock rejects concurrent confirmations without executing untrusted files', async () => {
  const fixture = await createHttpsGitFixture(); const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-data-')); writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', skillSettings: { allowlistedHosts: ['localhost'], preferences: [] } }), 'utf8');
  const { app, page } = await launchApp(dataDir, { env: { NB_SKILL_TEST_CA_FILE: fixture.caFile } });
  try {
    const prepared = await page.evaluate((source) => window.neuralbridge.skills.prepareInstall({ skillId: 'repo', source, scope: 'global' }), fixture.source);
    const destinationRoot = join(dataDir, 'managed-skills'); const lockPath = join(destinationRoot, 'repo.neuralbridge.lock'); mkdirSync(destinationRoot, { recursive: true }); writeFileSync(lockPath, 'fixture lock', 'utf8');
    const outcomes = await page.evaluate(async (operationId) => Promise.all([1, 2].map(() => window.neuralbridge.skills.confirmInstall(operationId).then(() => 'completed', (error: unknown) => error instanceof Error ? error.message : String(error)))), prepared.operationId);
    expect(outcomes).toHaveLength(2); expect(outcomes.every((outcome) => outcome.includes('destination_busy'))).toBe(true); expect(existsSync(join(destinationRoot, 'repo'))).toBe(false); unlinkSync(lockPath);
    await expect(page.evaluate((operationId) => window.neuralbridge.skills.confirmInstall(operationId), prepared.operationId)).resolves.toMatchObject({ state: 'completed' });
    expect(readFileSync(join(destinationRoot, 'repo', 'install.ps1'), 'utf8')).toContain('must never execute');
  } finally { await app.close(); await fixture.close(); }
});
