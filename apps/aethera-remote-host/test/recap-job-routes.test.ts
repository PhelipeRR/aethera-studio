/**
 * Remote Host view of durable Recap production jobs: observe and control a job executed by the
 * desktop process without keeping it alive. Browser/SSE disconnects and Remote Host restarts must
 * not pause, cancel or duplicate the job.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RecapProductionJobManager, type RecapJobExecutor } from '../../../packages/cinema/src/recap/phase5/recap-production-job-manager';
import express from 'express';
import { registerRecapJobRoutes } from '../src/recap-job-routes';

const TOKEN = 'test-remote-secret-token-aethera-2026';
const auth = { Authorization: `Bearer ${TOKEN}` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mounts the Recap job routes on a bare Express app with the same bearer-token guard shape the
 * Remote Host uses. (createRemoteHostApp cannot load here: its URL-import routes depend on an
 * unmapped `@neuralbridge/cinema/recap` specifier, a pre-existing environment issue.)
 */
async function startHost(desktopUserDataDir: string) {
  const app = express();
  const guard: express.RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
  registerRecapJobRoutes({
    app,
    workspaceDir: path.join(desktopUserDataDir, 'recap-workspace'),
    requireRead: guard,
    requireControl: guard,
    pollIntervalMs: 20,
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    async stop() {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Desktop-side executor stand-in: walks panels, honouring checkpoints. */
function executor(gate: { open: boolean }, panels = 30): RecapJobExecutor {
  return async (job, ctx) => {
    for (let i = job.progress.completedPanels ?? 0; i < panels; i += 1) {
      ctx.checkpoint('vision');
      while (!gate.open) await sleep(5);
      await sleep(15);
      ctx.report({ stage: 'vision', completedPanels: i + 1, totalPanels: panels, canResume: true });
    }
    return { status: 'awaiting_approval', message: 'Prévia pronta.' };
  };
}

test('Remote Host observes and controls a desktop Recap job without owning its lifetime', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-desktop-userdata-'));
  const workspace = path.join(userData, 'recap-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const gate = { open: true };
  const desktop = new RecapProductionJobManager({ workspaceDir: workspace, executor: executor(gate), pollIntervalMs: 0 });
  let host = await startHost(userData);
  try {
    const { job } = desktop.start({ kind: 'production', projectId: 'run-r', chapterId: 'cap-r', workTitle: 'Cap R', input: {} });

    // Listed through the Remote Host.
    const list = (await (await fetch(`${host.baseUrl}/api/recap/jobs`, { headers: auth })).json()) as { jobs: { jobId: string }[] };
    assert.deepEqual(list.jobs.map((j) => j.jobId), [job.jobId]);

    // A browser subscribes over SSE, then disconnects abruptly: the job must keep going.
    const ctrl = new AbortController();
    const sse = await fetch(`${host.baseUrl}/api/recap/jobs/${job.jobId}/events`, { headers: auth, signal: ctrl.signal });
    assert.equal(sse.status, 200);
    const reader = sse.body!.getReader();
    const firstChunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(firstChunk, /event: job/);
    ctrl.abort();
    const beforePanels = desktop.get(job.jobId)!.progress.completedPanels ?? 0;
    await sleep(80);
    assert.equal(desktop.get(job.jobId)!.status, 'running');
    assert.ok((desktop.get(job.jobId)!.progress.completedPanels ?? 0) > beforePanels, 'progress advances with no client connected');

    // Pause requested from the Remote Host is applied by the executor at a safe checkpoint.
    gate.open = false;
    const pause = await fetch(`${host.baseUrl}/api/recap/jobs/${job.jobId}/pause`, { method: 'POST', headers: auth });
    assert.equal(pause.status, 202);
    desktop.tick();
    gate.open = true;
    const paused = await desktop.waitForIdle(job.jobId);
    assert.equal(paused?.status, 'paused');

    // Remote Host restarts (disconnect + reconnect): the same job is still there, not a new one.
    await host.stop();
    host = await startHost(userData);
    const again = (await (await fetch(`${host.baseUrl}/api/recap/jobs/${job.jobId}`, { headers: auth })).json()) as { status: string; jobId: string };
    assert.equal(again.jobId, job.jobId);
    assert.equal(again.status, 'paused');

    // Resume through the Remote Host; the desktop executor picks it up and finishes.
    const resume = await fetch(`${host.baseUrl}/api/recap/jobs/${job.jobId}/resume`, { method: 'POST', headers: auth });
    assert.equal(resume.status, 202);
    desktop.tick();
    const done = await desktop.waitForIdle(job.jobId);
    assert.equal(done?.status, 'awaiting_approval');
    assert.equal(done?.progress.completedPanels, 30);

    const invalid = await fetch(`${host.baseUrl}/api/recap/jobs/${job.jobId}/explode`, { method: 'POST', headers: auth });
    assert.equal(invalid.status, 400);
    const unauth = await fetch(`${host.baseUrl}/api/recap/jobs`);
    assert.equal(unauth.status, 401);
  } finally {
    desktop.dispose();
    await host.stop();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
