import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../apps/aethera-desktop/src/main/creative-studio-service.js';
import type { ProfessionalPresetId } from '../packages/creative-studio/src/index.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const artifactDir = join(root, 'artifacts', 'comfyui-aethera-six-case-acceptance');
const userDataDir = join(artifactDir, 'userData');
const dbDir = join(userDataDir, 'db');
const migrationsFolder = resolve(import.meta.dirname, '../packages/database/migrations');

async function vramMiB(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
    const value = Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const cases: Array<{
  id: string;
  artType: 'thumbnail' | 'banner';
  preset: ProfessionalPresetId;
  prompt: string;
  headline?: string;
  characterCount: number;
  seed: number;
}> = [
  {
    id: 'anime-individual',
    artType: 'thumbnail',
    preset: 'anime_cinematic',
    prompt: 'one original anime warrior in close-up, expressive eyes, clean face, controlled dramatic key light, polished cel shading',
    characterCount: 1,
    seed: 31000,
  },
  {
    id: 'anime-two',
    artType: 'thumbnail',
    preset: 'anime_premium_cinematic',
    prompt: 'two distinct original anime warriors in a readable combat exchange, one on the left and one on the right, separated silhouettes, controlled energy clash',
    characterCount: 2,
    seed: 31001,
  },
  {
    id: 'cyberpunk-trio',
    artType: 'thumbnail',
    preset: 'cyberpunk_neon',
    prompt: 'three distinct cyberpunk heroes in separate readable positions, rain-slick futuristic city, cyan and magenta rim light, clear foreground midground background depth',
    characterCount: 3,
    seed: 31002,
  },
  {
    id: 'cyberpunk-group-eight',
    artType: 'thumbnail',
    preset: 'cyberpunk_neon',
    prompt: 'eight distinct cyberpunk heroes arranged in a readable two-row group, separated silhouettes, varied poses, cinematic city depth, no fused bodies',
    characterCount: 8,
    seed: 31003,
  },
  {
    id: 'gamer-thumbnail',
    artType: 'thumbnail',
    preset: 'youtube_thumbnail_1280x720',
    prompt: 'professional gamer thumbnail with one expressive player reaction and a clear gaming setup, strong focal silhouette, clean negative space reserved for editor text',
    characterCount: 1,
    seed: 31004,
  },
  {
    id: 'nextworth-banner',
    artType: 'banner',
    preset: 'banner_2560x1440',
    headline: 'NEXTWORTH',
    prompt: 'NextWorth geek channel banner with two original tech heroes at opposite edges, layered futuristic skyline, cyan and magenta energy, calm central safe area reserved for editor typography',
    characterCount: 2,
    seed: 31005,
  },
];

mkdirSync(dbDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
const handle = openDatabase(join(dbDir, 'creative.db'), { migrationsFolder });

try {
  const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
  await service.saveImageEngineSettings({
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    releaseMemoryAfterGeneration: true,
  });

  const results: Array<Record<string, unknown>> = [];
  for (const testCase of cases) {
    const started = Date.now();
    const vramBeforeMiB = await vramMiB();
    let vramPeakMiB = vramBeforeMiB;
    const sampler = setInterval(() => {
      void vramMiB().then((current) => {
        if (current !== null && (vramPeakMiB === null || current > vramPeakMiB)) vramPeakMiB = current;
      });
    }, 500);

    try {
      const result = await service.createFromPrompt({
        artType: testCase.artType,
        title: `Aethera ComfyUI acceptance — ${testCase.id}`,
        prompt: testCase.prompt,
        ...(testCase.headline ? { headline: testCase.headline } : {}),
        professionalPreset: testCase.preset,
        useAiGeneration: true,
        characterCount: testCase.characterCount,
        seed: testCase.seed,
        maxSide: 1024,
        maxAttempts: 1,
        loraMode: 'off',
      });
      const after = await vramMiB();
      if (after !== null && (vramPeakMiB === null || after > vramPeakMiB)) vramPeakMiB = after;
      const generatedAsset = Object.values(result.document.assetManifest).find((asset) => asset.originalName.startsWith('ai-gen-'));
      const absoluteAssetPath = generatedAsset
        ? join(userDataDir, 'creative-studio', generatedAsset.relativePath)
        : null;
      const copiedOutput = absoluteAssetPath && existsSync(absoluteAssetPath)
        ? (() => {
            const outputPath = join(artifactDir, `${testCase.id}.png`);
            writeFileSync(outputPath, readFileSync(absoluteAssetPath));
            return outputPath;
          })()
        : null;
      results.push({
        id: testCase.id,
        status: result.generation.status,
        structuralStatus: result.generation.qualityAudit?.passed ? 'passed' : 'not_passed_or_unavailable',
        model: 'animagine-xl-3.1.safetensors',
        workflow: 'aethera-direction-recipe-comfyui-composition',
        preset: testCase.preset,
        seed: testCase.seed,
        characterCount: testCase.characterCount,
        documentResolution: `${result.document.width}x${result.document.height}`,
        generatedResolution: result.generation.recipe ? `${result.generation.recipe.width}x${result.generation.recipe.height}` : null,
        ms: Date.now() - started,
        vramBeforeMiB,
        vramAfterMiB: after,
        vramPeakMiB,
        file: copiedOutput,
        generation: result.generation,
        qualityAudit: result.audit,
      });
    } catch (error) {
      const after = await vramMiB();
      if (after !== null && (vramPeakMiB === null || after > vramPeakMiB)) vramPeakMiB = after;
      results.push({
        id: testCase.id,
        status: 'failed',
        workflow: 'aethera-direction-recipe-comfyui-composition',
        seed: testCase.seed,
        characterCount: testCase.characterCount,
        ms: Date.now() - started,
        vramBeforeMiB,
        vramAfterMiB: after,
        vramPeakMiB,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(sampler);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    acceptanceStatus: 'structural_and_integration_pass_pending_human_review' as const,
    results,
    humanReview: {
      status: 'pending' as const,
      criteria: ['identity', 'anatomy', 'subject count', 'focal hierarchy', 'text-safe area', 'empty/generic composition'],
    },
    limitations: [
      'The structural quality audit does not prove semantic fidelity or production aesthetics.',
      'The six cases use LoRA mode off because no verified LoRA file is installed in the runtime.',
    ],
  };
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every((result) => result.status === 'generated') ? 0 : 1;
} finally {
  handle.close();
}
