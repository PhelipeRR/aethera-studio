import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RemoteHostDatabase } from '../src/db';
import {
  assertSafeBindHost,
  isPathInsideAllowedRoots,
  redactSecrets,
} from '../src/security';
import { createRemoteHostApp } from '../src/server';

const TOKEN = 'test-remote-secret-token-aethera-2026';

async function startTestServer(extraConfig: Partial<Parameters<typeof createRemoteHostApp>[0]> = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-remote-test-'));
  const instance = createRemoteHostApp({
    bindHost: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    authToken: TOKEN,
    dataDir: tmpDir,
    monorepoRoot: path.resolve(process.cwd()),
    allowedOrigins: ['http://localhost:3000', 'https://aethera.example.com'],
    allowedRoots: [path.join(tmpDir, 'artifacts')],
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 200,
    ...extraConfig,
  });

  const server = await new Promise<ReturnType<typeof instance.app.listen>>((resolve) => {
    const s = instance.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    tmpDir,
    instance,
    async cleanup() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function writeFakeNodeCliScript(dir: string, filename: string, jsBody: string): string {
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, jsBody, 'utf8');
  return fullPath;
}

test('Security guardrails enforce loopback bind, path traversal block, and secret redaction', () => {
  assert.throws(() => assertSafeBindHost('0.0.0.0', false), /Recusado bind inseguro/);
  assert.doesNotThrow(() => assertSafeBindHost('127.0.0.1', false));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-path-guard-'));
  try {
    const inside = path.join(root, 'video.mp4');
    fs.writeFileSync(inside, 'ok');
    assert.equal(isPathInsideAllowedRoots(inside, [root]), true);
    assert.equal(isPathInsideAllowedRoots(path.join(root, '..', 'etc', 'passwd'), [root]), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const redacted = redactSecrets('Authorization: Bearer supersecrettoken123456 sk-abc1234567890123');
  assert.ok(!redacted.includes('supersecrettoken123456'));
  assert.ok(!redacted.includes('sk-abc1234567890123'));
});

test('Auth, CORS, Rate Limiting, and Closed Operation Catalog protect Remote Host API', async () => {
  const ctx = await startTestServer({ rateLimitMaxRequests: 12 });
  try {
    // Public health endpoint works without auth
    const health = await fetch(`${ctx.baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const healthJson = (await health.json()) as { ok: boolean; schemaVersion: string };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.schemaVersion, '1.1.0');

    // Missing Bearer token -> 401
    const unauth = await fetch(`${ctx.baseUrl}/api/host/status`);
    assert.equal(unauth.status, 401);

    // Wrong Bearer token -> 403
    const wrong = await fetch(`${ctx.baseUrl}/api/host/status`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(wrong.status, 403);

    // Unauthorized CORS origin -> 403
    const badCors = await fetch(`${ctx.baseUrl}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example.net' },
    });
    assert.equal(badCors.status, 403);

    // Allowed CORS origin + valid token -> 200
    const statusRes = await fetch(`${ctx.baseUrl}/api/host/status`, {
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    // Arbitrary shell operation rejected -> 400
    const badOp = await fetch(`${ctx.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operation: 'shell.exec', prompt: 'rm -rf /' }),
    });
    assert.equal(badOp.status, 400);

    // Exceed rate limit -> 429
    let hit429 = false;
    for (let i = 0; i < 15; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/health`);
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    assert.equal(hit429, true);
  } finally {
    await ctx.cleanup();
  }
});

test('SQLite job persistence survives reopen and recovers interrupted running jobs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-db-recover-'));
  const dbPath = path.join(tmpDir, 'remote-host.db');
  try {
    const db1 = new RemoteHostDatabase(dbPath);
    const now = new Date().toISOString();
    db1.saveJob({
      id: 'rjob-crash-1',
      operation: 'render.ffmpeg',
      title: 'Render interrompido',
      projectId: null,
      status: 'running',
      requiresApproval: false,
      approvalState: 'not_required',
      approvalNote: null,
      engineMode: 'standalone_host',
      agentUsed: null,
      encoderUsed: null,
      progressMode: 'real_ffmpeg',
      progressPct: 42,
      currentStage: 'render',
      stages: [
        {
          id: 'render',
          label: 'Renderização FFmpeg',
          status: 'running',
          engine: 'ffmpeg_cpu',
          startedAt: now,
          completedAt: null,
          detail: 'Em andamento',
        },
      ],
      resultSummary: null,
      outputText: null,
      error: null,
      artifacts: [],
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    });
    db1.close();

    // Reopen as if host restarted
    const db2 = new RemoteHostDatabase(dbPath);
    const recovered = db2.recoverInterruptedJobs();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, 'interrupted_on_restart');

    const loaded = db2.getJob('rjob-crash-1');
    assert.equal(loaded?.status, 'interrupted_on_restart');
    const events = db2.listJobEvents('rjob-crash-1');
    assert.ok(events.some((e) => e.stage === 'recovery'));
    db2.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 3 RF-07 Fallback & Solo Agent execute real subprocesses, fallback on quota error, and kill on cancel', async () => {
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-cli-sim-'));
  try {
    // 1. Failing quota CLI (antigravity) + Succeeding solo/fallback CLI (codex)
    const quotaScript = writeFakeNodeCliScript(
      cliDir,
      'fake-agy.mjs',
      `
      if (process.argv.includes('--version')) {
        console.log('agy 1.5.8');
        process.exit(0);
      }
      console.error('quota_exhausted: credit balance is too low');
      process.exit(1);
      `,
    );
    const codexScript = writeFakeNodeCliScript(
      cliDir,
      'fake-codex.mjs',
      `
      if (process.argv.includes('--version')) {
        console.log('codex 0.44.0');
        process.exit(0);
      }
      console.log('ROTEIRO REAL DO CODEX SOLO: Cena 1 gancho visual cinematografico.');
      process.exit(0);
      `,
    );
    const slowScript = writeFakeNodeCliScript(
      cliDir,
      'fake-slow.mjs',
      `
      if (process.argv.includes('--version')) {
        console.log('claude 1.0.9');
        process.exit(0);
      }
      setTimeout(() => console.log('late'), 30000);
      `,
    );

    const ctx = await startTestServer({
      agentOverrides: {
        ollamaBaseUrl: 'http://127.0.0.1:1', // unreachable
        env: { PATH: '' }, // hide host binaries so only explicit overrides exist
        binaryOverrides: {
          'antigravity-cli': { command: process.execPath, prefixArgs: [quotaScript] },
          'codex-cli': { command: process.execPath, prefixArgs: [codexScript] },
        },
      },
    });

    try {
      // Discover agents
      const agentsRes = await fetch(`${ctx.baseUrl}/api/agents`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(agentsRes.status, 200);
      const agentsJson = (await agentsRes.json()) as {
        availableCount: number;
        soloModeReady: boolean;
      };
      assert.equal(agentsJson.availableCount, 2);
      assert.equal(agentsJson.soloModeReady, true);

      // Run agent job -> antigravity fails with quota -> automatically falls back to codex-cli!
      const createRes = await fetch(`${ctx.baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'agent.run',
          agentTask: 'script',
          title: 'Teste RF-07 Fallback',
          prompt: 'Crie uma abertura de video sobre astronomia.',
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as { job: { id: string } };

      type AgentDetailResp = { job: { status: string; agentUsed: string | null; outputText: string | null } };
      let detail: AgentDetailResp | null = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const r = await fetch(`${ctx.baseUrl}/api/jobs/${created.job.id}`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        detail = (await r.json()) as AgentDetailResp;
        if (detail.job.status === 'completed' || detail.job.status === 'failed') break;
      }

      assert.ok(detail);
      assert.equal(detail.job.status, 'completed');
      assert.equal(detail.job.agentUsed, 'codex-cli');
      assert.ok(detail.job.outputText?.includes('ROTEIRO REAL DO CODEX SOLO'));
    } finally {
      await ctx.cleanup();
    }

    // 2. Test Solo Agent + Cancellation kills process cleanly
    const ctxCancel = await startTestServer({
      agentOverrides: {
        ollamaBaseUrl: 'http://127.0.0.1:1',
        env: { PATH: '' },
        binaryOverrides: {
          'claude-cli': { command: process.execPath, prefixArgs: [slowScript] },
        },
      },
    });
    try {
      const created = (await (
        await fetch(`${ctxCancel.baseUrl}/api/jobs`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'agent.run',
            title: 'Job para cancelar',
            prompt: 'Longa tarefa',
          }),
        })
      ).json()) as { job: { id: string } };

      await new Promise((r) => setTimeout(r, 250));
      const cancelRes = await fetch(`${ctxCancel.baseUrl}/api/jobs/${created.job.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(cancelRes.status, 200);
      const cancelled = (await cancelRes.json()) as { job: { status: string } };
      assert.equal(cancelled.job.status, 'cancelled');
    } finally {
      await ctxCancel.cleanup();
    }
  } finally {
    fs.rmSync(cliDir, { recursive: true, force: true });
  }
});

test('Phase 4 & 2 Real FFmpeg render + SSE Last-Event-ID replay + HMAC Ticket HTTP Range 206 + Approval Gate', async () => {
  const ctx = await startTestServer();
  try {
    // 1. Sensitive operation enters awaiting_approval and can be rejected cleanly
    const sensitiveRes = await fetch(`${ctx.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'media.acquire',
        title: 'Download controlado',
        mediaQuery: 'nebula space',
      }),
    });
    assert.equal(sensitiveRes.status, 201);
    const sensitiveJob = (await sensitiveRes.json()) as { job: { id: string; status: string } };
    assert.equal(sensitiveJob.job.status, 'awaiting_approval');

    const rejectRes = await fetch(`${ctx.baseUrl}/api/jobs/${sensitiveJob.job.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false, note: 'Cancelado no teste' }),
    });
    assert.equal(rejectRes.status, 200);
    const rejected = (await rejectRes.json()) as { job: { status: string; approvalState: string } };
    assert.equal(rejected.job.status, 'cancelled');
    assert.equal(rejected.job.approvalState, 'rejected');

    // 2. Real FFmpeg MP4 render
    const renderRes = await fetch(`${ctx.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'render.ffmpeg',
        title: 'Render E2E Remote Host',
        aspectRatio: '16:9',
        qualityPreset: 'draft_540p',
        useGpu: true,
      }),
    });
    assert.equal(renderRes.status, 201);
    const { job } = (await renderRes.json()) as { job: { id: string } };

    // Poll until completed
    type RenderDetailResp = {
      job: {
        status: string;
        progressPct: number | null;
        artifacts: Array<{ id: string; kind: string; videoCodec: string | null; audioCodec: string | null; sizeBytes: number }>;
      };
      recentEvents: Array<{ seq: number; type: string }>;
    };
    let detail: RenderDetailResp | null = null;

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const r = await fetch(`${ctx.baseUrl}/api/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      detail = (await r.json()) as RenderDetailResp;
      if (detail.job.status === 'completed' || detail.job.status === 'failed') break;
    }

    assert.ok(detail);
    assert.equal(detail.job.status, 'completed');
    assert.equal(detail.job.progressPct, 100);
    const mp4 = detail.job.artifacts.find((a) => a.kind === 'video_mp4');
    assert.ok(mp4, 'Expected MP4 artifact');
    assert.equal(mp4.videoCodec, 'h264');
    assert.equal(mp4.audioCodec, 'aac');
    assert.ok(mp4.sizeBytes > 1000);

    // 3. Verify SSE replay with Last-Event-ID
    const firstSeq = detail.recentEvents[0]?.seq ?? 0;
    const sseController = new AbortController();
    const sseRes = await fetch(`${ctx.baseUrl}/api/jobs/${job.id}/events`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Last-Event-ID': String(firstSeq),
      },
      signal: sseController.signal,
    });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get('content-type')?.includes('text/event-stream'));
    const reader = sseRes.body!.getReader();
    const { value } = await reader.read();
    sseController.abort();
    const sseChunk = new TextDecoder().decode(value);
    assert.ok(sseChunk.includes('id: ') && sseChunk.includes('data: '));

    // 4. Mint ephemeral 60s HMAC ticket & fetch HTTP Range 206 without Bearer token in URL
    const ticketRes = await fetch(`${ctx.baseUrl}/api/artifacts/${mp4.id}/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(ticketRes.status, 200);
    const ticket = (await ticketRes.json()) as { streamPath: string };
    assert.ok(!ticket.streamPath.includes(TOKEN));

    const rangeRes = await fetch(`${ctx.baseUrl}${ticket.streamPath}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-type'), 'video/mp4');
    const bytes = new Uint8Array(await rangeRes.arrayBuffer());
    assert.equal(bytes.byteLength, 1024);

    // Artifact without ticket or auth must return 401
    const unauthArt = await fetch(`${ctx.baseUrl}/api/artifacts/${mp4.id}`);
    assert.equal(unauthArt.status, 401);
  } finally {
    await ctx.cleanup();
  }
});
