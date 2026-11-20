import { useState } from 'react';
import {
  ArrowLeftRight,
  Download,
  Edit3,
  Film,
  FolderSync,
  Play,
  Plus,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { SyncedProjectRecord } from '../../../aethera-remote-host/src/contracts/v1';
import { useRemoteHost } from '../store/remote-host-store';
import { SyncConflictCard } from './SyncConflictCard';
import { SyncStatusBadge } from './SyncStatusBadge';

export function BidirectionalSyncPanel() {
  const {
    connectionState,
    syncSseConnected,
    syncSeq,
    desktopBridgeStatus,
    syncedProjects,
    pendingSyncQueue,
    syncConflicts,
    upsertSyncedProject,
    resolveSyncConflict,
    triggerDesktopIngest,
    submitJob,
    mintSyncedMediaTicket,
    getProjectSyncBadge,
  } = useRemoteHost();

  const isConnected = connectionState === 'connected' || connectionState === 'reconnecting';
  const conflictList = Object.values(syncConflicts);

  const [notice, setNotice] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBriefing, setNewBriefing] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBriefing, setEditBriefing] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [previewMedia, setPreviewMedia] = useState<{
    title: string;
    streamUrl: string;
    downloadUrl: string;
  } | null>(null);

  const handleDesktopIngest = async () => {
    setIngesting(true);
    setNotice(null);
    try {
      const res = await triggerDesktopIngest();
      setNotice(
        res.ingested > 0
          ? `${res.ingested} projeto(s) do Aethera Desktop importado(s) com backup automático preservado.`
          : 'Nenhum projeto novo encontrado em cinema-projects/ do Desktop (tudo atualizado).',
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  };

  const handleCreateSynced = async () => {
    if (newTitle.trim().length < 3 || newBriefing.trim().length < 8) {
      setNotice('Informe um título (mín. 3 caracteres) e um briefing (mín. 8 caracteres).');
      return;
    }
    setSavingId('__new__');
    setNotice(null);
    try {
      const res = await upsertSyncedProject({
        data: {
          title: newTitle.trim(),
          briefing: newBriefing.trim(),
          creationMode: 'ai',
          format: 'youtube_1080p',
          style: 'Video Essay',
          aspectRatio: '16:9',
          language: 'pt-BR',
          durationMin: 8,
          humorLevel: 25,
          ttsProvider: 'voicestudio',
          ttsVoice: 'Narrador Épico (PT-BR)',
          qualityPreset: 'review_720p',
          status: 'briefing',
          scheduledDate: null,
          humanizedScript: null,
          scenes: [],
          revisions: [],
          latestJobId: null,
          latestRenderMediaRefId: null,
          mediaRefs: [],
        },
      });
      if (res.ok && res.project) {
        setNotice(`Projeto "${res.project.data.title}" criado (v${res.project.version}) e projetado para o Desktop.`);
        setNewTitle('');
        setNewBriefing('');
        setCreating(false);
      } else if (res.queued) {
        setNotice('Projeto colocado na fila Pendente — será criado assim que o PC reconectar.');
        setCreating(false);
      } else if (res.error) {
        setNotice(res.error);
      }
    } finally {
      setSavingId(null);
    }
  };

  const startEdit = (proj: SyncedProjectRecord) => {
    setEditingId(proj.id);
    setEditTitle(proj.data.title);
    setEditBriefing(proj.data.briefing);
    setNotice(null);
  };

  const handleSaveEdit = async (proj: SyncedProjectRecord) => {
    setSavingId(proj.id);
    setNotice(null);
    try {
      const res = await upsertSyncedProject({
        id: proj.id,
        expectedVersion: proj.version,
        data: {
          ...proj.data,
          title: editTitle.trim() || proj.data.title,
          briefing: editBriefing.trim() || proj.data.briefing,
        },
      });
      if (res.ok && res.project) {
        setNotice(`Projeto atualizado com controle de versão (v${res.project.version}) e sincronizado com o Desktop.`);
        setEditingId(null);
      } else if (res.conflict) {
        setNotice('Conflito de concorrência (HTTP 409): o Desktop modificou este projeto antes de você salvar.');
        setEditingId(null);
      } else if (res.queued) {
        setNotice('Alteração enfileirada como Pendente até reconexão.');
        setEditingId(null);
      } else if (res.error) {
        setNotice(res.error);
      }
    } finally {
      setSavingId(null);
    }
  };

  const handleRenderSyncedProject = async (proj: SyncedProjectRecord) => {
    setSavingId(proj.id);
    setNotice(null);
    try {
      const job = await submitJob({
        operation: 'render.ffmpeg',
        title: `Render Sincronizado • ${proj.data.title}`,
        prompt: proj.data.briefing,
        aspectRatio: proj.data.aspectRatio,
        qualityPreset: 'draft_540p',
        useGpu: true,
        projectId: proj.id,
      });
      setNotice(
        `Job ${job.id} disparado no PC para o projeto ${proj.id}. Ao concluir, o MP4 será vinculado nos dois ambientes.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  };

  const handleWatchSyncedMedia = async (proj: SyncedProjectRecord) => {
    if (!proj.data.latestRenderMediaRefId) return;
    try {
      const ticket = await mintSyncedMediaTicket(proj.data.latestRenderMediaRefId);
      setPreviewMedia({
        title: `${proj.data.title} (MP4 Sincronizado)`,
        streamUrl: ticket.streamUrl,
        downloadUrl: ticket.downloadUrl,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadSyncedMedia = async (proj: SyncedProjectRecord) => {
    if (!proj.data.latestRenderMediaRefId) return;
    try {
      const ticket = await mintSyncedMediaTicket(proj.data.latestRenderMediaRefId);
      const a = document.createElement('a');
      a.href = ticket.downloadUrl;
      a.download = `${proj.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6a46d8] inline-flex items-center gap-1.5">
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>SINCRONIZAÇÃO BIDIRECIONAL • AUTORIDADE ÚNICA DE ESCRITA</span>
          </div>
          <h2 className="text-base font-bold text-[#111111] mt-0.5">
            Projetos Compartilhados (Web ↔ Remote Host ↔ Aethera Desktop)
          </h2>
          <p className="text-xs text-[#62626c] mt-0.5">
            Versionamento otimista, idempotência, backup automático pré-migração e projeção atômica para{' '}
            <code className="font-mono text-[#111111]">cinema-projects/</code> sem escrita concorrente no SQLite do Electron.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SyncStatusBadge state="synced" version={syncSeq > 0 ? syncSeq : undefined} />
          <SyncStatusBadge state="local_only" />
          <SyncStatusBadge state="pending" />
          <SyncStatusBadge state="conflict" />
        </div>
      </div>

      {!isConnected ? (
        <div className="rounded-2xl bg-[#f4f4f6] p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#62626c]">
          <span>
            Conecte seu PC Windows acima para ativar o stream SSE bidirecional (<code className="font-mono">/api/sync/events</code>),
            importar projetos reais do Aethera Desktop e assistir MP4s renderizados no PC por ticket autenticado.
          </span>
          {pendingSyncQueue.length > 0 && (
            <span className="px-3 py-1 rounded-full bg-[#fef3c7] text-[#92400e] font-bold">
              {pendingSyncQueue.length} alteração(ões) pendente(s) na fila
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Authority Health & Backup Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-1">
              <div className="text-[11px] text-[#62626c]">Canal em Tempo Real (SSE)</div>
              <div className="font-bold text-[#111111] flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${syncSseConnected ? 'bg-[#2f7d32]' : 'bg-[#d97706]'}`}
                />
                <span>{syncSseConnected ? `Conectado (seq #${syncSeq})` : 'Reconectando stream...'}</span>
              </div>
              <div className="text-[11px] font-mono text-[#62626c]">
                {syncedProjects.length} projeto(s) na Autoridade
              </div>
            </div>

            <div className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-1">
              <div className="text-[11px] text-[#62626c]">Ponte Aethera Desktop</div>
              <div className="font-bold text-[#111111]">
                {desktopBridgeStatus?.desktopUserDataDetected
                  ? `cinema-projects ativo (${desktopBridgeStatus.cinemaProjectsCount})`
                  : 'Modo Host Isolado'}
              </div>
              <div className="text-[11px] font-mono text-[#62626c]">
                Watcher: {desktopBridgeStatus?.watcherActive ? 'Ativo (fs.watch)' : 'Manual'}
              </div>
            </div>

            <div className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-1">
              <div className="text-[11px] text-[#62626c] inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#2f7d32]" />
                <span>Backup Pré-Migração</span>
              </div>
              {desktopBridgeStatus?.lastBackup ? (
                <>
                  <div className="font-bold text-[#111111]">
                    {desktopBridgeStatus.lastBackup.fileCount} arquivo(s) protegidos
                  </div>
                  <div className="text-[11px] font-mono text-[#62626c] truncate">
                    SHA-256: {desktopBridgeStatus.lastBackup.manifestSha256.slice(0, 14)}…
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-[#62626c]">Pronto (executa antes da primeira migração)</div>
              )}
            </div>
          </div>

          {/* Actions Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={ingesting}
                onClick={() => void handleDesktopIngest()}
                className="h-9 px-4 rounded-full bg-[#efe9fd] hover:bg-[#e4d9fb] text-[#2a1d5c] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <FolderSync className="w-3.5 h-3.5" />
                <span>{ingesting ? 'Escaneando Desktop...' : 'Importar do Desktop'}</span>
              </button>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                className="h-9 px-4 rounded-full bg-[#111111] hover:bg-[#24242c] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-[#d8fb4f]" />
                <span>{creating ? 'Fechar formulário' : 'Novo projeto sincronizado'}</span>
              </button>
            </div>
            {pendingSyncQueue.length > 0 && (
              <span className="px-3 py-1 rounded-full bg-[#fef3c7] text-[#92400e] text-xs font-bold">
                {pendingSyncQueue.length} pendente(s) de envio
              </span>
            )}
          </div>

          {notice && (
            <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="text-[#62626c] hover:text-[#111111]">
                Fechar
              </button>
            </div>
          )}

          {/* Create Synced Project Form */}
          {creating && (
            <div className="rounded-2xl bg-[#f4f4f6] p-4 space-y-2.5">
              <div className="text-xs font-bold text-[#111111]">
                Criar projeto na Autoridade (aparece no Web e no Aethera Desktop)
              </div>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Título do projeto (ex.: Documentário sobre Telescópio James Webb)"
                aria-label="Título do projeto sincronizado"
                className="w-full h-9 rounded-2xl bg-white border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
              />
              <textarea
                rows={2}
                value={newBriefing}
                onChange={(e) => setNewBriefing(e.target.value)}
                placeholder="Briefing editorial que será compartilhado com o Aethera Desktop..."
                aria-label="Briefing do projeto sincronizado"
                className="w-full rounded-2xl bg-white border border-[#e3e3e8] p-3 text-xs text-[#111111]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-8 px-3.5 rounded-full bg-white text-[#62626c] text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingId === '__new__'}
                  onClick={() => void handleCreateSynced()}
                  className="h-8 px-4 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingId === '__new__' ? 'Sincronizando...' : 'Criar & Projetar no Desktop'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Conflicts */}
          {conflictList.length > 0 && (
            <div className="space-y-2.5">
              {conflictList.map((conflict) => (
                <SyncConflictCard
                  key={conflict.projectId}
                  conflict={conflict}
                  onResolve={async (projectId, strategy, clientData) => {
                    const res = await resolveSyncConflict(projectId, strategy, clientData);
                    if (res.ok) {
                      setNotice(`Conflito do projeto ${projectId} resolvido (${strategy}).`);
                    } else if (res.error) {
                      setNotice(res.error);
                    }
                  }}
                />
              ))}
            </div>
          )}

          {/* Authenticated Synced Media Preview Player */}
          {previewMedia && (
            <div className="rounded-2xl bg-[#111111] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs text-white px-1">
                <span className="font-mono truncate">{previewMedia.title}</span>
                <button
                  type="button"
                  onClick={() => setPreviewMedia(null)}
                  className="text-white/70 hover:text-white inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Fechar</span>
                </button>
              </div>
              <video
                key={previewMedia.streamUrl}
                src={previewMedia.streamUrl}
                controls
                className="w-full max-h-[320px] rounded-xl bg-black"
              />
            </div>
          )}

          {/* Synced Projects Grid */}
          {syncedProjects.length === 0 ? (
            <div className="rounded-2xl bg-[#f4f4f6] p-5 text-xs text-[#62626c] text-center">
              Nenhum projeto sincronizado ainda. Crie um projeto acima ou clique em{' '}
              <strong>Importar do Desktop</strong> para trazer projetos existentes do Aethera Desktop.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {syncedProjects.map((proj) => {
                const badge = getProjectSyncBadge(proj.id);
                const isEditing = editingId === proj.id;
                return (
                  <article key={proj.id} className="rounded-2xl bg-[#f4f4f6] p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SyncStatusBadge state={badge.state} version={proj.version} />
                          <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#62626c]">
                            origem: {proj.origin} • últ: {proj.updatedBy}
                          </span>
                        </div>
                        <h3 className="mt-1.5 text-sm font-bold text-[#111111] truncate">{proj.data.title}</h3>
                      </div>
                      <span className="text-[10px] font-mono text-[#62626c] shrink-0">{proj.id}</span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          aria-label="Editar título"
                          className="w-full h-8 rounded-xl bg-white border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                        />
                        <textarea
                          rows={2}
                          value={editBriefing}
                          onChange={(e) => setEditBriefing(e.target.value)}
                          aria-label="Editar briefing"
                          className="w-full rounded-xl bg-white border border-[#e3e3e8] p-2.5 text-xs text-[#111111]"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="h-7 px-3 rounded-full bg-white text-[11px] font-semibold text-[#62626c]"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={savingId === proj.id}
                            onClick={() => void handleSaveEdit(proj)}
                            className="h-7 px-3 rounded-full bg-[#111111] text-white text-[11px] font-semibold"
                          >
                            {savingId === proj.id ? 'Salvando...' : `Salvar (espera v${proj.version})`}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#62626c] line-clamp-2">{proj.data.briefing}</p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono text-[#62626c]">
                      <span>
                        {proj.data.scenes.length} cenas • {proj.data.revisions.length} revisões •{' '}
                        {proj.data.mediaRefs.length} mídia(s)
                      </span>
                      <span>{new Date(proj.updatedAt).toLocaleTimeString('pt-BR')}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => startEdit(proj)}
                        className="h-8 px-3 rounded-full bg-white hover:bg-[#efe9fd] text-[#111111] text-[11px] font-semibold inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        disabled={savingId === proj.id}
                        onClick={() => void handleRenderSyncedProject(proj)}
                        className="h-8 px-3 rounded-full bg-[#111111] hover:bg-[#24242c] text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Film className="w-3 h-3 text-[#d8fb4f]" />
                        <span>Renderizar no PC</span>
                      </button>
                      {proj.data.latestRenderMediaRefId && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleWatchSyncedMedia(proj)}
                            className="h-8 px-3 rounded-full bg-[#d8fb4f] text-[#111111] text-[11px] font-bold inline-flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" />
                            <span>Assistir MP4</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownloadSyncedMedia(proj)}
                            className="h-8 px-3 rounded-full bg-white text-[#111111] text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            <span>MP4</span>
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
