/**
 * Recap production jobs seen from the Remote Host.
 *
 * The executor is the Aethera desktop main process (it owns the vision/TTS providers). It
 * persists every job under `<recap-workspace>/jobs`. The Remote Host reads those records and
 * writes pause/resume/cancel requests to the job's control file; the executor applies them at
 * the next safe checkpoint. Nothing here keeps a job alive: the SSE stream only observes, and
 * closing it just stops the polling for that client.
 */

import type { Express, RequestHandler } from 'express';
import { existsSync } from 'node:fs';
// Imported from source on purpose: this module has no dependencies beyond node builtins, so the
// Remote Host shares the exact on-disk contract without loading the whole cinema package.
import { listRecapJobs, readRecapJob, requestRecapJobControl } from '../../../packages/cinema/src/recap/phase5/recap-production-job-manager';

const CONTROL_ACTIONS = new Set(['pause', 'resume', 'cancel']);

export function registerRecapJobRoutes(input: {
  app: Express;
  /** `<desktop userData>/recap-workspace`, or null when the desktop profile is unknown. */
  workspaceDir: string | null;
  requireRead: RequestHandler;
  requireControl: RequestHandler;
  pollIntervalMs?: number;
}): void {
  const { app, workspaceDir, requireRead, requireControl } = input;
  const pollMs = input.pollIntervalMs ?? 1500;
  const available = () => Boolean(workspaceDir && existsSync(workspaceDir));

  app.get('/api/recap/jobs', requireRead, (req, res) => {
    if (!available()) {
      res.json({ jobs: [], note: 'Workspace do Recap do desktop não encontrado neste host.' });
      return;
    }
    const includeFinished = req.query['includeFinished'] === '1' || req.query['includeFinished'] === 'true';
    const jobs = listRecapJobs(workspaceDir!).filter(
      (j) => includeFinished || !['cancelled', 'completed', 'failed', 'awaiting_approval'].includes(j.status),
    );
    res.json({ jobs: jobs.slice(0, 50) });
  });

  app.get('/api/recap/jobs/:jobId', requireRead, (req, res) => {
    const job = available() ? readRecapJob(workspaceDir!, String(req.params.jobId)) : null;
    if (!job) {
      res.status(404).json({ error: 'Job de produção Recap não encontrado.' });
      return;
    }
    res.json(job);
  });

  // Observation only: the job runs whether or not anyone is subscribed.
  app.get('/api/recap/jobs/:jobId/events', requireRead, (req, res) => {
    const jobId = String(req.params.jobId);
    const first = available() ? readRecapJob(workspaceDir!, jobId) : null;
    if (!first) {
      res.status(404).json({ error: 'Job de produção Recap não encontrado.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let lastStamp = first.updatedAtIso;
    res.write(`event: job\ndata: ${JSON.stringify(first)}\n\n`);
    const timer = setInterval(() => {
      const job = readRecapJob(workspaceDir!, jobId);
      if (!job) return;
      if (job.updatedAtIso !== lastStamp) {
        lastStamp = job.updatedAtIso;
        res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
      } else {
        res.write(`: heartbeat\n\n`);
      }
    }, pollMs);
    req.on('close', () => clearInterval(timer));
  });

  app.post('/api/recap/jobs/:jobId/:action', requireControl, (req, res) => {
    const action = String(req.params.action);
    if (!CONTROL_ACTIONS.has(action)) {
      res.status(400).json({ error: 'Ação inválida. Use pause, resume ou cancel.' });
      return;
    }
    const jobId = String(req.params.jobId);
    const request = available()
      ? requestRecapJobControl(workspaceDir!, jobId, action as 'pause' | 'resume' | 'cancel', 'remote-host')
      : null;
    if (!request) {
      res.status(404).json({ error: 'Job de produção Recap não encontrado.' });
      return;
    }
    res.status(202).json({
      accepted: true,
      request,
      note: 'Pedido registrado; o executor local aplica no próximo ponto seguro (entre painéis ou etapas).',
    });
  });
}
