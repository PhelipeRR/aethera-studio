import type { LoraStackItem } from './lora-catalog.js';

/**
 * Multi-character scenes on Animagine XL drift into extra background figures (pedestrians, silhouettes) even with one
 * OpenPose skeleton per character. The ntc-ai "photobombing" SDXL slider (MIT, 8.4 MB, SHA-256 505c1062…0b31,
 * https://huggingface.co/ntc-ai/SDXL-LoRA-slider.photobombing) applied with a NEGATIVE weight pushes away from that
 * concept. CS9 evidence: on seeds 31001/31002 it removed every extra figure, but on seed 31101 it erased the whole
 * cast (at −1.5 and again at UNet −1.0 / CLIP 0) and on 31102 an extra figure survived. It suppresses people in
 * general, so it is OPT-IN only (`crowdSuppression: true`), reported separately from the style LoRA selection, and
 * only runs when the file is installed.
 */
export const CROWD_SUPPRESSION_LORA: Readonly<Required<Pick<LoraStackItem, 'model' | 'strengthModel' | 'strengthClip'>>> = {
  model: 'ntc-sdxl-slider-photobombing.safetensors',
  strengthModel: -1.5,
  strengthClip: -1.5,
};

export interface CrowdSuppressionDecision {
  lora: LoraStackItem | null;
  reason: string;
}

export function resolveCrowdSuppression(characterCount: number | undefined, installedLoras: string[], enabled = false): CrowdSuppressionDecision {
  if (!enabled) return { lora: null, reason: 'opt-in control not requested' };
  if (!characterCount || characterCount < 2) return { lora: null, reason: 'single-character scene' };
  if (!installedLoras.includes(CROWD_SUPPRESSION_LORA.model)) {
    return { lora: null, reason: `${CROWD_SUPPRESSION_LORA.model} is not installed in ComfyUI` };
  }
  return { lora: { ...CROWD_SUPPRESSION_LORA }, reason: `${characterCount}-character scene: negative photobombing slider suppresses extra background figures` };
}
