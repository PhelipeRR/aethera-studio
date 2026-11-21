import { AlertTriangle, CheckCircle2, Film, Layers, Music, Sparkles, Volume2 } from 'lucide-react';
import {
  deriveAudiovisualTracks,
  formatTimecodeMs,
  toAetheraMediaUrl,
  type MotionVelixRenderTelemetry,
  type RecapAudiovisualPlanView,
} from '../recap-timeline-model.js';
import type { ScriptStudioScene } from './RecapScriptStudio.js';

export interface RecapVisualStoryboardProps {
  scenes: readonly ScriptStudioScene[];
  plan: RecapAudiovisualPlanView | null;
  motionVelix?: MotionVelixRenderTelemetry | null;
  selectedShotId: string | null;
  onSelectShot: (shotId: string) => void;
}

export function RecapVisualStoryboard({
  scenes,
  plan,
  motionVelix,
  selectedShotId,
  onSelectShot,
}: RecapVisualStoryboardProps) {
  const tracks = deriveAudiovisualTracks(plan, motionVelix);

  const sceneAlerts = scenes.map((sc, idx) => {
    const dur = sc.measuredDurationSec ?? sc.estimatedDurationSec;
    const issues: string[] = [];
    if (!sc.narrationText.trim()) issues.push('Sem narração');
    if (dur < 3) issues.push(`Muito curta (${dur}s)`);
    if (dur > 45) issues.push(`Muito longa (${dur}s)`);
    return { sceneId: sc.sceneId, idx, dur, issues };
  });

  const flaggedCount = sceneAlerts.filter((a) => a.issues.length > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Storyboard Visual Cards with Panel Thumbnails & Pacing Diagnostics */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 24,
          border: '1px solid #e3e3e8',
          padding: 18,
          boxShadow: 'var(--elevation-1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h2 className="recap-heading-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111111' }}>
              Storyboard Visual ({scenes.length} cenas)
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#62626c' }}>
              Miniaturas dos painéis, duração por cena, efeitos Motion Velix e detecção rápida de ritmo.
            </p>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              background: flaggedCount === 0 ? '#eaf7df' : '#fef3c7',
              color: flaggedCount === 0 ? '#166534' : '#9a6200',
              border: `1px solid ${flaggedCount === 0 ? '#bbf7d0' : '#fde68a'}`,
            }}
          >
            {flaggedCount === 0 ? (
              <>
                <CheckCircle2 style={{ width: 13, height: 13 }} aria-hidden="true" />
                Ritmo equilibrado
              </>
            ) : (
              <>
                <AlertTriangle style={{ width: 13, height: 13 }} aria-hidden="true" />
                {flaggedCount} cena(s) fora do ritmo ideal
              </>
            )}
          </span>
        </div>

        {scenes.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', borderRadius: 16, background: '#f4f4f6', color: '#62626c', fontSize: 13 }}>
            Gere o roteiro para montar automaticamente o storyboard com miniaturas e durações.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {scenes.map((sc, idx) => {
              const alert = sceneAlerts[idx]!;
              const thumb = sc.croppedImagePaths[0] ?? null;
              const shot = plan?.shots.find((s) => s.sceneId === sc.sceneId);
              const isSelected = Boolean(shot && shot.shotId === selectedShotId);

              return (
                <button
                  key={sc.sceneId}
                  type="button"
                  onClick={() => shot && onSelectShot(shot.shotId)}
                  className="recap-pressable recap-card-hover"
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 16,
                    border: isSelected
                      ? '2px solid #111111'
                      : alert.issues.length > 0
                        ? '1px solid #fde68a'
                        : '1px solid #e3e3e8',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontFamily: 'inherit',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 10',
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: '#f4f4f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {thumb ? (
                      <img
                        src={toAetheraMediaUrl(thumb)}
                        alt={`Cena ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Film style={{ width: 20, height: 20, color: '#a1a1aa' }} aria-hidden="true" />
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        padding: '2px 7px',
                        borderRadius: 9999,
                        background: 'rgba(17,17,17,0.82)',
                        color: '#d8fb4f',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {alert.dur}s
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <strong style={{ color: '#111111' }}>Cena {String(idx + 1).padStart(2, '0')}</strong>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#6a46d8' }}>
                      {sc.motionStyle}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: '#52525b',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {sc.narrationText}
                  </p>

                  {alert.issues.length > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#9a6200',
                        background: '#fef3c7',
                        padding: '2px 7px',
                        borderRadius: 9999,
                        alignSelf: 'flex-start',
                      }}
                    >
                      {alert.issues.join(' · ')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Multi-Track NLE Timeline (Distinct Video, Narration, Music, SFX & Motion Velix Tracks) */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 24,
          border: '1px solid #e3e3e8',
          padding: 18,
          boxShadow: 'var(--elevation-1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers style={{ width: 16, height: 16, color: '#111111' }} aria-hidden="true" />
            <h3 className="recap-heading-display" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111111' }}>
              Timeline Multipista · Sincronização Audio-First
            </h3>
          </div>
          {tracks.hasRealPlan && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 9999,
                background: tracks.audioClipped ? '#fde7f3' : '#eaf7df',
                color: tracks.audioClipped ? '#b42840' : '#166534',
              }}
            >
              {tracks.audioClipped ? 'Áudio truncado!' : 'Sincronizado'} · {formatTimecodeMs(tracks.totalDurationMs)} · {tracks.resolutionLabel}
            </span>
          )}
        </div>

        {!tracks.hasRealPlan ? (
          <div style={{ padding: '22px 16px', borderRadius: 14, background: '#f4f4f6', color: '#62626c', fontSize: 12, textAlign: 'center' }}>
            As trilhas sincronizadas de Vídeo, Narração TTS, Música, SFX e Motion Velix aparecerão aqui após o planejamento audiovisual.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Track V1: Video Panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#111111', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Film style={{ width: 13, height: 13 }} aria-hidden="true" /> V1 Vídeo
              </span>
              <div style={{ position: 'relative', height: 34, borderRadius: 10, background: '#f4f4f6', overflow: 'hidden', border: '1px solid #e3e3e8' }}>
                {tracks.shots.map((shot) => (
                  <button
                    key={shot.shotId}
                    type="button"
                    onClick={() => onSelectShot(shot.shotId)}
                    title={`${shot.shotId} · ${shot.motionStyle} · ${formatTimecodeMs(shot.durationMs)}`}
                    style={{
                      position: 'absolute',
                      left: `${shot.startPct}%`,
                      width: `${shot.widthPct}%`,
                      top: 2,
                      bottom: 2,
                      borderRadius: 7,
                      border: shot.shotId === selectedShotId ? '2px solid #111111' : '1px solid #ffffff',
                      background: shot.shotId === selectedShotId ? '#d8fb4f' : '#e4e4e7',
                      color: '#111111',
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      padding: '0 6px',
                    }}
                  >
                    C{shot.sceneIndex + 1} · {shot.motionStyle}
                  </button>
                ))}
              </div>
            </div>

            {/* Track A1: Narration TTS */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#166534', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Volume2 style={{ width: 13, height: 13 }} aria-hidden="true" /> A1 Narração
              </span>
              <div style={{ position: 'relative', height: 26, borderRadius: 8, background: '#eaf7df', border: '1px solid #bbf7d0', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, (tracks.measuredNarrationDurationMs / tracks.totalDurationMs) * 100)}%`,
                    height: '100%',
                    background: '#d8fb4f',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    color: '#111111',
                  }}
                >
                  TTS Real · {formatTimecodeMs(tracks.measuredNarrationDurationMs)}
                </div>
              </div>
            </div>

            {/* Track A2: Music + Sidechain Ducking */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2f5fd0', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Music style={{ width: 13, height: 13 }} aria-hidden="true" /> A2 Música
              </span>
              <div style={{ height: 22, borderRadius: 8, background: '#e2ecff', border: '1px solid #c7d9ff', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 10, fontFamily: 'var(--font-mono)', color: '#2f5fd0', fontWeight: 600 }}>
                Trilha contínua com ducking automático (-14 LUFS)
              </div>
            </div>

            {/* Track A3: SFX & Motion Velix */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6a46d8', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Sparkles style={{ width: 13, height: 13 }} aria-hidden="true" /> A3 SFX / FX
              </span>
              <div style={{ position: 'relative', height: 24, borderRadius: 8, background: '#efe9fd', border: '1px solid #d6c8fb', overflow: 'hidden' }}>
                {tracks.sfxMarkers.map((cue) => (
                  <span
                    key={cue.cueId}
                    title={`${cue.sfxKind} @ ${formatTimecodeMs(cue.timeMs)} (${cue.reason})`}
                    style={{
                      position: 'absolute',
                      left: `${cue.offsetPct}%`,
                      top: 3,
                      bottom: 3,
                      padding: '0 6px',
                      borderRadius: 6,
                      background: '#6a46d8',
                      color: '#ffffff',
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {cue.sfxKind}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
