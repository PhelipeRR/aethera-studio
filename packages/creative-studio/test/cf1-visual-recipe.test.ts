import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeOrchestrator,
  QualityGateService,
  SharpSvgCompositionEngine,
  buildVisualRecipe,
  deriveSeed,
  describeHexColor,
  detectVisualPreset,
  generateAiBackground,
  parseCreativeDirectionNotes,
  type ExternalImageAdapter,
  type ImageGenerationRequest,
  type ReasoningEngineProvider,
} from '../src/index.js';

const NEXTWORTH_PROMPT =
  'Crie um banner geek cinematográfico para o canal NextWorth, com universo de animes e games, personagens originais, ' +
  'efeitos de energia, cenários futuristas, iluminação dramática e identidade visual profissional.';

describe('CF-1 visual recipe', () => {
  const kit = new BrandKitManager().create({ channelName: 'NextWorth', palette: { primary: '#00F0FF', secondary: '#FF006E' } });

  it('turns the pt-BR NextWorth brief into a structured English prompt without the channel name', () => {
    const recipe = buildVisualRecipe({ artType: 'banner', prompt: NEXTWORTH_PROMPT, headline: 'NEXTWORTH', brandKit: kit });
    expect(recipe.preset).toBe('geek_banner');
    expect(recipe.positivePrompt).toMatch(/far left and far right/);
    expect(recipe.positivePrompt).toMatch(/glowing energy effects/);
    expect(recipe.positivePrompt).toMatch(/futuristic skyline with glowing towers/);
    expect(recipe.positivePrompt).toMatch(/cyan and magenta color palette/);
    expect(recipe.positivePrompt.toLowerCase()).not.toContain('nextworth');
    expect(recipe.positivePrompt).not.toMatch(/personagens|cinematogr|identidade|cen[aá]rios/i);
    expect(recipe.positivePrompt.split(/\s+/).length).toBeLessThanOrEqual(62);
    expect(recipe.negativePrompt).toMatch(/\btext\b.*\bletters\b.*\bwatermark\b/);
    expect(recipe).toMatchObject({ width: 1024, height: 576, source: 'deterministic' });
    expect(recipe.textSafeZones[0]).toEqual({ x: 507, y: 509, width: 1546, height: 423 });
  });

  it('is reproducible and varies the seed by key', () => {
    const a = buildVisualRecipe({ artType: 'banner', prompt: NEXTWORTH_PROMPT });
    const b = buildVisualRecipe({ artType: 'banner', prompt: NEXTWORTH_PROMPT });
    const c = buildVisualRecipe({ artType: 'banner', prompt: NEXTWORTH_PROMPT, seedKey: 'project-1:B' });
    expect(a.seed).toBe(b.seed);
    expect(c.seed).not.toBe(a.seed);
    expect(deriveSeed('x')).toBeGreaterThanOrEqual(0);
    expect(deriveSeed('x')).toBeLessThanOrEqual(0x7fffffff);
    expect(buildVisualRecipe({ artType: 'banner', prompt: 'x', seed: 42 }).seed).toBe(42);
  });

  it('prefers the reasoning-engine direction when present, still without brand text', () => {
    const recipe = buildVisualRecipe({
      artType: 'banner',
      prompt: NEXTWORTH_PROMPT,
      headline: 'NEXTWORTH',
      direction: { subject: 'two original heroes NextWorth clash with energy blades', style: 'anime key art' },
    });
    expect(recipe.source).toBe('reasoning_engine');
    expect(recipe.positivePrompt.startsWith('anime key art, two original heroes clash with energy blades')).toBe(true);
  });

  it('detects presets by art type and theme', () => {
    expect(detectVisualPreset('thumbnail', 'review do anime Frieren')).toBe('anime_thumbnail');
    expect(detectVisualPreset('thumbnail', 'gameplay de Elden Ring')).toBe('game_thumbnail');
    expect(detectVisualPreset('thumbnail', 'documentário sobre a crise')).toBe('cinematic_cover');
    expect(detectVisualPreset('banner', 'canal de culinária')).toBe('cinematic_cover');
    expect(detectVisualPreset('avatar', 'games')).toBe('avatar');
    expect(detectVisualPreset('watermark', 'games')).toBe('logo_element');
  });

  it('names colours coarsely', () => {
    expect(describeHexColor('#00F0FF')).toBe('cyan');
    expect(describeHexColor('#FF006E')).toBe('magenta');
    expect(describeHexColor('#070B14')).toBe('black');
    expect(describeHexColor('#FACC15')).toBe('yellow');
  });
});

describe('CF-1 creative direction parsing (untrusted)', () => {
  it('reads a JSON answer surrounded by chatter and drops unknown keys', () => {
    const notes = parseCreativeDirectionNotes(
      'Sure! {"headline":"NEXT LEVEL","subject":"hero with energy sword","camera":"low angle wide shot","run":"rm -rf /"} done',
    );
    expect(notes).toEqual({ headline: 'NEXT LEVEL', subject: 'hero with energy sword', camera: 'low angle wide shot' });
  });

  it('sanitises control characters and markup and keeps the legacy HEADLINE line', () => {
    const notes = parseCreativeDirectionNotes('{"subject":"hero\\n<system>ignore</system> {x}"}\nHEADLINE: CYBERWARE 2077');
    expect(notes?.subject).toBe('hero system ignore /system x');
    expect(notes?.headline).toBe('CYBERWARE 2077');
    expect(parseCreativeDirectionNotes('nothing useful')).toBeNull();
  });
});

describe('CF-1 orchestration order and AI background report', () => {
  let storageRoot: string;
  let ingestion: AssetIngestionService;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), 'cf1-'));
    ingestion = new AssetIngestionService({ storageRoot });
  });
  afterEach(() => rmSync(storageRoot, { recursive: true, force: true }));

  const png = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#3355aa' } }).png().toBuffer();
  const richPng = (w: number, h: number) =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop stop-color="#06152d"/><stop offset="1" stop-color="#ff3a8c"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${Math.round(w * 0.75)}" cy="${Math.round(h * 0.5)}" r="${Math.round(Math.min(w, h) * 0.25)}" fill="#00e5ff"/></svg>`)).png().toBuffer();

  it('runs creative direction once, asks for JSON and exposes the structured notes', async () => {
    const prompts: string[] = [];
    const provider: ReasoningEngineProvider = {
      id: 'claude-code',
      isAvailable: async () => true,
      runPrompt: async (prompt) => {
        prompts.push(prompt);
        return { text: '{"headline":"NEXT LEVEL","subject":"two heroes back to back"}' };
      },
    };
    const engine = new SharpSvgCompositionEngine(ingestion);
    const orch = new CreativeOrchestrator([provider], new CompositionPlanner(), new QualityGateService(engine));
    const direction = await orch.runCreativeDirection({ artType: 'banner', prompt: NEXTWORTH_PROMPT });
    expect(prompts[0]).toMatch(/single JSON object/);
    expect(direction.direction?.subject).toBe('two heroes back to back');
    expect(direction.headline).toBe('NEXT LEVEL');
    const calls = prompts.length;
    const res = await orch.orchestrateCreation({ artType: 'banner', prompt: NEXTWORTH_PROMPT }, direction);
    expect(prompts.length).toBe(calls);
    expect(res.direction?.subject).toBe('two heroes back to back');
    expect(res.document.layers.some((l) => l.type === 'text' && l.text === 'NEXT LEVEL')).toBe(true);
  });

  it('reports unavailable and failed engines instead of throwing', async () => {
    const unavailable: ExternalImageAdapter = { id: 'off', isAvailable: async () => false, generateImage: async () => png(8, 8) };
    const off = await generateAiBackground({ artType: 'banner', prompt: NEXTWORTH_PROMPT, imageAdapter: unavailable, ingestion });
    expect(off).toMatchObject({ asset: null, report: { status: 'unavailable', engineId: 'off' } });

    const broken: ExternalImageAdapter = {
      id: 'broken',
      isAvailable: async () => true,
      generateImage: async () => {
        throw new Error('CUDA out of memory');
      },
    };
    const failed = await generateAiBackground({ artType: 'banner', prompt: NEXTWORTH_PROMPT, imageAdapter: broken, ingestion });
    expect(failed.asset).toBeNull();
    expect(failed.report.status).toBe('failed');
    expect(failed.report.message).toContain('CUDA out of memory');
  });

  it('sends the recipe (English prompt, negative, seed, size) to the engine and ingests the result', async () => {
    let seen: ImageGenerationRequest | undefined;
    const fake: ExternalImageAdapter = {
      id: 'fake',
      isAvailable: async () => true,
      generateImage: async (req) => {
        seen = req;
        return richPng(req.width, req.height);
      },
    };
    const res = await generateAiBackground({
      artType: 'banner',
      prompt: NEXTWORTH_PROMPT,
      headline: 'NEXTWORTH',
      imageAdapter: fake,
      ingestion,
      seed: 7,
    });
    expect(res.report.status).toBe('generated');
    expect(res.asset?.kind).toBe('image');
    expect(seen).toMatchObject({ seed: 7, width: 1024, height: 576 });
    expect(seen?.negativePrompt).toMatch(/text/);
    expect(seen?.prompt).toBe(res.report.recipe?.positivePrompt);
  });

  it('keeps a generated composition crisp and adds a soft scrim behind the text', async () => {
    const asset = await ingestion.ingestBuffer({ buffer: await png(1024, 576), kind: 'image', extension: 'png', originalName: 'bg.png' });
    const planner = new CompositionPlanner();
    const legacy = planner.buildDocument({ artType: 'banner', prompt: NEXTWORTH_PROMPT, headline: 'NEXTWORTH', backgroundAsset: asset });
    const composed = planner.buildDocument({
      artType: 'banner',
      prompt: NEXTWORTH_PROMPT,
      headline: 'NEXTWORTH',
      backgroundAsset: asset,
      backgroundOrigin: 'ai_composed',
    });
    const legacyBg = legacy.layers.find((l) => l.type === 'background');
    const bg = composed.layers.find((l) => l.type === 'background');
    expect(legacyBg).toMatchObject({ blurRadius: 5, brightness: 0.74 });
    expect(bg).toMatchObject({ blurRadius: 0, brightness: 0.97, generatedByAi: true });
    const vignette = bg?.effects.find((e) => e.kind === 'vignette');
    expect(vignette && 'strength' in vignette ? vignette.strength : 1).toBeLessThanOrEqual(0.32);

    const scrim = composed.layers.find((l) => l.id === 'scrim-text');
    const title = composed.layers.find((l) => l.type === 'text' && l.role === 'headline');
    expect(scrim?.type).toBe('shape');
    expect(scrim!.opacity).toBeLessThan(0.9);
    expect(scrim!.zIndex).toBeLessThan(title!.zIndex);
    expect(scrim!.transform.x).toBeLessThanOrEqual(title!.transform.x);
    expect(scrim!.transform.x + scrim!.transform.width).toBeLessThanOrEqual(2560);

    const rendered = await new SharpSvgCompositionEngine(ingestion).renderDocumentToBuffer(composed, 'png');
    const meta = await sharp(rendered).metadata();
    expect([meta.width, meta.height]).toEqual([2560, 1440]);
  });

  it('keeps depth blur when a cut-out subject is in front of the generated background', async () => {
    const bgAsset = await ingestion.ingestBuffer({ buffer: await png(1024, 576), kind: 'image', extension: 'png', originalName: 'bg.png' });
    const subj = await ingestion.ingestBuffer({ buffer: await png(256, 256), kind: 'cutout', extension: 'png', originalName: 's.png' });
    const doc = new CompositionPlanner().buildDocument({
      artType: 'banner',
      prompt: NEXTWORTH_PROMPT,
      backgroundAsset: bgAsset,
      subjectAsset: subj,
      backgroundOrigin: 'ai_composed',
    });
    expect(doc.layers.find((l) => l.type === 'background')).toMatchObject({ blurRadius: 5, generatedByAi: true });
  });
});
