import type { AgentId, PreferredAgent, RunMode } from '@neuralbridge/shared';
import { normalise, wordCount } from './text.js';

export type TaskType = 'trivial' | 'question' | 'planning' | 'architecture' | 'implementation' | 'refactor' | 'tests' | 'ui' | 'complex';

// Keyword rules (accent-free, PT and EN). Deterministic on purpose: deciding which agent to call
// must not itself spend tokens (spec section 4).
const SIGNALS: [TaskType, RegExp][] = [
  ['planning', /\b(planej\w*|plano|plan|roadmap|estrategi\w*|strategy|etapas)\b/],
  ['architecture', /\b(arquitetur\w*|architect\w*|modelagem|desenh\w*)\b/],
  ['question', /\b(expliqu\w*|explain|o que e|what is|como funciona|how does|por que|why|analis\w*|analy[sz]\w*|investig\w*|identifiqu\w*|identify|entend\w*|understand|descrev\w*|describe|audit\w*|revis\w*|review)\b/],
  ['implementation', /\b(implement\w*|crie|criar|create|adicion\w*|add|construa|build|corrij\w*|corrig\w*|fix|consert\w*|arrum\w*|ajeit\w*|resolva\w*|resolver|melhor\w*|improve|otimiz\w*|optimi[sz]\w*|ajust\w*|alter\w*|change|atualiz\w*|update|escreva o codigo|write the code)\b/],
  ['refactor', /\b(refator\w*|refactor\w*|renomei\w*|rename|extrai\w*|extract\w*|reorganiz\w*|simplifi\w*|simplify|limpe)\b/],
  ['tests', /\b(testes?|tests?|cobertura|coverage|specs?|tdd)\b/],
  ['ui', /\b(ui|ux|interface|telas?|layout|css|tailwind|responsiv\w*|acessibilidade|accessibility|frontend|front-end)\b/],
];
const TRIVIAL = /\b(typo|erro de digitacao|ortografia|spelling|comentario|comment|formatacao|formatting|lint|bump|versao do pacote)\b/;
const READS: TaskType[] = ['question', 'planning', 'architecture'];
/** Starts like a question ("o que…", "qual…", "e quando…", "why…"), with or without the question mark. */
const ASKS = /^\s*(e\s+)?(o que|qual|quais|quem|onde|quando|como|por que|porque|what|which|who|where|when|why|how|is|are|does|do)\b/;
const WRITES: TaskType[] = ['implementation', 'refactor', 'tests'];

export function classify(prompt: string): { type: TaskType; signals: TaskType[] } {
  const text = normalise(prompt);
  const signals = SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
  const has = (type: TaskType) => signals.includes(type);
  const words = wordCount(prompt);
  const listItems = prompt.split('\n').filter((line) => /^\s*([-*]|\d+[.)])\s+/.test(line)).length;

  let type: TaskType;
  if ((READS.some(has) && WRITES.some(has)) || words > 80 || listItems >= 3) type = 'complex';
  // Asking about something (a screen, an image, a behaviour) reads, as long as nothing is to be made or changed.
  else if (!WRITES.some(has) && !has('planning') && !has('architecture') && !TRIVIAL.test(text) && (has('question') || ASKS.test(text) || /\?\s*$/.test(prompt))) type = 'question';
  else if (words <= 10 && (TRIVIAL.test(text) || signals.length === 0)) type = 'trivial';
  else if (has('ui')) type = 'ui';
  else if (has('planning')) type = 'planning';
  else if (has('architecture')) type = 'architecture';
  else if (has('refactor')) type = 'refactor';
  else if (has('implementation')) type = 'implementation';
  else if (has('tests')) type = 'tests';
  else type = 'question';
  return { type, signals };
}

export interface RouteContext {
  mode: RunMode;
  available: Record<AgentId, boolean>;
  preferredAgent: PreferredAgent;
  /** Past results per agent; only used once both have at least five runs. */
  successRates?: Partial<Record<AgentId, { runs: number; succeeded: number }>>;
  skillPreferences?: readonly { skillId: string; taskTypes: string[]; agents: AgentId[]; enabled: boolean }[];
  explicitSkillIds?: readonly string[];
}

export interface RouteDecision {
  mode: 'claude' | 'codex' | 'collab';
  taskType: TaskType;
  /** false: the agent only reads (analysis, planning, architecture). */
  edit: boolean;
  /** Plain-language explanation shown to the user. */
  reasons: string[];
  skillIds?: string[];
}

export class RoutingError extends Error {
  override name = 'RoutingError';
}

const LABEL: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex CLI' };

const WHY: Record<TaskType, string> = {
  trivial: 'Tarefa simples: um agente basta, sem delegação.',
  question: 'Pedido de análise ou explicação: Claude analisa sem alterar arquivos.',
  planning: 'Pedido de planejamento: Claude planeja sem alterar arquivos.',
  architecture: 'Pedido de arquitetura: Claude analisa e propõe sem alterar arquivos.',
  implementation: 'Implementação delimitada: Codex executa.',
  refactor: 'Refatoração: Codex executa.',
  tests: 'Pedido de testes: Codex escreve e executa.',
  ui: 'Interface e experiência: Claude conduz.',
  complex: 'Pedido com análise e execução: Claude planeja e revisa, Codex implementa.',
};

const BASE: Record<Exclude<TaskType, 'trivial'>, RouteDecision['mode']> = {
  question: 'claude',
  planning: 'claude',
  architecture: 'claude',
  ui: 'claude',
  implementation: 'codex',
  refactor: 'codex',
  tests: 'codex',
  complex: 'collab',
};

function trackRecordPick(rates: RouteContext['successRates']): AgentId | null {
  const claude = rates?.claude;
  const codex = rates?.codex;
  if (!claude || !codex || claude.runs < 5 || codex.runs < 5) return null;
  const rate = (entry: { runs: number; succeeded: number }) => entry.succeeded / entry.runs;
  if (rate(claude) === rate(codex)) return null;
  return rate(codex) > rate(claude) ? 'codex' : 'claude';
}

/** Chooses who runs a task. Manual choice wins; unavailable agents are replaced, with the reason. */
export function route(prompt: string, context: RouteContext): RouteDecision {
  const { type } = classify(prompt);
  const edit = !(['question', 'planning', 'architecture'] as TaskType[]).includes(type) || context.mode === 'collab';
  const reasons: string[] = [];

  let wanted: RouteDecision['mode'];
  if (context.mode !== 'auto') {
    wanted = context.mode;
    reasons.push(context.mode === 'collab' ? 'Modo colaborativo escolhido por você.' : `${LABEL[context.mode]} escolhido por você.`);
  } else if (type === 'trivial') {
    const byRecord = trackRecordPick(context.successRates);
    wanted = context.preferredAgent !== 'auto' ? context.preferredAgent : (byRecord ?? 'claude');
    reasons.push(WHY.trivial);
    if (context.preferredAgent !== 'auto') reasons.push(`${LABEL[wanted]} é o agente preferido deste projeto.`);
    else if (byRecord) reasons.push(`${LABEL[byRecord]} tem o melhor histórico de sucesso.`);
  } else {
    wanted = BASE[type];
    reasons.push(WHY[type]);
  }

  const available = (agent: AgentId) => context.available[agent];
  if (!available('claude') && !available('codex')) throw new RoutingError('Nenhum agente disponível: verifique Claude Code e Codex na página Agentes.');

  const selected = (agent: AgentId) => context.skillPreferences?.filter((item) => item.enabled && item.agents.includes(agent) && (context.explicitSkillIds?.length ? context.explicitSkillIds.includes(item.skillId) : item.taskTypes.includes(type))).map((item) => item.skillId);
  const skillFields = (ids: string[] | undefined): Pick<RouteDecision, 'skillIds'> | Record<string, never> => ids?.length ? { skillIds: ids } : {};
  if (wanted === 'collab') {
    if (available('claude') && available('codex')) return { mode: 'collab', taskType: type, edit: true, reasons, ...skillFields([...new Set([...(selected('claude') ?? []), ...(selected('codex') ?? [])])]) };
    const single: AgentId = available('claude') ? 'claude' : 'codex';
    reasons.push(`${LABEL[single === 'claude' ? 'codex' : 'claude']} indisponível: ${LABEL[single]} faz a tarefa sozinho.`);
    return { mode: single, taskType: type, edit: true, reasons, ...skillFields(selected(single)) };
  }
  if (!available(wanted)) {
    const other: AgentId = wanted === 'claude' ? 'codex' : 'claude';
    reasons.push(`${LABEL[wanted]} indisponível: usando ${LABEL[other]}.`);
    return { mode: other, taskType: type, edit, reasons, ...skillFields(selected(other)) };
  }
  return { mode: wanted, taskType: type, edit, reasons, ...skillFields(selected(wanted)) };
}
