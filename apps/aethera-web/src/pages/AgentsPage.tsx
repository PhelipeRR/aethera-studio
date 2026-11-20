import { useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { AgentProviderConfig } from '../domain/types';
import { useStudio } from '../store/studio-store';

export function AgentsPage() {
  const {
    agentProviders,
    agentRuns,
    projects,
    capabilities,
    saveAgentProviders,
    testAgentProviderById,
    runHumanize,
    runYouTubeAgent,
  } = useStudio();

  const [testingId, setTestingId] = useState<string | null>(null);
  const [humanizeInput, setHumanizeInput] = useState(
    'No cenário atual, vale ressaltar que precisamos mergulhar fundo na arquitetura revolucionária de áudio espacial, portanto, sem dúvida alguma, o resultado final entrega imersão cinematográfica.',
  );
  const [humanizeTone, setHumanizeTone] = useState<'editorial' | 'conversacional' | 'documental'>('editorial');
  const [humanizeResult, setHumanizeResult] = useState<{
    text: string;
    changes: string[];
    before: number;
    after: number;
    mode: string;
    notice: string;
  } | null>(null);

  const [ytProjectId, setYtProjectId] = useState(projects[0]?.id ?? '');
  const [ytResult, setYtResult] = useState<{
    score: number;
    title: string;
    tags: string[];
    mode: string;
    notice: string;
    findings: Array<{ check: string; ok: boolean; recommendation: string }>;
  } | null>(null);

  const moveProvider = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= agentProviders.length) return;
    const copy: AgentProviderConfig[] = [...agentProviders];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    await saveAgentProviders(copy);
  };

  const toggleProvider = async (id: string) => {
    const next = agentProviders.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p));
    await saveAgentProviders(next);
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await testAgentProviderById(id);
    } finally {
      setTestingId(null);
    }
  };

  const handleRunHumanize = async () => {
    if (!humanizeInput.trim()) return;
    const res = await runHumanize({ text: humanizeInput, tone: humanizeTone });
    setHumanizeResult({
      text: res.result.humanizedText,
      changes: res.result.changes,
      before: res.result.readabilityBefore,
      after: res.result.readabilityAfter,
      mode: res.executionMode,
      notice: res.notice,
    });
  };

  const handleRunYouTube = async () => {
    const pid = ytProjectId || projects[0]?.id;
    if (!pid) return;
    const res = await runYouTubeAgent(pid);
    setYtResult({
      score: res.analysis.score,
      title: res.analysis.suggestedTitle,
      tags: res.analysis.suggestedTags,
      mode: res.executionMode,
      notice: res.notice,
      findings: res.analysis.findings,
    });
  };

  const anyCliInstalled = agentProviders.some((p) => p.installed);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6a46d8]">
            EQUIPE CINEMATOGRÁFICA • RF-07 • /AGENTS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Agentes &amp; Fallback RF-07</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Ordem de prioridade Antigravity → Claude Code → Codex CLI, diagnósticos individuais, Humanize e YouTube Agent.
          </p>
        </div>

        <span
          className={`h-9 px-4 rounded-full text-xs font-bold inline-flex items-center gap-2 ${
            anyCliInstalled ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#fff4dc] text-[#9a6200]'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>{anyCliInstalled ? 'CLIs nativos ativos' : 'CLIs ausentes no container (Fallback explícito)'}</span>
        </span>
      </div>

      {/* Honest Container Capability Banner */}
      {!anyCliInstalled && (
        <div className="rounded-[24px] bg-[#fff4dc] px-5 py-3.5 text-xs text-[#704700] flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Transparência de execução:</strong> Os binários externos{' '}
            <code className="font-mono">agy</code>, <code className="font-mono">claude</code>,{' '}
            <code className="font-mono">codex</code> e <code className="font-mono">ollama</code> não estão instalados
            neste container Web. O teste de cada agente executa uma sonda real no sistema operacional e reporta{' '}
            <code className="font-mono">cli_not_installed</code>. As ferramentas <strong>Humanize</strong> e{' '}
            <strong>YouTube Agent</strong> usam um motor determinístico local rotulado explicitamente até que os CLIs
            estejam presentes no host ou no Aethera Desktop.
          </div>
        </div>
      )}

      {/* RF-07 Fallback Chain Configurator */}
      <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[#111111]">Cadeia de Fallback Individual (RF-07)</h2>
          <span className="text-xs text-[#62626c]">
            Reordene a prioridade ou teste cada provedor individualmente
          </span>
        </div>

        <div className="space-y-2.5">
          {agentProviders.map((provider, idx) => (
            <div
              key={provider.id}
              className="rounded-2xl bg-[#f4f4f6] p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span className="w-7 h-7 rounded-full bg-[#111111] text-white text-xs font-mono font-bold inline-flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[#111111]">{provider.label}</span>
                    <code className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#62626c]">
                      {provider.command}
                    </code>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        provider.installed
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : 'bg-[#fde7f3] text-[#b42840]'
                      }`}
                    >
                      {provider.installed ? 'CLI Detectado' : 'CLI Ausente'}
                    </span>
                  </div>
                  <p className="text-xs text-[#62626c] mt-0.5">{provider.role}</p>
                  <p className="text-[11px] font-mono text-[#2a1d5c] mt-1">
                    Último status ({provider.lastTestStatus}): {provider.lastTestMessage}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void moveProvider(idx, -1)}
                  disabled={idx === 0}
                  aria-label={`Subir prioridade de ${provider.label}`}
                  className="w-8 h-8 rounded-full bg-white text-[#111111] inline-flex items-center justify-center disabled:opacity-35"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void moveProvider(idx, 1)}
                  disabled={idx === agentProviders.length - 1}
                  aria-label={`Descer prioridade de ${provider.label}`}
                  className="w-8 h-8 rounded-full bg-white text-[#111111] inline-flex items-center justify-center disabled:opacity-35"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleProvider(provider.id)}
                  className={`h-8 px-3 rounded-full text-xs font-semibold ${
                    provider.enabled ? 'bg-[#111111] text-white' : 'bg-white text-[#62626c]'
                  }`}
                >
                  {provider.enabled ? 'Ativo' : 'Pulado'}
                </button>
                <button
                  type="button"
                  disabled={testingId === provider.id}
                  onClick={() => void handleTest(provider.id)}
                  className="h-8 px-3.5 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3 h-3 ${testingId === provider.id ? 'animate-spin' : ''}`} />
                  <span>Testar</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Humanize + YouTube Agent Split */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {/* Humanize Studio */}
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#6a46d8]" />
              <h2 className="text-base font-bold text-[#111111]">Humanize — Naturalização de Roteiro</h2>
            </div>
            <select
              aria-label="Perfil de tom do Humanize"
              value={humanizeTone}
              onChange={(e) => setHumanizeTone(e.target.value as 'editorial' | 'conversacional' | 'documental')}
              className="h-8 rounded-full bg-[#f4f4f6] px-3 text-xs font-semibold text-[#111111]"
            >
              <option value="editorial">Editorial</option>
              <option value="conversacional">Conversacional</option>
              <option value="documental">Documental</option>
            </select>
          </div>

          <textarea
            rows={4}
            value={humanizeInput}
            onChange={(e) => setHumanizeInput(e.target.value)}
            aria-label="Texto para humanização"
            className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111]"
          />

          <button
            type="button"
            onClick={() => void handleRunHumanize()}
            className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#d8fb4f]" />
            <span>Executar Humanize</span>
          </button>

          {humanizeResult && (
            <div className="rounded-2xl bg-[#efe9fd] p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[#111111]">
                <span>
                  Legibilidade: {humanizeResult.before} → {humanizeResult.after}/100
                </span>
                <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono">
                  {humanizeResult.mode === 'real_cli' ? 'CLI Real' : 'Fallback Determinístico'}
                </span>
              </div>
              <p className="text-xs text-[#111111] bg-white rounded-xl p-3 leading-relaxed">
                {humanizeResult.text}
              </p>
              <ul className="text-[11px] text-[#2a1d5c] space-y-0.5 list-disc pl-4">
                {humanizeResult.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* YouTube Agent */}
        <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[#6a46d8]" />
            <h2 className="text-base font-bold text-[#111111]">YouTube Agent — SEO, CTR &amp; Retenção</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Selecionar projeto para YouTube Agent"
              value={ytProjectId}
              onChange={(e) => setYtProjectId(e.target.value)}
              className="flex-1 h-10 rounded-full bg-[#f4f4f6] px-3.5 text-xs font-semibold text-[#111111]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleRunYouTube()}
              className="h-10 px-5 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-bold"
            >
              Auditar Pacote
            </button>
          </div>

          {ytResult && (
            <div className="rounded-2xl bg-[#f4f4f6] p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-[#111111]">
                <span>Score SEO/Retenção: {ytResult.score}/100</span>
                <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono">
                  {ytResult.mode === 'real_cli' ? 'CLI Real' : 'Heurística Local'}
                </span>
              </div>
              <div className="text-xs font-semibold text-[#111111]">Título sugerido: {ytResult.title}</div>
              <div className="flex flex-wrap gap-1">
                {ytResult.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-full bg-white text-[10px] font-mono text-[#6a46d8]">
                    #{tag}
                  </span>
                ))}
              </div>
              <div className="space-y-1 pt-1">
                {ytResult.findings.map((f) => (
                  <div key={f.check} className="text-[11px] flex items-start gap-1.5">
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${f.ok ? 'text-[#2f7d32]' : 'text-[#9a6200]'}`}
                    />
                    <span className="text-[#111111]">
                      <strong>{f.check}:</strong> {f.recommendation}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Agent Runs */}
          <div className="pt-2 border-t border-[#e3e3e8] space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
              Execuções Recentes ({agentRuns.length}) • Node {capabilities.nodeVersion}
            </div>
            {agentRuns.slice(0, 4).map((run) => (
              <div key={run.id} className="rounded-xl bg-[#f4f4f6] px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-[#111111]">
                  <span>{run.providerUsed}</span>
                  <span className="font-mono text-[#6a46d8]">{run.executionMode}</span>
                </div>
                <p className="text-[#62626c] mt-0.5">{run.summary}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
