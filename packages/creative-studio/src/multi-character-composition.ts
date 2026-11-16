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
  layout: 'single' | 'duo' | 'trio' | 'grid';
  regions: CharacterRegion[];
}

export interface CharacterPlanValidation {
  ok: boolean;
  errors: string[];
}

function anchorFor(centerX: number, centerY: number, columns: number): CharacterAnchor {
  if (columns === 2) return centerX < 0.5 ? 'left' : 'right';
  if (columns === 3) return centerX < 0.34 ? 'left' : centerX > 0.66 ? 'right' : 'center';
  if (centerY < 0.5) return centerX < 0.5 ? 'upper-left' : 'upper-right';
  return centerX < 0.5 ? 'lower-left' : 'lower-right';
}

export function planMultiCharacterComposition(input: { width: number; height: number; characterCount: number }): MultiCharacterCompositionPlan {
  if (!Number.isInteger(input.characterCount) || input.characterCount < 1 || input.characterCount > 8) {
    throw new Error('Character count must be between 1 and 8.');
  }
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error('Composition dimensions must be positive integers.');
  }

  const count = input.characterCount;
  const columns = count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : Math.ceil(Math.sqrt(count));
  const rows = count === 1 ? 1 : count === 2 || count === 3 ? 1 : Math.ceil(count / columns);
  const marginX = 0.05;
  const marginY = 0.08;
  const gapX = columns > 1 ? 0.035 : 0;
  const gapY = rows > 1 ? 0.045 : 0;
  const cellWidth = (1 - marginX * 2 - gapX * (columns - 1)) / columns;
  const cellHeight = (1 - marginY * 2 - gapY * (rows - 1)) / rows;
  const regions: CharacterRegion[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = marginX + column * (cellWidth + gapX);
    const y = marginY + row * (cellHeight + gapY);
    regions.push({
      id: `character-region-${index + 1}`,
      index,
      role: index === 0 ? 'primary' : 'supporting',
      anchor: anchorFor(x + cellWidth / 2, y + cellHeight / 2, columns),
      x: Math.round(x * input.width),
      y: Math.round(y * input.height),
      width: Math.round(cellWidth * input.width),
      height: Math.round(cellHeight * input.height),
    });
  }
  return {
    width: input.width,
    height: input.height,
    characterCount: count,
    layout: count === 1 ? 'single' : count === 2 ? 'duo' : count === 3 ? 'trio' : 'grid',
    regions,
  };
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
