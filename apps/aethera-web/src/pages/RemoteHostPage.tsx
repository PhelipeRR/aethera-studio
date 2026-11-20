import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
  HardDrive,
  Laptop,
  Lock,
  Play,
  Plug,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Unplug,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type {
  CreateRemoteJobRequest,
  RemoteAgentId,
  RemoteJobRecord,
  RemoteOperationType,
} from '../../../aethera-remote-host/src/contracts/v1';
import { useRemoteHost } from '../store/remote-host-store';

const JOB_STATUS_LABEL: Record<RemoteJobRecord['status'], string> = {
  queued: 'Na fila',
  awaiting_approval: 'Aguardando aprovação',
  running: 'Executando',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  interrupted_on_restart: 'Interrompido no reinício',
};

export function RemoteHostPage() {
  const {
    connectionState,
    baseUrl,
    hasTokenInMemory,
    error,
    lastSyncedAt,
    sseConnected,
    hostStatus,
    agentsInfo,
    projectsInfo,
    jobs,
    selectedJobId,
    selectedJobEvents,
    connect,
    disconnect,
    refreshAll,
    selectJob,
    submitJob,
    cancelJob,
    approveJob,
    mintArtifactTicket,
  } = useRemoteHost();

  const [urlInput, setUrlInput] = useState(baseUrl);
  const [tokenInput, setTokenInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Remote job dispatcher form
  const [operation, setOperation] = useState<RemoteOperationType>('cinema.produce');
  const [jobTitle, setJobTitle] = useState('');
  const [jobPrompt, setJobPrompt] = useState('');
  const [preferredAgent, setPreferredAgent] = useState<RemoteAgentId | 'auto'>('auto');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [qualityPreset, setQualityPreset] = useState<NonNullable<CreateRemoteJobRequest['qualityPreset']>>('draft_540p');
  const [useGpu, setUseGpu] = useState(true);
  const [mediaQuery, setMediaQuery] = useState('');

  // Signed preview state (ephemeral 60s HMAC ticket)
  const [previewVideo, setPreviewVideo] = useState<{
    artifactId: string;
    filename: string;
    streamUrl: string;
    downloadUrl: string;
    expiresAt: string;
  } | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );

  const isConnected = connectionState === 'connected' || connectionState === 'reconnecting';

  const handleConnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const ok = await connect(urlInput, tokenInput);
      if (ok) {
        setTokenInput(''); // Clear raw input after storing securely in memory ref
        setNotice('Conectado ao Aethera Remote Host com autenticação Bearer em memória.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitJob = async () => {
    if (!isConnected) return;
    setBusy(true);
    setNotice(null);
    try {
      const req: CreateRemoteJobRequest = {
        operation,
        title: jobTitle.trim() || undefined,
        prompt: jobPrompt.trim() || undefined,
        preferredAgent,
        aspectRatio,
        qualityPreset,
        useGpu,
        ...(operation === 'media.acquire' ? { mediaQuery: mediaQuery.trim() || undefined } : {}),
      };
      const created = await submitJob(req);
      setNotice(
        created.status === 'awaiting_approval'
          ? `Job ${created.id} criado em estado "Aguardando aprovação humana".`
          : `Job ${created.id} enviado para execução real no PC (${created.operation}).`,
      );
      setJobTitle('');
      setJobPrompt('');
      setMediaQuery('');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPreview = async (artifactId: string, filename: string) => {
    try {
      const ticket = await mintArtifactTicket(artifactId);
      setPreviewVideo({
        artifactId,
        filename,
        streamUrl: ticket.streamUrl,
        downloadUrl: ticket.downloadUrl,
        expiresAt: ticket.expiresAt,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadArtifact = async (artifactId: string, filename: string) => {
    try {
      const ticket = await mintArtifactTicket(artifactId);
      const a = document.createElement('a');
      a.href = ticket.downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            AETHERA REMOTE STUDIO • EXECUÇÃO REAL NO PC WINDOWS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Remote Host</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Controle o Aethera Studio, agentes RF-07, Cinema Engine e GPU/FFmpeg do seu PC Windows via HTTPS (ngrok ou Cloudflare Tunnel).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`h-9 px-3.5 rounded-full text-xs font-bold inline-flex items-center gap-2 ${
              connectionState === 'connected'
                ? 'bg-[#d8fb4f] text-[#111111]'
                : connectionState === 'reconnecting'
                  ? 'bg-[#fef3c7] text-[#92400e]'
                  : 'bg-[#f4f4f6] text-[#62626c]'
            }`}
          >
            {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>
              {connectionState === 'connected'
                ? 'PC Online'
                : connectionState === 'reconnecting'
                  ? 'Reconectando...'
                  : connectionState === 'connecting'
                    ? 'Conectando...'
                    : 'PC Offline / Desconectado'}
            </span>
          </span>

          {isConnected && (
            <>
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="h-9 px-3.5 rounded-full bg-[#f4f4f6] hover:bg-[#e3e3e8] text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Atualizar</span>
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="h-9 px-3.5 rounded-full bg-[#fde7f3] text-[#b42840] text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Unplug className="w-3.5 h-3.5" />
                <span>Desconectar</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Security & Connection Card */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <Plug className="w-4 h-4 text-[#6a46d8]" />
            <span>Conexão Autenticada ao PC Windows</span>
          </h2>
          <span className="px-3 py-1 rounded-full bg-[#efe9fd] text-[#2a1d5c] text-[11px] font-semibold inline-flex items-center gap-1.5">
            <Lock className="w-3 h-3" />
            <span>Token mantido apenas em memória (nunca salvo em localStorage)</span>
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5">
            <label htmlFor="remote-host-url" className="block text-xs font-semibold text-[#111111] mb-1">
              URL HTTPS do túnel (ngrok / Cloudflare) ou loopback local
            </label>
            <input
              id="remote-host-url"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://seu-subdominio.ngrok-free.app ou http://127.0.0.1:4848"
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs font-mono text-[#111111]"
            />
          </div>

          <div className="lg:col-span-5">
            <label htmlFor="remote-host-token" className="block text-xs font-semibold text-[#111111] mb-1">
              Token Bearer (<code className="font-mono text-[11px] text-[#6a46d8]">AETHERA_REMOTE_TOKEN</code> do{' '}
              <code className="font-mono text-[11px]">.env.local</code> no Windows)
            </label>
            <input
              id="remote-host-token"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={hasTokenInMemory ? 'Token ativo em memória — informe novo para trocar' : 'Cole o token gerado pelo start-remote-host.ps1'}
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs font-mono text-[#111111]"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="button"
              disabled={busy || !urlInput.trim() || (!tokenInput.trim() && !hasTokenInMemory)}
              onClick={() => void handleConnect()}
              className="w-full h-10 rounded-full bg-[#111111] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[#24242c] disabled:opacity-50"
            >
              <Plug className="w-3.5 h-3.5 text-[#d8fb4f]" />
              <span>{isConnected ? 'Reconectar' : 'Conectar PC'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-[#f4f4f6] px-4 py-3 text-xs text-[#62626c] flex flex-wrap items-center justify-between gap-2">
          <span>
            No Windows, rode{' '}
            <code className="px-1.5 py-0.5 rounded bg-white text-[#111111] font-mono">
              .\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel ngrok
            </code>{' '}
            para iniciar o host em <strong className="text-[#111111]">127.0.0.1:4848</strong> e abrir o túnel HTTPS seguro.
          </span>
          {lastSyncedAt && (
            <span className="font-mono text-[11px]">
              Última sinc.: {new Date(lastSyncedAt).toLocaleTimeString('pt-BR')} • SSE:{' '}
              {sseConnected ? 'Ativo' : 'Aguardando job'}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-[#62626c] hover:text-[#111111]">
              Fechar
            </button>
          </div>
        )}
      </section>

      {/* Hardware Telemetry & Engine Status */}
      {hostStatus && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs text-[#62626c]">
              <span className="font-semibold inline-flex items-center gap-1.5 text-[#111111]">
                <Laptop className="w-4 h-4 text-[#6a46d8]" />
                Host & Motor
              </span>
              <span className="font-mono">{hostStatus.platform}</span>
            </div>
            <div className="text-base font-bold text-[#111111] truncate">{hostStatus.hostname}</div>
            <div className="text-[11px] font-mono text-[#62626c]">
              {hostStatus.bindHost}:{hostStatus.port} • Node {hostStatus.nodeVersion}
            </div>
            <span
              className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                hostStatus.engineMode === 'monorepo_cinema'
                  ? 'bg-[#d8fb4f] text-[#111111]'
                  : 'bg-[#efe9fd] text-[#6a46d8]'
              }`}
            >
              {hostStatus.engineMode === 'monorepo_cinema'
                ? 'Cinema Engine Real (@neuralbridge/cinema)'
                : 'Standalone Host (FFmpeg + Agentes)'}
            </span>
          </div>

          <div className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs text-[#62626c]">
              <span className="font-semibold inline-flex items-center gap-1.5 text-[#111111]">
                <Cpu className="w-4 h-4 text-[#6a46d8]" />
                CPU
              </span>
              <span className="font-mono font-bold text-[#111111]">{hostStatus.cpu.usagePct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#f4f4f6] overflow-hidden">
              <div className="h-full bg-[#6a46d8] rounded-full" style={{ width: `${hostStatus.cpu.usagePct}%` }} />
            </div>
            <div className="text-xs font-semibold text-[#111111] truncate">{hostStatus.cpu.model}</div>
            <div className="text-[11px] font-mono text-[#62626c]">
              {hostStatus.cpu.cores} núcleos • load 1m: {hostStatus.cpu.loadAvg1m}
            </div>
          </div>

          <div className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs text-[#62626c]">
              <span className="font-semibold inline-flex items-center gap-1.5 text-[#111111]">
                <HardDrive className="w-4 h-4 text-[#6a46d8]" />
                Memória RAM
              </span>
              <span className="font-mono font-bold text-[#111111]">{hostStatus.memory.usagePct}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#f4f4f6] overflow-hidden">
              <div className="h-full bg-[#111111] rounded-full" style={{ width: `${hostStatus.memory.usagePct}%` }} />
            </div>
            <div className="text-xs font-semibold text-[#111111]">
              {(hostStatus.memory.usedMb / 1024).toFixed(1)} GB / {(hostStatus.memory.totalMb / 1024).toFixed(1)} GB
            </div>
            <div className="text-[11px] font-mono text-[#62626c]">
              Livre: {(hostStatus.memory.freeMb / 1024).toFixed(1)} GB
            </div>
          </div>

          <div className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs text-[#62626c]">
              <span className="font-semibold inline-flex items-center gap-1.5 text-[#111111]">
                <Activity className="w-4 h-4 text-[#6a46d8]" />
                GPU & Binários
              </span>
              <span className="font-mono">
                {hostStatus.gpus.some((g) => g.nvencSupported) ? 'NVENC OK' : 'CPU libx264'}
              </span>
            </div>
            {hostStatus.gpus.length > 0 ? (
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-[#111111] truncate">{hostStatus.gpus[0].name}</div>
                <div className="text-[11px] font-mono text-[#62626c]">
                  VRAM: {hostStatus.gpus[0].vramUsedMb ?? '?'} / {hostStatus.gpus[0].vramTotalMb ?? '?'} MB
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#62626c]">Nenhuma GPU NVIDIA detectada neste host (fallback libx264).</div>
            )}
            <div className="flex flex-wrap gap-1 pt-1">
              {hostStatus.tools.map((t) => (
                <span
                  key={t.id}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                    t.available ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#f4f4f6] text-[#62626c]'
                  }`}
                >
                  {t.id}: {t.available ? 'OK' : 'ausente'}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Connected Workspace: Agents + Job Dispatcher + Live Queue & SSE Logs */}
      {isConnected && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* Left Column: Installed Agents + Dispatcher */}
          <div className="xl:col-span-5 space-y-4">
            {/* Installed Agents RF-07 */}
            {agentsInfo && (
              <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#6a46d8]" />
                    <span>Agentes no PC (RF-07)</span>
                  </h2>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      agentsInfo.soloModeReady ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#fde7f3] text-[#b42840]'
                    }`}
                  >
                    {agentsInfo.availableCount} disponível(is)
                  </span>
                </div>

                <div className="space-y-2">
                  {agentsInfo.agents.map((a) => (
                    <div key={a.id} className="rounded-2xl bg-[#f4f4f6] p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[#111111]">{a.label}</span>
                          {a.version && (
                            <span className="px-1.5 py-0.5 rounded bg-white text-[10px] font-mono text-[#62626c]">
                              {a.version}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#62626c] mt-0.5">
                          {a.available
                            ? `Pronto para execução (prioridade #${a.priority})`
                            : a.problem ?? 'Indisponível neste host.'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          a.available ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-white text-[#b42840]'
                        }`}
                      >
                        {a.available ? 'Ativo' : 'Ausente'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Remote Job Dispatcher */}
            <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
              <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-[#6a46d8]" />
                <span>Enviar Job para o PC Remoto</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="remote-op" className="block text-[11px] font-semibold text-[#111111] mb-1">
                    Operação autorizada
                  </label>
                  <select
                    id="remote-op"
                    value={operation}
                    onChange={(e) => setOperation(e.target.value as RemoteOperationType)}
                    className="w-full h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                  >
                    <option value="cinema.produce">Produção Cinema (Agente + FFmpeg)</option>
                    <option value="render.ffmpeg">Renderizar MP4 Real (FFmpeg GPU/CPU)</option>
                    <option value="agent.run">Executar Agente RF-07 (Roteiro)</option>
                    <option value="cinema.humanize">Humanize (Agente RF-07)</option>
                    <option value="cinema.youtube_audit">YouTube Agent (Auditoria)</option>
                    <option value="media.acquire">Aquisição yt-dlp (Aprovação obrigatória)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="remote-agent-pref" className="block text-[11px] font-semibold text-[#111111] mb-1">
                    Provedor preferencial (RF-07)
                  </label>
                  <select
                    id="remote-agent-pref"
                    value={preferredAgent}
                    onChange={(e) => setPreferredAgent(e.target.value as RemoteAgentId | 'auto')}
                    className="w-full h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
                  >
                    <option value="auto">Automático (Fallback RF-07)</option>
                    <option value="antigravity-cli">Antigravity CLI (agy)</option>
                    <option value="claude-cli">Claude Code CLI</option>
                    <option value="claude-gateway">Claude Gateway</option>
                    <option value="codex-cli">Codex CLI</option>
                    <option value="ollama">Ollama Local</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="remote-job-title" className="block text-[11px] font-semibold text-[#111111] mb-1">
                  Título da produção / job
                </label>
                <input
                  id="remote-job-title"
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Ex.: Os 10 segredos da engenharia do James Webb"
                  className="w-full h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                />
              </div>

              {operation === 'media.acquire' ? (
                <div>
                  <label htmlFor="remote-media-query" className="block text-[11px] font-semibold text-[#111111] mb-1">
                    Busca ou URL HTTPS (yt-dlp)
                  </label>
                  <input
                    id="remote-media-query"
                    type="text"
                    value={mediaQuery}
                    onChange={(e) => setMediaQuery(e.target.value)}
                    placeholder="Ex.: james webb telescope nebula 4k"
                    className="w-full h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="remote-job-prompt" className="block text-[11px] font-semibold text-[#111111] mb-1">
                    Prompt / Briefing editorial
                  </label>
                  <textarea
                    id="remote-job-prompt"
                    rows={3}
                    value={jobPrompt}
                    onChange={(e) => setJobPrompt(e.target.value)}
                    placeholder="Descreva o vídeo, roteiro ou revisão para execução real no PC..."
                    className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Formato"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')}
                  className="h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
                >
                  <option value="16:9">16:9 Horizontal</option>
                  <option value="9:16">9:16 Vertical</option>
                </select>
                <select
                  aria-label="Perfil FFmpeg"
                  value={qualityPreset}
                  onChange={(e) =>
                    setQualityPreset(e.target.value as NonNullable<CreateRemoteJobRequest['qualityPreset']>)
                  }
                  className="h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
                >
                  <option value="draft_540p">Prévia 540p</option>
                  <option value="master_1080p">HD 720p/1080p</option>
                  <option value="cinema_4k">Alta 1080p/4K</option>
                </select>
                <label className="h-9 rounded-2xl bg-[#f4f4f6] px-3 text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={useGpu} onChange={(e) => setUseGpu(e.target.checked)} />
                  <span>Usar GPU</span>
                </label>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSubmitJob()}
                className="w-full h-10 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center justify-center gap-2 hover:brightness-95 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Executar no PC Remoto</span>
              </button>
            </section>
          </div>

          {/* Right Column: Active Queue + Live Inspector + Preview Player */}
          <div className="xl:col-span-7 space-y-4">
            {/* Queue List */}
            <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-[#111111]">
                  Fila Remota Persistida ({jobs.length})
                </h2>
                <span className="text-[11px] font-mono text-[#62626c]">
                  Continua rodando mesmo se você fechar o navegador
                </span>
              </div>

              {jobs.length === 0 ? (
                <div className="rounded-2xl bg-[#f4f4f6] p-5 text-xs text-[#62626c] text-center">
                  Nenhum job remoto enviado ainda. Use o formulário ao lado para disparar um render FFmpeg ou agente no PC.
                </div>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {jobs.map((job) => {
                    const isSel = selectedJob?.id === job.id;
                    return (
                      <div
                        key={job.id}
                        onClick={() => selectJob(job.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') selectJob(job.id);
                        }}
                        className={`rounded-2xl p-3.5 transition-colors cursor-pointer space-y-2 ${
                          isSel ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e9e9ef]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{job.title}</div>
                            <div className={`text-[11px] font-mono ${isSel ? 'text-white/70' : 'text-[#62626c]'}`}>
                              {job.operation} • {job.id}
                              {job.encoderUsed ? ` • ${job.encoderUsed}` : ''}
                              {job.agentUsed ? ` • ${job.agentUsed}` : ''}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                job.status === 'completed'
                                  ? 'bg-[#d8fb4f] text-[#111111]'
                                  : job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted_on_restart'
                                    ? 'bg-[#fde7f3] text-[#b42840]'
                                    : job.status === 'awaiting_approval'
                                      ? 'bg-[#fef3c7] text-[#92400e]'
                                      : 'bg-[#b8a4f4] text-[#111111]'
                              }`}
                            >
                              {JOB_STATUS_LABEL[job.status]}
                              {job.progressPct !== null ? ` • ${job.progressPct}%` : ''}
                            </span>

                            {(job.status === 'running' || job.status === 'queued') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void cancelJob(job.id);
                                }}
                                className="h-7 px-2.5 rounded-full bg-white text-[#b42840] text-[11px] font-bold inline-flex items-center gap-1"
                              >
                                <Square className="w-3 h-3" />
                                <span>Cancelar</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {job.progressPct !== null && (
                          <div className={`w-full h-1.5 rounded-full overflow-hidden ${isSel ? 'bg-white/20' : 'bg-white'}`}>
                            <div
                              className="h-full bg-[#d8fb4f] rounded-full transition-all"
                              style={{ width: `${job.progressPct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Selected Job Inspector: Approval + Stages + Artifacts + Real-time SSE Logs */}
            {selectedJob && (
              <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[#111111]">{selectedJob.title}</h3>
                    <p className="text-xs text-[#62626c]">
                      {selectedJob.resultSummary || selectedJob.error || `Etapa atual: ${selectedJob.currentStage}`}
                    </p>
                  </div>

                  {selectedJob.status === 'awaiting_approval' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void approveJob(selectedJob.id, true, 'Aprovado no painel Remote Host')}
                        className="h-8 px-3.5 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold inline-flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Aprovar execução</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void approveJob(selectedJob.id, false, 'Rejeitado pelo operador')}
                        className="h-8 px-3 rounded-full bg-[#fde7f3] text-[#b42840] text-xs font-bold inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Rejeitar</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Stages */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedJob.stages.map((st) => (
                    <div key={st.id} className="rounded-2xl bg-[#f4f4f6] p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#111111]">{st.label}</span>
                        <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#6a46d8]">
                          {st.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#62626c]">{st.detail}</p>
                    </div>
                  ))}
                </div>

                {/* Artifacts (Preview & Download) */}
                {selectedJob.artifacts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-[#111111]">Artefatos gerados no PC</div>
                    <div className="space-y-2">
                      {selectedJob.artifacts.map((art) => (
                        <div
                          key={art.id}
                          className="rounded-2xl bg-[#efe9fd] p-3 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="text-xs">
                            <div className="font-bold text-[#111111]">{art.filename}</div>
                            <div className="text-[11px] font-mono text-[#2a1d5c]">
                              {Math.round(art.sizeBytes / 1024)} KB
                              {art.width && art.height ? ` • ${art.width}×${art.height}` : ''}
                              {art.videoCodec ? ` • ${art.videoCodec}/${art.audioCodec}` : ''}
                              {art.durationSec ? ` • ${art.durationSec}s` : ''}
                              {art.loudnessLufs !== null ? ` • ${art.loudnessLufs} LUFS` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {art.kind === 'video_mp4' && (
                              <button
                                type="button"
                                onClick={() => void handleOpenPreview(art.id, art.filename)}
                                className="h-8 px-3.5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <Play className="w-3 h-3 text-[#d8fb4f]" />
                                <span>Assistir prévia</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDownloadArtifact(art.id, art.filename)}
                              className="h-8 px-3 rounded-full bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              <span>Baixar</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ephemeral HMAC-signed Video Player */}
                {previewVideo && (
                  <div className="rounded-2xl bg-[#111111] p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-white px-1">
                      <span className="font-mono truncate">{previewVideo.filename}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewVideo(null)}
                        className="text-white/70 hover:text-white text-[11px]"
                      >
                        Fechar player
                      </button>
                    </div>
                    <video
                      key={previewVideo.streamUrl}
                      src={previewVideo.streamUrl}
                      controls
                      className="w-full max-h-[340px] rounded-xl bg-black"
                    />
                  </div>
                )}

                {/* Agent Text Output */}
                {selectedJob.outputText && (
                  <div className="rounded-2xl bg-[#f4f4f6] p-3 space-y-1">
                    <div className="text-[11px] font-bold text-[#111111] inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#2f7d32]" />
                      <span>Saída retornada pelo agente real</span>
                    </div>
                    <pre className="text-[11px] font-mono text-[#111111] whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {selectedJob.outputText}
                    </pre>
                  </div>
                )}

                {/* Real-time SSE Execution Logs */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#111111] inline-flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-[#6a46d8]" />
                      <span>Logs em tempo real (SSE + Last-Event-ID)</span>
                    </span>
                    <span className="text-[11px] font-mono text-[#62626c]">
                      {selectedJobEvents.length} eventos
                    </span>
                  </div>
                  <div className="rounded-2xl bg-[#111111] text-[#ececee] p-3 font-mono text-[11px] space-y-1 max-h-52 overflow-y-auto">
                    {selectedJobEvents.length === 0 ? (
                      <div className="text-white/50">Aguardando eventos do Remote Host...</div>
                    ) : (
                      selectedJobEvents.map((ev) => (
                        <div key={ev.seq} className="leading-relaxed">
                          <span className="text-white/40">#{ev.seq} </span>
                          <span className="text-[#b8a4f4]">[{ev.stage}] </span>
                          <span
                            className={
                              ev.level === 'error'
                                ? 'text-[#f9a8d4]'
                                : ev.level === 'warn'
                                  ? 'text-[#fde68a]'
                                  : 'text-[#ececee]'
                            }
                          >
                            {ev.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Authorized Projects from Host */}
            {projectsInfo && (
              <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2.5">
                <h2 className="text-sm font-bold text-[#111111]">
                  Projetos & Fontes Autorizadas no PC ({projectsInfo.projects.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {projectsInfo.sourcesChecked.map((src) => (
                    <div key={src.source} className="min-w-0 overflow-hidden rounded-2xl bg-[#f4f4f6] p-3 text-[11px]">
                      <div className="font-bold text-[#111111] font-mono truncate">{src.source}</div>
                      <div className="text-[#62626c] mt-0.5 break-words [overflow-wrap:anywhere]">{src.detail}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
