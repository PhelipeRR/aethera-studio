import { and, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { memories, projects } from '@neuralbridge/database';
import type { SourceKind } from '@neuralbridge/shared';

/** Who can see and change which memories. See docs/plans/phase-3-brain-core.md. */
export type Scope =
  /** An MCP server started inside a project. */
  | { kind: 'project'; projectId: string; includeGlobal: boolean }
  /** An MCP server with no identified project. */
  | { kind: 'global' }
  /** The user in the app (includePrivate) or other cross-project views. */
  | { kind: 'all'; includePrivate: boolean };

export const GLOBAL_SCOPE: Scope = { kind: 'global' };
export const USER_SCOPE: Scope = { kind: 'all', includePrivate: true };

export function projectScope(projectId: string, includeGlobal = true): Scope {
  return { kind: 'project', projectId, includeGlobal };
}

/** Who is acting: recorded as the memory origin, the version author and in the access log. */
export interface Actor {
  kind: SourceKind;
  /** e.g. "electron" or "mcp:claude-code". */
  client: string;
}

const privateProjects = sql`(SELECT ${projects.id} FROM ${projects} WHERE ${projects.isPrivate} = 1)`;

/** Condition on `memories` for rows the scope may read (deleted rows excluded). */
export function visibleTo(scope: Scope): SQL {
  const live = isNull(memories.deletedAt);
  switch (scope.kind) {
    case 'project':
      return and(
        live,
        scope.includeGlobal ? or(eq(memories.projectId, scope.projectId), isNull(memories.projectId)) : eq(memories.projectId, scope.projectId),
      ) as SQL;
    case 'global':
      return and(live, isNull(memories.projectId)) as SQL;
    case 'all':
      return scope.includePrivate ? live : (and(live, or(isNull(memories.projectId), notInArray(memories.projectId, privateProjects))) as SQL);
  }
}

/**
 * Project a new memory goes to. `requested` undefined means "the caller's default", null means global.
 * Returns the project id (or null) or a reason it is not allowed.
 */
export function targetProject(requested: string | null | undefined, scope: Scope): { projectId: string | null } | { forbidden: string } {
  switch (scope.kind) {
    case 'project':
      if (requested === undefined || requested === scope.projectId) return { projectId: scope.projectId };
      if (requested === null) return scope.includeGlobal ? { projectId: null } : { forbidden: 'This caller cannot write global memories.' };
      return { forbidden: 'This caller can only write to its own project.' };
    case 'global':
      return requested ? { forbidden: 'This caller can only write global memories.' } : { projectId: null };
    case 'all':
      return { projectId: requested ?? null };
  }
}
