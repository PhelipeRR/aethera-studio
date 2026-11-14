import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const SECRET_KEY = /(token|secret|password|authorization|cookie|credential|api[-_]?key|private[-_]?key|checkpoint)/iu;
const SECRET_VALUE = /(bearer\s+|api[_-]?key\s*[=:]\s*|password\s*[=:]\s*|token\s*[=:]\s*)[^\s,;]+/giu;
// Same credential shapes as redactEvidence in packages/shared/src/evidence.ts.
const SECRET_SHAPE = /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,})/gu;
const redact = (value, key = '') => {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '$1[redacted]').replace(SECRET_SHAPE, '[REDACTED]');
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  return value;
};
const serialize = (metadata, details) => `${JSON.stringify(redact({ schemaVersion: 1, generatedAt: new Date().toISOString(), metadata, details }))}\n`;

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; };
const dataDir = resolve(value('--data-dir', process.env.NB_DATA_DIR ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'NeuralBridge')));
const output = resolve(value('--output', join(process.cwd(), `neuralbridge-diagnostics-${Date.now()}.json`)));
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source archive */ }
const migrationDir = join(root, 'packages', 'database', 'migrations');
const migrationFiles = readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();
let migrationState = { applied: migrationFiles.length, latest: migrationFiles.at(-1)?.replace(/\.sql$/u, '') ?? null, failed: null };
const dbFile = join(dataDir, 'db', 'brain.db');
const extensionRows = [];
if (existsSync(dbFile)) {
  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const db = new Database(dbFile, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('__drizzle_migrations','extensions')").all().map((row) => row.name);
    if (tables.includes('__drizzle_migrations')) {
      const rows = db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC').all();
      migrationState = { applied: rows.length, latest: rows[0]?.hash ?? migrationState.latest, failed: null };
    }
    if (tables.includes('extensions')) {
      extensionRows.push(...db.prepare('SELECT id, manifest, state FROM extensions').all().map(({ id, manifest, state }) => {
        let version = 'unknown';
        try { version = JSON.parse(manifest).version ?? version; } catch { /* keep unknown */ }
        return { id, version, state };
      }));
    }
    db.close();
  } catch (error) { migrationState = { ...migrationState, failed: error instanceof Error ? error.name : 'database-read-failed' }; }
}
const report = serialize({ appVersion: version, commit, platform: process.platform, architecture: process.arch, migrationState, extensions: extensionRows }, { installer: { signed: false, autoUpdate: 'not configured' }, databasePresent: existsSync(dbFile), databaseSha256: existsSync(dbFile) ? createHash('sha256').update(readFileSync(dbFile)).digest('hex') : null });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, report, { encoding: 'utf8', mode: 0o600 });
console.log(`diagnostics exported: ${output}`);
