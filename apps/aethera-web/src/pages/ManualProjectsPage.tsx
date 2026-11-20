import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Film,
  FolderKanban,
  PackageCheck,
  Plus,
  Scissors,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type {
  DerivativeVariant,
  ManualProjectSubView,
  ProductionProject,
  PublicationPackage,
} from '../domain/types';
import { useStudio } from '../store/studio-store';

const SUB_TABS: ReadonlyArray<{
  id: ManualProjectSubView;
  label: string;
  routeSuffix: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Visão & Roteiro', routeSuffix: '', icon: FolderKanban },
  { id: 'package', label: 'Pacote de Publicação', routeSuffix: '/package', icon: PackageCheck },
  { id: 'variants', label: 'Versões e Shorts', routeSuffix: '/variants', icon: Scissors },
  { id: 'analytics', label: 'Ideia por Analytics', routeSuffix: '/analytics/idea', icon: BarChart3 },
];

export function ManualProjectsPage() {
  const {
    projects,
    channels,
    creativeProjects,
    activeProject,
    manualSubView,
    selectProject,
    setManualSubView,
    createProduction,
    updateProject,
    savePublicationPackage,
    generateDerivative,
    decideDerivative,
    promoteDerivative,
    createIdeaFromAnalytics,
    runHumanize,
    runYouTubeAgent,
    startFfmpegRender,
    navigate,
  } = useStudio();

  const project = activeProject ?? projects[0];

  // Create manual project modal/inline form
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBriefing, setNewBriefing] = useState('');
  const [newScript, setNewScript] = useState('');
  const [newStyle, setNewStyle] = useState<ProductionProject['style']>('Video Essay');
  const [newFormat, setNewFormat] = useState<ProductionProject['format']>('youtube_1080p');
  const [newChannelId, setNewChannelId] = useState(channels[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Publication package local draft synced on project switch
  const [pkgTitle, setPkgTitle] = useState(project?.publicationPackage.title ?? '');
  const [pkgDesc, setPkgDesc] = useState(project?.publicationPackage.description ?? '');
  const [pkgTags, setPkgTags] = useState(project?.publicationPackage.tags.join(', ') ?? '');
  const [pkgThumbId, setPkgThumbId] = useState(project?.publicationPackage.thumbnailArtId ?? '');
  const [pkgVisibility, setPkgVisibility] = useState<PublicationPackage['visibility']>(
    project?.publicationPackage.visibility ?? 'private',
  );
  const [syncedPkgKey, setSyncedPkgKey] = useState(`${project?.id}:${project?.publicationPackage.version}`);

  const currentPkgKey = `${project?.id}:${project?.publicationPackage.version}`;
  if (project && currentPkgKey !== syncedPkgKey) {
    setSyncedPkgKey(currentPkgKey);
    setPkgTitle(project.publicationPackage.title);
    setPkgDesc(project.publicationPackage.description);
    setPkgTags(project.publicationPackage.tags.join(', '));
    setPkgThumbId(project.publicationPackage.thumbnailArtId ?? '');
    setPkgVisibility(project.publicationPackage.visibility);
  }

  // Analytics idea form
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaAngle, setIdeaAngle] = useState('');

  // Humanize & YouTube Agent feedback
  const [humanizeNote, setHumanizeNote] = useState<string | null>(null);
  const [ytAuditInfo, setYtAuditInfo] = useState<{
    score: number;
    mode: string;
    notice: string;
    findings: Array<{ check: string; ok: boolean; recommendation: string }>;
  } | null>(null);

  const combinedScript = useMemo(() => {
    if (!project) return '';
    return project.humanizedScript || project.scenes.map((s) => `[Cena ${s.index}] ${s.narration}`).join('\n\n');
  }, [project]);

  const handleCreateManual = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const created = await createProduction({
        title: newTitle.trim(),
        briefing: newBriefing.trim() || `Produção manual: ${newTitle.trim()}`,
        creationMode: 'manual',
        channelId: newChannelId || null,
        format: newFormat,
        style: newStyle,
        durationMin: newFormat === 'shorts_9_16' ? 1 : 10,
        humorLevel: 20,
        ttsProvider: 'voicestudio',
        ttsVoice: 'Narrador Épico (PT-BR)',
        qualityPreset: 'master_1080p',
        language: 'pt-BR',
        initialScript: newScript.trim() || undefined,
      });
      setNewTitle('');
      setNewBriefing('');
      setNewScript('');
      setShowCreate(false);
      setNotice(`Projeto manual "${created.title}" salvo no SQLite.`);
      setManualSubView('overview');
    } finally {
      setBusy(false);
    }
  };

  const handleHumanizeProject = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const res = await runHumanize({
        text: combinedScript,
        tone: 'editorial',
        projectId: project.id,
      });
      setHumanizeNote(
        `[${res.executionMode === 'real_cli' ? 'CLI Real' : 'Fallback Determinístico'}] Legibilidade ${res.result.readabilityBefore} → ${res.result.readabilityAfter}. ${res.notice}`,
      );
      setNotice('Roteiro humanizado e salvo no projeto.');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePackage = async (approve = false) => {
    if (!project) return;
    setBusy(true);
    try {
      await savePublicationPackage(project.id, {
        title: pkgTitle.trim() || project.title,
        description: pkgDesc.trim(),
        tags: pkgTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        thumbnailArtId: pkgThumbId || null,
        visibility: pkgVisibility,
        approvalStatus: approve ? 'approved' : 'draft',
      });
      setNotice(
        approve
          ? `Pacote de publicação de "${project.title}" aprovado e versionado no SQLite.`
          : `Rascunho do pacote de publicação salvo (v${project.publicationPackage.version + 1}).`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRunYouTubeAudit = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const res = await runYouTubeAgent(project.id);
      setPkgTitle(res.analysis.suggestedTitle);
      setPkgDesc(res.analysis.suggestedDescription);
      setPkgTags(res.analysis.suggestedTags.join(', '));
      setYtAuditInfo({
        score: res.analysis.score,
        mode: res.executionMode,
        notice: res.notice,
        findings: res.analysis.findings,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateIdea = async () => {
    if (!project || !ideaTitle.trim()) return;
    setBusy(true);
    try {
      const idea = await createIdeaFromAnalytics(project.id, ideaTitle, ideaAngle);
      setIdeaTitle('');
      setIdeaAngle('');
      setNotice(`Ideia "${idea.title}" salva no Trend Radar a partir de analytics.`);
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerRender = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await startFfmpegRender(project.id, project.qualityPreset);
      navigate('pipeline', project.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            CONTENT OS • /AETHERA/PROJECTS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Projeto Manual</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Gestão completa de produções, roteiro com Humanize, Pacote de Publicação, Versões/Shorts e Analytics.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#24242c]"
        >
          <Plus className="w-4 h-4 text-[#d8fb4f]" />
          <span>{showCreate ? 'Fechar formulário' : 'Novo Projeto Manual'}</span>
        </button>
      </div>

      {notice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-[#62626c] hover:text-[#111111]">
            Fechar
          </button>
        </div>
      )}

      {/* Create Manual Project Panel */}
      {showCreate && (
        <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4 border-2 border-[#b8a4f4]">
          <h2 className="text-base font-bold text-[#111111]">Criar Projeto Manual (Persistido em SQLite)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="manual-title" className="block text-xs font-semibold text-[#111111] mb-1">
                Título do projeto
              </label>
              <input
                id="manual-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex.: Bastidores da direção de fotografia em Blade Runner 2049"
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111] outline-none focus:bg-white focus:border-[#8b6cf0]"
              />
            </div>

            <div>
              <label htmlFor="manual-channel" className="block text-xs font-semibold text-[#111111] mb-1">
                Canal vinculado
              </label>
              <select
                id="manual-channel"
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name} ({ch.platform})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="manual-style" className="block text-xs font-semibold text-[#111111] mb-1">
                Estilo editorial
              </label>
              <select
                id="manual-style"
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value as ProductionProject['style'])}
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
              >
                <option value="Video Essay">Video Essay</option>
                <option value="Documentário">Documentário</option>
                <option value="Top 10">Top 10</option>
                <option value="Análise Técnica">Análise Técnica</option>
                <option value="Comédia Narrada">Comédia Narrada</option>
              </select>
            </div>

            <div>
              <label htmlFor="manual-format" className="block text-xs font-semibold text-[#111111] mb-1">
                Formato de saída
              </label>
              <select
                id="manual-format"
                value={newFormat}
                onChange={(e) => setNewFormat(e.target.value as ProductionProject['format'])}
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
              >
                <option value="youtube_1080p">YouTube 1080p (16:9)</option>
                <option value="youtube_4k">Cinema 4K (16:9)</option>
                <option value="documentary_wide">Documentário Widescreen (16:9)</option>
                <option value="shorts_9_16">Shorts / Reels (9:16)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="manual-briefing" className="block text-xs font-semibold text-[#111111] mb-1">
              Briefing &amp; premissa editorial
            </label>
            <textarea
              id="manual-briefing"
              rows={2}
              value={newBriefing}
              onChange={(e) => setNewBriefing(e.target.value)}
              placeholder="Descreva o objetivo, tese central e referências visuais..."
              className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111] outline-none"
            />
          </div>

          <div>
            <label htmlFor="manual-script" className="block text-xs font-semibold text-[#111111] mb-1">
              Roteiro inicial (opcional)
            </label>
            <textarea
              id="manual-script"
              rows={3}
              value={newScript}
              onChange={(e) => setNewScript(e.target.value)}
              placeholder="Cole seu rascunho de narração para edição manual ou humanização..."
              className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111] outline-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="h-9 px-4 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !newTitle.trim()}
              onClick={() => void handleCreateManual()}
              className="h-9 px-5 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold disabled:opacity-50"
            >
              Salvar Projeto Manual
            </button>
          </div>
        </section>
      )}

      {/* Main Split: Project List + Sub-Screen Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left: All Projects */}
        <aside className="xl:col-span-3 rounded-[28px] bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
              PROJETOS ({projects.length})
            </span>
          </div>

          <div className="space-y-1.5 max-h-[540px] overflow-y-auto">
            {projects.map((p) => {
              const selected = project?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className={`w-full text-left rounded-2xl p-3 transition-colors ${
                    selected ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e9e9ef]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 text-[10px] mb-1">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold uppercase ${
                        p.creationMode === 'manual'
                          ? selected
                            ? 'bg-[#d8fb4f] text-[#111111]'
                            : 'bg-[#efe9fd] text-[#6a46d8]'
                          : selected
                            ? 'bg-white/20 text-white'
                            : 'bg-white text-[#62626c]'
                      }`}
                    >
                      {p.creationMode === 'manual' ? 'Manual' : 'Cinema IA'}
                    </span>
                    <span className="font-mono opacity-80">{p.aspectRatio}</span>
                  </div>
                  <div className="text-xs font-semibold line-clamp-2">{p.title}</div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right: Selected Project + Sub-Route Tabs */}
        {project && (
          <section className="xl:col-span-9 space-y-4">
            {/* Project Sub-navigation bar matching ContentProjectRoute */}
            <div className="rounded-[28px] bg-white p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Subtelas do projeto" className="flex flex-wrap gap-1.5">
                {SUB_TABS.map((t) => {
                  const Icon = t.icon;
                  const active = manualSubView === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setManualSubView(t.id)}
                      className={`h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                        active ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#efe9fd]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate('editor', project.id)}
                  className="h-9 px-3.5 rounded-full bg-[#f4f4f6] hover:bg-[#e3e3e8] text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Editor</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTriggerRender()}
                  className="h-9 px-4 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Clapperboard className="w-3.5 h-3.5" />
                  <span>Renderizar MP4 (FFmpeg)</span>
                </button>
              </div>
            </div>

            {/* SUB-VIEW 1: VISÃO & ROTEIRO */}
            {manualSubView === 'overview' && (
              <div className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#111111]">{project.title}</h2>
                    <p className="text-xs text-[#62626c] mt-0.5">
                      {project.style} • {project.aspectRatio} • ~{project.durationMin} min • TTS: {project.ttsProvider}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleHumanizeProject()}
                    className="h-9 px-4 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5 hover:brightness-95"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Aplicar Humanize no Roteiro</span>
                  </button>
                </div>

                {humanizeNote && (
                  <div className="rounded-2xl bg-[#efe9fd] px-4 py-2.5 text-xs text-[#2a1d5c] font-medium">
                    {humanizeNote}
                  </div>
                )}

                <div>
                  <label htmlFor="proj-briefing-edit" className="block text-xs font-semibold text-[#111111] mb-1">
                    Briefing editorial
                  </label>
                  <textarea
                    id="proj-briefing-edit"
                    rows={2}
                    value={project.briefing}
                    onChange={(e) => void updateProject(project.id, { briefing: e.target.value })}
                    className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
                  />
                </div>

                <div>
                  <label htmlFor="proj-script-edit" className="block text-xs font-semibold text-[#111111] mb-1">
                    Roteiro unificado / Narração humanizada
                  </label>
                  <textarea
                    id="proj-script-edit"
                    rows={6}
                    value={combinedScript}
                    onChange={(e) => void updateProject(project.id, { humanizedScript: e.target.value })}
                    className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs font-mono leading-relaxed text-[#111111]"
                  />
                </div>
              </div>
            )}

            {/* SUB-VIEW 2: PACOTE DE PUBLICAÇÃO */}
            {manualSubView === 'package' && (
              <div className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#111111]">
                      Pacote de Publicação (v{project.publicationPackage.version})
                    </h2>
                    <p className="text-xs text-[#62626c]">
                      Metadados versionados, auditoria YouTube Agent e aprovação explícita antes de agendar.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        project.publicationPackage.approvalStatus === 'approved'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : 'bg-[#f4f4f6] text-[#62626c]'
                      }`}
                    >
                      {project.publicationPackage.approvalStatus === 'approved' ? 'Pacote Aprovado' : 'Rascunho'}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRunYouTubeAudit()}
                      className="h-9 px-4 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Otimizar com YouTube Agent</span>
                    </button>
                  </div>
                </div>

                {ytAuditInfo && (
                  <div className="rounded-2xl bg-[#efe9fd] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-[#111111]">
                      <span>Auditoria YouTube Agent — Score {ytAuditInfo.score}/100</span>
                      <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono">
                        {ytAuditInfo.mode === 'real_cli' ? 'CLI Real' : 'Heurística Local (CLIs ausentes)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#2a1d5c]">{ytAuditInfo.notice}</p>
                    <ul className="space-y-1 text-xs">
                      {ytAuditInfo.findings.map((f) => (
                        <li key={f.check} className="flex items-start justify-between gap-2">
                          <span className="text-[#111111]">{f.check}</span>
                          <span className={f.ok ? 'font-bold text-[#2f7d32]' : 'font-bold text-[#9a6200]'}>
                            {f.ok ? 'OK' : 'Ajustado'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label htmlFor="pkg-title" className="block text-xs font-semibold text-[#111111] mb-1">
                      Título de publicação ({pkgTitle.length} caracteres)
                    </label>
                    <input
                      id="pkg-title"
                      type="text"
                      value={pkgTitle}
                      onChange={(e) => setPkgTitle(e.target.value)}
                      className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs font-medium text-[#111111]"
                    />
                  </div>

                  <div>
                    <label htmlFor="pkg-desc" className="block text-xs font-semibold text-[#111111] mb-1">
                      Descrição &amp; capítulos (00:00)
                    </label>
                    <textarea
                      id="pkg-desc"
                      rows={5}
                      value={pkgDesc}
                      onChange={(e) => setPkgDesc(e.target.value)}
                      className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="pkg-tags" className="block text-xs font-semibold text-[#111111] mb-1">
                        Tags (separadas por vírgula)
                      </label>
                      <input
                        id="pkg-tags"
                        type="text"
                        value={pkgTags}
                        onChange={(e) => setPkgTags(e.target.value)}
                        className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                      />
                    </div>
                    <div>
                      <label htmlFor="pkg-thumb" className="block text-xs font-semibold text-[#111111] mb-1">
                        Thumbnail vinculada
                      </label>
                      <select
                        id="pkg-thumb"
                        value={pkgThumbId}
                        onChange={(e) => setPkgThumbId(e.target.value)}
                        className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                      >
                        <option value="">Sem thumbnail selecionada</option>
                        {creativeProjects
                          .filter((a) => a.artType === 'thumbnail')
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.headline} {a.approved ? '(Aprovada)' : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pkg-visibility" className="block text-xs font-semibold text-[#111111] mb-1">
                        Visibilidade
                      </label>
                      <select
                        id="pkg-visibility"
                        value={pkgVisibility}
                        onChange={(e) => setPkgVisibility(e.target.value as PublicationPackage['visibility'])}
                        className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                      >
                        <option value="private">Privado (revisão)</option>
                        <option value="unlisted">Não listado</option>
                        <option value="public">Público (agendado)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#e3e3e8]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSavePackage(false)}
                    className="h-10 px-5 rounded-full bg-[#f4f4f6] text-[#111111] text-xs font-semibold hover:bg-[#e3e3e8]"
                  >
                    Salvar Rascunho
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSavePackage(true)}
                    className="h-10 px-5 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Aprovar Pacote de Publicação</span>
                  </button>
                </div>
              </div>
            )}

            {/* SUB-VIEW 3: VERSÕES E SHORTS */}
            {manualSubView === 'variants' && (
              <div className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#111111]">Versões e Derivados (9:16)</h2>
                    <p className="text-xs text-[#62626c]">
                      Gere cortes verticais derivados da produção atual com aprovação antes de promover a produção filha.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: 'youtube-short', label: 'Gerar YouTube Short' },
                        { id: 'instagram-reels', label: 'Gerar Reel' },
                        { id: 'tiktok', label: 'Gerar TikTok' },
                      ] as Array<{ id: DerivativeVariant['formatId']; label: string }>
                    ).map((btn) => (
                      <button
                        key={btn.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void generateDerivative(project.id, btn.id)}
                        className="h-9 px-3.5 rounded-full bg-[#111111] text-white text-xs font-semibold hover:bg-[#24242c]"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>

                {project.derivatives.length === 0 ? (
                  <div className="rounded-2xl bg-[#f4f4f6] p-6 text-center text-xs text-[#62626c]">
                    Nenhum derivado gerado ainda para este projeto. Clique em um formato acima para propor um corte.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {project.derivatives.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-[#f4f4f6] p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#111111]">{item.title}</span>
                            <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#6a46d8]">
                              {item.formatId} • {item.durationSec}s
                            </span>
                          </div>
                          <p className="text-xs text-[#62626c]">Gancho: {item.hookText}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              item.status === 'promoted'
                                ? 'bg-[#d8fb4f] text-[#111111]'
                                : item.status === 'approved'
                                  ? 'bg-[#efe9fd] text-[#6a46d8]'
                                  : item.status === 'rejected'
                                    ? 'bg-[#fde7f3] text-[#b42840]'
                                    : 'bg-white text-[#62626c]'
                            }`}
                          >
                            {item.status}
                          </span>

                          {item.status === 'candidate' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void decideDerivative(project.id, item.id, 'approved')}
                                className="h-8 px-3 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold"
                              >
                                Aprovar
                              </button>
                              <button
                                type="button"
                                onClick={() => void decideDerivative(project.id, item.id, 'rejected')}
                                className="h-8 px-3 rounded-full bg-white text-[#62626c] text-xs font-semibold"
                              >
                                Rejeitar
                              </button>
                            </>
                          )}

                          {item.status === 'approved' && (
                            <button
                              type="button"
                              onClick={async () => {
                                const child = await promoteDerivative(project.id, item.id);
                                setNotice(`Produção filha "${child.title}" criada na fila!`);
                              }}
                              className="h-8 px-3.5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <span>Criar produção filha</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SUB-VIEW 4: IDEIA A PARTIR DE ANALYTICS */}
            {manualSubView === 'analytics' && (
              <div className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-[#111111]">Transformar Analytics em Nova Ideia</h2>
                  <p className="text-xs text-[#62626c]">
                    Snapshots de desempenho somente leitura convertidos em pautas para o Trend Radar e Produção com IA.
                  </p>
                </div>

                {project.analyticsSnapshots.length === 0 ? (
                  <div className="rounded-2xl bg-[#f4f4f6] p-4 text-xs text-[#62626c]">
                    Nenhum snapshot capturado ainda para este projeto. Conecte o canal YouTube OAuth na tela Publicação para coletar métricas reais.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {project.analyticsSnapshots.map((snap) => (
                      <div key={snap.id} className="rounded-2xl bg-[#efe9fd] p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-[#111111]">{snap.platform}</span>
                          <span className="font-mono text-[#2a1d5c]">
                            {snap.metrics.views.toLocaleString('pt-BR')} views • CTR {snap.metrics.ctrPct}% • Retenção{' '}
                            {snap.metrics.avgRetentionPct}% • {snap.metrics.watchTimeHours}h
                          </span>
                        </div>
                        <p className="text-xs text-[#2a1d5c]">{snap.note}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t border-[#e3e3e8]">
                  <div>
                    <label htmlFor="analytics-idea-title" className="block text-xs font-semibold text-[#111111] mb-1">
                      Título da nova ideia editorial
                    </label>
                    <input
                      id="analytics-idea-title"
                      type="text"
                      value={ideaTitle}
                      onChange={(e) => setIdeaTitle(e.target.value)}
                      placeholder="Ex.: Anatomia de frames: por que lutas de chefes retêm 54% da audiência"
                      className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                    />
                  </div>
                  <div>
                    <label htmlFor="analytics-idea-angle" className="block text-xs font-semibold text-[#111111] mb-1">
                      Hipótese editorial sugerida pelos dados
                    </label>
                    <textarea
                      id="analytics-idea-angle"
                      rows={2}
                      value={ideaAngle}
                      onChange={(e) => setIdeaAngle(e.target.value)}
                      placeholder="Que padrão de retenção ou CTR justifica este próximo vídeo?"
                      className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busy || !ideaTitle.trim()}
                      onClick={() => void handleCreateIdea()}
                      className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold disabled:opacity-50"
                    >
                      Salvar Ideia no Trend Radar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
