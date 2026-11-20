import type { SyncedProjectData } from '../../../aethera-remote-host/src/contracts/v1';
import type { ProductionProject } from './types';

export function productionProjectToSyncedData(project: ProductionProject): SyncedProjectData {
  return {
    title: project.title,
    briefing: project.briefing,
    creationMode: project.creationMode,
    format: project.format,
    style: project.style,
    aspectRatio: project.aspectRatio,
    language: project.language,
    durationMin: project.durationMin,
    humorLevel: project.humorLevel,
    ttsProvider: project.ttsProvider,
    ttsVoice: project.ttsVoice,
    qualityPreset: project.qualityPreset,
    status: project.status,
    scheduledDate: project.scheduledDate,
    humanizedScript: project.humanizedScript,
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      index: scene.index,
      title: scene.title,
      narration: scene.narration,
      visualQuery: scene.visualQuery,
      durationSec: scene.durationSec,
      transition: scene.transition,
      mediaMatched: scene.mediaMatched,
      caption: scene.caption,
      accentHex: scene.accentHex,
      mediaRefId: null,
    })),
    revisions: project.revisions.map((rev) => ({
      id: rev.id,
      instruction: rev.instruction,
      summary: rev.summary,
      affectedStages: rev.affectedStages,
      createdAt: rev.createdAt,
      author: 'web',
    })),
    latestJobId: null,
    latestRenderMediaRefId: null,
    mediaRefs: [],
    settings: {
      channelId: project.channelId,
    },
  };
}
