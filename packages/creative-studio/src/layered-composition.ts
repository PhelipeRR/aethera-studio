import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';
import type { ExternalImageAdapter, ImageGenerationRequest } from './image-generation-adapter.js';
import { figureBox, renderOpenPoseGuide, type GuideRect } from './spatial-guides.js';
import type { VisualRecipe } from './visual-recipe.js';

/**
 * Layered composition for large groups: one empty scene plate, one generation per character (portrait bucket, single
 * OpenPose skeleton, plain background), a cutout per character, deterministic placement into the planned regions, then
 * one low-denoise img2img pass with the full pose guide to unify light and style. Each character gets a full 832×1216
 * canvas instead of ~170 px of a shared 1344×768 one, which is what made the 8-character regional graph illegible.
 */
export interface LayeredCompositionInput {
  adapter: ExternalImageAdapter;
  recipe: VisualRecipe;
  /** The regional request the gate would otherwise send (prompt, negative, sampler, LoRAs...). */
  baseRequest: ImageGenerationRequest;
  seed: number;
  poseControlNetModel: string;
  workDir: string;
  /** img2img denoise of the harmonization pass (default 0.4). */
  harmonizeStrength?: number;
  /** Throws when the last generation was not served by the required provider (no silent fallback). */
  assertProvider: (step: string) => void;
  /** Keeps the engine's models loaded across the portrait generations (avoids one reload per character). */
  holdModels?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Cuts out many portraits in one process; defaults to one adapter.removeBackground call per portrait. */
  cutoutBatch?: (imagePaths: string[]) => Promise<Buffer[]>;
}

const execFileAsync = promisify(execFile);

/** One rembg session for all portraits (scripts/cutout_batch_worker.py): ~1.5 s per cutout instead of ~18 s. */
export class BatchCutoutWorker {
  constructor(private readonly options: { pythonPath: string; model?: string; workerPath?: string; timeoutMs?: number }) {}

  async cutout(imagePaths: string[]): Promise<Buffer[]> {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = resolve(here, '..', 'scripts', 'cutout_batch_worker.py');
    const worker = this.options.workerPath ?? (existsSync(candidate) ? candidate : resolve(process.cwd(), 'packages', 'creative-studio', 'scripts', 'cutout_batch_worker.py'));
    const outDir = join(dirname(imagePaths[0] ?? '.'), 'cutouts');
    const { stdout } = await execFileAsync(this.options.pythonPath, [worker, '--model', this.options.model ?? 'isnet-general-use', '--out-dir', outDir, ...imagePaths], {
      timeout: this.options.timeoutMs ?? 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? '{}') as { ok?: boolean; outputs?: Array<{ output: string }> };
    if (!parsed.ok || parsed.outputs?.length !== imagePaths.length) throw new Error('Batch cutout worker returned an incomplete result.');
    return parsed.outputs.map((entry) => readFileSync(entry.output));
  }
}

export interface LayeredCompositionResult {
  image: Buffer;
  plateSeed: number;
  layers: Array<{ regionIndex: number; seed: number; cutoutPixels: number }>;
  harmonizeStrength: number;
  durationMs: number;
}

const PORTRAIT = { width: 832, height: 1216 } as const;

function stripScene(prompt: string, scene: string | undefined): string {
  if (!scene) return prompt;
  return prompt.replace(scene, '').replace(/,\s*,/g, ',').replace(/[,\s]+$/, '');
}

async function alphaBounds(png: Buffer): Promise<{ left: number; top: number; width: number; height: number; pixels: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) < 128) continue;
      pixels += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

export async function generateLayeredComposition(input: LayeredCompositionInput): Promise<LayeredCompositionResult> {
  const started = Date.now();
  const { adapter, recipe, baseRequest, seed, workDir } = input;
  if (!adapter.generateImage) throw new Error('Layered composition needs an image generation engine.');
  if (!adapter.removeBackground) throw new Error('Layered composition needs a background-removal engine for character cutouts.');
  const harmonizeStrength = input.harmonizeStrength ?? 0.4;
  const { characterRegions: _regions, spatialControl: _spatial, characterCount: _count, compositionStrategy: _strategy, faceDetailer: _fd, ...shared } = baseRequest;

  // 1. Empty scene plate (the calm/title zone keeps its masked prompt).
  const plate = await adapter.generateImage({
    ...shared,
    prompt: `${recipe.scenePrompt ?? recipe.positivePrompt}, scenery, no humans, empty`,
    negativePrompt: `${recipe.negativePrompt}, person, people, 1girl, 1boy, character, crowd, silhouette`,
    seed,
  });
  input.assertProvider('scene plate');

  // 2. One character per generation, on a plain background, posed by a single centered skeleton.
  const portraitGuide = join(workDir, 'layered-portrait-pose.png');
  writeFileSync(portraitGuide, await renderOpenPoseGuide(PORTRAIT.width, PORTRAIT.height, [{ x: PORTRAIT.width * 0.2, y: PORTRAIT.height * 0.03, width: PORTRAIT.width * 0.6, height: PORTRAIT.height * 0.94 }]));
  const composites: OverlayOptions[] = [];
  const layers: LayeredCompositionResult['layers'] = [];
  const generate = adapter.generateImage.bind(adapter);
  const hold = input.holdModels ?? (<T>(work: () => Promise<T>) => work());
  const portraitPaths = await hold(async () => {
    const paths: string[] = [];
    for (const [index, region] of recipe.characterRegions.entries()) {
      const layerSeed = (seed + 101 * (index + 1)) % 0x80000000;
      const portrait = await generate({
      ...shared,
      prompt: `${stripScene(region.prompt ?? 'solo, single character, full body', recipe.scenePrompt)}, simple background, white background, standing`,
      negativePrompt: `${recipe.negativePrompt}, scenery, buildings, multiple people, 2girls, 2boys`,
      seed: layerSeed,
      width: PORTRAIT.width,
      height: PORTRAIT.height,
      controlNet: { model: input.poseControlNetModel, imagePath: portraitGuide, strength: 0.85, startPercent: 0, endPercent: 0.85 },
    });
      input.assertProvider(`character ${index + 1}`);
      const portraitPath = join(workDir, `layered-character-${index + 1}.png`);
      writeFileSync(portraitPath, portrait);
      paths.push(portraitPath);
      layers.push({ regionIndex: index, seed: layerSeed, cutoutPixels: 0 });
    }
    return paths;
  });
  const removeBackground = adapter.removeBackground.bind(adapter);
  const cutouts = input.cutoutBatch
    ? await input.cutoutBatch(portraitPaths)
    : await Promise.all(portraitPaths.map((path) => removeBackground({ inputImagePath: path })));
  for (const [index, region] of recipe.characterRegions.entries()) {
    const cutout = cutouts[index]!;
    const bounds = await alphaBounds(cutout);
    if (!bounds) throw new Error(`Character ${index + 1} cutout is empty.`);
    // Place the trimmed figure inside the region's figure box, feet on the box bottom.
    const box: GuideRect = figureBox(region);
    const scale = Math.min(box.height / bounds.height, (box.width * 1.6) / bounds.width);
    const targetWidth = Math.max(1, Math.round(bounds.width * scale));
    const targetHeight = Math.max(1, Math.round(bounds.height * scale));
    const figure = await sharp(cutout).extract(bounds).resize(targetWidth, targetHeight).png().toBuffer();
    const left = Math.round(box.x + box.width / 2 - targetWidth / 2);
    const top = Math.round(box.y + box.height - targetHeight);
    composites.push({ input: figure, left: Math.max(0, Math.min(recipe.width - targetWidth, left)), top: Math.max(0, Math.min(recipe.height - targetHeight, top)) });
    layers[index]!.cutoutPixels = bounds.pixels;
  }
  const composed = await sharp(plate).resize(recipe.width, recipe.height).composite(composites).png().toBuffer();
  const composedPath = join(workDir, 'layered-composed.png');
  writeFileSync(composedPath, composed);

  // 3. Harmonize light and style without moving anyone: low denoise plus the full pose guide.
  const fullGuide = join(workDir, 'layered-full-pose.png');
  writeFileSync(fullGuide, await renderOpenPoseGuide(recipe.width, recipe.height, recipe.characterRegions));
  const image = await adapter.generateImage({
    ...shared,
    seed: (seed + 7) % 0x80000000,
    referenceImagePaths: [composedPath],
    strength: harmonizeStrength,
    controlNet: { model: input.poseControlNetModel, imagePath: fullGuide, strength: 0.6, startPercent: 0, endPercent: 0.7 },
  });
  input.assertProvider('harmonization');
  return { image, plateSeed: seed, layers, harmonizeStrength, durationMs: Date.now() - started };
}
