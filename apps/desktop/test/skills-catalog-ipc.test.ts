import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcChannel } from '@neuralbridge/shared';
import { scanSkills } from '@neuralbridge/workspace';
import { describe, expect, it, vi } from 'vitest';
import { readPreferences, writePreferences } from '../src/main/preferences.js';
import { registerSkillsCatalogIpcHandlers, type SkillsCatalogIpcDependencies } from '../src/main/handlers/skills-catalog.js';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;

class FakeIpc {
  readonly handlers = new Map<string, Listener>();

  handle(channel: string, listener: Listener): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, payload: unknown, url = 'file:///app/index.html'): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing_handler:${channel}`);
    return handler({ senderFrame: { url } }, payload);
  }
}

function setup(overrides: Partial<SkillsCatalogIpcDependencies> = {}) {
  const ipc = new FakeIpc();
  const root = mkdtempSync(join(tmpdir(), 'nb-skills-catalog-ipc-'));
  const preferencesFile = join(root, 'preferences.json');
  const skillRoot = join(root, '.agents', 'skills');
  const dependencies: SkillsCatalogIpcDependencies = {
    preferencesFile,
    readPreferences,
    writePreferences,
    skillRoots: [skillRoot],
    scanSkills,
    ...overrides,
  };
  registerSkillsCatalogIpcHandlers(ipc, dependencies, (url) => url === 'file:///app/index.html');
  return { ipc, root, preferencesFile, skillRoot, dependencies };
}

describe('skills catalog IPC handler group', () => {
  it('registers only catalog and preference channels', () => {
    const { ipc } = setup();
    expect([...ipc.handlers.keys()].sort()).toEqual([
      IpcChannel.skillsList,
      IpcChannel.skillsSettings,
      IpcChannel.skillsSettingsSave,
    ].sort());
  });

  it('returns an empty catalog without exposing raw skill content', async () => {
    const { ipc } = setup();
    await expect(ipc.invoke(IpcChannel.skillsList, undefined)).resolves.toEqual([]);
  });

  it('lists a valid skill without returning SKILL.md content or secret-like text', async () => {
    const { ipc, skillRoot } = setup();
    const skillPath = join(skillRoot, 'safe-skill');
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, 'SKILL.md'), '---\nname: Safe Skill\ndescription: A safe catalog entry.\n---\n\napi_key=do-not-return\n');

    const listing = await ipc.invoke(IpcChannel.skillsList, undefined) as Array<Record<string, unknown>>;
    expect(listing).toEqual([expect.objectContaining({ name: 'Safe Skill', description: 'A safe catalog entry.', valid: true, source: 'agents' })]);
    expect(listing[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(listing)).not.toContain('do-not-return');
  });

  it('redacts secret-like frontmatter metadata from the catalog', async () => {
    const { ipc, skillRoot } = setup();
    const skillPath = join(skillRoot, 'metadata-skill');
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, 'SKILL.md'), '---\nname: api_key=frontmatter-secret\ndescription: secret=description-secret\n---\n');

    const listing = await ipc.invoke(IpcChannel.skillsList, undefined) as Array<Record<string, unknown>>;
    expect(listing[0]).toMatchObject({ name: '[redacted]', description: '[redacted]', valid: true });
    expect(JSON.stringify(listing)).not.toContain('frontmatter-secret');
    expect(JSON.stringify(listing)).not.toContain('description-secret');
  });

  it('returns valid preferences and safely falls back when preferences are absent or corrupted', async () => {
    const { ipc, preferencesFile } = setup();

    await expect(ipc.invoke(IpcChannel.skillsSettings, undefined)).resolves.toEqual({ allowlistedHosts: [], preferences: [] });

    writePreferences(preferencesFile, {
      ...readPreferences(preferencesFile),
      skillSettings: { allowlistedHosts: ['skills.example'], preferences: [{ skillId: 'safe', taskTypes: ['review'], agents: ['claude'], enabled: true }] },
    });
    await expect(ipc.invoke(IpcChannel.skillsSettings, undefined)).resolves.toEqual({ allowlistedHosts: ['skills.example'], preferences: [{ skillId: 'safe', taskTypes: ['review'], agents: ['claude'], enabled: true }] });

    writeFileSync(preferencesFile, '{corrupted');
    await expect(ipc.invoke(IpcChannel.skillsSettings, undefined)).resolves.toEqual({ allowlistedHosts: [], preferences: [] });
  });

  it('persists valid settings without changing the surrounding preferences', async () => {
    const { ipc, preferencesFile } = setup();
    await expect(ipc.invoke(IpcChannel.skillsSettingsSave, { allowlistedHosts: ['skills.example'], preferences: [] })).resolves.toEqual({ ok: true });
    expect(readPreferences(preferencesFile).skillSettings).toEqual({ allowlistedHosts: ['skills.example'], preferences: [] });
    expect(JSON.parse(readFileSync(preferencesFile, 'utf8'))).toHaveProperty('theme', 'dark');
  });

  it('accepts valid hostnames containing token-like words', async () => {
    const { ipc, preferencesFile } = setup();
    await expect(ipc.invoke(IpcChannel.skillsSettingsSave, { allowlistedHosts: ['api-token.example'], preferences: [] })).resolves.toEqual({ ok: true });
    expect(readPreferences(preferencesFile).skillSettings.allowlistedHosts).toEqual(['api-token.example']);
  });

  it('rejects sensitive settings without persisting or echoing the value', async () => {
    const { ipc, preferencesFile } = setup();
    const secret = '-----BEGIN PRIVATE KEY-----';

    await expect(ipc.invoke(IpcChannel.skillsSettingsSave, { allowlistedHosts: [secret], preferences: [] })).rejects.toThrow(/sensitive|sensível|redacted|redigido/i);
    expect(() => readFileSync(preferencesFile, 'utf8')).toThrow();
  });

  it('rejects invalid payloads and untrusted senders before dependencies run', async () => {
    const scanSkillsMock = vi.fn(async () => []);
    const readPreferencesMock = vi.fn(readPreferences);
    const writePreferencesMock = vi.fn(writePreferences);
    const { ipc } = setup({ scanSkills: scanSkillsMock, readPreferences: readPreferencesMock, writePreferences: writePreferencesMock });
    await expect(ipc.invoke(IpcChannel.skillsSettingsSave, { allowlistedHosts: [7], preferences: [] })).rejects.toThrow('Invalid payload');
    await expect(ipc.invoke(IpcChannel.skillsList, undefined, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    await expect(ipc.invoke(IpcChannel.skillsSettings, undefined, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    await expect(ipc.invoke(IpcChannel.skillsSettingsSave, { allowlistedHosts: [], preferences: [] }, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    expect(scanSkillsMock).not.toHaveBeenCalled();
    expect(readPreferencesMock).not.toHaveBeenCalled();
    expect(writePreferencesMock).not.toHaveBeenCalled();
  });
});
