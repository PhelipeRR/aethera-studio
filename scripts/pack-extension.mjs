// Builds the folder that Configurações > Extensões > "Adicionar uma extensão local" installs.
//
//   npm run extension:pack -- velix        -> dist/extensions/velix (Aethera)
//   npm run extension:pack -- neura
//
// The installer accepts only extension.json and the files named by its entrypoints, and checks the manifest's
// checksum over exactly those files. A workspace package (packages/extensions-<id>) also has package.json and
// tsconfig.json, so it is never installable as is: this copies only what the installer expects and refuses to pack
// when the manifest's checksum no longer matches the sources (update extension.json, see `--print-checksum`).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [id, flag] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error('usage: npm run extension:pack -- <id> [--print-checksum]');
const source = resolve('packages', `extensions-${id}`);
if (!existsSync(join(source, 'extension.json'))) throw new Error(`no extension package at ${source}`);
const manifest = JSON.parse(readFileSync(join(source, 'extension.json'), 'utf8'));
const files = [manifest.entrypoints.main, manifest.entrypoints.renderer].filter(Boolean).sort((a, b) => a.localeCompare(b));

// Same digest as packages/orchestrator/src/extensions/extension-installer.ts: path, NUL, UTF-8 content, sorted by path.
const hash = createHash('sha256');
for (const file of files) hash.update(file).update('\0').update(readFileSync(join(source, file), 'utf8'));
const checksum = hash.digest('hex');
if (flag === '--print-checksum') {
  console.log(checksum);
  process.exit(0);
}
if (manifest.checksum !== `sha256:${checksum}` || manifest.signature?.value !== checksum) {
  throw new Error(`extension.json of ${id} is stale: checksum and signature.value must be ${checksum}`);
}

const target = resolve('dist', 'extensions', id);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(source, 'extension.json'), join(target, 'extension.json'));
for (const file of files) {
  mkdirSync(dirname(join(target, file)), { recursive: true });
  cpSync(join(source, file), join(target, file));
}
console.log(`${manifest.name} (${id} ${manifest.version}) ready to install from:\n${target}`);
