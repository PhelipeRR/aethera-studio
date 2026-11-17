/**
 * Checkpoint-aware sampling profiles. Professional presets describe the creative intent; the checkpoint decides the
 * numeric envelope it was trained for. Values come from the official model cards where they publish them, and every
 * profile records whether its numbers are card-documented or a generic SDXL fallback.
 */

export type CheckpointFamily = 'animagine-xl-3' | 'illustrious-xl' | 'sdxl-generic';

export interface CheckpointSamplingProfile {
  family: CheckpointFamily;
  /** Where the numbers come from; `generic` means the model card does not publish them. */
  evidence: 'model_card' | 'generic_sdxl';
  source?: string;
  minSteps: number;
  maxSteps: number;
  cfgRange: [number, number];
  samplerName: string;
  scheduler: string;
  qualityPrefix: string;
  qualityNegative: string;
  /** Native training buckets (width x height). Generating below them letterboxes and shrinks subjects. */
  buckets: Array<[number, number]>;
}

const SDXL_BUCKETS: Array<[number, number]> = [
  [1024, 1024],
  [1152, 896],
  [896, 1152],
  [1216, 832],
  [832, 1216],
  [1344, 768],
  [768, 1344],
  [1536, 640],
  [640, 1536],
];

const PROFILES: Record<CheckpointFamily, CheckpointSamplingProfile> = {
  'animagine-xl-3': {
    family: 'animagine-xl-3',
    evidence: 'model_card',
    source: 'https://huggingface.co/cagliostrolab/animagine-xl-3.1',
    minSteps: 24,
    maxSteps: 30,
    cfgRange: [5, 7],
    samplerName: 'euler_ancestral',
    scheduler: 'normal',
    qualityPrefix: 'masterpiece, best quality, very aesthetic, absurdres',
    qualityNegative: 'nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digits, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry',
    buckets: SDXL_BUCKETS,
  },
  'illustrious-xl': {
    family: 'illustrious-xl',
    evidence: 'generic_sdxl',
    source: 'https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0',
    minSteps: 24,
    maxSteps: 30,
    cfgRange: [5, 7],
    samplerName: 'euler_ancestral',
    scheduler: 'normal',
    qualityPrefix: 'masterpiece, best quality',
    qualityNegative: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digits, worst quality, low quality, jpeg artifacts, signature, watermark, blurry',
    buckets: SDXL_BUCKETS,
  },
  'sdxl-generic': {
    family: 'sdxl-generic',
    evidence: 'generic_sdxl',
    // Unknown SDXL checkpoints may be distilled (Turbo/Lightning: 1-8 steps, CFG ~0-2): keep the preset numbers.
    minSteps: 1,
    maxSteps: 150,
    cfgRange: [0, 30],
    samplerName: 'dpmpp_2m',
    scheduler: 'karras',
    qualityPrefix: '',
    qualityNegative: '',
    buckets: SDXL_BUCKETS,
  },
};

export function resolveCheckpointProfile(checkpoint: string | undefined): CheckpointSamplingProfile {
  const name = (checkpoint ?? '').toLowerCase();
  if (/animagine[-_ ]?xl[-_ ]?3/.test(name)) return PROFILES['animagine-xl-3'];
  if (/illustrious/.test(name)) return PROFILES['illustrious-xl'];
  return PROFILES['sdxl-generic'];
}

/** Closest native SDXL bucket by aspect ratio (ties prefer the larger area). */
export function nearestSdxlBucket(width: number, height: number, buckets: Array<[number, number]> = SDXL_BUCKETS): { width: number; height: number } {
  const target = Math.log(width / height);
  let best = buckets[0] ?? [1024, 1024];
  for (const bucket of buckets) {
    const delta = Math.abs(Math.log(bucket[0] / bucket[1]) - target);
    const bestDelta = Math.abs(Math.log(best[0] / best[1]) - target);
    if (delta < bestDelta - 1e-9 || (Math.abs(delta - bestDelta) < 1e-9 && bucket[0] * bucket[1] > best[0] * best[1])) best = bucket;
  }
  return { width: best[0], height: best[1] };
}

export interface SamplingParameters {
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  prompt: string;
  negativePrompt: string;
}

export interface AppliedCheckpointProfile extends SamplingParameters {
  family: CheckpointFamily;
  evidence: CheckpointSamplingProfile['evidence'];
  adjustments: string[];
}

/**
 * Keeps the preset's creative choices but moves the numbers into the checkpoint's documented envelope. A preset
 * written for a fast/turbo path (10-14 steps, dpmpp_2m) is under-sampled on Animagine, which the card tunes for
 * Euler a below 30 steps.
 */
export function applyCheckpointProfile(params: SamplingParameters, profile: CheckpointSamplingProfile): AppliedCheckpointProfile {
  const adjustments: string[] = [];
  let steps = Math.round(params.steps);
  if (steps < profile.minSteps) {
    adjustments.push(`steps ${steps}→${profile.minSteps}`);
    steps = profile.minSteps;
  } else if (steps > profile.maxSteps) {
    adjustments.push(`steps ${steps}→${profile.maxSteps}`);
    steps = profile.maxSteps;
  }
  let cfg = params.cfg;
  const [minCfg, maxCfg] = profile.cfgRange;
  if (cfg < minCfg || cfg > maxCfg) {
    const next = Math.min(maxCfg, Math.max(minCfg, cfg));
    adjustments.push(`cfg ${cfg}→${next}`);
    cfg = next;
  }
  let samplerName = params.samplerName;
  let scheduler = params.scheduler;
  if (profile.evidence === 'model_card' || profile.family === 'illustrious-xl') {
    if (samplerName !== profile.samplerName) adjustments.push(`sampler ${samplerName}→${profile.samplerName}`);
    if (scheduler !== profile.scheduler) adjustments.push(`scheduler ${scheduler}→${profile.scheduler}`);
    samplerName = profile.samplerName;
    scheduler = profile.scheduler;
  }
  const hasPrefix = profile.qualityPrefix && !params.prompt.toLowerCase().includes(profile.qualityPrefix.split(',')[0]!.trim());
  const prompt = hasPrefix ? `${profile.qualityPrefix}, ${params.prompt}` : params.prompt;
  const negativePrompt = profile.qualityNegative && !params.negativePrompt.includes(profile.qualityNegative)
    ? [params.negativePrompt, profile.qualityNegative].filter(Boolean).join(', ')
    : params.negativePrompt;
  return { family: profile.family, evidence: profile.evidence, adjustments, steps, cfg, samplerName, scheduler, prompt, negativePrompt };
}
