import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type DirectorId =
  | 'general_director'
  | 'narrative_director'
  | 'cinematography_director'
  | 'editing_director'
  | 'art_director'
  | 'sound_director'
  | 'music_director'
  | 'narration_director'
  | 'vfx_director'
  | 'motion_director'
  | 'color_director'
  | 'comedy_director'
  | 'continuity_director'
  | 'research_media_director'
  | 'quality_director';

export type MemoryKind = 'episodic' | 'semantic' | 'procedural' | 'collective' | 'contextual';
export type EpistemicLevel = 'extracted_knowledge' | 'hypothesis' | 'validated_rule';
export type LearningState = 'proposed' | 'evaluating' | 'validated' | 'rejected' | 'disabled';

export interface MemoryScope {
  userId?: string;
  channelId?: string;
  genre?: string;
  projectId?: string;
  directorId?: DirectorId;
}

export interface MemoryEvidence {
  sourceType: 'production' | 'human_feedback' | 'academy_material' | 'qc_probe' | 'exercise';
  sourceId: string;
  summary: string;
  metrics?: Record<string, number | string | boolean>;
  recordedAt: string;
}

export interface MemoryVersionSnapshot {
  version: number;
  content: string;
  state: LearningState;
  epistemicLevel: EpistemicLevel;
  confidence: number;
  updatedAt: string;
  reason: string;
}

export interface EvolutionMemoryRecord {
  memoryId: string;
  techniqueKey: string;
  directorId: DirectorId;
  kind: MemoryKind;
  epistemicLevel: EpistemicLevel;
  state: LearningState;
  title: string;
  content: string;
  tags: string[];
  scope: MemoryScope;
  confidence: number;
  version: number;
  evidence: MemoryEvidence[];
  previousVersions: MemoryVersionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export type FeedbackClassification =
  | 'explicit_preference'
  | 'proven_technical_defect'
  | 'subjective_evaluation'
  | 'unvalidated_hypothesis';

export interface AnalyzedHumanFeedback {
  feedbackId: string;
  rawText: string;
  classification: FeedbackClassification;
  targetDirector: DirectorId;
  sceneHint?: string;
  timestampMs?: number;
  causeHypothesis: string;
  proposedAction: string;
  applyImmediatelyToScope: boolean;
  requiresVerificationBeforeConsolidation: boolean;
}

export interface LearningVerificationInput {
  memoryId: string;
  beforeMetrics: Record<string, number | string | boolean>;
  afterMetrics: Record<string, number | string | boolean>;
  passedTests: boolean;
  humanApproved?: boolean;
  evidenceSummary: string;
}

export interface DirectorDecisionRecord {
  decisionId: string;
  projectId: string;
  directorId: DirectorId;
  action: string;
  rationale: string;
  consultedMemoryIds: string[];
  consultedAcademyIds: string[];
  outcome: 'applied' | 'blocked' | 'overridden' | 'failed';
  createdAt: string;
}

export interface EvolutionStoreSnapshot {
  schemaVersion: 1;
  memories: EvolutionMemoryRecord[];
  decisions: DirectorDecisionRecord[];
  feedbackLog: AnalyzedHumanFeedback[];
}

export interface ProductionDirectives {
  isDocumentary: boolean;
  suppressActCards: boolean;
  suppressAetheraSignature: boolean;
  discreteTypography: boolean;
  preferRealImages: boolean;
  elaborateMotionGraphics: boolean;
  appliedMemoryIds: string[];
  overriddenDirectives: string[];
}

function sanitizeUntrustedText(raw: string): string {
  // Prevent prompt-injection directives inside external text from becoming privileged instructions
  return raw
    .replace(/(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/gi, '[filtered-directive]')
    .replace(/<\/?(?:system|assistant|tool_call|prompt)>/gi, '')
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

export function classifyHumanFeedback(rawFeedback: string): AnalyzedHumanFeedback {
  const clean = sanitizeUntrustedText(rawFeedback);
  const lower = clean.toLowerCase();

  // Extract optional timestamp like "0:23" or "23s"
  let timestampMs: number | undefined;
  const mmss = clean.match(/\b(\d{1,2}):(\d{2})\b/);
  if (mmss) {
    timestampMs = (Number(mmss[1]) * 60 + Number(mmss[2])) * 1000;
  } else {
    const sec = clean.match(/\b(\d+(?:\.\d+)?)\s*s\b/i);
    if (sec) timestampMs = Math.round(Number(sec[1]) * 1000);
  }

  const sceneMatch = clean.match(/\bcena\s+(\d+|[\w-]+)\b/i);
  const sceneHint = sceneMatch ? sceneMatch[0] : undefined;

  let targetDirector: DirectorId = 'general_director';
  if (/narra[çc][aã]o|voz|sobrepost|áudio|audio|m[uú]sica|cobrindo|sfx|som|clipping|volume/i.test(lower)) {
    targetDirector = /m[uú]sica|trilha/i.test(lower) && !/cobrindo|narra/i.test(lower) ? 'music_director' : 'sound_director';
  } else if (/corte|r[aá]pido|lento|ritmo|transi[çc][aã]o|montagem|edi[çc][aã]o/i.test(lower)) {
    targetDirector = 'editing_director';
  } else if (/zoom|enquadramento|c[aâ]mera|fotografia|ilumina/i.test(lower)) {
    targetDirector = 'cinematography_director';
  } else if (/humor|piada|engra[çc]ado/i.test(lower)) {
    targetDirector = 'comedy_director';
  } else if (/cor|color|grading|satura/i.test(lower)) {
    targetDirector = 'color_director';
  } else if (/efeito|vfx|part[ií]cula|motion graphics/i.test(lower)) {
    targetDirector = 'vfx_director';
  } else if (/texto|t[ií]tulo|legenda|tipografia|safe|cards?|assinatura|fontes?/i.test(lower)) {
    targetDirector = 'motion_director';
  } else if (/imagens? reais|est[eé]tica|visual|identidade/i.test(lower)) {
    targetDirector = 'art_director';
  } else if (/roteiro|hist[oó]ria|narrativa/i.test(lower)) {
    targetDirector = 'narrative_director';
  }

  let classification: FeedbackClassification = 'unvalidated_hypothesis';
  let causeHypothesis = 'Ajuste sugerido pelo revisor humano para o contexto atual.';
  let proposedAction = 'Registrar hipótese e testar em revisão isolada antes de consolidar.';
  let applyImmediatelyToScope = false;
  let requiresVerificationBeforeConsolidation = true;

  if (/sobrepost|cortad|truncad|clipping|dessincron|cobrindo a voz|frame preto/i.test(lower)) {
    classification = 'proven_technical_defect';
    causeHypothesis = 'Conflito de janela temporal, ducking insuficiente ou ausência de medição pré-render.';
    proposedAction = 'Aplicar correção na timeline/mixagem, validar com Diretor de Som/QC e comparar Antes vs Depois.';
  } else if (/n[aã]o quero|n[aã]o coloque|sempre|prefiro|gostei desse estilo|ficou [oó]tima|mantenha/i.test(lower)) {
    classification = 'explicit_preference';
    causeHypothesis = 'Preferência editorial explícita do usuário para este projeto/estilo.';
    proposedAction = 'Aplicar imediatamente no escopo do projeto/canal sem generalizar para todos os gêneros sem confirmação.';
    applyImmediatelyToScope = true;
    requiresVerificationBeforeConsolidation = false;
  } else if (/r[aá]pido demais|exagerado|chato|cansativo|fraco/i.test(lower)) {
    classification = 'subjective_evaluation';
    causeHypothesis = 'Percepção subjetiva de ritmo/intensidade nesta produção específica.';
    proposedAction = 'Ajustar parâmetro nesta cena/projeto; não promover a regra universal automaticamente.';
    applyImmediatelyToScope = true;
    requiresVerificationBeforeConsolidation = true;
  }

  return {
    feedbackId: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    rawText: clean,
    classification,
    targetDirector,
    ...(sceneHint ? { sceneHint } : {}),
    ...(timestampMs !== undefined ? { timestampMs } : {}),
    causeHypothesis,
    proposedAction,
    applyImmediatelyToScope,
    requiresVerificationBeforeConsolidation,
  };
}

export class AetheraEvolutionCore {
  private readonly storePath: string | null;
  private snapshot: EvolutionStoreSnapshot;

  constructor(storePath?: string) {
    this.storePath = storePath ?? null;
    this.snapshot = this.load();
  }

  private load(): EvolutionStoreSnapshot {
    if (this.storePath && existsSync(this.storePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as EvolutionStoreSnapshot;
        if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.memories)) {
          return parsed;
        }
      } catch {
        // Fall through to clean store
      }
    }
    return { schemaVersion: 1, memories: [], decisions: [], feedbackLog: [] };
  }

  private persist(): void {
    if (!this.storePath) return;
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2), 'utf8');
    renameSync(tmp, this.storePath);
  }

  replaceSnapshot(next: EvolutionStoreSnapshot): EvolutionStoreSnapshot {
    if (!next || next.schemaVersion !== 1 || !Array.isArray(next.memories)) {
      throw new Error('Snapshot de evolução inválido para restauração.');
    }
    this.snapshot = {
      schemaVersion: 1,
      memories: [...next.memories],
      decisions: Array.isArray(next.decisions) ? [...next.decisions] : [],
      feedbackLog: Array.isArray(next.feedbackLog) ? [...next.feedbackLog] : [],
    };
    this.persist();
    return this.getSnapshot();
  }

  recordMemory(input: {
    techniqueKey: string;
    directorId: DirectorId;
    kind: MemoryKind;
    epistemicLevel: EpistemicLevel;
    state: LearningState;
    title: string;
    content: string;
    tags?: string[];
    scope?: MemoryScope;
    confidence?: number;
    evidence: MemoryEvidence;
    reasonForUpdate?: string;
  }): EvolutionMemoryRecord {
    const now = new Date().toISOString();
    const safeTitle = sanitizeUntrustedText(input.title);
    const safeContent = sanitizeUntrustedText(input.content);
    const existing = this.snapshot.memories.find(
      (m) =>
        m.techniqueKey === input.techniqueKey &&
        m.directorId === input.directorId &&
        m.scope.projectId === input.scope?.projectId &&
        m.scope.genre === input.scope?.genre,
    );

    if (existing) {
      existing.previousVersions.push({
        version: existing.version,
        content: existing.content,
        state: existing.state,
        epistemicLevel: existing.epistemicLevel,
        confidence: existing.confidence,
        updatedAt: existing.updatedAt,
        reason: input.reasonForUpdate ?? 'Atualização versionada',
      });
      existing.version += 1;
      existing.content = safeContent;
      existing.title = safeTitle;
      existing.state = input.state;
      existing.epistemicLevel = input.epistemicLevel;
      existing.confidence = Math.max(0, Math.min(1, input.confidence ?? existing.confidence));
      existing.tags = Array.from(new Set([...existing.tags, ...(input.tags ?? [])]));
      existing.evidence.push(input.evidence);
      existing.updatedAt = now;
      this.persist();
      return existing;
    }

    const created: EvolutionMemoryRecord = {
      memoryId: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      techniqueKey: input.techniqueKey,
      directorId: input.directorId,
      kind: input.kind,
      epistemicLevel: input.epistemicLevel,
      state: input.state,
      title: safeTitle,
      content: safeContent,
      tags: input.tags ?? [],
      scope: input.scope ?? {},
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.65)),
      version: 1,
      evidence: [input.evidence],
      previousVersions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.snapshot.memories.push(created);
    this.persist();
    return created;
  }

  ingestHumanFeedback(rawFeedback: string, scope: MemoryScope): {
    analysis: AnalyzedHumanFeedback;
    memory: EvolutionMemoryRecord;
  } {
    const analysis = classifyHumanFeedback(rawFeedback);
    this.snapshot.feedbackLog.push(analysis);

    const state: LearningState = analysis.applyImmediatelyToScope
      ? analysis.classification === 'explicit_preference'
        ? 'validated'
        : 'evaluating'
      : 'proposed';
    const epistemicLevel: EpistemicLevel =
      analysis.classification === 'explicit_preference' ? 'validated_rule' : 'hypothesis';

    const memory = this.recordMemory({
      techniqueKey: `fb_${analysis.targetDirector}_${tokenize(analysis.rawText).slice(0, 4).join('_')}`,
      directorId: analysis.targetDirector,
      kind: analysis.classification === 'explicit_preference' ? 'contextual' : 'episodic',
      epistemicLevel,
      state,
      title: `Feedback (${analysis.classification}): ${analysis.rawText.slice(0, 60)}`,
      content: `${analysis.causeHypothesis} Ação: ${analysis.proposedAction}`,
      tags: [analysis.classification, analysis.targetDirector, ...(scope.genre ? [scope.genre] : [])],
      scope:
        analysis.classification === 'subjective_evaluation' && scope.projectId
          ? { projectId: scope.projectId, directorId: analysis.targetDirector }
          : { ...scope, directorId: analysis.targetDirector },
      confidence: analysis.classification === 'explicit_preference' ? 0.9 : 0.55,
      evidence: {
        sourceType: 'human_feedback',
        sourceId: analysis.feedbackId,
        summary: analysis.rawText,
        recordedAt: new Date().toISOString(),
      },
    });

    this.persist();
    return { analysis, memory };
  }

  consolidateLearning(input: LearningVerificationInput): EvolutionMemoryRecord {
    const mem = this.snapshot.memories.find((m) => m.memoryId === input.memoryId);
    if (!mem) throw new Error(`Memória não encontrada: ${input.memoryId}`);

    const approved = input.passedTests && (input.humanApproved ?? true);
    mem.previousVersions.push({
      version: mem.version,
      content: mem.content,
      state: mem.state,
      epistemicLevel: mem.epistemicLevel,
      confidence: mem.confidence,
      updatedAt: mem.updatedAt,
      reason: approved ? 'Consolidado após verificação Antes/Depois' : 'Rejeitado na verificação',
    });
    mem.version += 1;
    mem.state = approved ? 'validated' : 'rejected';
    mem.epistemicLevel = approved ? 'validated_rule' : 'hypothesis';
    mem.confidence = approved ? Math.min(0.98, mem.confidence + 0.25) : Math.max(0.1, mem.confidence - 0.3);
    mem.evidence.push({
      sourceType: 'qc_probe',
      sourceId: `verify_${Date.now()}`,
      summary: input.evidenceSummary,
      metrics: {
        passedTests: input.passedTests,
        before: JSON.stringify(input.beforeMetrics),
        after: JSON.stringify(input.afterMetrics),
      },
      recordedAt: new Date().toISOString(),
    });
    mem.updatedAt = new Date().toISOString();
    this.persist();
    return mem;
  }

  disableMemory(memoryId: string, reason = 'Desativada pelo usuário'): EvolutionMemoryRecord {
    const mem = this.snapshot.memories.find((m) => m.memoryId === memoryId);
    if (!mem) throw new Error(`Memória não encontrada: ${memoryId}`);
    mem.previousVersions.push({
      version: mem.version,
      content: mem.content,
      state: mem.state,
      epistemicLevel: mem.epistemicLevel,
      confidence: mem.confidence,
      updatedAt: mem.updatedAt,
      reason,
    });
    mem.version += 1;
    mem.state = 'disabled';
    mem.updatedAt = new Date().toISOString();
    this.persist();
    return mem;
  }

  rollbackMemory(memoryId: string): EvolutionMemoryRecord {
    const mem = this.snapshot.memories.find((m) => m.memoryId === memoryId);
    if (!mem) throw new Error(`Memória não encontrada: ${memoryId}`);
    const prev = mem.previousVersions.pop();
    if (!prev) throw new Error(`Sem versão anterior para rollback em ${memoryId}`);
    mem.version = prev.version;
    mem.content = prev.content;
    mem.state = prev.state;
    mem.epistemicLevel = prev.epistemicLevel;
    mem.confidence = prev.confidence;
    mem.updatedAt = new Date().toISOString();
    this.persist();
    return mem;
  }

  deleteMemory(memoryId: string): boolean {
    const before = this.snapshot.memories.length;
    this.snapshot.memories = this.snapshot.memories.filter((m) => m.memoryId !== memoryId);
    if (this.snapshot.memories.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  retrieveRelevantMemories(query: {
    text: string;
    directorId?: DirectorId;
    genre?: string;
    projectId?: string;
    limit?: number;
    includeCollective?: boolean;
  }): EvolutionMemoryRecord[] {
    const qTokens = new Set(tokenize(query.text));
    const includeCollective = query.includeCollective ?? true;
    const candidates = this.snapshot.memories.filter((m) => {
      if (m.state === 'disabled' || m.state === 'rejected') return false;
      if (query.directorId && m.directorId !== query.directorId && !(includeCollective && m.kind === 'collective')) {
        return false;
      }
      if (m.scope.projectId && query.projectId && m.scope.projectId !== query.projectId) {
        return false;
      }
      return true;
    });

    const scored = candidates.map((m) => {
      const mTokens = tokenize(`${m.title} ${m.content} ${m.tags.join(' ')}`);
      let hits = 0;
      for (const t of mTokens) {
        if (qTokens.has(t)) hits += 1;
      }
      const stateBonus = m.state === 'validated' ? 2.5 : m.state === 'evaluating' ? 1.0 : 0.4;
      const scopeBonus =
        (query.genre && m.scope.genre === query.genre ? 1.5 : 0) +
        (query.projectId && m.scope.projectId === query.projectId ? 2.0 : 0);
      const score = hits * 1.2 + stateBonus + scopeBonus + m.confidence;
      return { m, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 8)
      .map((s) => s.m);
  }

  recordDecision(decision: Omit<DirectorDecisionRecord, 'decisionId' | 'createdAt'>): DirectorDecisionRecord {
    const entry: DirectorDecisionRecord = {
      ...decision,
      decisionId: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.decisions.push(entry);
    this.persist();
    return entry;
  }

  getSnapshot(): EvolutionStoreSnapshot {
    return structuredClone(this.snapshot);
  }

  /**
   * Resolves active learned preferences into concrete production directives
   * for a given prompt/genre, honoring explicit prompt-level exceptions.
   */
  resolveProductionDirectives(input: {
    prompt: string;
    genre?: string;
    projectId?: string;
  }): ProductionDirectives {
    const promptLower = input.prompt.toLowerCase();
    const genreLower = (input.genre ?? '').toLowerCase();
    const isDocumentary = /document[aá]rio|documentary/i.test(`${promptLower} ${genreLower}`);

    const directives: ProductionDirectives = {
      isDocumentary,
      suppressActCards: false,
      suppressAetheraSignature: false,
      discreteTypography: false,
      preferRealImages: false,
      elaborateMotionGraphics: false,
      appliedMemoryIds: [],
      overriddenDirectives: [],
    };

    const activeMemories = this.snapshot.memories.filter(
      (m) => m.state === 'validated' || (m.epistemicLevel === 'validated_rule' && m.state !== 'disabled' && m.state !== 'rejected'),
    );

    for (const mem of activeMemories) {
      if (mem.scope.projectId && input.projectId && mem.scope.projectId !== input.projectId) {
        continue;
      }
      const text = `${mem.title} ${mem.content} ${mem.evidence.map((e) => e.summary).join(' ')}`.toLowerCase();
      let matched = false;

      if (/n[aã]o\s+(?:quero|coloque).*cards?.*(?:ato|act)/i.test(text) || /sem\s+cards?.*ato/i.test(text)) {
        directives.suppressActCards = true;
        matched = true;
      }
      if (/n[aã]o\s+(?:quero|coloque).*assinatura.*aethera/i.test(text) || /sem\s+assinatura.*aethera/i.test(text)) {
        directives.suppressAetheraSignature = true;
        matched = true;
      }
      if (isDocumentary && /fontes?\s+discretas?|tipografia\s+discreta/i.test(text)) {
        directives.discreteTypography = true;
        matched = true;
      }
      if (isDocumentary && /imagens?\s+reais/i.test(text)) {
        directives.preferRealImages = true;
        matched = true;
      }
      if (!isDocumentary && /motion\s+graphics.*elaborados?/i.test(text)) {
        directives.elaborateMotionGraphics = true;
        matched = true;
      }

      if (matched) {
        directives.appliedMemoryIds.push(mem.memoryId);
      }
    }

    // Explicit per-production overrides take precedence without erasing stored general preferences
    if (/(?:incluir|usar|com)\s+cards?\s+(?:de\s+)?ato/i.test(promptLower)) {
      if (directives.suppressActCards) directives.overriddenDirectives.push('suppressActCards');
      directives.suppressActCards = false;
    }
    if (/(?:incluir|usar|com)\s+assinatura\s+(?:do\s+)?aethera/i.test(promptLower)) {
      if (directives.suppressAetheraSignature) directives.overriddenDirectives.push('suppressAetheraSignature');
      directives.suppressAetheraSignature = false;
    }
    if (/motion\s+graphics\s+elaborados?|fontes?\s+grandes?/i.test(promptLower)) {
      if (directives.discreteTypography) directives.overriddenDirectives.push('discreteTypography');
      directives.discreteTypography = false;
      directives.elaborateMotionGraphics = true;
    }

    return directives;
  }
}
