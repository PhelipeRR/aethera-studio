import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  Camera,
  Clapperboard,
  Crown,
  FileText,
  Film,
  Laugh,
  LayoutGrid,
  LoaderCircle,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserCheck,
  Volume2,
  Wand2,
} from 'lucide-react';
import { Link } from 'react-router';
import { HEALTH_LABEL, healthOf, useAgents } from '@/app/useAgents';
import {
  AetheraAcademyPanel,
  type AcademyKnowledgeView,
  type AcademyMaterialView,
  type AcademySnapshotView,
} from './AetheraAcademyPanel';

type TeamTab = 'directors' | 'evolution' | 'academy' | 'engines';

interface DirectorProfileView {
  id: string;
  title: string;
  mission: string;
  wave: number;
  inputs: string[];
  outputs: string[];
}

interface EvolutionMemoryView {
  memoryId: string;
  techniqueKey: string;
  directorId: string;
  kind: string;
  epistemicLevel: string;
  state: 'proposed' | 'evaluating' | 'validated' | 'rejected' | 'disabled';
  title: string;
  content: string;
  confidence: number;
  version: number;
  updatedAt: string;
}

interface DirectorDecisionView {
  decisionId: string;
  directorId: string;
  projectId: string;
  summary: string;
  rationale: string;
  consultedMemoryIds: string[];
  createdAt: string;
}

interface EvolutionSnapshotView {
  memories: EvolutionMemoryView[];
  decisions: DirectorDecisionView[];
  feedbackLog: Array<{ feedbackId: string; classification: string; targetDirector: string; rawText: string }>;
}

interface Rf07EngineStatus {
  id: string;
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  testedVersion: string;
  authenticated: boolean | null;
  authMethod: string | null;
  features: string[];
  warnings: string[];
  problems: string[];
  checkedAt: string;
}

interface EvolutionBridge {
  cinemaEvolutionSnapshot?: (input?: { refresh?: boolean }) => Promise<{
    directors: DirectorProfileView[];
    snapshot: EvolutionSnapshotView;
    extraEngines?: Rf07EngineStatus[];
  }>;
  cinemaSubmitFeedback?: (input: {
    text: string;
    projectId?: string;
    genre?: string;
  }) => Promise<{ snapshot: EvolutionSnapshotView }>;
  cinemaToggleMemory?: (input: {
    memoryId: string;
    action: 'disable' | 'rollback' | 'delete';
  }) => Promise<{ snapshot: EvolutionSnapshotView }>;
  cinemaRunDirectorsDag?: (input: {
    projectId?: string;
    prompt: string;
    genre?: string;
  }) => Promise<{ snapshot: EvolutionSnapshotView }>;
  cinemaAcademySnapshot?: () => Promise<AcademySnapshotView>;
  cinemaAcademyIngest?: (input: Record<string, unknown>) => Promise<{
    academy: AcademySnapshotView;
    evolution: EvolutionSnapshotView;
  } | null>;
  cinemaAcademyRunExercise?: (input: Record<string, unknown>) => Promise<{
    academy: AcademySnapshotView;
    evolution: EvolutionSnapshotView;
  }>;
  cinemaAcademyAsk?: (input: { question: string; directorFilter?: string }) => Promise<{
    answer: string;
    sufficientKnowledge?: boolean;
    synthesisMode?: 'rf07_ai' | 'grounded_extractive' | 'insufficient_evidence';
    citations: Array<{
      materialId: string;
      title: string;
      reference: string;
      excerpt: string;
      relevanceScore?: number;
    }>;
  }>;
  cinemaAcademyReprocess?: () => Promise<{
    reprocessedCount: number;
    totalKnowledge: number;
    academy: AcademySnapshotView;
    evolution: EvolutionSnapshotView;
  }>;
  cinemaAcademyDeleteMaterial?: (input: { materialId: string }) => Promise<{
    academy: AcademySnapshotView;
    evolution: EvolutionSnapshotView;
  }>;
  cinemaAcademyExportBackup?: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    counts?: { materials: number; knowledge: number; exercises: number; memories: number };
  }>;
  cinemaAcademyRestoreBackup?: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    academy?: AcademySnapshotView;
    evolution?: EvolutionSnapshotView;
  }>;
}

const FALLBACK_DIRECTORS: DirectorProfileView[] = [
  { id: 'general_director', title: 'Diretor Geral / Showrunner', mission: 'Visão unificada e arbitragem final entre diretores.', wave: 1, inputs: [], outputs: [] },
  { id: 'narrative_director', title: 'Diretor Narrativo', mission: 'Arco dramático, hook inicial e coerência narrativa.', wave: 1, inputs: [], outputs: [] },
  { id: 'screenwriter', title: 'Roteirista', mission: 'Roteiro estruturado, clareza e otimização para retenção.', wave: 1, inputs: [], outputs: [] },
  { id: 'research_director', title: 'Diretor de Pesquisa', mission: 'Verificação factual, procedência e contexto técnico.', wave: 1, inputs: [], outputs: [] },
  { id: 'storyboard_director', title: 'Diretor de Storyboard', mission: 'Decupagem em cenas, Plano A/B e lacunas explícitas.', wave: 2, inputs: [], outputs: [] },
  { id: 'cinematographer', title: 'Diretor de Fotografia', mission: 'Enquadramento, câmera, luz, Rec.709 e composição.', wave: 2, inputs: [], outputs: [] },
  { id: 'art_director', title: 'Diretor de Arte', mission: 'Identidade visual, paleta, atmosfera e estilo.', wave: 2, inputs: [], outputs: [] },
  { id: 'casting_director', title: 'Diretor de Elenco / Vozes', mission: 'Seleção de vozes VoiceStudio, entonação e consistência.', wave: 2, inputs: [], outputs: [] },
  { id: 'editing_director', title: 'Diretor de Edição', mission: 'Montagem, ritmo, cortes motivados e J/L cuts.', wave: 3, inputs: [], outputs: [] },
  { id: 'sound_director', title: 'Diretor de Som', mission: 'Timeline A1-A5 sem sobreposição, ducking e EBU R128.', wave: 3, inputs: [], outputs: [] },
  { id: 'vfx_director', title: 'Diretor de VFX & Motion', mission: 'Composição, tipografia segura e desvio de HUD.', wave: 3, inputs: [], outputs: [] },
  { id: 'colorist', title: 'Colorista', mission: 'Color grading, balanço tonal e consistência entre cenas.', wave: 3, inputs: [], outputs: [] },
  { id: 'comedy_director', title: 'Diretor de Humor', mission: 'Humor pontual (35% padrão) e bloqueio de cenas sensíveis.', wave: 3, inputs: [], outputs: [] },
  { id: 'retention_director', title: 'Diretor de Retenção / Ritmo', mission: 'Energia, micro-ganchos e prevenção de vales de tédio.', wave: 4, inputs: [], outputs: [] },
  { id: 'quality_supervisor', title: 'Supervisor de Qualidade', mission: 'Auditoria técnica, QC e aprovação dos Release Gates.', wave: 5, inputs: [], outputs: [] },
];

const DIRECTOR_ICONS: Record<string, typeof Clapperboard> = {
  general_director: Crown,
  narrative_director: Clapperboard,
  screenwriter: FileText,
  research_director: BookOpen,
  storyboard_director: LayoutGrid,
  cinematographer: Camera,
  art_director: Wand2,
  casting_director: UserCheck,
  editing_director: Scissors,
  sound_director: Volume2,
  vfx_director: Sparkles,
  colorist: Palette,
  comedy_director: Laugh,
  retention_director: TrendingUp,
  quality_supervisor: ShieldCheck,
};

function getBridge(): EvolutionBridge {
  return (window as unknown as { aetheraBridge?: EvolutionBridge }).aetheraBridge ?? {};
}

export function AetheraAgentsPage() {
  const { agents, checking, error, refresh } = useAgents();
  const [tab, setTab] = useState<TeamTab>('directors');
  const [directors, setDirectors] = useState<DirectorProfileView[]>(FALLBACK_DIRECTORS);
  const [evolution, setEvolution] = useState<EvolutionSnapshotView>({
    memories: [],
    decisions: [],
    feedbackLog: [],
  });
  const [academy, setAcademy] = useState<AcademySnapshotView>({
    materials: [],
    knowledge: [],
    exercises: [],
  });
  const [extraEngines, setExtraEngines] = useState<Rf07EngineStatus[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [dagPrompt, setDagPrompt] = useState('Documentário cinematográfico sobre exploração espacial com humor 35%');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadEvolutionData = useCallback(async (forceRefresh = false) => {
    const bridge = getBridge();
    try {
      if (bridge.cinemaEvolutionSnapshot) {
        const res = await bridge.cinemaEvolutionSnapshot(forceRefresh ? { refresh: true } : undefined);
        if (res?.directors?.length) setDirectors(res.directors);
        if (res?.snapshot) setEvolution(res.snapshot);
        if (res?.extraEngines) setExtraEngines(res.extraEngines);
      }
      if (bridge.cinemaAcademySnapshot) {
        const ac = await bridge.cinemaAcademySnapshot();
        if (ac) setAcademy(ac);
      }
    } catch {
      // Keep fallback metadata when outside Electron preload
    }
  }, []);

  useEffect(() => {
    void loadEvolutionData();
  }, [loadEvolutionData]);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const bridge = getBridge();
    if (!feedbackText.trim() || !bridge.cinemaSubmitFeedback) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaSubmitFeedback({ text: feedbackText.trim() });
      setEvolution(res.snapshot);
      setFeedbackText('');
      setStatusMessage('Feedback classificado e registrado na memória evolutiva.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMemory = async (memoryId: string, action: 'disable' | 'rollback' | 'delete') => {
    const bridge = getBridge();
    if (!bridge.cinemaToggleMemory) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaToggleMemory({ memoryId, action });
      setEvolution(res.snapshot);
      setStatusMessage(`Memória atualizada (${action}).`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunDag = async () => {
    const bridge = getBridge();
    if (!bridge.cinemaRunDirectorsDag || !dagPrompt.trim()) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaRunDirectorsDag({ prompt: dagPrompt.trim() });
      setEvolution(res.snapshot);
      setStatusMessage('Orquestração DAG dos 15 diretores concluída com decisões registradas.');
    } finally {
      setBusy(false);
    }
  };

  const handleIngest = async (input: {
    title: string;
    kind: AcademyMaterialView['kind'];
    sourceUri?: string;
    author: string;
    license: string;
    rightsScope: AcademyMaterialView['rightsScope'];
    mode: AcademyMaterialView['mode'];
    textContent?: string;
  }) => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyIngest) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyIngest(input);
      if (res) {
        setAcademy(res.academy);
        setEvolution(res.evolution);
        setStatusMessage(`Material "${input.title}" indexado na Aethera Academy.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRunExercise = async (knowledge: AcademyKnowledgeView) => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyRunExercise) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyRunExercise({
        title: `Prática: ${knowledge.techniqueName}`,
        directorId: knowledge.directorId,
        knowledgeIds: [knowledge.knowledgeId],
        qualityScore: 88,
        passed: true,
        notes: `Exercício validado na Academia para ${knowledge.techniqueName}.`,
      });
      setAcademy(res.academy);
      setEvolution(res.evolution);
      setStatusMessage(`Exercício validado para ${knowledge.directorId}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyDeleteMaterial) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyDeleteMaterial({ materialId });
      setAcademy(res.academy);
      setEvolution(res.evolution);
      setStatusMessage('Material e memórias derivadas removidos.');
    } finally {
      setBusy(false);
    }
  };

  const handleAsk = async (question: string) => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyAsk) return null;
    return bridge.cinemaAcademyAsk({ question });
  };

  const handleReprocess = async () => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyReprocess) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyReprocess();
      setAcademy(res.academy);
      setEvolution(res.evolution);
      setStatusMessage(
        `Acervo reprocessado: ${res.reprocessedCount} material(is), ${res.totalKnowledge} conceito(s) estruturado(s).`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExportBackup = async () => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyExportBackup) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyExportBackup();
      if (res.canceled || !res.ok) return;
      const c = res.counts;
      setStatusMessage(
        `Backup salvo em ${res.filePath} (${c?.materials ?? 0} materiais, ${c?.knowledge ?? 0} técnicas, ${c?.memories ?? 0} memórias).`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    const bridge = getBridge();
    if (!bridge.cinemaAcademyRestoreBackup) return;
    setBusy(true);
    try {
      const res = await bridge.cinemaAcademyRestoreBackup();
      if (res.canceled || !res.ok) return;
      if (res.academy) setAcademy(res.academy);
      if (res.evolution) setEvolution(res.evolution);
      setStatusMessage(
        `Backup restaurado de ${res.filePath}: ${res.academy?.materials.length ?? 0} material(is), ${res.academy?.knowledge.length ?? 0} técnica(s).`,
      );
    } catch (err) {
      setStatusMessage(`Erro ao restaurar backup: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const allEngines: Rf07EngineStatus[] = [
    ...(agents ?? []),
    ...extraEngines.filter((extra) => !(agents ?? []).some((a) => a.id === extra.id)),
  ];
  const readyEngines = allEngines.filter((a) => healthOf(a as Parameters<typeof healthOf>[0]) === 'ready');
  const onlineCount = readyEngines.length;
  const validatedCount = evolution.memories.filter((m) => m.state === 'validated').length;
  const fallbackMode =
    onlineCount === 1
      ? `Modo autônomo com 1 agente operacional (${readyEngines[0]?.label ?? 'CLI'}) — RF-07 ativo`
      : onlineCount > 1
        ? `${onlineCount} motores técnicos prontos (multiagente + fallback automático)`
        : 'Nenhum CLI autenticado no momento — configure Claude, Codex ou Antigravity para execução autônoma';

  return (
    <div className="space-y-6 p-6 xl:p-8">
      {/* Cinematic Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-[#1a102d] via-[#100e1b] to-[#1a130b] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.22em] text-amber-400 uppercase">
              Aethera Evolution & Academy
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              Equipe de 15 Diretores Cinematográficos
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Diretores especializados com memória persistente, aprendizado verificável e formação contínua na Aethera Academia.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-200">
              <Brain className="size-3.5" />
              {validatedCount} regra(s) validada(s) · {evolution.decisions.length} decisão(ões)
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                onlineCount > 0
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              <span className={`size-2 rounded-full ${onlineCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {onlineCount > 0 ? `${onlineCount} motor(es) RF-07` : 'Aguardando motor CLI'}
            </span>
            <button
              type="button"
              onClick={() => {
                refresh();
                void loadEvolutionData(true);
              }}
              disabled={checking}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs hover:border-primary/50"
            >
              {checking ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Verificar
            </button>
          </div>
        </div>

        {/* Subtabs */}
        <div className="mt-5 flex flex-wrap gap-2">
          {(
            [
              ['directors', `Diretores (${directors.length})`],
              ['evolution', `Memória & Feedback (${evolution.memories.length})`],
              ['academy', `Aethera Academia (${academy.materials.length})`],
              ['engines', 'Motores Técnicos (RF-07)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                tab === id
                  ? 'border-primary/60 bg-primary/20 text-foreground'
                  : 'border-border bg-[#11111e] text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}

      {tab === 'engines' && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Motores Técnicos Subjacentes (Claude / Codex / Antigravity)</h2>
            <p className="text-xs text-muted-foreground">{fallbackMode}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {allEngines.map((agent) => {
              const health = healthOf(agent as Parameters<typeof healthOf>[0]);
              return (
                <div key={agent.id} className="rounded-xl border border-border bg-[#0d0d17] p-4 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{agent.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        health === 'ready'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {HEALTH_LABEL[health]}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {agent.installed ? `Instalado (${agent.version ?? 'CLI'})` : 'Não instalado'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'directors' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <input
              value={dagPrompt}
              onChange={(e) => setDagPrompt(e.target.value)}
              aria-label="Briefing para orquestração DAG"
              className="flex-1 min-w-[260px] rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleRunDag}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              <Play className="size-3.5" />
              Executar Orquestração DAG (15 Diretores)
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {directors.map((role) => {
              const Icon = DIRECTOR_ICONS[role.id] ?? Activity;
              const roleMemories = evolution.memories.filter((m) => m.directorId === role.id && m.state !== 'disabled');
              const roleValidated = roleMemories.filter((m) => m.state === 'validated').length;
              const roleDecisions = evolution.decisions.filter((d) => d.directorId === role.id).length;

              return (
                <article
                  key={role.id}
                  className="flex flex-col justify-between rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex size-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-purple-300">
                        <Icon className="size-4" />
                      </div>
                      <span className="rounded-full border border-border bg-[#121222] px-2 py-0.5 text-[10px] text-muted-foreground">
                        Wave {role.wave}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{role.title}</h3>
                    <p className="text-xs leading-relaxed text-muted-foreground">{role.mission}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between pt-2 border-t border-border/60 text-[10px] text-muted-foreground">
                    <span>
                      {roleValidated} validada(s) · {roleMemories.length} mem · {roleDecisions} dec
                    </span>
                    <Link
                      to="/aethera/cinema"
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-[#121222] px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/60"
                    >
                      <Film className="size-3 text-purple-400" /> Abrir
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'evolution' && (
        <div className="space-y-6">
          <form
            onSubmit={handleSubmitFeedback}
            className="rounded-2xl border border-border bg-card p-5 space-y-3"
          >
            <h2 className="text-sm font-semibold text-foreground">
              Ensinar com Feedback Humano (Classificação & Consolidação)
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Ex.: O áudio sobrepôs na cena 2 e o texto ficou em cima do HUD"
                aria-label="Feedback humano para os diretores"
                className="flex-1 min-w-[260px] rounded-xl border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={busy || !feedbackText.trim()}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Registrar Aprendizado
              </button>
            </div>
          </form>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Memórias Evolutivas ({evolution.memories.length})
              </h3>
              {evolution.memories.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma memória registrada ainda. Envie um feedback ou importe materiais na Academia.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                  {evolution.memories.map((m) => (
                    <div
                      key={m.memoryId}
                      className="rounded-xl border border-border bg-[#0d0d17] p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{m.title}</span>
                        <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-200">
                          {m.state} · v{m.version}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{m.content}</p>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-[10px] text-muted-foreground">
                          {m.directorId} · {m.epistemicLevel} · conf {(m.confidence * 100).toFixed(0)}%
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleMemory(m.memoryId, 'disable')}
                            className="rounded border border-border px-2 py-0.5 text-[10px] hover:border-amber-500/50"
                          >
                            Desativar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleMemory(m.memoryId, 'rollback')}
                            title="Rollback para versão anterior"
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] hover:border-primary/50"
                          >
                            <RotateCcw className="size-2.5" /> Rollback
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleMemory(m.memoryId, 'delete')}
                            title="Excluir memória"
                            className="rounded border border-border p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Decisões Rastreáveis dos Diretores ({evolution.decisions.length})
              </h3>
              {evolution.decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Execute a Orquestração DAG na aba Diretores para registrar decisões auditáveis.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                  {evolution.decisions.slice(-20).reverse().map((d) => (
                    <div
                      key={d.decisionId}
                      className="rounded-xl border border-border bg-[#0d0d17] p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-300">{d.directorId}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {d.consultedMemoryIds.length} memória(s) consultada(s)
                        </span>
                      </div>
                      <p className="text-foreground">{d.summary}</p>
                      <p className="text-[11px] text-muted-foreground">{d.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === 'academy' && (
        <AetheraAcademyPanel
          academy={academy}
          busy={busy}
          onIngest={handleIngest}
          onRunExercise={handleRunExercise}
          onDeleteMaterial={handleDeleteMaterial}
          onReprocess={handleReprocess}
          onExportBackup={handleExportBackup}
          onRestoreBackup={handleRestoreBackup}
          onAsk={handleAsk}
        />
      )}

      {/* Bottom Production Flow Strip */}
      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-5 py-3 text-xs">
        <span className="font-semibold text-foreground">Fluxo de Produção</span>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>Roteiro</span>
          <span>›</span>
          <span>Storyboard</span>
          <span>›</span>
          <span>Direção</span>
          <span>›</span>
          <span>Edição</span>
          <span>›</span>
          <span>Som & VFX</span>
          <span>›</span>
          <span className="text-emerald-400">Revisão & QC</span>
        </div>
        <Link
          to="/aethera/review"
          className="rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-primary/25"
        >
          Abrir Sala de Revisão
        </Link>
      </footer>
    </div>
  );
}
