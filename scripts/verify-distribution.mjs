import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const run = promisify(exec);
// The version being shipped is the desktop app's, so a stale installer of an older version never passes.
const { version } = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
// M1: the installer carries the visible name Singularity; the unpacked executable keeps NeuralBridge.exe.
const installer = `dist/Singularity-Setup-${version}-x64.exe`;
const required = [
  installer,
  'apps/desktop/build/icon.ico',
  'dist/win-unpacked/resources/app.asar',
  'dist/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3',
];
for (const path of required) {
  try {
    await access(path);
  } catch {
    throw new Error(`missing ${path} (run npm run dist:win for version ${version})`);
  }
}
const installerSha256 = createHash('sha256').update(await readFile(installer)).digest('hex');

const icon = await readFile('apps/desktop/build/icon.ico');
if (icon.readUInt16LE(0) !== 0 || icon.readUInt16LE(2) !== 1 || icon.readUInt16LE(4) < 5) throw new Error('icon.ico is not a multi-image Windows ICO');
const { stdout } = await run('npx asar list dist/win-unpacked/resources/app.asar', { maxBuffer: 64 * 1024 * 1024 });
for (const entry of ['out/main/mcp-server.js', 'out/main/core.js', 'out/main/migrations/0000_initial_schema.sql']) {
  if (!stdout.replaceAll('\\', '/').includes(entry)) throw new Error(`package is missing ${entry}`);
}
// The 3D brain (Phase 19) ships as its own renderer chunk, loaded only when the tab opens.
if (!/out\/renderer\/assets\/BrainCanvas-[\w-]+\.js/.test(stdout.replaceAll('\\', '/'))) throw new Error('package is missing the 3D brain chunk');
// The unpacked app must be the same build as the installer's version.
const asar = createRequire(import.meta.url)('@electron/asar');
const packaged = JSON.parse(asar.extractFile('dist/win-unpacked/resources/app.asar', 'package.json').toString()).version;
if (packaged !== version) throw new Error(`packaged app is version ${packaged}, expected ${version}`);
console.log(`distribution verification: passed (${installer})`);
console.log(`installer sha256: ${installerSha256}`);
if (!process.env.WIN_CSC_LINK && !process.env.CSC_LINK) console.log('signing status: unsigned local build (WIN_CSC_LINK/CSC_LINK not configured)');
