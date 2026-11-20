import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  REMOTE_CONTRACT_VERSION,
  type SyncChangeEvent,
  type SyncChangesResponse,
  type SyncConflictPayload,
  type SyncMediaTicketResponse,
  type SyncSnapshotResponse,
  type SyncedProjectData,
  type SyncedProjectRecord,
} from '../src/contracts/v1';
import { createRemoteHostApp } from '../src/server';

const TOKEN = 'test-bidirectional-sync-token-aethera-2026';

function sampleProjectData(overrides: Partial<SyncedProjectData> = {}): SyncedProjectData {
  return {
    title: 'Os Segredos do Telescópio James Webb',
    briefing: 'Crie um documentário técnico de 10 minutos sobre os espelhos de ouro e o ponto Lagrange L2.',
    creationMode: 'ai',
    format: 'youtube_1080p',
    style: 'Documentário',
    aspectRatio: '16:9',
    language: 'pt-BR',
    durationMin: 10,
    humorLevel: 15,
    ttsProvider: 'voicestudio',
    ttsVoice: 'Atlas Documental',
    qualityPreset: 'review_720p',
    status: 'briefing',
    scheduledDate: null,
    humanizedScript: null,
    scenes: [
      {
        id: 'sc-1',
        index: 1,
        title: 'Abertura L2',
        narration: 'A um milhão e meio de quilômetros da Terra, um espelho dourado escuta o passado.',
        visualQuery: 'james webb telescope space gold mirror',
        durationSec: 12,
        transition: 'corte_seco',
        mediaMatched: true,
        caption: '1,5 milhão de km da Terra',
        accentHex: '#6a46d8',
        mediaRefId: null,
      },
    ],
    revisions: [],
    latestJobId: null,
    latestRenderMediaRefId: null,
    mediaRefs: [],
    ...overrides,
  };
}

async function startSyncTestServer(setupDesktopDir?: (desktopUserDataDir: string) => void) {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-sync-e2e-'));
  const dataDir = path.join(rootTmp, 'remote-host-data');
  const desktopUserDataDir = path.join(rootTmp, 'AetheraStudio');
  fs.mkdirSync(path.join(desktopUserDataDir, 'cinema-projects'), { recursive: true });
  setupDesktopDir?.(desktopUserDataDir);

  const instance = createRemoteHostApp({
    bindHost: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    authToken: TOKEN,
    dataDir,
    monorepoRoot: path.resolve(process.cwd()),
    allowedOrigins: ['http://localhost:3000'],
    allowedRoots: [path.join(dataDir, 'artifacts'), desktopUserDataDir],
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 500,
    desktopUserDataDir,
    enableDesktopWatcher: false,
  });

  const server = await new Promise<ReturnType<typeof instance.app.listen>>((resolve) => {
    const s = instance.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const authHeaders = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    ...extra,
  });

  return {
    baseUrl,
    dataDir,
    desktopUserDataDir,
    instance,
    authHeaders,
    async cleanup() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      fs.rmSync(rootTmp, { recursive: true, force: true });
    },
  };
}

test('Pre-migration backup preserves existing Desktop cinema-projects/*.json with SHA-256 manifest before ingestion', async () => {
  const existingId = 'cinema_legacy_desktop_01';
  const ctx = await startSyncTestServer((desktopDir) => {
    const legacyPkg = {
      timeline: {
        projectId: existingId,
        version: 3,
        clips: [],
        sourceMedia: [],
      },
      direction: {
        brief: {
          prompt: 'Projeto legado criado originalmente no Aethera Desktop Windows.',
          genre: 'documentary',
          targetDurationSec: 420,
          aspectRatio: '16:9',
          language: 'pt-BR',
        },
        treatment: 'Tratamento legado Desktop',
      },
      scenes: [
        {
          id: 'desktop-sc-1',
          title: 'Cena Desktop Legada',
          narration: 'Texto original salvo no Windows antes da sincronização.',
          durationSec: 15,
        },
      ],
    };
    fs.writeFileSync(
      path.join(desktopDir, 'cinema-projects', `${existingId}.json`),
      JSON.stringify(legacyPkg, null, 2),
      'utf8',
    );
  });

  try {
    const snapRes = await fetch(`${ctx.baseUrl}/api/sync/snapshot`, { headers: ctx.authHeaders() });
    assert.equal(snapRes.status, 200);
    const snap = (await snapRes.json()) as SyncSnapshotResponse;

    assert.equal(snap.schemaVersion, REMOTE_CONTRACT_VERSION);
    assert.equal(snap.desktopBridgeStatus.desktopUserDataDetected, true);
    assert.ok(snap.desktopBridgeStatus.lastBackup, 'Backup pré-migração deve existir');
    assert.equal(snap.desktopBridgeStatus.lastBackup.fileCount, 1);
    assert.match(snap.desktopBridgeStatus.lastBackup.manifestSha256, /^[a-f0-9]{64}$/);

    // Verify backup directory & manifest exist on disk
    const backupsDir = path.join(ctx.dataDir, 'backups');
    assert.equal(fs.existsSync(backupsDir), true);
    const backupFolders = fs.readdirSync(backupsDir);
    assert.ok(backupFolders.length >= 1);
    const manifestPath = path.join(backupsDir, backupFolders[0], 'manifest.json');
    assert.equal(fs.existsSync(manifestPath), true);

    // Existing legacy Desktop project was ingested non-destructively
    const imported = snap.projects.find((p) => p.id === existingId);
    assert.ok(imported, 'Projeto legado do Desktop deve constar no snapshot');
    assert.equal(imported.origin, 'desktop');
    assert.equal(imported.version, 1);
    assert.match(imported.data.briefing, /Projeto legado criado originalmente no Aethera Desktop/);
  } finally {
    await ctx.cleanup();
  }
});

test('Full Bidirectional Flow: Web create -> Desktop projection -> Desktop edit -> SSE/incremental sync -> 409 Conflict & resolution -> PC FFmpeg MP4 access', async () => {
  const ctx = await startSyncTestServer();
  try {
    // 1. Web creates project with Idempotency-Key
    const idemKey = 'idem-web-create-james-webb-001';
    const createRes1 = await fetch(`${ctx.baseUrl}/api/sync/projects`, {
      method: 'POST',
      headers: ctx.authHeaders({ 'Idempotency-Key': idemKey }),
      body: JSON.stringify({
        actor: 'web',
        data: sampleProjectData(),
      }),
    });
    assert.equal(createRes1.status, 201);
    const createdBody1 = (await createRes1.json()) as { project: SyncedProjectRecord };
    const project = createdBody1.project;
    assert.equal(project.version, 1);
    assert.equal(project.origin, 'web');

    // 2. Idempotency replay returns exact same project without duplication
    const createRes2 = await fetch(`${ctx.baseUrl}/api/sync/projects`, {
      method: 'POST',
      headers: ctx.authHeaders({ 'Idempotency-Key': idemKey }),
      body: JSON.stringify({
        actor: 'web',
        data: sampleProjectData(),
      }),
    });
    assert.equal(createRes2.status, 200);
    const createdBody2 = (await createRes2.json()) as {
      project: SyncedProjectRecord;
      idempotentReplay?: boolean;
    };
    assert.equal(createdBody2.idempotentReplay, true);
    assert.equal(createdBody2.project.id, project.id);
    assert.equal(createdBody2.project.version, 1);

    // 3. Verify atomic projection to Desktop cinema-projects/<id>.json + .sync.json
    const desktopProjPath = path.join(ctx.desktopUserDataDir, 'cinema-projects', `${project.id}.json`);
    const desktopSyncPath = path.join(ctx.desktopUserDataDir, 'cinema-projects', `${project.id}.sync.json`);
    assert.equal(fs.existsSync(desktopProjPath), true, 'Projeto deve ser projetado em cinema-projects/');
    assert.equal(fs.existsSync(desktopSyncPath), true, 'Sidecar .sync.json deve existir');
    const projectedPkg = JSON.parse(fs.readFileSync(desktopProjPath, 'utf8')) as {
      timeline: { projectId: string };
      direction: { brief: { prompt: string } };
    };
    assert.equal(projectedPkg.timeline.projectId, project.id);
    assert.match(projectedPkg.direction.brief.prompt, /espelhos de ouro/);

    // 4. Open authenticated SSE stream (/api/sync/events) to verify real-time push on Desktop edit
    const snapshotBeforeEdit = (await (
      await fetch(`${ctx.baseUrl}/api/sync/snapshot`, { headers: ctx.authHeaders() })
    ).json()) as SyncSnapshotResponse;
    const seqBeforeEdit = snapshotBeforeEdit.currentSeq;

    const sseAbort = new AbortController();
    const sseReceived: SyncChangeEvent[] = [];
    const ssePromise = (async () => {
      const res = await fetch(`${ctx.baseUrl}/api/sync/events`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'text/event-stream',
          'Last-Event-ID': String(seqBeforeEdit),
        },
        signal: sseAbort.signal,
      });
      assert.equal(res.status, 200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
          const dataLine = block.split(/\r?\n/).find((l) => l.startsWith('data: '));
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(6)) as SyncChangeEvent;
            sseReceived.push(parsed);
            if (parsed.projectId === project.id && parsed.eventType === 'desktop_ingested') {
              sseAbort.abort();
              return;
            }
          }
        }
      }
    })().catch(() => undefined);

    // Wait briefly so SSE subscriber is registered
    await new Promise((r) => setTimeout(r, 80));

    // 5. Simulate Aethera Desktop editing cinema-projects/<id>.json on disk
    const desktopEdited = JSON.parse(fs.readFileSync(desktopProjPath, 'utf8')) as Record<string, unknown> & {
      direction: { brief: { prompt: string; title?: string } };
      timeline: { version: number };
    };
    desktopEdited.direction.brief.prompt =
      'EDIÇÃO FEITA NO DESKTOP: Documentário 4K focado na calibração criogênica do NIRCam.';
    desktopEdited.timeline.version = 2;
    fs.writeFileSync(desktopProjPath, JSON.stringify(desktopEdited, null, 2), 'utf8');

    // Trigger Desktop ingest (mirrors fs.watch callback on Windows)
    const ingestRes = await fetch(`${ctx.baseUrl}/api/sync/desktop-ingest`, {
      method: 'POST',
      headers: ctx.authHeaders(),
    });
    assert.equal(ingestRes.status, 200);
    const ingestJson = (await ingestRes.json()) as { ingestedCount: number };
    assert.equal(ingestJson.ingestedCount, 1);

    await Promise.race([ssePromise, new Promise((r) => setTimeout(r, 1500))]);
    sseAbort.abort();

    assert.ok(
      sseReceived.some((e) => e.projectId === project.id && e.eventType === 'desktop_ingested' && e.version === 2),
      'Web deve receber evento SSE em tempo real após edição no Desktop',
    );

    // Verify incremental changes endpoint (/api/sync/changes?since=...)
    const changesRes = await fetch(`${ctx.baseUrl}/api/sync/changes?since=${seqBeforeEdit}`, {
      headers: ctx.authHeaders(),
    });
    assert.equal(changesRes.status, 200);
    const changesJson = (await changesRes.json()) as SyncChangesResponse;
    assert.ok(changesJson.changes.some((c) => c.projectId === project.id && c.version === 2));

    // 6. Concurrency Conflict: Web tries to save using stale expectedVersion=1 -> HTTP 409 Conflict!
    const conflictRes = await fetch(`${ctx.baseUrl}/api/sync/projects/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      headers: ctx.authHeaders({ 'Idempotency-Key': 'idem-stale-web-write' }),
      body: JSON.stringify({
        expectedVersion: 1,
        actor: 'web',
        data: sampleProjectData({
          briefing: 'EDIÇÃO CONCORRENTE DO WEB que não pode sobrescrever silenciosamente o Desktop!',
        }),
      }),
    });
    assert.equal(conflictRes.status, 409);
    const conflictBody = (await conflictRes.json()) as SyncConflictPayload;
    assert.equal(conflictBody.code, 'SYNC_VERSION_CONFLICT');
    assert.equal(conflictBody.serverVersion, 2);
    assert.equal(conflictBody.expectedVersion, 1);
    assert.ok(conflictBody.changedFields.includes('briefing'));
    assert.match(conflictBody.serverProject.data.briefing, /EDIÇÃO FEITA NO DESKTOP/);

    // 7. Resolve conflict via fork_copy (preserves Desktop v2 untouched and creates a new copy for Web edit)
    const forkRes = await fetch(
      `${ctx.baseUrl}/api/sync/projects/${encodeURIComponent(project.id)}/resolve-conflict`,
      {
        method: 'POST',
        headers: ctx.authHeaders({ 'Idempotency-Key': 'idem-resolve-fork' }),
        body: JSON.stringify({
          strategy: 'fork_copy',
          actor: 'web',
          clientData: conflictBody.incomingData,
        }),
      },
    );
    assert.equal(forkRes.status, 200);
    const forkJson = (await forkRes.json()) as {
      project: SyncedProjectRecord;
      forkedProject?: SyncedProjectRecord;
    };
    assert.equal(forkJson.project.id, project.id);
    assert.equal(forkJson.project.version, 2);
    assert.ok(forkJson.forkedProject, 'fork_copy deve retornar forkedProject');
    assert.notEqual(forkJson.forkedProject.id, project.id);
    assert.match(forkJson.forkedProject.data.briefing, /EDIÇÃO CONCORRENTE DO WEB/);

    // 8. Run real FFmpeg render job on PC linked to synced projectId & verify MP4 access in BOTH Web and Desktop
    const jobRes = await fetch(`${ctx.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: ctx.authHeaders(),
      body: JSON.stringify({
        operation: 'render.ffmpeg',
        title: 'Render E2E Sincronizado',
        prompt: 'Teste real de sincronização de MP4 entre PC e Web',
        aspectRatio: '16:9',
        qualityPreset: 'draft_540p',
        useGpu: false,
        projectId: project.id,
      }),
    });
    assert.equal(jobRes.status, 201);
    const createdJob = ((await jobRes.json()) as { job: { id: string } }).job;

    // Wait for FFmpeg render job to finish
    let finalStatus = 'queued';
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const detailRes = await fetch(`${ctx.baseUrl}/api/jobs/${encodeURIComponent(createdJob.id)}`, {
        headers: ctx.authHeaders(),
      });
      const detail = (await detailRes.json()) as { job: { status: string; error: string | null } };
      finalStatus = detail.job.status;
      if (finalStatus === 'completed' || finalStatus === 'failed') {
        assert.equal(finalStatus, 'completed', `FFmpeg job falhou: ${detail.job.error ?? 'desconhecido'}`);
        break;
      }
    }
    assert.equal(finalStatus, 'completed');

    // Check Desktop .render.json sidecar exists & points to real MP4
    const desktopRenderJsonPath = path.join(ctx.desktopUserDataDir, 'cinema-projects', `${project.id}.render.json`);
    assert.equal(fs.existsSync(desktopRenderJsonPath), true, 'Desktop .render.json deve ser atualizado após render no PC');
    const desktopRenderMeta = JSON.parse(fs.readFileSync(desktopRenderJsonPath, 'utf8')) as { mp4Path: string };
    assert.equal(fs.existsSync(desktopRenderMeta.mp4Path), true, 'Arquivo MP4 real deve existir para o Desktop');

    // Check Web snapshot has opaque mediaRefId without exposing any Windows/Linux absolute path
    const finalSnap = (await (
      await fetch(`${ctx.baseUrl}/api/sync/snapshot`, { headers: ctx.authHeaders() })
    ).json()) as SyncSnapshotResponse;
    const rawSnapText = JSON.stringify(finalSnap);
    assert.ok(!rawSnapText.includes(ctx.desktopUserDataDir), 'Nenhum caminho interno de diretório pode vazar na API');
    assert.ok(!rawSnapText.includes(ctx.dataDir), 'Nenhum caminho interno de dataDir pode vazar na API');

    const updatedProject = finalSnap.projects.find((p) => p.id === project.id);
    assert.ok(updatedProject?.data.latestRenderMediaRefId, 'latestRenderMediaRefId deve estar preenchido');

    // Mint authenticated HMAC ticket and stream MP4 via HTTP Range 206
    const ticketRes = await fetch(
      `${ctx.baseUrl}/api/sync/media/${encodeURIComponent(updatedProject.data.latestRenderMediaRefId)}/ticket`,
      {
        method: 'POST',
        headers: ctx.authHeaders(),
      },
    );
    assert.equal(ticketRes.status, 200);
    const ticket = (await ticketRes.json()) as SyncMediaTicketResponse;

    const rangeRes = await fetch(`${ctx.baseUrl}${ticket.streamPath}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-type'), 'video/mp4');
    const chunk = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(chunk.length, 1024);
    assert.ok(chunk.includes(Buffer.from('ftyp')), 'Chunk MP4 real deve conter box ISO BMFF ftyp');
  } finally {
    await ctx.cleanup();
  }
});
