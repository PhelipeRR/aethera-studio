import React from 'react';
import type {
  ContractConflict,
  ContractRequirement,
  ContractRequirementStatus,
  ContractComplianceReport,
  ProductionContract,
} from '@neuralbridge/cinema/browser';

interface ProductionContractCompliancePanelProps {
  contract?: ProductionContract | null;
  compliance?: ContractComplianceReport | null;
  conflicts?: ContractConflict[];
}

const STATUS_LABELS: Record<ContractRequirementStatus, string> = {
  extracted: 'Extraído',
  in_progress: 'Em andamento',
  satisfied: 'Atendido',
  adapted: 'Adaptado',
  pending: 'Pendente',
  needs_human_review: 'Revisão humana',
  not_met: 'Não atendido',
  blocked: 'Bloqueado',
};

function statusClass(status: ContractRequirementStatus): string {
  if (status === 'satisfied' || status === 'adapted') return 'text-emerald-300';
  if (status === 'not_met' || status === 'blocked') return 'text-rose-300';
  if (status === 'needs_human_review' || status === 'pending') return 'text-amber-300';
  return 'text-muted-foreground';
}

function RequirementRow({ requirement }: { requirement: ContractRequirement }) {
  return (
    <li className="rounded-lg border border-border/70 bg-background/40 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2 text-[11px]">
        <span className="font-medium text-foreground">{requirement.label}</span>
        <span className={`font-semibold ${statusClass(requirement.status)}`}>
          {STATUS_LABELS[requirement.status]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>{requirement.priority === 'mandatory' ? 'Obrigatório' : 'Preferência'}</span>
        <span>{requirement.category}</span>
        <span>{requirement.evidence.length} evidência(s)</span>
      </div>
      {requirement.justification && (
        <p className="mt-1 text-[10px] text-amber-200/80">Justificativa: {requirement.justification}</p>
      )}
    </li>
  );
}

export function ProductionContractCompliancePanel({
  contract,
  compliance,
  conflicts = [],
}: ProductionContractCompliancePanelProps) {
  if (!contract) return null;
  const requirements = [...contract.requirements].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'mandatory' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return (
    <section
      aria-label="Conformidade do contrato de produção"
      className="rounded-2xl border border-border bg-card p-5 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conformidade do contrato</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Revisão {contract.revision} · {contract.contractId} · requisitos preservados do briefing
          </p>
        </div>
        {compliance && (
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
              compliance.blocking
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : compliance.humanReviewCount > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {compliance.blocking ? 'Bloqueado por não conformidade' : compliance.humanReviewCount > 0 ? 'Aguardando revisão humana' : 'Sem bloqueio objetivo'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
        <div className="rounded-lg border border-border/70 bg-background/40 p-2"><span className="text-muted-foreground">Atendidos</span><div className="mt-0.5 font-semibold text-emerald-300">{compliance?.satisfiedCount ?? requirements.filter((r) => r.status === 'satisfied').length}</div></div>
        <div className="rounded-lg border border-border/70 bg-background/40 p-2"><span className="text-muted-foreground">Pendentes</span><div className="mt-0.5 font-semibold text-amber-300">{compliance?.pendingCount ?? requirements.filter((r) => ['pending', 'in_progress', 'extracted'].includes(r.status)).length}</div></div>
        <div className="rounded-lg border border-border/70 bg-background/40 p-2"><span className="text-muted-foreground">Revisão humana</span><div className="mt-0.5 font-semibold text-amber-300">{compliance?.humanReviewCount ?? requirements.filter((r) => r.status === 'needs_human_review').length}</div></div>
        <div className="rounded-lg border border-border/70 bg-background/40 p-2"><span className="text-muted-foreground">Não atendidos</span><div className="mt-0.5 font-semibold text-rose-300">{compliance?.notMetCount ?? requirements.filter((r) => ['not_met', 'blocked'].includes(r.status)).length}</div></div>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-[11px] text-amber-100">
          <div className="font-semibold">Conflitos de briefing e controles manuais</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {conflicts.map((conflict) => <li key={conflict.id}>{conflict.message} A escolha manual permanece registrada.</li>)}
          </ul>
        </div>
      )}

      {compliance && compliance.issues.length > 0 && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-3 text-[11px] text-rose-100">
          <div className="font-semibold">Evidências que exigem atenção</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {compliance.issues.map((issue) => <li key={issue.criterionId}>{issue.message}</li>)}
          </ul>
        </div>
      )}

      <ul className="max-h-72 space-y-1.5 overflow-auto pr-1">
        {requirements.map((requirement) => <RequirementRow key={requirement.id} requirement={requirement} />)}
      </ul>
    </section>
  );
}

