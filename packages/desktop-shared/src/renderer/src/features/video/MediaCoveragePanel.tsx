import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Film, RefreshCw, Search, Sparkles } from 'lucide-react';

export interface MediaCoverageReportView {
  format: string;
  totalExpectedDurationSec: number;
  uniqueAssetCount: number;
  usableMediaDurationSec: number;
  coverageRatio: number;
  repetitionIndex: number;
  uncoveredSubjects: string[];
  incompatibleMedia: Array<{ mediaId: string; reason: string }>;
  segments: Array<{
    segmentId: string;
    subject: string;
    expectedEvent?: string;
    narrationExcerpt?: string;
    expectedDurationSec: number;
    usableDurationSec: number;
    sourceDiversityCount: number;
    plannedReuses: number;
    coverageGapSec: number;
    covered: boolean;
  }>;
  repetition: {
    repetitionIndex: number;
    maxAllowedRepetitionIndex: number;
    violations: Array<{ kind: string; mediaId: string; clipIds: string[]; detail: string }>;
    passed: boolean;
  };
  gatePassed: boolean;
  gateReasons: string[];
}

export interface MediaRelevanceDecisionView {
  mediaId: string;
  accepted: boolean;
  score: number;
  reason?: string;
  rejectionReason?: string;
}

export interface AcquisitionFunnelAuditView {
  stoppedReason?: string;
  elapsedMs?: number;
  totalDeadlineMs?: number;
  queriesExecuted?: Array<{ segmentId: string; query: string }>;
  candidatesFoundCount?: number;
  acquiredFilesCount?: number;
  approvedForAssemblyCount?: number;
  funnelMetrics?: {
    counts?: {
      discovered?: number;
      downloading?: number;
      downloaded?: number;
      pending_visual_verification?: number;
      verified?: number;
      rejected?: number;
      failed?: number;
    };
    failureReasons?: Record<string, number>;
    rejectionReasons?: Record<string, number>;
    failedDownloads?: Array<{
      segmentId: string;
      url: string;
      title: string;
      origin: string;
      reasonCode: string;
      detail: string;
    }>;
    visionDiagnostics?: {
      callsAttempted: number;
      callsSucceeded: number;
      callsFailed: number;
      providerErrors: string[];
    };
  };
  segmentMetrics?: Array<{
    segmentId: string;
    subject: string;
    queriesExecuted: number;
    candidatesFound: number;
    downloadsAttempted: number;
    downloadsSucceeded: number;
    approvedCount: number;
    rejectedCount: number;
  }>;
}

interface MediaCoveragePanelProps {
  coverage?: MediaCoverageReportView | null;
  relevanceDecisions?: MediaRelevanceDecisionView[];
  acquisitionAudit?: AcquisitionFunnelAuditView | null;
  plannedQueriesCount?: number;
  onPromptAction?: (promptText: string) => void;
}

export function MediaCoveragePanel({
  coverage,
  relevanceDecisions = [],
  acquisitionAudit,
  plannedQueriesCount = 0,
  onPromptAction,
}: MediaCoveragePanelProps) {
  const [expandedSegId, setExpandedSegId] = useState<string | null>(null);
  const rejected = relevanceDecisions.filter((d) => !d.accepted);

  if (!coverage && rejected.length === 0) {
    return (
      <section className="sg-panel rounded-2xl p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Film className="size-4 text-primary" />
          Cobertura de Mídia & Relevância
        </p>
        <p className="mt-1">Inicie ou retome uma produção para visualizar o mapa de cobertura por segmento e índice de repetição.</p>
      </section>
    );
  }

  return (
    <section className="sg-panel space-y-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Film className="size-4 text-primary" />
            Cobertura de Mídia & Relevância
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Gate obrigatório contra repetição e mídias incompatíveis com o roteiro.
          </p>
        </div>
        {coverage && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
              coverage.gatePassed
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            {coverage.gatePassed ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {coverage.gatePassed ? 'Cobertura aprovada' : 'Cobertura insuficiente'}
          </span>
        )}
      </div>

      {coverage && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[11px] text-muted-foreground">Ativos únicos</p>
            <p className="mt-1 text-lg font-semibold">{coverage.uniqueAssetCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[11px] text-muted-foreground">Duração útil</p>
            <p className="mt-1 text-lg font-semibold">
              {Math.round(coverage.usableMediaDurationSec)}s / {Math.round(coverage.totalExpectedDurationSec)}s
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[11px] text-muted-foreground">Cobertura</p>
            <p className="mt-1 text-lg font-semibold">{Math.round(coverage.coverageRatio * 100)}%</p>
          </div>
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="text-[11px] text-muted-foreground">Índice de repetição</p>
            <p className="mt-1 text-lg font-semibold">
              {coverage.uniqueAssetCount === 0
                ? 'N/A (0 ativos)'
                : `${Math.round(coverage.repetitionIndex * 100)}%`}
            </p>
          </div>
        </div>
      )}

      {acquisitionAudit && (
        <div className="space-y-2 rounded-xl border border-border bg-background/50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">Funil de Aquisição & Diagnóstico</p>
            {acquisitionAudit.stoppedReason && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                Parada: {acquisitionAudit.stoppedReason}
                {acquisitionAudit.elapsedMs !== undefined
                  ? ` (${Math.round(acquisitionAudit.elapsedMs / 1000)}s / ${Math.round((acquisitionAudit.totalDeadlineMs ?? 0) / 1000)}s)`
                  : ''}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Planejadas</span>
              <p className="font-semibold">{plannedQueriesCount || coverage?.segments.length || 0}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Executadas</span>
              <p className="font-semibold">{acquisitionAudit.queriesExecuted?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Encontrados</span>
              <p className="font-semibold">{acquisitionAudit.candidatesFoundCount ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Baixados</span>
              <p className="font-semibold">{acquisitionAudit.acquiredFilesCount ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Pendentes Visão</span>
              <p className="font-semibold">{acquisitionAudit.funnelMetrics?.counts?.pending_visual_verification ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-2">
              <span className="text-muted-foreground">Aprovados</span>
              <p className="font-semibold text-emerald-300">{acquisitionAudit.approvedForAssemblyCount ?? 0}</p>
            </div>
          </div>
          {acquisitionAudit.funnelMetrics?.visionDiagnostics && (
            <p className="text-[11px] text-muted-foreground">
              VisionRouter: {acquisitionAudit.funnelMetrics.visionDiagnostics.callsAttempted} tentativa(s),{' '}
              {acquisitionAudit.funnelMetrics.visionDiagnostics.callsSucceeded} sucesso(s),{' '}
              {acquisitionAudit.funnelMetrics.visionDiagnostics.callsFailed} falha(s)
              {acquisitionAudit.funnelMetrics.visionDiagnostics.callsAttempted === 0 &&
              (acquisitionAudit.acquiredFilesCount ?? 0) > 0
                ? ' — VisionRouter não executado antes da interrupção!'
                : ''}
            </p>
          )}
        </div>
      )}

      {rejected.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium text-destructive">Mídias rejeitadas pelo Media Relevance Gate ({rejected.length})</p>
          <ul className="space-y-1 text-muted-foreground">
            {rejected.map((r) => (
              <li key={r.mediaId}>
                • <code className="text-foreground">{r.mediaId}</code>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {coverage && coverage.uncoveredSubjects.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-300">Assuntos sem cobertura suficiente</p>
          <p className="mt-1 text-muted-foreground">{coverage.uncoveredSubjects.join(' · ')}</p>
        </div>
      )}

      {coverage && coverage.segments.length > 0 && (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {coverage.segments.map((seg) => {
            const segMetric = acquisitionAudit?.segmentMetrics?.find((m) => m.segmentId === seg.segmentId);
            const segFailures = (acquisitionAudit?.funnelMetrics?.failedDownloads ?? []).filter(
              (f) => f.segmentId === seg.segmentId,
            );
            const isExpanded = expandedSegId === seg.segmentId;
            const diagCause = (() => {
              if (seg.covered) return null;
              if (!segMetric || segMetric.candidatesFound === 0) return 'Nenhum resultado encontrado';
              if (segFailures.length > 0 && segMetric.downloadsSucceeded === 0) return 'Falha no download';
              if (segMetric.downloadsSucceeded > 0 && segMetric.approvedCount === 0 && segMetric.rejectedCount === 0) {
                return acquisitionAudit?.funnelMetrics?.visionDiagnostics?.callsAttempted === 0
                  ? 'VisionRouter indisponível / não executado'
                  : 'Intervalo insuficiente';
              }
              if (segMetric.rejectedCount > 0) return 'Mídia incompatível / Confiança insuficiente';
              return seg.usableDurationSec > 0 ? 'Intervalo insuficiente' : 'Erro de contabilização';
            })();
            return (
              <div key={seg.segmentId} className="rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedSegId(isExpanded ? null : seg.segmentId)}
                    className="flex min-w-0 items-center gap-1.5 text-left"
                  >
                    {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {seg.subject}
                        {seg.expectedEvent ? ` — ${seg.expectedEvent}` : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {seg.usableDurationSec}s / {seg.expectedDurationSec}s · {seg.sourceDiversityCount} fonte(s)
                        {diagCause ? ` · ${diagCause}` : ''}
                      </p>
                    </div>
                  </button>
                  {onPromptAction && !seg.covered && (
                    <button
                      type="button"
                      onClick={() => onPromptAction(`Pesquise mais cenas para este assunto: ${seg.subject}`)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/50 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10"
                    >
                      <Search className="size-3" />
                      Pesquisar mais cenas
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                    {seg.narrationExcerpt && <p>Roteiro: "{seg.narrationExcerpt}"</p>}
                    {segMetric && (
                      <p>
                        Consultas: {segMetric.queriesExecuted} · Candidatos: {segMetric.candidatesFound} · Downloads:{' '}
                        {segMetric.downloadsSucceeded}/{segMetric.downloadsAttempted} · Aprovados: {segMetric.approvedCount} · Rejeitados: {segMetric.rejectedCount}
                      </p>
                    )}
                    {segFailures.map((f, fIdx) => (
                      <p key={`${f.url}_${fIdx}`} className="text-rose-300">
                        [{f.reasonCode}] {f.title}: {f.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {onPromptAction && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => onPromptAction('Pesquise mais cenas para este assunto')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary"
          >
            <Sparkles className="size-3.5" />
            Pesquisar mais cenas para este assunto
          </button>
          <button
            type="button"
            onClick={() => onPromptAction('Substitua as cenas repetidas')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-foreground hover:border-primary"
          >
            <RefreshCw className="size-3.5" />
            Substituir cenas repetidas
          </button>
        </div>
      )}
    </section>
  );
}
