import { Check, ChevronRight, X } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';

type Step = { id: string; label: string; detail: string; href: string; done: boolean };

export function FirstSuccessPanel({ hasProject, hasAgent, hasTask }: { hasProject: boolean; hasAgent: boolean; hasTask: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const steps: Step[] = [
    { id: 'project', label: 'Escolha um projeto', detail: 'Defina onde os agentes podem trabalhar.', href: '/projects', done: hasProject },
    { id: 'agent', label: 'Verifique um agente', detail: 'Confirme que Claude ou Codex está disponível.', href: '/agents', done: hasAgent },
    { id: 'task', label: 'Envie a primeira tarefa', detail: 'Descreva o resultado que você quer no Chat.', href: '/chat', done: hasTask },
  ];
  const close = () => setDismissed(true);
  return <section aria-labelledby="first-success-title" className="rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Primeiro sucesso</p><h2 id="first-success-title" className="mt-1 text-lg font-semibold">Vamos colocar seu workspace para trabalhar</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">A sequência é local-first: você escolhe o projeto, confirma o agente e aprova qualquer ação que altere arquivos.</p></div><button type="button" aria-label="Fechar guia de primeiro sucesso" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={close}><X className="size-4" aria-hidden="true" /></button></div><ol className="mt-5 grid gap-2 md:grid-cols-3">{steps.map((step, index) => <li key={step.id}><Link to={step.href} className="group flex h-full items-start gap-3 sg-panel rounded-lg p-3 outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"><span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{step.done ? <Check className="size-4" aria-hidden="true" /> : index + 1}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-sm font-medium">{step.label}<ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span><span className="mt-1 block text-xs text-muted-foreground">{step.detail}</span><span className="sr-only">{step.done ? 'Concluído' : 'Pendente'}</span></span></Link></li>)}</ol></section>;
}
