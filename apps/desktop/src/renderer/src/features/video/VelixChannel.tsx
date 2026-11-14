import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { VirtualList } from '@/components/performance/VirtualList';
import { errorMessage } from '@/features/brain/format';
import { ChannelIdentity } from './ChannelIdentity';
import { ChannelThumbnail } from './ChannelThumbnail';
import type { BrandIdentity } from '@neuralbridge/shared/velix-channel';
import { ProgressBar } from './ProgressBar';
import { scorePublication, suggestLocalTimes } from '@neuralbridge/shared/velix-optimizer';

const INPUT = 'mt-1 w-full rounded border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const TABS = [['publicar', 'Publicar vídeo'], ['calendario', 'Calendário'], ['identidade', 'Identidade visual'], ['configuracao', 'Configuração']] as const;
type Tab = (typeof TABS)[number][0];
const JOB_LABEL: Record<string, string> = { queued: 'Na fila', uploading: 'Enviando', completed: 'Enviado', failed: 'Falhou', cancelled: 'Cancelado', paused: 'Pausado' };
const STATE_LABEL: Record<string, string> = { scheduled: 'agendado', published: 'publicado', planned: 'planejado', cancelled: 'cancelado', uploaded: 'enviado', uploading: 'enviando', failed: 'falhou', draft: 'rascunho', awaiting_approval: 'aguardando aprovação' };
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

type Status = { configured: boolean; connected: boolean; canWrite: boolean; persistent: boolean; clientId: string | null } | undefined;

function NeedsConnection({ status, write, onOpen }: { status: Status; write: boolean; onOpen: () => void }) {
  if (status?.connected && (!write || status.canWrite)) return null;
  return <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-3 text-sm"><span>{status?.connected ? 'Para enviar ou reagendar, autorize o envio e a edição do canal.' : 'Conecte o seu canal YouTube para usar esta área.'}</span><Button size="sm" variant="outline" onClick={onOpen}>Abrir Configuração</Button></div>;
}

function PublishTab({ projectId, status, identity, onOpenSettings, onOpenIdentity, onPublished }: { projectId: string; status: Status; identity: BrandIdentity | null | undefined; onOpenSettings: () => void; onOpenIdentity: () => void; onPublished: () => void }) {
  const videos = useQuery({ queryKey: ['velix-channel-videos', projectId], queryFn: () => window.neuralbridge.video.channelVideos(projectId) });
  const [selected, setSelected] = useState('');
  const preview = useQuery({ queryKey: ['velix-channel-video-preview', projectId, selected], queryFn: () => window.neuralbridge.video.channelVideoPreview({ projectId, relativePath: selected }), enabled: !!selected, retry: false, staleTime: Infinity });
  const saveVideo = useMutation({ mutationFn: () => window.neuralbridge.video.saveProjectFile({ projectId, relativePath: selected }) });
  const [thumbnailPath, setThumbnailPath] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [keyword, setKeyword] = useState('');
  const [niche, setNiche] = useState('');
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [publishAt, setPublishAt] = useState('');
  const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  const publish = useMutation({ mutationFn: () => window.neuralbridge.video.channelPublishStart({ projectId, outputRelativePath: selected, ...(thumbnailPath.trim() ? { thumbnailRelativePath: thumbnailPath.trim() } : {}), title: title.trim(), description, tags: tagList, privacy, publishAt: publishAt ? new Date(publishAt).toISOString() : null, confirmed: true }) });
  const job = useQuery({ queryKey: ['velix-channel-publish-status', publish.data?.id], queryFn: () => window.neuralbridge.video.channelPublishStatus(publish.data?.id ?? ''), enabled: !!publish.data?.id, refetchInterval: (query) => ['completed', 'failed', 'cancelled', 'paused'].includes(query.state.data?.status ?? '') ? false : 500 });
  const finished = job.data?.status === 'completed';
  useEffect(() => { if (finished) onPublished(); }, [finished, onPublished]);
  const reference = useMutation({ mutationFn: () => window.neuralbridge.video.channelNicheReference({ projectId, query: niche.trim() }) });
  const optimize = useMutation({ mutationFn: () => window.neuralbridge.video.channelOptimize({ projectId, query: niche.trim(), referenceTitles: reference.data?.titles ?? [], agent: 'claude' }) });
  const notes = scorePublication({ title, description, tags: tagList, keyword });
  const times = suggestLocalTimes(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const running = publish.isPending || job.data?.status === 'uploading' || job.data?.status === 'queued';

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div role="region" aria-label="Vídeos do Aethera" className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Vídeos do Aethera</h3><Button size="sm" variant="ghost" onClick={() => void videos.refetch()}>Atualizar</Button></div>
        {videos.isFetching && <ProgressBar label="Procurando vídeos no projeto" />}
        {videos.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(videos.error)}</p>}
        {videos.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum MP4 no projeto ainda. Renderize um vídeo no Motion, no Estúdio ou no Render direto.</p>}
        {videos.data && videos.data.length > 0 && <VirtualList items={videos.data} itemHeight={54} ariaLabel="Vídeos disponíveis" renderItem={(video) => <button type="button" aria-pressed={selected === video.relativePath} aria-label={`Selecionar ${video.relativePath}`} className={`h-[3.375rem] w-full rounded border px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === video.relativePath ? 'border-primary bg-primary/10' : ''}`} onClick={() => setSelected(video.relativePath)}><span className="block truncate font-medium">{video.relativePath.split('/').pop()}</span><span className="block truncate text-muted-foreground">{video.relativePath} · {megabytes(video.size)} · {new Date(video.modifiedAt).toLocaleString('pt-BR')}</span></button>} />}
      </div>

      <div className="min-w-0 space-y-4">
        {!selected && <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">Escolha um vídeo na lista para ver a prévia e preparar a publicação.</p>}
        {selected && <div className="space-y-2">
          {preview.isFetching && <ProgressBar label="Carregando prévia do vídeo" />}
          {preview.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(preview.error)}</p>}
          {preview.data && <video aria-label={`Prévia de ${selected}`} className="w-full rounded border bg-black" controls src={preview.data} />}
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => saveVideo.mutate()} disabled={saveVideo.isPending}>{saveVideo.isPending ? 'Salvando…' : 'Salvar no PC'}</Button>{saveVideo.data?.saved && <span role="status" className="text-xs text-muted-foreground">Vídeo salvo no computador.</span>}{saveVideo.isError && <span role="alert" className="text-xs text-destructive">{errorMessage(saveVideo.error)}</span>}</div>
        </div>}

        <NeedsConnection status={status} write onOpen={onOpenSettings} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium sm:col-span-2">Título<input aria-label="Título da publicação" className={INPUT} maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="text-xs font-medium">Palavra-chave principal<input aria-label="Palavra-chave do título" className={INPUT} value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
          <label className="text-xs font-medium">Tags (separadas por vírgula)<input aria-label="Tags da publicação" className={INPUT} value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label className="text-xs font-medium sm:col-span-2">Descrição<textarea aria-label="Descrição da publicação" className={`${INPUT} min-h-28`} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="sm:col-span-2"><ChannelThumbnail projectId={projectId} identity={identity} title={title} selectedPath={thumbnailPath} onUse={setThumbnailPath} onOpenIdentity={onOpenIdentity} /></div>
          <label className="text-xs font-medium sm:col-span-2">Arquivo da thumbnail (PNG ou JPEG do projeto, opcional)<input aria-label="Thumbnail da publicação" className={INPUT} placeholder="channel-assets/thumbnails/minha-thumb.png" value={thumbnailPath} onChange={(event) => setThumbnailPath(event.target.value)} /></label>
          <label className="text-xs font-medium">Privacidade<select aria-label="Privacidade" className={INPUT} value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)}><option value="private">Privado</option><option value="unlisted">Não listado</option><option value="public">Público</option></select></label>
          <label className="text-xs font-medium">Agendar (opcional, exige privado)<input aria-label="Data de publicação" type="datetime-local" className={INPUT} value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label>
        </div>
        <div className="rounded bg-muted/30 p-2 text-xs" aria-label="Notas do otimizador"><p className="font-medium">Notas · título {notes.title}/100 · descrição {notes.description}/100 · tags {notes.tags}/100</p><p className="mt-1 text-muted-foreground">Horários sugeridos: {times.join(' · ')}. Correlação não é garantia.</p></div>

        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Otimizar com o nicho</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">Busca oficial sob demanda; cada pesquisa custa 100 unidades da cota diária. Títulos de outros canais são só referência.</p>
            <div className="flex flex-wrap gap-2"><input aria-label="Nicho da publicação" className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm" placeholder="Ex.: AI tools" value={niche} onChange={(event) => setNiche(event.target.value)} /><Button size="sm" variant="outline" onClick={() => reference.mutate()} disabled={!status?.connected || !niche.trim() || reference.isPending}>Pesquisar vídeos do nicho</Button><Button size="sm" variant="outline" onClick={() => optimize.mutate()} disabled={!reference.data || optimize.isPending}>Sugerir títulos</Button></div>
            {reference.isPending && <ProgressBar label="Pesquisando vídeos do nicho no YouTube" />}
            {optimize.isPending && <ProgressBar label="Gerando sugestões (somente leitura)" />}
            {reference.data && <p role="status" className="text-xs">{reference.data.totalResults} resultados · custo {reference.data.quotaCost} unidades</p>}
            {optimize.data && <div className="space-y-1 rounded bg-muted/30 p-2 text-xs"><p className="font-medium">Sugestões para revisar</p><ol className="space-y-1">{optimize.data.titles.map((item) => <li key={item} className="flex items-center justify-between gap-2"><span>{item}</span><Button size="sm" variant="ghost" onClick={() => setTitle(item.slice(0, 100))}>Usar título</Button></li>)}</ol><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setDescription(optimize.data.description)}>Usar descrição</Button><Button size="sm" variant="ghost" onClick={() => setTags(optimize.data.tags.join(', '))}>Usar tags</Button></div></div>}
            {reference.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(reference.error)}</p>}
            {optimize.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(optimize.error)}</p>}
          </div>
        </details>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2"><Button onClick={() => publish.mutate()} disabled={!status?.canWrite || !selected || !title.trim() || running}>{publishAt ? 'Enviar e agendar' : 'Enviar publicação'}</Button>{job.data?.status === 'uploading' && <Button variant="ghost" onClick={() => void window.neuralbridge.video.channelPublishCancel(publish.data?.id ?? '')}>Cancelar upload</Button>}</div>
          <p className="text-xs text-muted-foreground">O envio pede aprovação numa janela do sistema. Sem a auditoria da API do Google, o YouTube mantém o vídeo privado.</p>
          {publish.isPending && <ProgressBar label="Aguardando aprovação e abrindo a sessão de envio" />}
          {job.data && <div className="space-y-1"><ProgressBar label={`Envio para o YouTube · ${JOB_LABEL[job.data.status] ?? job.data.status}`} value={job.data.progress} /><p role="status" className="text-sm">{JOB_LABEL[job.data.status] ?? job.data.status} · {job.data.progress}%{job.data.error ? ` · ${job.data.error}` : ''}</p></div>}
          {publish.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(publish.error)}</p>}
        </div>
      </div>
    </div>
  );
}

function CalendarTab({ projectId, status, onOpenSettings }: { projectId: string; status: Status; onOpenSettings: () => void }) {
  const agenda = useQuery({ queryKey: ['velix-channel-agenda', projectId], queryFn: () => window.neuralbridge.video.channelAgenda(projectId) });
  const publications = useQuery({ queryKey: ['velix-channel-publications', projectId], queryFn: () => window.neuralbridge.video.channelPublications(projectId) });
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [rescheduleAt, setRescheduleAt] = useState<Record<string, string>>({});
  const reschedule = useMutation({ mutationFn: (input: { videoId: string; publishAt: string | null }) => window.neuralbridge.video.channelReschedule({ projectId, ...input, confirmed: true }), onSuccess: () => { setRescheduleAt({}); void agenda.refetch(); } });
  const days = useMemo(() => { const first = new Date(month.getFullYear(), month.getMonth(), 1); const start = new Date(first); start.setDate(first.getDate() - first.getDay()); return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; }); }, [month]);
  const itemsOn = (day: Date) => (agenda.data ?? []).filter((item) => { const at = new Date(item.at); return at.getFullYear() === day.getFullYear() && at.getMonth() === day.getMonth() && at.getDate() === day.getDate(); });
  const today = new Date();
  return (
    <div className="space-y-4">
      <NeedsConnection status={status} write={false} onOpen={onOpenSettings} />
      {(agenda.isFetching || publications.isFetching) && <ProgressBar label="Sincronizando a agenda com o YouTube" />}
      <div role="region" className="space-y-2 rounded border p-3" aria-label="Agenda do canal">
        <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Agenda</h3><div className="flex items-center gap-1"><Button size="sm" variant="ghost" aria-label="Mês anterior" onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>←</Button><span className="min-w-36 text-center text-sm capitalize">{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span><Button size="sm" variant="ghost" aria-label="Próximo mês" onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}>→</Button></div></div>
        <div className="grid grid-cols-7 gap-px text-center text-[11px] text-muted-foreground" aria-label="Calendário mensal">{['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((name) => <span key={name}>{name}</span>)}{days.map((day) => { const items = itemsOn(day); const current = day.getMonth() === month.getMonth(); const isToday = day.toDateString() === today.toDateString(); return <div key={day.toISOString()} className={`min-h-20 rounded border p-1 text-left ${current ? 'bg-background' : 'bg-muted/30 text-muted-foreground'} ${isToday ? 'border-primary' : ''}`}><time dateTime={day.toISOString()} className="text-[11px]">{day.getDate()}</time>{items.map((item) => <div key={item.id} className="mt-1 truncate rounded bg-primary/15 px-1 text-[11px] text-foreground" title={`${item.title} · ${STATE_LABEL[item.state] ?? item.state} · ${new Date(item.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}>{new Date(item.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} {item.title}</div>)}</div>; })}</div>
        {agenda.data?.length ? <ol className="space-y-1 text-sm">{agenda.data.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2"><span className="truncate">{item.title} <span className="text-xs text-muted-foreground">· {STATE_LABEL[item.state] ?? item.state} · {new Date(item.at).toLocaleString('pt-BR')}</span></span>{item.id.startsWith('youtube:') && item.state === 'scheduled' && <span className="flex items-center gap-1"><input aria-label={`Nova data de ${item.title}`} type="datetime-local" className="rounded border bg-background px-1 py-0.5 text-xs" value={rescheduleAt[item.id] ?? ''} onChange={(event) => setRescheduleAt((current) => ({ ...current, [item.id]: event.target.value }))} /><Button size="sm" variant="ghost" disabled={!status?.canWrite || reschedule.isPending} onClick={() => { const value = rescheduleAt[item.id] ?? ''; reschedule.mutate({ videoId: item.id.slice('youtube:'.length), publishAt: value ? new Date(value).toISOString() : null }); }}>{rescheduleAt[item.id] ? 'Reagendar' : 'Tirar da agenda'}</Button></span>}</li>)}</ol> : !agenda.isFetching && <p className="text-sm text-muted-foreground">Nenhum vídeo agendado ou planejado.</p>}
        {reschedule.isPending && <ProgressBar label="Aguardando aprovação do reagendamento" />}
        {reschedule.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(reschedule.error)}</p>}
        {agenda.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(agenda.error)}</p>}
      </div>
      <div role="region" aria-label="Histórico de publicações" className="space-y-2 rounded border p-3"><h3 className="font-medium">Histórico de envios</h3>{publications.data?.length ? <ul className="space-y-1 text-sm">{publications.data.map((item) => <li key={item.id} className="flex justify-between gap-2"><span className="truncate">{item.title}</span><span className="shrink-0 text-xs text-muted-foreground">{STATE_LABEL[item.status] ?? item.status}{item.publishAt ? ` · ${new Date(item.publishAt).toLocaleString('pt-BR')}` : ''}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p>}</div>
    </div>
  );
}

function SettingsTab({ status, profile, onChanged }: { status: Status; profile: { data?: { title: string; handle: string | null; id: string; brandingSettings: unknown } | undefined; isFetching: boolean; isError: boolean; error: unknown; refetch: () => unknown }; onChanged: () => void }) {
  const [brandingJson, setBrandingJson] = useState('');
  const importClient = useMutation({ mutationFn: () => window.neuralbridge.video.channelOAuthImportClient(), onSuccess: onChanged });
  const clear = useMutation({ mutationFn: () => window.neuralbridge.video.channelOAuthClear(), onSuccess: onChanged });
  const connect = useMutation({ mutationFn: (write: boolean) => window.neuralbridge.video.channelOAuthConnect({ write }), onSuccess: onChanged });
  const disconnect = useMutation({ mutationFn: () => window.neuralbridge.video.channelOAuthDisconnect(), onSuccess: onChanged });
  const applyBranding = useMutation({ mutationFn: (brandingSettings: Record<string, unknown>) => window.neuralbridge.video.channelBrandingApply({ brandingSettings, confirmed: true }), onSuccess: () => void profile.refetch() });
  const apply = () => { try { const value = JSON.parse(brandingJson || JSON.stringify(profile.data?.brandingSettings ?? {})) as Record<string, unknown>; if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('JSON precisa ser um objeto.'); applyBranding.mutate(value); } catch (error) { window.alert(errorMessage(error)); } };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded border p-3 text-sm"><p><span className="font-medium">Cliente OAuth:</span> {status?.configured ? `configurado (${status.clientId})` : 'não configurado'}</p><p><span className="font-medium">Canal:</span> {status?.connected ? (status.canWrite ? 'conectado, com envio e edição' : 'conectado só para leitura') : 'desconectado'}</p><p className="text-xs text-muted-foreground">Armazenamento criptografado: {status?.persistent ? 'disponível' : 'indisponível nesta instalação'}</p></div>
      {profile.isFetching && <ProgressBar label="Carregando o perfil do canal" />}
      {profile.data && <div className="rounded border p-3 text-sm"><p className="font-medium">{profile.data.title}</p><p className="text-muted-foreground">{profile.data.handle ?? profile.data.id}</p></div>}
      {!status?.configured && <ol className="list-decimal space-y-1 rounded border p-3 pl-8 text-sm"><li>No Google Cloud Console, crie um projeto.</li><li>Ative a YouTube Data API v3.</li><li>Configure a tela de consentimento OAuth e adicione a sua conta como usuário de teste.</li><li>Crie uma credencial OAuth do tipo “App para computador”.</li><li>Baixe o JSON e importe aqui.</li></ol>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => importClient.mutate()} disabled={importClient.isPending || !status?.persistent}>{importClient.isPending ? 'Importando…' : 'Importar client_secret.json'}</Button>
        {status?.configured && !status.connected && <Button variant="outline" onClick={() => connect.mutate(false)} disabled={connect.isPending}>Conectar YouTube</Button>}
        {status?.connected && !status.canWrite && <Button variant="outline" onClick={() => connect.mutate(true)} disabled={connect.isPending}>Permitir envio e edição</Button>}
        {status?.connected && <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Desconectar</Button>}
        {status?.configured && !status.connected && <Button variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>Remover cliente</Button>}
      </div>
      {connect.isPending && <ProgressBar label="Aguardando a autorização no navegador" />}
      {disconnect.isPending && <ProgressBar label="Desconectando e revogando o acesso" />}
      {connect.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(connect.error)}</p>}
      {disconnect.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(disconnect.error)}</p>}
      {disconnect.data && <p role="status" className="text-sm text-muted-foreground">{disconnect.data.revoked ? 'Canal desconectado e acesso revogado no Google.' : 'Canal desconectado neste computador, mas o Google não confirmou a revogação. Revogue o acesso em myaccount.google.com/permissions.'}</p>}
      {importClient.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(importClient.error)}</p>}
      {profile.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(profile.error)}</p>}
      {!status?.persistent && <p role="alert" className="text-sm text-destructive">O sistema não disponibilizou criptografia segura; o cliente não será salvo.</p>}
      {profile.data && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-medium">Avançado: branding do canal (JSON)</summary><p className="mt-2 text-xs text-muted-foreground">Descrição e palavras-chave do canal. O YouTube substitui o bloco inteiro pelo que for enviado.</p><textarea aria-label="Branding do canal" className="mt-2 min-h-28 w-full rounded border bg-background p-2 font-mono text-xs" value={brandingJson || JSON.stringify(profile.data.brandingSettings ?? {}, null, 2)} onChange={(event) => setBrandingJson(event.target.value)} /><Button variant="outline" onClick={apply} disabled={applyBranding.isPending}>Aplicar branding com aprovação</Button>{applyBranding.isPending && <ProgressBar label="Aguardando aprovação e aplicando o branding" />}{applyBranding.isSuccess && <p role="status" className="text-xs text-muted-foreground">Branding aplicado.</p>}{applyBranding.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(applyBranding.error)}</p>}</details>}
    </div>
  );
}

export function VelixChannel({ projectId }: { projectId: string | null }) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['velix-channel-oauth'], queryFn: () => window.neuralbridge.video.channelOAuthStatus() });
  const profile = useQuery({ queryKey: ['velix-channel-profile'], queryFn: () => window.neuralbridge.video.channelProfile(), enabled: !!status.data?.connected, retry: false });
  const savedIdentity = useQuery({ queryKey: ['velix-channel-identity', projectId], queryFn: () => window.neuralbridge.video.channelIdentityLoad(projectId ?? ''), enabled: !!projectId });
  const [niche, setNiche] = useState('');
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Until the person picks a tab: setup first when the channel is not connected yet, publishing otherwise.
  const tab: Tab = chosen ?? (status.data && !status.data.connected ? 'configuracao' : 'publicar');
  const onChanged = () => { void client.invalidateQueries({ queryKey: ['velix-channel-oauth'] }); void client.invalidateQueries({ queryKey: ['velix-channel-profile'] }); };
  const onPublished = useMemo(() => () => { void client.invalidateQueries({ queryKey: ['velix-channel-agenda', projectId] }); void client.invalidateQueries({ queryKey: ['velix-channel-publications', projectId] }); }, [client, projectId]);
  if (!projectId) return <section aria-label="Canal Aethera" className="sg-panel rounded-lg p-5 text-sm text-muted-foreground">Escolha o projeto Video para usar o Canal.</section>;
  return (
    <section aria-label="Canal Aethera" className="space-y-4 sg-panel rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-medium">Canal</h2><span className="text-xs text-muted-foreground">{status.data?.connected ? (profile.data?.title ?? 'Canal conectado') : 'Canal desconectado'}</span></div>
      <div className="flex flex-wrap gap-1 border-b" role="tablist" aria-label="Áreas do Canal">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setChosen(id)} className={`border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>{label}</button>)}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>
        {tab === 'publicar' && <PublishTab projectId={projectId} status={status.data} identity={savedIdentity.data} onOpenSettings={() => setChosen('configuracao')} onOpenIdentity={() => setChosen('identidade')} onPublished={onPublished} />}
        {tab === 'calendario' && <CalendarTab projectId={projectId} status={status.data} onOpenSettings={() => setChosen('configuracao')} />}
        {tab === 'identidade' && <ChannelIdentity projectId={projectId} channelTitle={profile.data?.title ?? null} saved={savedIdentity.data} onSaved={() => void savedIdentity.refetch()} niche={niche} onNicheChange={setNiche} connected={!!status.data?.connected} canWrite={!!status.data?.canWrite} branding={profile.data?.brandingSettings} onOpenSettings={() => setChosen('configuracao')} />}
        {tab === 'configuracao' && <SettingsTab status={status.data} profile={profile} onChanged={onChanged} />}
      </div>
    </section>
  );
}
