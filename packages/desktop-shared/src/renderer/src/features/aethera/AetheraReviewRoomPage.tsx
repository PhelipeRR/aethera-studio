import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Film,
  MessageSquarePlus,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

type ReviewTab = 'overview' | 'scenes' | 'checklist' | 'comments' | 'compare' | 'report' | 'recap';

interface TimestampComment {
  id: string;
  author: string;
  timecode: string;
  text: string;
}

interface ReviewPackageView {
  direction: {
    brief: { prompt: string; targetDurationSec: number };
    shots: Array<{
      shotId: string;
      framing: string;
      cameraMotion: string;
      motionJustification: string;
      mediaGap: boolean;
    }>;
  };
  timeline: {
    projectId: string;
    version: number;
    renderFingerprint: string;
    clips: Array<{ clipId: string }>;
    humorProfile: { humorIntensity: number };
  };
  renderProfile: { width: number; height: number };
  soundPlan: { platformProfile: { integratedLufs: number } };
  findings: Array<{ issueId: string; severity: string; evidence: string; status: string }>;
  scorecard: {
    technicalScore: number;
    audioScore: number;
    visualScore: number;
    narrativeScore: number;
    comedyScore: number;
    compositeScore: number;
  };
  releaseGates: { passed: boolean };
}

interface RealRenderAuditView {
  mp4Path: string;
  mediaUrl: string;
  encoderUsed: string;
  probe: {
    durationSec: number;
    width: number;
    height: number;
    integratedLufs: number | null;
    truePeakDbtp: number | null;
    avDurationDeltaSec: number;
    blackFramesCount: number;
    frozenSegmentsCount: number;
  };
  realQcFindings: Array<{ issueId: string; severity: string; evidence: string }>;
}

interface PendingMediaGapView {
  slotIndex: number;
  clipId: string;
  query: string;
  reason?: string;
}

interface CinemaBridge {
  cinemaProduce?: (input: Record<string, unknown>) => Promise<ReviewPackageView>;
  cinemaRepair?: (projectId: string) => Promise<ReviewPackageView>;
  cinemaListProjects?: () => Promise<Array<{ projectId: string; title: string; durationSec: number; updatedAt: string }>>;
  cinemaLoadProject?: (projectId: string) => Promise<{ pkg: ReviewPackageView | null; lastRender: RealRenderAuditView | null }>;
  cinemaRenderRealMp4?: (input: { projectId: string; useNvenc?: boolean }) => Promise<RealRenderAuditView>;
  cinemaGetProductionState?: (projectId: string) => Promise<{
    projectId: string;
    state?: string;
    pendingMedia?: PendingMediaGapView[];
  } | null>;
  cinemaResolvePendingMedia?: (input: {
    projectId: string;
    resolutions: Array<{
      slotIndex: number;
      filePath?: string;
      pickFile?: boolean;
      allowProcedural?: boolean;
      retryQuery?: string;
    }>;
  }) => Promise<{ pendingMedia?: PendingMediaGapView[] } | null>;
  recapListProjects?: () => Promise<Array<{
    runId: string;
    chapterId: string;
    workTitle: string;
    state: string;
    completedSteps: string[];
    gateFVerdict?: string;
    gateGVerdict?: string;
    gateHVerdict?: string;
    motionVelix?: { sfxApplied: number; sfxPlanned: number };
    previewMp4Path?: string | null;
    masterMp4Path?: string | null;
    updatedAtIso: string;
  }>>;
}

function getBridge(): CinemaBridge | undefined {
  return (window as unknown as { aetheraBridge?: CinemaBridge }).aetheraBridge;
}

export function AetheraReviewRoomPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<ReviewTab>('overview');
  const [selectedShotIdx, setSelectedShotIdx] = useState(0);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<TimestampComment[]>([]);
  const [approvedVersion, setApprovedVersion] = useState<string | null>(null);
  const [cinemaProjects, setCinemaProjects] = useState<Array<{ projectId: string; title: string; durationSec: number; updatedAt: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => searchParams.get('projectId') ?? '');
  const [pendingMedia, setPendingMedia] = useState<PendingMediaGapView[]>([]);
  const [retryQueryMap, setRetryQueryMap] = useState<Record<number, string>>({});
  const [resolvingSlot, setResolvingSlot] = useState<number | null>(null);
  const [pkg, setPkg] = useState<ReviewPackageView | null>(null);
  const [realAudit, setRealAudit] = useState<RealRenderAuditView | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestRecap, setLatestRecap] = useState<{
    runId: string;
    workTitle: string;
    state: string;
    completedSteps: string[];
    gateFVerdict?: string;
    gateGVerdict?: string;
    gateHVerdict?: string;
    motionVelix?: { sfxApplied: number; sfxPlanned: number };
    previewMp4Path?: string | null;
    masterMp4Path?: string | null;
    updatedAtIso: string;
  } | null>(null);

  const projects = useQuery({
    queryKey: ['aethera-content-projects', 'default'],
    queryFn: () => window.neuralbridge.content.projects('default'),
  });

  const manualProjects = (projects.data ?? []).filter(
    (p) => !p.id.startsWith('gdc_') && !p.id.startsWith('cinema_'),
  );
  const activeManualProject = manualProjects[0] ?? null;

  useEffect(() => {
    const api = getBridge();
    if (api?.cinemaListProjects) {
      void api.cinemaListProjects().then((list) => {
        if (!Array.isArray(list)) return;
        setCinemaProjects(list);
        setSelectedProjectId((prev) => prev || list[0]?.projectId || '');
      }).catch(() => {});
    }
    if (api?.recapListProjects) {
      void api.recapListProjects().then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          setLatestRecap(list[0] ?? null);
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const api = getBridge();
    if (!api) return;
    const pid = selectedProjectId || activeManualProject?.id || '__latest__';
    setBusy(true);
    setSelectedShotIdx(0);
    setRealAudit(null);
    void (async () => {
      const [loaded, staged] = await Promise.all([
        api.cinemaLoadProject?.(pid),
        api.cinemaGetProductionState?.(pid).catch(() => null),
      ]);
      setPendingMedia(Array.isArray(staged?.pendingMedia) ? staged.pendingMedia : []);
      if (loaded?.pkg) {
        setPkg(loaded.pkg);
        if (loaded.lastRender) setRealAudit(loaded.lastRender);
        setSelectedProjectId((prev) => prev || loaded.pkg?.timeline.projectId || '');
        return;
      }
      setPkg(null);
    })().finally(() => setBusy(false));
  }, [selectedProjectId, activeManualProject?.id, activeManualProject?.title]);

  async function handleRenderAndAuditRealMp4() {
    const api = getBridge();
    if (!api?.cinemaRenderRealMp4 || !pkg) return;
    setBusy(true);
    try {
      const res = await api.cinemaRenderRealMp4({ projectId: pkg.timeline.projectId, useNvenc: true });
      setRealAudit(res);
    } finally {
      setBusy(false);
    }
  }

  const activeShots = pkg?.direction.shots ?? [];
  const currentShot = activeShots[selectedShotIdx] ?? activeShots[0];

  async function handleRunTargetedRepair() {
    const api = getBridge();
    if (!api?.cinemaRepair || !pkg) return;
    setBusy(true);
    try {
      setPkg(await api.cinemaRepair(pkg.timeline.projectId));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestRevision(e: React.FormEvent) {
    e.preventDefault();
    const api = getBridge();
    if (!revisionPrompt.trim() || !api?.cinemaProduce || !pkg) return;
    const text = revisionPrompt.trim();
    setRevisionPrompt('');
    setBusy(true);
    try {
      const updated = await api.cinemaProduce({
        projectId: pkg.timeline.projectId,
        prompt: `${pkg.direction.brief.prompt} | Ajuste: ${text}`,
        targetDurationSec: pkg.direction.brief.targetDurationSec,
        humorIntensity: pkg.timeline.humorProfile.humorIntensity,
      });
      setPkg(updated);
      setComments((prev) => [
        {
          id: crypto.randomUUID(),
          author: 'Diretor (IA)',
          timecode: `00:${String(selectedShotIdx * 8).padStart(2, '0')}`,
          text: `Revisão aplicada: "${text}"`,
        },
        ...prev,
      ]);
      setApprovedVersion(null);
    } finally {
      setBusy(false);
    }
  }

  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentInput.trim()) return;
    setComments((prev) => [
      {
        id: crypto.randomUUID(),
        author: 'Revisor',
        timecode: `00:${String(selectedShotIdx * 8).padStart(2, '0')}`,
        text: commentInput.trim(),
      },
      ...prev,
    ]);
    setCommentInput('');
  }

  const score = Math.round(pkg?.scorecard.compositeScore ?? 0);
  const ringCircumference = 2 * Math.PI * 36;
  const ringOffset = ringCircumference * (1 - score / 100);

  return (
    <div className="space-y-5 p-6 xl:p-8">
      {/* Top Review Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-gradient-to-r from-[#19102c] via-[#10101b] to-[#0c0c15] p-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold tracking-[0.2em] text-purple-400 uppercase">
            Produções / {pkg?.direction.brief.prompt || cinemaProjects.find((p) => p.projectId === selectedProjectId)?.title || activeManualProject?.title || 'Sessão de Revisão'} / Revisão e Qualidade
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Revisão e Qualidade</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Análise técnica, narrativa e criativa verificável antes da aprovação final.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {cinemaProjects.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs">
              <span className="text-[11px] text-muted-foreground">Projeto em revisão:</span>
              <select
                aria-label="Selecionar projeto para revisão"
                value={selectedProjectId || pkg?.timeline.projectId || cinemaProjects[0]?.projectId || ''}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="max-w-[280px] rounded-xl border border-border bg-[#0d0d17] px-3 py-1.5 text-xs text-foreground"
              >
                {cinemaProjects.map((proj, idx) => (
                  <option key={proj.projectId} value={proj.projectId}>
                    {idx === 0 ? '★ Mais recente: ' : ''}
                    {proj.title} ({proj.durationSec}s)
                  </option>
                ))}
              </select>
            </label>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              pkg?.releaseGates.passed
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            <ShieldCheck className="size-3.5" />
            {pkg ? (pkg.releaseGates.passed ? 'Aprovável nos Release Gates' : 'Requer revisão / reparo') : 'Analisando...'}
          </span>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['overview', 'Visão Geral'],
            ['scenes', 'Análise por Cena'],
            ['checklist', `Checklist (${pkg?.findings.length ?? 0})`],
            ['comments', `Comentários (${comments.length})`],
            ['compare', 'Comparativos'],
            ['report', 'Relatório'],
            ['recap', 'Mangá Recap'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              tab === id
                ? 'border-primary/60 bg-primary/20 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 3-Column Review Room */}
      <div className="grid gap-5 xl:grid-cols-12">
        <aside className="rounded-2xl border border-border bg-card p-4 xl:col-span-3 space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cenas ({activeShots.length})
          </h2>
          <div className="space-y-2">
            {activeShots.map((shot, idx) => (
              <button
                key={shot.shotId}
                type="button"
                onClick={() => setSelectedShotIdx(idx)}
                className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-xs transition ${
                  idx === selectedShotIdx
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border/80 bg-[#0d0d17] text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">
                    {String(idx + 1).padStart(2, '0')} · {shot.shotId}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {shot.framing} · {shot.cameraMotion}
                  </p>
                </div>
                {shot.mediaGap ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4 xl:col-span-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-[#090910]">
            {realAudit ? (
              <div className="relative aspect-video bg-black">
                <video src={realAudit.mediaUrl} controls className="h-full w-full object-contain" />
                <span className="absolute right-3 top-3 rounded bg-emerald-500/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-black">
                  MP4 Real ({realAudit.encoderUsed})
                </span>
              </div>
            ) : (
              <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-[#231442] via-[#10101e] to-[#1a130b]">
                <div className="text-center space-y-2 px-4">
                  <Play className="mx-auto size-11 text-purple-300" />
                  <p className="text-xs font-medium text-foreground">
                    Prévia de Planejamento: {currentShot?.shotId ?? '—'} ({currentShot?.framing ?? 'wide'})
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {currentShot?.motionJustification ?? (busy ? 'Calculando revisão técnica...' : 'Renderize o MP4 real para auditoria FFprobe/ebur128')}
                  </p>
                  <button
                    type="button"
                    onClick={handleRenderAndAuditRealMp4}
                    disabled={busy || !pkg}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-amber-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Film className="size-3.5" /> {busy ? 'Renderizando...' : 'Renderizar & Auditar MP4 Real'}
                  </button>
                </div>
                {pkg && (
                  <span className="absolute right-3 top-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-purple-200">
                    {pkg.renderProfile.width}x{pkg.renderProfile.height}
                  </span>
                )}
              </div>
            )}

            {pkg && (
              <div className="border-t border-border p-3 space-y-1.5 text-[10px] font-mono text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>V1 Vídeo · {pkg.timeline.clips.length} clipes</span>
                  <span>A1/A2/A3 · {pkg.soundPlan.platformProfile.integratedLufs} LUFS</span>
                </div>
                <div className="flex h-3 gap-1 overflow-hidden rounded bg-[#141422] p-0.5">
                  {activeShots.map((s, idx) => (
                    <div
                      key={s.shotId}
                      className={`flex-1 rounded-sm ${idx === selectedShotIdx ? 'bg-amber-400' : 'bg-purple-500/50'}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleRequestRevision} className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <label htmlFor="review-adjust-prompt" className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-purple-400" /> Solicitar Alterações por Prompt
            </label>
            <div className="flex gap-2">
              <input
                id="review-adjust-prompt"
                value={revisionPrompt}
                onChange={(e) => setRevisionPrompt(e.target.value)}
                placeholder="Ex.: Reforçar impacto da cena 3 com corte mais seco..."
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                <Send className="size-3.5" /> Aplicar
              </button>
            </div>
          </form>

          {tab === 'report' && pkg && (
            <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-card p-3 text-[11px] text-muted-foreground">
              {JSON.stringify({ scorecard: pkg.scorecard, releaseGates: pkg.releaseGates }, null, 2)}
            </pre>
          )}

          {tab === 'recap' && (() => {
            const recapStages = [
              { id: 'import', label: 'Importação' },
              { id: 'gate-f', label: 'Gate F' },
              { id: 'vision', label: 'Visão Multimodal' },
              { id: 'continuity', label: 'Continuidade' },
              { id: 'script', label: 'Roteiro (Gate G)' },
              { id: 'humanize', label: 'Humanização' },
              { id: 'motion', label: 'MotionVelix & Áudio' },
              { id: 'gate-h', label: 'Qualidade (Gate H)' },
            ] as const;
            const completedSet = new Set(latestRecap?.completedSteps ?? []);
            const isStageDone = (id: string) => {
              if (!latestRecap) return false;
              if (latestRecap.state === 'completed') return true;
              if (completedSet.has(id)) return true;
              if ((id === 'vision' || id === 'continuity' || id === 'script') && completedSet.has('story_engine')) return true;
              if (id === 'motion' && (completedSet.has('audiovisual_preview') || completedSet.has('master_export'))) return true;
              if (id === 'gate-h' && latestRecap.state === 'awaiting_preview_approval') return true;
              return false;
            };
            const doneCount = recapStages.filter((s) => isStageDone(s.id)).length;
            const pct = Math.round((doneCount / recapStages.length) * 100);
            const mediaPath = latestRecap?.masterMp4Path ?? latestRecap?.previewMp4Path ?? null;
            const mediaSrc = mediaPath
              ? (mediaPath.startsWith('aethera-media://') || mediaPath.startsWith('file://') || mediaPath.startsWith('http')
                ? mediaPath
                : `aethera-media://local?path=${encodeURIComponent(mediaPath)}`)
              : null;

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="size-6 shrink-0 text-purple-400" />
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {latestRecap ? `Mangá Recap — ${latestRecap.workTitle}` : 'Mangá Recap — Preview & Revisão'}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {latestRecap
                          ? `Estado real: ${latestRecap.state}${latestRecap.motionVelix ? ` · MotionVelix SFX ${latestRecap.motionVelix.sfxApplied}/${latestRecap.motionVelix.sfxPlanned}` : ''}`
                          : 'Nenhum projeto Mangá Recap encontrado ainda.'}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/aethera/recap"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Abrir Mangá Recap <ChevronRight className="size-3.5" />
                  </Link>
                </div>

                {/* Real Pipeline Progress */}
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline Real</h4>
                  <div className="flex flex-wrap gap-2">
                    {recapStages.map((stage) => {
                      const done = isStageDone(stage.id);
                      return (
                        <span
                          key={stage.id}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${
                            done
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-secondary text-muted-foreground border border-border'
                          }`}
                        >
                          {done && <CheckCircle2 className="size-3" />}
                          {stage.label}
                        </span>
                      );
                    })}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-purple-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {doneCount} de {recapStages.length} etapas concluídas · {pct}%
                  </p>
                </div>

                {/* Real Video Preview */}
                <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black/90 flex items-center justify-center">
                  {mediaSrc ? (
                    <video src={mediaSrc} controls className="h-full w-full object-contain" />
                  ) : (
                    <div className="text-center px-4">
                      <Film className="mx-auto size-10 text-white/40" />
                      <p className="mt-3 text-sm font-medium text-white/70">Nenhum MP4 renderizado no projeto mais recente</p>
                    </div>
                  )}
                </div>

                {/* Real Gate Verdicts */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Gate F (Painéis)', verdict: latestRecap?.gateFVerdict ?? '—' },
                    { label: 'Gate G (Narrativa)', verdict: latestRecap?.gateGVerdict ?? '—' },
                    { label: 'Gate H (Audiovisual)', verdict: latestRecap?.gateHVerdict ?? '—' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border bg-card p-3 text-center">
                      <p className="font-mono text-sm font-bold uppercase text-foreground">{item.verdict}</p>
                      <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </section>

        <aside className="space-y-4 xl:col-span-4">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {realAudit ? 'Qualidade Auditada (MP4 Real)' : 'Estimativa de Planejamento'}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                  realAudit
                    ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border border-amber-500/40 bg-amber-500/15 text-amber-300'
                }`}
              >
                {realAudit ? `FFprobe OK · v${pkg?.timeline.version ?? 1}` : `Não renderizado · v${pkg?.timeline.version ?? 1}`}
              </span>
            </div>

            {realAudit && (
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px]">
                <div>Duração: <span className="font-mono text-foreground">{realAudit.probe.durationSec.toFixed(2)}s</span></div>
                <div>LUFS: <span className="font-mono text-foreground">{realAudit.probe.integratedLufs ?? '—'}</span></div>
                <div>True Peak: <span className="font-mono text-foreground">{realAudit.probe.truePeakDbtp ?? '—'} dBTP</span></div>
                <div>Black frames: <span className="font-mono text-foreground">{realAudit.probe.blackFramesCount}</span></div>
                <div>Delta A/V: <span className="font-mono text-foreground">{realAudit.probe.avDurationDeltaSec}s</span></div>
                <div>Achados QC: <span className="font-mono text-foreground">{realAudit.realQcFindings.length}</span></div>
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="relative flex size-20 shrink-0 items-center justify-center">
                <svg className="size-20 -rotate-90" viewBox="0 0 84 84">
                  <circle cx="42" cy="42" r="36" stroke="#232238" strokeWidth="7" fill="none" />
                  <circle
                    cx="42"
                    cy="42"
                    r="36"
                    stroke={pkg?.releaseGates.passed ? '#10b981' : '#f59e0b'}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    fill="none"
                  />
                </svg>
                <span className="absolute text-base font-bold text-foreground">{pkg ? `${score}%` : '—'}</span>
              </div>

              {pkg && (
                <div className="flex-1 space-y-1.5 text-[11px]">
                  {[
                    ['Técnico / Sync', pkg.scorecard.technicalScore],
                    ['Áudio (LUFS)', pkg.scorecard.audioScore],
                    ['Visual / HUD', pkg.scorecard.visualScore],
                    ['Narrativa', pkg.scorecard.narrativeScore],
                    [`Humor (${pkg.timeline.humorProfile.humorIntensity}%)`, pkg.scorecard.comedyScore],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="flex items-center gap-2">
                      <span className="w-24 truncate text-muted-foreground">{label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${val}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono">{val}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pkg && !pkg.releaseGates.passed && (
              <button
                type="button"
                onClick={handleRunTargetedRepair}
                disabled={busy}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
              >
                <Wrench className="size-3.5" /> Executar Reparo Cirúrgico (Budget 3)
              </button>
            )}
          </div>

          {pendingMedia.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                  <AlertTriangle className="size-3.5 text-amber-400" />
                  Lacunas de Mídia ({pendingMedia.length})
                </h3>
                <span className="text-[10px] text-amber-300/80">Resolva cada cena</span>
              </div>
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                {pendingMedia.map((gap) => {
                  const pid = selectedProjectId || pkg?.timeline.projectId || '';
                  const draftQuery = retryQueryMap[gap.slotIndex] ?? gap.query;
                  const isBusy = resolvingSlot === gap.slotIndex;
                  return (
                    <li key={`${gap.slotIndex}_${gap.clipId}`} className="rounded-lg border border-border/80 bg-[#0d0d17] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-amber-200">
                          #{gap.slotIndex + 1} · {gap.clipId}
                        </span>
                        <button
                          type="button"
                          disabled={isBusy || !pid}
                          onClick={async () => {
                            const api = getBridge();
                            if (!api?.cinemaResolvePendingMedia || !pid) return;
                            setResolvingSlot(gap.slotIndex);
                            try {
                              const updated = await api.cinemaResolvePendingMedia({
                                projectId: pid,
                                resolutions: [{ slotIndex: gap.slotIndex, pickFile: true }],
                              });
                              if (updated?.pendingMedia) setPendingMedia(updated.pendingMedia);
                            } finally {
                              setResolvingSlot(null);
                            }
                          }}
                          className="rounded border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
                        >
                          Selecionar arquivo
                        </button>
                      </div>
                      {gap.reason && <p className="text-[11px] text-muted-foreground">{gap.reason}</p>}
                      <div className="flex gap-1.5">
                        <input
                          value={draftQuery}
                          onChange={(e) =>
                            setRetryQueryMap((prev) => ({ ...prev, [gap.slotIndex]: e.target.value }))
                          }
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
                        />
                        <button
                          type="button"
                          disabled={isBusy || !pid || !draftQuery.trim()}
                          onClick={async () => {
                            const api = getBridge();
                            if (!api?.cinemaResolvePendingMedia || !pid) return;
                            setResolvingSlot(gap.slotIndex);
                            try {
                              const updated = await api.cinemaResolvePendingMedia({
                                projectId: pid,
                                resolutions: [{ slotIndex: gap.slotIndex, retryQuery: draftQuery.trim() }],
                              });
                              if (updated?.pendingMedia) setPendingMedia(updated.pendingMedia);
                            } finally {
                              setResolvingSlot(null);
                            }
                          }}
                          className="rounded border border-border px-2 py-1 text-[10px] hover:border-primary disabled:opacity-50"
                        >
                          Rebuscar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold">
              <MessageSquarePlus className="size-3.5 text-purple-400" /> Comentários ({comments.length})
            </h3>
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="Adicionar nota com timestamp..."
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              />
              <button type="submit" className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-primary">
                +
              </button>
            </form>
            {comments.length > 0 && (
              <ul className="max-h-32 space-y-1.5 overflow-y-auto text-xs">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border/70 bg-[#0d0d17] p-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="font-semibold text-purple-300">{c.author}</span>
                      <span className="font-mono">{c.timecode}</span>
                    </div>
                    <p className="mt-0.5 text-foreground">{c.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              pkg &&
              setApprovedVersion(`v${pkg.timeline.version} (${pkg.timeline.renderFingerprint.slice(0, 8)})`)
            }
            disabled={!pkg?.releaseGates.passed}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 px-4 text-xs font-bold text-black shadow-lg hover:brightness-105 disabled:opacity-40"
          >
            <Film className="size-4" />
            {approvedVersion ? `Aprovado: ${approvedVersion}` : 'Aprovar Versão Final'}
          </button>
        </aside>
      </div>
    </div>
  );
}
