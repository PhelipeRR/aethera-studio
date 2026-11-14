import { AbsoluteFill, Easing, Img, interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { motionTimeline, type MotionCaption, type MotionProject, type MotionScene, type MotionSceneV2 } from '@neuralbridge/shared/motion';
type RenderScene = MotionScene | MotionSceneV2;

// Shared by the Player and by the render bundle, so no aliases here. Deterministic: everything derives from the frame.
const BASE_TOKENS = { background: '#102a2e', surface: '#123b40', text: '#f2f2f2', muted: '#a8d5d1', accent: '#34d399' };
const EDITORIAL_TOKENS = { background: '#f4efe5', surface: '#fffaf0', text: '#171717', muted: '#57534e', accent: '#b42318' };
const PRESET_TOKENS: Record<string, typeof BASE_TOKENS> = {
  'swiss-motion-graphics': { background: '#f5f5f0', surface: '#ffffff', text: '#101010', muted: '#525252', accent: '#e11d48' },
  'whiteboard-explainer': { background: '#fffdf6', surface: '#ffffff', text: '#17202a', muted: '#64748b', accent: '#2563eb' },
  'data-storytelling': { background: '#07111f', surface: '#10233d', text: '#e0f2fe', muted: '#93c5fd', accent: '#22d3ee' },
  'dark-tech-keynote': { background: '#09090b', surface: '#18181b', text: '#fafafa', muted: '#a1a1aa', accent: '#a78bfa' },
  'caption-news': { background: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#475569', accent: '#dc2626' },
  'halftone-dossier': { background: '#f3ead8', surface: '#fff8e8', text: '#201a16', muted: '#786b5f', accent: '#c2410c' },
  'colagem-jornal': { background: '#e9dfca', surface: '#fff8e8', text: '#201a16', muted: '#786b5f', accent: '#9a3412' },
  'drawn-book': { background: '#f4e7c5', surface: '#fff9e8', text: '#3f2d20', muted: '#806b58', accent: '#b45309' },
  'drawn-watercolor': { background: '#dbeafe', surface: '#eff6ff', text: '#1e293b', muted: '#64748b', accent: '#0f766e' },
};
const BASE_FONT = '"Segoe UI", Inter, system-ui, sans-serif';
const EDITORIAL_FONT = 'Georgia, "Times New Roman", serif';
const FADE_FRAMES = 8;
function projectBackground(project: MotionProject): React.CSSProperties {
  if (!('style' in project)) return { background: BASE_TOKENS.background };
  const background = project.style.background;
  if (background.kind === 'solid') return { background: background.color.toLowerCase() === '#000000' ? 'linear-gradient(135deg, #164e63, #0f766e, #1e3a8a)' : background.color };
  if (background.kind === 'gradient') return { background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` };
  return { background: BASE_TOKENS.background };
}
function sceneBackground(scene: RenderScene): React.CSSProperties {
  if (!('background' in scene) || !scene.background) return {};
  if (scene.background.kind === 'solid') return { background: scene.background.color };
  if (scene.background.kind === 'gradient') return { background: `linear-gradient(${scene.background.angle}deg, ${scene.background.from}, ${scene.background.to})` };
  return {};
}

function SceneBackdrop({ scene }: { scene: RenderScene }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, Math.max(1, scene.durationInFrames)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drift = Math.sin(frame / 48) * 0.8;
  if (!('background' in scene) || !scene.background || scene.background.kind !== 'image') {
    // The emergency fallback is still animated, so a long typography scene is not a frozen black card.
    return <AbsoluteFill style={{ opacity: 0.22, background: `linear-gradient(${135 + progress * 12}deg, #183b42, #102126, #24515a)`, backgroundSize: '180% 180%', backgroundPosition: `${35 + progress * 25}% ${25 + drift}%` }} />;
  }
  const scale = 1.02 + progress * 0.035;
  return <><AbsoluteFill style={{ overflow: 'hidden' }}><Img src={scene.background.assetRef} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translate(${drift}%, ${Math.cos(frame / 57) * 0.6}%)` }} /></AbsoluteFill><AbsoluteFill style={{ background: `rgba(0,0,0,${scene.background.dim})` }} /></>;
}

function useEntrance(still: boolean) {
  const frame = useCurrentFrame();
  const value = still ? 1 : interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return { opacity: value, transform: `translateY(${(1 - value) * 24}px)` };
}

function Fade({ scene, still, children }: { scene: RenderScene; still: boolean; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  if (scene.transition !== 'fade' || still) return <AbsoluteFill>{children}</AbsoluteFill>;
  const edge = Math.min(FADE_FRAMES, Math.floor(scene.durationInFrames / 2));
  const opacity = edge < 1 ? 1 : interpolate(frame, [0, edge, scene.durationInFrames - edge, scene.durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Bars({ scene, tokens, font }: { scene: Extract<MotionScene, { kind: 'bars' }>; tokens: typeof BASE_TOKENS; font: string }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const top = Math.max(...scene.items.map((item) => item.value), 1);
  const grow = interpolate(frame, [0, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: width * 0.04, fontWeight: 700, marginBottom: width * 0.03, fontFamily: font }}>{scene.title}</div>
      {scene.items.map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: width * 0.015, marginBottom: width * 0.012, fontSize: width * 0.022 }}>
          <div style={{ width: '24%', color: tokens.muted }}>{item.label}</div>
          <div style={{ flex: 1 }}><div style={{ height: width * 0.03, width: `${(item.value / top) * 100 * grow}%`, background: tokens.accent, borderRadius: 4 }} /></div>
          <div style={{ width: '12%', textAlign: 'right' }}>{item.value}</div>
        </div>
      ))}
      <div style={{ marginTop: width * 0.02, fontSize: width * 0.016, color: tokens.muted }}>Fonte: {scene.source}</div>
    </div>
  );
}

function Scene({ scene, editorial, oneTake, still }: { scene: RenderScene; editorial: boolean; oneTake: boolean; still: boolean }) {
  const style = useEntrance(still);
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tokens = editorial ? EDITORIAL_TOKENS : BASE_TOKENS;
  const font = editorial ? EDITORIAL_FONT : BASE_FONT;
  const camera = oneTake && !still ? { transform: `scale(${1 + Math.min(0.06, (frame / Math.max(1, scene.durationInFrames)) * 0.06)}) translate(${Math.sin(frame / 18) * 1.2}%, ${Math.cos(frame / 23) * 0.8}%)` } : {};
  const pad = { ...sceneBackground(scene), padding: `${height * (editorial ? 0.12 : 0.08)}px ${width * (editorial ? 0.1 : 0.08)}px`, color: tokens.text, fontFamily: font, ...camera, ...(editorial ? { borderLeft: `${width * 0.012}px solid ${tokens.accent}` } : {}) };
  if (scene.kind === 'stat') return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'center' }}><div style={style}><div style={{ fontSize: width * 0.12, fontWeight: 800, color: tokens.accent, lineHeight: 1 }}>{scene.value}</div><div style={{ marginTop: width * 0.015, fontSize: width * 0.032 }}>{scene.label}</div><div style={{ marginTop: width * 0.02, fontSize: width * 0.016, color: tokens.muted }}>Fonte: {scene.source}</div></div></AbsoluteFill></>;
  if (scene.kind === 'title') return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'center' }}><div style={style}><div style={{ fontSize: width * (editorial ? 0.082 : 0.07), fontWeight: 800, lineHeight: 1.1, letterSpacing: editorial ? '-0.02em' : undefined }}>{scene.text}</div>{scene.subtitle && <div style={{ marginTop: width * 0.02, fontSize: width * 0.03, color: tokens.accent }}>{scene.subtitle}</div>}</div></AbsoluteFill></>;
  if (scene.kind === 'lower-third') return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'flex-end' }}><div style={{ ...style, borderLeft: `${width * 0.008}px solid ${tokens.accent}`, paddingLeft: width * 0.02 }}><div style={{ fontSize: width * 0.04, fontWeight: 700 }}>{scene.name}</div>{scene.role && <div style={{ fontSize: width * 0.024, color: tokens.muted }}>{scene.role}</div>}</div></AbsoluteFill></>;
  if (scene.kind === 'card') return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'center' }}><div style={{ ...style, background: tokens.surface, borderRadius: editorial ? 0 : 16, border: editorial ? `${Math.max(1, width * 0.002)}px solid ${tokens.accent}` : undefined, padding: width * 0.04 }}><div style={{ fontSize: width * 0.042, fontWeight: 700, color: tokens.accent }}>{scene.heading}</div><div style={{ marginTop: width * 0.015, fontSize: width * 0.028, lineHeight: 1.35 }}>{scene.body}</div></div></AbsoluteFill></>;
  if (scene.kind === 'photo') return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'center', overflow: 'hidden' }}><Img src={scene.assetRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...(still ? {} : { transform: `scale(${1 + Math.min(0.08, (frame / Math.max(1, scene.durationInFrames)) * 0.08)})` }) }} /><AbsoluteFill style={{ background: editorial ? 'rgba(244,239,229,0.48)' : 'rgba(0,0,0,0.35)' }} /><div style={{ ...style, zIndex: 1, color: tokens.text }}>{scene.caption}</div></AbsoluteFill></>;
  return <><SceneBackdrop scene={scene} /><AbsoluteFill style={{ ...pad, justifyContent: 'center' }}><div style={style}><Bars scene={scene} tokens={tokens} font={font} /></div></AbsoluteFill></>;
}

function Captions({ captions }: { captions: readonly MotionCaption[] }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const now = (frame / fps) * 1000;
  const active = captions.find((caption) => now >= caption.startMs && now < caption.endMs);
  if (!active) return null;
  return <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: height * 0.09 }}><div style={{ maxWidth: '84%', textAlign: 'center', background: 'rgba(8,47,50,0.88)', color: BASE_TOKENS.text, fontFamily: BASE_FONT, fontWeight: 600, fontSize: width * 0.03, lineHeight: 1.25, padding: `${width * 0.008}px ${width * 0.016}px`, borderRadius: 8 }}>{active.text}</div></AbsoluteFill>;
}

export function MotionComposition({ project, reducedMotion = false }: { project: MotionProject; reducedMotion?: boolean }) {
  const editorial = project.templateId === 'velix-editorial';
  const oneTake = project.templateId === 'one-take';
  const preset = 'style' in project ? project.style.preset : undefined;
  const tokens = preset && PRESET_TOKENS[preset] ? PRESET_TOKENS[preset] : editorial ? EDITORIAL_TOKENS : BASE_TOKENS;
  const font = preset === 'whiteboard-explainer' || preset === 'drawn-book' || preset === 'drawn-watercolor' ? '"Comic Sans MS", "Segoe Print", cursive' : preset === 'dark-tech-keynote' || preset === 'data-storytelling' ? '"IBM Plex Mono", Consolas, monospace' : editorial ? EDITORIAL_FONT : BASE_FONT;
  return (
    <AbsoluteFill style={{ ...projectBackground(project), color: tokens.text, fontFamily: font, ...(preset && preset !== 'base' ? { background: tokens.background } : {}), ...(oneTake ? { color: '#ecfeff', background: '#102a2e' } : {}) }}>
      {preset === 'colagem-jornal' && <AbsoluteFill style={{ opacity: 0.15, backgroundImage: 'radial-gradient(#201a16 0.7px, transparent 0.7px)', backgroundSize: '5px 5px', pointerEvents: 'none' }} />}
      {preset === 'drawn-book' && <AbsoluteFill style={{ opacity: 0.12, backgroundImage: 'repeating-linear-gradient(0deg, rgba(120,80,40,0.3) 0 1px, transparent 1px 4px)', pointerEvents: 'none' }} />}
      {preset === 'drawn-watercolor' && <AbsoluteFill style={{ opacity: 0.2, backgroundImage: 'radial-gradient(circle at 20% 20%, #0f766e 0 10%, transparent 35%), radial-gradient(circle at 80% 70%, #60a5fa 0 8%, transparent 34%)', filter: 'blur(18px)', pointerEvents: 'none' }} />}
      {motionTimeline(project).map(({ scene, from }) => <Sequence key={scene.id} from={from} durationInFrames={scene.durationInFrames}><Fade scene={{ ...scene, transition: oneTake ? 'fade' : scene.transition }} still={reducedMotion}><Scene scene={scene} editorial={editorial || preset === 'caption-news' || preset === 'halftone-dossier' || preset === 'colagem-jornal'} oneTake={oneTake} still={reducedMotion} /></Fade></Sequence>)}
      <Captions captions={project.captions} />
    </AbsoluteFill>
  );
}
