export type CharacterAnchor = 'left' | 'center' | 'right' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right';

export interface CharacterRegion {
  id: string;
  index: number;
  role: 'primary' | 'supporting';
  anchor: CharacterAnchor;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MultiCharacterCompositionPlan {
  width: number;
  height: number;
  characterCount: number;
  layout: 'single' | 'duo' | 'trio' | 'staged' | 'edges';
  regions: CharacterRegion[];
}

export interface CharacterPlanValidation {
  ok: boolean;
  errors: string[];
}

export interface PlanCompositionInput {
  width: number;
  height: number;
  characterCount: number;
  /**
   * Area that must stay free of characters (e.g. the banner title safe area, in generation pixels). When given,
   * characters are split between the columns left and right of it.
   */
  keepOut?: { x: number; y: number; width: number; height: number };
}

interface Column {
  x0: number;
  x1: number;
  count: number;
}

/**
 * One column per character. Up to three characters stand on one line; from four on, alternate columns form a smaller,
 * higher back row so figures never share a column. Stacking two rows of half-height cells (the former grid) left
 * ~190 px per figure on a 768 px canvas and the figures fused (CS9 experiment, docs/comfyui-audit.md).
 */
function columnsRegions(columns: Column[], height: number, total: number, startIndex: number): CharacterRegion[] {
  const regions: CharacterRegion[] = [];
  let index = startIndex;
  const staged = total >= 4;
  for (const column of columns) {
    const gap = column.count > 1 ? (column.x1 - column.x0) * 0.01 : 0;
    const cell = (column.x1 - column.x0 - gap * (column.count - 1)) / column.count;
    for (let slot = 0; slot < column.count; slot += 1) {
      const back = staged && index % 2 === 1;
      const top = staged ? (back ? 0.12 : 0.26) : 0.08;
      const tall = staged ? (back ? 0.6 : 0.72) : 0.84;
      const x = column.x0 + slot * (cell + gap);
      regions.push({
        id: `character-region-${index + 1}`,
        index,
        role: index === 0 ? 'primary' : 'supporting',
        anchor: 'center',
        x: Math.round(x),
        y: Math.round(top * height),
        width: Math.round(cell),
        height: Math.round(tall * height),
      });
      index += 1;
    }
  }
  return regions;
}

function anchorForRegion(region: CharacterRegion, width: number, height: number, total: number): CharacterAnchor {
  const centerX = (region.x + region.width / 2) / width;
  if (total <= 3) return centerX < 0.34 ? 'left' : centerX > 0.66 ? 'right' : total === 2 ? (centerX < 0.5 ? 'left' : 'right') : 'center';
  const upper = (region.y + region.height / 2) / height < 0.45;
  if (upper) return centerX < 0.5 ? 'upper-left' : 'upper-right';
  return centerX < 0.5 ? 'lower-left' : 'lower-right';
}

export function planMultiCharacterComposition(input: PlanCompositionInput): MultiCharacterCompositionPlan {
  if (!Number.isInteger(input.characterCount) || input.characterCount < 1 || input.characterCount > 8) {
    throw new Error('Character count must be between 1 and 8.');
  }
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error('Composition dimensions must be positive integers.');
  }

  const count = input.characterCount;
  const marginX = 0.05 * input.width;
  let columns: Column[];
  let layout: MultiCharacterCompositionPlan['layout'];
  if (input.keepOut && count >= 2) {
    const leftEnd = input.keepOut.x - 0.01 * input.width;
    const rightStart = input.keepOut.x + input.keepOut.width + 0.01 * input.width;
    const edge = 0.02 * input.width;
    if (leftEnd - edge < 0.08 * input.width || input.width - edge - rightStart < 0.08 * input.width) {
      throw new Error('The keep-out area leaves no room for characters at the edges.');
    }
    const leftCount = Math.ceil(count / 2);
    columns = [
      { x0: edge, x1: leftEnd, count: leftCount },
      { x0: rightStart, x1: input.width - edge, count: count - leftCount },
    ];
    layout = 'edges';
  } else {
    columns = [{ x0: marginX, x1: input.width - marginX, count }];
    layout = count === 1 ? 'single' : count === 2 ? 'duo' : count === 3 ? 'trio' : 'staged';
  }
  const regions = columnsRegions(columns, input.height, count, 0).map((region) => ({
    ...region,
    anchor: anchorForRegion(region, input.width, input.height, count),
  }));
  return { width: input.width, height: input.height, characterCount: count, layout, regions };
}

export function validateCharacterRegions(plan: MultiCharacterCompositionPlan): CharacterPlanValidation {
  const errors: string[] = [];
  if (plan.regions.length !== plan.characterCount) errors.push(`Plan contains ${plan.regions.length} regions for ${plan.characterCount} characters.`);
  if (new Set(plan.regions.map((region) => region.id)).size !== plan.regions.length) errors.push('Character region IDs must be unique.');
  for (const region of plan.regions) {
    if (region.x < 0 || region.y < 0 || region.x + region.width > plan.width || region.y + region.height > plan.height) {
      errors.push(`${region.id} falls outside the canvas.`);
    }
    if (region.width <= 0 || region.height <= 0) errors.push(`${region.id} must have positive dimensions.`);
  }
  for (let left = 0; left < plan.regions.length; left += 1) {
    const a = plan.regions[left];
    if (!a) continue;
    for (let right = left + 1; right < plan.regions.length; right += 1) {
      const b = plan.regions[right];
      if (!b) continue;
      const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlap) errors.push(`${a.id} overlaps ${b.id}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function buildCharacterGenerationBrief(region: CharacterRegion, characterDescription: string): string {
  return `Generate one isolated character region at the ${region.anchor} of the composition: ${characterDescription}. ` +
    `Keep the full silhouette inside the ${region.width}x${region.height}px region, preserve clear separation from other characters, and leave the surrounding background transparent or calm for compositing.`;
}
