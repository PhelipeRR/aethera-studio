import * as React from 'react';
import { Check, Download, Loader2, Package, RotateCcw, ToggleLeft, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/app/PageHeader';
import { extensionDisplayName } from '@/app/extension-names';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/components/feedback/FeedbackState';

export function ExtensionsPage({ description }: { description: string }) {
  const client = useQueryClient();
  const [sourcePath, setSourcePath] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const extensions = useQuery({ queryKey: ['extensions'], queryFn: () => window.neuralbridge.extensions.list(), staleTime: 5_000 });
  const refresh = () => client.invalidateQueries({ queryKey: ['extensions'] });
  const action = useMutation({ mutationFn: async ({ kind, id, path }: { kind: 'install' | 'update' | 'enable' | 'disable' | 'rollback' | 'uninstall'; id?: string; path?: string }) => {
    if (kind === 'install') return window.neuralbridge.extensions.install(path ?? '');
    if (kind === 'update') return window.neuralbridge.extensions.update(path ?? '');
    if (kind === 'enable') return window.neuralbridge.extensions.enable(id ?? '');
    if (kind === 'disable') return window.neuralbridge.extensions.disable(id ?? '');
    if (kind === 'rollback') return window.neuralbridge.extensions.rollback(id ?? '');
    return window.neuralbridge.extensions.uninstall(id ?? '');
  }, onSuccess: () => { setMessage('Extensão atualizada.'); setSourcePath(''); refresh(); }, onError: (error) => setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar a extensão.') });
  const loading = extensions.isLoading;
  return <div className="mx-auto w-full max-w-5xl p-6 lg:p-8">
    <PageHeader title="Extensões" description={description} />
    <section className="mt-6 sg-panel rounded-xl p-5" aria-labelledby="extensions-install-title">
      <div className="flex items-start gap-3"><Package className="mt-0.5 size-5 text-primary" aria-hidden="true" /><div><h2 id="extensions-install-title" className="font-semibold">Adicionar uma extensão local</h2><p className="mt-1 text-sm text-muted-foreground">Informe a pasta que contém `extension.json`. O Core valida integridade e compatibilidade antes de ativar.</p></div></div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="extension-source-path">Pasta da extensão</label><input id="extension-source-path" value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="C:\\caminho\\para\\extensao" className="min-h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><button type="button" disabled={!sourcePath.trim() || action.isPending} onClick={() => action.mutate({ kind: 'install', path: sourcePath.trim() })} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"><Download className="size-4" aria-hidden="true" />Instalar</button></div>
      {message && <SuccessState className="mt-3" title={message} description="A lista será atualizada para refletir o novo estado da extensão." />}
    </section>
    <section className="mt-6" aria-labelledby="extensions-list-title"><div className="mb-3 flex items-center justify-between"><h2 id="extensions-list-title" className="font-semibold">Instaladas</h2>{loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando extensões" />}</div>
      {loading && <LoadingState title="Carregando extensões" description="O Core está consultando o registro local." />}
      {extensions.isError && <ErrorState title="Não foi possível carregar as extensões" description="O registro local não respondeu. Verifique se o banco de dados está disponível e tente novamente." action={{ label: 'Tentar novamente', onClick: () => void extensions.refetch() }} />}
      {!loading && !extensions.isError && !extensions.data?.length && <EmptyState title="Nenhuma extensão instalada" description="Void e Aethera aparecem aqui quando forem adicionadas ao Core. Use o formulário acima para instalar uma pasta local." />}
      <div className="grid gap-3 md:grid-cols-2">{extensions.data?.map((item) => <article key={item.manifest.id} className="sg-panel rounded-xl p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{extensionDisplayName(item.manifest)}</h3><p className="mt-1 text-xs text-muted-foreground">{item.manifest.id} · versão {item.manifest.version}</p></div><span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">{item.state === 'enabled' ? <Check className="size-3 text-primary" aria-hidden="true" /> : <ToggleLeft className="size-3" aria-hidden="true" />}{item.state === 'enabled' ? 'Ativa' : 'Desativada'}</span></div><p className="mt-3 text-xs text-muted-foreground">Permissões: {item.manifest.permissions.join(', ') || 'nenhuma'}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => action.mutate({ kind: item.state === 'enabled' ? 'disable' : 'enable', id: item.manifest.id })} className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">{item.state === 'enabled' ? 'Desabilitar' : 'Habilitar'}</button><button type="button" onClick={() => action.mutate({ kind: 'update', path: sourcePath.trim() })} disabled={!sourcePath.trim() || action.isPending} className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring">Atualizar da pasta</button><button type="button" onClick={() => action.mutate({ kind: 'rollback', id: item.manifest.id })} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><RotateCcw className="size-3" aria-hidden="true" />Rollback</button><button type="button" onClick={() => { if (window.confirm(`Desinstalar ${extensionDisplayName(item.manifest)}? Os dados do usuário não serão apagados.`)) action.mutate({ kind: 'uninstall', id: item.manifest.id }); }} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"><Trash2 className="size-3" aria-hidden="true" />Desinstalar</button></div></article>)}</div>
    </section>
  </div>;
}
