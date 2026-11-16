import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Plus, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  FORMAT_LABELS,
  TrendRadarPanel,
  formatBriefingToProductionPrompt,
  type AppliedTrendIdeaPayload,
  type TrendIdea,
  type TrendRadarBridgeApi,
  type TrendSearchSession,
} from '../TrendRadarPanel';

interface HistoryIdea {
  idea: TrendIdea;
  session: TrendSearchSession;
}

/** Ideas from the real search history (newest session first), one entry per idea id. */
function historyIdeasOf(sessions: readonly TrendSearchSession[]): HistoryIdea[] {
  const seen = new Set<string>();
  const out: HistoryIdea[] = [];
  for (const session of sessions) {
    for (const idea of session.ideas) {
      if (seen.has(idea.ideaId)) continue;
      seen.add(idea.ideaId);
      out.push({ idea, session });
    }
  }
  return out;
}

interface IdeasColumnProps {
  api: TrendRadarBridgeApi;
  onApplyIdea: (payload: AppliedTrendIdeaPayload, ideaTitle: string) => void;
}

/**
 * Compact column of researched ideas next to the briefing. The list scrolls on its own; new searches open the full
 * Trend Radar in a dialog. Everything comes from the radar's own services and history: nothing is invented here.
 */
export function IdeasColumn({ api, onApplyIdea }: IdeasColumnProps) {
  const [sessions, setSessions] = useState<TrendSearchSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const available = Boolean(api.trendRadarListSessions);

  const reload = useCallback(async () => {
    if (!api.trendRadarListSessions) return;
    setLoading(true);
    try {
      setSessions(await api.trendRadarListSessions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function applyHistoryIdea({ idea, session }: HistoryIdea) {
    setApplyingId(idea.ideaId);
    setError(null);
    try {
      let briefing = session.briefings[idea.ideaId];
      if (!briefing) {
        if (!api.trendRadarGenerateBriefing) throw new Error('Geração de briefing indisponível neste contexto.');
        briefing = await api.trendRadarGenerateBriefing({ sessionId: session.sessionId, ideaId: idea.ideaId });
      }
      onApplyIdea(
        {
          promptText: formatBriefingToProductionPrompt(idea, briefing),
          genre: briefing.recommendedGenre,
          format: briefing.recommendedFormat,
          durationMin: briefing.recommendedDurationMin || idea.suggestedDurationMin || 10,
          humorIntensity: briefing.recommendedHumorIntensity ?? 35,
        },
        idea.title,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }

  const ideas = historyIdeasOf(sessions);

  return (
    <section aria-labelledby="cinema-ideas-title" className="flex min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="cinema-ideas-title" className="text-base font-semibold tracking-tight text-foreground">
          Ideias pesquisadas
        </h2>
        <span className="text-xs text-muted-foreground">Histórico</span>
      </div>
      <p className="text-xs text-muted-foreground">Resultados salvos das pesquisas anteriores. Usar uma ideia só preenche o briefing.</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <div className="max-h-[420px] min-h-0 overflow-y-auto pr-1" aria-busy={loading}>
        {loading && ideas.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> Carregando histórico...
          </p>
        ) : ideas.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {available ? 'Nenhuma pesquisa salva ainda.' : 'Histórico de pesquisas indisponível neste contexto.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {ideas.map((entry) => (
              <li key={entry.idea.ideaId} className="flex flex-col gap-1.5 py-3 first:pt-0">
                <span className="text-sm font-medium text-foreground">{entry.idea.title}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.idea.niche} · {FORMAT_LABELS[entry.idea.format] ?? entry.idea.format}
                  {entry.idea.suggestedDurationMin ? ` · ${entry.idea.suggestedDurationMin} min` : ''}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="-ml-3 w-fit"
                  disabled={applyingId !== null}
                  onClick={() => void applyHistoryIdea(entry)}
                >
                  {applyingId === entry.idea.ideaId ? (
                    <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                  ) : (
                    <Sparkles aria-hidden />
                  )}
                  Usar ideia
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button type="button" variant="secondary" onClick={() => setDialogOpen(true)} disabled={!available}>
        <Plus aria-hidden /> Pesquisar novas ideias
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) void reload();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Pesquisar novas ideias</DialogTitle>
            <DialogDescription>
              Radar de tendências com fontes reais. As ideias encontradas ficam salvas no histórico ao lado do briefing.
            </DialogDescription>
          </DialogHeader>
          <TrendRadarPanel
            api={api}
            defaultExpanded
            onApplyIdea={(payload) => {
              onApplyIdea(payload, payload.promptText.split('\n')[0]?.replace(/^Título:\s*/, '') ?? 'ideia do radar');
              setDialogOpen(false);
              void reload();
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
