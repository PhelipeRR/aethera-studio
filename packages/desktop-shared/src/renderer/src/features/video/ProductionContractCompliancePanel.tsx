import React from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import type {
  ContractConflict,
  ContractRequirement,
  ContractRequirementStatus,
  ContractComplianceReport,
  ProductionContract,
} from '@neuralbridge/cinema/browser';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
  if (status === 'satisfied' || status === 'adapted') return 'text-success';
  if (status === 'not_met' || status === 'blocked') return 'text-destructive';
  if (status === 'needs_human_review' || status === 'pending') return 'text-warning';
  return 'text-muted-foreground';
}

function RequirementRow({ requirement, first }: { requirement: ContractRequirement; first: boolean }) {
  return (
    <li className="flex flex-col">
      {!first && <Separator className="opacity-60" />}
      <div className="flex flex-col gap-1 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">{requirement.label}</span>
          <span className={cn('font-medium', statusClass(requirement.status))}>{STATUS_LABELS[requirement.status]}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{requirement.priority === 'mandatory' ? 'Obrigatório' : 'Preferência'}</span>
          <span>{requirement.category}</span>
          <span>{requirement.evidence.length} evidência(s)</span>
        </div>
        {requirement.justification && (
          <p className="text-[11px] text-warning/90">Justificativa: {requirement.justification}</p>
        )}
      </div>
    </li>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-light tabular-nums', value > 0 ? tone : 'text-foreground/70')}>{value}</dd>
    </div>
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
    <section aria-label="Conformidade do contrato de produção" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Conformidade do contrato</h2>
          <p className="text-xs text-muted-foreground">
            Revisão {contract.revision} · <span className="font-mono">{contract.contractId}</span> · requisitos preservados do briefing
          </p>
        </div>
        {compliance && (
          <Badge variant={compliance.blocking ? 'destructive' : compliance.humanReviewCount > 0 ? 'warning' : 'success'}>
            {compliance.blocking ? 'Bloqueado por não conformidade' : compliance.humanReviewCount > 0 ? 'Aguardando revisão humana' : 'Sem bloqueio objetivo'}
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Count label="Atendidos" tone="text-success" value={compliance?.satisfiedCount ?? requirements.filter((r) => r.status === 'satisfied').length} />
        <Count
          label="Pendentes"
          tone="text-warning"
          value={compliance?.pendingCount ?? requirements.filter((r) => ['pending', 'in_progress', 'extracted'].includes(r.status)).length}
        />
        <Count
          label="Revisão humana"
          tone="text-warning"
          value={compliance?.humanReviewCount ?? requirements.filter((r) => r.status === 'needs_human_review').length}
        />
        <Count
          label="Não atendidos"
          tone="text-destructive"
          value={compliance?.notMetCount ?? requirements.filter((r) => ['not_met', 'blocked'].includes(r.status)).length}
        />
      </dl>

      {conflicts.length > 0 && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>Conflitos de briefing e controles manuais</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 text-xs">
              {conflicts.map((conflict) => <li key={conflict.id}>{conflict.message} A escolha manual permanece registrada.</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {compliance && compliance.issues.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Evidências que exigem atenção</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 text-xs">
              {compliance.issues.map((issue) => <li key={issue.criterionId}>{issue.message}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <ul aria-label="Requisitos do contrato" className="max-h-72 overflow-auto pr-1">
        {requirements.map((requirement, index) => (
          <RequirementRow key={requirement.id} requirement={requirement} first={index === 0} />
        ))}
      </ul>
    </section>
  );
}
