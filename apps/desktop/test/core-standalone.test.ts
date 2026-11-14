import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentUserId, LogonTask, logonTaskXml, readDesktopToken, readStandalone, writeStandalone, type SchtasksExec } from '../src/main/core/standalone.js';

describe('standalone Core logon task (CORE-08)', () => {
  it('runs for the current user at logon, with least privilege, hidden, repeating every 5 minutes', () => {
    const xml = logonTaskXml({ userId: 'PC\\Fulano', command: 'C:\\Program Files\\NeuralBridge\\NeuralBridge.exe', args: ['--singularity-core'] });
    expect(xml).toContain('<LogonTrigger>');
    expect(xml).toContain('<UserId>PC\\Fulano</UserId>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).not.toContain('HighestAvailable');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<Interval>PT5M</Interval>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(xml).toContain('<Hidden>true</Hidden>');
    expect(xml).toContain('<Command>C:\\Program Files\\NeuralBridge\\NeuralBridge.exe</Command>');
    expect(xml).toContain('<Arguments>--singularity-core</Arguments>');
    expect(xml).not.toMatch(/Boot|SYSTEM|Service/i);
  });

  it('escapes paths and quotes arguments with spaces', () => {
    const xml = logonTaskXml({ userId: 'A&B', command: 'C:\\x<y>\\electron.exe', args: ['C:\\dev\\my app', '--singularity-core'] });
    expect(xml).toContain('<UserId>A&amp;B</UserId>');
    expect(xml).toContain('<Command>C:\\x&lt;y&gt;\\electron.exe</Command>');
    expect(xml).toContain('<Arguments>&quot;C:\\dev\\my app&quot; --singularity-core</Arguments>');
  });

  it('registers through an UTF-16 XML file that is removed afterwards, and unregisters only what exists', async () => {
    const calls: string[][] = [];
    let registered = false;
    let xmlSeen = '';
    const exec: SchtasksExec = async (args) => {
      calls.push([...args]);
      if (args[0] === '/Create') { const file = args[args.indexOf('/XML') + 1] ?? ''; const bytes = readFileSync(file); expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]); xmlSeen = bytes.subarray(2).toString('utf16le'); registered = true; return { code: 0, stdout: '' }; }
      if (args[0] === '/Query') return { code: registered ? 0 : 1, stdout: '' };
      if (args[0] === '/Delete') { registered = false; return { code: 0, stdout: '' }; }
      return { code: 0, stdout: '' };
    };
    const temp = mkdtempSync(join(tmpdir(), 'nb-task-'));
    const task = new LogonTask(exec, 'Singularity Core (teste)', temp);
    await task.unregister();
    expect(calls.some((args) => args[0] === '/Delete')).toBe(false);
    await task.register({ userId: 'PC\\Fulano', command: 'C:\\app.exe', args: ['--singularity-core'] });
    expect(calls).toContainEqual(expect.arrayContaining(['/Create', '/TN', 'Singularity Core (teste)', '/F']));
    expect(xmlSeen).toContain('<LogonTrigger>');
    expect(existsSync(join(temp, `core-task-${process.pid}.xml`))).toBe(false);
    expect(await task.registered()).toBe(true);
    await task.unregister();
    expect(await task.registered()).toBe(false);
    await expect(new LogonTask(async () => ({ code: 1, stdout: '' }), 'x', temp).register({ userId: 'u', command: 'c', args: [] })).rejects.toThrow(/recusou/);
  });

  it('keeps the setting and the desktop token as plain local files, rejecting malformed tokens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-standalone-'));
    expect(readStandalone(dir)).toEqual({ enabled: false });
    writeStandalone(dir, { enabled: true });
    expect(readStandalone(dir)).toEqual({ enabled: true });
    expect(readDesktopToken(dir)).toBeNull();
    writeFileSync(join(dir, 'core-desktop.token'), 'nao-e-um-token');
    expect(readDesktopToken(dir)).toBeNull();
    writeFileSync(join(dir, 'core-desktop.token'), 'a'.repeat(64));
    expect(readDesktopToken(dir)).toBe('a'.repeat(64));
    expect(currentUserId({ USERDOMAIN: 'PC', USERNAME: 'Fulano' })).toBe('PC\\Fulano');
  });
});
