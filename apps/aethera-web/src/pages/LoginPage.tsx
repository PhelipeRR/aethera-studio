import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { AetheraMark } from '../components/AetheraMark';
import { useAuth } from '../store/auth-store';

type LoginViewMode = 'login' | 'reset_request' | 'reset_confirm';

export function LoginPage() {
  const { authState, setupTokenRequired, setupAdmin, login, requestPasswordReset, confirmPasswordReset } = useAuth();
  const isInitialSetup = authState === 'setup_required';

  const [mode, setMode] = useState<LoginViewMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmitSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password !== confirmPassword) {
      setError('A confirmação de senha não corresponde.');
      return;
    }

    setBusy(true);
    try {
      await setupAdmin({
        name: name.trim(),
        email: email.trim(),
        password,
        ...(setupTokenRequired ? { setupToken: setupToken.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const msg = await requestPasswordReset(email.trim());
      setNotice(msg);
      setMode('reset_confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirmPassword) {
      setError('A confirmação da nova senha não corresponde.');
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(resetCode.trim(), password);
      setNotice('Senha redefinida com sucesso. Todas as sessões anteriores foram encerradas.');
      setPassword('');
      setConfirmPassword('');
      setResetCode('');
      setMode('login');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#ececee] text-[#111111] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Editorial Identity Panel */}
        <section className="lg:col-span-5 rounded-[28px] bg-[#111111] text-white p-8 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <div className="inline-flex items-center rounded-2xl bg-white px-3.5 py-2">
              <AetheraMark />
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-tight leading-tight text-balance">
                Seu estúdio online conectado automaticamente ao seu PC Windows.
              </h1>
              <p className="text-sm text-white/75 leading-relaxed">
                Entre uma única vez com sua conta Aethera para manter projetos, Cinema Engine, agentes RF-07 e renders FFmpeg sincronizados no computador e no celular.
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-white/10 text-xs text-white/80">
            <div className="space-y-1">
              <div className="font-semibold text-white">Sessão persistente e revogável</div>
              <p className="text-white/65 leading-relaxed">
                Autenticação com Argon2id e cookie HttpOnly validado no servidor. Nenhum token é gravado em localStorage.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-white">Cofre criptografado AES-256-GCM</div>
              <p className="text-white/65 leading-relaxed">
                A credencial do Aethera Remote Host fica criptografada no backend e nunca é enviada ao navegador.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-white">Reconexão automática não bloqueante</div>
              <p className="text-white/65 leading-relaxed">
                Ao atualizar a página ou trocar de dispositivo, seu PC vinculado reconecta sozinho assim que estiver online.
              </p>
            </div>
          </div>
        </section>

        {/* Right Authentication Form Panel */}
        <main className="lg:col-span-7 rounded-[28px] bg-white p-8 sm:p-10 flex flex-col justify-center shadow-2xs">
          {isInitialSetup ? (
            <form onSubmit={(e) => void handleSubmitSetup(e)} className="space-y-5">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#6a46d8]">Configuração inicial do estúdio</p>
                <h2 className="text-2xl font-bold tracking-tight text-[#111111]">
                  Criar conta do administrador
                </h2>
                <p className="text-sm text-[#62626c]">
                  O cadastro público permanece desativado após esta etapa. Apenas contas autorizadas podem acessar o Aethera Web.
                </p>
              </div>

              {error && (
                <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label htmlFor="setup-name" className="block text-xs font-semibold text-[#111111] mb-1.5">
                    Nome
                  </label>
                  <input
                    id="setup-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome no estúdio"
                    className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                  />
                </div>

                <div>
                  <label htmlFor="setup-email" className="block text-xs font-semibold text-[#111111] mb-1.5">
                    E-mail
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@estudio.com"
                    className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="setup-password" className="block text-xs font-semibold text-[#111111] mb-1.5">
                      Senha (mín. 10 caracteres)
                    </label>
                    <input
                      id="setup-password"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Letras e números"
                      className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                    />
                  </div>
                  <div>
                    <label htmlFor="setup-confirm" className="block text-xs font-semibold text-[#111111] mb-1.5">
                      Confirmar senha
                    </label>
                    <input
                      id="setup-confirm"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a senha"
                      className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                    />
                  </div>
                </div>

                {setupTokenRequired && (
                  <div>
                    <label htmlFor="setup-token" className="block text-xs font-semibold text-[#111111] mb-1.5">
                      Token de implantação (<span className="font-mono text-[11px]">AETHERA_ADMIN_SETUP_TOKEN</span>)
                    </label>
                    <input
                      id="setup-token"
                      type="password"
                      required
                      autoComplete="off"
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                      placeholder="Cole o segredo configurado no servidor"
                      className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm font-mono text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-full bg-[#111111] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#24242c] transition-colors disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4 text-[#d8fb4f]" />
                <span>{busy ? 'Criando administrador...' : 'Criar conta e entrar no estúdio'}</span>
              </button>
            </form>
          ) : mode === 'login' ? (
            <form onSubmit={(e) => void handleSubmitLogin(e)} className="space-y-5">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#6a46d8]">Acesso autenticado</p>
                <h2 className="text-2xl font-bold tracking-tight text-[#111111]">Entrar no Aethera Studio</h2>
                <p className="text-sm text-[#62626c]">
                  Sua sessão permanece ativa entre atualizações e reconecta automaticamente seu PC Windows.
                </p>
              </div>

              {notice && (
                <div className="rounded-2xl bg-[#f3fdd0] px-4 py-3 text-xs font-semibold text-[#111111]">
                  {notice}
                </div>
              )}

              {error && (
                <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold text-[#111111] mb-1.5">
                    E-mail
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@estudio.com"
                    className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="text-xs font-semibold text-[#111111]">
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setMode('reset_request');
                      }}
                      className="text-xs font-medium text-[#6a46d8] hover:underline"
                    >
                      Recuperar senha
                    </button>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Sua senha"
                    className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-full bg-[#111111] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#24242c] transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4 text-[#d8fb4f]" />
                <span>{busy ? 'Autenticando...' : 'Entrar'}</span>
              </button>

              <p className="text-xs text-[#62626c]">
                Cadastro público desativado. Novas contas só podem ser emitidas pelo administrador do estúdio.
              </p>
            </form>
          ) : mode === 'reset_request' ? (
            <form onSubmit={(e) => void handleRequestReset(e)} className="space-y-5">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#62626c] hover:text-[#111111]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar ao login</span>
              </button>

              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold tracking-tight text-[#111111]">Recuperar acesso</h2>
                <p className="text-sm text-[#62626c]">
                  Informe o e-mail da conta. O código temporário de recuperação é emitido apenas pelo canal seguro do servidor e nunca exposto na resposta HTTP.
                </p>
              </div>

              {error && (
                <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="reset-email" className="block text-xs font-semibold text-[#111111] mb-1.5">
                  E-mail da conta
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@estudio.com"
                  className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111] focus:outline-none focus:border-[#6a46d8]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-11 px-6 rounded-full bg-[#111111] text-white text-sm font-semibold inline-flex items-center gap-2 hover:bg-[#24242c] disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4 text-[#d8fb4f]" />
                  <span>{busy ? 'Solicitando...' : 'Solicitar código'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('reset_confirm')}
                  className="h-11 px-4 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111] hover:bg-[#e5e5eb]"
                >
                  Já tenho um código
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void handleConfirmReset(e)} className="space-y-5">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode('login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#62626c] hover:text-[#111111]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar ao login</span>
              </button>

              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold tracking-tight text-[#111111]">Definir nova senha</h2>
                <p className="text-sm text-[#62626c]">
                  Informe o código temporário recebido e escolha uma nova senha forte.
                </p>
              </div>

              {notice && (
                <div className="rounded-2xl bg-[#f3fdd0] px-4 py-3 text-xs font-semibold text-[#111111]">
                  {notice}
                </div>
              )}

              {error && (
                <div role="alert" className="rounded-2xl bg-[#fde7f3] px-4 py-3 text-xs font-semibold text-[#b42840]">
                  {error}
                </div>
              )}

              <div className="space-y-3.5">
                <div>
                  <label htmlFor="reset-code" className="block text-xs font-semibold text-[#111111] mb-1.5">
                    Código de recuperação
                  </label>
                  <input
                    id="reset-code"
                    type="text"
                    required
                    autoComplete="off"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder="Cole o código temporário"
                    className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm font-mono text-[#111111]"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reset-new-pwd" className="block text-xs font-semibold text-[#111111] mb-1.5">
                      Nova senha
                    </label>
                    <input
                      id="reset-new-pwd"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mín. 10 caracteres"
                      className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111]"
                    />
                  </div>
                  <div>
                    <label htmlFor="reset-confirm-pwd" className="block text-xs font-semibold text-[#111111] mb-1.5">
                      Confirmar nova senha
                    </label>
                    <input
                      id="reset-confirm-pwd"
                      type="password"
                      required
                      minLength={10}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      className="w-full h-11 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-4 text-sm text-[#111111]"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 rounded-full bg-[#111111] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#24242c] disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4 text-[#d8fb4f]" />
                <span>{busy ? 'Redefinindo...' : 'Confirmar nova senha'}</span>
              </button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
