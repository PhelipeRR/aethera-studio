import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { AppId } from './index.js';

export interface MigrationTargets {
  orchestrator: string;
  aethera: string;
  void: string;
}

export interface PlannedMigrationItem {
  relativePath: string;
  ownerApp: AppId;
  sourcePath: string;
  targetPath: string;
  sizeBytes: number;
  sha256: string;
  requiresReauth: boolean;
}

export interface MigrationPlan {
  sourceDir: string;
  targets: MigrationTargets;
  createdAtIso: string;
  items: PlannedMigrationItem[];
  skippedCredentials: Array<{ relativePath: string; ownerApp: AppId; reason: string }>;
  countsByApp: Record<AppId, number>;
}

export interface MigrationExecutionReport {
  dryRun: boolean;
  executedAtIso: string;
  backupDir: string;
  manifestPath?: string;
  copied: number;
  skippedIdempotent: number;
  skippedCredentials: number;
  items: Array<PlannedMigrationItem & { action: 'copied' | 'unchanged' | 'planned' }>;
}

export interface BackupManifest {
  createdAtIso: string;
  sourceDir: string;
  targets: MigrationTargets;
  createdTargetFiles: string[];
  backedUpFiles: Array<{ targetPath: string; backupPath: string; sha256: string }>;
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  if (!existsSync(currentDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const full = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(rootDir, full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export function classifyMigrationOwner(relativePath: string): { ownerApp: AppId; requiresReauth: boolean } {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  const requiresReauth =
    normalized.includes('oauth') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.endsWith('.key') ||
    normalized.includes('local state') ||
    normalized.includes('cookies');

  if (
    normalized.startsWith('aethera/') ||
    normalized.startsWith('renders/') ||
    normalized.startsWith('projects/') ||
    normalized.startsWith('channels/') ||
    normalized.startsWith('thumbnails/') ||
    normalized.includes('aethera')
  ) {
    return { ownerApp: 'aethera', requiresReauth };
  }

  if (
    normalized.startsWith('void/') ||
    normalized.startsWith('personal/') ||
    normalized.startsWith('voice/') ||
    normalized.startsWith('neura/') ||
    normalized.includes('void') ||
    normalized.includes('spotify') ||
    normalized.includes('gmail') ||
    normalized.includes('calendar')
  ) {
    return { ownerApp: 'void', requiresReauth };
  }

  return { ownerApp: 'orchestrator', requiresReauth };
}

export function planEcosystemMigration(input: {
  sourceDir: string;
  targets: MigrationTargets;
}): MigrationPlan {
  const files = walkFiles(input.sourceDir);
  const items: PlannedMigrationItem[] = [];
  const skippedCredentials: MigrationPlan['skippedCredentials'] = [];
  const countsByApp: Record<AppId, number> = { orchestrator: 0, aethera: 0, void: 0 };

  for (const file of files) {
    const rel = relative(input.sourceDir, file).replace(/\\/g, '/');
    const { ownerApp, requiresReauth } = classifyMigrationOwner(rel);
    if (requiresReauth) {
      skippedCredentials.push({
        relativePath: rel,
        ownerApp,
        reason: 'reauth_required_no_plaintext_secret_copy',
      });
      continue;
    }

    const stat = statSync(file);
    items.push({
      relativePath: rel,
      ownerApp,
      sourcePath: file,
      targetPath: join(input.targets[ownerApp], rel),
      sizeBytes: stat.size,
      sha256: sha256File(file),
      requiresReauth: false,
    });
    countsByApp[ownerApp] += 1;
  }

  return {
    sourceDir: input.sourceDir,
    targets: input.targets,
    createdAtIso: new Date().toISOString(),
    items,
    skippedCredentials,
    countsByApp,
  };
}

export function executeEcosystemMigration(input: {
  sourceDir: string;
  targets: MigrationTargets;
  backupDir: string;
  dryRun?: boolean;
}): MigrationExecutionReport {
  const plan = planEcosystemMigration({
    sourceDir: input.sourceDir,
    targets: input.targets,
  });

  if (input.dryRun) {
    return {
      dryRun: true,
      executedAtIso: new Date().toISOString(),
      backupDir: input.backupDir,
      copied: 0,
      skippedIdempotent: 0,
      skippedCredentials: plan.skippedCredentials.length,
      items: plan.items.map((item) => ({ ...item, action: 'planned' })),
    };
  }

  mkdirSync(input.backupDir, { recursive: true });
  const manifestPath = join(input.backupDir, 'backup-manifest.json');
  const existingManifest: BackupManifest | null = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest)
    : null;

  const manifest: BackupManifest = existingManifest ?? {
    createdAtIso: new Date().toISOString(),
    sourceDir: input.sourceDir,
    targets: input.targets,
    createdTargetFiles: [],
    backedUpFiles: [],
  };

  let copied = 0;
  let skippedIdempotent = 0;
  const reportItems: MigrationExecutionReport['items'] = [];

  for (const item of plan.items) {
    if (existsSync(item.targetPath)) {
      const existingHash = sha256File(item.targetPath);
      if (existingHash === item.sha256) {
        skippedIdempotent += 1;
        reportItems.push({ ...item, action: 'unchanged' });
        continue;
      }

      const backupPath = join(input.backupDir, 'previous-targets', item.ownerApp, item.relativePath);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(item.targetPath, backupPath);
      manifest.backedUpFiles.push({
        targetPath: item.targetPath,
        backupPath,
        sha256: existingHash,
      });
    } else {
      manifest.createdTargetFiles.push(item.targetPath);
    }

    mkdirSync(dirname(item.targetPath), { recursive: true });
    const tmpTarget = `${item.targetPath}.tmp-${process.pid}`;
    copyFileSync(item.sourcePath, tmpTarget);
    renameSync(tmpTarget, item.targetPath);
    copied += 1;
    reportItems.push({ ...item, action: 'copied' });
  }

  // Persist manifest atomically so an interrupted run never leaves a half-written manifest
  const tmpManifest = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmpManifest, manifestPath);

  const report: MigrationExecutionReport = {
    dryRun: false,
    executedAtIso: new Date().toISOString(),
    backupDir: input.backupDir,
    manifestPath,
    copied,
    skippedIdempotent,
    skippedCredentials: plan.skippedCredentials.length,
    items: reportItems,
  };
  writeFileSync(join(input.backupDir, 'migration-report.json'), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

export function rollbackEcosystemMigration(backupDir: string): {
  restored: number;
  removed: number;
} {
  const manifestPath = join(backupDir, 'backup-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifesto de backup não encontrado em ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;

  let removed = 0;
  for (const createdFile of manifest.createdTargetFiles) {
    if (existsSync(createdFile)) {
      rmSync(createdFile, { force: true });
      removed += 1;
    }
  }

  let restored = 0;
  for (const backup of manifest.backedUpFiles) {
    if (existsSync(backup.backupPath)) {
      mkdirSync(dirname(backup.targetPath), { recursive: true });
      copyFileSync(backup.backupPath, backup.targetPath);
      const restoredHash = sha256File(backup.targetPath);
      if (restoredHash !== backup.sha256) {
        throw new Error(`Falha de integridade SHA-256 ao restaurar ${backup.targetPath}`);
      }
      restored += 1;
    }
  }

  return { restored, removed };
}

export function verifyMigrationIntegrity(report: MigrationExecutionReport): {
  ok: boolean;
  verified: number;
  mismatches: string[];
} {
  let verified = 0;
  const mismatches: string[] = [];
  for (const item of report.items) {
    if (item.action === 'planned') continue;
    if (!existsSync(item.targetPath)) {
      mismatches.push(`missing:${item.targetPath}`);
      continue;
    }
    const targetHash = sha256File(item.targetPath);
    if (targetHash !== item.sha256) {
      mismatches.push(`sha256_mismatch:${item.targetPath}`);
      continue;
    }
    verified += 1;
  }
  return { ok: mismatches.length === 0, verified, mismatches };
}
