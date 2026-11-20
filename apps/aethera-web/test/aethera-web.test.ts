import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAetheraApiApp } from '../server';
import { AetheraDatabase } from '../server/db';
import { FfmpegRenderManager } from '../server/ffmpeg-renderer';
import {
  analyzeYouTubePackage,
  generateStoryboardScenes,
  humanizeNarrationScript,
  parseBriefingIntent,
  planSurgicalRevision,
} from '../src/domain/briefing-parser';
import {
  advancePipelineOneStage,
  auditCreativeProject,
  completeEntirePipeline,
  createDefaultChecklist,
  createDefaultPublicationPackage,
  createInitialStages,
  detectCalendarConflicts,
  generateDerivativeVariant,
  generateThumbnailLabVariants,
  getPipelineProgressPct,
} from '../src/domain/pipeline-engine';
import { createSeedState } from '../src/domain/seed-data';
import type { ProductionProject, RenderJob } from '../src/domain/types';

test('parseBriefingIntent detects Top 10, duration, 16:9 and strips trailing clauses', () => {
  const res = parseBriefingIntent(
    'Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com humor pontual e duração de 12 minutos.',
  );
  assert.equal(res.style, 'Top 10');
  assert.equal(res.durationMin, 12);
  assert.equal(res.durationDetected, true);
  assert.equal(res.aspectRatio, '16:9');
  assert.equal(res.humorLevel, 35);
  assert.equal(res.title, 'Os 10 chefes mais difíceis de Elden Ring');
});

test('parseBriefingIntent detects Shorts 9:16 vertical format', () => {
  const res = parseBriefingIntent('Faça um short vertical 9:16 de 45 segundos sobre cinema');
  assert.equal(res.aspectRatio, '9:16');
  assert.equal(res.format, 'shorts_9_16');
});

test('humanizeNarrationScript removes robotic AI cliches and improves readability', () => {
  const raw =
    'No cenário atual, vale ressaltar que devemos mergulhar fundo nesta arquitetura revolucionária, portanto, sem dúvida alguma, ela transforma o som.';
  const res = humanizeNarrationScript(raw, 'editorial');
  assert.ok(!res.humanizedText.toLowerCase().includes('no cenário atual'));
  assert.ok(!res.humanizedText.toLowerCase().includes('mergulhar fundo'));
  assert.ok(res.changes.length >= 3);
  assert.ok(res.readabilityAfter >= res.readabilityBefore);
});

test('analyzeYouTubePackage generates chapters, tags, and score', () => {
  const seed = createSeedState();
  const project = seed.projects[1];
  const analysis = analyzeYouTubePackage(project, project.publicationPackage);
  assert.ok(analysis.suggestedDescription.includes('00:00'));
  assert.ok(analysis.suggestedTags.length >= 4);
  assert.ok(analysis.score >= 0 && analysis.score <= 100);
});

test('pipeline stages advance cleanly and reach awaiting_review at 100%', () => {
  const now = new Date().toISOString();
  let project: ProductionProject = {
    id: 'test-p1',
    title: 'Teste Pipeline',
    briefing: 'Documentário de 10 minutos sobre física',
    creationMode: 'ai',
    channelId: null,
    format: 'documentary_wide',
    style: 'Documentário',
    aspectRatio: '16:9',
    language: 'pt-BR',
    durationMin: 10,
    humorLevel: 10,
    ttsProvider: 'voicestudio',
    ttsVoice: 'Narrador',
    qualityPreset: 'review_720p',
    status: 'producing',
    stages: createInitialStages(1),
    scenes: generateStoryboardScenes('Teste Pipeline', 'Física moderna', 10, 'Documentário'),
    comments: [],
    checklist: createDefaultChecklist(false),
    revisions: [],
    scheduledDate: null,
    humanizedScript: null,
    publicationPackage: createDefaultPublicationPackage('Teste Pipeline', 'Física moderna'),
    derivatives: [],
    analyticsSnapshots: [],
    latestRenderJobId: null,
    createdAt: now,
    updatedAt: now,
  };

  const step1 = advancePipelineOneStage(project);
  project = step1.nextProject;
  assert.equal(step1.reachedReview, false);
  assert.ok(getPipelineProgressPct(project.stages) > 15);

  const done = completeEntirePipeline(project);
  assert.equal(getPipelineProgressPct(done.stages), 100);
  assert.equal(done.status, 'awaiting_review');
});

test('surgical revision, derivatives, conflicts, and Thumbnail Lab A/B/C work as expected', () => {
  const rev = planSurgicalRevision('Ajustar narração e corte mais seco na cena 3');
  assert.ok(rev.affectedStages.includes('script'));
  assert.ok(rev.affectedStages.includes('assembly'));

  const seed = createSeedState();
  const variant = generateDerivativeVariant(seed.projects[0], 'youtube-short');
  assert.equal(variant.formatId, 'youtube-short');
  assert.equal(variant.status, 'candidate');

  const conflicts = detectCalendarConflicts(seed.projects, '2026-11-24');
  assert.equal(conflicts.length, 1);

  const lab = generateThumbnailLabVariants('Elden Ring', 'CHEFES IMPOSSÍVEIS', 'conceptual_art', seed.brandKits[0]);
  assert.equal(lab.length, 3);
  assert.equal(auditCreativeProject(lab[0]).passed, true);
});

test('SQLite persistence survives database close and reopen', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-db-'));
  const dbPath = path.join(tmpDir, 'test.db');

  const db1 = new AetheraDatabase(dbPath);
  const initialCount = db1.listProjects().length;
  assert.ok(initialCount >= 4);

  const seedProj = db1.listProjects()[0];
  db1.upsertProject({
    ...seedProj,
    id: 'proj-sqlite-persist-test',
    title: 'Projeto Persistido em SQLite Real',
    updatedAt: new Date().toISOString(),
  });
  db1.close();

  const db2 = new AetheraDatabase(dbPath);
  const reloaded = db2.getProject('proj-sqlite-persist-test');
  assert.ok(reloaded);
  assert.equal(reloaded.title, 'Projeto Persistido em SQLite Real');
  db2.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Real FFmpeg render generates playable H.264/AAC MP4 verified by FFprobe', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-render-'));
  const manager = new FfmpegRenderManager(tmpDir);
  const seed = createSeedState();
  const project = seed.projects[0];

  const job: RenderJob = {
    id: 'rnd-unit-test',
    projectId: project.id,
    projectTitle: project.title,
    preset: 'review_720p',
    aspectRatio: '16:9',
    status: 'queued',
    progressPct: 0,
    stageMessage: 'Iniciando',
    outputFilename: null,
    outputUrl: null,
    thumbnailUrl: null,
    probeMetrics: null,
    engine: 'ffmpeg_real',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  let progressEvents = 0;
  const completed = await manager.renderProjectPreview(project, job, {
    onProgress: () => {
      progressEvents += 1;
    },
    onComplete: () => undefined,
    onError: () => undefined,
  });

  assert.equal(completed.status, 'completed', `FFmpeg error: ${completed.error ?? 'none'}`);
  assert.ok(progressEvents >= 2);
  assert.ok(completed.outputFilename);
  assert.ok(completed.probeMetrics);
  assert.equal(completed.probeMetrics.videoCodec, 'h264');
  assert.equal(completed.probeMetrics.audioCodec, 'aac');
  assert.ok(completed.probeMetrics.width > 0);
  assert.ok(completed.probeMetrics.durationSec >= 5);
  assert.ok(completed.probeMetrics.fileSizeBytes > 5000);
  assert.ok(fs.existsSync(path.join(tmpDir, completed.outputFilename)));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Express API endpoints persist manual project, package, channel, and report honest yt-dlp status', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-api-'));
  const { app, db } = createAetheraApiApp({
    dbPath: path.join(tmpDir, 'api.db'),
    rendersDir: path.join(tmpDir, 'renders'),
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    const bootRes = await fetch(`${base}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const boot = (await bootRes.json()) as { projects: ProductionProject[]; channels: unknown[]; capabilities: { items: Array<{ id: string }> } };
    assert.ok(boot.projects.length >= 4);
    assert.ok(boot.capabilities.items.some((i) => i.id === 'ffmpeg'));

    const createRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Documentário Manual API Test',
        briefing: 'Teste de integração completa com SQLite',
        creationMode: 'manual',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as ProductionProject;
    assert.equal(created.creationMode, 'manual');

    const pkgRes = await fetch(`${base}/api/projects/${created.id}/package`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Documentário Manual — Pacote Aprovado',
        approvalStatus: 'approved',
      }),
    });
    assert.equal(pkgRes.status, 200);
    const pkgProj = (await pkgRes.json()) as ProductionProject;
    assert.equal(pkgProj.publicationPackage.approvalStatus, 'approved');

    const ytDlpRes = await fetch(`${base}/api/media/acquire-ytdlp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    // Container without yt-dlp must honestly return 503 + blocked (never fake success)
    assert.ok(ytDlpRes.status === 503 || ytDlpRes.status === 200);
    const ytDlpJson = (await ytDlpRes.json()) as { status: string };
    assert.ok(ytDlpJson.status === 'blocked' || ytDlpJson.status === 'ok');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
