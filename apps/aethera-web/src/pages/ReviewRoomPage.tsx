import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  MessageSquarePlus,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { computeQualityScore, getPipelineProgressPct } from '../domain/pipeline-engine';
import { useStudio } from '../store/studio-store';

type ReviewTab = 'overview' | 'scenes' | 'checklist' | 'comments';

export function ReviewRoomPage() {
  const {
    projects,
    renderJobs,
    activeProject,
    selectProject,
    addReviewComment,
    toggleChecklistItem,
    requestRevision,
    approveProject,
    startFfmpegRender,
    navigate,
  } = useStudio();

  const project = activeProject ?? projects[0];
  const [tab, setTab] = useState<ReviewTab>('overview');
  const [selectedSceneIdx, setSelectedSceneIdx] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [revisionInput, setRevisionInput] = useState('');
  const [approvedNotice, setApprovedNotice] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const score = useMemo(() => (project ? computeQualityScore(project) : 0), [project]);
  const pct = useMemo(() => (project ? getPipelineProgressPct(project.stages) : 0), [project]);
  const latestRender = useMemo(() => {
    if (!project) return undefined;
    return renderJobs.find(
      (j) => j.projectId === project.id && j.status === 'completed' && Boolean(j.outputUrl),
    );
  }, [renderJobs, project]);

  if (!project) return null;

  const activeScene = project.scenes[selectedSceneIdx] ?? project.scenes[0];

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    const approxSec = project.scenes
      .slice(0, selectedSceneIdx)
      .reduce((acc, s) => acc + s.durationSec, 0);
    await addReviewComment(project.id, approxSec, commentText);
    setCommentText('');
  };

  const handleRevision = async () => {
    if (!revisionInput.trim()) return;
    await requestRevision(project.id, revisionInput);
    setRevisionInput('');
  };

  const handleApprove = async () => {
    await approveProject(project.id);
    setApprovedNotice(`"${project.title}" aprovado nos Release Gates e salvo no SQLite!`);
  };

  const handleRenderPreview = async () => {
    setRendering(true);
    try {
      await startFfmpegRender(project.id, project.qualityPreset);
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            PRODUÇÕES / {project.title.toUpperCase()} / REVISÃO E QUALIDADE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111] mt-0.5">
            Revisão e Qualidade
          </h1>
          <p className="text-xs text-[#62626c]">
            Análise técnica FFprobe, narrativa e revisão cirúrgica antes da aprovação final.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Selecionar produção para revisão"
            value={project.id}
            onChange={(e) => {
              selectProject(e.target.value);
              setSelectedSceneIdx(0);
              setApprovedNotice(null);
            }}
            className="h-9 rounded-full bg-[#f4f4f6] px-3.5 text-xs font-semibold text-[#111111]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <span
            className={`h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 ${
              project.status === 'approved' || project.status === 'scheduled'
                ? 'bg-[#d8fb4f] text-[#111111]'
                : 'bg-[#fff4dc] text-[#9a6200]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>
              {project.status === 'approved'
                ? 'Aprovado'
                : project.status === 'scheduled'
                  ? 'Agendado'
                  : 'Aguardando aprovação'}
            </span>
          </span>
        </div>
      </div>

      {approvedNotice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[#111111]">
          <span>{approvedNotice}</span>
          <button
            type="button"
            onClick={() => navigate('calendar', project.id)}
            className="underline font-bold"
          >
            Agendar no Calendário →
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Abas de revisão" className="flex flex-wrap gap-2">
        {(
          [
            { id: 'overview', label: 'Visão Geral' },
            { id: 'scenes', label: `Análise por Cena (${project.scenes.length})` },
            { id: 'checklist', label: `Checklist (${project.checklist.filter((c) => c.passed).length}/${project.checklist.length})` },
            { id: 'comments', label: `Comentários (${project.comments.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 px-4 rounded-full text-xs font-semibold transition-colors ${
              tab === t.id
                ? 'bg-[#111111] text-white'
                : 'bg-white text-[#62626c] hover:text-[#111111]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <section className="xl:col-span-3 rounded-[28px] bg-white p-4 shadow-2xs space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#62626c] px-1">
              CENAS ({project.scenes.length})
            </div>
            {project.scenes.map((scene, idx) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => setSelectedSceneIdx(idx)}
                className={`w-full text-left rounded-2xl p-3 transition-colors ${
                  selectedSceneIdx === idx
                    ? 'bg-[#efe9fd] ring-1 ring-[#b8a4f4]'
                    : 'bg-[#f4f4f6] hover:bg-[#e9e9ef]'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#111111]">Cena {scene.index}</span>
                  <span className="font-mono text-[#62626c]">{scene.durationSec}s</span>
                </div>
                <div className="text-xs font-medium text-[#111111] mt-0.5 truncate">{scene.title}</div>
              </button>
            ))}
          </section>

          <div className="xl:col-span-6 space-y-4">
            {latestRender?.outputUrl ? (
              <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#111111]">Prévia MP4 Real (FFmpeg + FFprobe)</span>
                  {latestRender.probeMetrics && (
                    <span className="font-mono text-[#2f7d32]">
                      {latestRender.probeMetrics.width}×{latestRender.probeMetrics.height} •{' '}
                      {latestRender.probeMetrics.videoCodec}/{latestRender.probeMetrics.audioCodec} •{' '}
                      {latestRender.probeMetrics.durationSec}s
                    </span>
                  )}
                </div>
                <video
                  key={latestRender.outputUrl}
                  src={latestRender.outputUrl}
                  poster={latestRender.thumbnailUrl ?? undefined}
                  controls
                  className="w-full rounded-2xl bg-black max-h-[300px]"
                />
              </section>
            ) : (
              <section className="rounded-[28px] bg-gradient-to-br from-[#efe9fd] via-white to-white p-6 shadow-2xs flex flex-col items-center justify-center text-center min-h-[240px] space-y-3">
                <div className="w-14 h-14 rounded-full bg-white shadow-sm flex items-center justify-center text-[#6a46d8]">
                  <Play className="w-6 h-6 ml-0.5" />
                </div>
                {activeScene && (
                  <>
                    <h2 className="text-base font-bold text-[#111111]">
                      Prévia — Cena {activeScene.index}: {activeScene.title}
                    </h2>
                    <p className="text-xs text-[#62626c] max-w-md leading-relaxed">
                      {activeScene.narration}
                    </p>
                  </>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={rendering}
                    onClick={() => void handleRenderPreview()}
                    className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Clapperboard className="w-3.5 h-3.5 text-[#d8fb4f]" />
                    <span>{rendering ? 'Renderizando FFmpeg...' : 'Gerar Prévia MP4 Real'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('editor', project.id)}
                    className="h-10 px-5 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-bold hover:brightness-95"
                  >
                    Abrir na Timeline
                  </button>
                </div>
              </section>
            )}

            <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#111111]">
                <Sparkles className="w-4 h-4 text-[#6a46d8]" />
                <span>Solicitar Alterações por Prompt (Revisão Cirúrgica)</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={revisionInput}
                  onChange={(e) => setRevisionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRevision();
                  }}
                  placeholder="Ex.: Reforçar impacto da cena 3 com corte mais seco e ajustar áudio..."
                  aria-label="Instrução de revisão cirúrgica por prompt"
                  className="flex-1 h-10 rounded-full bg-[#f4f4f6] px-4 text-xs text-[#111111] outline-none focus:ring-2 focus:ring-[#b8a4f4]"
                />
                <button
                  type="button"
                  onClick={() => void handleRevision()}
                  className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-[#24242c]"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Aplicar</span>
                </button>
              </div>

              {project.revisions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#e3e3e8]">
                  {project.revisions.map((rev) => (
                    <div key={rev.id} className="rounded-2xl bg-[#efe9fd] p-3 text-xs space-y-1">
                      <div className="font-semibold text-[#111111]">&ldquo;{rev.instruction}&rdquo;</div>
                      <div className="text-[#2a1d5c]">{rev.summary}</div>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {rev.affectedStages.map((st) => (
                          <span key={st} className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#111111]">
                            {st}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="xl:col-span-3 space-y-4">
            <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#111111]">Score de Qualidade</h2>
                <span className="px-2.5 py-0.5 rounded-full bg-[#f4f4f6] text-[11px] font-mono text-[#62626c] whitespace-nowrap shrink-0">
                  Pipeline {pct}%
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full border-[5px] border-[#111111] flex items-center justify-center text-lg font-extrabold text-[#111111]">
                  {score}
                </div>
                <div className="text-xs text-[#62626c] space-y-1">
                  <div>
                    Release Gates:{' '}
                    <strong className="text-[#111111]">
                      {project.checklist.filter((c) => c.passed).length}/{project.checklist.length}
                    </strong>
                  </div>
                  <div>
                    Cobertura visual:{' '}
                    <strong className="text-[#111111]">
                      {project.scenes.filter((s) => s.mediaMatched).length}/{project.scenes.length}
                    </strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#111111]">
                <MessageSquarePlus className="w-4 h-4 text-[#6a46d8]" />
                <span>Comentários ({project.comments.length})</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddComment();
                  }}
                  placeholder="Adicionar nota com timestamp..."
                  aria-label="Adicionar nota com timestamp"
                  className="flex-1 h-9 rounded-full bg-[#f4f4f6] px-3.5 text-xs text-[#111111] outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddComment()}
                  aria-label="Salvar nota de revisão"
                  className="w-9 h-9 rounded-full bg-[#111111] text-white font-bold text-sm inline-flex items-center justify-center shrink-0"
                >
                  +
                </button>
              </div>
              {project.comments.slice(0, 3).map((cmt) => (
                <div key={cmt.id} className="rounded-2xl bg-[#f4f4f6] p-2.5 text-xs">
                  <div className="font-mono text-[10px] text-[#6a46d8] font-semibold">
                    @{cmt.timestampSec}s • {cmt.author}
                  </div>
                  <p className="text-[#111111] mt-0.5">{cmt.text}</p>
                </div>
              ))}
            </section>

            <button
              type="button"
              onClick={() => void handleApprove()}
              className="w-full h-12 rounded-2xl bg-[#d8fb4f] hover:brightness-95 text-[#111111] text-sm font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Aprovar Versão Final</span>
            </button>
          </aside>
        </div>
      )}

      {tab === 'scenes' && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs grid grid-cols-1 md:grid-cols-2 gap-3">
          {project.scenes.map((scene) => (
            <div key={scene.id} className="rounded-2xl bg-[#f4f4f6] p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#111111]">
                  Cena {scene.index} — {scene.title}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white font-mono text-[11px]">
                  {scene.durationSec}s
                </span>
              </div>
              <p className="text-xs text-[#62626c]">{scene.narration}</p>
              <div className="text-[11px] font-medium text-[#2f7d32]">
                {scene.mediaMatched ? 'Mídia validada semanticamente' : 'Aguardando mídia na etapa 5'}
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'checklist' && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2.5">
          <h2 className="text-sm font-bold text-[#111111]">Release Gates — Verificação de Entrega</h2>
          {project.checklist.map((item) => (
            <label
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#f4f4f6] px-4 py-3 cursor-pointer hover:bg-[#ececf2]"
            >
              <span className="flex items-center gap-3 text-xs font-medium text-[#111111]">
                <input
                  type="checkbox"
                  checked={item.passed}
                  onChange={() => void toggleChecklistItem(project.id, item.id)}
                  className="w-4 h-4 accent-[#111111]"
                />
                <span>{item.label}</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-white text-[11px] uppercase font-semibold text-[#62626c]">
                {item.category}
              </span>
            </label>
          ))}
        </section>
      )}

      {tab === 'comments' && (
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
          <h2 className="text-sm font-bold text-[#111111]">
            Todos os Comentários ({project.comments.length})
          </h2>
          {project.comments.length === 0 ? (
            <p className="text-xs text-[#62626c]">Nenhuma nota registrada para este vídeo ainda.</p>
          ) : (
            <div className="space-y-2">
              {project.comments.map((cmt) => (
                <div key={cmt.id} className="rounded-2xl bg-[#f4f4f6] p-3.5 text-xs">
                  <div className="font-mono text-[11px] font-semibold text-[#6a46d8]">
                    @{cmt.timestampSec}s • {cmt.author}
                  </div>
                  <p className="mt-1 text-[#111111]">{cmt.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
