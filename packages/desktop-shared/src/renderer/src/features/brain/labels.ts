import type { Confidence, MemoryType, SourceKind, Trust } from '@neuralbridge/shared/domain';

export const TYPE_LABEL: Record<MemoryType, string> = {
  decision: 'Decisão',
  code_pattern: 'Padrão de código',
  project_context: 'Contexto de projeto',
  bug_fix: 'Bug resolvido',
  learning: 'Aprendizado',
  preference: 'Preferência',
  documentation: 'Documentação',
  execution_summary: 'Resumo de execução',
};

export const TRUST_LABEL: Record<Trust, string> = {
  unverified: 'Não revisada',
  reviewed: 'Revisada',
  rejected: 'Rejeitada',
};

/** How far a memory has been checked (Phase 20), apart from who wrote it (trust). */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  unverified: 'Não verificada',
  reviewed: 'Validada',
  stale: 'Desatualizada',
};

export const EVIDENCE_LABEL = { file: 'Arquivo', url: 'Link', task: 'Tarefa', conversation: 'Conversa' } as const;

export const SOURCE_LABEL: Record<SourceKind, string> = {
  user: 'Você',
  claude: 'Claude',
  codex: 'Codex',
  mcp: 'Cliente MCP',
  extractor: 'Extração automática',
};

export const MEMORY_TYPES = Object.keys(TYPE_LABEL) as MemoryType[];
export const TRUST_STATES = Object.keys(TRUST_LABEL) as Trust[];
