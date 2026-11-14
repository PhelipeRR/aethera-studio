import type { DatabaseHandle } from '@neuralbridge/database';
import { IpcChannel } from '@neuralbridge/shared';
import type { SkillUsageRow } from '@neuralbridge/orchestrator';
import type { SkillRecommendationEngine, SkillRecommendationIntelligence } from '@neuralbridge/workspace';
import type { Preferences } from '../preferences.js';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface SkillsIntelligenceIpcDependencies {
  databaseHandle: DatabaseHandle | null;
  skillUsageAnalytics: (handle: DatabaseHandle) => SkillUsageRow[];
  recommendationEngine: SkillRecommendationEngine;
  preferencesFile: string;
  readPreferences: (file: string) => Preferences;
  readProjectIntelligence: (input: { databaseHandle: DatabaseHandle; projectId: string; taskDescription: string; tokenBudget: number }) => Promise<SkillRecommendationIntelligence>;
}

function readUsage(dependencies: SkillsIntelligenceIpcDependencies): SkillUsageRow[] {
  if (!dependencies.databaseHandle) return [];
  try {
    return dependencies.skillUsageAnalytics(dependencies.databaseHandle);
  } catch {
    throw new Error('unavailable: métricas de skills indisponíveis.');
  }
}

export function registerSkillsIntelligenceIpcHandlers(
  ipc: IpcMainLike,
  dependencies: SkillsIntelligenceIpcDependencies,
  isTrustedSender: (url: string) => boolean,
): void {
  registerIpcHandler(ipc, IpcChannel.skillsUsage, async () => readUsage(dependencies), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.skillsRecommend, async ({ taskDescription, agent, projectId }) => {
    const preferences = dependencies.readPreferences(dependencies.preferencesFile);
    let intelligence: SkillRecommendationIntelligence | undefined;
    if (projectId && dependencies.databaseHandle) {
      try {
        intelligence = await dependencies.readProjectIntelligence({
          databaseHandle: dependencies.databaseHandle,
          projectId,
          taskDescription,
          tokenBudget: preferences.tokenBudget,
        });
      } catch {
        // Recommendation remains useful when optional project intelligence is unavailable.
      }
    }
    const result = await dependencies.recommendationEngine.recommend({
      taskDescription,
      limit: 5,
      preferences: preferences.skillSettings.preferences,
      ...(agent ? { agent } : {}),
      ...(projectId ? { projectId } : {}),
      ...(intelligence ? { intelligence } : {}),
    });
    return result.recommendations.map(({ skillId, name, reasons, relevance, conflictWarnings }) => ({ skillId, name, reasons, relevance, conflictWarnings }));
  }, isTrustedSender);
}
