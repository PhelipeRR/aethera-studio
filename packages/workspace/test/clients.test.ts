import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientConfigFile, findClientCli } from '../src/clients.js';

function touch(file: string): string {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
  return file;
}

describe('findClientCli', () => {
  it('finds the native Claude Code executable on PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'nb-path-'));
    const claude = touch(join(bin, 'claude.exe'));
    expect(findClientCli('claude', { PATH: bin })).toEqual({ command: claude, args: [] });
  });

  it('runs an npm-installed Codex through node and its launcher script, never through the .cmd shim', () => {
    const npmBin = mkdtempSync(join(tmpdir(), 'nb-npm-'));
    const nodeDir = mkdtempSync(join(tmpdir(), 'nb-node-'));
    touch(join(npmBin, 'codex.cmd'));
    const launcher = touch(join(npmBin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    const node = touch(join(nodeDir, 'node.exe'));
    expect(findClientCli('codex', { PATH: [npmBin, nodeDir].join(delimiter) })).toEqual({ command: node, args: [launcher] });
  });

  it('prefers a standalone codex.exe when one is installed', () => {
    const bin = mkdtempSync(join(tmpdir(), 'nb-path-'));
    const codex = touch(join(bin, 'codex.exe'));
    expect(findClientCli('codex', { PATH: bin })).toEqual({ command: codex, args: [] });
  });

  it('returns null when the client is not installed', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nb-path-'));
    expect(findClientCli('claude', { PATH: empty })).toBeNull();
    touch(join(empty, 'codex.cmd')); // shim without its package or without node
    expect(findClientCli('codex', { PATH: empty })).toBeNull();
  });
});

describe('clientConfigFile', () => {
  it('follows the official overrides and defaults', () => {
    expect(clientConfigFile('claude', {}, 'C:\\Users\\ana')).toBe(join('C:\\Users\\ana', '.claude.json'));
    expect(clientConfigFile('claude', { CLAUDE_CONFIG_DIR: 'D:\\cfg' }, 'C:\\Users\\ana')).toBe(join('D:\\cfg', '.claude.json'));
    expect(clientConfigFile('codex', {}, 'C:\\Users\\ana')).toBe(join('C:\\Users\\ana', '.codex', 'config.toml'));
    expect(clientConfigFile('codex', { CODEX_HOME: 'D:\\codex' }, 'C:\\Users\\ana')).toBe(join('D:\\codex', 'config.toml'));
  });
});

describe('CLI location override', () => {
  it('uses NB_CLAUDE_CLI / NB_CODEX_CLI when they name an existing executable', () => {
    const bin = mkdtempSync(join(tmpdir(), 'nb-override-'));
    const node = touch(join(bin, 'node.exe'));
    const script = touch(join(bin, 'agente falso.mjs'));
    const custom = touch(join(bin, 'claude-custom.exe'));
    expect(findClientCli('claude', { PATH: '', NB_CLAUDE_CLI: custom })).toEqual({ command: custom, args: [] });
    expect(findClientCli('codex', { PATH: '', NB_CODEX_CLI: JSON.stringify([node, script, 'codex']) })).toEqual({ command: node, args: [script, 'codex'] });
  });

  it('ignores overrides that are relative, missing or malformed, and falls back to PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'nb-override-'));
    const claude = touch(join(bin, 'claude.exe'));
    for (const bad of ['claude.exe', join(bin, 'nao-existe.exe'), '["unterminated', JSON.stringify([42]), JSON.stringify([])]) {
      expect(findClientCli('claude', { PATH: bin, NB_CLAUDE_CLI: bad })).toEqual({ command: claude, args: [] });
    }
  });
});
