#!/usr/bin/env node
import { join } from 'node:path';
import {
  executeEcosystemMigration,
  rollbackEcosystemMigration,
} from '../../packages/integration-contracts/src/migration.ts';

function getAppDataRoot() {
  return process.env.APPDATA || join(process.env.HOME || process.cwd(), '.config');
}

const args = process.argv.slice(2);
const mode = args.includes('--rollback')
  ? 'rollback'
  : args.includes('--apply')
    ? 'apply'
    : 'dry-run';

const appData = getAppDataRoot();
const sourceDir = args.find((a) => a.startsWith('--source='))?.slice(9) || join(appData, 'NeuralBridge');
const backupDir =
  args.find((a) => a.startsWith('--backup='))?.slice(9) ||
  join(appData, 'SingularityMigrationBackups', 'latest');

if (mode === 'rollback') {
  const res = rollbackEcosystemMigration(backupDir);
  console.log(JSON.stringify({ mode: 'rollback', backupDir, ...res }, null, 2));
  process.exit(0);
}

const report = executeEcosystemMigration({
  sourceDir,
  targets: {
    orchestrator: join(appData, 'SingularityOrchestrator'),
    aethera: join(appData, 'AetheraStudio'),
    void: join(appData, 'Void'),
  },
  backupDir,
  dryRun: mode === 'dry-run',
});

console.log(JSON.stringify(report, null, 2));
