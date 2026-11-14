import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { learningCandidates, memories, projects, type DatabaseHandle } from '@neuralbridge/database';
import { LIMITS, MEMORY_TYPES, type AgentId, type LearningCandidate, type LearningStatus, type MemoryType } from '@neuralbridge/shared';
import { parseSearchFilter, STOPWORDS, type BrainService } from './brain-service.js';
import { BrainError } from './errors.js';
import { newId } from './ids.js';
import { GLOBAL_SCOPE, projectScope, USER_SCOPE, type Actor } from './scope.js';
import { findSecrets, maskSecrets } from './secrets.js';
import { readBrainSettings } from './settings.js';

/** Proposals per task: enough for the few things worth keeping, never a transcript. */
export const MAX_PROPOSALS = 5;
/** Share of distinct words two texts must have in common to count as the same knowledge. */
const DUPLICATE_SIMILARITY = 0.5;
const MIN_SHARED_WORDS = 4;

const EXTRACTOR: Actor = { kind: 'extractor', client: 'neuralbridge' };

export interface ProposalContext {
  taskId: string | null;
  projectId: string | null;
  agent: AgentId | null;
}

export interface ProposalOutcome {
  candidateId: string;
  status: LearningStatus;
  memoryId: string | null;
}

export interface CandidateEdits {
  title?: string | undefined;
  content?: string | undefined;
  type?: MemoryType | undefined;
  tags?: string[] | undefined;
}

interface Clean {
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Accepts whatever the agent sent and keeps only a well-formed proposal, or nothing. */
function clean(proposal: unknown): Clean | null {
  if (typeof proposal !== 'object' || proposal === null) return null;
  const record = proposal as Record<string, unknown>;
  const title = str(record['title']).replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.titleLength);
  const content = str(record['content']).trim().slice(0, LIMITS.contentLength);
  if (!title || !content) return null;
  const type = MEMORY_TYPES.includes(record['type'] as MemoryType) ? (record['type'] as MemoryType) : 'learning';
  const tags = Array.isArray(record['tags'])
    ? [...new Set(record['tags'].map(str).map((tag) => tag.trim().toLowerCase().slice(0, LIMITS.tagLength)).filter(Boolean))].slice(0, LIMITS.tags)
    : [];
  return { title, content, type, tags };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !STOPWORDS.has(word)),
  );
}

function similarity(a: Set<string>, b: Set<string>): { shared: number; jaccard: number } {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return { shared, jaccard: union ? shared / union : 0 };
}

/**
 * Turns what agents propose to remember into memories under the user's rules (decision A9):
 * cleaning and classification, secret blocking, duplicate detection with a suggested merge, and the
 * review queue according to the learning mode in Brain Settings.
 */
export class LearningService {
  private readonly db: DatabaseHandle['db'];

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly brain: BrainService,
    private readonly options: { onStored?: (memoryId: string) => void } = {},
  ) {
    this.db = handle.db;
  }

  propose(proposals: unknown[], context: ProposalContext): ProposalOutcome[] {
    const settings = readBrainSettings(this.handle).learning;
    if (settings.mode === 'manual') return [];
    const outcomes: ProposalOutcome[] = [];
    for (const raw of proposals) {
      if (outcomes.length >= MAX_PROPOSALS) break;
      const proposal = clean(raw);
      if (!proposal || this.alreadyQueued(proposal, context.projectId)) continue;
      const base = { id: newId(), taskId: context.taskId, projectId: context.projectId, agent: context.agent, tags: JSON.stringify(proposal.tags), type: proposal.type };

      const secrets = findSecrets(`${proposal.title}\n${proposal.content}`);
      if (secrets.length) {
        const kinds = [...new Set(secrets.map((secret) => secret.kind))].join(', ');
        this.db
          .insert(learningCandidates)
          .values({
            ...base,
            title: maskSecrets(proposal.title),
            content: maskSecrets(proposal.content),
            status: 'blocked',
            reason: `Contém o que parece ser uma credencial (${kinds}); não foi salvo. Registre a informação sem o valor secreto, se for útil.`,
            decidedAt: this.now(),
          })
          .run();
        outcomes.push({ candidateId: base.id, status: 'blocked', memoryId: null });
        continue;
      }

      const duplicate = this.findDuplicate(proposal, context.projectId);
      if (!duplicate && settings.mode === 'categories' && settings.categories.includes(proposal.type)) {
        this.db.insert(learningCandidates).values({ ...base, title: proposal.title, content: proposal.content, status: 'pending' }).run();
        const memoryId = this.storeNew(base.id, proposal, context.projectId, context.taskId);
        this.db.update(learningCandidates).set({ reason: 'Categoria autorizada: salvo automaticamente.' }).where(eq(learningCandidates.id, base.id)).run();
        outcomes.push({ candidateId: base.id, status: 'approved', memoryId });
        continue;
      }
      this.db
        .insert(learningCandidates)
        .values({
          ...base,
          title: proposal.title,
          content: proposal.content,
          status: 'pending',
          mergeTargetId: duplicate?.id ?? null,
          reason: duplicate ? `Parecido com “${duplicate.title}”: aprovar junta as duas memórias.` : 'Aguardando sua revisão.',
        })
        .run();
      outcomes.push({ candidateId: base.id, status: 'pending', memoryId: null });
    }
    return outcomes;
  }

  list(status?: LearningStatus, limit = 200): LearningCandidate[] {
    return this.db
      .select({ candidate: learningCandidates, projectName: projects.name, targetTitle: memories.title, targetDeleted: memories.deletedAt })
      .from(learningCandidates)
      .leftJoin(projects, eq(projects.id, learningCandidates.projectId))
      .leftJoin(memories, eq(memories.id, learningCandidates.mergeTargetId))
      .where(status ? eq(learningCandidates.status, status) : undefined)
      .orderBy(desc(learningCandidates.createdAt), desc(learningCandidates.id))
      .limit(limit)
      .all()
      .map(({ candidate, projectName, targetTitle, targetDeleted }) => ({
        id: candidate.id,
        taskId: candidate.taskId,
        projectId: candidate.projectId,
        projectName,
        agent: candidate.agent,
        title: candidate.title,
        content: candidate.content,
        type: candidate.type,
        tags: JSON.parse(candidate.tags) as string[],
        status: candidate.status,
        reason: candidate.reason,
        mergeTarget: candidate.mergeTargetId && targetTitle && !targetDeleted ? { id: candidate.mergeTargetId, title: targetTitle } : null,
        memoryId: candidate.memoryId,
        createdAt: candidate.createdAt,
        decidedAt: candidate.decidedAt,
      }));
  }

  pendingCount(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(learningCandidates).where(eq(learningCandidates.status, 'pending')).get()?.n ?? 0;
  }

  /** Stores the proposal (merging into its look-alike when there is one) with the user's edits. */
  approve(id: string, edits: CandidateEdits = {}): { memoryId: string } {
    const candidate = this.requirePending(id);
    const proposal = clean({
      title: edits.title ?? candidate.title,
      content: edits.content ?? candidate.content,
      type: edits.type ?? candidate.type,
      tags: edits.tags ?? (JSON.parse(candidate.tags) as string[]),
    });
    if (!proposal) throw new BrainError('invalid', 'Título e conteúdo são obrigatórios.');
    if (findSecrets(`${proposal.title}\n${proposal.content}`).length) {
      throw new BrainError('invalid', 'O texto contém o que parece ser uma credencial (segredo); remova antes de aprovar.');
    }
    const target = (candidate.mergeTargetId && this.live(candidate.mergeTargetId)) || this.sameTitle(proposal.title, candidate.projectId);
    const memoryId = target ? this.merge(target, proposal, candidate.taskId) : this.storeNew(id, proposal, candidate.projectId, candidate.taskId);
    this.db.update(learningCandidates).set({ status: 'approved', memoryId, decidedAt: this.now() }).where(eq(learningCandidates.id, id)).run();
    return { memoryId };
  }

  reject(id: string): void {
    this.requirePending(id);
    this.db.update(learningCandidates).set({ status: 'rejected', decidedAt: this.now() }).where(eq(learningCandidates.id, id)).run();
  }

  // --- internals -------------------------------------------------------------------------------

  private requirePending(id: string): typeof learningCandidates.$inferSelect {
    const candidate = this.db.select().from(learningCandidates).where(eq(learningCandidates.id, id)).get();
    if (!candidate) throw new BrainError('not_found', 'Proposta não encontrada.');
    if (candidate.status === 'blocked') throw new BrainError('invalid', 'Esta proposta foi bloqueada por conter uma credencial (segredo) e não pode ser salva.');
    if (candidate.status !== 'pending') throw new BrainError('conflict', 'Esta proposta já foi decidida (already decided).');
    return candidate;
  }

  private storeNew(candidateId: string, proposal: Clean, projectId: string | null, taskId: string | null): string {
    const { memory } = this.brain.store(
      { ...proposal, projectId, ...(taskId ? { sourceRef: `task:${taskId}` } : {}) },
      USER_SCOPE,
      EXTRACTOR,
    );
    // Approving is the human review of the content (Phase 20); trust still says an agent wrote it.
    this.brain.setConfidence(memory.id, 'reviewed');
    this.db.update(learningCandidates).set({ status: 'approved', memoryId: memory.id, decidedAt: this.now() }).where(eq(learningCandidates.id, candidateId)).run();
    this.options.onStored?.(memory.id);
    return memory.id;
  }

  private merge(target: typeof memories.$inferSelect, proposal: Clean, taskId: string | null): string {
    const current = this.brain.recall(target.id, USER_SCOPE, EXTRACTOR);
    if (!current) throw new BrainError('not_found', 'A memória a ser complementada não existe mais.');
    const { memory } = this.brain.store(
      {
        id: current.id,
        title: current.title,
        content: current.content.includes(proposal.content) ? current.content : `${current.content.trimEnd()}\n\n${proposal.content}`,
        type: current.type,
        tags: [...new Set([...current.tags, ...proposal.tags])].slice(0, LIMITS.tags),
        links: current.outgoing.filter((link) => link.origin === 'explicit').map((link) => ({ target: link.title, relation: link.relation })),
        ...(taskId ? { sourceRef: `task:${taskId}` } : {}),
      },
      USER_SCOPE,
      EXTRACTOR,
    );
    this.options.onStored?.(memory.id);
    return memory.id;
  }

  private live(id: string): typeof memories.$inferSelect | undefined {
    return this.db.select().from(memories).where(and(eq(memories.id, id), isNull(memories.deletedAt))).get();
  }

  private inScope(projectId: string | null) {
    return and(isNull(memories.deletedAt), projectId ? or(eq(memories.projectId, projectId), isNull(memories.projectId)) : isNull(memories.projectId));
  }

  private sameTitle(title: string, projectId: string | null): typeof memories.$inferSelect | undefined {
    return this.db
      .select()
      .from(memories)
      .where(and(this.inScope(projectId), eq(sql`lower(${memories.title})`, title.toLowerCase())))
      .orderBy(sql`${memories.projectId} IS NULL`)
      .get();
  }

  /** Same title, or most of the same words as a memory the full-text search finds first. */
  private findDuplicate(proposal: Clean, projectId: string | null): { id: string; title: string } | null {
    const exact = this.sameTitle(proposal.title, projectId);
    if (exact) return exact;
    const scope = projectId ? projectScope(projectId) : GLOBAL_SCOPE;
    const ids = this.brain.textCandidates(`${proposal.title} ${proposal.content}`, parseSearchFilter({}), scope, 5).map((hit) => hit.id);
    if (!ids.length) return null;
    const mine = words(`${proposal.title} ${proposal.content}`);
    let best: { id: string; title: string; score: number } | null = null;
    for (const row of this.db.select({ id: memories.id, title: memories.title, content: memories.content }).from(memories).where(inArray(memories.id, ids)).all()) {
      const { shared, jaccard } = similarity(mine, words(`${row.title} ${row.content}`));
      if (shared >= MIN_SHARED_WORDS && jaccard >= DUPLICATE_SIMILARITY && (!best || jaccard > best.score)) best = { id: row.id, title: row.title, score: jaccard };
    }
    return best;
  }

  private alreadyQueued(proposal: Clean, projectId: string | null): boolean {
    return Boolean(
      this.db
        .select({ id: learningCandidates.id })
        .from(learningCandidates)
        .where(
          and(
            eq(learningCandidates.status, 'pending'),
            projectId ? eq(learningCandidates.projectId, projectId) : isNull(learningCandidates.projectId),
            eq(sql`lower(${learningCandidates.title})`, proposal.title.toLowerCase()),
            eq(learningCandidates.content, proposal.content),
          ),
        )
        .get(),
    );
  }

  private now(): string {
    return new Date().toISOString();
  }
}
