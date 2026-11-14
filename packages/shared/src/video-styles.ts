import { z } from 'zod';

/** Where a style comes from; the gallery groups by it and shows the license of the external ones. */
export const VIDEO_STYLE_FAMILIES = ['dossie', 'motionvelix', 'remotion', 'opuscar', 'onetake', 'drawn', 'generated'] as const;
/** The renderer a style runs on. Every style ends in the same FFmpeg/FFprobe step. */
export const VIDEO_STYLE_ENGINES = ['kit-html', 'remotion', 'canvas', 'provider'] as const;
export const MAX_STYLES_PER_VIDEO = 3;
export const VIDEO_TREATMENTS = ['colagem-jornal'] as const;
/** A whole narrated video, a short sting (opening/closing, used when mixing), or a transparent layer over filmed footage. */
export const VIDEO_STYLE_KINDS = ['video', 'vinheta', 'overlay'] as const;

const id = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u);
export const videoStyleSchema = z.strictObject({
  id,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  family: z.enum(VIDEO_STYLE_FAMILIES),
  kind: z.enum(VIDEO_STYLE_KINDS),
  engine: z.enum(VIDEO_STYLE_ENGINES),
  version: z.number().int().positive(),
  /** Template id inside the engine (for example the kit template rendered by the HTML worker). */
  template: z.string().trim().min(1).max(100),
  license: z.strictObject({ name: z.string().trim().min(1).max(80), source: z.string().trim().min(1).max(300), attribution: z.string().trim().max(300), noncommercial: z.boolean() }),
  /** What the style cannot do without; the gallery disables a style whose needs the project does not meet. */
  needs: z.strictObject({ narration: z.boolean(), footage: z.boolean(), faceVideo: z.boolean() }),
  formats: z.array(z.enum(['16:9', '9:16'])).min(1),
  webgl: z.boolean(),
  cost: z.enum(['free', 'paid']),
  recommendedFor: z.array(z.string().trim().min(1).max(40)).max(20),
  /** Treatments (finishes such as newspaper collage) this style exposes slots for. */
  treatments: z.array(id).max(20),
});
export type VideoStyle = z.infer<typeof videoStyleSchema>;
export const styleTreatmentSchema = z.strictObject({ id, label: z.string().trim().min(1).max(80), version: z.number().int().positive(), license: z.strictObject({ name: z.string().trim().min(1).max(80), source: z.string().trim().min(1).max(300), attribution: z.string().trim().max(300), noncommercial: z.boolean() }), compatibleWith: z.array(id).max(20), layers: z.array(z.enum(['background', 'texture', 'block-frame', 'headline', 'transition'])).min(1).max(5) });
export type StyleTreatment = z.infer<typeof styleTreatmentSchema>;
export const VIDEO_STYLE_TREATMENTS: readonly StyleTreatment[] = [styleTreatmentSchema.parse({ id: 'colagem-jornal', label: 'Colagem de jornal', version: 1, license: { name: 'NeuralBridge', source: 'packages/shared/src/video-styles.ts', attribution: '', noncommercial: false }, compatibleWith: ['dossie'], layers: ['background', 'texture', 'block-frame', 'headline', 'transition'] })];

/** The registry. The Dossiê is the default and the first entry; later sub-phases add the other families. */
const motionVelix = (file: string) => ({ name: 'MotionVelix (skill do usuário)', source: `~/.claude/skills/motionvelix/templates/${file}.html`, attribution: 'MotionVelix', noncommercial: false });
const none = { narration: false, footage: false, faceVideo: false };

/**
 * The registry. The Dossiê is the default. Every kit template is vertical (1080×1920, Shorts/Reels); the Motion
 * (Remotion) styles of 48.4 are the horizontal ones.
 */
export const VIDEO_STYLES: readonly VideoStyle[] = [
  {
    id: 'dossie', label: 'Dossiê com dados', description: 'Capítulos, números, gráficos, citações e fontes na tela: explica com evidência.', family: 'dossie', kind: 'video', engine: 'kit-html', version: 1, template: 'dossie',
    license: { name: 'NeuralBridge', source: 'packages/workspace/src/velix-dossie.ts', attribution: '', noncommercial: false },
    needs: none, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['notícia', 'educação', 'finanças', 'tecnologia', 'história', 'dados'], treatments: ['colagem-jornal'],
  },
  {
    id: 'explicativo', label: 'Explicativo animado', description: 'Frases curtas que entram no ritmo, contadores, listas e chips: explica rápido, estilo Reels.', family: 'motionvelix', kind: 'video', engine: 'kit-html', version: 1, template: 'kinetic-explainer',
    license: motionVelix('kinetic-explainer'), needs: none, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['tutorial', 'dicas', 'tecnologia', 'ia', 'negócios', 'produtividade', 'educação'], treatments: [],
  },
  {
    id: 'texto-gigante', label: 'Texto gigante', description: 'Uma palavra enorme por cena, com fundo transparente, para ficar atrás de quem fala no vídeo gravado.', family: 'motionvelix', kind: 'overlay', engine: 'kit-html', version: 1, template: 'texto-gigante',
    license: motionVelix('texto-gigante'), needs: { narration: false, footage: true, faceVideo: true }, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['motivação', 'frases', 'impacto', 'esporte', 'opinião'], treatments: [],
  },
  {
    id: 'tipografia-cinetica', label: 'Tipografia cinética', description: 'As palavras do roteiro aparecem no ritmo da fala, em blocos coloridos. Fica melhor com narração.', family: 'motionvelix', kind: 'video', engine: 'kit-html', version: 1, template: 'lyric-kinetic',
    license: motionVelix('lyric-kinetic'), needs: none, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['frases', 'música', 'motivação', 'podcast', 'poesia'], treatments: [],
  },
  {
    id: 'demonstracao-app', label: 'Demonstração de app', description: 'Telas do app inclinadas, toques e manchetes curtas. Vinheta de cerca de 3 s por tela.', family: 'motionvelix', kind: 'vinheta', engine: 'kit-html', version: 1, template: 'ui-showcase',
    license: motionVelix('ui-showcase'), needs: none, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['app', 'lançamento', 'produto', 'saas'], treatments: [],
  },
  {
    id: 'showreel', label: 'Showreel', description: 'Vinheta de abertura em loop (~12 s) com o nome do canal e os capítulos.', family: 'motionvelix', kind: 'vinheta', engine: 'kit-html', version: 1, template: 'showreel-bauhaus',
    license: motionVelix('showreel-bauhaus'), needs: none, formats: ['9:16', '16:9'], webgl: false, cost: 'free', recommendedFor: ['abertura', 'portfólio'], treatments: [],
  },
  {
    id: 'logo-reveal', label: 'Logo reveal', description: 'Revelação da marca por luz (~6 s), para abrir ou fechar o vídeo.', family: 'motionvelix', kind: 'vinheta', engine: 'kit-html', version: 1, template: 'logo-reveal',
    license: motionVelix('logo-reveal'), needs: none, formats: ['9:16', '16:9'], webgl: false, cost: 'free', recommendedFor: ['abertura', 'encerramento', 'marca'], treatments: [],
  },
  {
    id: 'particulas-3d', label: 'Partículas 3D', description: 'Esfera de partículas que vira a marca (~7 s). Usa WebGL.', family: 'motionvelix', kind: 'vinheta', engine: 'kit-html', version: 1, template: 'particulas-3d',
    license: motionVelix('particulas-3d'), needs: none, formats: ['9:16', '16:9'], webgl: true, cost: 'free', recommendedFor: ['abertura', 'tecnologia', 'marca'], treatments: [],
  },
  {
    id: 'legenda-premium', label: 'Legenda premium', description: 'Legenda dinâmica das palavras faladas, poucas por vez, com as palavras-chave sublinhadas. Sobre o seu vídeo gravado.', family: 'motionvelix', kind: 'overlay', engine: 'kit-html', version: 1, template: 'legenda-premium',
    license: motionVelix('legenda-premium'), needs: { narration: false, footage: true, faceVideo: false }, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['entrevista', 'opinião', 'vlog', 'corte'], treatments: [],
  },
  {
    id: 'legenda-infantil', label: 'Legenda infantil', description: 'Palavras fofas e coloridas, uma frase por linha, no ritmo da fala ou da música. Sobre o seu vídeo gravado.', family: 'motionvelix', kind: 'overlay', engine: 'kit-html', version: 1, template: 'legenda-infantil',
    license: motionVelix('legenda-infantil'), needs: { narration: false, footage: true, faceVideo: false }, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['infantil', 'kids', 'música', 'criança'], treatments: [],
  },
  {
    id: 'sobreposicao-fala', label: 'Sobreposição para quem fala', description: 'Manchete por capítulo, números em adesivos e legenda com palavra-chave por cima de quem fala para a câmera.', family: 'motionvelix', kind: 'overlay', engine: 'kit-html', version: 1, template: 'overlay-talking-head',
    license: motionVelix('overlay-talking-head'), needs: { narration: false, footage: true, faceVideo: true }, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['opinião', 'tutorial', 'notícia', 'negócios', 'vlog'], treatments: [],
  },
  {
    id: 'podcast-cortes', label: 'Podcast com cortes de motion', description: 'Cartelas de tela cheia nos momentos fortes do roteiro, entre trechos da conversa gravada, com legenda.', family: 'motionvelix', kind: 'overlay', engine: 'kit-html', version: 1, template: 'podcast-motion',
    license: motionVelix('podcast-motion'), needs: { narration: false, footage: true, faceVideo: false }, formats: ['9:16'], webgl: false, cost: 'free', recommendedFor: ['podcast', 'entrevista', 'conversa', 'corte'], treatments: [],
  },
  {
    id: 'motion-cenas-base', label: 'Motion em cenas', description: 'Cenas horizontais com títulos, números, cartões, fotos e gráficos, renderizadas pelo motor Remotion.', family: 'remotion', kind: 'video', engine: 'remotion', version: 1, template: 'velix-base',
    license: { name: 'NeuralBridge', source: 'apps/desktop/src/renderer/src/features/video/motion', attribution: '', noncommercial: false }, needs: none, formats: ['16:9'], webgl: false, cost: 'free', recommendedFor: ['motion', 'reels', 'tutorial', 'tecnologia', 'educação'], treatments: [],
  },
  {
    id: 'motion-cenas-editorial', label: 'Motion editorial', description: 'A mesma estrutura de cenas com composição editorial: faixa lateral, contraste e hierarquia mais marcada.', family: 'remotion', kind: 'video', engine: 'remotion', version: 1, template: 'velix-editorial',
    license: { name: 'NeuralBridge', source: 'apps/desktop/src/renderer/src/features/video/motion', attribution: '', noncommercial: false }, needs: none, formats: ['16:9'], webgl: false, cost: 'free', recommendedFor: ['notícia', 'documentário', 'opinião', 'dados'], treatments: [],
  },
  {
    id: 'one-take', label: 'One take', description: 'Plano-sequência contínuo com câmera que acompanha as batidas do roteiro, sem cortes secos.', family: 'onetake', kind: 'video', engine: 'remotion', version: 1, template: 'one-take',
    license: { name: 'PolyForm Noncommercial 1.0.0', source: 'feitangyuan/onetake', attribution: 'Porta NeuralBridge baseada em feitangyuan/onetake', noncommercial: true }, needs: none, formats: ['16:9'], webgl: false, cost: 'free', recommendedFor: ['produto', 'app', 'tutorial', 'storytelling'], treatments: [],
  },
  ...(['swiss-motion-graphics', 'whiteboard-explainer', 'data-storytelling', 'dark-tech-keynote', 'caption-news', 'halftone-dossier'] as const).map((id) => ({
    id, label: ({ 'swiss-motion-graphics': 'Swiss Motion Graphics', 'whiteboard-explainer': 'Whiteboard Explainer', 'data-storytelling': 'Data Storytelling', 'dark-tech-keynote': 'Dark Tech Keynote', 'caption-news': 'Caption News', 'halftone-dossier': 'Halftone Dossier' } as Record<string, string>)[id] ?? id,
    description: 'Estilo portado e congelado no NeuralBridge, sem download em tempo de execução.', family: 'opuscar' as const, kind: 'video' as const, engine: 'remotion' as const, version: 1, template: 'velix-base',
    license: { name: 'MIT', source: 'lemomo-ai/lemo-opuscar (porta congelada)', attribution: 'Lemo-opuscar; porta NeuralBridge', noncommercial: false }, needs: none, formats: ['16:9'] as const, webgl: false, cost: 'free' as const, recommendedFor: ['tecnologia', 'dados', 'notícia', 'educação', 'produto'], treatments: [],
  })),
  {
    id: 'drawn-book', label: 'Livro ilustrado', description: 'Animação desenhada local com papel, tinta e movimentos suaves de página.', family: 'drawn', kind: 'video', engine: 'remotion', version: 1, template: 'velix-base',
    license: { name: 'MIT', source: 'porta NeuralBridge; implementação nativa', attribution: '', noncommercial: false }, needs: none, formats: ['16:9'], webgl: false, cost: 'free', recommendedFor: ['história', 'educação', 'infantil', 'storytelling'], treatments: [],
  },
  {
    id: 'drawn-watercolor', label: 'Tinta e aquarela', description: 'Animação desenhada local com manchas de aquarela, grão e contornos de pincel.', family: 'drawn', kind: 'video', engine: 'remotion', version: 1, template: 'velix-base',
    license: { name: 'MIT', source: 'porta NeuralBridge; implementação nativa', attribution: '', noncommercial: false }, needs: none, formats: ['16:9'], webgl: false, cost: 'free', recommendedFor: ['arte', 'história', 'educação', 'cultura'], treatments: [],
  },
].map((style) => videoStyleSchema.parse(style));
/** Styles offered for a whole video; stings and overlays come in through mixing (48.6). */
export const wholeVideoStyles = (styles: readonly VideoStyle[]) => styles.filter((style) => style.kind === 'video');
/** With a filmed base video, the layers over it can also be chosen for the whole video. */
export const stylesForVideo = (styles: readonly VideoStyle[], hasBaseVideo: boolean) => styles.filter((style) => style.kind === 'video' || (hasBaseVideo && style.kind === 'overlay'));
export const DEFAULT_VIDEO_STYLE_ID = 'dossie';

export function videoStyle(styleId: string): VideoStyle {
  const style = VIDEO_STYLES.find((item) => item.id === styleId);
  if (!style) throw new Error(`invalid: estilo de vídeo desconhecido (${styleId}).`);
  return style;
}

const sceneChoice = z.strictObject({ styleId: id.optional(), treatmentId: id.nullable().optional() });
/** The style a production renders with: one style for the video, an optional treatment, and optional per-scene overrides. */
export const productionStyleChoiceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  styleId: id,
  styleVersion: z.number().int().positive(),
  treatmentId: id.nullable(),
  options: z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()])),
  scenes: z.record(z.string().max(60), sceneChoice).optional(),
});
export type ProductionStyleChoice = z.infer<typeof productionStyleChoiceSchema>;
export const DEFAULT_STYLE_CHOICE: ProductionStyleChoice = { schemaVersion: 1, styleId: DEFAULT_VIDEO_STYLE_ID, styleVersion: 1, treatmentId: null, options: {} };

/** Rejects a choice the registry cannot render: unknown style or treatment, a newer version than installed, too many styles. */
export function validateStyleChoice(value: unknown): ProductionStyleChoice {
  const choice = productionStyleChoiceSchema.parse(value);
  const base = videoStyle(choice.styleId);
  if (base.kind === 'vinheta') throw new Error(`invalid: ${base.label} é uma vinheta; use-a na abertura ou no encerramento, pela mistura de estilos.`);
  if (base.kind === 'overlay' && (typeof choice.options['baseVideo'] !== 'string' || !choice.options['baseVideo'].trim())) throw new Error(`invalid: ${base.label} é uma camada sobre vídeo gravado; escolha o vídeo base.`);
  if (choice.styleVersion > base.version) throw new Error(`invalid: o estilo ${base.label} v${choice.styleVersion} não está instalado (há a v${base.version}).`);
  const allows = (style: VideoStyle, treatment: string | null | undefined) => { if (treatment && !style.treatments.includes(treatment)) throw new Error(`invalid: o estilo ${style.label} não aceita o tratamento ${treatment}.`); };
  allows(base, choice.treatmentId);
  const used = new Set([base.id]);
  for (const scene of Object.values(choice.scenes ?? {})) {
    const style = scene.styleId ? videoStyle(scene.styleId) : base;
    allows(style, scene.treatmentId === undefined ? choice.treatmentId : scene.treatmentId);
    used.add(style.id);
  }
  if (used.size > MAX_STYLES_PER_VIDEO) throw new Error(`invalid: no máximo ${MAX_STYLES_PER_VIDEO} estilos por vídeo.`);
  return choice;
}

/** Styles whose `recommendedFor` words appear in the video's text (topic, niche, brief), best match first; ties keep registry order. */
export function recommendVideoStyles(styles: readonly VideoStyle[], text: string): string[] {
  const haystack = ` ${text.toLocaleLowerCase('pt-BR')} `;
  return styles
    .map((style, index) => ({ id: style.id, index, hits: style.recommendedFor.filter((word) => haystack.includes(word.toLocaleLowerCase('pt-BR'))).length }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((item) => item.id);
}

/** A Dossiê block as written in the approved script; adapters of other styles read these. */
export type DossieBlock = { tipo: string; at?: number } & Record<string, unknown>;
export interface CommonScene { id: string; index: number; at: number; end: number; chapter: { n: number | null; title: string; color: string | null } | null; source: string | null; blocks: DossieBlock[]; }
export interface CommonScript { series: string; footer: string; duration: number; scenes: CommonScene[]; }

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * The style-neutral reading of an approved script. In the production flow the approved script is the Dossiê JSON, so
 * every other style is an adapter from these scenes; nothing about the Dossiê changes.
 */
export function commonScript(data: unknown): CommonScript {
  const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = Array.isArray(root['cenas']) ? (root['cenas'] as unknown[]) : [];
  const duration = Math.max(0, num(root['duracao'], 0));
  const starts = raw.map((scene, index) => num((scene as Record<string, unknown> | null)?.['at'], index === 0 ? 0 : Number.NaN));
  const scenes = raw.map((value, index): CommonScene => {
    const scene = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const at = Number.isFinite(starts[index]) ? (starts[index] ?? 0) : 0;
    const next = starts.slice(index + 1).find((start) => Number.isFinite(start));
    const chapter = scene['capitulo'] && typeof scene['capitulo'] === 'object' ? scene['capitulo'] as Record<string, unknown> : null;
    return {
      id: `cena-${index + 1}`, index, at, end: Math.max(at, next ?? duration),
      chapter: chapter ? { n: typeof chapter['n'] === 'number' ? chapter['n'] : null, title: str(chapter['titulo']), color: typeof chapter['cor'] === 'string' ? chapter['cor'] : null } : null,
      source: typeof scene['fonte'] === 'string' && scene['fonte'].trim() ? scene['fonte'] : null,
      blocks: (Array.isArray(scene['blocos']) ? scene['blocos'] as unknown[] : []).filter((block): block is DossieBlock => !!block && typeof block === 'object' && typeof (block as { tipo?: unknown }).tipo === 'string'),
    };
  });
  return { series: str(root['serie']), footer: str(root['rodape']), duration, scenes };
}

export type StyleMixSegment = { fromScene: number; toScene: number; styleId: string; treatmentId: string | null; start: number; end: number };
export type StyleMixPlan = { segments: StyleMixSegment[]; transitions: Array<{ afterScene: number; kind: 'cut' | 'fade' | 'page-turn' }>; problems: string[] };

/** Groups adjacent scenes at the seam between the style contract and the eventual FFmpeg assembler. */
export function planStyleMix(script: CommonScript, choice: ProductionStyleChoice): StyleMixPlan {
  const problems: string[] = [];
  const base = videoStyle(choice.styleId);
  const treatmentFor = (scene: { treatmentId?: string | null | undefined }) => scene.treatmentId === undefined ? choice.treatmentId : scene.treatmentId;
  const rows = script.scenes.map((scene, index) => {
    const override = choice.scenes?.[scene.id];
    const style = videoStyle(override?.styleId ?? base.id);
    const treatmentId = treatmentFor(override ?? {});
    if (treatmentId && !style.treatments.includes(treatmentId)) problems.push(`A cena ${index + 1} não aceita o tratamento ${treatmentId}.`);
    if (style.kind === 'overlay' && style.needs.footage && !choice.options['baseVideo']) problems.push(`A cena ${index + 1} usa ${style.label}, mas não há vídeo base.`);
    return { index, scene, styleId: style.id, treatmentId };
  });
  const used = new Set([base.id, ...rows.map((row) => row.styleId)]);
  if (used.size > MAX_STYLES_PER_VIDEO) problems.push(`A mistura usa ${used.size} estilos; o limite é ${MAX_STYLES_PER_VIDEO}.`);
  const segments: StyleMixSegment[] = [];
  for (const row of rows) {
    const previous = segments.at(-1);
    if (previous && previous.styleId === row.styleId && previous.treatmentId === row.treatmentId) { previous.toScene = row.index; previous.end = row.scene.end; }
    else segments.push({ fromScene: row.index, toScene: row.index, styleId: row.styleId, treatmentId: row.treatmentId ?? null, start: row.scene.at, end: row.scene.end });
  }
  return { segments, transitions: segments.slice(1).map((segment) => ({ afterScene: segment.fromScene - 1, kind: segment.treatmentId === 'colagem-jornal' ? 'page-turn' as const : 'cut' as const })), problems };
}
