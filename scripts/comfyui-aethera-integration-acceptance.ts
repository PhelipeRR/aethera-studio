import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../apps/aethera-desktop/src/main/creative-studio-service.js';

const root = resolve(import.meta.dirname, '..');
const artifactDir = join(root, 'artifacts', 'comfyui-aethera-integration');
const userDataDir = join(artifactDir, 'userData');
const dbDir = join(userDataDir, 'db');
mkdirSync(dbDir, { recursive: true });
const migrationsFolder = resolve(import.meta.dirname, '../packages/database/migrations');
const handle = openDatabase(join(dbDir, 'creative.db'), { migrationsFolder });

try {
  const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
  await service.saveImageEngineSettings({
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    releaseMemoryAfterGeneration: true,
  });
  const result = await service.createFromPrompt({
    artType: 'banner',
    title: 'NextWorth ComfyUI integration acceptance',
    headline: 'NEXTWORTH',
    prompt: 'NextWorth geek channel banner with two original cyberpunk tech heroes at opposite edges, layered futuristic skyline, cyan and magenta energy, calm center safe area for typography',
    professionalPreset: 'banner_2560x1440',
    useAiGeneration: true,
    characterCount: 2,
    seed: 21005,
    maxSide: 1024,
    maxAttempts: 1,
  });
  const generatedAsset = Object.values(result.document.assetManifest).find((asset) => asset.originalName.startsWith('ai-gen-'));
  const evidence = {
    generatedAt: new Date().toISOString(),
    projectId: result.document.id,
    document: { width: result.document.width, height: result.document.height, artType: result.document.artType },
    generation: result.generation,
    audit: result.audit,
    generatedAsset: generatedAsset ? { id: generatedAsset.id, relativePath: generatedAsset.relativePath, originalName: generatedAsset.originalName } : null,
    previewDataUrlBytes: result.previewDataUrl.length,
  };
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  if (result.generation.status !== 'generated' || result.document.width !== 2560 || result.document.height !== 1440 || !generatedAsset) {
    throw new Error('Aethera/ComfyUI integration acceptance did not produce a generated editable banner.');
  }
} finally {
  handle.close();
}
