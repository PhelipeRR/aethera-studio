import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  ListOrdered,
  Play,
  Square,
  XCircle,
} from 'lucide-react';
import { getPipelineProgressPct } from '../domain/pipeline-engine';
import type { ProductionProject, RenderJob } from '../domain/types';
import { useStudio } from '../store/studio-store';

type QueueFilter = 'all' | 'producing' | 'awaiting_review' | 'scheduled' | 'renders';

export function PipelineQueuePage() {
  const {
    projects,
    renderJobs,
    sseConnected,
    startFfmpegRender,
    cancelRenderJob,
    advanceStage,
    completePipeline,
    navigate,
  } = useStudio();

  const [filter, setFilter] = useState<QueueFilter>('all');
  const [selectedPreset, setSelectedPreset] = useState<ProductionProject['qualityPreset']>('review_720p');
  const [previewJob, setPreviewJob] = useState<RenderJob | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    if (filter === 'all' || filter === 'renders') return projects;
    return projects.filter((p) => p.status === filter);
  }, [projects, filter]);

  const handleStartRender = async (projectId: string) => {
    setBusyProjectId(projectId);
    try {
      await startFfmpegRender(projectId, selectedPreset);
    } finally {
      setBusyProjectId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            PIPELINE &amp; FILA DE RENDER • /AETHERA/QUEUE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Pipeline e Fila de Renderização</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Acompanhamento em tempo real via SSE e renderização MP4 H.264/AAC real com FFmpeg + auditoria FFprobe.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-2 ${
              sseConnected ? 'bg-[#f3fdd0] text-[#111111]' : 'bg-[#f4f4f6] text-[#62626c]'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-[#2f7d32]' : 'bg-[#9a6200]'}`} />
            <span>{sseConnected ? 'SSE Tempo Real Ativo' : 'Reconectando SSE...'}</span>
          </span>

          <select
            aria-label="Preset de qualidade FFmpeg"
            value={selectedPreset}
            onChange={(e) => setSelectedPreset(e.target.value as ProductionProject['qualityPreset'])}
            className="h-9 rounded-full bg-[#f4f4f6] px-3.5 text-xs font-semibold text-[#111111]"
          >
            <option value="review_720p">FFmpeg Review (960×540 rápido)</option>
            <option value="master_1080p">FFmpeg Master (960×540 / 9:16)</option>
            <option value="cinema_4k">FFmpeg HD Cinema (1280×720)</option>
          </select>
        </div>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'all', label: `Todos (${projects.length})` },
            { id: 'producing', label: `Em produção (${projects.filter((p) => p.status === 'producing').length})` },
            { id: 'awaiting_review', label: `Aguardando aprovação (${projects.filter((p) => p.status === 'awaiting_review').length})` },
            { id: 'scheduled', label: `Agendados (${projects.filter((p) => p.status === 'scheduled').length})` },
            { id: 'renders', label: `Renders FFmpeg (${renderJobs.length})` },
          ] as Array<{ id: QueueFilter; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`h-9 px-4 rounded-full text-xs font-semibold transition-colors ${
              filter === tab.id ? 'bg-[#111111] text-white' : 'bg-white text-[#111111] hover:bg-[#f4f4f6]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Real FFmpeg Render Jobs Section */}
      <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-[#6a46d8]" />
            <span>Fila de Renderização FFmpeg Real ({renderJobs.length})</span>
          </h2>
          <span className="text-xs font-mono text-[#62626c]">H.264 + AAC + drawtext + FFprobe</span>
        </div>

        {renderJobs.length === 0 ? (
          <div className="rounded-2xl bg-[#f4f4f6] p-5 text-xs text-[#62626c]">
            Nenhum render FFmpeg executado ainda. Clique em <strong>Renderizar MP4</strong> em qualquer projeto abaixo
            para gerar um arquivo de vídeo real auditado pelo FFprobe.
          </div>
        ) : (
          <div className="space-y-2.5">
            {renderJobs.map((job) => (
              <div key={job.id} className="rounded-2xl bg-[#f4f4f6] p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#111111]">{job.projectTitle}</span>
                      <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#6a46d8]">
                        FFmpeg Real • {job.aspectRatio}
                      </span>
                    </div>
                    <p className="text-xs text-[#62626c] mt-0.5">{job.stageMessage}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        job.status === 'completed'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : job.status === 'failed' || job.status === 'cancelled'
                            ? 'bg-[#fde7f3] text-[#b42840]'
                            : 'bg-[#efe9fd] text-[#6a46d8]'
                      }`}
                    >
                      {job.status === 'completed'
                        ? 'Concluído'
                        : job.status === 'rendering'
                          ? 'Renderizando'
                          : job.status === 'queued'
                            ? 'Na fila'
                            : job.status === 'cancelled'
                              ? 'Cancelado'
                              : 'Falhou'}{' '}
                      • {job.progressPct}%
                    </span>

                    {(job.status === 'queued' || job.status === 'rendering') && (
                      <button
                        type="button"
                        onClick={() => void cancelRenderJob(job.id)}
                        className="h-8 px-3 rounded-full bg-white text-xs font-semibold text-[#b42840] inline-flex items-center gap-1"
                      >
                        <Square className="w-3 h-3" />
                        <span>Cancelar</span>
                      </button>
                    )}

                    {job.status === 'completed' && job.outputUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewJob(job)}
                          className="h-8 px-3.5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Play className="w-3 h-3 text-[#d8fb4f]" />
                          <span>Assistir MP4</span>
                        </button>
                        <a
                          href={job.outputUrl}
                          download={job.outputFilename ?? 'aethera-render.mp4'}
                          className="h-8 px-3 rounded-full bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          <span>Baixar</span>
                        </a>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 rounded-full bg-white overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      job.status === 'completed'
                        ? 'bg-[#2f7d32]'
                        : job.status === 'failed'
                          ? 'bg-[#d23c4f]'
                          : 'bg-[#6a46d8]'
                    }`}
                    style={{ width: `${job.progressPct}%` }}
                  />
                </div>

                {job.probeMetrics && (
                  <div className="flex flex-wrap gap-2 text-[11px] font-mono text-[#2a1d5c]">
                    <span className="px-2 py-0.5 rounded-full bg-white">
                      {job.probeMetrics.width}×{job.probeMetrics.height}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-white">
                      {job.probeMetrics.videoCodec}/{job.probeMetrics.audioCodec}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-white">{job.probeMetrics.durationSec}s</span>
                    <span className="px-2 py-0.5 rounded-full bg-white">
                      {Math.round(job.probeMetrics.fileSizeBytes / 1024)} KB
                    </span>
                    {job.probeMetrics.loudnessLufs !== null && (
                      <span className="px-2 py-0.5 rounded-full bg-[#f3fdd0]">
                        EBU R128: {job.probeMetrics.loudnessLufs} LUFS
                      </span>
                    )}
                  </div>
                )}

                {job.error && (
                  <div className="text-xs text-[#b42840] inline-flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{job.error}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Inline Real HTML5 Video Player for Rendered MP4 */}
      {previewJob && previewJob.outputUrl && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3 border-2 border-[#111111]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Player MP4 Real (FFmpeg) — {previewJob.projectTitle}
              </h2>
              <p className="text-xs text-[#62626c] font-mono">{previewJob.outputFilename}</p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewJob(null)}
              className="h-8 px-3.5 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111]"
            >
              Fechar player
            </button>
          </div>
          <video
            key={previewJob.outputUrl}
            src={previewJob.outputUrl}
            poster={previewJob.thumbnailUrl ?? undefined}
            controls
            className="w-full max-h-[420px] rounded-2xl bg-black"
          />
        </section>
      )}

      {/* Production Pipeline Queue Table */}
      {filter !== 'renders' && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-[#6a46d8]" />
            <span>Fila de Produções ({filteredProjects.length})</span>
          </h2>

          <div className="space-y-2.5">
            {filteredProjects.map((proj) => {
              const pct = getPipelineProgressPct(proj.stages);
              const latestRender = renderJobs.find((j) => j.id === proj.latestRenderJobId);
              return (
                <div
                  key={proj.id}
                  className="rounded-2xl bg-[#f4f4f6] p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#111111]">{proj.title}</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#efe9fd] text-[#6a46d8] text-[10px] font-bold">
                        {proj.status === 'awaiting_review'
                          ? 'Pra aprovar'
                          : proj.status === 'producing'
                            ? 'Em produção'
                            : proj.status === 'approved'
                              ? 'Aprovado'
                              : proj.status === 'scheduled'
                                ? 'Agendado'
                                : 'Briefing'}
                      </span>
                      <span className="text-[11px] font-mono text-[#62626c]">
                        Pipeline {pct}% • {proj.aspectRatio}
                      </span>
                    </div>
                    <div className="w-full max-w-md h-1.5 rounded-full bg-white overflow-hidden">
                      <div className="h-full bg-[#111111] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    {latestRender?.probeMetrics && (
                      <div className="text-[11px] text-[#2f7d32] font-medium inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>
                          MP4 pronto ({latestRender.probeMetrics.width}×{latestRender.probeMetrics.height},{' '}
                          {latestRender.probeMetrics.durationSec}s)
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {pct < 100 && (
                      <>
                        <button
                          type="button"
                          onClick={() => void advanceStage(proj.id)}
                          className="h-8 px-3 rounded-full bg-white text-[#111111] text-xs font-semibold hover:bg-[#efe9fd]"
                        >
                          Avançar etapa
                        </button>
                        <button
                          type="button"
                          onClick={() => void completePipeline(proj.id)}
                          className="h-8 px-3 rounded-full bg-white text-[#111111] text-xs font-semibold hover:bg-[#efe9fd]"
                        >
                          Concluir 9/9
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busyProjectId === proj.id}
                      onClick={() => void handleStartRender(proj.id)}
                      className="h-8 px-3.5 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>{busyProjectId === proj.id ? 'Iniciando...' : 'Renderizar MP4'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('manual_projects', proj.id, 'package')}
                      className="h-8 px-3 rounded-full bg-[#111111] text-white text-xs font-semibold"
                    >
                      Pacote
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
