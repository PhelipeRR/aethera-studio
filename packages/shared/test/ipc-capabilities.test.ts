import { describe, expect, it } from 'vitest';
import { IpcChannel, type IpcChannelName } from '../src/channels.js';
import { ipcContract } from '../src/ipc.js';
import { IPC_CAPABILITIES, IPC_CAPABILITY_GRANT_FIELD, IPC_OPEN_OUTPUTS, IPC_SECRET_INGRESS, ipcCapabilityOf, ipcChannelsByCapability } from '../src/ipc-capabilities.js';

type Def = { type: string; [key: string]: unknown };
type Schema = { _zod: { def: Def } };

/** Field names that hold a credential. Usage counters (`tokens`, `maxTokens`, `tokenBudget`) and page cursors are not secrets. */
const SECRET_FIELD = /^(token|accessToken|refreshToken|idToken|secret|clientSecret|password|passwd|apiKey|api_key|credential|credentials|authorization|cookie|privateKey|pat|personalAccessToken)$/i;

interface Findings { secretFields: string[]; open: string[] }

function walk(schema: Schema | undefined, path: string, found: Findings, seen = new Set<unknown>()): void {
  if (!schema?._zod || seen.has(schema)) return;
  seen.add(schema);
  const def: Def = schema._zod.def;
  const child = (value: unknown, next: string) => walk(value as Schema, next, found, seen);
  switch (def.type) {
    case 'object': {
      for (const [key, value] of Object.entries(def['shape'] as Record<string, Schema>)) {
        if (SECRET_FIELD.test(key)) found.secretFields.push(`${path}.${key}`);
        child(value, `${path}.${key}`);
      }
      const catchall = def['catchall'] as Schema | undefined;
      if (catchall && catchall._zod.def.type !== 'never') found.open.push(`${path}{*}`);
      break;
    }
    case 'array': child(def['element'], `${path}[]`); break;
    case 'optional': case 'nullable': case 'default': case 'readonly': case 'catch': case 'prefault': case 'nonoptional': child(def['innerType'], path); break;
    case 'union': for (const option of def['options'] as Schema[]) child(option, path); break;
    case 'intersection': child(def['left'], path); child(def['right'], path); break;
    case 'record': {
      const value = def['valueType'] as Schema;
      if (['unknown', 'any'].includes(value._zod.def.type)) found.open.push(`${path}{*}`);
      else child(value, `${path}{*}`);
      break;
    }
    case 'tuple': (def['items'] as Schema[]).forEach((item, index) => child(item, `${path}[${index}]`)); break;
    case 'pipe': child(def['in'], path); child(def['out'], path); break;
    case 'lazy': child((def['getter'] as () => Schema)(), path); break;
    case 'unknown': case 'any': found.open.push(path); break;
  }
}

const channels = Object.values(IpcChannel) as IpcChannelName[];
const outputs = channels.map((channel) => { const found: Findings = { secretFields: [], open: [] }; walk(ipcContract[channel].output as unknown as Schema, channel, found); return { channel, ...found }; });
const inputs = channels.map((channel) => { const found: Findings = { secretFields: [], open: [] }; walk(ipcContract[channel].input as unknown as Schema, channel, found); return { channel, ...found }; });

describe('IPC capability inventory', () => {
  it('assigns every channel to exactly one capability', () => {
    expect(channels.filter((channel) => ipcCapabilityOf(channel) === null)).toEqual([]);
    const prefixes = Object.values(IPC_CAPABILITIES).flatMap((definition) => [...definition.prefixes]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(Object.values(ipcChannelsByCapability()).flat()).toHaveLength(channels.length);
  });

  it('keeps Azure DevOps a core integration, separate from the Velix extension', () => {
    expect(ipcCapabilityOf(IpcChannel.azureDevOpsWriteExecute)).toBe('integrations');
    expect(IPC_CAPABILITIES.integrations.preload).toContain('azureDevOps');
    expect(IPC_CAPABILITIES.velix.preload).not.toContain('azureDevOps');
  });
});

describe('renderer boundary', () => {
  it('returns no credential to the renderer; only main-issued Git capability grants are allowed', () => {
    const leaks = outputs.flatMap((entry) => entry.secretFields).filter((path) => !path.endsWith(`.${IPC_CAPABILITY_GRANT_FIELD}`) || !path.startsWith('projects:git:authorize'));
    expect(leaks).toEqual([]);
  });

  it('accepts secrets from the renderer only on the documented one-time entry channels', () => {
    const ingress = inputs.filter((entry) => entry.secretFields.some((path) => !path.endsWith(`.${IPC_CAPABILITY_GRANT_FIELD}`) || !entry.channel.startsWith('projects:git:')));
    expect(ingress.map((entry) => entry.channel).sort()).toEqual(Object.keys(IPC_SECRET_INGRESS).sort());
  });

  it('exposes loosely typed output only where it is documented as app-owned data', () => {
    const open = outputs.filter((entry) => entry.open.length > 0).map((entry) => entry.channel).sort();
    expect(open).toEqual(Object.keys(IPC_OPEN_OUTPUTS).sort());
  });
});
