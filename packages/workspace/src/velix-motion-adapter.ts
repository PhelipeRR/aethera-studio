import { commonScript, type CommonScript } from '@neuralbridge/shared/video-styles';
import { motionProjectSchema, type MotionProject, type MotionSceneV2 } from '@neuralbridge/shared/motion';

export type MotionPreset = 'base' | 'editorial' | 'one-take' | 'colagem-jornal' | 'swiss-motion-graphics' | 'whiteboard-explainer' | 'data-storytelling' | 'dark-tech-keynote' | 'caption-news' | 'halftone-dossier' | 'drawn-book' | 'drawn-watercolor';
export type MotionAdapterOptions = { templateId?: 'velix-base' | 'velix-editorial' | 'one-take'; preset?: MotionPreset; fps?: number; width?: number; height?: number };

const safe = (value: unknown, fallback: string) => (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value).replace(/[<>]/gu, '').trim().slice(0, 500) : fallback;
const frames = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

function sceneData(script: CommonScript, fps: number): MotionSceneV2[] {
  return script.scenes.map((scene, index) => {
    const durationInFrames = frames(Math.max(0.5, scene.end - scene.at), fps);
    const segment = { text: scene.blocks.map((block) => safe(block['texto'] ?? block['titulo'] ?? '', '')).filter(Boolean).join(' ').slice(0, 500) || safe(scene.chapter?.title, `Cena ${index + 1}`), startChar: 0, endChar: Math.max(1, scene.blocks.length) };
    const first = scene.blocks[0];
    const title = safe(scene.chapter?.title || first?.['titulo'] || first?.['texto'], `Cena ${index + 1}`);
    const source = safe(scene.source, 'Fonte não informada');
    const big = scene.blocks.find((block) => block.tipo === 'grande');
    if (big) return { id: scene.id, kind: 'title', text: title, subtitle: safe(big['texto'], ''), durationInFrames, transition: index ? 'fade' : 'cut', segment };
    const counter = scene.blocks.find((block) => block.tipo === 'contador');
    if (counter) return { id: scene.id, kind: 'stat', value: safe(counter['para'], '0'), label: safe(counter['rotulo'], title), source, durationInFrames, transition: index ? 'fade' : 'cut', segment };
    const photo = scene.blocks.find((block) => block.tipo === 'foto');
    if (photo) return { id: scene.id, kind: 'photo', assetRef: safe(photo['src'], 'assets/selecionar-foto'), caption: safe(photo['etiqueta'], title), motion: 'none', durationInFrames, transition: index ? 'fade' : 'cut', segment };
    const bars = scene.blocks.find((block) => block.tipo === 'barras');
    if (bars) {
      const raw = Array.isArray(bars['itens']) ? bars['itens'] : [];
      const items = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').slice(0, 8).map((item) => ({ label: safe(item['nome'], 'Item').slice(0, 40), value: Math.max(0, Number(item['valor']) || 0) }));
      return { id: scene.id, kind: 'bars', title: safe(bars['titulo'], title), source, items: items.length ? items : [{ label: 'Item', value: 0 }], durationInFrames, transition: index ? 'fade' : 'cut', segment };
    }
    return { id: scene.id, kind: 'card', heading: title, body: segment.text, durationInFrames, transition: index ? 'fade' : 'cut', segment };
  });
}

/** Pure seam from the approved Dossiê script to the Remotion contract. */
export function motionProjectFromScript(script: CommonScript | unknown, options: MotionAdapterOptions = {}): MotionProject {
  const source = 'scenes' in Object(script) ? script as CommonScript : commonScript(script);
  const fps = options.fps ?? 30;
  return motionProjectSchema.parse({ schemaVersion: 2, templateId: options.templateId ?? 'velix-base', templateVersion: 1, width: options.width ?? 1280, height: options.height ?? 720, fps, scenes: sceneData(source, fps), captions: [], style: { background: { kind: 'solid', color: '#000000' }, font: 'inter', accent: '#f97316', ...(options.preset ? { preset: options.preset } : {}) }, narration: null, licenses: [] });
}
