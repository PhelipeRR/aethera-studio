import type { DatabaseHandle } from '@neuralbridge/database';
import { AllowedApplicationExecutor, ComputerActionBroker, type LocalWorkerClient, ManualTranscriptSource, MeetingInput, type MeetingSource, NeuraOrchestrator, NeuraRegistry, SuggestionEngine, TaskEngineConversation, TaskEngineSuggestionModel, VoiceGateway, type NeuraAppControls, type NeuraMemory, type NeuraSpotify, type NeuraWeather, type StructuredReadOnlyRunner, type SuggestionModel, type VoiceProvider } from '@neuralbridge/orchestrator';
import type { NeuraScreen } from '@neuralbridge/orchestrator';
import type { NeuraSettings } from '@neuralbridge/shared';
import { createDesktopApplicationLauncher, type DesktopShell } from './computer-launcher.js';
import { JsonNeuraHistory } from './neura-history.js';

export interface NeuraRuntimeDeps {
  settings(): NeuraSettings;
  engine: StructuredReadOnlyRunner | null;
  handle: DatabaseHandle | null;
  worker: LocalWorkerClient;
  spotify: NeuraSpotify;
  shell: DesktopShell;
  voiceProvider: VoiceProvider;
  meetingAudio: MeetingSource;
  screen?: NeuraScreen;
  weather?: NeuraWeather;
  memory?: NeuraMemory;
  historyFile?: string;
  startTask?: (task: { prompt: string; projectId: string; agent: 'claude' | 'codex'; externalRef?: { system: string; id: string; revision: number } }) => Promise<unknown>;
  app?: NeuraAppControls;
}

/** Puts Neura together from parts that already exist. The TaskEngine stays the only way to reach an agent. */
export function createNeuraRuntime(deps: NeuraRuntimeDeps): { neura: NeuraOrchestrator; meeting: MeetingInput } {
  const { settings, engine, handle, worker, startTask } = deps;
  const target = (): { projectId: string | null; agent: 'claude' | 'codex' } | null => {
    const { projectId, agent } = settings();
    return engine ? { projectId, agent } : null;
  };
  const model: SuggestionModel = {
    generate: (request, options) => {
      const chosen = target();
      if (!engine || !chosen) return Promise.reject(new Error('unavailable: no project for Neura'));
      return new TaskEngineSuggestionModel({ engine, ...chosen }).generate(request, options);
    },
  };
  const transcripts = new ManualTranscriptSource();
  const meeting = new MeetingInput([transcripts, deps.meetingAudio]);
  const neura = new NeuraOrchestrator({
    settings,
    app: deps.app ?? null,
    voice: new VoiceGateway(deps.voiceProvider, { wakeWords: () => { const current = settings(); return { primary: current.wakeWord, aliases: current.wakeWordAliases }; } }),
    meeting,
    transcripts,
    suggestions: new SuggestionEngine({ model, worker: worker.available ? worker : null }),
    spotify: deps.spotify,
    actions: handle ? new ComputerActionBroker(handle, { executor: new AllowedApplicationExecutor(createDesktopApplicationLauncher(deps.shell), startTask ? { start: (task) => startTask({ ...task, agent: settings().agent }) } : undefined) }) : null,
    conversation: engine ? new TaskEngineConversation({ engine, target, globalMemory: () => settings().globalMemoryEnabled, ...(deps.memory ? { memory: deps.memory } : {}), ...(deps.historyFile ? { history: new JsonNeuraHistory(deps.historyFile) } : {}) }) : { reply: () => Promise.reject(new Error('unavailable: TaskEngine')) },
    screen: deps.screen ?? null,
    weather: deps.weather ?? null,
    registry: handle ? new NeuraRegistry(handle) : null,
    providers: {
      model: (current) => (!engine ? { available: false, detail: 'TaskEngine indisponível.' } : { available: true, detail: `Usa ${current.agent === 'claude' ? 'Claude' : 'Codex'} em modo somente leitura.` }),
      worker: () => (worker.available ? { available: true, detail: 'Pré-processamento local ativo.' } : { available: false, detail: 'Sem worker local: o modelo recebe o trecho limitado.' }),
    },
  });
  return { neura, meeting };
}
