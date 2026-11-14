import { spawn, spawnSync } from 'node:child_process';

// Phase 26: NeuralBridge runs the validation of an automatic fix itself, so success is proven rather than
// claimed. Only a fixed set of test/build/lint commands, as whole strings (nothing chained), in the project
// folder, with a timeout that stops the whole process tree and a bounded output.

const ALLOWED = [
  /^(npm|pnpm|yarn) (run )?test(:[\w-]+)?$/,
  /^npm test$/,
  /^(npm|pnpm|yarn) run (build|lint|typecheck|type-check|check)(:[\w-]+)?$/,
  /^dotnet (test|build)$/,
];
const OUTPUT_LIMIT = 8_000;

export function isAllowedValidation(command: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(command));
}

export interface ValidationResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** The end of stdout and stderr, at most 8 KB. */
  output: string;
}

export function runValidation(cwd: string, command: string, options: { timeoutMs?: number } = {}): Promise<ValidationResult> {
  if (!isAllowedValidation(command)) return Promise.reject(new Error(`forbidden: "${command}" não está entre os comandos de validação permitidos.`));
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  return new Promise((resolve) => {
    // npm, pnpm and yarn are .cmd shims on Windows: run the fixed, allow-listed string through cmd.
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_LIMIT);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, timedOut, output: `${output}\n${error.message}`.slice(-OUTPUT_LIMIT) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, exitCode: code, timedOut, output });
    });
  });
}
