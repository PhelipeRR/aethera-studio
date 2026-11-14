import { Bell, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../app/PageHeader';

export function PersonalAgentPage({ description }: { description: string }) {
  const accounts = useQuery({ queryKey: ['personal-accounts'], queryFn: () => window.neuralbridge.personal.accounts(), staleTime: 5_000 });
  const notifications = useQuery({ queryKey: ['personal-notifications'], queryFn: () => window.neuralbridge.personal.notifications(), staleTime: 2_000 });
  const connectGoogle = async () => { await window.neuralbridge.personal.importGoogleClient(); await window.neuralbridge.personal.connectGoogle(); await accounts.refetch(); };
  const readNotification = async (id: string) => { await window.neuralbridge.personal.readNotification(id); await notifications.refetch(); };
  return <div className="mx-auto w-full max-w-6xl p-6 lg:p-8">
    <PageHeader title="Void Pessoal" description={description} />
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <section className="sg-panel rounded-xl p-5" aria-labelledby="personal-integrations-title">
        <div className="flex items-center gap-3"><Sparkles className="size-5 text-primary" aria-hidden="true" /><h2 id="personal-integrations-title" className="font-semibold">Integrações</h2></div>
        <p className="mt-3 text-sm text-muted-foreground">Conecte Gmail e Google Agenda para consultar dados pessoais. O padrão começa somente com leitura.</p>
        <button type="button" onClick={() => void connectGoogle()} disabled={accounts.isFetching} className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{accounts.isFetching ? 'Conectando…' : 'Importar cliente e conectar Google'}</button>
        <div className="mt-4 space-y-2">{accounts.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar as contas.</p> : accounts.data?.map((account) => <div key={account.accountId} className="flex items-center justify-between rounded-md border border-border p-3 text-sm"><span>{account.identifier} · {account.provider}</span><button type="button" onClick={() => void window.neuralbridge.personal.disconnect(account.accountId).then(() => void accounts.refetch())} className="rounded px-2 py-1 text-destructive focus-visible:ring-2 focus-visible:ring-ring">Desconectar</button></div>)}{!accounts.isLoading && !accounts.isError && !accounts.data?.length && <span className="text-sm text-muted-foreground">Nenhuma conta conectada</span>}</div>
      </section>
      <section className="sg-panel rounded-xl p-5" aria-labelledby="personal-notifications-title">
        <div className="flex items-center gap-3"><Bell className="size-5 text-primary" aria-hidden="true" /><h2 id="personal-notifications-title" className="font-semibold">Notificações</h2></div>
        <p className="mt-3 text-sm text-muted-foreground">Alertas persistidos localmente, sem armazenar o corpo das mensagens.</p>
        <div className="mt-4 space-y-2">{notifications.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar as notificações.</p> : notifications.data?.map((item) => <div key={item.id} className={`flex items-start justify-between gap-3 rounded-md border p-3 text-sm ${item.readAt ? 'border-border opacity-60' : 'border-primary/50'}`}><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p></div>{!item.readAt && <button type="button" aria-label={`Marcar ${item.title} como lida`} onClick={() => void readNotification(item.id)} className="rounded p-2 text-primary focus-visible:ring-2 focus-visible:ring-ring"><Check className="size-4" aria-hidden="true" /></button>}</div>)}{!notifications.isLoading && !notifications.isError && !notifications.data?.length && <span className="text-sm text-muted-foreground">Nenhuma notificação pendente</span>}</div>
      </section>
      <section className="sg-panel rounded-xl p-5 md:col-span-2" aria-labelledby="personal-privacy-title">
        <div className="flex items-center gap-3"><ShieldCheck className="size-5 text-primary" aria-hidden="true" /><h2 id="personal-privacy-title" className="font-semibold">Privacidade</h2></div>
        <p className="mt-3 text-sm text-muted-foreground">Tokens ficam cifrados no desktop. Corpos de mensagens não são persistidos e ações de envio exigem confirmação individual.</p>
        <span className="mt-4 inline-flex rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">Cofre local protegido pelo sistema operacional</span>
      </section>
    </div>
  </div>;
}
