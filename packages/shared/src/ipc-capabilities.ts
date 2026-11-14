import { IpcChannel, type IpcChannelName } from './channels.js';

/**
 * IPC grouped by product capability (consolidation plan, Task 2.2). Each channel prefix belongs to
 * exactly one capability, and each capability is exposed through its own preload namespaces, so a
 * core capability never depends on an extension's facade (e.g. Azure DevOps outside Velix's `video`).
 */
export const IPC_CAPABILITIES = {
  system: { area: 'Configurações', tier: 'core', prefixes: ['app', 'database', 'theme', 'semantic', 'monitoring', 'core'], preload: ['app', 'databaseRecovery', 'theme', 'semantic', 'monitoring', 'core'] },
  work: { area: 'Trabalho', tier: 'core', prefixes: ['tasks', 'analytics', 'agents', 'workflows'], preload: ['tasks', 'analytics', 'agents', 'workflows'] },
  projects: { area: 'Trabalho', tier: 'core', prefixes: ['projects'], preload: ['projects'] },
  knowledge: { area: 'Conhecimento', tier: 'core', prefixes: ['brain', 'history-sync', 'imported-conversations'], preload: ['brain', 'historySync', 'importedConversations'] },
  skills: { area: 'Conhecimento', tier: 'power-tool', prefixes: ['skills'], preload: ['skills'] },
  integrations: { area: 'Integrações', tier: 'integration', prefixes: ['mcp', 'azure-devops'], preload: ['mcp', 'azureDevOps'] },
  extensions: { area: 'Configurações', tier: 'core', prefixes: ['extensions'], preload: ['extensions'] },
  personal: { area: 'Trabalho', tier: 'extension', prefixes: ['personal'], preload: ['personal'] },
  content: { area: 'Trabalho', tier: 'core', prefixes: ['content'], preload: ['content'] },
  neura: { area: 'Integrações', tier: 'extension', prefixes: ['neura', 'companion', 'spotify'], preload: ['neura', 'companion', 'spotify'] },
  velix: { area: 'Trabalho', tier: 'extension', prefixes: ['video'], preload: ['video'] },
} as const satisfies Record<string, { area: 'Trabalho' | 'Conhecimento' | 'Integrações' | 'Configurações'; tier: 'core' | 'power-tool' | 'integration' | 'extension'; prefixes: readonly string[]; preload: readonly string[] }>;

export type IpcCapability = keyof typeof IPC_CAPABILITIES;

/** The capability a channel belongs to, from its `prefix:` (null for an unmapped prefix, which tests reject). */
export function ipcCapabilityOf(channel: IpcChannelName): IpcCapability | null {
  const prefix = channel.split(':')[0] ?? '';
  for (const [capability, definition] of Object.entries(IPC_CAPABILITIES) as Array<[IpcCapability, (typeof IPC_CAPABILITIES)[IpcCapability]]>) {
    if ((definition.prefixes as readonly string[]).includes(prefix)) return capability;
  }
  return null;
}

/** Every channel, grouped by capability. */
export function ipcChannelsByCapability(): Record<IpcCapability, IpcChannelName[]> {
  const groups = Object.fromEntries(Object.keys(IPC_CAPABILITIES).map((key) => [key, [] as IpcChannelName[]])) as Record<IpcCapability, IpcChannelName[]>;
  for (const channel of Object.values(IpcChannel)) {
    const capability = ipcCapabilityOf(channel);
    if (capability) groups[capability].push(channel);
  }
  return groups;
}

/**
 * Channels where the renderer sends a secret to the main process (one-time entry by the user). The
 * value is stored by main and never returned; see docs/security/threat-model.md.
 */
export const IPC_SECRET_INGRESS = {
  'azure-devops:credential:save': 'PAT typed by the user; stored encrypted by main (safeStorage).',
  'video:collage:key:save': 'Gemini API key typed by the user; stored encrypted by main.',
  'video:studio:igdb:save': 'IGDB (Twitch app) Client ID and Client Secret typed by the user; stored encrypted by main, only a hint is returned.',
  'video:studio:rawg:save': 'Optional RAWG API key typed by the user; stored encrypted by main.',
} as const satisfies Partial<Record<IpcChannelName, string>>;

/**
 * Short-lived capability grants issued by main and echoed back by the renderer to authorize one Git
 * write. They are not provider credentials.
 */
export const IPC_CAPABILITY_GRANT_FIELD = 'token';

/**
 * Outputs that intentionally carry loosely typed data. Anything else must be a closed schema, so a raw
 * provider payload cannot reach the renderer by accident.
 */
export const IPC_OPEN_OUTPUTS = {
  'tasks:get': 'Task event data is NeuralBridge-produced and redacted before persistence.',
  'tasks:thread': 'Same task events as tasks:get.',
  'workflows:timeline': 'Recovery metadata written by the workflow runner.',
  'video:studio:render': 'Velix render state (extension, frozen); local data only.',
  'video:discovery:list': 'Velix discovery records persisted locally (extension, frozen).',
  'video:discovery:clips': 'Velix clip records persisted locally (extension, frozen).',
  'video:clip:status': 'Velix clip analysis persisted locally (extension, frozen).',
  'video:production:brief': 'Velix production brief persisted locally (extension, frozen).',
  'video:production:editorial:list': 'Velix editorial records persisted locally (extension, frozen).',
  'video:production:render': 'Velix render state (extension, frozen); local data only.',
  'video:channel:profile': 'YouTube channel branding the user edits as JSON on purpose; no credential (extension, frozen).',
  'video:production-run:script-read': 'Velix script artifact written by the app (extension, frozen).',
  'video:collage:list': 'Velix collage records persisted locally (extension, frozen).',
  'personal:notifications:list': 'Personal notification metadata persisted locally; message bodies are never returned.',
  'content:channels:list': 'Aethera channel identity and editorial configuration persisted locally; provider payloads are not returned.',
  'content:channels:create': 'Aethera channel identity and editorial configuration persisted locally; provider payloads are not returned.',
  'video:aethera-timeline:get': 'Aethera timeline version persisted locally; provider payloads are not returned.',
  'video:aethera-timeline:create': 'Aethera timeline version persisted locally; provider payloads are not returned.',
  'video:aethera-timeline:apply': 'Aethera timeline version persisted locally; provider payloads are not returned.',
  'video:aethera-editorial-plan:apply': 'Aethera timeline version produced by applying an approved editorial plan; persisted locally, no provider payloads.',
  'video:aethera-timeline:restore': 'Aethera timeline version persisted locally; provider payloads are not returned.',
  'video:aethera-timeline:history': 'Aethera timeline history persisted locally; provider payloads are not returned.',
  'video:aethera-review:run': 'Aethera review findings and low-risk corrections persisted locally; provider payloads are not returned.',
  'video:aethera-review:latest': 'Aethera review findings persisted locally; provider payloads are not returned.',
  'video:aethera-review:history': 'Aethera review history persisted locally; provider payloads are not returned.',
} as const satisfies Partial<Record<IpcChannelName, string>>;
