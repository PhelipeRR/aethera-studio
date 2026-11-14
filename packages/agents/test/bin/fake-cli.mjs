// Stand-in for a CLI, driven by its first argument. Used by the runner and adapter tests.
import { spawn } from 'node:child_process';

const [mode, ...rest] = process.argv.slice(2);

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

switch (mode) {
  case 'echo-stdin': {
    const input = await readStdin();
    for (const line of input.split('\n').filter(Boolean)) process.stdout.write(JSON.stringify({ type: 'echo', line }) + '\n');
    process.stderr.write('done reading\n');
    process.exit(Number(rest[0] ?? 0));
    break;
  }
  case 'tree': {
    // Starts a grandchild that would outlive us, reports both pids, then waits forever.
    // detached: outside Node's job object, like a grandchild of a native CLI, so only a tree kill can stop it.
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });
    process.stdout.write(JSON.stringify({ pid: process.pid, grandchild: grandchild.pid }) + '\n');
    setInterval(() => {}, 1000);
    break;
  }
  case 'flood': {
    // ~N MB of JSON lines, written respecting backpressure.
    const megabytes = Number(rest[0] ?? 50);
    const line = JSON.stringify({ type: 'noise', payload: 'x'.repeat(1000) }) + '\n';
    const total = Math.ceil((megabytes * 1024 * 1024) / line.length);
    let written = 0;
    const pump = () => {
      while (written < total) {
        written++;
        if (!process.stdout.write(line)) return process.stdout.once('drain', pump);
      }
      process.stdout.write(JSON.stringify({ type: 'end', lines: total }) + '\n');
    };
    pump();
    break;
  }
  case 'giant-line': {
    process.stdout.write('{"type":"giant","data":"' + 'y'.repeat(3 * 1024 * 1024) + '"}\n');
    process.stdout.write('{"type":"after"}\n');
    break;
  }
  case 'secret': {
    process.stdout.write('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789\n');
    process.stdout.write('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz and plain text\n');
    break;
  }
  case 'replay': {
    // Prints a recorded fixture, then exits with the given code.
    const { readFileSync } = await import('node:fs');
    process.stdout.write(readFileSync(rest[0], 'utf8'));
    process.stderr.write('replayed\n');
    process.exit(Number(rest[1] ?? 0));
    break;
  }
  case 'print-args': {
    process.stdout.write(JSON.stringify({ args: rest, stdin: await readStdin() }) + '\n');
    break;
  }
  default: {
    // Scripted output for adapter tests: FAKE_CLI_OUTPUT maps "argv joined by spaces" -> { stdout, stderr, code }.
    const scripted = JSON.parse(process.env.FAKE_CLI_OUTPUT ?? '{}');
    const key = process.argv.slice(2).join(' ');
    const entry = scripted[key] ?? scripted['*'] ?? { stdout: '', code: 1 };
    process.stdout.write(entry.stdout ?? '');
    process.stderr.write(entry.stderr ?? '');
    process.exit(entry.code ?? 0);
  }
}
