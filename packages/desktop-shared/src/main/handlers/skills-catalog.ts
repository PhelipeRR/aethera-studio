import { IpcChannel } from '@neuralbridge/shared';
import { toSkillListing, type SkillSummary } from '@neuralbridge/workspace';
import type { Preferences } from '../preferences.js';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

type SkillSettings = Preferences['skillSettings'];

export interface SkillsCatalogIpcDependencies {
  preferencesFile: string;
  readPreferences: (file: string) => Preferences;
  writePreferences: (file: string, preferences: Pick<Preferences, 'theme'> & Partial<Omit<Preferences, 'theme'>>) => void;
  skillRoots: readonly string[];
  scanSkills: (roots: readonly string[]) => Promise<SkillSummary[]>;
}

const SENSITIVE_CONTENT_PATTERN = /-----BEGIN .*PRIVATE KEY-----|(?:^|[\s"'`])(?:api|access|refresh|private)[ _-]?(?:key|token)\s*[:=]\s*[^\s"'`,;]+|(?:^|[\s"'`])(?:password|secret|credential)\s*[:=]\s*[^\s"'`,;]+|(?:^|[./\\])\.env(?:$|[./\\])/iu;

function redactSensitiveText(value: string): string {
  return SENSITIVE_CONTENT_PATTERN.test(value) ? '[redacted]' : value;
}

function assertSafeSkillSettings(settings: SkillSettings): void {
  const values = [
    ...settings.allowlistedHosts,
    ...settings.preferences.flatMap((preference) => [preference.skillId, ...preference.taskTypes]),
  ];
  if (values.some((value) => SENSITIVE_CONTENT_PATTERN.test(value))) {
    throw new Error('invalid_skill_settings: conteúdo sensível foi redigido e não pode ser persistido');
  }
}

function toSafeSkillListing(skill: SkillSummary): ReturnType<typeof toSkillListing> {
  const listing = toSkillListing(skill);
  return { ...listing, name: redactSensitiveText(listing.name), description: redactSensitiveText(listing.description) };
}

export function registerSkillsCatalogIpcHandlers(
  ipc: IpcMainLike,
  dependencies: SkillsCatalogIpcDependencies,
  isTrustedSender: (url: string) => boolean,
): void {
  registerIpcHandler(ipc, IpcChannel.skillsList, async () => (await dependencies.scanSkills(dependencies.skillRoots)).map(toSafeSkillListing), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.skillsSettings, async () => dependencies.readPreferences(dependencies.preferencesFile).skillSettings, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.skillsSettingsSave, async (settings) => {
    assertSafeSkillSettings(settings);
    const current = dependencies.readPreferences(dependencies.preferencesFile);
    dependencies.writePreferences(dependencies.preferencesFile, { ...current, skillSettings: settings });
    return { ok: true as const };
  }, isTrustedSender);
}
