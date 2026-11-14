import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { migrateLegacyDataDir } from '../src/paths.js';

// better-sqlite3 lives in the database package; the test only needs a real SQLite connection holding the file open.
const Database = createRequire(import.meta.resolve('../../database/package.json'))('better-sqlite3') as new (file: string) => { pragma(value: string): unknown; exec(sql: string): void; prepare(sql: string): { get(): unknown }; close(): void };

describe('M2 data directory migration', () => {
  it('copies once, verifies contents and preserves the legacy tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-'));
    const legacy = join(root, 'NeuralBridge');
    const target = join(root, 'Singularity');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'Local State'), 'safe-storage-marker');
    expect(migrateLegacyDataDir(legacy, target)).toBe(target);
    expect(readFileSync(join(legacy, 'Local State'), 'utf8')).toBe('safe-storage-marker');
    expect(readFileSync(join(target, 'Local State'), 'utf8')).toBe('safe-storage-marker');
    expect(JSON.parse(readFileSync(join(target, 'migrated-from.json'), 'utf8')).from).toBe(legacy);
    writeFileSync(join(legacy, 'new-after-copy'), 'left behind');
    expect(migrateLegacyDataDir(legacy, target)).toBe(target);
    expect(() => readFileSync(join(target, 'new-after-copy'))).toThrow();
  });

  it('defers the copy while another process holds a database in the legacy tree, then copies once it is closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-open-'));
    const legacy = join(root, 'NeuralBridge');
    const target = join(root, 'Singularity');
    mkdirSync(join(legacy, 'db'), { recursive: true });
    const db = new Database(join(legacy, 'db', 'brain.db'));
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'kept\')');
    try {
      expect(migrateLegacyDataDir(legacy, target)).toBe(legacy);
      expect(existsSync(target)).toBe(false);
    } finally {
      db.close();
    }
    expect(migrateLegacyDataDir(legacy, target)).toBe(target);
    const copy = new Database(join(target, 'db', 'brain.db'));
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'kept' });
    copy.close();
  });

  it('does not mistake files left after a clean close for an open database', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-leftover-'));
    const legacy = join(root, 'NeuralBridge');
    const target = join(root, 'Singularity');
    mkdirSync(join(legacy, 'db'), { recursive: true });
    writeFileSync(join(legacy, 'db', 'brain.db'), 'db');
    writeFileSync(join(legacy, 'db', 'brain.db-wal'), '');
    writeFileSync(join(legacy, 'db', 'brain.db-shm'), '');
    writeFileSync(join(legacy, 'DIPS-wal'), '');
    expect(migrateLegacyDataDir(legacy, target)).toBe(target);
    expect(existsSync(join(legacy, 'db', 'brain.db-shm'))).toBe(true);
    expect(existsSync(join(legacy, 'db', 'brain.db-shm.m2-probe'))).toBe(false);
  });

  it('adopts the copy another process finished first instead of falling back to the legacy tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-race-'));
    const legacy = join(root, 'NeuralBridge');
    const target = join(root, 'Singularity');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'settings.json'), '{}');
    // The other process: a complete, verified copy already in place under a different staging name.
    const winner = join(root, 'winner');
    mkdirSync(winner);
    writeFileSync(join(winner, 'settings.json'), '{}');
    writeFileSync(join(winner, 'migrated-from.json'), '{}');
    // Lose the race: the target appears between this process's check and its rename.
    const original = fs.renameSync;
    let raced = false;
    fs.renameSync = ((from: string, to: string) => { if (!raced) { raced = true; original(winner, target); } return original(from, to); }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    try {
      expect(migrateLegacyDataDir(legacy, target)).toBe(target);
      expect(raced).toBe(true);
    } finally {
      fs.renameSync = original;
      syncBuiltinESMExports();
    }
  });

  it('removes the partial copy and keeps the legacy tree when the disk fills up mid-copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-enospc-'));
    const legacy = join(root, 'NeuralBridge');
    const target = join(root, 'Singularity');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'settings.json'), '{}');
    const original = fs.cpSync;
    fs.cpSync = ((from: string, to: string, options?: object) => {
      original(from, to, options);
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    }) as typeof fs.cpSync;
    syncBuiltinESMExports();
    try {
      expect(migrateLegacyDataDir(legacy, target)).toBe(legacy);
    } finally {
      fs.cpSync = original;
      syncBuiltinESMExports();
    }
    expect(existsSync(target)).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.singularity-migration-'))).toEqual([]);
    expect(readFileSync(join(legacy, 'settings.json'), 'utf8')).toBe('{}');
    // With space back, the next start migrates normally.
    expect(migrateLegacyDataDir(legacy, target)).toBe(target);
  });

  it('falls back to the legacy directory when the destination cannot be created', () => {
    const root = mkdtempSync(join(tmpdir(), 'singularity-m2-fallback-'));
    const legacy = join(root, 'NeuralBridge');
    const destinationBlocker = join(root, 'not-a-directory');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'preserve-me.txt'), 'legacy');
    writeFileSync(destinationBlocker, 'blocking file');
    expect(migrateLegacyDataDir(legacy, join(destinationBlocker, 'Singularity'))).toBe(legacy);
    expect(readFileSync(join(legacy, 'preserve-me.txt'), 'utf8')).toBe('legacy');
  });
});
