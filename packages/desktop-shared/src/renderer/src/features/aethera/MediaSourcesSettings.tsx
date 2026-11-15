import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleSlash, ExternalLink, KeyRound, Loader2, PlugZap, ShieldAlert } from 'lucide-react';

/**
 * Configurações → Fontes de mídia.
 *
 * Shows every media provider with its category, connectivity, credentials (masked), media types, known limits,
 * configurable priority, a connection test and the last recorded error. Secrets are typed here and sent once to the
 * main process; they are never read back — only a masked hint returns.
 */

type Connectivity =
  | 'unknown'
  | 'ok'
  | 'degraded'
  | 'down'
  | 'auth_missing'
  | 'auth_failed'
  | 'rate_limited'
  | 'disabled'
  | 'unavailable_permanently';

export interface MediaSourceProviderView {
  id: string;
  name: string;
  category: 'game_metadata' | 'game_media' | 'video_platform' | 'stock' | 'anime_reaction' | 'dataset';
  kinds: string[];
  docsUrl: string;
  enabled: boolean;
  priority: number;
  configured: boolean;
  credentialFields: Array<{ key: string; label: string; secret: boolean; optional?: boolean }>;
  credentialHint: string | null;
  knownLimits: string;
  termsSummary: string;
  capabilities: { automatedAcquisition: boolean; metadataOnly: boolean };
  permanentlyDisabledReason: string | null;
  connectivity: Connectivity;
  lastError: string | null;
  lastErrorAt: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
}

export interface MediaSourcesViewModel {
  providers: MediaSourceProviderView[];
  allowEditorialPromotionalUse: boolean;
  commercialUse: boolean;
}

interface MediaSourcesBridge {
  mediaSourcesList?: () => Promise<MediaSourcesViewModel>;
  mediaSourcesSaveSettings?: (input: {
    providers?: Record<string, { enabled?: boolean; priority?: number }>;
    allowEditorialPromotionalUse?: boolean;
    commercialUse?: boolean;
  }) => Promise<MediaSourcesViewModel>;
  mediaSourcesSaveCredential?: (input: { provider: string; values: Record<string, string> }) => Promise<MediaSourcesViewModel>;
  mediaSourcesClearCredential?: (input: { provider: string }) => Promise<MediaSourcesViewModel>;
  mediaSourcesTest?: (input: { provider: string }) => Promise<{ result: { connectivity: Connectivity; detail: string; latencyMs?: number }; view: MediaSourcesViewModel }>;
}

const bridge = (): MediaSourcesBridge => (window as unknown as { aetheraBridge?: MediaSourcesBridge }).aetheraBridge ?? {};

const CATEGORY_LABEL: Record<MediaSourceProviderView['category'], string> = {
  game_metadata: 'Metadados de jogos',
  game_media: 'Mídia de jogos',
  video_platform: 'Plataforma de vídeo',
  stock: 'Banco de stock',
  anime_reaction: 'Anime e reações',
  dataset: 'Datasets',
};

const CONNECTIVITY: Record<Connectivity, { label: string; tone: string }> = {
  ok: { label: 'Conectado', tone: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  unknown: { label: 'Não testado', tone: 'text-muted-foreground border-border bg-white/5' },
  degraded: { label: 'Instável', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  down: { label: 'Fora do ar', tone: 'text-red-300 border-red-500/40 bg-red-500/10' },
  auth_missing: { label: 'Credencial ausente', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  auth_failed: { label: 'Credencial recusada', tone: 'text-red-300 border-red-500/40 bg-red-500/10' },
  rate_limited: { label: 'Limite atingido', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  disabled: { label: 'Desativado', tone: 'text-muted-foreground border-border bg-white/5' },
  unavailable_permanently: { label: 'Indisponível', tone: 'text-red-300 border-red-500/40 bg-red-500/10' },
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

export function MediaSourcesSettings() {
  const [view, setView] = useState<MediaSourcesViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const available = Boolean(bridge().mediaSourcesList);

  const load = useCallback(async () => {
    const b = bridge();
    if (!b.mediaSourcesList) return;
    try {
      setView(await b.mediaSourcesList());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, work: () => Promise<MediaSourcesViewModel | undefined>) => {
    setBusy(key);
    try {
      const next = await work();
      if (next) setView(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e));
    } finally {
      setBusy(null);
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<MediaSourceProviderView['category'], MediaSourceProviderView[]>();
    for (const p of view?.providers ?? []) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
    return [...groups.entries()];
  }, [view]);

  if (!available) {
    return (
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Fontes de mídia</h2>
        <p className="text-xs text-muted-foreground">Disponível apenas no Aethera Studio desktop.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="media-sources-settings">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Fontes de mídia</h2>
        <p className="text-xs text-muted-foreground">
          Provedores usados para pesquisar, adquirir e validar trailers, gameplays, screenshots, stock, reações e datasets. A ordem de prioridade vale dentro
          das fontes adequadas a cada cena; nenhuma mídia é aprovada sem o Media Relevance Gate e uma licença compatível.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {view && (
        <fieldset className="space-y-3 rounded-xl border border-border bg-white/[0.02] p-4">
          <legend className="px-1 text-xs font-semibold">Política de uso</legend>
          <label className="flex items-start gap-3 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-purple-500"
              checked={view.commercialUse}
              disabled={busy !== null}
              onChange={(e) => void run('policy', () => bridge().mediaSourcesSaveSettings?.({ commercialUse: e.target.checked }) ?? Promise.resolve(undefined))}
            />
            <span>
              <span className="font-medium">Produção comercial (monetizada)</span>
              <span className="block text-muted-foreground">Bloqueia conteúdo cujos termos proíbem uso comercial (ex.: nekos.best, datasets CC BY-NC).</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-purple-500"
              checked={view.allowEditorialPromotionalUse}
              disabled={busy !== null}
              onChange={(e) => void run('policy', () => bridge().mediaSourcesSaveSettings?.({ allowEditorialPromotionalUse: e.target.checked }) ?? Promise.resolve(undefined))}
            />
            <span>
              <span className="font-medium">Permitir material promocional oficial para uso editorial</span>
              <span className="block text-muted-foreground">
                Trailers, screenshots e artes de publishers (Steam, IGDB, canais oficiais) em análises e comentários. Desligado: essas mídias vão para revisão humana.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {grouped.map(([category, providers]) => (
        <section key={category} className="space-y-3" aria-labelledby={`ms-cat-${category}`}>
          <h3 id={`ms-cat-${category}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABEL[category]}
          </h3>
          {providers.map((p) => {
            const conn = CONNECTIVITY[p.connectivity];
            const locked = p.permanentlyDisabledReason !== null;
            const draft = drafts[p.id] ?? {};
            const requiredFields = p.credentialFields.filter((f) => !f.optional);
            const canSave = p.credentialFields.length > 0 && (requiredFields.length === 0 ? Object.values(draft).some((v) => v.trim()) : requiredFields.every((f) => (draft[f.key] ?? '').trim()));
            return (
              <article key={p.id} data-testid={`media-source-${p.id}`} className={`space-y-3 rounded-xl border border-border p-4 ${locked ? 'opacity-70' : 'bg-white/[0.02]'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {p.name}{' '}
                      <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex align-middle text-muted-foreground hover:text-foreground" aria-label={`Documentação de ${p.name}`}>
                        <ExternalLink className="size-3.5" />
                      </a>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {CATEGORY_LABEL[p.category]} · {p.kinds.join(', ')}
                      {p.capabilities.metadataOnly ? ' · somente descoberta/metadados' : ''}
                      {!p.capabilities.automatedAcquisition ? ' · sem aquisição automática' : ''}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${conn.tone}`} data-testid={`media-source-status-${p.id}`}>
                    {p.connectivity === 'ok' ? <CheckCircle2 className="size-3" /> : locked ? <CircleSlash className="size-3" /> : <CircleAlert className="size-3" />}
                    {conn.label}
                  </span>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      role="switch"
                      className="size-4 accent-purple-500"
                      aria-label={`Ativar ${p.name}`}
                      checked={p.enabled}
                      disabled={locked || busy !== null}
                      onChange={(e) => void run(`toggle-${p.id}`, () => bridge().mediaSourcesSaveSettings?.({ providers: { [p.id]: { enabled: e.target.checked } } }) ?? Promise.resolve(undefined))}
                    />
                    Ativado
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    Prioridade
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className="w-16 rounded-lg border border-border bg-[#0d0d17] px-2 py-1 text-xs"
                      aria-label={`Prioridade de ${p.name} (menor roda primeiro)`}
                      defaultValue={p.priority}
                      disabled={locked}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isInteger(value) && value !== p.priority) {
                          void run(`prio-${p.id}`, () => bridge().mediaSourcesSaveSettings?.({ providers: { [p.id]: { priority: value } } }) ?? Promise.resolve(undefined));
                        }
                      }}
                    />
                  </label>
                </div>

                {locked ? (
                  <p className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-200">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                    {p.permanentlyDisabledReason}
                  </p>
                ) : (
                  <>
                    <dl className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[140px_1fr]">
                      <dt className="text-muted-foreground">Limites conhecidos</dt>
                      <dd>{p.knownLimits}</dd>
                      <dt className="text-muted-foreground">Licença e termos</dt>
                      <dd>{p.termsSummary}</dd>
                      <dt className="text-muted-foreground">Último teste</dt>
                      <dd>
                        {fmtDate(p.lastCheckedAt)}
                        {p.lastLatencyMs !== null ? ` · ${p.lastLatencyMs} ms` : ''}
                      </dd>
                      <dt className="text-muted-foreground">Último erro</dt>
                      <dd className={p.lastError ? 'text-amber-200' : ''} data-testid={`media-source-last-error-${p.id}`}>
                        {p.lastError ? `${p.lastError} (${fmtDate(p.lastErrorAt)})` : '—'}
                      </dd>
                    </dl>

                    {p.credentialFields.length > 0 && (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const values = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
                          void run(`cred-${p.id}`, async () => {
                            const next = await bridge().mediaSourcesSaveCredential?.({ provider: p.id, values });
                            setDrafts((d) => ({ ...d, [p.id]: {} }));
                            return next;
                          });
                        }}
                      >
                        <span className="flex w-full items-center gap-1 text-[11px] text-muted-foreground">
                          <KeyRound className="size-3" />
                          {p.configured && p.credentialHint ? `Configurado (${p.credentialHint}) — armazenado com criptografia do sistema.` : p.credentialFields.every((f) => f.optional) ? 'Credencial opcional.' : 'Credencial necessária.'}
                        </span>
                        {p.credentialFields.map((f) => (
                          <label key={f.key} className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px]">
                            {f.label}
                            <input
                              type={f.secret ? 'password' : 'text'}
                              autoComplete="off"
                              spellCheck={false}
                              value={draft[f.key] ?? ''}
                              onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: { ...(d[p.id] ?? {}), [f.key]: e.target.value } }))}
                              className="rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs"
                            />
                          </label>
                        ))}
                        <button type="submit" disabled={!canSave || busy !== null} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                          Salvar
                        </button>
                        {p.configured && p.credentialHint && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void run(`clear-${p.id}`, () => bridge().mediaSourcesClearCredential?.({ provider: p.id }) ?? Promise.resolve(undefined))}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs"
                          >
                            Remover
                          </button>
                        )}
                      </form>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        data-testid={`media-source-test-${p.id}`}
                        disabled={busy !== null || !p.enabled}
                        onClick={() =>
                          void run(`test-${p.id}`, async () => {
                            const res = await bridge().mediaSourcesTest?.({ provider: p.id });
                            if (res) setTestResult((t) => ({ ...t, [p.id]: `${CONNECTIVITY[res.result.connectivity].label}: ${res.result.detail}` }));
                            return res?.view;
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
                      >
                        {busy === `test-${p.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                        Testar conexão
                      </button>
                      {testResult[p.id] && (
                        <span role="status" className="text-[11px] text-muted-foreground">
                          {testResult[p.id]}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
