import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, ThemeSource } from '@neuralbridge/shared/channels';
import {
  Bot,
  Calendar,
  CheckCircle2,
  Clapperboard,
  Database,
  Download,
  Film,
  Gamepad2,
  GraduationCap,
  HelpCircle,
  Mic,
  RotateCcw,
  Shield,
  Sliders,
  Tv,
} from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/app/PageHeader';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AETHERA_ALLOWED_SETTINGS_CATEGORIES,
  type AetheraSettingsCategoryId,
} from '@/app/app-settings-isolation';
import { MediaSourcesSettings } from './MediaSourcesSettings';
import { SetupTutorialDrawer } from './SetupTutorialDrawer';
import type { TutorialIntegrationId } from './settings-tutorials';

interface CategoryMeta {
  id: AetheraSettingsCategoryId;
  label: string;
  subtitle: string;
  icon: typeof Sliders;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'general', label: 'Geral', subtitle: 'Idioma, aparência, diretórios e preferências', icon: Sliders },
  { id: 'youtube', label: 'YouTube', subtitle: 'OAuth, canal, uploads e agendamentos', icon: Tv },
  { id: 'twitch_igdb', label: 'Twitch / IGDB', subtitle: 'Client ID, Client Secret e pesquisa de jogos', icon: Gamepad2 },
  { id: 'rawg', label: 'RAWG e fontes de pesquisa', subtitle: 'Chaves de API e provedores de informações', icon: Database },
  { id: 'media_sources', label: 'Fontes de mídia', subtitle: 'Steam, YouTube, Pexels, Pixabay, anime e datasets', icon: Film },
  { id: 'ai_agents', label: 'Agentes e IA', subtitle: 'Claude, Codex, Antigravity, modelos e fallback', icon: Bot },
  { id: 'voice_studio', label: 'Narração e voz', subtitle: 'Voice Studio, vozes, TTS e áudio', icon: Mic },
  { id: 'production', label: 'Produção audiovisual', subtitle: 'Renderização, FFmpeg, GPU, SFX, VFX e presets', icon: Clapperboard },
  { id: 'academy', label: 'Academy', subtitle: 'Materiais de estudo, aprendizado e regras editoriais', icon: GraduationCap },
  { id: 'publications', label: 'Publicações', subtitle: 'Fuso horário, calendário e automações de publicação', icon: Calendar },
  { id: 'security', label: 'Segurança e credenciais', subtitle: 'Conexões, permissões e armazenamento seguro', icon: Shield },
];

const THEME_OPTIONS: { value: ThemeSource; label: string; hint: string }[] = [
  { value: 'dark', label: 'Escuro', hint: 'Padrão cinematográfico do Aethera Studio.' },
  { value: 'light', label: 'Claro', hint: 'Para ambientes bem iluminados.' },
  { value: 'system', label: 'Sistema', hint: 'Acompanha o tema do Windows.' },
];

interface AetheraBridgeLoose {
  cinemaCapabilities?: () => Promise<{
    ffmpeg: boolean;
    ffprobe: boolean;
    ytdlp?: boolean;
    nvenc: boolean;
    remotion?: boolean;
  }>;
  cinemaListVoices?: () => Promise<Array<{ id: string; name: string; engine: string; locale: string }>>;
  cinemaAcademySnapshot?: () => Promise<{
    materials: unknown[];
    knowledge: unknown[];
    exercises: unknown[];
  }>;
  cinemaEvolutionSnapshot?: () => Promise<{
    extraEngines?: Array<{ installed?: boolean; authenticated?: boolean | null; problems?: string[] }>;
  }>;
  cinemaCalendarSnapshot?: () => Promise<{
    defaultTimezone: string;
    events: unknown[];
    series: unknown[];
  }>;
  systemEstimateBackup?: () => Promise<{
    totalBytes: number;
    compressedEstimateBytes: number;
    complete: boolean;
    missingFiles: Array<{ source: string; path: string }>;
    excludedSecrets: string[];
    counts: {
      cinemaProjects: number;
      managedLibraryFiles?: number;
      externalBundledFiles?: number;
      cinemaLibraryFiles?: number;
      libraryAssets?: number;
      academyMaterials: number;
      evolutionMemories: number;
      calendarEvents: number;
    };
  }>;
  systemExportBackup?: (input?: { allowIncomplete?: boolean }) => Promise<{
    ok: boolean;
    complete?: boolean;
    canceled?: boolean;
    filePath?: string;
    totalBytes?: number;
    missingFiles?: Array<{ source: string; path: string }>;
    counts?: {
      cinemaProjects: number;
      cinemaLibraryFiles?: number;
      managedLibraryFiles?: number;
      externalBundledFiles?: number;
      libraryAssets?: number;
      academyMaterials: number;
      evolutionMemories: number;
      calendarEvents: number;
    };
  }>;
  systemRestoreBackup?: (input?: {
    filePath?: string;
    sections?: Record<string, boolean>;
    conflictMode?: 'rename' | 'skip' | 'overwrite';
  }) => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    relaunching?: boolean;
    remappedReferences?: number;
    conflicts?: string[];
    counts?: {
      cinemaProjects: number;
      cinemaLibraryFiles?: number;
      libraryAssets?: number;
      academyMaterials: number;
      evolutionMemories: number;
      calendarEvents: number;
    };
  }>;
}

export function AetheraSettingsPage({ description }: { description: string }) {
  const [activeCat, setActiveCat] = useState<AetheraSettingsCategoryId>('general');
  const [tutorialId, setTutorialId] = useState<TutorialIntegrationId | null>(null);
  const [highlightedFieldId, setHighlightedFieldId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // General
  const [theme, setTheme] = useState<ThemeSource>('dark');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  // IGDB
  const [igdbStatus, setIgdbStatus] = useState<{ configured: boolean; clientIdHint: string | null }>({
    configured: false,
    clientIdHint: null,
  });
  const [igdbClientId, setIgdbClientId] = useState('');
  const [igdbClientSecret, setIgdbClientSecret] = useState('');

  // RAWG & Collage
  const [rawgConfigured, setRawgConfigured] = useState(false);
  const [rawgApiKey, setRawgApiKey] = useState('');
  // Claude Gateway
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [gatewayConfigured, setGatewayConfigured] = useState(false);
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState('https://resgatar.online/ia');
  const [gatewayModel, setGatewayModel] = useState('claude-opus-5-5');
  const [gatewayToken, setGatewayToken] = useState('');
  const [collageConfigured, setCollageConfigured] = useState(false);
  const [collageApiKey, setCollageApiKey] = useState('');

  // YouTube
  const [ytChannel, setYtChannel] = useState<{ connected: boolean; title?: string; error?: string }>({
    connected: false,
  });

  // Voices, Capabilities, Academy, Calendar
  const [voices, setVoices] = useState<Array<{ id: string; name: string; engine: string; locale: string }>>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [capabilities, setCapabilities] = useState<{
    ffmpeg: boolean;
    ffprobe: boolean;
    ytdlp?: boolean;
    nvenc: boolean;
    remotion?: boolean;
  } | null>(null);
  const [academyCounts, setAcademyCounts] = useState({ materials: 0, knowledge: 0, exercises: 0 });
  const [calendarMeta, setCalendarMeta] = useState({ timezone: 'America/Sao_Paulo', events: 0, series: 0 });
  const [systemBackupBusy, setSystemBackupBusy] = useState<'export' | 'restore' | null>(null);

  const getAetheraBridge = (): AetheraBridgeLoose => {
    const win = window as unknown as {
      aetheraBridge?: AetheraBridgeLoose;
      aethera?: AetheraBridgeLoose;
    };
    return (win.aetheraBridge ?? win.aethera ?? {}) as AetheraBridgeLoose;
  };

  const refreshAll = useCallback(async () => {
    const nb = window.neuralbridge;
    const ab = getAetheraBridge();

    nb?.theme?.get?.().then(setTheme).catch(() => {});
    nb?.app?.info?.().then(setAppInfo).catch(() => {});
    nb?.video?.studioIgdbStatus?.().then(setIgdbStatus).catch(() => {});
    nb?.video?.studioRawgStatus?.().then((r: { configured?: boolean }) => setRawgConfigured(Boolean(r?.configured))).catch(() => {});
    nb?.video?.studioClaudeGatewayStatus?.()
      .then((r: { enabled?: boolean; configured?: boolean; baseUrl?: string; model?: string }) => {
        setGatewayEnabled(Boolean(r?.enabled));
        setGatewayConfigured(Boolean(r?.configured));
        if (r?.baseUrl) setGatewayBaseUrl(r.baseUrl);
        if (r?.model) setGatewayModel(r.model);
      })
      .catch(() => {});
    nb?.video?.collageKeyStatus?.().then((r: { configured?: boolean }) => setCollageConfigured(Boolean(r?.configured))).catch(() => {});
    nb?.video?.channelProfile?.()
      .then((p) => setYtChannel({ connected: Boolean(p?.title), ...(p?.title ? { title: p.title } : {}) }))
      .catch(() => setYtChannel({ connected: false }));

    ab.cinemaCapabilities?.().then(setCapabilities).catch(() => {});
    ab.cinemaListVoices?.().then((list) => {
      if (Array.isArray(list)) {
        setVoices(list);
        if (list[0] && !selectedVoiceId) setSelectedVoiceId(list[0].id);
      }
    }).catch(() => {});
    ab.cinemaAcademySnapshot?.().then((snap) => {
      setAcademyCounts({
        materials: snap.materials?.length ?? 0,
        knowledge: snap.knowledge?.length ?? 0,
        exercises: snap.exercises?.length ?? 0,
      });
    }).catch(() => {});
    ab.cinemaCalendarSnapshot?.().then((cal) => {
      setCalendarMeta({
        timezone: cal.defaultTimezone || 'America/Sao_Paulo',
        events: cal.events?.length ?? 0,
        series: cal.series?.length ?? 0,
      });
    }).catch(() => {});
  }, [selectedVoiceId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleThemeChange = async (value: string) => {
    const next = THEME_OPTIONS.find((o) => o.value === value)?.value;
    if (!next) return;
    setTheme(next);
    try {
      await window.neuralbridge?.theme?.set?.(next);
      setStatusMessage({ kind: 'ok', text: `Tema alterado para ${next}.` });
    } catch {
      setStatusMessage({ kind: 'error', text: 'Não foi possível salvar o tema.' });
    }
  };

  const [backupEstimate, setBackupEstimate] = useState<{
    totalBytes: number;
    compressedEstimateBytes: number;
    complete: boolean;
    missingCount: number;
  } | null>(null);

  const handleEstimateSystemBackup = async () => {
    const ab = getAetheraBridge();
    if (!ab.systemEstimateBackup) return;
    try {
      const est = await ab.systemEstimateBackup();
      setBackupEstimate({
        totalBytes: est.totalBytes,
        compressedEstimateBytes: est.compressedEstimateBytes,
        complete: est.complete,
        missingCount: est.missingFiles.length,
      });
    } catch {
      // ignore estimate error
    }
  };

  const handleExportSystemBackup = async () => {
    const ab = getAetheraBridge();
    if (!ab.systemExportBackup) {
      setStatusMessage({ kind: 'error', text: 'Backup Geral indisponível neste ambiente.' });
      return;
    }
    setSystemBackupBusy('export');
    try {
      if (ab.systemEstimateBackup) {
        const est = await ab.systemEstimateBackup();
        setBackupEstimate({
          totalBytes: est.totalBytes,
          compressedEstimateBytes: est.compressedEstimateBytes,
          complete: est.complete,
          missingCount: est.missingFiles.length,
        });
      }
      const res = await ab.systemExportBackup();
      if (res?.canceled) return;
      if (!res?.ok) {
        const missingCount = res?.missingFiles?.length ?? 0;
        setStatusMessage({
          kind: 'error',
          text:
            missingCount > 0
              ? `Backup recusado como completo: ${missingCount} arquivo(s) referenciado(s) estão ausentes no disco.`
              : 'Não foi possível exportar o Backup Geral do Sistema.',
        });
        return;
      }
      const c = res.counts;
      const mb = res.totalBytes ? ` (${(res.totalBytes / (1024 * 1024)).toFixed(2)} MB)` : '';
      setStatusMessage({
        kind: 'ok',
        text: `Backup Geral .zip salvo em ${res.filePath ?? 'arquivo selecionado'}${mb} — ${c?.cinemaProjects ?? 0} projetos, ${c?.managedLibraryFiles ?? 0} mídias internas, ${c?.externalBundledFiles ?? 0} externas empacotadas, ${c?.libraryAssets ?? 0} registros na biblioteca, ${c?.academyMaterials ?? 0} materiais da Academy, ${c?.evolutionMemories ?? 0} memórias, ${c?.calendarEvents ?? 0} eventos.`,
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao exportar Backup Geral do Sistema.',
      });
    } finally {
      setSystemBackupBusy(null);
    }
  };

  const handleRestoreSystemBackup = async () => {
    const ab = getAetheraBridge();
    if (!ab.systemRestoreBackup) {
      setStatusMessage({ kind: 'error', text: 'Restauração geral indisponível neste ambiente.' });
      return;
    }
    setSystemBackupBusy('restore');
    try {
      const res = await ab.systemRestoreBackup({ conflictMode: 'rename' });
      if (res?.canceled) return;
      if (!res?.ok) {
        setStatusMessage({ kind: 'error', text: 'Não foi possível restaurar o Backup Geral do Sistema.' });
        return;
      }
      await refreshAll();
      const remapInfo = res.remappedReferences ? ` · ${res.remappedReferences} referência(s) reconstruída(s)` : '';
      setStatusMessage({
        kind: 'ok',
        text: res.relaunching
          ? `Backup Geral restaurado com verificação SHA-256${remapInfo}. Reiniciando o Aethera Studio…`
          : `Backup Geral restaurado a partir de ${res.filePath ?? 'arquivo selecionado'}${remapInfo}.`,
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao restaurar Backup Geral do Sistema.',
      });
    } finally {
      setSystemBackupBusy(null);
    }
  };

  const handleSaveIgdb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!igdbClientId.trim() || !igdbClientSecret.trim()) {
      setStatusMessage({ kind: 'error', text: 'Informe Client ID e Client Secret da Twitch/IGDB.' });
      return;
    }
    try {
      await window.neuralbridge.video.studioIgdbSave({
        clientId: igdbClientId.trim(),
        clientSecret: igdbClientSecret.trim(),
      });
      setIgdbClientId('');
      setIgdbClientSecret('');
      await refreshAll();
      setStatusMessage({ kind: 'ok', text: 'Credenciais Twitch / IGDB criptografadas e salvas.' });
    } catch (err) {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao salvar IGDB.' });
    }
  };

  const handleClearIgdb = async () => {
    await window.neuralbridge.video.studioIgdbClear();
    await refreshAll();
    setStatusMessage({ kind: 'ok', text: 'Credenciais Twitch / IGDB removidas do cofre local.' });
  };

  const handleSaveRawg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawgApiKey.trim()) return;
    try {
      await window.neuralbridge.video.studioRawgSave(rawgApiKey.trim());
      setRawgApiKey('');
      await refreshAll();
      setStatusMessage({ kind: 'ok', text: 'Chave RAWG salva com segurança.' });
    } catch (err) {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao salvar RAWG.' });
    }
  };

  const handleSaveClaudeGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.neuralbridge.video.studioClaudeGatewaySave({
        enabled: gatewayEnabled,
        baseUrl: gatewayBaseUrl.trim() || 'https://resgatar.online/ia',
        ...(gatewayToken.trim() ? { authToken: gatewayToken.trim() } : {}),
        model: gatewayModel.trim() || 'claude-opus-5-5',
      });
      setGatewayToken('');
      await refreshAll();
      setStatusMessage({
        kind: 'ok',
        text: gatewayEnabled
          ? 'Claude Gateway salvo e ativado para roteiro, pesquisa, direção e visão.'
          : 'Claude Gateway salvo (desativado — usando perfil oficial).',
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao salvar Claude Gateway.',
      });
    }
  };

  const handleClearClaudeGateway = async () => {
    try {
      await window.neuralbridge.video.studioClaudeGatewayClear();
      setGatewayToken('');
      setGatewayEnabled(false);
      setGatewayConfigured(false);
      await refreshAll();
      setStatusMessage({ kind: 'ok', text: 'Credenciais do Claude Gateway removidas.' });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Erro ao limpar Claude Gateway.',
      });
    }
  };

  const handleSaveCollage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collageApiKey.trim()) return;
    try {
      await window.neuralbridge.video.collageKeySave(collageApiKey.trim());
      setCollageApiKey('');
      await refreshAll();
      setStatusMessage({ kind: 'ok', text: 'Chave de mídia externa (Collage/Pexels) salva.' });
    } catch (err) {
      setStatusMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Erro ao salvar chave.' });
    }
  };

  const handleTestConnection = async (id: TutorialIntegrationId): Promise<{ ok: boolean; message: string }> => {
    const nb = window.neuralbridge;
    const ab = getAetheraBridge();

    if (id === 'youtube') {
      try {
        const prof = await nb.video.channelProfile();
        if (prof?.title) {
          setYtChannel({ connected: true, title: prof.title });
          return { ok: true, message: `Canal YouTube conectado: ${prof.title}.` };
        }
        return { ok: false, message: 'Nenhum canal autenticado. Conecte um canal OAuth em Publicação.' };
      } catch (err) {
        return { ok: false, message: `Autenticação YouTube expirada ou indisponível: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    if (id === 'twitch_igdb') {
      const st = await nb.video.studioIgdbStatus();
      setIgdbStatus(st);
      return st.configured
        ? { ok: true, message: `Credenciais IGDB ativas (${st.clientIdHint ?? 'mascarado'}).` }
        : { ok: false, message: 'Credenciais Twitch/IGDB ausentes. Preencha Client ID e Client Secret.' };
    }
    if (id === 'rawg') {
      const st = await nb.video.studioRawgStatus();
      setRawgConfigured(Boolean(st.configured));
      return st.configured
        ? { ok: true, message: 'Chave RAWG configurada e pronta no cofre local.' }
        : { ok: false, message: 'RAWG API Key não configurada.' };
    }
    if (id === 'voice_studio') {
      const list = (await ab.cinemaListVoices?.()) ?? [];
      setVoices(list);
      return list.length > 0
        ? { ok: true, message: `${list.length} voz(es) disponíveis no Voice Studio.` }
        : { ok: false, message: 'Nenhuma voz TTS retornada pelo backend.' };
    }
    if (id === 'production') {
      const cap = await ab.cinemaCapabilities?.();
      if (cap) setCapabilities(cap);
      return cap?.ffmpeg && cap?.ffprobe
        ? { ok: true, message: `FFmpeg e FFprobe ativos · NVENC: ${cap.nvenc ? 'Disponível' : 'CPU'}.` }
        : { ok: false, message: 'FFmpeg ou FFprobe não encontrado no ambiente local.' };
    }
    // ai_agents
    const [agentsRes, evoSnap] = await Promise.all([
      nb.agents?.status?.(false).catch(() => []),
      ab.cinemaEvolutionSnapshot?.().catch(() => null),
    ]);
    const baseReady = Array.isArray(agentsRes)
      ? agentsRes.filter((a) => Boolean((a as { installed?: boolean; authenticated?: boolean }).installed)).length
      : 0;
    const extraEngines = (evoSnap as { extraEngines?: Array<{ installed?: boolean; authenticated?: boolean | null; problems?: string[] }> } | null)?.extraEngines ?? [];
    const extraReady = extraEngines.filter(
      (e) => Boolean(e.installed) && e.authenticated !== false && (e.problems?.length ?? 0) === 0,
    ).length;
    const ready = baseReady + extraReady;
    return ready > 0
      ? { ok: true, message: `${ready} provedor(es) de IA prontos para roteiro e direção.` }
      : { ok: false, message: 'Nenhum provedor de IA autenticado no momento. Verifique Claude/Codex/Antigravity/Gateway.' };
  };

  const visibleCategories = CATEGORIES.filter((c) => AETHERA_ALLOWED_SETTINGS_CATEGORIES.includes(c.id));
  const fieldRing = (id: string) =>
    highlightedFieldId === id ? 'ring-2 ring-purple-400 border-purple-400' : 'border-border';

  return (
    <>
      <PageHeader
        title="Configurações — Aethera Studio"
        description={description || 'Gerencie produção audiovisual, inteligência artificial e integrações isoladas do estúdio.'}
      />
      <main className="px-6 py-6 xl:px-8 space-y-4">
        {statusMessage && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-2.5 text-xs ${
              statusMessage.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <div className={`grid gap-6 ${tutorialId ? 'lg:grid-cols-[260px_1fr_360px]' : 'lg:grid-cols-[260px_1fr]'}`}>
          {/* Left Category Nav */}
          <nav aria-label="Categorias de configurações do Aethera Studio" className="rounded-2xl border border-border bg-card p-3 space-y-1 h-fit">
            {visibleCategories.map((cat) => {
              const Icon = cat.icon;
              const active = activeCat === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCat(cat.id)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? 'bg-purple-500/15 text-foreground border border-purple-500/40' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <Icon className={`mt-0.5 size-4 shrink-0 ${active ? 'text-purple-300' : ''}`} />
                  <div>
                    <p className="text-xs font-semibold">{cat.label}</p>
                    <p className="text-[11px] opacity-75 line-clamp-1">{cat.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Center Panel */}
          <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
            {activeCat === 'general' && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">Geral e Aparência</h2>
                <RadioGroup value={theme} onValueChange={(v) => void handleThemeChange(v)} className="gap-2">
                  {THEME_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      htmlFor={`aethera-theme-${opt.value}`}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-[#0d0d17] px-3.5 py-2.5 text-xs hover:border-primary/40"
                    >
                      <RadioGroupItem id={`aethera-theme-${opt.value}`} value={opt.value} />
                      <span className="font-medium text-foreground">{opt.label}</span>
                      <span className="text-muted-foreground">{opt.hint}</span>
                    </label>
                  ))}
                </RadioGroup>
                {appInfo && (
                  <div className="rounded-xl border border-border bg-[#0d0d17] p-4 text-xs text-muted-foreground space-y-1">
                    <p>Aplicativo: <strong className="text-foreground">Aethera Studio</strong> ({appInfo.version})</p>
                    <p>Electron {appInfo.electron} · {appInfo.platform}</p>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-[#0d0d17] p-4 space-y-3 text-xs">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Backup Geral do Sistema (.zip portátil)</h3>
                    <p className="mt-1 text-muted-foreground">
                      Exporta em pacote <code>.zip</code> com manifesto SHA-256 o banco de dados, configurações (sem
                      tokens ou senhas), Biblioteca Interna de Mídia, mídias referenciadas, Aethera Academy, Memória
                      Evolutiva, Calendário Editorial e projetos do Cinema. Na restauração, valida hashes, reconstrói
                      caminhos relativos e preserva dados existentes.
                    </p>
                    {backupEstimate && (
                      <p className="mt-2 text-muted-foreground">
                        Tamanho estimado: <strong className="text-foreground">{(backupEstimate.compressedEstimateBytes / (1024 * 1024)).toFixed(2)} MB</strong>{' '}
                        ({(backupEstimate.totalBytes / (1024 * 1024)).toFixed(2)} MB sem compressão)
                        {!backupEstimate.complete ? ` · ${backupEstimate.missingCount} arquivo(s) ausente(s)` : ' · todos os arquivos presentes'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={systemBackupBusy !== null}
                      onClick={() => void handleEstimateSystemBackup()}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Calcular tamanho
                    </button>
                    <button
                      type="button"
                      disabled={systemBackupBusy !== null}
                      onClick={() => void handleExportSystemBackup()}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <Download className="size-4" />
                      {systemBackupBusy === 'export' ? 'Exportando .zip…' : 'Backup Geral (.zip)'}
                    </button>
                    <button
                      type="button"
                      disabled={systemBackupBusy !== null}
                      onClick={() => void handleRestoreSystemBackup()}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 font-medium text-foreground hover:border-primary/50 disabled:opacity-50"
                    >
                      <RotateCcw className="size-4" />
                      {systemBackupBusy === 'restore' ? 'Validando e restaurando…' : 'Restaurar (.zip / .json)'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeCat === 'youtube' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">YouTube — API, OAuth e Canal</h2>
                    <p className="text-xs text-muted-foreground">Gerencie autenticação OAuth para uploads e agendamentos.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('youtube')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>

                <div
                  id="youtube-connect-action"
                  className={`rounded-xl border bg-[#0d0d17] p-4 space-y-3 text-xs ${fieldRing('youtube-connect-action')}`}
                >
                  <div className="flex items-center justify-between">
                    <span>Status da conexão:</span>
                    <span className={ytChannel.connected ? 'text-emerald-300 font-medium' : 'text-amber-300'}>
                      {ytChannel.connected ? `Conectado (${ytChannel.title})` : 'Não conectado'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void window.neuralbridge.video
                          .channelOAuthImportClient()
                          .then((res) =>
                            setStatusMessage({
                              kind: 'ok',
                              text: `client_secret.json importado (${res.clientId.slice(0, 18)}…).`,
                            }),
                          )
                          .catch((err) => {
                            const msg = err instanceof Error ? err.message : 'Falha ao importar client_secret.json.';
                            if (!msg.startsWith('cancelled:')) setStatusMessage({ kind: 'error', text: msg });
                          })
                      }
                      className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground"
                    >
                      Importar client_secret.json
                    </button>
                    <Link
                      to="/aethera/channels/new"
                      className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:border-primary/50"
                    >
                      Gerenciar Canais & OAuth
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleTestConnection('youtube').then((r) => setStatusMessage({ kind: r.ok ? 'ok' : 'error', text: r.message }))}
                      className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:border-primary/50"
                    >
                      Testar conexão
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeCat === 'twitch_igdb' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Twitch / IGDB</h2>
                    <p className="text-xs text-muted-foreground">Credenciais para pesquisa oficial de jogos e metadados.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('twitch_igdb')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>

                <form onSubmit={(e) => void handleSaveIgdb(e)} className="space-y-3 text-xs">
                  <div className="rounded-xl border border-border bg-[#0d0d17] p-3 flex items-center justify-between">
                    <span>Estado atual:</span>
                    <span className={igdbStatus.configured ? 'text-emerald-300 font-medium' : 'text-muted-foreground'}>
                      {igdbStatus.configured ? `Configurado (${igdbStatus.clientIdHint ?? 'mascarado'})` : 'Não configurado'}
                    </span>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-muted-foreground">Twitch Client ID</span>
                    <input
                      id="igdb-client-id"
                      value={igdbClientId}
                      onChange={(e) => setIgdbClientId(e.target.value)}
                      placeholder="Cole o Client ID da aplicação Twitch"
                      className={`w-full rounded-xl border bg-[#0d0d17] px-3 py-2 text-xs text-foreground ${fieldRing('igdb-client-id')}`}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground">Twitch Client Secret (mascarado)</span>
                    <input
                      id="igdb-client-secret"
                      type="password"
                      value={igdbClientSecret}
                      onChange={(e) => setIgdbClientSecret(e.target.value)}
                      placeholder="••••••••••••••••"
                      className={`w-full rounded-xl border bg-[#0d0d17] px-3 py-2 text-xs text-foreground ${fieldRing('igdb-client-secret')}`}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">
                      Salvar Credenciais
                    </button>
                    {igdbStatus.configured && (
                      <button
                        type="button"
                        onClick={() => void handleClearIgdb()}
                        className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-200"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {activeCat === 'media_sources' && <MediaSourcesSettings />}

            {activeCat === 'rawg' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">RAWG e Fontes Externas</h2>
                    <p className="text-xs text-muted-foreground">Chaves criptografadas para pesquisa de jogos e B-roll.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('rawg')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>

                <form onSubmit={(e) => void handleSaveRawg(e)} className="space-y-2.5 text-xs rounded-xl border border-border bg-[#0d0d17] p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">RAWG API Key</span>
                    <span className={rawgConfigured ? 'text-emerald-300' : 'text-muted-foreground'}>
                      {rawgConfigured ? 'Configurada (mascarada)' : 'Não configurada'}
                    </span>
                  </div>
                  <input
                    id="rawg-api-key"
                    type="password"
                    value={rawgApiKey}
                    onChange={(e) => setRawgApiKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className={`w-full rounded-xl border bg-[#090912] px-3 py-2 text-xs text-foreground ${fieldRing('rawg-api-key')}`}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground">
                      Salvar RAWG
                    </button>
                    <button
                      id="rawg-test-action"
                      type="button"
                      onClick={() => void handleTestConnection('rawg').then((r) => setStatusMessage({ kind: r.ok ? 'ok' : 'error', text: r.message }))}
                      className={`rounded-lg border px-3 py-1.5 text-foreground ${fieldRing('rawg-test-action')}`}
                    >
                      Testar conexão
                    </button>
                  </div>
                </form>

                <form onSubmit={(e) => void handleSaveCollage(e)} className="space-y-2.5 text-xs rounded-xl border border-border bg-[#0d0d17] p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Pexels / Collage API Key (B-roll)</span>
                    <span className={collageConfigured ? 'text-emerald-300' : 'text-muted-foreground'}>
                      {collageConfigured ? 'Configurada (mascarada)' : 'Não configurada'}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={collageApiKey}
                    onChange={(e) => setCollageApiKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full rounded-xl border border-border bg-[#090912] px-3 py-2 text-xs text-foreground"
                  />
                  <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground">
                    Salvar Chave de B-roll
                  </button>
                </form>
              </div>
            )}

            {activeCat === 'ai_agents' && (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Agentes e Provedores de IA</h2>
                    <p className="text-muted-foreground">Infraestrutura compartilhada de modelos com fallback RF-07.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('ai_agents')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to="/agents" className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">
                    Abrir Painel de Diretores & Agentes
                  </Link>
                  <button
                    id="ai-agents-test-action"
                    type="button"
                    onClick={() => void handleTestConnection('ai_agents').then((r) => setStatusMessage({ kind: r.ok ? 'ok' : 'error', text: r.message }))}
                    className={`rounded-xl border px-4 py-2 ${fieldRing('ai-agents-test-action')}`}
                  >
                    Testar provedores
                  </button>
                </div>

                <form
                  onSubmit={(e) => void handleSaveClaudeGateway(e)}
                  className="space-y-3 rounded-xl border border-border bg-[#0d0d17] p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Claude Gateway (Resgatar.online / Anthropic-compatible)</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Quando ativado, o agente Claude usa esta URL, token e modelo em roteiro, pesquisa, direção e análise visual.
                      </p>
                    </div>
                    <span className={gatewayConfigured ? 'text-emerald-300' : 'text-muted-foreground'}>
                      {gatewayConfigured ? (gatewayEnabled ? 'Ativo' : 'Configurado (pausado)') : 'Não configurado'}
                    </span>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={gatewayEnabled}
                      onChange={(e) => setGatewayEnabled(e.target.checked)}
                      className="rounded border-border bg-[#090912]"
                    />
                    <span className="font-medium text-foreground">Ativar Claude Gateway na turma de agentes</span>
                  </label>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Base URL (`ANTHROPIC_BASE_URL`)</span>
                      <input
                        type="url"
                        value={gatewayBaseUrl}
                        onChange={(e) => setGatewayBaseUrl(e.target.value)}
                        placeholder="https://resgatar.online/ia"
                        className="w-full rounded-xl border border-border bg-[#090912] px-3 py-2 text-xs text-foreground"
                        required
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Modelo (`ANTHROPIC_MODEL`)</span>
                      <input
                        type="text"
                        value={gatewayModel}
                        onChange={(e) => setGatewayModel(e.target.value)}
                        placeholder="claude-opus-5-5"
                        className="w-full rounded-xl border border-border bg-[#090912] px-3 py-2 text-xs text-foreground"
                        required
                      />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      Token do Gateway (`ANTHROPIC_AUTH_TOKEN`) {gatewayConfigured ? '— deixe vazio para manter o token salvo' : ''}
                    </span>
                    <input
                      type="password"
                      value={gatewayToken}
                      onChange={(e) => setGatewayToken(e.target.value)}
                      placeholder={gatewayConfigured ? '•••••••••••••••• (token salvo no cofre local)' : 'Cole o token do Resgatar.online'}
                      className="w-full rounded-xl border border-border bg-[#090912] px-3 py-2 text-xs text-foreground"
                    />
                  </label>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
                    >
                      Salvar Claude Gateway
                    </button>
                    {gatewayConfigured && (
                      <button
                        type="button"
                        onClick={() => void handleClearClaudeGateway()}
                        className="rounded-lg border border-border px-3 py-1.5 text-foreground"
                      >
                        Remover token
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {activeCat === 'voice_studio' && (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Narração e Voice Studio</h2>
                    <p className="text-muted-foreground">{voices.length} voz(es) detectadas para narração.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('voice_studio')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>
                <select
                  id="voice-studio-select"
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  className={`w-full rounded-xl border bg-[#0d0d17] px-3 py-2 text-xs text-foreground ${fieldRing('voice-studio-select')}`}
                >
                  {voices.length === 0 ? (
                    <option value="">Nenhuma voz carregada</option>
                  ) : (
                    voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} ({v.locale} · {v.engine})</option>
                    ))
                  )}
                </select>
                <button
                  id="voice-studio-test-action"
                  type="button"
                  onClick={() => void handleTestConnection('voice_studio').then((r) => setStatusMessage({ kind: r.ok ? 'ok' : 'error', text: r.message }))}
                  className={`rounded-xl border px-3 py-2 ${fieldRing('voice-studio-test-action')}`}
                >
                  Testar Voice Studio
                </button>
              </div>
            )}

            {activeCat === 'production' && (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Produção Audiovisual</h2>
                    <p className="text-muted-foreground">Capacidades locais de renderização real MP4, FFmpeg e GPU.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTutorialId('production')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200"
                  >
                    <HelpCircle className="size-3.5" />
                    Como configurar
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-[#0d0d17] p-4">
                  <div>FFmpeg: <strong>{capabilities?.ffmpeg ? 'Ativo' : 'Indisponível'}</strong></div>
                  <div>FFprobe: <strong>{capabilities?.ffprobe ? 'Ativo' : 'Indisponível'}</strong></div>
                  <div>GPU NVENC: <strong>{capabilities?.nvenc ? 'Ativa' : 'CPU fallback'}</strong></div>
                  <div>yt-dlp: <strong>{capabilities?.ytdlp ? 'Ativo' : 'Indisponível'}</strong></div>
                </div>
                <button
                  id="production-test-action"
                  type="button"
                  onClick={() => void handleTestConnection('production').then((r) => setStatusMessage({ kind: r.ok ? 'ok' : 'error', text: r.message }))}
                  className={`rounded-xl border px-3 py-2 ${fieldRing('production-test-action')}`}
                >
                  Verificar capacidades
                </button>
              </div>
            )}

            {activeCat === 'academy' && (
              <div className="space-y-4 text-xs">
                <h2 className="text-base font-semibold">Academy — Aprendizado e Regras Editoriais</h2>
                <div className="rounded-xl border border-border bg-[#0d0d17] p-4 space-y-1">
                  <p>Materiais indexados: <strong>{academyCounts.materials}</strong></p>
                  <p>Técnicas extraídas: <strong>{academyCounts.knowledge}</strong></p>
                  <p>Exercícios validados: <strong>{academyCounts.exercises}</strong></p>
                </div>
                <Link to="/agents" className="inline-block rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">
                  Abrir Aethera Academy & Backup
                </Link>
              </div>
            )}

            {activeCat === 'publications' && (
              <div className="space-y-4 text-xs">
                <h2 className="text-base font-semibold">Publicações e Calendário Editorial</h2>
                <div className="rounded-xl border border-border bg-[#0d0d17] p-4 space-y-1">
                  <p>Fuso horário IANA padrão: <strong>{calendarMeta.timezone}</strong></p>
                  <p>Eventos no calendário: <strong>{calendarMeta.events}</strong></p>
                  <p>Séries recorrentes: <strong>{calendarMeta.series}</strong></p>
                </div>
                <Link to="/aethera/calendar" className="inline-block rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">
                  Abrir Calendário Editorial 2.0
                </Link>
              </div>
            )}

            {activeCat === 'security' && (
              <div className="space-y-4 text-xs">
                <h2 className="text-base font-semibold">Segurança e Gerenciamento de Credenciais</h2>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2 text-emerald-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="size-4 text-emerald-300" />
                    Isolamento por Aplicativo & Cofre Local Ativos
                  </div>
                  <p className="text-emerald-200/90">
                    Todas as chaves (Twitch/IGDB, RAWG, Collage/Pexels e tokens OAuth do YouTube) são criptografadas com
                    Electron <code>safeStorage</code>, mascaradas na interface e nunca registradas em logs. Configurações
                    do Singularity (Companion, Dispositivos, Azure DevOps) são isoladas fora do Aethera Studio.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Right Tutorial Drawer */}
          {tutorialId && (
            <SetupTutorialDrawer
              integrationId={tutorialId}
              onClose={() => setTutorialId(null)}
              onHighlightField={setHighlightedFieldId}
              onTestConnection={handleTestConnection}
            />
          )}
        </div>
      </main>
    </>
  );
}
