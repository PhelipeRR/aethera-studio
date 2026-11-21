import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Eye,
  HelpCircle,
  Link2,
  Palette,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/app/PageHeader';
import {
  evaluateChannelCompleteness,
  renderChannelDescriptionPreview,
  renderChannelTitlePreview,
  type AutonomyMode,
  type ChannelFormat,
  type ContentChannel,
} from '@neuralbridge/shared/content-operating-system';
import { SetupTutorialDrawer } from './SetupTutorialDrawer';
import { YouTubeLongFormPublishingStudio } from './YouTubeLongFormPublishingStudio';
import {
  buildEmptyChannelForm,
  buildFormFromChannel,
  CHANNEL_FORMAT_OPTIONS,
  clearChannelDraft,
  FONT_OPTIONS,
  loadChannelDraft,
  saveChannelDraft,
  TIMEZONE_OPTIONS,
  toChannelCreatePayload,
  toChannelUpdatePayload,
  validateChannelForm,
  WEEKDAY_OPTIONS,
  YOUTUBE_CATEGORIES,
  type ChannelFormState,
} from './channel-manager-helpers';

type ManagerTab = 'studio' | 'identity' | 'editorial' | 'publishing' | 'autonomy' | 'help';

const TABS: ReadonlyArray<{ id: ManagerTab; label: string; icon: typeof Palette }> = [
  { id: 'studio', label: 'Estúdio de Publicação & Agendamento', icon: Video },
  { id: 'identity', label: 'Identidade & Brand Kit', icon: Palette },
  { id: 'editorial', label: 'Estratégia Editorial', icon: BookOpen },
  { id: 'publishing', label: 'Publicação & Distribuição', icon: CalendarClock },
  { id: 'autonomy', label: 'Autonomia & Produção', icon: Cpu },
  { id: 'help', label: 'Ajuda & Auditoria', icon: HelpCircle },
];

export function ContentChannelSetupPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ManagerTab>('studio');
  const [selectedId, setSelectedId] = useState<string>('new');
  const [form, setForm] = useState<ChannelFormState>(() => buildEmptyChannelForm(crypto.randomUUID()));
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // Local input states for list editors
  const [styleExampleInput, setStyleExampleInput] = useState('');
  const [restrictedTopicInput, setRestrictedTopicInput] = useState('');
  const [reviewTopicInput, setReviewTopicInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesFormat, setSeriesFormat] = useState<ChannelFormat>('news');
  const [seriesWeekday, setSeriesWeekday] = useState('friday');
  const [seriesTime, setSeriesTime] = useState('18:00');

  const channelsQuery = useQuery({
    queryKey: ['aethera-content-channels'],
    queryFn: () => window.neuralbridge.content.channels(),
  });

  const oauthStatus = useQuery({
    queryKey: ['aethera-youtube-oauth-status'],
    queryFn: () => window.neuralbridge.video.channelOAuthStatus(),
  });

  const voicesQuery = useQuery({
    queryKey: ['aethera-cinema-voices'],
    queryFn: async () => {
      const videoApi = window.neuralbridge.video as unknown as {
        cinemaListVoices?: () => Promise<Array<{ id: string; name: string; engine: string; locale: string }>>;
      };
      return (await videoApi.cinemaListVoices?.()) ?? [];
    },
    retry: false,
  });

  const channels = channelsQuery.data ?? [];

  // Select first channel automatically on initial load if available
  useEffect(() => {
    if (selectedId === 'new' && channels.length > 0 && !hasDraftChanges && !form.name) {
      const first = channels[0];
      if (first) {
        setSelectedId(first.id);
        const draft = loadChannelDraft(first.id);
        if (draft) {
          setForm(draft);
          setHasDraftChanges(true);
        } else {
          setForm(buildFormFromChannel(first));
          setHasDraftChanges(false);
        }
      }
    }
  }, [channels, selectedId, hasDraftChanges, form.name]);

  const selectChannel = (channel: ContentChannel | 'new') => {
    setStatusMessage(null);
    if (channel === 'new') {
      const newId = crypto.randomUUID();
      setSelectedId('new');
      setForm(buildEmptyChannelForm(newId));
      setHasDraftChanges(false);
      return;
    }
    setSelectedId(channel.id);
    const draft = loadChannelDraft(channel.id);
    if (draft) {
      setForm(draft);
      setHasDraftChanges(true);
    } else {
      setForm(buildFormFromChannel(channel));
      setHasDraftChanges(false);
    }
  };

  const updateForm = (updater: (prev: ChannelFormState) => ChannelFormState) => {
    setForm((prev) => {
      const next = updater(prev);
      saveChannelDraft(next);
      return next;
    });
    setHasDraftChanges(true);
  };

  const discardDraft = () => {
    clearChannelDraft(form.id);
    const existing = channels.find((c) => c.id === form.id);
    if (existing) {
      setForm(buildFormFromChannel(existing));
    } else {
      setForm(buildEmptyChannelForm(form.id));
    }
    setHasDraftChanges(false);
    setStatusMessage({ kind: 'ok', text: 'Rascunho descartado. Alterações restauradas.' });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validationErrors = validateChannelForm(form);
      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join(' '));
      }
      if (form.isNew) {
        return window.neuralbridge.content.createChannel(toChannelCreatePayload(form));
      }
      return window.neuralbridge.content.updateChannel(toChannelUpdatePayload(form));
    },
    onSuccess: (saved) => {
      clearChannelDraft(saved.id);
      setSelectedId(saved.id);
      setForm(buildFormFromChannel(saved));
      setHasDraftChanges(false);
      setStatusMessage({ kind: 'ok', text: `Canal "${saved.name}" salvo com sucesso.` });
      void queryClient.invalidateQueries({ queryKey: ['aethera-content-channels'] });
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : 'Falha ao salvar canal.';
      const friendly = raw.includes('Invalid payload')
        ? `Validação de contrato IPC rejeitou os dados enviados (${raw}). Verifique Nome (1–200), Nicho (<=300), Público-alvo (<=500) e Tom (<=500).`
        : raw;
      setStatusMessage({ kind: 'error', text: friendly });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (channelId: string) => window.neuralbridge.content.deleteChannel(channelId),
    onSuccess: () => {
      clearChannelDraft(form.id);
      setStatusMessage({ kind: 'ok', text: 'Canal removido.' });
      setSelectedId('new');
      setForm(buildEmptyChannelForm(crypto.randomUUID()));
      setHasDraftChanges(false);
      void queryClient.invalidateQueries({ queryKey: ['aethera-content-channels'] });
    },
    onError: (err) => {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao remover canal.' });
    },
  });

  const importClientSecretMutation = useMutation({
    mutationFn: () => window.neuralbridge.video.channelOAuthImportClient(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['aethera-youtube-oauth-status'] });
      setStatusMessage({
        kind: 'ok',
        text: `client_secret.json importado (${res.clientId.slice(0, 18)}…). Agora clique em "Conectar YouTube".`,
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Falha ao importar client_secret.json.';
      if (!msg.startsWith('cancelled:')) {
        setStatusMessage({ kind: 'error', text: msg });
      }
    },
  });

  const connectYouTubeMutation = useMutation({
    mutationFn: () => window.neuralbridge.video.channelOAuthConnect({ write: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aethera-youtube-oauth-status'] });
      setStatusMessage({ kind: 'ok', text: 'YouTube conectado via OAuth! Clique em "Importar dados reais" para sincronizar.' });
    },
    onError: (err) => {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao conectar YouTube OAuth.' });
    },
  });

  const disconnectYouTubeMutation = useMutation({
    mutationFn: () => window.neuralbridge.video.channelOAuthDisconnect(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aethera-youtube-oauth-status'] });
      updateForm((prev) => ({
        ...prev,
        identity: { ...prev.identity, connectionMode: 'manual' },
      }));
      setStatusMessage({ kind: 'ok', text: 'YouTube desconectado. Canal mantido em modo manual.' });
    },
  });

  const importYouTubeProfileMutation = useMutation({
    mutationFn: () => window.neuralbridge.video.channelProfile(),
    onSuccess: (profile) => {
      updateForm((prev) => ({
        ...prev,
        name: prev.name.trim() ? prev.name : profile.title,
        identity: {
          ...prev.identity,
          platform: 'youtube',
          connectionMode: 'oauth_youtube',
          youtubeChannelId: profile.id,
          handle: profile.handle ?? prev.identity.handle,
          avatarUrl: profile.avatarUrl ?? prev.identity.avatarUrl,
          bannerUrl: profile.bannerUrl ?? prev.identity.bannerUrl,
          description: prev.identity.description.trim() ? prev.identity.description : (profile.description ?? ''),
          region: profile.country ?? prev.identity.region,
          language: profile.defaultLanguage ?? prev.identity.language,
          lastSyncedAt: new Date().toISOString(),
        },
      }));
      setStatusMessage({ kind: 'ok', text: `Metadados reais importados de "${profile.title}". Salve para persistir.` });
    },
    onError: (err) => {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao importar dados do YouTube.' });
    },
  });

  const virtualChannel: ContentChannel = useMemo(
    () => ({
      id: form.id,
      workspaceId: 'default',
      name: form.name || '',
      niche: form.niche,
      audience: form.audience,
      tone: form.tone,
      autonomy: form.autonomy,
      budgetUsd: form.budgetUsd,
      concurrencyLimit: form.concurrencyLimit,
      identity: form.identity as unknown as Record<string, unknown>,
      editorialStrategy: form.editorialStrategy as unknown as Record<string, unknown>,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    [form],
  );

  const completeness = useMemo(() => evaluateChannelCompleteness(virtualChannel), [virtualChannel]);
  const titlePreview = useMemo(
    () => renderChannelTitlePreview(form.editorialStrategy.publishing.titleTemplate, 'Os 10 Segredos de Elden Ring que Mudaram Tudo', form.name || 'Seu Canal'),
    [form.editorialStrategy.publishing.titleTemplate, form.name],
  );
  const descriptionPreview = useMemo(
    () =>
      renderChannelDescriptionPreview(
        form.editorialStrategy.publishing.descriptionTemplate,
        'Uma análise cinematográfica e detalhada dos bastidores e mecânicas.',
        form.name || 'Seu Canal',
        form.editorialStrategy.publishing.defaultHashtags,
        form.editorialStrategy.publishing.creditsTemplate,
      ),
    [
      form.editorialStrategy.publishing.descriptionTemplate,
      form.editorialStrategy.publishing.defaultHashtags,
      form.editorialStrategy.publishing.creditsTemplate,
      form.name,
    ],
  );

  const isOAuthConnected = Boolean(oauthStatus.data?.connected);
  const voices = voicesQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Gerenciador de Canais 2.0"
        description="Identidade visual, Brand Kit, estratégia editorial, publicação no YouTube e autonomia por etapa."
      />

      <main className="space-y-5 px-6 py-6 xl:px-8">
        {/* Channel Switcher Bar */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-xs font-medium text-muted-foreground">
              Canais ({channels.length})
            </span>
            {channels.map((ch) => {
              const active = !form.isNew && form.id === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => selectChannel(ch)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${
                    active
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Radio className="size-3.5" />
                  <span>{ch.name}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => selectChannel('new')}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition ${
                form.isNew
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary'
              }`}
            >
              <Plus className="size-3.5" />
              Novo canal
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasDraftChanges && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
                <AlertTriangle className="size-3.5" />
                Rascunho não salvo
              </span>
            )}
            {hasDraftChanges && (
              <button
                type="button"
                onClick={discardDraft}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                Descartar
              </button>
            )}
            {!form.isNew && (
              <button
                type="button"
                onClick={() => deleteMutation.mutate(form.id)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                Excluir
              </button>
            )}
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name.trim()}
              title={!form.name.trim() ? 'Preencha o Nome do canal abaixo para salvar/criar' : undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Save className="size-4" />
              {saveMutation.isPending ? 'Salvando…' : form.isNew ? 'Criar canal' : 'Salvar alterações'}
            </button>
          </div>
        </section>

        {statusMessage && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
              statusMessage.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            {statusMessage.kind === 'ok' ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Channel Identity Summary Header */}
        <section className="sg-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
          <div className="flex items-center gap-4">
            {form.identity.avatarUrl ? (
              <img
                src={form.identity.avatarUrl}
                alt={form.name || 'Avatar do canal'}
                className="size-14 rounded-2xl border border-border object-cover"
              />
            ) : (
              <div
                className="flex size-14 items-center justify-center rounded-2xl border border-border text-lg font-semibold text-white"
                style={{ backgroundColor: form.identity.brandKit.primaryColor || '#8b5cf6' }}
              >
                {(form.name || 'A').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-medium">{form.name.trim() || 'Novo Canal sem nome'}</h2>
                {form.identity.handle && <span className="text-xs text-muted-foreground">{form.identity.handle}</span>}
                <span className="rounded-md border border-border px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {form.identity.platform}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
                    form.identity.connectionMode === 'oauth_youtube' && isOAuthConnected
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  <Video className="size-3" />
                  {form.identity.connectionMode === 'oauth_youtube' && isOAuthConnected ? 'YouTube OAuth Conectado' : 'Configuração Manual'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {form.niche.trim() ? `Nicho: ${form.niche}` : 'Nicho não definido'} · {form.identity.language} ({form.identity.region})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Completude do canal</p>
              <p className="text-base font-semibold">{completeness.scorePct}%</p>
              {completeness.missingRequired.length > 0 && (
                <p className="text-[11px] text-amber-300">Falta: {completeness.missingRequired.join(', ')}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setTutorialOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs hover:border-primary hover:text-primary"
            >
              <HelpCircle className="size-3.5" />
              Como configurar YouTube
            </button>
          </div>
        </section>

        {/* Organized Tabs */}
        <nav aria-label="Seções do canal" className="flex flex-wrap gap-2 border-b border-border pb-3">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition ${
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* TAB 1: IDENTIDADE & BRAND KIT */}
        {activeTab === 'identity' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="space-y-5">
              {/* YouTube OAuth Card */}
              <section className="sg-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 font-medium">
                      <Video className="size-4 text-red-400" />
                      Conexão YouTube (OAuth 2.0)
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reutiliza o cofre OAuth compartilhado do estúdio. Nunca duplica segredos por canal.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isOAuthConnected ? (
                      <>
                        {!oauthStatus.data?.configured ? (
                          <button
                            type="button"
                            onClick={() => importClientSecretMutation.mutate()}
                            disabled={importClientSecretMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            <Link2 className="size-3.5" />
                            {importClientSecretMutation.isPending ? 'Importando…' : 'Importar client_secret.json'}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => connectYouTubeMutation.mutate()}
                              disabled={connectYouTubeMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                            >
                              <Link2 className="size-3.5" />
                              {connectYouTubeMutation.isPending ? 'Conectando…' : 'Conectar YouTube'}
                            </button>
                            <button
                              type="button"
                              onClick={() => importClientSecretMutation.mutate()}
                              disabled={importClientSecretMutation.isPending}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              {importClientSecretMutation.isPending ? 'Importando…' : 'Trocar client_secret.json'}
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => importYouTubeProfileMutation.mutate()}
                          disabled={importYouTubeProfileMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-primary bg-primary/10 px-3 py-1.5 text-xs text-primary"
                        >
                          <RefreshCw className="size-3.5" />
                          {importYouTubeProfileMutation.isPending ? 'Importando…' : 'Importar dados reais'}
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnectYouTubeMutation.mutate()}
                          disabled={disconnectYouTubeMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                        >
                          <Unlink className="size-3.5" />
                          Desconectar
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {form.identity.youtubeChannelId && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    ID do Canal YouTube: <code className="text-foreground">{form.identity.youtubeChannelId}</code>
                    {form.identity.lastSyncedAt ? ` · Sincronizado em ${new Date(form.identity.lastSyncedAt).toLocaleString('pt-BR')}` : ''}
                  </p>
                )}
              </section>

              {/* Basic Identity Fields */}
              <section className="sg-panel space-y-4 rounded-2xl p-5">
                <h3 className="font-medium">Identidade do Canal</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    Nome do canal <span className="text-destructive">*</span>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => updateForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Ex: Aethera Games"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Handle (@canal)
                    <input
                      value={form.identity.handle}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, handle: e.target.value } }))}
                      placeholder="@aetheragames"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Plataforma principal
                    <select
                      value={form.identity.platform}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, platform: e.target.value as 'youtube' | 'twitch' | 'multi' } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="youtube">YouTube</option>
                      <option value="twitch">Twitch / VOD</option>
                      <option value="multi">Multi-plataforma</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-sm">
                      Idioma
                      <input
                        value={form.identity.language}
                        onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, language: e.target.value } }))}
                        className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      Região
                      <input
                        value={form.identity.region}
                        onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, region: e.target.value } }))}
                        className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    Nicho <span className="text-destructive">*</span>
                    <input
                      value={form.niche}
                      onChange={(e) => updateForm((p) => ({ ...p, niche: e.target.value }))}
                      placeholder="Games, RPGs, Cultura Geek"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Público-alvo <span className="text-destructive">*</span>
                    <input
                      value={form.audience}
                      onChange={(e) => updateForm((p) => ({ ...p, audience: e.target.value }))}
                      placeholder="Jogadores 18-34 interessados em análises profundas"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Descrição do canal
                  <textarea
                    value={form.identity.description}
                    onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, description: e.target.value } }))}
                    rows={3}
                    placeholder="Proposta de valor e resumo público do canal"
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
              </section>

              {/* Brand Kit */}
              <section className="sg-panel space-y-4 rounded-2xl p-5">
                <h3 className="flex items-center gap-2 font-medium">
                  <Sparkles className="size-4 text-primary" />
                  Brand Kit Consistente
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    URL da Logo / Avatar
                    <input
                      value={form.identity.brandKit.logoUrl}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, logoUrl: e.target.value } } }))}
                      placeholder="https://... ou caminho local"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Estilo de Lower Third
                    <select
                      value={form.identity.brandKit.lowerThirdStyle}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, lowerThirdStyle: e.target.value as ChannelFormState['identity']['brandKit']['lowerThirdStyle'] } } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="cinematic">Cinematográfico</option>
                      <option value="minimal">Minimalista</option>
                      <option value="neon">Neon Gamer</option>
                      <option value="editorial">Editorial / Jornalístico</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    Fonte de Títulos
                    <select
                      value={form.identity.brandKit.headingFont}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, headingFont: e.target.value } } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Fonte de Corpo / Legendas
                    <select
                      value={form.identity.brandKit.bodyFont}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, bodyFont: e.target.value } } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Preset de Vinheta (Intro)
                    <input
                      value={form.identity.brandKit.introPreset}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, introPreset: e.target.value } } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Posição da Marca d&apos;Água
                    <select
                      value={form.identity.brandKit.watermarkPosition}
                      onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, watermarkPosition: e.target.value as ChannelFormState['identity']['brandKit']['watermarkPosition'] } } }))}
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="bottomRight">Inferior Direita</option>
                      <option value="bottomLeft">Inferior Esquerda</option>
                      <option value="topRight">Superior Direita</option>
                      <option value="topLeft">Superior Esquerda</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ['primaryColor', 'Primária'],
                      ['secondaryColor', 'Secundária'],
                      ['accentColor', 'Destaque'],
                      ['backgroundColor', 'Fundo'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-xs text-muted-foreground">
                      {label}
                      <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                        <input
                          type="color"
                          value={form.identity.brandKit[key]}
                          onChange={(e) => updateForm((p) => ({ ...p, identity: { ...p.identity, brandKit: { ...p.identity.brandKit, [key]: e.target.value } } }))}
                          className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
                        />
                        <span className="font-mono text-xs text-foreground">{form.identity.brandKit[key]}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            </div>

            {/* Live Brand Kit Visual Preview */}
            <aside className="space-y-4">
              <div className="sg-panel sticky top-4 overflow-hidden rounded-2xl">
                <div className="border-b border-border px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Eye className="size-3.5 text-primary" />
                    Prévia Visual da Identidade
                  </p>
                </div>
                <div
                  className="relative h-28 w-full bg-cover bg-center"
                  style={{
                    backgroundColor: form.identity.brandKit.backgroundColor,
                    backgroundImage: form.identity.bannerUrl ? `url(${form.identity.bannerUrl})` : undefined,
                    borderBottom: `2px solid ${form.identity.brandKit.primaryColor}`,
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                  <div className="absolute bottom-3 left-4 flex items-center gap-3">
                    {form.identity.avatarUrl ? (
                      <img
                        src={form.identity.avatarUrl}
                        alt={form.name || 'Avatar do canal'}
                        className="size-11 rounded-xl border-2 object-cover"
                        style={{ borderColor: form.identity.brandKit.accentColor }}
                      />
                    ) : (
                      <div
                        className="flex size-11 items-center justify-center rounded-xl border-2 text-sm font-bold text-white"
                        style={{
                          borderColor: form.identity.brandKit.accentColor,
                          backgroundColor: form.identity.brandKit.primaryColor,
                        }}
                      >
                        {(form.name || 'AE').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-white" style={{ fontFamily: form.identity.brandKit.headingFont }}>
                        {form.name || 'Seu Canal'}
                      </p>
                      <p className="text-[11px] text-white/75">{form.identity.handle || '@seucanal'}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-xs text-muted-foreground">Simulação de Lower Third ({form.identity.brandKit.lowerThirdStyle})</p>
                  <div
                    className="rounded-xl border p-3"
                    style={{
                      backgroundColor: form.identity.brandKit.backgroundColor,
                      borderColor: form.identity.brandKit.primaryColor,
                    }}
                  >
                    <span
                      className="inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black"
                      style={{ backgroundColor: form.identity.brandKit.accentColor }}
                    >
                      Em destaque
                    </span>
                    <p className="mt-1.5 text-sm font-semibold text-white" style={{ fontFamily: form.identity.brandKit.headingFont }}>
                      Capítulo 01 — O Ponto de Virada
                    </p>
                    <p className="text-xs text-white/70" style={{ fontFamily: form.identity.brandKit.bodyFont }}>
                      {form.niche || 'Games & Storytelling'} · {form.identity.brandKit.introPreset}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* TAB 2: ESTRATÉGIA EDITORIAL */}
        {activeTab === 'editorial' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="sg-panel space-y-4 rounded-2xl p-5">
              <h3 className="font-medium">Voz, Ritmo e Tom Narrativo</h3>
              <label className="block text-sm">
                Tom narrativo <span className="text-destructive">*</span>
                <input
                  value={form.tone}
                  onChange={(e) => updateForm((p) => ({ ...p, tone: e.target.value, editorialStrategy: { ...p.editorialStrategy, narrativeTone: e.target.value } }))}
                  placeholder="Cinematográfico, analítico e envolvente"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs">
                  Humor
                  <select
                    value={form.editorialStrategy.humorStyle}
                    onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, humorStyle: e.target.value as ChannelFormState['editorialStrategy']['humorStyle'] } }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="none">Sério</option>
                    <option value="subtle">Sutil / Pontual</option>
                    <option value="sarcastic">Irônico</option>
                    <option value="energetic">Energético</option>
                  </select>
                </label>
                <label className="block text-xs">
                  Profundidade
                  <select
                    value={form.editorialStrategy.depthLevel}
                    onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, depthLevel: e.target.value as ChannelFormState['editorialStrategy']['depthLevel'] } }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="quick">Direto ao ponto</option>
                    <option value="balanced">Equilibrado</option>
                    <option value="deep_dive">Investigativo</option>
                  </select>
                </label>
                <label className="block text-xs">
                  Ritmo
                  <select
                    value={form.editorialStrategy.pacing}
                    onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, pacing: e.target.value as ChannelFormState['editorialStrategy']['pacing'] } }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="fast">Ágil</option>
                    <option value="medium">Médio</option>
                    <option value="cinematic">Cinematográfico</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                Diretriz editorial geral
                <textarea
                  rows={3}
                  value={form.editorialStrategy.brief}
                  onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, brief: e.target.value } }))}
                  placeholder="Princípios de gancho, conflito, retenção e identidade do canal"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>

              <div className="space-y-2 border-t border-border pt-3">
                <label className="flex items-center justify-between text-sm">
                  <span>Usar lições da Aethera Academy nos roteiros</span>
                  <input
                    type="checkbox"
                    checked={form.editorialStrategy.useAcademyRules}
                    onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, useAcademyRules: e.target.checked } }))}
                  />
                </label>
                <label className="flex items-center justify-between text-sm">
                  <span>Aplicar Production Learning (feedback contínuo)</span>
                  <input
                    type="checkbox"
                    checked={form.editorialStrategy.useProductionLearning}
                    onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, useProductionLearning: e.target.checked } }))}
                  />
                </label>
              </div>
            </section>

            <section className="sg-panel space-y-4 rounded-2xl p-5">
              <h3 className="font-medium">Formatos, Fontes e Restrições</h3>
              <div>
                <p className="text-xs text-muted-foreground">Formatos habilitados <span className="text-destructive">*</span></p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {CHANNEL_FORMAT_OPTIONS.map((fmt) => {
                    const enabled = form.editorialStrategy.enabledFormats.includes(fmt.id);
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() =>
                          updateForm((p) => ({
                            ...p,
                            editorialStrategy: {
                              ...p.editorialStrategy,
                              enabledFormats: enabled
                                ? p.editorialStrategy.enabledFormats.filter((x) => x !== fmt.id)
                                : [...p.editorialStrategy.enabledFormats, fmt.id],
                            },
                          }))
                        }
                        className={`rounded-xl border p-2.5 text-left transition ${
                          enabled ? 'border-primary bg-primary/10' : 'border-border bg-background/50 opacity-70'
                        }`}
                      >
                        <p className="text-xs font-medium">{fmt.label}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{fmt.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block text-sm">
                Política de verificação factual e fontes
                <select
                  value={form.editorialStrategy.factCheckPolicy}
                  onChange={(e) => updateForm((p) => ({ ...p, editorialStrategy: { ...p.editorialStrategy, factCheckPolicy: e.target.value as ChannelFormState['editorialStrategy']['factCheckPolicy'] } }))}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="strict_verified">Estrita — somente fatos com fonte verificada</option>
                  <option value="balanced">Equilibrada — fatos verificados + opinião sinalizada</option>
                  <option value="creative">Criativa — ensaios e hipóteses especulativas</option>
                </select>
              </label>

              {/* Style examples, Restricted topics, Review topics */}
              {(
                [
                  {
                    title: 'Exemplos de estilo (referência interna, sem copiar criadores)',
                    items: form.editorialStrategy.styleExamples,
                    input: styleExampleInput,
                    setInput: setStyleExampleInput,
                    key: 'styleExamples' as const,
                    placeholder: 'Ex: Abrir com pergunta de conflito antes do contexto histórico',
                  },
                  {
                    title: 'Temas restritos / proibidos',
                    items: form.editorialStrategy.restrictedTopics,
                    input: restrictedTopicInput,
                    setInput: setRestrictedTopicInput,
                    key: 'restrictedTopics' as const,
                    placeholder: 'Ex: Rumores sem fonte, vazamentos privados',
                  },
                  {
                    title: 'Temas que exigem revisão humana obrigatória',
                    items: form.editorialStrategy.topicsRequiringReview,
                    input: reviewTopicInput,
                    setInput: setReviewTopicInput,
                    key: 'topicsRequiringReview' as const,
                    placeholder: 'Ex: Polêmicas de estúdios, processos judiciais',
                  },
                ]
              ).map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{group.title}</p>
                  <div className="flex gap-2">
                    <input
                      value={group.input}
                      onChange={(e) => group.setInput(e.target.value)}
                      placeholder={group.placeholder}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = group.input.trim();
                        if (!val) return;
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: { ...p.editorialStrategy, [group.key]: [...p.editorialStrategy[group.key], val] },
                        }));
                        group.setInput('');
                      }}
                      className="rounded-lg border border-primary px-3 py-1 text-xs text-primary"
                    >
                      Adicionar
                    </button>
                  </div>
                  {group.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {group.items.map((item, idx) => (
                        <span key={`${item}-${idx}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px]">
                          {item}
                          <button
                            type="button"
                            onClick={() =>
                              updateForm((p) => ({
                                ...p,
                                editorialStrategy: {
                                  ...p.editorialStrategy,
                                  [group.key]: p.editorialStrategy[group.key].filter((_, i) => i !== idx),
                                },
                              }))
                            }
                            className="text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}

        {/* TAB 3: PUBLICAÇÃO & DISTRIBUIÇÃO */}
        {activeTab === 'publishing' && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <div className="space-y-5">
              <section className="sg-panel space-y-4 rounded-2xl p-5">
                <h3 className="font-medium">Padrões de Publicação no YouTube</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    Visibilidade padrão
                    <select
                      value={form.editorialStrategy.publishing.defaultVisibility}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            publishing: { ...p.editorialStrategy.publishing, defaultVisibility: e.target.value as 'private' | 'unlisted' | 'public' },
                          },
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="private">Privado (mais seguro)</option>
                      <option value="unlisted">Não listado</option>
                      <option value="public">Público</option>
                    </select>
                  </label>
                  <label className="block text-sm">
                    Categoria
                    <select
                      value={form.editorialStrategy.publishing.defaultCategory}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            publishing: { ...p.editorialStrategy.publishing, defaultCategory: e.target.value },
                          },
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {YOUTUBE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Playlist padrão
                    <input
                      value={form.editorialStrategy.publishing.defaultPlaylist}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            publishing: { ...p.editorialStrategy.publishing, defaultPlaylist: e.target.value },
                          },
                        }))
                      }
                      placeholder="Ex: Análises Completas"
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    Fuso horário (IANA)
                    <select
                      value={form.editorialStrategy.publishing.timezone}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            publishing: { ...p.editorialStrategy.publishing, timezone: e.target.value },
                          },
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </label>
                </div>

                <label className="block text-sm">
                  Template de Título (<code className="text-xs">{'{title}'}</code>, <code className="text-xs">{'{channel}'}</code>)
                  <input
                    value={form.editorialStrategy.publishing.titleTemplate}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: { ...p.editorialStrategy, publishing: { ...p.editorialStrategy.publishing, titleTemplate: e.target.value } },
                      }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>

                <label className="block text-sm">
                  Template de Descrição (<code className="text-xs">{'{summary}'}</code>, <code className="text-xs">{'{hashtags}'}</code>)
                  <textarea
                    rows={3}
                    value={form.editorialStrategy.publishing.descriptionTemplate}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: { ...p.editorialStrategy, publishing: { ...p.editorialStrategy.publishing, descriptionTemplate: e.target.value } },
                      }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Tags padrão</p>
                    <div className="mt-1 flex gap-2">
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder="games, rpg"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!tagInput.trim()) return;
                          updateForm((p) => ({
                            ...p,
                            editorialStrategy: {
                              ...p.editorialStrategy,
                              publishing: { ...p.editorialStrategy.publishing, defaultTags: [...p.editorialStrategy.publishing.defaultTags, tagInput.trim()] },
                            },
                          }));
                          setTagInput('');
                        }}
                        className="rounded-lg border border-primary px-2.5 text-xs text-primary"
                      >
                        +
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {form.editorialStrategy.publishing.defaultTags.map((tag, i) => (
                        <span key={`${tag}-${i}`} className="rounded bg-background px-2 py-0.5 text-[11px]">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Hashtags padrão</p>
                    <div className="mt-1 flex gap-2">
                      <input
                        value={hashtagInput}
                        onChange={(e) => setHashtagInput(e.target.value)}
                        placeholder="#games"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!hashtagInput.trim()) return;
                          updateForm((p) => ({
                            ...p,
                            editorialStrategy: {
                              ...p.editorialStrategy,
                              publishing: { ...p.editorialStrategy.publishing, defaultHashtags: [...p.editorialStrategy.publishing.defaultHashtags, hashtagInput.trim()] },
                            },
                          }));
                          setHashtagInput('');
                        }}
                        className="rounded-lg border border-primary px-2.5 text-xs text-primary"
                      >
                        +
                      </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {form.editorialStrategy.publishing.defaultHashtags.map((tag, i) => (
                        <span key={`${tag}-${i}`} className="rounded bg-background px-2 py-0.5 text-[11px]">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-3 text-sm">
                  <label className="flex items-center justify-between">
                    <span>Validar pacote e checklist antes de publicar</span>
                    <input
                      type="checkbox"
                      checked={form.editorialStrategy.publishing.validateBeforePublish}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: { ...p.editorialStrategy, publishing: { ...p.editorialStrategy.publishing, validateBeforePublish: e.target.checked } },
                        }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Geração assistida de metadados (título/tags/capítulos)</span>
                    <input
                      type="checkbox"
                      checked={form.editorialStrategy.publishing.assistedMetadata}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: { ...p.editorialStrategy, publishing: { ...p.editorialStrategy.publishing, assistedMetadata: e.target.checked } },
                        }))
                      }
                    />
                  </label>
                </div>
              </section>

              {/* Recurring Series */}
              <section className="sg-panel space-y-3 rounded-2xl p-5">
                <h3 className="font-medium">Séries Recorrentes (Calendário Editorial)</h3>
                <div className="grid gap-2 sm:grid-cols-4">
                  <input
                    value={seriesTitle}
                    onChange={(e) => setSeriesTitle(e.target.value)}
                    placeholder="Ex: Notícias da Semana"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs sm:col-span-2"
                  />
                  <select
                    value={seriesWeekday}
                    onChange={(e) => setSeriesWeekday(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    {WEEKDAY_OPTIONS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <input
                      type="time"
                      value={seriesTime}
                      onChange={(e) => setSeriesTime(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!seriesTitle.trim()) return;
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            publishing: {
                              ...p.editorialStrategy.publishing,
                              recurringSeries: [
                                ...p.editorialStrategy.publishing.recurringSeries,
                                { id: crypto.randomUUID(), title: seriesTitle.trim(), format: seriesFormat, weekday: seriesWeekday, time: seriesTime, leadDays: 2, active: true },
                              ],
                            },
                          },
                        }));
                        setSeriesTitle('');
                      }}
                      className="rounded-lg bg-primary px-3 text-xs text-primary-foreground"
                    >
                      +
                    </button>
                  </div>
                </div>
                {form.editorialStrategy.publishing.recurringSeries.length > 0 && (
                  <ul className="space-y-1.5">
                    {form.editorialStrategy.publishing.recurringSeries.map((s) => (
                      <li key={s.id} className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 text-xs">
                        <span>
                          <strong>{s.title}</strong> · {s.weekday} às {s.time} ({s.format})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateForm((p) => ({
                              ...p,
                              editorialStrategy: {
                                ...p.editorialStrategy,
                                publishing: {
                                  ...p.editorialStrategy.publishing,
                                  recurringSeries: p.editorialStrategy.publishing.recurringSeries.filter((x) => x.id !== s.id),
                                },
                              },
                            }))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Live Publication Preview */}
            <aside>
              <div className="sg-panel sticky top-4 space-y-3 rounded-2xl p-4">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Eye className="size-3.5 text-primary" />
                  Prévia de Publicação
                </p>
                <div className="rounded-xl border border-border bg-background p-3.5">
                  <p className="text-xs uppercase text-primary">{form.editorialStrategy.publishing.defaultVisibility} · {form.editorialStrategy.publishing.defaultCategory}</p>
                  <h4 className="mt-1 text-sm font-semibold">{titlePreview}</h4>
                  <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{descriptionPreview}</p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* TAB 4: AUTONOMIA & PRODUÇÃO */}
        {activeTab === 'autonomy' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="sg-panel space-y-4 rounded-2xl p-5">
              <h3 className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-primary" />
                Autonomia por Etapa & Governança
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['research', 'Pesquisa'],
                    ['script', 'Roteiro'],
                    ['media', 'Aquisição de Mídia'],
                    ['editing', 'Edição / Timeline'],
                    ['qc', 'Controle de Qualidade (QC)'],
                    ['publish', 'Publicação Externa'],
                  ] as const
                ).map(([stage, label]) => (
                  <label key={stage} className="block text-xs">
                    {label}
                    <select
                      value={form.editorialStrategy.production.stageAutonomy[stage]}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            production: {
                              ...p.editorialStrategy.production,
                              stageAutonomy: { ...p.editorialStrategy.production.stageAutonomy, [stage]: e.target.value as AutonomyMode },
                            },
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                    >
                      <option value="manual">Manual</option>
                      <option value="assisted">Assistido</option>
                      <option value="autonomous">Autônomo</option>
                    </select>
                  </label>
                ))}
              </div>

              <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-sm">
                <label className="flex items-center justify-between gap-3">
                  <span>Exigir aprovação humana antes de publicação externa</span>
                  <input
                    type="checkbox"
                    checked={form.editorialStrategy.production.requireHumanApprovalForExternalPublish}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: {
                          ...p.editorialStrategy,
                          production: {
                            ...p.editorialStrategy.production,
                            requireHumanApprovalForExternalPublish: e.target.checked,
                            ...(e.target.checked ? { explicitExternalAutoPublishAuthorized: false } : {}),
                          },
                        },
                      }))
                    }
                  />
                </label>
                {!form.editorialStrategy.production.requireHumanApprovalForExternalPublish && (
                  <label className="flex items-center justify-between gap-3 text-xs text-amber-300">
                    <span>Confirmo autorização explícita para publicação automática deste canal</span>
                    <input
                      type="checkbox"
                      checked={form.editorialStrategy.production.explicitExternalAutoPublishAuthorized}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            production: { ...p.editorialStrategy.production, explicitExternalAutoPublishAuthorized: e.target.checked },
                          },
                        }))
                      }
                    />
                  </label>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs">
                  Orçamento / execução (USD)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={form.budgetUsd}
                    onChange={(e) => updateForm((p) => ({ ...p, budgetUsd: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  Execuções simultâneas
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={form.concurrencyLimit}
                    onChange={(e) => updateForm((p) => ({ ...p, concurrencyLimit: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  Alerta de custo (USD)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={form.editorialStrategy.production.costAlertThresholdUsd}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: {
                          ...p.editorialStrategy,
                          production: { ...p.editorialStrategy.production, costAlertThresholdUsd: Number(e.target.value) },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  />
                </label>
              </div>
            </section>

            <section className="sg-panel space-y-4 rounded-2xl p-5">
              <h3 className="font-medium">Perfis Técnicos & Fallback de Agentes</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  Perfil de Renderização
                  <select
                    value={form.editorialStrategy.production.renderProfile}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: {
                          ...p.editorialStrategy,
                          production: { ...p.editorialStrategy.production, renderProfile: e.target.value as ChannelFormState['editorialStrategy']['production']['renderProfile'] },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="1080p_60">1080p 60fps</option>
                    <option value="1080p_30">1080p 30fps</option>
                    <option value="4k_60">4K 60fps</option>
                    <option value="shorts_vertical">Shorts Vertical 1080x1920</option>
                  </select>
                </label>
                <label className="block text-xs">
                  Voz / Narração
                  {voices.length > 0 ? (
                    <select
                      value={form.editorialStrategy.production.voiceProfile}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            production: { ...p.editorialStrategy.production, voiceProfile: e.target.value },
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                    >
                      {voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.engine})</option>)}
                    </select>
                  ) : (
                    <input
                      value={form.editorialStrategy.production.voiceProfile}
                      onChange={(e) =>
                        updateForm((p) => ({
                          ...p,
                          editorialStrategy: {
                            ...p.editorialStrategy,
                            production: { ...p.editorialStrategy.production, voiceProfile: e.target.value },
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                    />
                  )}
                </label>
                <label className="block text-xs">
                  Perfil SFX
                  <select
                    value={form.editorialStrategy.production.sfxProfile}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: {
                          ...p.editorialStrategy,
                          production: { ...p.editorialStrategy.production, sfxProfile: e.target.value as ChannelFormState['editorialStrategy']['production']['sfxProfile'] },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="subtle">Sutil</option>
                    <option value="cinematic">Cinematográfico</option>
                    <option value="energetic">Energético</option>
                    <option value="none">Sem SFX automático</option>
                  </select>
                </label>
                <label className="block text-xs">
                  Qualidade Final
                  <select
                    value={form.editorialStrategy.production.qualityPreset}
                    onChange={(e) =>
                      updateForm((p) => ({
                        ...p,
                        editorialStrategy: {
                          ...p.editorialStrategy,
                          production: { ...p.editorialStrategy.production, qualityPreset: e.target.value as ChannelFormState['editorialStrategy']['production']['qualityPreset'] },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="draft">Rascunho Rápido</option>
                    <option value="standard">Padrão YouTube</option>
                    <option value="master">Master Alta Taxa</option>
                  </select>
                </label>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Provedores permitidos no fallback (funciona com 1, 2 ou 3)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['claude', 'codex', 'antigravity'] as const).map((provider) => {
                    const active = form.editorialStrategy.production.agentFallbackOrder.includes(provider);
                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() =>
                          updateForm((p) => {
                            const current = p.editorialStrategy.production.agentFallbackOrder;
                            const next = active ? current.filter((x) => x !== provider) : [...current, provider];
                            if (next.length === 0) return p;
                            return {
                              ...p,
                              editorialStrategy: {
                                ...p.editorialStrategy,
                                production: { ...p.editorialStrategy.production, agentFallbackOrder: next },
                              },
                            };
                          })
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs uppercase ${
                          active ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'
                        }`}
                      >
                        {provider}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 0: ESTÚDIO DE PUBLICAÇÃO MULTIPLATAFORMA & YOUTUBE LONG-FORM */}
        {activeTab === 'studio' && (
          <YouTubeLongFormPublishingStudio
            youtubeConnected={Boolean(oauthStatus.data?.connected)}
            channelId={form.id || 'main_yt'}
            channelName={form.name || 'Canal Principal'}
          />
        )}

        {/* TAB 5: AJUDA & AUDITORIA */}
        {activeTab === 'help' && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="sg-panel space-y-3 rounded-2xl p-5">
              <h3 className="font-medium">Checklist de Prontidão do Canal ({completeness.scorePct}%)</h3>
              {completeness.missingRequired.length === 0 ? (
                <p className="text-sm text-emerald-300">Todos os campos obrigatórios para produção estão preenchidos.</p>
              ) : (
                <ul className="space-y-1 text-sm text-amber-300">
                  {completeness.missingRequired.map((item) => <li key={item}>• Obrigatório: {item}</li>)}
                </ul>
              )}
              {completeness.missingRecommended.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {completeness.missingRecommended.map((item) => <li key={item}>• Recomendado: {item}</li>)}
                </ul>
              )}
            </section>

            <section className="sg-panel space-y-3 rounded-2xl p-5">
              <h3 className="font-medium">Separação de Responsabilidades</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li><strong className="text-foreground">Global (Configurações do Aethera):</strong> Chaves de API (OAuth `client_secret`, IGDB, RAWG), hardware FFmpeg/GPU e cofre de segredos.</li>
                <li><strong className="text-foreground">Por Canal (esta tela):</strong> Identidade, Brand Kit, tom editorial, política de fontes, templates de publicação e autonomia padrão.</li>
                <li><strong className="text-foreground">Por Projeto:</strong> Briefing específico, roteiro, mídias da timeline, render e aprovação do pacote.</li>
              </ul>
            </section>
          </div>
        )}
      </main>

      <SetupTutorialDrawer
        integrationId={tutorialOpen ? 'youtube' : null}
        onClose={() => setTutorialOpen(false)}
        onTestConnection={async () => {
          try {
            const prof = await window.neuralbridge.video.channelProfile();
            return { ok: true, message: `Conectado ao canal: ${prof.title}` };
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : 'Canal YouTube não conectado.' };
          }
        }}
      />
    </>
  );
}
