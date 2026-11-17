import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../apps/aethera-desktop/src/main/creative-studio-service.js';

const root = mkdtempSync(join(tmpdir(), 'aethera-comfyui-autostart-'));
const userDataDir = join(root, 'userData');
const dbDir = join(userDataDir, 'db');
mkdirSync(dbDir, { recursive: true });
const migrationsFolder = resolve(import.meta.dirname, '../packages/database/migrations');
const handle = openDatabase(join(dbDir, 'creative.db'), { migrationsFolder });

try {
  const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
  const result = await service.saveImageEngineSettings({
    endpoint: 'http://127.0.0.1:8000',
    autoStartComfyUi: true,
  });
  const evidence = {
    endpoint: result.status.comfyUi.endpoint,
    comfyUiState: result.status.comfyUi.state,
    startup: result.status.startup,
    activeProvider: result.status.activeProvider,
    checkpoint: result.settings.checkpoint,
  };
  const reportDir = resolve(import.meta.dirname, '../artifacts/comfyui-autostart-acceptance');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...evidence }, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.comfyUiState !== 'ready' || evidence.startup.state !== 'ready') {
    throw new Error('Aethera auto-start acceptance did not reach a ready ComfyUI endpoint.');
  }
} finally {
  handle.close();
  rmSync(root, { recursive: true, force: true });
}
