import { useEffect, useMemo, useState } from 'react';
import {
  Clapperboard,
  Download,
  Film,
  Pause,
  Play,
  SkipBack,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react';
import type { SceneItem } from '../domain/types';
import { useStudio } from '../store/studio-store';

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function EditorPage() {
  const {
    projects,
    renderJobs,
    activeProject,
    selectProject,
    updateScene,
    startFfmpegRender,
    navigate,
  } = useStudio();
  const project = activeProject ?? projects[0];
  const [selectedSceneId, setSelectedSceneId] = useState<string>(project?.scenes[0]?.id ?? '');
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [monitorMode, setMonitorMode] = useState<'storyboard' | 'mp4'>('storyboard');
  const [rendering, setRendering] = useState(false);

  const latestRender = useMemo(() => {
    if (!project) return undefined;
    return renderJobs.find(
      (j) => j.projectId === project.id && j.status === 'completed' && Boolean(j.outputUrl),
    );
  }, [renderJobs, project]);

  const totalDuration = useMemo(
    () => (project ? project.scenes.reduce((acc, s) => acc + s.durationSec, 0) : 0),
    [project],
  );

  useEffect(() => {
    if (!playing || totalDuration === 0) return undefined;
    const id = window.setInterval(() => {
      setPlayheadSec((prev) => {
        if (prev + 1 >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return prev + 1;
      });
    }, 350);
    return () => window.clearInterval(id);
  }, [playing, totalDuration]);

  const activeScene = useMemo(() => {
    if (!project) return undefined;
    return project.scenes.find((s) => s.id === selectedSceneId) ?? project.scenes[0];
  }, [project, selectedSceneId]);

  const playheadScene = useMemo(() => {
    if (!project) return undefined;
    let cursor = 0;
    for (const s of project.scenes) {
      if (playheadSec < cursor + s.durationSec) return s;
      cursor += s.durationSec;
    }
    return project.scenes[project.scenes.length - 1];
  }, [project, playheadSec]);

  if (!project) return null;

  const handleExportOtio = () => {
    const otio = {
      OTIO_SCHEMA: 'Timeline.1',
      name: project.title,
      tracks: [
        {
          name: 'V1 — Vídeo Principal',
          clips: project.scenes.map((s) => ({
            name: s.title,
            durationSec: s.durationSec,
            transition: s.transition,
          })),
        },
        {
          name: 'A1 — Narração',
          provider: project.ttsProvider,
          voice: project.ttsVoice,
        },
      ],
    };
    const blob = new Blob([JSON.stringify(otio, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.id}-timeline.otio.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExportMessage(`Timeline OTIO exportada (${project.scenes.length} cenas, ${formatTime(totalDuration)}).`);
  };

  const handleRenderMp4 = async () => {
    setRendering(true);
    try {
      await startFfmpegRender(project.id, project.qualityPreset);
      setExportMessage('Render FFmpeg iniciado em tempo real! Acompanhe na fila ou aguarde o player MP4.');
      setMonitorMode('mp4');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-[#efe9fd] text-[#6a46d8] flex items-center justify-center shrink-0">
            <Film className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[#111111] truncate">Editor Multifaixa</h1>
            <p className="text-xs text-[#62626c]">
              Timeline não-destrutiva sincronizada com o SQLite, exportação OTIO e render MP4 real via FFmpeg.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Selecionar projeto no editor"
            value={project.id}
            onChange={(e) => {
              selectProject(e.target.value);
              setPlayheadSec(0);
              setPlaying(false);
            }}
            className="h-9 rounded-full bg-[#f4f4f6] px-3.5 text-xs font-semibold text-[#111111]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={rendering}
            onClick={() => void handleRenderMp4()}
            className="h-9 px-4 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>{rendering ? 'Renderizando...' : 'Renderizar MP4 (FFmpeg)'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportOtio}
            className="h-9 px-4 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#24242c]"
          >
            <Download className="w-3.5 h-3.5 text-[#d8fb4f]" />
            <span>Exportar OTIO</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('review', project.id)}
            className="h-9 px-4 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-semibold"
          >
            Ir para Revisão
          </button>
        </div>
      </div>

      {exportMessage && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111]">
          {exportMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <section className="xl:col-span-8 rounded-[28px] bg-white p-5 shadow-2xs space-y-4">
          {/* Monitor Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setMonitorMode('storyboard')}
                className={`h-8 px-3.5 rounded-full text-xs font-semibold ${
                  monitorMode === 'storyboard' ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111]'
                }`}
              >
                Monitor Storyboard
              </button>
              <button
                type="button"
                onClick={() => setMonitorMode('mp4')}
                className={`h-8 px-3.5 rounded-full text-xs font-semibold ${
                  monitorMode === 'mp4' ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111]'
                }`}
              >
                Player MP4 Real {latestRender ? '(Pronto)' : ''}
              </button>
            </div>
            {latestRender?.probeMetrics && (
              <span className="text-[11px] font-mono text-[#2f7d32]">
                FFprobe: {latestRender.probeMetrics.width}×{latestRender.probeMetrics.height} •{' '}
                {latestRender.probeMetrics.videoCodec}/{latestRender.probeMetrics.audioCodec}
              </span>
            )}
          </div>

          {monitorMode === 'mp4' && latestRender?.outputUrl ? (
            <video
              key={latestRender.outputUrl}
              src={latestRender.outputUrl}
              poster={latestRender.thumbnailUrl ?? undefined}
              controls
              className="w-full aspect-video rounded-3xl bg-black"
            />
          ) : (
            <div className="relative aspect-video rounded-3xl bg-[#111118] text-white overflow-hidden flex flex-col justify-between p-6">
              <div className="flex items-center justify-between text-xs">
                <span className="px-2.5 py-1 rounded-full bg-white/15 font-mono">
                  {project.aspectRatio} • {project.qualityPreset.replace('_', ' ')}
                </span>
                <span className="font-mono text-[#d8fb4f]">
                  {formatTime(playheadSec)} / {formatTime(totalDuration)}
                </span>
              </div>

              {playheadScene && (
                <div className="my-auto text-center max-w-xl mx-auto space-y-2">
                  <span
                    className="inline-block px-3 py-1 rounded-full text-[11px] font-bold text-[#111111]"
                    style={{ backgroundColor: playheadScene.accentHex }}
                  >
                    CENA {playheadScene.index} • {playheadScene.transition.replace('_', ' ').toUpperCase()}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{playheadScene.title}</h2>
                  <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
                    {playheadScene.narration}
                  </p>
                </div>
              )}

              {playheadScene && (
                <div className="mx-auto px-4 py-1.5 rounded-xl bg-black/70 border border-white/15 text-xs font-semibold tracking-wide text-[#d8fb4f]">
                  {playheadScene.caption}
                </div>
              )}
            </div>
          )}

          {/* Transport Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPlayheadSec(0);
                  setPlaying(false);
                }}
                aria-label="Voltar ao início"
                className="w-9 h-9 rounded-full bg-[#f4f4f6] hover:bg-[#e3e3e8] inline-flex items-center justify-center text-[#111111]"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pausar prévia' : 'Reproduzir prévia'}
                className="h-9 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2"
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-[#d8fb4f]" />}
                <span>{playing ? 'Pausar' : 'Reproduzir'}</span>
              </button>
            </div>

            <div className="flex-1 min-w-[180px] flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={Math.max(1, totalDuration)}
                value={playheadSec}
                aria-label="Linha do tempo"
                onChange={(e) => setPlayheadSec(Number(e.target.value))}
                className="w-full accent-[#111111]"
              />
            </div>

            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#62626c]">
              <Volume2 className="w-3.5 h-3.5" />
              <span>
                {latestRender?.probeMetrics?.loudnessLufs !== undefined &&
                latestRender.probeMetrics.loudnessLufs !== null
                  ? `${latestRender.probeMetrics.loudnessLufs} LUFS`
                  : '-14 LUFS alvo'}
              </span>
            </div>
          </div>
        </section>

        <aside className="xl:col-span-4 rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#6a46d8]" />
            <h2 className="text-sm font-bold text-[#111111]">Inspetor de Cena</h2>
          </div>

          {activeScene && (
            <div className="space-y-3">
              <div>
                <label htmlFor="scene-title" className="block text-xs font-semibold text-[#111111] mb-1">
                  Título da Cena {activeScene.index}
                </label>
                <input
                  id="scene-title"
                  type="text"
                  value={activeScene.title}
                  onChange={(e) => void updateScene(project.id, activeScene.id, { title: e.target.value })}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                />
              </div>

              <div>
                <label htmlFor="scene-caption" className="block text-xs font-semibold text-[#111111] mb-1">
                  Legenda dinâmica
                </label>
                <input
                  id="scene-caption"
                  type="text"
                  value={activeScene.caption}
                  onChange={(e) => void updateScene(project.id, activeScene.id, { caption: e.target.value })}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="scene-duration" className="block text-xs font-semibold text-[#111111] mb-1">
                    Duração (s)
                  </label>
                  <input
                    id="scene-duration"
                    type="number"
                    min={4}
                    max={300}
                    value={activeScene.durationSec}
                    onChange={(e) =>
                      void updateScene(project.id, activeScene.id, {
                        durationSec: Math.max(4, Number(e.target.value) || 4),
                      })
                    }
                    className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-mono font-semibold text-[#111111]"
                  />
                </div>

                <div>
                  <label htmlFor="scene-transition" className="block text-xs font-semibold text-[#111111] mb-1">
                    Transição
                  </label>
                  <select
                    id="scene-transition"
                    value={activeScene.transition}
                    onChange={(e) =>
                      void updateScene(project.id, activeScene.id, {
                        transition: e.target.value as SceneItem['transition'],
                      })
                    }
                    className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
                  >
                    <option value="corte_seco">Corte seco</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="whip_pan">Whip pan</option>
                    <option value="fade_black">Fade black</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="scene-narration" className="block text-xs font-semibold text-[#111111] mb-1">
                  Texto de Narração
                </label>
                <textarea
                  id="scene-narration"
                  rows={3}
                  value={activeScene.narration}
                  onChange={(e) => void updateScene(project.id, activeScene.id, { narration: e.target.value })}
                  className="w-full rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] p-2.5 text-xs text-[#111111]"
                />
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Multitrack Timeline */}
      <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3 overflow-x-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#111111]">Timeline Multifaixa</h2>
          <span className="text-xs font-mono text-[#62626c]">
            {project.scenes.length} clipes • Total {formatTime(totalDuration)}
          </span>
        </div>

        <div className="min-w-[640px] space-y-2.5">
          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-2 text-xs font-semibold text-[#62626c]">V1 • Vídeo</div>
            <div className="col-span-10 flex gap-1.5">
              {project.scenes.map((scene) => {
                const widthPct = Math.max(12, Math.round((scene.durationSec / Math.max(1, totalDuration)) * 100));
                const isSelected = activeScene?.id === scene.id;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => setSelectedSceneId(scene.id)}
                    style={{ width: `${widthPct}%`, backgroundColor: scene.accentHex }}
                    className={`h-12 rounded-2xl px-3 text-left text-[#111111] transition-all truncate ${
                      isSelected ? 'ring-2 ring-[#111111] shadow-sm' : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <div className="text-[11px] font-bold truncate">
                      {scene.index}. {scene.title}
                    </div>
                    <div className="text-[10px] font-mono opacity-80">{scene.durationSec}s</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-2 text-xs font-semibold text-[#62626c]">A1 • Narração</div>
            <div className="col-span-10 flex gap-1.5">
              {project.scenes.map((scene) => {
                const widthPct = Math.max(12, Math.round((scene.durationSec / Math.max(1, totalDuration)) * 100));
                return (
                  <div
                    key={scene.id}
                    style={{ width: `${widthPct}%` }}
                    className="h-9 rounded-xl bg-[#efe9fd] px-2.5 flex items-center text-[11px] font-medium text-[#2a1d5c] truncate"
                  >
                    TTS • {project.ttsProvider}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-2 text-xs font-semibold text-[#62626c]">A2 • Trilha/SFX</div>
            <div className="col-span-10 h-8 rounded-xl bg-[#f3fdd0] px-3 flex items-center justify-between text-[11px] font-medium text-[#111111]">
              <span>Trilha adaptativa com ducking automático (-14 LUFS)</span>
              <span className="font-mono">{formatTime(totalDuration)}</span>
            </div>
          </div>

          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-2 text-xs font-semibold text-[#62626c]">T1 • Legendas</div>
            <div className="col-span-10 flex gap-1.5">
              {project.scenes.map((scene) => {
                const widthPct = Math.max(12, Math.round((scene.durationSec / Math.max(1, totalDuration)) * 100));
                return (
                  <div
                    key={scene.id}
                    style={{ width: `${widthPct}%` }}
                    className="h-8 rounded-xl bg-[#f4f4f6] px-2.5 flex items-center text-[10px] text-[#62626c] truncate"
                  >
                    {scene.caption}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
