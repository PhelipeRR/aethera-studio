import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Film,
  GitBranch,
  Link2,
  Search,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

export type EditorialAuditViewTab = 'pesquisa' | 'roteiro' | 'cenas' | 'rastreabilidade';

export interface AuditSourceView {
  sourceId: string;
  title: string;
  kind: 'official' | 'community' | 'agent_synthesis';
  url?: string;
  versionHash: string;
}

export interface AuditFactView {
  factId: string;
  sourceIds: string[];
  entityName: string;
  rankPosition?: number;
  factKind: string;
  statement: string;
  uncertainty?: string;
  versionHash: string;
}

export interface AuditScriptBlockView {
  blockId: string;
  segmentId: string;
  stage: string;
  title: string;
  narrationText: string;
  estimatedDurationSec: number;
  sourceFactIds: string[];
  sourceIds: string[];
  versionHash: string;
}

export interface AuditSceneView {
  sceneId: string;
  order: number;
  beatStage: string;
  narrationText: string;
  workTitle: string;
  entities: string[];
  expectedEvent: string;
  durationSec: number;
  visualIntent: string;
  mediaQueries: string[];
  matchingCriteria: {
    requiredEntities: string[];
    expectedActions: string[];
    minVisualConfidence: number;
  };
  audioDependencies: {
    sfxCues: string[];
    vfxEffects: string[];
    graphicsHints: string[];
  };
  scriptBlockId: string;
  factIds: string[];
  sourceIds: string[];
  dependencyHash: string;
}

export interface AuditMediaQueryView {
  queryId: string;
  sceneId: string;
  scriptBlockId: string;
  narrationExcerpt: string;
  queryText: string;
  reformulatedFromQueryId?: string;
  provider: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'success' | 'empty' | 'error' | 'timeout';
  errorMessage?: string;
  resultsCount: number;
  candidateIds: string[];
  isPlannedOnly: false;
}

export interface AuditCandidateView {
  candidateId: string;
  queryId: string;
  sceneId: string;
  title: string;
  url: string;
  localUri?: string;
  provider: string;
  durationSec?: number;
  status: 'approved' | 'rejected' | 'pending' | 'download_failed';
  rejectionReason?: string;
}

export interface AuditGroundingEvidenceView {
  evidenceId: string;
  candidateId: string;
  sceneId: string;
  scriptBlockId: string;
  expectedWork: string;
  expectedEvent: string;
  framesAnalyzed: Array<{
    timestampSec: number;
    framePath?: string;
    summary: string;
    matchedEntities: string[];
    matchedActions: string[];
    isPositive: boolean;
  }>;
  positiveEvidences: string[];
  negativeEvidences: string[];
  confidence: number;
  approvedIntervals: Array<{ startSec: number; endSec: number; reason: string }>;
  rejectedIntervals: Array<{ startSec: number; endSec: number; reason: string }>;
  decision: 'approved' | 'rejected' | 'needs_review';
  decisionReason: string;
  narrationRelation: string;
  humanReview: {
    status: 'pending' | 'approved' | 'rejected';
    reviewerNote?: string;
    reviewedAt?: string;
  };
}

export interface AuditPlacementView {
  placementId: string;
  sceneId: string;
  candidateId: string;
  evidenceId: string;
  clipId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  placementHash: string;
}

export interface EditorialAuditTrailView {
  version: number;
  projectId: string;
  sources: AuditSourceView[];
  facts: AuditFactView[];
  scriptBlocks: AuditScriptBlockView[];
  scenes: AuditSceneView[];
  queries: AuditMediaQueryView[];
  candidates: AuditCandidateView[];
  groundingEvidences: AuditGroundingEvidenceView[];
  timelinePlacements: AuditPlacementView[];
  events: Array<{
    eventId: string;
    timestamp: string;
    stage: string;
    sceneId?: string;
    message: string;
  }>;
  integrityReport?: {
    checkedAt: string;
    passed: boolean;
    errorCount: number;
    warningCount: number;
    issues: Array<{
      code: string;
      severity: 'error' | 'warning';
      sceneId?: string;
      message: string;
    }>;
  };
}

export interface EditorialDossierView {
  workTitle: string;
  theme: string;
  rankingCriteria: string[];
  uncertainties: string[];
  sourcesUsed: string[];
  providerUsed?: string;
  entities: Array<{
    entityName: string;
    role: string;
    rankPosition?: number;
    verifiedFacts: string[];
    mechanicsOrEvents: string[];
    communityConsensus?: string;
    uncertainties: string[];
  }>;
}

interface EditorialAuditPanelProps {
  projectId?: string | undefined;
  jobState?: string | undefined;
  dossier?: EditorialDossierView | null | undefined;
  trail?: EditorialAuditTrailView | null | undefined;
  onHumanReview?: ((candidateId: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>) | undefined;
}

function toFileSrc(localPath?: string): string | null {
  if (!localPath) return null;
  if (/^(https?|file):\/\//i.test(localPath)) return localPath;
  return `file:///${localPath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

export function EditorialAuditPanel({
  projectId,
  jobState,
  dossier,
  trail,
  onHumanReview,
}: EditorialAuditPanelProps) {
  const [view, setView] = useState<EditorialAuditViewTab>('rastreabilidade');
  const [selectedSceneId, setSelectedSceneId] = useState<string>('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const scenes = trail?.scenes ?? [];
  const activeScene = useMemo(
    () => scenes.find((s) => s.sceneId === selectedSceneId) ?? scenes[0] ?? null,
    [scenes, selectedSceneId],
  );

  const selectSceneAndGo = (sceneId: string, targetView: EditorialAuditViewTab) => {
    setSelectedSceneId(sceneId);
    setView(targetView);
  };

  if (!trail && !dossier) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 text-xs text-muted-foreground">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitBranch className="size-4 text-primary" />
          Auditoria Editorial & Rastreabilidade Audiovisual
        </p>
        <p className="mt-2">
          Inicie ou selecione uma produção para acompanhar em tempo real a pesquisa, roteiro, decupagem semântica,
          consultas executadas e decisões do Scene Grounding — inclusive quando a produção estiver bloqueada aguardando mídia.
        </p>
      </section>
    );
  }

  const integrity = trail?.integrityReport;

  return (
    <div className="space-y-4">
      {/* Header + Integrity Summary */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch className="size-4 text-primary" />
              Auditoria Editorial & Rastreabilidade Audiovisual
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Projeto: <span className="font-mono text-foreground">{projectId ?? trail?.projectId ?? '—'}</span> · Estado:{' '}
              <span className="font-medium text-foreground">{jobState ?? '—'}</span>
            </p>
          </div>
          {integrity && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                integrity.passed
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              {integrity.passed ? <CheckCircle2 className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
              Integridade: {integrity.errorCount} erro(s), {integrity.warningCount} alerta(s)
            </span>
          )}
        </div>

        {/* 4 Views Switcher */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { id: 'pesquisa', label: 'Pesquisa', icon: BookOpen },
              { id: 'roteiro', label: 'Roteiro', icon: FileText },
              { id: 'cenas', label: 'Cenas (Decupagem)', icon: Film },
              { id: 'rastreabilidade', label: 'Rastreabilidade & Grounding', icon: Search },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Scene Selector Bar for Cross-Navigation */}
        {scenes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-background/50 p-2.5 text-xs">
            <span className="text-[11px] font-medium text-muted-foreground">Cena selecionada:</span>
            <select
              value={activeScene?.sceneId ?? ''}
              onChange={(e) => setSelectedSceneId(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground"
            >
              {scenes.map((sc) => (
                <option key={sc.sceneId} value={sc.sceneId}>
                  #{sc.order} {sc.entities[0] ?? sc.beatStage} ({sc.durationSec}s)
                </option>
              ))}
            </select>
            {activeScene && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setView('pesquisa')}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Ver Pesquisa
                </button>
                <button
                  type="button"
                  onClick={() => setView('roteiro')}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Ver Roteiro
                </button>
                <button
                  type="button"
                  onClick={() => setView('cenas')}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Ver Cena
                </button>
                <button
                  type="button"
                  onClick={() => setView('rastreabilidade')}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Ver Rastreabilidade
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Integrity Issues */}
      {integrity && integrity.issues.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-200">
            <AlertTriangle className="size-4" />
            Verificações Automáticas de Integridade Editorial ({integrity.issues.length})
          </p>
          <ul className="mt-2 space-y-1">
            {integrity.issues.map((issue, idx) => (
              <li key={`${issue.code}_${idx}`} className="flex items-start justify-between gap-2 text-[11px]">
                <span className={issue.severity === 'error' ? 'text-rose-300' : 'text-amber-200/90'}>
                  [{issue.code}] {issue.message}
                </span>
                {issue.sceneId && (
                  <button
                    type="button"
                    onClick={() => selectSceneAndGo(issue.sceneId!, 'rastreabilidade')}
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-background"
                  >
                    Ir para cena
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* VIEW 1: PESQUISA */}
      {view === 'pesquisa' && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Dossiê Factual: {dossier?.workTitle ?? '—'}
              </h3>
              <p className="text-muted-foreground">{dossier?.theme}</p>
            </div>
            {dossier?.providerUsed && (
              <span className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                Provedor: {dossier.providerUsed}
              </span>
            )}
          </div>

          {dossier?.rankingCriteria && dossier.rankingCriteria.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <p className="font-medium text-foreground">Critérios de Ranking</p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {dossier.rankingCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {(dossier?.entities ?? []).map((ent) => {
              const linkedScene = scenes.find((s) => s.entities.includes(ent.entityName));
              const isHighlighted = activeScene?.entities.includes(ent.entityName);
              return (
                <div
                  key={ent.entityName}
                  className={`rounded-xl border p-3 ${
                    isHighlighted ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">
                      {ent.rankPosition ? `#${ent.rankPosition} ` : ''}
                      {ent.entityName}
                    </p>
                    {linkedScene && (
                      <button
                        type="button"
                        onClick={() => selectSceneAndGo(linkedScene.sceneId, 'rastreabilidade')}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                      >
                        Cena #{linkedScene.order}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Mecânicas: {ent.mechanicsOrEvents.join('; ') || '—'}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Fatos: {ent.verifiedFacts.join('; ') || '—'}
                  </p>
                  {ent.uncertainties.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-300">Incertezas: {ent.uncertainties.join('; ')}</p>
                  )}
                </div>
              );
            })}
          </div>

          {trail && trail.sources.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <p className="font-medium text-foreground">Fontes Rastreadas ({trail.sources.length})</p>
              <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                {trail.sources.map((src) => (
                  <li key={src.sourceId}>
                    <span className="font-mono text-foreground">{src.sourceId}</span> · [{src.kind}] {src.title}
                    {src.url ? ` (${src.url})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* VIEW 2: ROTEIRO */}
      {view === 'roteiro' && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 text-xs">
          <h3 className="text-sm font-semibold text-foreground">
            Roteiro Completo & Referências ({trail?.scriptBlocks.length ?? 0} blocos)
          </h3>
          {(trail?.scriptBlocks ?? []).map((blk, idx) => {
            const linkedScene = scenes.find((s) => s.scriptBlockId === blk.blockId);
            const isSelected = activeScene?.scriptBlockId === blk.blockId;
            return (
              <div
                key={blk.blockId}
                className={`rounded-xl border p-3 ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    {idx + 1}. {blk.title} ({blk.stage}) · {blk.estimatedDurationSec}s
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {blk.sourceFactIds.length} fato(s) · {blk.sourceIds.length} fonte(s)
                    </span>
                    {linkedScene && (
                      <button
                        type="button"
                        onClick={() => selectSceneAndGo(linkedScene.sceneId, 'rastreabilidade')}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                      >
                        Auditar mídia
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 text-foreground/90">{blk.narrationText}</p>
              </div>
            );
          })}
        </section>
      )}

      {/* VIEW 3: CENAS */}
      {view === 'cenas' && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 text-xs">
          <h3 className="text-sm font-semibold text-foreground">
            Decupagem Semântica ({scenes.length} cenas)
          </h3>
          {scenes.map((sc) => {
            const isSelected = activeScene?.sceneId === sc.sceneId;
            return (
              <div
                key={sc.sceneId}
                className={`rounded-xl border p-3 ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    Cena #{sc.order} · {sc.entities.join(', ') || sc.beatStage} · {sc.durationSec}s
                  </p>
                  <button
                    type="button"
                    onClick={() => selectSceneAndGo(sc.sceneId, 'rastreabilidade')}
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                  >
                    Ver consultas & grounding
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Evento esperado: <span className="text-foreground">{sc.expectedEvent}</span> · Intenção:{' '}
                  <span className="font-mono">{sc.visualIntent}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Consultas planejadas: <span className="text-foreground">{sc.mediaQueries.join(' | ')}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Áudio/VFX: SFX [{sc.audioDependencies.sfxCues.join(', ')}] · VFX [
                  {sc.audioDependencies.vfxEffects.join(', ')}]
                </p>
              </div>
            );
          })}
        </section>
      )}

      {/* VIEW 4: RASTREABILIDADE & SCENE GROUNDING */}
      {view === 'rastreabilidade' && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 text-xs">
          {activeScene && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <Link2 className="size-3.5 text-primary" />
                Cadeia da Cena #{activeScene.order}: {activeScene.entities.join(', ') || activeScene.beatStage}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Fontes({activeScene.sourceIds.length}) → Fatos({activeScene.factIds.length}) → Bloco(
                {activeScene.scriptBlockId}) → Cena({activeScene.sceneId})
              </p>
              <p className="mt-1 text-[11px] text-foreground/90">Narração: "{activeScene.narrationText}"</p>
            </div>
          )}

          {/* Executed Queries */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Consultas Realmente Executadas (
              {(trail?.queries ?? []).filter((q) => !activeScene || q.sceneId === activeScene.sceneId).length})
            </h4>
            {(trail?.queries ?? [])
              .filter((q) => !activeScene || q.sceneId === activeScene.sceneId)
              .map((q) => (
                <div key={q.queryId} className="rounded-xl border border-border/70 bg-background/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">"{q.queryText}"</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                        q.status === 'success'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      {q.provider} · tentativa #{q.attemptNumber} · {q.status} ({q.resultsCount} resultados)
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Clock className="size-3" />
                    {q.startedAt} {q.durationMs !== undefined ? `· ${q.durationMs}ms` : ''}
                    {q.reformulatedFromQueryId ? ` · reformulação de ${q.reformulatedFromQueryId}` : ''}
                  </p>
                  {q.errorMessage && <p className="mt-1 text-[11px] text-rose-300">Erro: {q.errorMessage}</p>}
                </div>
              ))}
          </div>

          {/* Grounding Evidences + Frames + Video Preview + Human Review */}
          <div className="space-y-3">
            <h4 className="font-semibold text-foreground">
              Auditoria do Scene Grounding & Revisão Humana (
              {(trail?.groundingEvidences ?? []).filter((g) => !activeScene || g.sceneId === activeScene.sceneId).length}
              )
            </h4>
            {(trail?.groundingEvidences ?? [])
              .filter((g) => !activeScene || g.sceneId === activeScene.sceneId)
              .map((ev) => {
                const cand = (trail?.candidates ?? []).find((c) => c.candidateId === ev.candidateId);
                const videoSrc = toFileSrc(cand?.localUri);
                return (
                  <div key={ev.evidenceId} className="space-y-2 rounded-xl border border-border/70 bg-background/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{cand?.title ?? ev.candidateId}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Obra/Evento esperado: {ev.expectedWork} — {ev.expectedEvent}
                        </p>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          ev.decision === 'approved'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {ev.decision} · confiança {(ev.confidence * 100).toFixed(0)}%
                      </span>
                    </div>

                    <p className="text-[11px] text-foreground/90">Motivo: {ev.decisionReason}</p>
                    {ev.approvedIntervals.length > 0 && (
                      <p className="text-[11px] text-emerald-300">
                        Intervalos aprovados:{' '}
                        {ev.approvedIntervals.map((i) => `${i.startSec.toFixed(1)}s–${i.endSec.toFixed(1)}s`).join(', ')}
                      </p>
                    )}
                    {ev.rejectedIntervals.length > 0 && (
                      <p className="text-[11px] text-rose-300">
                        Intervalos rejeitados:{' '}
                        {ev.rejectedIntervals.map((i) => `${i.startSec.toFixed(1)}s–${i.endSec.toFixed(1)}s`).join(', ')}
                      </p>
                    )}

                    {/* Frames Analyzed */}
                    {ev.framesAnalyzed.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        {ev.framesAnalyzed.slice(0, 6).map((fr, fIdx) => {
                          const imgSrc = toFileSrc(fr.framePath);
                          return (
                            <div key={`${ev.evidenceId}_f_${fIdx}`} className="rounded-lg border border-border p-2">
                              {imgSrc && (
                                <img
                                  src={imgSrc}
                                  alt={`Frame ${fr.timestampSec}s`}
                                  className="mb-1.5 h-24 w-full rounded object-cover"
                                />
                              )}
                              <p className="font-mono text-[10px] text-muted-foreground">{fr.timestampSec.toFixed(1)}s</p>
                              <p className="text-[10px] text-foreground/90">{fr.summary}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Local Video Playback when file is available */}
                    {videoSrc && /\.(mp4|mov|webm|mkv)$/i.test(videoSrc) && (
                      <video
                        src={videoSrc}
                        controls
                        className="max-h-48 w-full rounded-lg border border-border bg-black"
                      />
                    )}

                    {/* Human Review Controls */}
                    {onHumanReview && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                        <span className="text-[10px] text-muted-foreground">
                          Revisão humana: {ev.humanReview.status}
                          {ev.humanReview.reviewerNote ? ` (${ev.humanReview.reviewerNote})` : ''}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={reviewingId === ev.candidateId}
                            onClick={async () => {
                              setReviewingId(ev.candidateId);
                              try {
                                await onHumanReview(ev.candidateId, 'approved', 'Aprovado manualmente na auditoria');
                              } finally {
                                setReviewingId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
                          >
                            <ThumbsUp className="size-3" /> Aprovar
                          </button>
                          <button
                            type="button"
                            disabled={reviewingId === ev.candidateId}
                            onClick={async () => {
                              setReviewingId(ev.candidateId);
                              try {
                                await onHumanReview(ev.candidateId, 'rejected', 'Rejeitado manualmente na auditoria');
                              } finally {
                                setReviewingId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/20"
                          >
                            <ThumbsDown className="size-3" /> Rejeitar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
