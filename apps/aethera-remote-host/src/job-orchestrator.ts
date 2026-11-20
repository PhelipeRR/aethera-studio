import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import type {
  CreateRemoteJobRequest,
  RemoteArtifactRecord,
  RemoteJobEvent,
  RemoteJobRecord,
  RemoteJobStageRecord,
  RemoteOperationType,
} from './contracts/v1';
import { killProcessTree, type RemoteAgentManager } from './agents';
import { probeMediaWithFfprobe, type CinemaBridgeHandle } from './cinema-bridge';
import type { RemoteHostDatabase } from './db';

const SENSITIVE_OPERATIONS = new Set<RemoteOperationType>(['media.acquire']);

interface ActiveExecution {
  controller: AbortController;
  children: Set<ChildProcess>;
}

export class RemoteJobOrchestrator {
  private readonly db: RemoteHostDatabase;
  private readonly agents: RemoteAgentManager;
  private readonly cinema: CinemaBridgeHandle;
  private readonly artifactsDir: string;
  private readonly workspaceDir: string;
  private readonly onArtifactRegistered?: (
    job: RemoteJobRecord,
    artifact: RemoteArtifactRecord,
    filePath: string,
  ) => void;
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly jobSubscribers = new Map<string, Set<Response>>();
  private readonly globalSubscribers = new Set<Response>();
  private readonly heartbeatTimer: NodeJS.Timeout;

  constructor(options: {
    db: RemoteHostDatabase;
    agents: RemoteAgentManager;
    cinema: CinemaBridgeHandle;
    artifactsDir: string;
    workspaceDir: string;
    onArtifactRegistered?: (
      job: RemoteJobRecord,
      artifact: RemoteArtifactRecord,
      filePath: string,
    ) => void;
  }) {
    this.db = options.db;
    this.agents = options.agents;
    this.cinema = options.cinema;
    this.artifactsDir = path.resolve(options.artifactsDir);
    this.workspaceDir = path.resolve(options.workspaceDir);
    this.onArtifactRegistered = options.onArtifactRegistered;
    fs.mkdirSync(this.artifactsDir, { recursive: true });

    this.heartbeatTimer = setInterval(() => {
      const payload = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
      for (const res of this.globalSubscribers) {
        try {
          res.write(payload);
        } catch {
          this.globalSubscribers.delete(res);
        }
      }
      for (const [jobId, set] of this.jobSubscribers.entries()) {
        for (const res of set) {
          try {
            res.write(payload);
          } catch {
            set.delete(res);
          }
        }
        if (set.size === 0) this.jobSubscribers.delete(jobId);
      }
    }, 15_000);
    this.heartbeatTimer.unref();
  }

  public close(): void {
    clearInterval(this.heartbeatTimer);
    for (const [jobId] of this.activeExecutions) {
      this.cancelJob(jobId);
    }
    for (const res of this.globalSubscribers) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.globalSubscribers.clear();
    for (const set of this.jobSubscribers.values()) {
      for (const res of set) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    }
    this.jobSubscribers.clear();
  }

  public subscribeJob(jobId: string, res: Response, lastEventId = 0): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Replay missed persisted events from SQLite (real Last-Event-ID reconnection recovery)
    const missed = this.db.listJobEvents(jobId, lastEventId, 500);
    for (const ev of missed) {
      this.writeSseEvent(res, ev);
    }

    let set = this.jobSubscribers.get(jobId);
    if (!set) {
      set = new Set();
      this.jobSubscribers.set(jobId, set);
    }
    set.add(res);

    res.on('close', () => {
      set?.delete(res);
      if (set && set.size === 0) this.jobSubscribers.delete(jobId);
    });
  }

  public subscribeGlobal(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);
    this.globalSubscribers.add(res);
    res.on('close', () => {
      this.globalSubscribers.delete(res);
    });
  }

  private writeSseEvent(res: Response, ev: RemoteJobEvent): void {
    res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  private emitEvent(input: {
    jobId: string;
    type: RemoteJobEvent['type'];
    level: RemoteJobEvent['level'];
    stage: string;
    message: string;
    progressPct: number | null;
    data?: Record<string, unknown>;
  }): RemoteJobEvent {
    const ev = this.db.appendJobEvent(input);
    const set = this.jobSubscribers.get(input.jobId);
    if (set) {
      for (const res of set) {
        try {
          this.writeSseEvent(res, ev);
        } catch {
          set.delete(res);
        }
      }
    }
    for (const res of this.globalSubscribers) {
      try {
        this.writeSseEvent(res, ev);
      } catch {
        this.globalSubscribers.delete(res);
      }
    }
    return ev;
  }

  private buildInitialStages(req: CreateRemoteJobRequest): RemoteJobStageRecord[] {
    if (req.operation === 'render.ffmpeg') {
      return [
        { id: 'render', label: 'Renderização FFmpeg (GPU/CPU)', status: 'pending', engine: req.useGpu === false ? 'ffmpeg_cpu' : 'ffmpeg_gpu', startedAt: null, completedAt: null, detail: 'Aguardando início.' },
        { id: 'probe', label: 'Auditoria Técnica FFprobe + EBU R128', status: 'pending', engine: 'ffprobe', startedAt: null, completedAt: null, detail: 'Aguardando arquivo MP4.' },
      ];
    }
    if (req.operation === 'agent.run' || req.operation === 'cinema.humanize' || req.operation === 'cinema.youtube_audit') {
      return [
        { id: 'agent', label: 'Execução de Agente Local (RF-07)', status: 'pending', engine: 'agent_cli', startedAt: null, completedAt: null, detail: 'Aguardando seleção do provedor.' },
      ];
    }
    if (req.operation === 'media.acquire') {
      return [
        { id: 'ytdlp', label: 'Aquisição Controlada via yt-dlp', status: 'pending', engine: 'yt_dlp', startedAt: null, completedAt: null, detail: 'Aguardando aprovação/execução.' },
      ];
    }
    if (req.operation === 'media.probe') {
      return [
        { id: 'probe', label: 'Inspeção Técnica FFprobe', status: 'pending', engine: 'ffprobe', startedAt: null, completedAt: null, detail: 'Aguardando inspeção.' },
      ];
    }
    // cinema.produce
    return [
      { id: 'engine_check', label: 'Cinema Engine / Agente Local (RF-07)', status: 'pending', engine: this.cinema.monorepoCinemaLoaded ? 'monorepo_cinema' : 'agent_cli', startedAt: null, completedAt: null, detail: 'Verificando @neuralbridge/cinema e agentes locais.' },
      { id: 'render', label: 'Renderização MP4 Real (FFmpeg)', status: 'pending', engine: req.useGpu === false ? 'ffmpeg_cpu' : 'ffmpeg_gpu', startedAt: null, completedAt: null, detail: 'Aguardando cenas para composição.' },
      { id: 'probe', label: 'Auditoria Técnica FFprobe + Revisão', status: 'pending', engine: 'ffprobe', startedAt: null, completedAt: null, detail: 'Aguardando MP4 gerado.' },
    ];
  }

  public createJob(req: CreateRemoteJobRequest): RemoteJobRecord {
    const now = new Date().toISOString();
    const id = `rjob-${crypto.randomBytes(6).toString('hex')}`;
    const requiresApproval = Boolean(req.requireApproval || SENSITIVE_OPERATIONS.has(req.operation));
    const title =
      req.title?.trim() ||
      (req.prompt?.trim().slice(0, 72) || `Job ${req.operation}`);

    const job: RemoteJobRecord = {
      id,
      operation: req.operation,
      title,
      projectId: req.projectId ?? null,
      status: requiresApproval ? 'awaiting_approval' : 'queued',
      requiresApproval,
      approvalState: requiresApproval ? 'pending' : 'not_required',
      approvalNote: null,
      engineMode: this.cinema.engineMode,
      agentUsed: null,
      encoderUsed: null,
      progressMode: req.operation === 'render.ffmpeg' ? 'real_ffmpeg' : 'real_stages',
      progressPct: null,
      currentStage: requiresApproval ? 'aguardando_aprovacao' : 'na_fila',
      stages: this.buildInitialStages(req),
      resultSummary: null,
      outputText: null,
      error: null,
      artifacts: [],
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      completedAt: null,
    };

    this.db.saveJob(job);
    this.emitEvent({
      jobId: job.id,
      type: requiresApproval ? 'approval_required' : 'job_created',
      level: 'info',
      stage: job.currentStage,
      message: requiresApproval
        ? `Job "${job.title}" (${job.operation}) aguardando aprovação humana antes da execução no PC.`
        : `Job "${job.title}" (${job.operation}) enfileirado no Remote Host.`,
      progressPct: null,
      data: { operation: job.operation, status: job.status, request: req },
    });

    if (!requiresApproval) {
      // Runs asynchronously in background — survives browser close!
      setImmediate(() => {
        void this.executeJob(job.id, req);
      });
    } else {
      // Store original request in first event data so approval can resume it cleanly
      this.pendingRequests.set(job.id, req);
    }

    return job;
  }

  private readonly pendingRequests = new Map<string, CreateRemoteJobRequest>();

  public approveJob(jobId: string, approved: boolean, note?: string): RemoteJobRecord | null {
    const job = this.db.getJob(jobId);
    if (!job) return null;
    if (job.status !== 'awaiting_approval') return job;

    const now = new Date().toISOString();
    if (!approved) {
      const rejected: RemoteJobRecord = {
        ...job,
        status: 'cancelled',
        approvalState: 'rejected',
        approvalNote: note?.trim() || 'Rejeitado pelo operador.',
        currentStage: 'rejeitado',
        updatedAt: now,
        completedAt: now,
        error: 'Operação rejeitada na etapa de aprovação humana.',
      };
      this.db.saveJob(rejected);
      this.pendingRequests.delete(jobId);
      this.emitEvent({
        jobId,
        type: 'approval_resolved',
        level: 'warn',
        stage: 'aprovacao',
        message: `Job rejeitado pelo usuário${note ? `: ${note}` : '.'}`,
        progressPct: null,
      });
      return rejected;
    }

    const req = this.pendingRequests.get(jobId);
    this.pendingRequests.delete(jobId);
    const queued: RemoteJobRecord = {
      ...job,
      status: 'queued',
      approvalState: 'approved',
      approvalNote: note?.trim() || 'Aprovado remotamente.',
      currentStage: 'aprovado_enfileirado',
      updatedAt: now,
    };
    this.db.saveJob(queued);
    this.emitEvent({
      jobId,
      type: 'approval_resolved',
      level: 'info',
      stage: 'aprovacao',
      message: 'Operação aprovada. Iniciando execução no Remote Host.',
      progressPct: null,
    });

    if (req) {
      setImmediate(() => {
        void this.executeJob(jobId, req);
      });
    }
    return queued;
  }

  public cancelJob(jobId: string): RemoteJobRecord | null {
    const job = this.db.getJob(jobId);
    if (!job) return null;

    const active = this.activeExecutions.get(jobId);
    if (active) {
      active.controller.abort('cancelled');
      for (const child of active.children) {
        killProcessTree(child);
      }
      this.activeExecutions.delete(jobId);
    }
    this.pendingRequests.delete(jobId);

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }

    const now = new Date().toISOString();
    const cancelled: RemoteJobRecord = {
      ...job,
      status: 'cancelled',
      currentStage: 'cancelado',
      error: 'Cancelado pelo operador.',
      updatedAt: now,
      completedAt: now,
      stages: job.stages.map((s) =>
        s.status === 'running' ? { ...s, status: 'failed', completedAt: now, detail: 'Cancelado.' } : s,
      ),
    };
    this.db.saveJob(cancelled);
    this.emitEvent({
      jobId,
      type: 'job_status',
      level: 'warn',
      stage: 'cancelado',
      message: 'Job cancelado e árvore de processos encerrada.',
      progressPct: cancelled.progressPct,
    });
    return cancelled;
  }

  private updateJob(jobId: string, updater: (job: RemoteJobRecord) => RemoteJobRecord): RemoteJobRecord | null {
    const curr = this.db.getJob(jobId);
    if (!curr) return null;
    const next = updater({ ...curr, updatedAt: new Date().toISOString() });
    this.db.saveJob(next);
    return next;
  }

  private setStage(
    jobId: string,
    stageId: string,
    patch: Partial<RemoteJobStageRecord>,
  ): void {
    const updated = this.updateJob(jobId, (job) => ({
      ...job,
      currentStage: stageId,
      stages: job.stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)),
    }));
    if (updated) {
      this.emitEvent({
        jobId,
        type: 'stage_update',
        level: patch.status === 'failed' || patch.status === 'blocked' ? 'warn' : 'info',
        stage: stageId,
        message: patch.detail ?? `Etapa ${stageId}: ${patch.status ?? 'atualizada'}`,
        progressPct: updated.progressPct,
        data: { stageId, status: patch.status },
      });
    }
  }

  private registerArtifact(jobId: string, artifact: RemoteArtifactRecord, filePath: string): void {
    this.db.saveArtifact(artifact, filePath);
    const job = this.db.getJob(jobId);
    if (job && this.onArtifactRegistered) {
      try {
        this.onArtifactRegistered(job, artifact, filePath);
      } catch {
        // Sync attachment must never crash job completion
      }
    }
    this.emitEvent({
      jobId,
      type: 'artifact_ready',
      level: 'info',
      stage: 'artifact',
      message: `Artefato pronto: ${artifact.filename} (${Math.round(artifact.sizeBytes / 1024)} KB)`,
      progressPct: null,
      data: { artifact },
    });
  }

  private async executeJob(jobId: string, req: CreateRemoteJobRequest): Promise<void> {
    const controller = new AbortController();
    const children = new Set<ChildProcess>();
    this.activeExecutions.set(jobId, { controller, children });

    const trackChild = (child: ChildProcess) => {
      children.add(child);
      child.once('close', () => children.delete(child));
    };

    const startIso = new Date().toISOString();
    this.updateJob(jobId, (j) => ({
      ...j,
      status: 'running',
      startedAt: startIso,
      currentStage: j.stages[0]?.id ?? 'running',
    }));
    this.emitEvent({
      jobId,
      type: 'job_status',
      level: 'info',
      stage: 'inicio',
      message: `Execução iniciada no host local (${req.operation}).`,
      progressPct: 0,
    });

    const jobDir = path.join(this.artifactsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    try {
      if (req.operation === 'render.ffmpeg') {
        await this.runRenderFfmpegJob(jobId, req, jobDir, controller.signal, trackChild);
      } else if (req.operation === 'agent.run' || req.operation === 'cinema.humanize' || req.operation === 'cinema.youtube_audit') {
        await this.runAgentJob(jobId, req, controller.signal, trackChild);
      } else if (req.operation === 'media.acquire') {
        await this.runMediaAcquireJob(jobId, req, jobDir, controller.signal, trackChild);
      } else if (req.operation === 'media.probe') {
        await this.runMediaProbeJob(jobId, req);
      } else if (req.operation === 'cinema.produce') {
        await this.runCinemaProduceJob(jobId, req, jobDir, controller.signal, trackChild);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      const now = new Date().toISOString();
      this.updateJob(jobId, (j) => ({
        ...j,
        status: 'failed',
        error: msg,
        completedAt: now,
        stages: j.stages.map((s) =>
          s.status === 'running' ? { ...s, status: 'failed', completedAt: now, detail: msg } : s,
        ),
      }));
      this.emitEvent({
        jobId,
        type: 'job_status',
        level: 'error',
        stage: 'erro',
        message: `Falha no job: ${msg}`,
        progressPct: null,
      });
    } finally {
      this.activeExecutions.delete(jobId);
    }
  }

  private async runRenderFfmpegJob(
    jobId: string,
    req: CreateRemoteJobRequest,
    jobDir: string,
    signal: AbortSignal,
    trackChild: (c: ChildProcess) => void,
  ): Promise<void> {
    const scenes =
      req.scenes && req.scenes.length > 0
        ? req.scenes
        : [
            { index: 1, title: 'Gancho & Premissa', caption: req.title || 'Produção Aethera Remote Studio', accentHex: '#b8a4f4' },
            { index: 2, title: 'Desenvolvimento', caption: req.prompt?.slice(0, 44) || 'Renderizado no host local via FFmpeg', accentHex: '#d8fb4f' },
            { index: 3, title: 'Clímax & Encerramento', caption: 'Pronto para revisão e download remoto', accentHex: '#f9a8d4' },
          ];

    this.setStage(jobId, 'render', {
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: 'Iniciando FFmpeg no host local...',
    });

    const out = await this.cinema.renderMp4WithRealFfmpeg({
      jobId,
      title: req.title || 'Render Remoto Aethera',
      style: req.style || 'Cinema IA',
      aspectRatio: req.aspectRatio ?? '16:9',
      qualityPreset: req.qualityPreset ?? 'draft_540p',
      useGpu: req.useGpu !== false,
      scenes,
      outputDir: jobDir,
      signal,
      onSpawn: trackChild,
      onProgressPct: (pct, detail) => {
        this.updateJob(jobId, (j) => ({ ...j, progressMode: 'real_ffmpeg', progressPct: pct }));
        this.emitEvent({
          jobId,
          type: 'progress',
          level: 'info',
          stage: 'render',
          message: detail,
          progressPct: pct,
        });
      },
      onLog: (msg, level) => {
        this.emitEvent({ jobId, type: 'log', level, stage: 'render', message: msg, progressPct: null });
      },
    });

    const now = new Date().toISOString();
    this.setStage(jobId, 'render', {
      status: 'completed',
      engine: out.encoderUsed === 'h264_nvenc' ? 'ffmpeg_gpu' : 'ffmpeg_cpu',
      completedAt: now,
      detail: `MP4 gerado via ${out.encoderUsed} (${out.probe.width}×${out.probe.height}, ${out.probe.durationSec}s).`,
    });
    this.setStage(jobId, 'probe', {
      status: 'completed',
      startedAt: now,
      completedAt: now,
      detail: `FFprobe OK: ${out.probe.videoCodec}/${out.probe.audioCodec}, ${Math.round(out.probe.sizeBytes / 1024)} KB${out.probe.loudnessLufs !== null ? `, EBU R128 ${out.probe.loudnessLufs} LUFS` : ''}.`,
    });

    const mp4Artifact: RemoteArtifactRecord = {
      id: `art-${crypto.randomBytes(6).toString('hex')}`,
      jobId,
      kind: 'video_mp4',
      filename: out.mp4Filename,
      mimeType: 'video/mp4',
      sizeBytes: out.probe.sizeBytes,
      durationSec: out.probe.durationSec,
      width: out.probe.width,
      height: out.probe.height,
      videoCodec: out.probe.videoCodec,
      audioCodec: out.probe.audioCodec,
      loudnessLufs: out.probe.loudnessLufs,
      encoderUsed: out.encoderUsed,
      createdAt: now,
    };
    this.registerArtifact(jobId, mp4Artifact, out.mp4Path);

    const thumbStat = fs.statSync(out.thumbPath);
    const thumbArtifact: RemoteArtifactRecord = {
      id: `art-${crypto.randomBytes(6).toString('hex')}`,
      jobId,
      kind: 'thumbnail_jpg',
      filename: out.thumbFilename,
      mimeType: 'image/jpeg',
      sizeBytes: thumbStat.size,
      durationSec: null,
      width: out.probe.width,
      height: out.probe.height,
      videoCodec: null,
      audioCodec: null,
      loudnessLufs: null,
      encoderUsed: null,
      createdAt: now,
    };
    this.registerArtifact(jobId, thumbArtifact, out.thumbPath);

    this.db.saveProject({
      id: req.projectId || `rproj-${jobId}`,
      title: req.title || 'Produção Remota',
      source: 'remote_host',
      aspectRatio: req.aspectRatio ?? '16:9',
      style: req.style || 'Cinema IA',
      status: 'awaiting_review',
      updatedAt: now,
      outputArtifactId: mp4Artifact.id,
      sceneCount: scenes.length,
    });

    this.updateJob(jobId, (j) => ({
      ...j,
      status: 'completed',
      encoderUsed: out.encoderUsed,
      progressPct: 100,
      currentStage: 'concluido',
      resultSummary: `MP4 real renderizado (${out.encoderUsed}, ${out.probe.width}×${out.probe.height}, ${out.probe.durationSec}s).`,
      completedAt: now,
    }));
    this.emitEvent({
      jobId,
      type: 'job_status',
      level: 'info',
      stage: 'concluido',
      message: `Renderização finalizada e pronta para revisão/download (${mp4Artifact.filename}).`,
      progressPct: 100,
    });
  }

  private async runAgentJob(
    jobId: string,
    req: CreateRemoteJobRequest,
    signal: AbortSignal,
    trackChild: (c: ChildProcess) => void,
  ): Promise<void> {
    const task =
      req.operation === 'cinema.humanize'
        ? 'humanize'
        : req.operation === 'cinema.youtube_audit'
          ? 'youtube_audit'
          : req.agentTask ?? 'script';

    this.setStage(jobId, 'agent', {
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: `Acionando cadeia RF-07 para tarefa "${task}"...`,
    });

    const result = await this.agents.executeWithFallback({
      task,
      prompt: req.prompt || req.title || 'Gerar roteiro audiovisual estruturado em PT-BR.',
      cwd: this.workspaceDir,
      preferredAgent: req.preferredAgent ?? 'auto',
      signal,
      onSpawn: trackChild,
      onLog: (msg, level) => {
        this.emitEvent({ jobId, type: 'log', level, stage: 'agent', message: msg, progressPct: null });
      },
    });

    if (signal.aborted) return;

    const now = new Date().toISOString();
    if (!result.ok) {
      this.setStage(jobId, 'agent', {
        status: 'blocked',
        completedAt: now,
        detail: result.error ?? 'Nenhum agente disponível.',
      });
      throw new Error(result.error ?? 'Falha na execução dos agentes RF-07.');
    }

    this.setStage(jobId, 'agent', {
      status: 'completed',
      completedAt: now,
      detail: `Executado com sucesso por ${result.agentUsed} em ${(result.durationMs / 1000).toFixed(1)}s.`,
    });

    this.updateJob(jobId, (j) => ({
      ...j,
      status: 'completed',
      agentUsed: result.agentUsed,
      progressPct: 100,
      currentStage: 'concluido',
      outputText: result.outputText,
      resultSummary: `Agente ${result.agentUsed} concluiu "${task}" (${result.outputText.length} caracteres).`,
      completedAt: now,
    }));
    this.emitEvent({
      jobId,
      type: 'job_status',
      level: 'info',
      stage: 'concluido',
      message: `Tarefa de agente concluída por ${result.agentUsed}.`,
      progressPct: 100,
    });
  }

  private async runMediaAcquireJob(
    jobId: string,
    req: CreateRemoteJobRequest,
    jobDir: string,
    signal: AbortSignal,
    trackChild: (c: ChildProcess) => void,
  ): Promise<void> {
    this.setStage(jobId, 'ytdlp', {
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: 'Executando yt-dlp no host local...',
    });

    const res = await this.cinema.acquireMediaViaYtDlp({
      query: req.mediaQuery,
      url: req.mediaUrl,
      outputDir: jobDir,
      signal,
      onSpawn: trackChild,
      onLog: (msg, level) => {
        this.emitEvent({ jobId, type: 'log', level, stage: 'ytdlp', message: msg, progressPct: null });
      },
    });

    if (signal.aborted) return;

    const now = new Date().toISOString();
    if (!res.ok) {
      this.setStage(jobId, 'ytdlp', { status: 'blocked', completedAt: now, detail: res.error ?? 'yt-dlp indisponível.' });
      throw new Error(res.error ?? 'Falha na aquisição yt-dlp.');
    }

    if (res.filePath && fs.existsSync(res.filePath)) {
      const stat = fs.statSync(res.filePath);
      this.registerArtifact(
        jobId,
        {
          id: `art-${crypto.randomBytes(6).toString('hex')}`,
          jobId,
          kind: 'media_download',
          filename: res.filename ?? path.basename(res.filePath),
          mimeType: 'application/octet-stream',
          sizeBytes: stat.size,
          durationSec: null,
          width: null,
          height: null,
          videoCodec: null,
          audioCodec: null,
          loudnessLufs: null,
          encoderUsed: null,
          createdAt: now,
        },
        res.filePath,
      );
    }

    this.setStage(jobId, 'ytdlp', {
      status: 'completed',
      completedAt: now,
      detail: res.filename ? `Mídia baixada: ${res.filename}` : 'Consulta yt-dlp concluída.',
    });
    this.updateJob(jobId, (j) => ({
      ...j,
      status: 'completed',
      progressPct: 100,
      currentStage: 'concluido',
      resultSummary: res.filename ? `Mídia adquirida via yt-dlp: ${res.filename}` : 'Aquisição yt-dlp concluída.',
      completedAt: now,
    }));
    this.emitEvent({
      jobId,
      type: 'job_status',
      level: 'info',
      stage: 'concluido',
      message: 'Aquisição de mídia concluída.',
      progressPct: 100,
    });
  }

  private async runMediaProbeJob(jobId: string, req: CreateRemoteJobRequest): Promise<void> {
    if (!req.artifactId) throw new Error('Informe artifactId para inspeção FFprobe.');
    const art = this.db.getArtifactWithPath(req.artifactId);
    if (!art || !fs.existsSync(art.filePath)) throw new Error('Artefato não encontrado para inspeção.');

    this.setStage(jobId, 'probe', {
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: `Inspecionando ${art.filename} com FFprobe...`,
    });
    const probe = await probeMediaWithFfprobe(art.filePath);
    const now = new Date().toISOString();
    this.setStage(jobId, 'probe', {
      status: 'completed',
      completedAt: now,
      detail: `${probe.width}×${probe.height}, ${probe.videoCodec}/${probe.audioCodec}, ${probe.durationSec}s`,
    });
    this.updateJob(jobId, (j) => ({
      ...j,
      status: 'completed',
      progressPct: 100,
      currentStage: 'concluido',
      outputText: JSON.stringify(probe, null, 2),
      resultSummary: `FFprobe concluído: ${probe.width}×${probe.height}, ${probe.videoCodec}/${probe.audioCodec}.`,
      completedAt: now,
    }));
  }

  private async runCinemaProduceJob(
    jobId: string,
    req: CreateRemoteJobRequest,
    jobDir: string,
    signal: AbortSignal,
    trackChild: (c: ChildProcess) => void,
  ): Promise<void> {
    const prompt = req.prompt?.trim() || req.title?.trim() || 'Produção audiovisual Aethera';
    const title = req.title?.trim() || prompt.slice(0, 64);

    this.setStage(jobId, 'engine_check', {
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: 'Verificando @neuralbridge/cinema e agentes locais (RF-07)...',
    });

    // 1. Delegate to full monorepo @neuralbridge/cinema if installed on the Windows PC
    const monorepoResult = await this.cinema.produceViaMonorepoIfAvailable({
      prompt,
      title,
      style: req.style || 'Cinema IA',
      aspectRatio: req.aspectRatio ?? '16:9',
      outputDir: jobDir,
      onLog: (msg, level) => this.emitEvent({ jobId, type: 'log', level, stage: 'engine_check', message: msg, progressPct: null }),
    });

    if (monorepoResult.handled && monorepoResult.mp4Path && fs.existsSync(monorepoResult.mp4Path)) {
      const probe = await probeMediaWithFfprobe(monorepoResult.mp4Path);
      const now = new Date().toISOString();
      const art: RemoteArtifactRecord = {
        id: `art-${crypto.randomBytes(6).toString('hex')}`,
        jobId,
        kind: 'video_mp4',
        filename: path.basename(monorepoResult.mp4Path),
        mimeType: 'video/mp4',
        sizeBytes: probe.sizeBytes,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        loudnessLufs: probe.loudnessLufs,
        encoderUsed: 'monorepo_cinema',
        createdAt: now,
      };
      this.registerArtifact(jobId, art, monorepoResult.mp4Path);
      this.setStage(jobId, 'engine_check', { status: 'completed', completedAt: now, detail: monorepoResult.summary ?? 'OK' });
      this.setStage(jobId, 'render', { status: 'completed', completedAt: now, detail: 'Renderizado pelo Cinema Engine real.' });
      this.setStage(jobId, 'probe', { status: 'completed', completedAt: now, detail: `${probe.width}×${probe.height} (${probe.videoCodec}/${probe.audioCodec})` });
      this.updateJob(jobId, (j) => ({
        ...j,
        status: 'completed',
        progressPct: 100,
        currentStage: 'concluido',
        resultSummary: monorepoResult.summary ?? 'Produção concluída pelo Cinema Engine original.',
        completedAt: now,
      }));
      return;
    }

    if (monorepoResult.reason) {
      this.emitEvent({
        jobId,
        type: 'log',
        level: 'warn',
        stage: 'engine_check',
        message: monorepoResult.reason,
        progressPct: null,
      });
    }

    // 2. Try real local RF-07 agent to generate real scenes/script when available
    let agentOutput: string | null = null;
    const agentRes = await this.agents.executeWithFallback({
      task: 'script',
      prompt,
      cwd: this.workspaceDir,
      preferredAgent: req.preferredAgent ?? 'auto',
      signal,
      onSpawn: trackChild,
      onLog: (msg, level) => this.emitEvent({ jobId, type: 'log', level, stage: 'engine_check', message: msg, progressPct: null }),
    });

    if (signal.aborted) return;

    const nowEngine = new Date().toISOString();
    if (agentRes.ok) {
      agentOutput = agentRes.outputText;
      this.updateJob(jobId, (j) => ({ ...j, agentUsed: agentRes.agentUsed, outputText: agentOutput }));
      this.setStage(jobId, 'engine_check', {
        status: 'completed',
        completedAt: nowEngine,
        detail: `Roteiro gerado por agente real (${agentRes.agentUsed}).`,
      });
    } else {
      this.setStage(jobId, 'engine_check', {
        status: 'blocked',
        completedAt: nowEngine,
        detail: `Agentes CLI ausentes neste host (${agentRes.error}). Prosseguindo apenas para renderização FFmpeg real das cenas fornecidas.`,
      });
    }

    // 3. Build scenes from agent output lines or explicit request scenes and run REAL FFmpeg render
    const derivedScenes =
      req.scenes && req.scenes.length > 0
        ? req.scenes
        : agentOutput
          ? agentOutput
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 10)
              .slice(0, 4)
              .map((line, i) => ({
                index: i + 1,
                title: `Cena ${i + 1}`,
                narration: line,
                caption: line.slice(0, 46),
                accentHex: ['#b8a4f4', '#d8fb4f', '#f9a8d4', '#86c5e5'][i % 4],
              }))
          : [
              { index: 1, title: 'Gancho & Premissa', narration: prompt, caption: title.slice(0, 46), accentHex: '#b8a4f4' },
              { index: 2, title: 'Desenvolvimento', narration: prompt, caption: 'Montagem FFmpeg real no Remote Host', accentHex: '#d8fb4f' },
              { index: 3, title: 'Encerramento', narration: prompt, caption: 'Pronto para revisão e download', accentHex: '#f9a8d4' },
            ];

    await this.runRenderFfmpegJob(
      jobId,
      { ...req, title, scenes: derivedScenes },
      jobDir,
      signal,
      trackChild,
    );
  }
}
