import { Check, Circle, CircleAlert, Clock3, LoaderCircle } from 'lucide-react';
import type { ProjectNextAction } from '@neuralbridge/shared';

const stages = [
  ['briefing', 'Briefing'], ['script', 'Roteiro'], ['production', 'Produção'], ['package', 'Pacote'], ['thumbnail', 'Thumbnail'], ['publication', 'Publicação'], ['analytics', 'Análise'],
] as const;

export function ContentPipeline({ action }: { action: ProjectNextAction }) {
  const active = stages.findIndex(([kind]) => kind === action.kind);
  return <><ol aria-label="Linha de produção" className="grid gap-2 sm:grid-cols-7">{stages.map(([kind, label], index) => {
    const done = index < active;
    const current = index === active;
    const Icon = done ? Check : current ? (action.kind === 'production' ? LoaderCircle : Clock3) : Circle;
    return <li key={kind} className={`rounded-xl border p-3 ${current ? 'border-primary bg-primary/10' : done ? 'border-primary/30' : 'border-border'}`}><Icon className={`size-4 ${done || current ? 'text-primary' : 'text-muted-foreground'} ${current && action.kind === 'production' ? 'animate-spin' : ''}`} aria-hidden="true" /><p className="mt-2 text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{done ? 'Concluído' : current ? action.label : 'Pendente'}</p></li>;
  })}</ol>{action.kind === 'production' && <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">Alterações de cena ainda exigem um novo render completo; a invalidação incremental será habilitada somente quando suas dependências puderem ser validadas com segurança.</p>}</>;
}

export function PipelineEmptyState() { return <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><CircleAlert className="size-4 text-warning" aria-hidden="true" />Este projeto ainda não possui uma execução de produção.</div>; }
