import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import {
  toAetheraMediaUrl,
  type RecapDialogueEntryView,
  type RecapGateReportView,
} from '../recap-timeline-model.js';

export interface ScriptStudioScene {
  sceneId: string;
  panelId: string;
  panelIds: string[];
  croppedImagePaths: string[];
  narrationText: string;
  characters: string[];
  eventDescription?: string;
  visualSummary?: string;
  actions?: Array<{ type: string; description: string }>;
  setting?: string;
  extractedDialogues: RecapDialogueEntryView[];
  uncertainties: string[];
  motionStyle: string;
  estimatedDurationSec: number;
  measuredDurationSec?: number;
  durationSource: 'estimated' | 'tts_measured';
  emotion?: string;
  confidence?: number;
  reviewStatus?: string;
  reviewNotes?: string;
  audioPath?: string;
  dirty?: boolean;
}

export interface RecapScriptStudioProps {
  scenes: readonly ScriptStudioScene[];
  language: string;
  humorVolume: number;
  scriptStyleLabel: string;
  gateG: RecapGateReportView | null;
  canRegenerate: boolean;
  savingSceneId: string | null;
  regeneratingSceneId: string | null;
  regeneratingScript: boolean;
  regenerateFeedback?: { ok: boolean; message: string } | null;
  onChangeNarration: (index: number, nextText: string) => void;
  onSaveScene: (sceneId: string, narrationText: string) => void;
  onRegenerateScene: (sceneId: string) => void;
  onRegenerateScript: () => void;
}

export function RecapScriptStudio({
  scenes,
  language,
  humorVolume,
  scriptStyleLabel,
  gateG,
  canRegenerate,
  savingSceneId,
  regeneratingSceneId,
  regeneratingScript,
  regenerateFeedback,
  onChangeNarration,
  onSaveScene,
  onRegenerateScene,
  onRegenerateScript,
}: RecapScriptStudioProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'focus' | 'all'>('focus');
  const [panelIdxByScene, setPanelIdxByScene] = useState<Record<string, number>>({});
  const [showVisualByScene, setShowVisualByScene] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (activeIndex >= scenes.length && scenes.length > 0) {
      setActiveIndex(scenes.length - 1);
    }
  }, [activeIndex, scenes.length]);

  useEffect(() => {
    if (viewMode !== 'focus' || scenes.length <= 1) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(scenes.length - 1, prev + 1));
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, scenes.length]);

  const totalEstSec = Math.round(scenes.reduce((s, r) => s + r.estimatedDurationSec, 0) * 10) / 10;
  const totalRealSec = scenes.some((r) => r.measuredDurationSec !== undefined)
    ? Math.round(scenes.reduce((s, r) => s + (r.measuredDurationSec ?? r.estimatedDurationSec), 0) * 10) / 10
    : null;

  if (scenes.length === 0) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 24,
          border: '1px solid #e3e3e8',
          padding: '44px 24px',
          textAlign: 'center',
          boxShadow: 'var(--elevation-1)',
        }}
      >
        <BookOpen style={{ width: 28, height: 28, color: '#62626c', margin: '0 auto 10px' }} aria-hidden="true" />
        <h3 className="recap-heading-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111111' }}>
          Nenhum roteiro gerado ainda
        </h3>
        <p style={{ margin: '6px auto 0', maxWidth: 460, fontSize: 13, color: '#62626c', lineHeight: 1.55 }}>
          Importe um capítulo e execute a análise multimodal para abrir o estúdio de revisão com os painéis originais ao lado da narração.
        </p>
      </div>
    );
  }

  const renderedEntries =
    viewMode === 'focus'
      ? [{ row: scenes[Math.min(activeIndex, scenes.length - 1)]!, idx: Math.min(activeIndex, scenes.length - 1) }]
      : scenes.map((row, idx) => ({ row, idx }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Studio Toolbar */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 22,
          border: '1px solid #e3e3e8',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'var(--elevation-1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="recap-heading-display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111111' }}>
              Roteiro Real · {scenes.length} {scenes.length === 1 ? 'cena' : 'cenas'}
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#62626c', fontFamily: 'var(--font-mono)' }}>
              {scriptStyleLabel} · {language} · Humor {humorVolume}% ·{' '}
              {totalRealSec !== null ? `Real (TTS): ${totalRealSec}s (est. ${totalEstSec}s)` : `Estimado: ~${totalEstSec}s`}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div
              role="group"
              aria-label="Modo de visualização do roteiro"
              style={{
                display: 'inline-flex',
                padding: 3,
                borderRadius: 9999,
                background: '#f4f4f6',
                border: '1px solid #e3e3e8',
              }}
            >
              {(['focus', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className="recap-pressable"
                  style={{
                    padding: '5px 12px',
                    borderRadius: 9999,
                    border: 'none',
                    background: viewMode === mode ? '#111111' : 'transparent',
                    color: viewMode === mode ? '#ffffff' : '#52525b',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  {mode === 'focus' ? 'Foco na Cena' : 'Todas as Cenas'}
                </button>
              ))}
            </div>

            {canRegenerate && (
              <button
                type="button"
                disabled={regeneratingScript || regeneratingSceneId !== null}
                onClick={onRegenerateScript}
                className="recap-pressable"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 9999,
                  border: '1px solid #cfcfd6',
                  background: '#ffffff',
                  color: '#111111',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: regeneratingScript ? 0.6 : 1,
                }}
              >
                <RefreshCw
                  style={{
                    width: 13,
                    height: 13,
                    animation: regeneratingScript ? 'spin 1s linear infinite' : undefined,
                  }}
                  aria-hidden="true"
                />
                {regeneratingScript ? 'Regenerando…' : 'Regenerar roteiro'}
              </button>
            )}
          </div>
        </div>

        {(regeneratingScript || regenerateFeedback) && (
          <div
            role="status"
            style={{
              padding: '9px 12px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 500,
              border: regeneratingScript
                ? '1px solid #d4d4d8'
                : regenerateFeedback?.ok
                  ? '1px solid #bbf7d0'
                  : '1px solid #fecaca',
              background: regeneratingScript
                ? '#f4f4f5'
                : regenerateFeedback?.ok
                  ? '#f0fdf4'
                  : '#fef2f2',
              color: regeneratingScript
                ? '#27272a'
                : regenerateFeedback?.ok
                  ? '#166534'
                  : '#991b1b',
            }}
          >
            {regeneratingScript
              ? 'Reescrevendo o roteiro a partir das análises visuais já prontas (filtrando ruído de OCR e linguagem técnica)…'
              : regenerateFeedback?.message}
          </div>
        )}

        {/* Fast Scene Strip (avoids scrolling massive textareas) */}
        {viewMode === 'focus' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              aria-label="Cena anterior"
              disabled={activeIndex <= 0}
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              className="recap-pressable"
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                border: '1px solid #e3e3e8',
                background: '#ffffff',
                color: '#111111',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: activeIndex <= 0 ? 0.4 : 1,
              }}
            >
              <ChevronLeft style={{ width: 15, height: 15 }} aria-hidden="true" />
            </button>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              {scenes.map((sc, i) => {
                const selected = i === activeIndex;
                const hasWarn =
                  sc.reviewStatus === 'needs_review' ||
                  (sc.confidence !== undefined && sc.confidence < 0.5) ||
                  (gateG?.hints ?? []).some((h) => h.sceneId === sc.sceneId);
                return (
                  <button
                    key={sc.sceneId}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className="recap-pressable"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 9999,
                      border: selected
                        ? '1.5px solid #111111'
                        : hasWarn
                          ? '1px solid #fde68a'
                          : '1px solid #e3e3e8',
                      background: selected ? '#d8fb4f' : hasWarn ? '#fef3c7' : '#f4f4f6',
                      color: '#111111',
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <span>Cena {String(i + 1).padStart(2, '0')}</span>
                    <span style={{ opacity: 0.7, fontWeight: 500 }}>
                      {sc.measuredDurationSec ?? sc.estimatedDurationSec}s
                    </span>
                    {sc.dirty && <span title="Edição não salva" style={{ color: '#6a46d8' }}>•</span>}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              aria-label="Próxima cena"
              disabled={activeIndex >= scenes.length - 1}
              onClick={() => setActiveIndex((i) => Math.min(scenes.length - 1, i + 1))}
              className="recap-pressable"
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                border: '1px solid #e3e3e8',
                background: '#ffffff',
                color: '#111111',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: activeIndex >= scenes.length - 1 ? 0.4 : 1,
              }}
            >
              <ChevronRight style={{ width: 15, height: 15 }} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Focused or Full Scene Cards */}
      {renderedEntries.map(({ row, idx }) => {
        const sceneHints = (gateG?.hints ?? []).filter((h) => h.sceneId === row.sceneId);
        const hasAlerts =
          row.reviewStatus === 'needs_review' ||
          (row.confidence !== undefined && row.confidence < 0.5) ||
          row.uncertainties.length > 0 ||
          sceneHints.length > 0;
        const pIdx = Math.min(panelIdxByScene[row.sceneId] ?? 0, Math.max(0, row.croppedImagePaths.length - 1));
        const activePanelPath = row.croppedImagePaths[pIdx] ?? null;
        const wordCount = row.narrationText.trim().split(/\s+/).filter(Boolean).length;
        const showVisual = Boolean(showVisualByScene[row.sceneId]);

        return (
          <article
            key={row.sceneId}
            style={{
              background: '#ffffff',
              borderRadius: 24,
              border: hasAlerts ? '1px solid #fde68a' : '1px solid #e3e3e8',
              padding: 20,
              boxShadow: 'var(--elevation-1)',
              display: 'grid',
              gap: 20,
              gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)',
              alignItems: 'start',
            }}
          >
            {/* Left: Original Panel Showcase */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: '1px solid #e3e3e8',
                  background: '#f4f4f6',
                  aspectRatio: '3 / 4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {activePanelPath ? (
                  <img
                    src={toAetheraMediaUrl(activePanelPath)}
                    alt={`Painel original da Cena ${String(idx + 1).padStart(2, '0')}`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <span style={{ fontSize: 12, color: '#62626c', padding: 16, textAlign: 'center' }}>
                    Miniatura do painel indisponível
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#62626c' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.panelIds[pIdx] ?? row.panelId}
                </span>
                {row.croppedImagePaths.length > 1 && (
                  <span>
                    {pIdx + 1}/{row.croppedImagePaths.length}
                  </span>
                )}
              </div>

              {row.croppedImagePaths.length > 1 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {row.croppedImagePaths.map((imgPath, i) => (
                    <button
                      key={`${row.sceneId}-p-${i}`}
                      type="button"
                      onClick={() => setPanelIdxByScene((prev) => ({ ...prev, [row.sceneId]: i }))}
                      className="recap-pressable"
                      style={{
                        width: 44,
                        height: 54,
                        padding: 2,
                        borderRadius: 8,
                        border: i === pIdx ? '2px solid #111111' : '1px solid #e3e3e8',
                        background: '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={toAetheraMediaUrl(imgPath)}
                        alt={`Miniatura ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5 }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Comfortable Script Editor & Grounding Evidence */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3 className="recap-heading-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111111' }}>
                      Cena {String(idx + 1).padStart(2, '0')}
                    </h3>
                    {row.confidence !== undefined && (
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 9999,
                          background: row.confidence >= 0.6 ? '#eaf7df' : '#fef3c7',
                          color: row.confidence >= 0.6 ? '#166534' : '#9a6200',
                          border: `1px solid ${row.confidence >= 0.6 ? '#bbf7d0' : '#fde68a'}`,
                        }}
                      >
                        Fidelidade {Math.round(row.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {(row.characters.length > 0 || row.setting) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {row.characters.map((ch) => (
                        <span
                          key={ch}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '3px 9px',
                            borderRadius: 9999,
                            background: '#f3fdd0',
                            color: '#111111',
                            border: '1px solid #d4ee7c',
                          }}
                        >
                          {ch}
                        </span>
                      ))}
                      {row.setting && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: '3px 9px',
                            borderRadius: 9999,
                            background: '#f4f4f6',
                            color: '#52525b',
                          }}
                        >
                          {row.setting}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  {row.measuredDurationSec !== undefined ? (
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 9999,
                        background: '#eaf7df',
                        color: '#166534',
                        border: '1px solid #bbf7d0',
                        fontWeight: 700,
                      }}
                    >
                      Real (TTS): {row.measuredDurationSec}s · est. {row.estimatedDurationSec}s
                    </span>
                  ) : (
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 9999,
                        background: '#f4f4f6',
                        color: '#52525b',
                        border: '1px solid #e3e3e8',
                      }}
                    >
                      Estimada: ~{row.estimatedDurationSec}s
                    </span>
                  )}
                  <span style={{ color: '#62626c' }}>{wordCount} palavras</span>
                </div>
              </div>

              {/* Extracted Dialogues */}
              {row.extractedDialogues.length > 0 && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: '#f4f4f6',
                    border: '1px solid #e3e3e8',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#62626c', marginBottom: 6 }}>
                    Diálogos extraídos dos balões ({row.extractedDialogues.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {row.extractedDialogues.map((d, dIdx) => (
                      <div key={dIdx} style={{ color: '#111111', lineHeight: 1.5 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a46d8', marginRight: 6 }}>
                          [{(d.kind ?? (d.isNarration ? 'narration' : 'dialogue')).toUpperCase()}]
                        </span>
                        {d.speaker && <strong style={{ marginRight: 4 }}>{d.speaker}:</strong>}
                        <span>"{d.translatedText ?? d.text}"</span>
                        {d.originalText && d.translatedText && d.originalText !== d.translatedText && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: '#62626c' }}>
                            (orig.: "{d.originalText}")
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Gate G & Fidelity Alerts */}
              {hasAlerts && (
                <div
                  role="alert"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    color: '#9a6200',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    <AlertTriangle style={{ width: 14, height: 14 }} aria-hidden="true" />
                    <span>Alerta de fidelidade narrativa</span>
                  </div>
                  {row.reviewNotes && <span>{row.reviewNotes}</span>}
                  {row.uncertainties.map((u, uIdx) => (
                    <span key={`u-${uIdx}`}>• {u}</span>
                  ))}
                  {sceneHints.map((h, hIdx) => (
                    <span key={`h-${hIdx}`}>• [{h.issueCode}] {h.detail}</span>
                  ))}
                </div>
              )}

              {/* Comfortable Narration Editor */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label htmlFor={`studio-narration-${row.sceneId}`} style={{ fontSize: 12, fontWeight: 700, color: '#111111' }}>
                      Narração da cena
                    </label>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: '#f4f4f6',
                        border: '1px solid #e3e3e8',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#2a1d5c',
                      }}
                    >
                      {scriptStyleLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowVisualByScene((prev) => ({ ...prev, [row.sceneId]: !prev[row.sceneId] }))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#6a46d8',
                      cursor: 'pointer',
                    }}
                  >
                    {showVisual ? 'Ocultar análise visual detalhada' : 'Ver análise visual detalhada'}
                  </button>
                </div>
                <textarea
                  id={`studio-narration-${row.sceneId}`}
                  value={row.narrationText}
                  onChange={(e) => onChangeNarration(idx, e.target.value)}
                  rows={4}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: '1px solid #cfcfd6',
                    background: '#ffffff',
                    color: '#111111',
                    fontSize: 15,
                    lineHeight: 1.65,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Audio Preview when available */}
              {row.audioPath && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: '#f4f4f6',
                    border: '1px solid #e3e3e8',
                  }}
                >
                  <Volume2 style={{ width: 15, height: 15, color: '#166534', flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#111111' }}>Prévia da narração</span>
                  <audio controls preload="none" src={toAetheraMediaUrl(row.audioPath)} style={{ height: 30, flex: 1 }} />
                </div>
              )}

              {/* Progressive Disclosure: Detailed Visual Analysis (strictly separated from narration) */}
              {showVisual && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: '#f8f7fc',
                    border: '1px solid #e3e3e8',
                    fontSize: 12,
                    color: '#52525b',
                    lineHeight: 1.55,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2a1d5c' }}>
                    Análise visual detalhada (separada do roteiro)
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#111111', marginBottom: 2 }}>Descrição técnica</div>
                    <p style={{ margin: 0, color: '#3f3f46' }}>
                      {row.visualSummary || row.eventDescription || 'Sem descrição técnica registrada.'}
                    </p>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#111111', marginBottom: 2 }}>Ações identificadas</div>
                    {row.actions && row.actions.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, color: '#3f3f46' }}>
                        {row.actions.map((act, aIdx) => (
                          <li key={aIdx}>[{act.type}] {act.description}</li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: '#71717a' }}>Nenhuma ação específica registrada.</span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#111111', marginBottom: 2 }}>Diálogos extraídos</div>
                    {row.extractedDialogues.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, color: '#3f3f46' }}>
                        {row.extractedDialogues.map((d, dIdx) => (
                          <li key={dIdx}>
                            {d.speaker ? `${d.speaker}: ` : ''}"{d.translatedText?.trim() || d.text}"
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: '#71717a' }}>Nenhum diálogo extraído nos painéis.</span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#111111', marginBottom: 2 }}>Personagens reconhecidos</div>
                    <span style={{ color: '#3f3f46' }}>
                      {row.characters.length > 0 ? row.characters.join(', ') : 'Nenhum personagem identificado.'}
                    </span>
                  </div>
                </div>
              )}

              {/* Action Row */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                {row.dirty && (
                  <button
                    type="button"
                    disabled={savingSceneId === row.sceneId}
                    onClick={() => onSaveScene(row.sceneId, row.narrationText)}
                    className="recap-pressable"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9999,
                      border: 'none',
                      background: '#d8fb4f',
                      color: '#111111',
                      fontSize: 12,
                      fontWeight: 700,
                      opacity: savingSceneId === row.sceneId ? 0.6 : 1,
                    }}
                  >
                    {savingSceneId === row.sceneId ? 'Salvando…' : 'Salvar edição'}
                  </button>
                )}
                {canRegenerate && (
                  <button
                    type="button"
                    disabled={regeneratingSceneId === row.sceneId || regeneratingScript}
                    onClick={() => onRegenerateScene(row.sceneId)}
                    className="recap-pressable"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 9999,
                      border: '1px solid #cfcfd6',
                      background: '#ffffff',
                      color: '#111111',
                      fontSize: 12,
                      fontWeight: 600,
                      opacity: regeneratingSceneId === row.sceneId ? 0.6 : 1,
                    }}
                  >
                    <RefreshCw style={{ width: 12, height: 12 }} aria-hidden="true" />
                    {regeneratingSceneId === row.sceneId ? 'Regenerando cena…' : 'Regenerar esta cena'}
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
