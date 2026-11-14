import type { SkillAgent } from './contracts.js';
import type { DiscoveredSkill } from './discovery.js';
import type { SkillPreference } from '../skills.js';
import type { GitInfo } from '@neuralbridge/shared';
import type { SkillUsageSignal } from './intelligence.js';

export interface SkillRecommendationIntelligence {
  git?: GitInfo;
  context?: { text: string; references: readonly string[] };
  usage?: readonly SkillUsageSignal[];
}

export interface RecommendationContext {
  taskDescription: string;
  projectId?: string;
  stack?: readonly string[];
  agent?: SkillAgent;
  taskType?: string;
  workflowStep?: string;
  preferences?: readonly SkillPreference[];
  explicitSkillIds?: readonly string[];
  limit?: number;
  intelligence?: SkillRecommendationIntelligence;
}

export interface SkillRecommendation {
  skillId: string;
  name: string;
  source: DiscoveredSkill['source'];
  scope: DiscoveredSkill['scope'];
  agents: SkillAgent[];
  reasons: string[];
  evidence: string[];
  relevance: number;
  relevanceKind: 'ordinal-rule-score';
  available: true;
  conflictWarnings: string[];
  requiresConfirmation: boolean;
}

export interface RecommendationExclusion {
  skillId: string;
  name: string;
  reasons: string[];
}

export interface RecommendationResult {
  recommendations: SkillRecommendation[];
  excluded: RecommendationExclusion[];
  metadata: { candidateCount: number; consideredCount: number; ruleVersion: string; externalCalls: 0; integrationSources: { git: boolean; memory: boolean; rag: boolean; analytics: boolean } };
  limitations: string[];
}

export interface SkillRecommendationEngine {
  recommend(context: RecommendationContext): Promise<RecommendationResult>;
}

interface Rule { skillTerms: string[]; contextTerms: string[]; label: string; weight: number; }

const RULE_VERSION = '41.3-deterministic-1';
const RULES: readonly Rule[] = [
  { skillTerms: ['remotion', 'motionvelix', 'video', 'animation', 'caption', 'subtitle', 'legenda'], contextTerms: ['remotion', 'velix', 'video', 'animation', 'caption', 'subtitle', 'legenda'], label: 'o contexto trata de vídeo, animação ou legendas', weight: 12 },
  { skillTerms: ['react', 'frontend', 'front-end', 'ui', 'ux', 'interface'], contextTerms: ['react', 'frontend', 'front-end', 'ui', 'ux', 'interface', 'tela', 'componente'], label: 'o contexto trata de React ou interface', weight: 12 },
  { skillTerms: ['playwright', 'webapp testing', 'testing', 'test'], contextTerms: ['playwright', 'e2e', 'teste', 'testes', 'testing'], label: 'o contexto trata de testes automatizados', weight: 12 },
  { skillTerms: ['git', 'guardrail', 'code review', 'bug detective'], contextTerms: ['git', 'commit', 'branch', 'merge', 'diff', 'bug', 'revisar código'], label: 'o contexto trata de Git ou revisão de código', weight: 12 },
  { skillTerms: ['mcp', 'model context protocol'], contextTerms: ['mcp', 'servidor mcp', 'model context protocol', 'integração'], label: 'o contexto trata de integração MCP', weight: 12 },
  { skillTerms: ['workflow', 'openspec', 'planning with files', 'superpowers'], contextTerms: ['workflow', 'planejar', 'especificação', 'spec', 'orquestração'], label: 'o contexto trata de planejamento ou workflows', weight: 10 },
  { skillTerms: ['security', 'secure', 'guard'], contextTerms: ['segurança', 'security', 'vulnerabilidade', 'permissão', 'injection'], label: 'o contexto trata de segurança', weight: 10 },
  { skillTerms: ['document', 'docs', 'docx', 'pdf'], contextTerms: ['documento', 'documentação', 'docx', 'pdf', 'relatório'], label: 'o contexto trata de documentos', weight: 10 },
  { skillTerms: ['refactor', 'refactoring', 'best practices', 'quality'], contextTerms: ['refatorar', 'refatoração', 'qualidade', 'boas práticas', 'melhorar código'], label: 'o contexto trata de refatoração ou qualidade', weight: 8 },
];

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
}

function tokens(value: string): string[] {
  return normalize(value).split(/[^a-z0-9+#.-]+/u).filter((item) => item.length > 1);
}

function skillText(skill: DiscoveredSkill): string { return normalize(`${skill.name} ${skill.description} ${skill.category ?? ''}`); }

function preferenceFor(skill: DiscoveredSkill, preferences: readonly SkillPreference[]): SkillPreference | undefined {
  return preferences.find((item) => item.skillId === skill.id || item.skillId === skill.name);
}

function evaluate(skill: DiscoveredSkill, context: RecommendationContext): { score: number; reasons: string[]; evidence: string[] } {
  const intelligence = context.intelligence;
  const contextText = normalize([
    context.taskDescription,
    ...(context.stack ?? []),
    context.taskType ?? '',
    context.workflowStep ?? '',
    ...(intelligence?.git?.changes.map((change) => `${change.path} ${change.status}`) ?? []),
    intelligence?.git?.lastCommit?.subject ?? '',
    intelligence?.context?.text ?? '',
  ].join(' '));
  const contextTokens = new Set(tokens(contextText));
  const text = skillText(skill);
  let score = 0;
  const reasons: string[] = [];
  const evidence: string[] = [];
  for (const rule of RULES) {
    const skillMatch = rule.skillTerms.some((term) => text.includes(normalize(term)));
    const contextMatch = rule.contextTerms.some((term) => contextText.includes(normalize(term)));
    if (skillMatch && contextMatch) { score += rule.weight; reasons.push(rule.label); evidence.push(`regra ${rule.label}: termo correspondente`); }
  }
  const overlap = tokens(`${skill.name} ${skill.description}`).filter((token) => contextTokens.has(token));
  if (overlap.length) { score += Math.min(8, overlap.length * 2); evidence.push(`termos compartilhados: ${[...new Set(overlap)].sort().join(', ')}`); }
  if (context.taskType && skill.name.toLocaleLowerCase().includes(normalize(context.taskType))) { score += 6; reasons.push(`o nome corresponde ao tipo de tarefa “${context.taskType}”`); evidence.push(`taskType=${context.taskType}`); }
  const preference = preferenceFor(skill, context.preferences ?? []);
  if (preference?.enabled && (!context.taskType || preference.taskTypes.includes(context.taskType))) { score += 5; reasons.push('preferência existente habilita esta skill para o contexto'); evidence.push('SkillPreference.enabled=true'); }
  if (intelligence?.git?.isRepo) evidence.push(`Git: branch ${intelligence.git.branch ?? 'detached'}; ${intelligence.git.changes.length} alteração(ões)`);
  if (intelligence?.context?.references.length) evidence.push(`Memória/RAG: ${intelligence.context.references.join(', ')}`);
  const usage = intelligence?.usage?.find((item) => item.skillId === skill.id || item.skillId === skill.name);
  if (usage && usage.used + usage.injected + usage.loaded > 0) { score += 3; reasons.push('há uso persistido desta skill em execuções anteriores'); evidence.push(`uso persistido: used=${usage.used}, injected=${usage.injected}`); }
  return { score, reasons, evidence };
}

export function createSkillRecommendationEngine(discover: () => Promise<{ skills: DiscoveredSkill[] }>): SkillRecommendationEngine {
  return {
    async recommend(context) {
      const inventory = (await discover()).skills;
      const recommendations: SkillRecommendation[] = [];
      const excluded: RecommendationExclusion[] = [];
      for (const skill of inventory) {
        const reasons: string[] = [];
        if (!skill.valid) reasons.push('manifesto inválido');
        if (!skill.installed) reasons.push('skill não instalada');
        if (context.agent && !skill.agents.includes(context.agent)) reasons.push(`incompatível com o agente ${context.agent}`);
        if (skill.scope === 'project' && skill.projectId !== (context.projectId ?? null)) reasons.push('instalação pertence a outro projeto');
        const preference = preferenceFor(skill, context.preferences ?? []);
        if (preference && !preference.enabled) reasons.push('desabilitada nas preferências existentes');
        if (context.explicitSkillIds?.length && !context.explicitSkillIds.includes(skill.id)) reasons.push('não foi selecionada explicitamente');
        if (reasons.length) { excluded.push({ skillId: skill.id, name: skill.name, reasons }); continue; }
        const evaluated = evaluate(skill, context);
        if (evaluated.score <= 0) { excluded.push({ skillId: skill.id, name: skill.name, reasons: ['nenhuma regra local encontrou evidência contextual'] }); continue; }
        const conflictWarnings = skill.conflict ? ['há instalações com o mesmo nome e conteúdo diferente; nenhuma precedência foi escolhida automaticamente'] : [];
        recommendations.push({ skillId: skill.id, name: skill.name, source: skill.source, scope: skill.scope, agents: skill.agents, reasons: evaluated.reasons, evidence: evaluated.evidence, relevance: evaluated.score, relevanceKind: 'ordinal-rule-score', available: true, conflictWarnings, requiresConfirmation: skill.conflict });
      }
      recommendations.sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name) || a.skillId.localeCompare(b.skillId));
      const source = context.intelligence;
      const hasContext = !!source?.context && (source.context.references.length > 0 || source.context.text.trim().length > 0);
      return { recommendations: recommendations.slice(0, Math.max(0, context.limit ?? recommendations.length)), excluded: excluded.sort((a, b) => a.name.localeCompare(b.name) || a.skillId.localeCompare(b.skillId)), metadata: { candidateCount: inventory.length, consideredCount: recommendations.length + excluded.length, ruleVersion: RULE_VERSION, externalCalls: 0, integrationSources: { git: source?.git?.isRepo === true, memory: hasContext, rag: hasContext, analytics: !!source?.usage } }, limitations: ['Pontuação é ordinal e determinística, não é probabilidade.', 'Categorias e versões ausentes não são inferidas.', 'Nenhuma skill é instalada, ativada ou executada pelo mecanismo.'] };
    },
  };
}
