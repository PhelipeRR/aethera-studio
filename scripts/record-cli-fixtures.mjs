// Records real Claude Code / Codex output as parser fixtures, redacted of personal data.
// Usage: node scripts/record-cli-fixtures.mjs   (uses the logged-in CLIs; a few short requests)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const out = resolve(import.meta.dirname, '../packages/agents/test/fixtures');
mkdirSync(out, { recursive: true });

const onPath = (file) => (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, file)).find((candidate) => existsSync(candidate));
const claude = onPath('claude.exe');
const codexShim = onPath('codex.cmd');
const codexJs = codexShim && join(codexShim, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
if (!claude || !codexJs || !existsSync(codexJs)) throw new Error('claude.exe and npm-installed codex must be on PATH');

const home = homedir();
const user = userInfo().username;
const PERSONAL_LISTS = ['skills', 'plugins', 'slash_commands', 'terminal_slash_commands', 'agents', 'memory_paths', 'mcp_servers'];

function redactLine(line, work) {
  let text = line;
  try {
    const event = JSON.parse(line);
    if (event.type === 'system' && event.subtype === 'init') for (const key of PERSONAL_LISTS) if (key in event) event[key] = [];
    if (event.type === 'system' && event.subtype?.startsWith('hook_')) return null; // the user's own hooks
    text = JSON.stringify(event);
  } catch {
    // not JSON: keep, still path-redacted below
  }
  const variants = (value) => [value, value.replaceAll('\\', '\\\\'), value.replaceAll('\\', '/')];
  for (const [from, to] of [
    [work, 'C:\\work'],
    [home, 'C:\\Users\\user'],
  ]) {
    for (const variant of variants(from)) text = text.split(variant).join(to.replaceAll('\\', variant.includes('\\\\') ? '\\\\' : variant.includes('/') ? '/' : '\\'));
  }
  return text.replace(new RegExp(user, 'gi'), 'user');
}

function record(name, command, args, stdin, cwd) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => {
      const lines = stdout.split(/\r?\n/).filter(Boolean).map((line) => redactLine(line, cwd)).filter((line) => line !== null);
      const body = lines.join('\n') + '\n';
      if (new RegExp(user, 'i').test(body) || body.includes(home)) throw new Error(`${name}: personal data left after redaction`);
      writeFileSync(join(out, `${name}.jsonl`), body);
      console.log(`${name}: exit ${code}, ${lines.length} lines`);
      done();
    });
  });
}

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-fixture-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

const claudeBase = ['-p', '--output-format', 'stream-json', '--verbose'];
const codexBase = [codexJs, 'exec', '--json', '--skip-git-repo-check'];
const runs = [
  ['claude-text', claude, [...claudeBase, '--permission-mode', 'default', '--allowedTools', 'Read'], 'Reply with exactly: fixture-ok'],
  ['claude-edit', claude, [...claudeBase, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Write', 'Edit'], 'Create a file named hello.txt containing exactly: oi'],
  ['claude-denied', claude, [...claudeBase, '--permission-mode', 'default', '--allowedTools', 'Read'], 'Create a file named blocked.txt containing: x'],
  ['codex-text', process.execPath, [...codexBase, '-s', 'read-only', '-'], 'Reply with exactly: fixture-ok'],
  ['codex-edit', process.execPath, [...codexBase, '-s', 'workspace-write', '-c', 'windows.sandbox="unelevated"', '-'], 'Create a file named hello.txt containing exactly: oi'],
];
for (const [name, command, args, prompt] of runs) {
  const dir = repo();
  await record(name, command, args, prompt, dir);
  rmSync(dir, { recursive: true, force: true });
}
