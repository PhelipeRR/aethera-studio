import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import selfsigned from 'selfsigned';

const exec = promisify(execFile);
export interface GitHttpsFixture { url: string; caFile: string; root: string; publishVersion(content: string, message: string): Promise<void>; failNextUpdate(): void; close(): Promise<void>; }

export async function startGitHttpsFixture(): Promise<GitHttpsFixture> {
  const root = await mkdtemp(join(tmpdir(), 'nb-skill-https-')); const repository = join(root, 'repo.git'); const worktree = join(root, 'work');
  await exec('git', ['init', '--bare', repository]); await exec('git', ['init', worktree]);
  await writeFile(join(worktree, 'SKILL.md'), '---\nname: Remote\ndescription: Controlled\n---\nData'); await exec('git', ['-C', worktree, 'add', '.']); await exec('git', ['-C', worktree, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'v1']); await exec('git', ['-C', worktree, 'remote', 'add', 'origin', repository]); await exec('git', ['-C', worktree, 'push', 'origin', 'HEAD']); await exec('git', ['-C', repository, 'update-server-info']);
  const certificate = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }] }); const caFile = join(root, 'ca.pem'); await writeFile(caFile, certificate.cert);
  let failNext = false; const server: Server = createServer({ key: certificate.private, cert: certificate.cert }, (request, response) => { if (failNext) { failNext = false; response.destroy(); return; } const pathname = new URL(request.url ?? '/', 'https://localhost').pathname.replace(/^\/repo\.git\/?/, ''); void readFile(join(repository, pathname)).then((body) => { response.writeHead(200); response.end(body); }).catch(() => { response.writeHead(404); response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  return { url: `https://localhost:${address.port}/repo.git`, caFile, root, async publishVersion(content, message) { await writeFile(join(worktree, 'SKILL.md'), content); await exec('git', ['-C', worktree, 'add', '.']); await exec('git', ['-C', worktree, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message]); await exec('git', ['-C', worktree, 'push', 'origin', 'HEAD']); await exec('git', ['-C', repository, 'update-server-info']); }, failNextUpdate() { failNext = true; }, async close() { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}
