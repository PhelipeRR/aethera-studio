import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Laptop,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth, type LinkedComputer } from '../store/auth-store';
import { useRemoteHost } from '../store/remote-host-store';

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Nunca conectado';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function MyComputersSection() {
  const {
    computers,
    refreshAccountData,
    createComputer,
    updateComputer,
    rotateComputerCredential,
    revokeComputerCredential,
    testComputer,
    deleteComputer,
  } = useAuth();
  const { connectionState, activeComputer, reconnectNow, disconnect } = useRemoteHost();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [autoConnect, setAutoConnect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Credential rotation inline panel
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateToken, setRotateToken] = useState('');
  const [rotateUrl, setRotateUrl] = useState('');

  useEffect(() => {
    void refreshAccountData().catch(() => undefined);
  }, [refreshAccountData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await createComputer({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        bearerToken: bearerToken.trim(),
        autoConnect,
        setActive: true,
      });
      // Immediately clear secret input from component memory
      setBearerToken('');
      setName('');
      setBaseUrl('');
      if (res.probe.ok) {
        setNotice(`Computador "${res.computer.name}" vinculado com AES-256-GCM e conectado automaticamente.`);
        await reconnectNow(res.computer.id);
      } else {
        setNotice(
          `Computador "${res.computer.name}" salvo com credencial criptografada. Status atual: ${res.probe.error ?? 'PC Offline'}.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (comp: LinkedComputer) => {
    setActionId(comp.id);
    setError(null);
    setNotice(null);
    try {
      const res = await testComputer(comp.id);
      if (res.ok) {
        setNotice(`"${comp.name}" respondeu online com credencial válida.`);
        if (comp.isActive) {
          await reconnectNow(comp.id);
        }
      } else {
        setError(res.error ?? 'PC offline no momento.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const handleSetActive = async (comp: LinkedComputer) => {
    setActionId(comp.id);
    setError(null);
    setNotice(null);
    try {
      await updateComputer(comp.id, { isActive: true });
      await reconnectNow(comp.id);
      setNotice(`"${comp.name}" definido como PC ativo da sua conta.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const handleToggleAutoConnect = async (comp: LinkedComputer) => {
    setActionId(comp.id);
    setError(null);
    try {
      await updateComputer(comp.id, { autoConnect: !comp.autoConnect });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const handleRotate = async (comp: LinkedComputer) => {
    if (!rotateToken.trim()) return;
    setActionId(comp.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await rotateComputerCredential(
        comp.id,
        rotateToken.trim(),
        rotateUrl.trim() || undefined,
      );
      setRotateToken('');
      setRotateUrl('');
      setRotatingId(null);
      setNotice(`Credencial de "${updated.name}" rotacionada e recriptografada (${updated.tokenFingerprint}).`);
      if (updated.isActive) {
        await reconnectNow(updated.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const handleRevoke = async (comp: LinkedComputer) => {
    setActionId(comp.id);
    setError(null);
    setNotice(null);
    try {
      await revokeComputerCredential(comp.id);
      if (activeComputer?.id === comp.id) {
        disconnect();
      }
      setNotice(`Credencial de "${comp.name}" revogada no cofre do servidor.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (comp: LinkedComputer) => {
    setActionId(comp.id);
    setError(null);
    setNotice(null);
    try {
      await deleteComputer(comp.id);
      if (activeComputer?.id === comp.id) {
        disconnect();
      }
      setNotice(`Computador "${comp.name}" removido da sua conta.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionId(null);
    }
  };

  const statusText = (comp: LinkedComputer) => {
    if (activeComputer?.id === comp.id && connectionState === 'connected') return 'PC Online';
    if (activeComputer?.id === comp.id && connectionState === 'reconnecting') return 'Reconectando...';
    if (comp.lastStatus === 'revoked') return 'Credencial revogada';
    if (comp.lastStatus === 'online') return 'PC Online';
    if (comp.lastStatus === 'offline') return 'PC Offline';
    if (comp.lastStatus === 'error') return 'Erro de conexão';
    return 'Aguardando teste';
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-3 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-[#62626c] hover:text-[#111111]">
            Fechar
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
          {error}
        </div>
      )}

      {/* Register New Computer Form */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#6a46d8]" />
            <span>Vincular Computador (Aethera Remote Host)</span>
          </h2>
          <p className="text-xs text-[#62626c] mt-1">
            Cadastre seu PC Windows uma única vez. A credencial é criptografada com AES-256-GCM no servidor usando chave externa ao banco e nunca retorna ao navegador.
          </p>
        </div>

        <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label htmlFor="comp-name" className="block text-xs font-semibold text-[#111111] mb-1">
              Nome do computador
            </label>
            <input
              id="comp-name"
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: PC Estúdio Windows"
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
            />
          </div>

          <div className="md:col-span-4">
            <label htmlFor="comp-url" className="block text-xs font-semibold text-[#111111] mb-1">
              URL HTTPS do túnel ngrok
            </label>
            <input
              id="comp-url"
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://seu-tunel.ngrok-free.app"
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs font-mono text-[#111111]"
            />
          </div>

          <div className="md:col-span-5">
            <label htmlFor="comp-token" className="block text-xs font-semibold text-[#111111] mb-1">
              Credencial do Aethera Remote Host (somente escrita)
            </label>
            <input
              id="comp-token"
              type="password"
              required
              minLength={12}
              autoComplete="off"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Cole o AETHERA_REMOTE_TOKEN gerado no Windows"
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs font-mono text-[#111111]"
            />
          </div>

          <div className="md:col-span-8 flex items-center gap-2 pt-1">
            <input
              id="comp-autoconnect"
              type="checkbox"
              checked={autoConnect}
              onChange={(e) => setAutoConnect(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="comp-autoconnect" className="text-xs text-[#111111]">
              Reconectar automaticamente ao fazer login ou atualizar a página
            </label>
          </div>

          <div className="md:col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#24242c] disabled:opacity-50 whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 text-[#d8fb4f]" />
              <span>{busy ? 'Salvando e testando...' : 'Salvar e vincular PC'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Linked Computers List */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
              <Laptop className="w-4 h-4 text-[#6a46d8]" />
              <span>Meus Computadores ({computers.length})</span>
            </h2>
            <p className="text-xs text-[#62626c]">
              O proxy autenticado do Aethera Web utiliza apenas o PC ativo da sua conta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshAccountData()}
            className="h-9 px-3.5 rounded-full bg-[#f4f4f6] hover:bg-[#e3e3e8] text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Atualizar lista</span>
          </button>
        </div>

        {computers.length === 0 ? (
          <div className="rounded-2xl bg-[#f4f4f6] p-6 text-center text-xs text-[#62626c]">
            Nenhum computador vinculado ainda. Cadastre acima a URL HTTPS do túnel ngrok e o token do seu Windows para ativar a reconexão automática.
          </div>
        ) : (
          <div className="divide-y divide-[#e3e3e8]">
            {computers.map((comp) => {
              const isOnline =
                (activeComputer?.id === comp.id && connectionState === 'connected') ||
                comp.lastStatus === 'online';
              const isBusyRow = actionId === comp.id;

              return (
                <article key={comp.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-[#111111]">{comp.name}</h3>
                        {comp.isActive && (
                          <span className="text-xs font-semibold text-[#6a46d8]">· PC Ativo</span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            isOnline
                              ? 'text-[#16a34a]'
                              : comp.lastStatus === 'revoked' || comp.lastStatus === 'error'
                                ? 'text-[#dc2626]'
                                : 'text-[#62626c]'
                          }`}
                        >
                          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                          <span>{statusText(comp)}</span>
                        </span>
                      </div>

                      <div className="text-xs font-mono text-[#62626c] break-all">{comp.baseUrl}</div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#62626c] font-mono tabular-nums">
                        <span>Host ID: {comp.stableHostId}</span>
                        <span>·</span>
                        <span>Credencial: {comp.hasCredential ? comp.tokenFingerprint : 'Revogada'}</span>
                        <span>·</span>
                        <span>Última conexão: {formatDateTime(comp.lastConnectedAt)}</span>
                      </div>

                      {comp.lastError && (
                        <p className="text-xs text-[#b42840] pt-0.5">{comp.lastError}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {comp.hasCredential && (
                        <button
                          type="button"
                          disabled={isBusyRow}
                          onClick={() => void handleTest(comp)}
                          className="h-8 px-3 rounded-full bg-[#111111] text-white text-xs font-semibold hover:bg-[#24242c] disabled:opacity-50 whitespace-nowrap"
                        >
                          Conectar / Testar
                        </button>
                      )}

                      {!comp.isActive && comp.hasCredential && (
                        <button
                          type="button"
                          disabled={isBusyRow}
                          onClick={() => void handleSetActive(comp)}
                          className="h-8 px-3 rounded-full bg-[#f4f4f6] hover:bg-[#e5e5eb] text-xs font-semibold text-[#111111] whitespace-nowrap"
                        >
                          Definir Ativo
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusyRow}
                        onClick={() => void handleToggleAutoConnect(comp)}
                        className="h-8 px-3 rounded-full bg-[#f4f4f6] hover:bg-[#e5e5eb] text-xs font-semibold text-[#111111] whitespace-nowrap"
                      >
                        Auto-conectar: {comp.autoConnect ? 'Sim' : 'Não'}
                      </button>

                      <button
                        type="button"
                        disabled={isBusyRow}
                        onClick={() => {
                          setRotatingId(rotatingId === comp.id ? null : comp.id);
                          setRotateUrl(comp.baseUrl);
                          setRotateToken('');
                        }}
                        className="h-8 px-3 rounded-full bg-[#efe9fd] hover:bg-[#e4d9fb] text-xs font-semibold text-[#2a1d5c] inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Rotacionar</span>
                      </button>

                      {comp.hasCredential && (
                        <button
                          type="button"
                          disabled={isBusyRow}
                          onClick={() => void handleRevoke(comp)}
                          className="h-8 px-3 rounded-full bg-[#fde7f3] hover:bg-[#fbd0e7] text-xs font-semibold text-[#b42840] inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <Unplug className="w-3 h-3" />
                          <span>Revogar</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusyRow}
                        onClick={() => void handleDelete(comp)}
                        aria-label={`Remover computador ${comp.name}`}
                        className="h-8 w-8 rounded-full bg-[#f4f4f6] hover:bg-[#fde7f3] text-[#62626c] hover:text-[#b42840] inline-flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {rotatingId === comp.id && (
                    <div className="rounded-2xl bg-[#f4f4f6] p-4 space-y-3">
                      <div className="text-xs font-bold text-[#111111]">
                        Rotacionar credencial / URL de {comp.name}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor={`rotate-url-${comp.id}`}
                            className="block text-[11px] font-semibold text-[#111111] mb-1"
                          >
                            URL HTTPS do túnel (opcional atualizar)
                          </label>
                          <input
                            id={`rotate-url-${comp.id}`}
                            type="url"
                            value={rotateUrl}
                            onChange={(e) => setRotateUrl(e.target.value)}
                            className="w-full h-9 rounded-xl bg-white border border-[#e3e3e8] px-3 text-xs font-mono text-[#111111]"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`rotate-token-${comp.id}`}
                            className="block text-[11px] font-semibold text-[#111111] mb-1"
                          >
                            Novo token Bearer do Remote Host
                          </label>
                          <input
                            id={`rotate-token-${comp.id}`}
                            type="password"
                            autoComplete="off"
                            value={rotateToken}
                            onChange={(e) => setRotateToken(e.target.value)}
                            placeholder="Cole a nova credencial"
                            className="w-full h-9 rounded-xl bg-white border border-[#e3e3e8] px-3 text-xs font-mono text-[#111111]"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setRotatingId(null)}
                          className="h-8 px-3.5 rounded-full bg-white text-xs font-semibold text-[#62626c]"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={isBusyRow || rotateToken.trim().length < 12}
                          onClick={() => void handleRotate(comp)}
                          className="h-8 px-4 rounded-full bg-[#111111] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          Salvar nova credencial
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function MyAccountSection() {
  const {
    user,
    sessions,
    auditLogs,
    refreshAccountData,
    revokeSession,
    logout,
    logoutAll,
    changePassword,
  } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshAccountData().catch(() => undefined);
  }, [refreshAccountData]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError('A confirmação da nova senha não corresponde.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Senha atualizada com Argon2id. Outras sessões ativas foram revogadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-3 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-[#62626c] hover:text-[#111111]">
            Fechar
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
          {error}
        </div>
      )}

      {/* Account Profile */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-[#6a46d8]">
            {user?.role === 'admin' ? 'Administrador do Estúdio' : 'Membro Autorizado'}
          </div>
          <h2 className="text-lg font-bold text-[#111111]">{user?.name}</h2>
          <div className="text-xs text-[#62626c] font-mono">
            {user?.email} · Conta criada em {formatDateTime(user?.createdAt ?? null)}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="h-10 px-4 rounded-full bg-[#fde7f3] hover:bg-[#fbd0e7] text-[#b42840] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sair desta sessão</span>
        </button>
      </section>

      {/* Active Sessions (Desktop & Mobile) */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[#111111]">
              Sessões Ativas ({sessions.length})
            </h2>
            <p className="text-xs text-[#62626c]">
              Sessões persistentes via cookie HttpOnly no computador e no celular. Revogue qualquer dispositivo instantaneamente.
            </p>
          </div>
          {sessions.length > 1 && (
            <button
              type="button"
              onClick={async () => {
                const count = await logoutAll(false);
                setNotice(`${count} outra(s) sessão(ões) revogada(s).`);
              }}
              className="h-9 px-3.5 rounded-full bg-[#f4f4f6] hover:bg-[#fde7f3] hover:text-[#b42840] text-xs font-semibold text-[#111111] whitespace-nowrap"
            >
              Encerrar outras sessões
            </button>
          )}
        </div>

        <div className="divide-y divide-[#e3e3e8]">
          {sessions.map((s) => {
            const isMobile = s.deviceLabel.startsWith('Celular');
            return (
              <div key={s.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-2xl bg-[#f4f4f6] flex items-center justify-center shrink-0 text-[#111111]">
                    {isMobile ? <Smartphone className="w-4 h-4" /> : <Laptop className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#111111] flex items-center gap-2">
                      <span>{s.deviceLabel}</span>
                      {s.isCurrent && (
                        <span className="text-[11px] font-semibold text-[#16a34a] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Sessão atual
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-[#62626c] tabular-nums">
                      IP {s.ipAddress} · Última atividade: {formatDateTime(s.lastSeenAt)} · Expira: {formatDateTime(s.expiresAt)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void revokeSession(s.id)}
                  className="h-8 px-3 rounded-full bg-[#f4f4f6] hover:bg-[#fde7f3] hover:text-[#b42840] text-xs font-semibold text-[#111111] whitespace-nowrap"
                >
                  {s.isCurrent ? 'Sair' : 'Revogar'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Change Password */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#6a46d8]" />
            <span>Alterar Senha (Argon2id)</span>
          </h2>
          <p className="text-xs text-[#62626c] mt-0.5">
            Ao alterar sua senha, todas as demais sessões em outros dispositivos são revogadas automaticamente.
          </p>
        </div>

        <form onSubmit={(e) => void handleChangePassword(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label htmlFor="pwd-current" className="block text-xs font-semibold text-[#111111] mb-1">
              Senha atual
            </label>
            <input
              id="pwd-current"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
            />
          </div>
          <div>
            <label htmlFor="pwd-new" className="block text-xs font-semibold text-[#111111] mb-1">
              Nova senha (mín. 10 caracteres)
            </label>
            <input
              id="pwd-new"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
            />
          </div>
          <div>
            <label htmlFor="pwd-confirm" className="block text-xs font-semibold text-[#111111] mb-1">
              Confirmar nova senha
            </label>
            <input
              id="pwd-confirm"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold hover:bg-[#24242c] disabled:opacity-50"
            >
              {busy ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </div>
        </form>
      </section>

      {/* Security Audit Trail */}
      <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#6a46d8]" />
            <span>Auditoria de Segurança ({auditLogs.length})</span>
          </h2>
          <span className="text-xs text-[#62626c]">Senhas e tokens nunca são gravados nos registros</span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-xs text-[#62626c]">Nenhum evento registrado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#e3e3e8] text-[#62626c]">
                  <th className="py-2 pr-3 font-semibold">Data</th>
                  <th className="py-2 pr-3 font-semibold">Evento</th>
                  <th className="py-2 pr-3 font-semibold">Detalhe</th>
                  <th className="py-2 font-semibold text-right">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f3]">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 pr-3 font-mono text-[11px] text-[#62626c] whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] font-semibold text-[#111111] whitespace-nowrap">
                      {log.eventType}
                    </td>
                    <td className="py-2 pr-3 text-[#111111]">{log.detail}</td>
                    <td className="py-2 font-mono text-[11px] text-[#62626c] text-right whitespace-nowrap">
                      {log.ipAddress}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
