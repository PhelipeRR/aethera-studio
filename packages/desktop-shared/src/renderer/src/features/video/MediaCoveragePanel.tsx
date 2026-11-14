import { AlertTriangle, CheckCircle2, Film, RefreshCw, Search, Sparkles } from 'lucide-react';

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

interface MediaCoveragePanelProps {
  coverage?: MediaCoverageReportView | null;
  relevanceDecisions?: MediaRelevanceDecisionView[];
  onPromptAction?: (promptText: string) => void;
}

export function MediaCoveragePanel({
  coverage,
  relevanceDecisions = [],
  onPromptAction,
}: MediaCoveragePanelProps) {
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
            <p className="mt-1 text-lg font-semibold">{Math.round(coverage.repetitionIndex * 100)}%</p>
          </div>
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
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {coverage.segments.map((seg) => (
            <div key={seg.segmentId} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">{seg.subject}</p>
                <p className="text-[11px] text-muted-foreground">
                  {seg.usableDurationSec}s / {seg.expectedDurationSec}s · {seg.sourceDiversityCount} fonte(s)
                </p>
              </div>
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
          ))}
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
