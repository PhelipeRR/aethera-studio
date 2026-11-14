import { commonScript, DEFAULT_STYLE_CHOICE, videoStyle, validateStyleChoice, type ProductionStyleChoice } from '@neuralbridge/shared';
import { VELIX_DOSSIE_ID } from './velix-dossie.js';
import { appShowcase, brandSting, giantTextOver, kidsCaption, kineticExplainer, kineticType, podcastCuts, premiumCaption, talkingHeadOverlay, type StyleAdapterOptions } from './velix-style-adapters.js';
import { motionProjectFromScript, type MotionPreset } from './velix-motion-adapter.js';
import type { MotionProject } from '@neuralbridge/shared/motion';

/** `baseVideo` is set for layers: the engine renders them transparent and composes them over that filmed video. */
export interface StyleRender { styleId: string; template: string; data: string; engine?: 'kit-html' | 'remotion'; motionProject?: MotionProject; baseVideo?: string }

/** Kit templates fed by an adapter from the approved script. The Dossiê is not here: it reads the script as is. */
const ADAPTERS: Record<string, (script: ReturnType<typeof commonScript>, options: StyleAdapterOptions) => unknown> = {
  'kinetic-explainer': kineticExplainer,
  'texto-gigante': giantTextOver,
  'legenda-premium': premiumCaption,
  'legenda-infantil': kidsCaption,
  'overlay-talking-head': talkingHeadOverlay,
  'podcast-motion': podcastCuts,
  'lyric-kinetic': kineticType,
  'ui-showcase': appShowcase,
  'logo-reveal': (script, options) => brandSting(script, 'logo-reveal', options),
  'particulas-3d': (script, options) => brandSting(script, 'particulas-3d', options),
  'showreel-bauhaus': (script, options) => brandSting(script, 'showreel-bauhaus', options),
};

/** The style a piece renders with, without the whole-video rule (stings are rendered on their own for previews and mixing). */
export function renderStyle(styleId: string, dossieData: string, options: StyleAdapterOptions & { baseVideo?: string } = {}): StyleRender {
  const style = videoStyle(styleId);
  if (style.id === 'dossie') return { styleId: style.id, template: VELIX_DOSSIE_ID, data: dossieData };
  let parsed: unknown;
  try { parsed = JSON.parse(dossieData) as unknown; } catch { throw new Error('invalid: o roteiro não é um JSON válido.'); }
  if (style.kind === 'overlay' && !options.baseVideo) throw new Error(`invalid: ${style.label} precisa de um vídeo base.`);
  if (style.kind === 'overlay' && style.needs.footage && style.id !== 'texto-gigante' && !options.words?.length) throw new Error('invalid: transcreva o vídeo base antes; a camada usa as palavras faladas.');
  const common = commonScript(parsed);
  if (style.engine === 'remotion') {
    const project = motionProjectFromScript(common, { templateId: style.template as 'velix-base' | 'velix-editorial' | 'one-take', preset: (style.family === 'opuscar' ? style.id : style.id === 'one-take' ? 'one-take' : style.id === 'motion-cenas-editorial' ? 'editorial' : 'base') as MotionPreset });
    return { styleId: style.id, template: style.template, data: JSON.stringify(project), engine: 'remotion', motionProject: project };
  }
  const adapter = ADAPTERS[style.template];
  if (!adapter) throw new Error(`unavailable: o estilo ${style.label} ainda não tem render no app.`);
  const data = JSON.stringify(adapter(common, options));
  return style.kind === 'overlay' && options.baseVideo ? { styleId: style.id, template: style.template, data, engine: 'kit-html', baseVideo: options.baseVideo } : { styleId: style.id, template: style.template, data, engine: 'kit-html' };
}

/**
 * Turns the approved script (Dossiê JSON) into what the engine renders for the chosen style. No choice means the
 * Dossiê, with the data passed through untouched, so existing productions render exactly as before.
 */
export function resolveStyleRender(choice: ProductionStyleChoice | null, dossieData: string, options: StyleAdapterOptions = {}): StyleRender {
  const baseVideo = choice && typeof choice.options['baseVideo'] === 'string' ? choice.options['baseVideo'] : undefined;
  const resolved = choice ? validateStyleChoice(choice) : DEFAULT_STYLE_CHOICE;
  if (resolved.styleId === 'dossie' && resolved.treatmentId === 'colagem-jornal') {
    let parsed: unknown;
    try { parsed = JSON.parse(dossieData) as unknown; } catch { throw new Error('invalid: o roteiro não é um JSON válido.'); }
    const project = motionProjectFromScript(parsed, { templateId: 'velix-base', preset: 'colagem-jornal' });
    return { styleId: 'dossie', template: 'velix-base', data: JSON.stringify(project), engine: 'remotion', motionProject: project };
  }
  return renderStyle(resolved.styleId, dossieData, { ...options, ...(baseVideo ? { baseVideo } : {}), ...(typeof resolved.options['theme'] === 'string' ? { theme: resolved.options['theme'] } : {}), ...(typeof resolved.options['handle'] === 'string' ? { handle: resolved.options['handle'] } : {}) });
}
