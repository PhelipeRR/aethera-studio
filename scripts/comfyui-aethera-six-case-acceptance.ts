/**
 * CS9 six-case acceptance: every case runs twice with the same seed — `preview` (single pass) and `professional`
 * (FaceDetailer + 4x-UltraSharp to the document size). The professional run also returns its unrefined base from the
 * same graph execution, so "basic vs refined" compares identical noise. Earlier runs (canonical v1 at the folder root,
 * run-regional-v1/, run-crowd-negative-rejected/) are never overwritten: each run writes to its own run-cs9-* folder.
 *
 * Optional: CS9_CASES=anime-two,cyberpunk-trio limits the run to some cases; CS9_PROFILES=preview limits profiles;
 * CS9_CROWD=on enables the opt-in crowd-suppression LoRA; CS9_SEED_OFFSET=100 shifts every seed; CS9_LORA=file.safetensors:-1.5 applies one LoRA (manual mode) to the multi-character cases only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../apps/aethera-desktop/src/main/creative-studio-service.js';
import type { GenerationQualityProfileId, ProfessionalPresetId } from '../packages/creative-studio/src/index.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const baseDir = join(root, 'artifacts', 'comfyui-aethera-six-case-acceptance');
const runId = `run-cs9-${process.env.CS9_LORA ? 'lora-' : ''}${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const runDir = join(baseDir, runId);
const userDataDir = join(baseDir, 'userData');
const dbDir = join(userDataDir, 'db');
const migrationsFolder = resolve(import.meta.dirname, '../packages/database/migrations');
const onlyCases = process.env.CS9_CASES?.split(',').filter(Boolean);
const seedOffset = Number(process.env.CS9_SEED_OFFSET ?? 0);
const profiles = (process.env.CS9_PROFILES?.split(',').filter(Boolean) ?? ['preview', 'professional']) as GenerationQualityProfileId[];
const loraSpec = process.env.CS9_LORA
  ? (() => {
      // file.safetensors:modelStrength[:clipStrength]
      const [model = '', strengthModel = '1', strengthClip = strengthModel] = process.env.CS9_LORA!.split(':');
      return { model, strengthModel: Number(strengthModel), strengthClip: Number(strengthClip) };
    })()
  : null;

async function vramMiB(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
    const value = Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

interface AcceptanceCase {
  id: string;
  artType: 'thumbnail' | 'banner';
  preset: ProfessionalPresetId;
  prompt: string;
  headline?: string;
  characterCount: number;
  characterDescriptions?: string[];
  seed: number;
}

const cases: AcceptanceCase[] = [
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
    characterDescriptions: [
      'young swordswoman with long silver hair and red scarf, white and crimson armor, katana raised',
      'tall spear warrior with short black hair, dark blue plated armor, spear held in guard',
    ],
    seed: 31001,
  },
  {
    id: 'cyberpunk-trio',
    artType: 'thumbnail',
    preset: 'cyberpunk_neon',
    prompt: 'three distinct cyberpunk heroes in separate readable positions, rain-slick futuristic city, cyan and magenta rim light, clear foreground midground background depth',
    characterCount: 3,
    characterDescriptions: [
      'hooded hacker with glowing cyan visor and black techwear jacket',
      'muscular brawler with chrome cybernetic arms and red jacket',
      'female sniper with pink bob hair, long white coat and rifle on shoulder',
    ],
    seed: 31002,
  },
  {
    id: 'cyberpunk-group-eight',
    artType: 'thumbnail',
    preset: 'cyberpunk_neon',
    prompt: 'eight distinct cyberpunk heroes as a team lineup, separated silhouettes, varied poses, cinematic city depth',
    characterCount: 8,
    characterDescriptions: [
      'hooded hacker with cyan visor, black techwear',
      'woman with pink bob hair and white coat',
      'big brawler with chrome arms, red jacket',
      'young man with green mohawk and leather vest',
      'woman with long blue hair and purple bodysuit',
      'old mercenary with grey beard and armored vest',
      'girl with twin buns and yellow raincoat',
      'tall android with white plating and orange visor',
    ],
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
    characterDescriptions: [
      'tech hero with cyan holographic visor and white jacket',
      'tech heroine with magenta hair and dark armored suit',
    ],
    seed: 31005,
  },
];

interface RunFiles {
  generated: string | null;
  unrefinedBase: string | null;
  composed: string | null;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

function save(name: string, buffer: Buffer | null): string | null {
  if (!buffer) return null;
  const path = join(runDir, name);
  writeFileSync(path, buffer);
  return path;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

mkdirSync(dbDir, { recursive: true });
mkdirSync(runDir, { recursive: true });
const handle = openDatabase(join(dbDir, 'creative.db'), { migrationsFolder });

try {
  const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
  await service.saveImageEngineSettings({
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    releaseMemoryAfterGeneration: true,
  });

  const results: Array<Record<string, unknown> & { id: string; profile: GenerationQualityProfileId; files?: RunFiles }> = [];
  for (const testCase of cases.filter((item) => !onlyCases || onlyCases.includes(item.id))) {
    for (const profile of profiles) {
      const label = `${testCase.id}-${profile}`;
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
          title: `Aethera CS9 acceptance — ${label}`,
          prompt: testCase.prompt,
          ...(testCase.headline ? { headline: testCase.headline } : {}),
          professionalPreset: testCase.preset,
          useAiGeneration: true,
          characterCount: testCase.characterCount,
          ...(testCase.characterDescriptions ? { characterDescriptions: testCase.characterDescriptions } : {}),
          qualityProfile: profile,
          spatialControl: 'auto',
          crowdSuppression: process.env.CS9_CROWD === 'on',
          seed: testCase.seed + seedOffset,
          maxAttempts: 1,
          ...(loraSpec && testCase.characterCount > 1 ? { loraMode: 'manual' as const, loras: [loraSpec] } : { loraMode: 'off' as const }),
        });
        const ms = Date.now() - started;
        const after = await vramMiB();
        if (after !== null && (vramPeakMiB === null || after > vramPeakMiB)) vramPeakMiB = after;
        const generatedAsset = Object.values(result.document.assetManifest).find((asset) => asset.originalName.startsWith('ai-gen-'));
        const generatedBuffer = generatedAsset
          ? await sharp(join(userDataDir, 'creative-studio', generatedAsset.relativePath)).png().toBuffer().catch(() => null)
          : null;
        const servedBy = result.generation.servedBy ?? null;
        const engineParameters = (result.generation.engineParameters ?? null) as {
          checkpoint?: string;
          spatialControl?: { mode: string };
          faceDetailer?: boolean;
        } | null;
        const servedByComfyUi = servedBy?.providerId === 'comfyui-native';
        const unrefined = profile === 'professional' && engineParameters?.faceDetailer ? service.comfyUiAdapter.getLastUnrefinedImage() : null;
        const files: RunFiles = {
          generated: save(`${label}.png`, generatedBuffer),
          unrefinedBase: save(`${testCase.id}-professional-base.png`, unrefined),
          composed: save(`${label}-composed.png`, dataUrlToBuffer(result.previewDataUrl)),
        };
        const spatialMode = engineParameters?.spatialControl?.mode ?? 'not_applicable';
        results.push({
          id: testCase.id,
          profile,
          // A chain fallback (e.g. local SDXL-Turbo) must never be reported as an Animagine/ComfyUI result.
          status: result.generation.status === 'generated' && !servedByComfyUi ? 'failed_wrong_provider' : result.generation.status,
          structuralStatus: result.generation.qualityAudit?.passed ? 'passed' : 'not_passed_or_unavailable',
          servedBy,
          fallbackUsed: !servedByComfyUi || (servedBy?.fallbackErrors?.length ?? 0) > 0,
          model: servedByComfyUi ? engineParameters?.checkpoint ?? null : null,
          workflow: spatialMode === 'openpose'
            ? 'aethera-regional-openpose'
            : spatialMode === 'area_only' ? 'aethera-regional-area' : 'aethera-single-pass',
          lora: loraSpec && testCase.characterCount > 1 ? loraSpec : null,
          crowdSuppression: result.generation.crowdSuppression ?? null,
          refinedWith: engineParameters?.faceDetailer ? 'faceDetailer' : 'none',
          refinement: result.generation.refinement ?? null,
          engineParameters,
          preset: testCase.preset,
          seed: testCase.seed + seedOffset,
          characterCount: testCase.characterCount,
          characterDescriptions: testCase.characterDescriptions ?? null,
          documentResolution: `${result.document.width}x${result.document.height}`,
          generatedResolution: result.generation.recipe ? `${result.generation.recipe.width}x${result.generation.recipe.height}` : null,
          ms,
          vramBeforeMiB,
          vramAfterMiB: after,
          vramPeakMiB,
          files,
          recipe: result.generation.recipe ?? null,
          documentAudit: { passed: result.audit.passed, findings: result.audit.findings },
        });
      } catch (error) {
        results.push({
          id: testCase.id,
          profile,
          status: 'failed',
          seed: testCase.seed,
          characterCount: testCase.characterCount,
          ms: Date.now() - started,
          vramBeforeMiB,
          vramPeakMiB,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearInterval(sampler);
      }
      const last = results.at(-1);
      console.log(`[cs9] ${label}: ${String(last?.status)} in ${String(last?.ms)} ms${last?.error ? ` — ${String(last.error)}` : ''}`);
    }
  }

  // Contact sheet: one row per case — preview | professional unrefined base | professional refined.
  const cellW = 640;
  const cellH = 360;
  const header = 40;
  const ids = [...new Set(results.map((result) => result.id))];
  const composites: sharp.OverlayOptions[] = [];
  const labelSvg = (text: string, width: number) =>
    Buffer.from(`<svg width="${width}" height="${header}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="27" font-family="Segoe UI, Arial" font-size="20" fill="#eee">${escapeXml(text)}</text></svg>`);
  const fileOf = (id: string, profile: GenerationQualityProfileId, key: keyof RunFiles) =>
    results.find((result) => result.id === id && result.profile === profile)?.files?.[key] ?? null;
  const columns: Array<{ title: string; pick: (id: string) => string | null }> = [
    { title: 'preview (basic)', pick: (id) => fileOf(id, 'preview', 'generated') },
    { title: 'professional base (same run, pre-FaceDetailer)', pick: (id) => fileOf(id, 'professional', 'unrefinedBase') },
    { title: 'professional (FaceDetailer + upscale)', pick: (id) => fileOf(id, 'professional', 'generated') },
  ];
  for (const [column, def] of columns.entries()) composites.push({ input: labelSvg(def.title, cellW), left: column * cellW, top: 0 });
  for (const [row, id] of ids.entries()) {
    const top = header + row * (cellH + header);
    composites.push({ input: labelSvg(`${id} — seed ${String(results.find((result) => result.id === id)?.seed)}`, cellW * 3), left: 0, top });
    for (const [column, def] of columns.entries()) {
      const path = def.pick(id);
      const tile = path
        ? await sharp(path).resize(cellW, cellH, { fit: 'contain', background: '#000' }).png().toBuffer()
        : await sharp({ create: { width: cellW, height: cellH, channels: 3, background: '#300' } }).png().toBuffer();
      composites.push({ input: tile, left: column * cellW, top: top + header });
    }
  }
  const sheetPath = join(runDir, 'contact-sheet-basic-vs-refined.png');
  await sharp({ create: { width: cellW * 3, height: header + ids.length * (cellH + header), channels: 3, background: '#000' } })
    .composite(composites)
    .png()
    .toFile(sheetPath);

  const allGenerated = results.every((result) => result.status === 'generated');
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    acceptanceStatus: allGenerated ? 'integration_pass_pending_human_visual_review' : 'failed',
    contactSheet: sheetPath,
    results,
    humanReview: {
      status: 'pending' as const,
      note: 'CS9 is not approved until the user reviews the images; automated checks are not a substitute.',
      criteria: ['requested character count', 'no relevant extra figures', 'distinguishable characters', 'no severe anatomical fusion', 'banner central safe area', 'refinement benefit'],
    },
    preservedRuns: ['root (canonical v1)', 'run-regional-v1/', 'run-crowd-negative-rejected/ (v2, rejected)', 'previous-run-fallback-2026-11-17T0025/'],
    limitations: [
      'The structural quality audit does not prove semantic fidelity or production aesthetics.',
      'Style LoRA mode is off. The user-authorized crowd-suppression slider is opt-in (CS9_CROWD=on / CS9_LORA) because it can erase the cast.',
      'OpenPose SDXL (thibaud) has an "other" license that still needs commercial review.',
    ],
  };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ runId, acceptanceStatus: report.acceptanceStatus, sheetPath }, null, 2));
  process.exitCode = allGenerated ? 0 : 1;
} finally {
  handle.close();
}
