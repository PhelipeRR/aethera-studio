import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentAdapter } from '@neuralbridge/agents';
import { BrainService, HybridSearch, loadProjectProfile, projectScope, projectTaskContext } from '@neuralbridge/brain';
import type { DatabaseHandle } from '@neuralbridge/database';
import { skillUsageAnalytics, type EngineOptions, type TaskEngine } from '@neuralbridge/orchestrator';
import type { AgentId } from '@neuralbridge/shared';
import { builtInSkillCapabilities, createSkillIntelligenceProvider, gitInfo, scanSkills } from '@neuralbridge/workspace';
import { readPreferences } from './preferences.js';
import { createTaskEngine } from './tasks.js';

/*
 * CORE-05: one composition of the task engine for both places that may run it — the desktop main process (until the
 * tasks group moves) and the Singularity Core. Same adapters, MCP injection, memory and RAG context, skills, learnings
 * and token budget, so a task behaves the same wherever it executes. Electron-free on purpose (the Core imports it).
 */

type SearchProvider = ConstructorParameters<typeof HybridSearch>[1];

export interface TaskCompositionDeps {
  handle: DatabaseHandle;
  adapters: Record<AgentId, AgentAdapter>;
  /** Executable that runs the MCP server script as Node (ELECTRON_RUN_AS_NODE=1). */
  appExecutable: string;
  serverScript: string;
  dataDir: string | undefined;
  homeDir: string;
  userDataDir: string;
  preferencesFile: string;
  semanticProvider: SearchProvider;
  /** Learning proposals from finished tasks go to the review queue. */
  propose: (proposals: unknown[], context: { taskId: string; projectId: string | null; agent: AgentId }) => void;
  projectRoot: (projectId: string) => string;
  instanceId?: string;
}

export function skillRootsFor(homeDir: string, userDataDir: string): string[] {
  return [join(homeDir, '.claude', 'skills'), join(homeDir, '.claude', 'plugins'), join(homeDir, '.codex', 'skills'), join(homeDir, '.agents', 'skills'), join(userDataDir, 'managed-skills')];
}

export function composeTaskEngine(deps: TaskCompositionDeps): TaskEngine {
  const { handle } = deps;
  const skillRoots = skillRootsFor(deps.homeDir, deps.userDataDir);
  const readContext: NonNullable<EngineOptions['contextProvider']> = async ({ projectId, query, tokenBudget }) => {
    const result = await new HybridSearch(new BrainService(handle), deps.semanticProvider).search(query, { limit: 20 }, projectScope(projectId, false), { kind: 'user', client: 'electron' });
    // The project's technical profile (Phase 21) leads, then the memories, in one budget.
    return projectTaskContext(loadProjectProfile(handle, projectId), result.hits, tokenBudget);
  };
  return createTaskEngine({
    handle,
    adapters: deps.adapters,
    appExecutable: deps.appExecutable,
    serverScript: deps.serverScript,
    dataDir: deps.dataDir,
    ...(deps.instanceId ? { instanceId: deps.instanceId } : {}),
    onLearnings: ({ taskId, projectId, agent, proposals }) => deps.propose(proposals, { taskId, projectId, agent }),
    contextProvider: readContext,
    skillPreferences: () => readPreferences(deps.preferencesFile).skillSettings.preferences,
    tokenBudget: readPreferences(deps.preferencesFile).tokenBudget,
    skillIntelligenceProvider: createSkillIntelligenceProvider({
      readSkills: async ({ ids }) => {
        const skills = await scanSkills(skillRoots);
        const selected = skills.filter((skill) => ids.includes(skill.id) && skill.valid);
        const builtIns = builtInSkillCapabilities.filter((capability) => ids.includes(capability.id)).map((capability) => ({ id: capability.id, valid: true, content: `${capability.name}: ${capability.description}` }));
        const disk = await Promise.all(selected.map(async (skill) => ({ id: skill.id, valid: skill.valid, content: await readFile(skill.path, 'utf8') })));
        return [...builtIns, ...disk];
      },
      readGit: async (projectId) => gitInfo(deps.projectRoot(projectId)),
      readContext,
      readUsage: async () => skillUsageAnalytics(handle),
    }),
    skillAvailabilityProvider: async (ids) => {
      const available = new Set((await scanSkills(skillRoots)).filter((skill) => skill.valid).map((skill) => skill.id));
      for (const capability of builtInSkillCapabilities) available.add(capability.id);
      return ids.filter((id) => available.has(id));
    },
    skillContextProvider: async (ids, tokenBudget) => {
      const skills = await scanSkills(skillRoots);
      const selected = skills.filter((skill) => ids.includes(skill.id) && skill.valid);
      const maxChars = Math.max(0, tokenBudget) * 4;
      let chars = 0;
      const references: string[] = [];
      const parts: string[] = [];
      for (const skill of selected) {
        const raw = await readFile(skill.path, 'utf8');
        const remaining = maxChars - chars;
        if (remaining <= 0) break;
        const content = raw.slice(0, remaining);
        parts.push(`[skill://${skill.id}]\n${content}`);
        references.push(`skill://${skill.id}`);
        chars += content.length;
      }
      return { text: parts.join('\n\n'), references, estimatedTokens: Math.ceil(chars / 4) };
    },
  });
}
