import { spawn } from 'node:child_process';
import type { CommandSpec } from './clients.js';
import type { Runner } from './mcp-registration.js';

/**
 * Runs a short CLI command (no shell, arguments as an array) and collects its output.
 * Long-running agent executions use the Phase 7 ProcessRunner instead.
 */
export function createCliRunner(options: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Runner {
  const { env = process.env, timeoutMs = 60_000 } = options;
  return (cli: CommandSpec, args: string[]) =>
    new Promise((resolve) => {
      const child = spawn(cli.command, [...cli.args, ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: stderr + error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
}
