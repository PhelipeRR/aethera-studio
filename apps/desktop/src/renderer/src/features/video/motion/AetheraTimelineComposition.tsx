import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { captionFontPx, diagramPropsSchema, kineticPropsSchema, panelClipPath, panelShapes, panelSpanAt, panelsPropsSchema, SUBJECT_LABEL_STYLE, wipeTransitionClipPath, type AetheraCompositionLayer, type AetheraTimelineCompositionProps, type WipeDirection } from '@neuralbridge/shared/aethera-timeline-composition';

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function keyframedValue(layer: AetheraCompositionLayer, property: 'scale' | 'x' | 'y' | 'opacity' | 'rotation', frame: number, fps: number, fallback: number): number {
  const values = layer.keyframes.filter((keyframe) => keyframe.property === property).sort((left, right) => left.atMs - right.atMs);
  if (!values.length) return fallback;
  const nowMs = frame * 1_000 / fps;
  if (nowMs <= (values[0]?.atMs ?? 0)) return values[0]?.value ?? fallback;
  const last = values.at(-1);
  if (last && nowMs >= last.atMs) return last.value;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const next = values[index];
    if (!previous || !next || nowMs > next.atMs) continue;
    return interpolate(nowMs, [previous.atMs, next.atMs], [previous.value, next.value], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }
  return fallback;
}

function layerStyle(layer: AetheraCompositionLayer, frame: number, fps: number): React.CSSProperties {
  const scale = keyframedValue(layer, 'scale', frame, fps, layer.transform.scale);
  const x = keyframedValue(layer, 'x', frame, fps, layer.transform.x);
  const y = keyframedValue(layer, 'y', frame, fps, layer.transform.y);
  const rotation = keyframedValue(layer, 'rotation', frame, fps, layer.transform.rotation);
  const opacity = keyframedValue(layer, 'opacity', frame, fps, 1);
  return { position: 'absolute', inset: 0, zIndex: layer.zIndex, transform: `translate(${x}%, ${y}%) scale(${scale}) rotate(${rotation}deg)`, opacity, transformOrigin: 'center center' };
}

function Media({ layer }: { layer: AetheraCompositionLayer }) {
  const { fps, width } = useVideoConfig();
  if (layer.source.kind !== 'media' || !layer.source.proxyPath) return <AbsoluteFill style={{ background: 'linear-gradient(135deg, #164e63, #0f766e, #1e3a8a)' }} />;
  const filter = mediaFilter(layer, width);
  // A blurred frame shows soft transparent edges; a small overscan keeps the backdrop full-bleed.
  return <AbsoluteFill style={{ overflow: 'hidden' }}><OffthreadVideo src={layer.source.proxyPath} startFrom={Math.max(0, Math.round(layer.source.inMs * fps / 1_000))} playbackRate={layer.source.speed} muted style={{ width: '100%', height: '100%', objectFit: layer.transform.fit, ...(filter ? { filter, transform: 'scale(1.1)' } : {}) }} /></AbsoluteFill>;
}

/** `blur`, `color`, and `color_grading` effects as a CSS filter, so Player and render draw the same pixels (D-AP-17 / SD-2.4). */
function mediaFilter(layer: AetheraCompositionLayer, width: number): string | null {
  const parts = layer.effects.flatMap((effect) => {
    if (effect.id === 'blur') return [`blur(${Math.round(number(effect.params['radius'], 12) * width / 1920)}px)`];
    if (effect.id === 'color') return [`brightness(${number(effect.params['brightness'], 1)})`, `saturate(${number(effect.params['saturation'], 1)})`];
    if (effect.id === 'color_grading') {
      return [
        `contrast(${number(effect.params['contrast'], 1.08)})`,
        `saturate(${number(effect.params['saturation'], 1.12)})`,
        `brightness(${number(effect.params['brightness'], 0.96)})`,
        `sepia(${number(effect.params['warmth'], 0.08)})`,
      ];
    }
    return [];
  });
  return parts.length ? parts.join(' ') : null;
}

/** SD-2.4 deterministic cinematic VFX overlay (particles, volumetric_light, optical_distortion). */
function VfxOverlay({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const hasParticles = layer.effects.some((e) => e.id === 'particles');
  const hasVolumetric = layer.effects.some((e) => e.id === 'volumetric_light');
  const hasOptical = layer.effects.some((e) => e.id === 'optical_distortion');
  if (!hasParticles && !hasVolumetric && !hasOptical) return null;

  const progress = frame / Math.max(1, fps);
  return <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
    {hasVolumetric ? <div style={{ position: 'absolute', inset: '-20%', background: 'radial-gradient(60% 50% at 30% 20%, rgba(212, 175, 55, 0.14) 0%, rgba(15, 118, 110, 0.06) 45%, transparent 75%)', transform: `translateX(${Math.sin(progress * 0.6) * 3}%)`, mixBlendMode: 'screen' }} /> : null}
    {hasOptical ? <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(85% 85% at 50% 50%, transparent 58%, rgba(2, 6, 12, 0.45) 100%)', boxShadow: 'inset 0 0 60px rgba(56, 189, 248, 0.08)' }} /> : null}
    {hasParticles ? <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: 0.45 }}>
      {Array.from({ length: 14 }, (_, idx) => {
        const seedX = ((idx * 173) % 100) / 100;
        const seedY = ((idx * 257) % 100) / 100;
        const cx = ((seedX + progress * (0.015 + (idx % 3) * 0.006)) % 1) * width;
        const cy = ((seedY - progress * (0.01 + (idx % 4) * 0.005) + 10) % 1) * height;
        const r = Math.max(1.5, (1.5 + (idx % 3)) * (width / 1920));
        return <circle key={idx} cx={cx} cy={cy} r={r} fill="rgba(226, 255, 248, 0.7)" />;
      })}
    </svg> : null}
  </AbsoluteFill>;
}

const DEPICTION_LABEL = { illustrative: 'Imagem ilustrativa', reconstruction: 'Reconstituição' } as const;

/** On-screen notice for footage a person marked as illustrative or reconstructed; real records get none. */
function DepictionBadge({ layer }: { layer: AetheraCompositionLayer }) {
  const { width, height } = useVideoConfig();
  if (layer.depiction !== 'illustrative' && layer.depiction !== 'reconstruction') return null;
  return <div style={{ position: 'absolute', top: height * 0.06, left: width * 0.05, padding: `${width * 0.004}px ${width * 0.009}px`, borderRadius: 6, background: 'rgba(6, 29, 27, 0.78)', color: '#e6fff7', fontFamily: '"Segoe UI", sans-serif', fontWeight: 600, fontSize: width * 0.0135, letterSpacing: '0.02em', textTransform: 'uppercase' }}>{DEPICTION_LABEL[layer.depiction]}</div>;
}

/**
 * Smart Director `panels`: independent panels, each clipped by its own polygon mask, revealed by a wipe at the moment its
 * word is spoken (times come from the plan, measured on the narration). A panel shows its subject's footage or, when the
 * plan declared a gap, a typographic identity — never another subject's image. Dividers draw in with the panel they open.
 */
function Panels({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'graphic') return null;
  const parsed = panelsPropsSchema.safeParse(layer.source.props);
  if (!parsed.success) return null;
  const { layout, panels, revealMs, corner } = parsed.data;
  const shapes = panelShapes(layout, panels.length, 0.14, corner ?? 'top-right');
  const nowMs = (frame * 1_000) / fps;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const progressOf = (at: number) => interpolate(nowMs, [at, at + revealMs], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 40%, #121a20 0%, #06080a 70%)' }}>
    {panels.map((panel, index) => {
      const shape = shapes[index];
      const progress = progressOf(panel.revealAtMs);
      if (!shape || progress <= 0) return null;
      // A slow settle after the wipe: the image arrives slightly closer and eases into place (no bounce, no spin).
      const settle = interpolate(nowMs, [panel.revealAtMs, panel.revealAtMs + revealMs * 2.5], [1.07, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
      // Text sits on the panel's visible span at its own height (not on the box, which runs past the frame and the slant).
      const labelY = 0.12;
      const labelSpan = panelSpanAt(shape, labelY);
      const identitySpan = panelSpanAt(shape, 0.42);
      return <AbsoluteFill key={`${index}-${panel.label ?? ''}`} style={{ clipPath: panelClipPath(shape, progress, layout) }}>
        <div style={{ position: 'absolute', left: `${shape.box.x * 100}%`, top: `${shape.box.y * 100}%`, width: `${shape.box.w * 100}%`, height: `${shape.box.h * 100}%`, overflow: 'hidden' }}>
          {panel.proxyPath
            ? <OffthreadVideo src={panel.proxyPath} startFrom={Math.max(0, Math.round(((panel.inMs ?? 0) * fps) / 1_000))} muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${settle})` }} />
            : <AbsoluteFill style={{ background: `linear-gradient(160deg, ${panel.accent}55 0%, #0b0f12 55%, #050607 100%)`, transform: `scale(${settle})` }} />}
          {/* A soft shade under the label and the captions keeps text readable over any footage. */}
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.55) 100%)' }} />
        </div>
        {/* A typographic identity (declared gap): the name fits inside the visible span, wrapping instead of crossing an edge. */}
        {!panel.proxyPath && panel.label ? <div style={{ position: 'absolute', left: `${identitySpan.center * 100}%`, top: '42%', width: `${identitySpan.width * 0.8 * 100}%`, transform: 'translate(-50%, -50%)', color: '#f8fafc', fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 800, fontSize: Math.round(Math.min(height * 0.06, (identitySpan.width * width * 0.8) / Math.max(4, Math.max(...panel.label.split(' ').map((part) => part.length)) * 0.6))), lineHeight: 1.05, textAlign: 'center', letterSpacing: '-0.01em' }}>{panel.label}</div> : null}
        {panel.label && panel.proxyPath ? <div style={{ position: 'absolute', left: `${labelSpan.center * 100}%`, top: `${labelY * 100}%`, width: `${labelSpan.width * 0.86 * 100}%`, transform: 'translate(-50%, -50%)', color: '#f8fafc', fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 700, fontSize: Math.round(height * 0.028), lineHeight: 1.15, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center', textShadow: '0 2px 10px rgba(0,0,0,0.9)', opacity: progress }}>{panel.label}</div> : null}
      </AbsoluteFill>;
    })}
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      {layout === 'pip' ? panels.slice(1).map((panel, offset) => {
        // The inset of a picture-in-picture: a thin frame that draws in with it, so it reads as a separate image.
        const shape = shapes[offset + 1];
        const progress = progressOf(panel.revealAtMs);
        if (!shape || progress <= 0) return null;
        return <rect key={offset} x={shape.box.x * width} y={shape.box.y * height} width={shape.box.w * width * progress} height={shape.box.h * height} fill="none" stroke="rgba(248,250,252,0.85)" strokeWidth={Math.max(2, Math.round(width * 0.0016))} style={{ filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.6))' }} />;
      }) : null}
      {layout !== 'grid' && layout !== 'pip' ? panels.slice(1).map((panel, offset) => {
        const shape = shapes[offset + 1];
        const progress = progressOf(panel.revealAtMs);
        if (!shape || progress <= 0) return null;
        const [top, , , bottom] = shape.points;
        if (!top || !bottom) return null;
        const x1 = top[0] * width; const y1 = top[1] * height; const x2 = bottom[0] * width; const y2 = bottom[1] * height;
        // The divider draws from the top along the edge as the panel opens.
        return <line key={offset} x1={x1} y1={y1} x2={x1 + (x2 - x1) * progress} y2={y1 + (y2 - y1) * progress} stroke={panel.accent} strokeWidth={Math.max(2, Math.round(width * 0.0018))} style={{ filter: `drop-shadow(0 0 ${Math.round(width * 0.004)}px ${panel.accent})` }} />;
      }) : null}
    </svg>
  </AbsoluteFill>;
}

/** Vertical position of added text, from the planner's calm-zone choice (SD-2). */
const placementStyle = (placement: unknown, height: number): React.CSSProperties => placement === 'upper'
  ? { justifyContent: 'flex-start', paddingTop: Math.round(height * 0.1) }
  : placement === 'lower' ? { justifyContent: 'flex-end', paddingBottom: Math.round(height * 0.24) } : { justifyContent: 'center' };

function Graphic({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'graphic') return null;
  const props = layer.source.props;
  const title = text(props['title'] ?? props['heading'], '');
  const body = text(props['body'] ?? props['subtitle'], '');
  // A list (comparison card): one item per line, never a name broken across lines.
  const items = Array.isArray(props['items']) ? props['items'].filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  // No placeholder text: a graphic without copy leaves the footage (or the background) and the captions on screen.
  if (!title && !body && !items.length) return null;
  const nowMs = (frame * 1_000) / fps;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  // Lines revealed on the director's words (SD-2); without anchors they are all there from the start.
  const reveals = Array.isArray(props['itemRevealMs']) ? props['itemRevealMs'] as number[] : [];
  const lineIn = (index: number) => { const at = reveals[index] ?? 0; return interpolate(nowMs, [at, at + 380], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }); };
  // The box arrives with its first line, never as an empty frame waiting for the words (SD-2 review).
  const firstLineMs = reveals.length ? Math.min(...reveals) : 0;
  const boxIn = interpolate(nowMs, [firstLineMs, firstLineMs + 260], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return <AbsoluteFill style={{ ...placementStyle(props['placement'], height), paddingLeft: width * 0.08, paddingRight: width * 0.08, color: '#f0fdfa', fontFamily: '"Segoe UI", sans-serif' }}><div style={{ alignSelf: 'flex-start', maxWidth: '78%', background: 'rgba(8, 20, 24, 0.72)', borderLeft: `${Math.max(6, width * 0.006)}px solid #34d399`, borderRadius: 12, padding: `${width * 0.022}px ${width * 0.03}px`, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', opacity: boxIn, transform: `translateY(${(1 - boxIn) * 12}px)` }}>
    {title && <div style={{ fontSize: width * 0.05, fontWeight: 800, lineHeight: 1.1, opacity: lineIn(0), transform: `translateY(${(1 - lineIn(0)) * 18}px)` }}>{title}</div>}
    {items.map((item, index) => <div key={item} style={{ fontSize: width * 0.04, fontWeight: 800, lineHeight: 1.25, marginTop: index || title ? height * 0.01 : 0, whiteSpace: 'nowrap', opacity: lineIn(index), transform: `translateY(${(1 - lineIn(index)) * 18}px)` }}>{item}</div>)}
    {body && <div style={{ marginTop: height * 0.02, fontSize: width * 0.026, color: '#ccfbf1' }}>{body}</div>}
  </div></AbsoluteFill>;
}

/**
 * Smart Director `kinetic`: the director's emphasised words, each rising out of a mask on its pronunciation and leaving
 * when the next is said — emphasis in the rhythm of the speech, in the calm third of the shot.
 */
function Kinetic({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'graphic') return null;
  const parsed = kineticPropsSchema.safeParse(layer.source.props);
  if (!parsed.success) return null;
  const nowMs = (frame * 1_000) / fps;
  const word = parsed.data.words.find((item) => nowMs >= item.atMs && nowMs < item.untilMs);
  if (!word) return null;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const rise = interpolate(nowMs, [word.atMs, word.atMs + 360], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const leave = interpolate(nowMs, [word.untilMs - 220, word.untilMs], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const fontSize = Math.round(Math.min(height * 0.13, (width * 0.8) / Math.max(4, word.text.length * 0.56)));
  return <AbsoluteFill style={{ ...placementStyle(parsed.data.placement, height), alignItems: 'center', pointerEvents: 'none' }}>
    {/* The mask: the word rises from below a fixed line, so only the part above it shows. */}
    <div style={{ overflow: 'hidden', padding: `${Math.round(fontSize * 0.08)}px ${Math.round(fontSize * 0.2)}px` }}>
      <div style={{ color: '#ffffff', fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 900, fontSize, lineHeight: 1, letterSpacing: '-0.03em', textTransform: 'uppercase', transform: `translateY(${rise * 105}%)`, opacity: leave, textShadow: '0 6px 30px rgba(0,0,0,0.75)' }}>{word.text}</div>
    </div>
  </AbsoluteFill>;
}

/**
 * Smart Director `diagram` (SD-2.1): the director's elements, each entering on the word that brings it in, and the
 * relations between them drawing once both ends are on screen. It sits over the shot, darkened and blurred so the
 * diagram reads, inside the area above the captions; an explanatory drawing is marked as illustration.
 */
function Diagram({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'graphic') return null;
  const parsed = diagramPropsSchema.safeParse(layer.source.props);
  if (!parsed.success) return null;
  const { nodes, links, layout, illustrative } = parsed.data;
  const nowMs = (frame * 1_000) / fps;
  const ease = Easing.bezier(0.22, 1, 0.36, 1);
  const progress = (atMs: number, spanMs: number) => interpolate(nowMs, [atMs, atMs + spanMs], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  // The area above the captions' band, inside the safe margins.
  const area = { left: width * 0.08, top: height * 0.12, width: width * 0.84, height: height * 0.58 };
  // The diagram is the subject of the shot: its labels read at a glance on a phone (SD-2.1 review). Font size fits both
  // dimensions so vertical videos don't get oversized text and horizontal ones don't shrink it (SD-2.1 review: 9:16 had
  // labels taller than their boxes, 16:9 had labels too small to read).
  const fontSize = Math.round(Math.min(height * 0.038, width * 0.034, area.height * 0.07));
  const padX = fontSize * 0.85;
  const padY = fontSize * 0.5;
  // Box width is the real rendered width of the label (measured, not guessed), capped so a long name doesn't eat the
  // whole row. Height follows the actual line count.
  const boxes = nodes.map((node) => {
    const maxTextWidth = Math.min(area.width * 0.28, width * 0.22);
    const textWidth = Math.min(maxTextWidth, node.label.length * fontSize * 0.58 + padX * 0.4);
    const lines = Math.max(1, Math.ceil((node.label.length * fontSize * 0.58) / Math.max(1, maxTextWidth - padX)));
    return { cx: area.left + node.x * area.width, cy: area.top + node.y * area.height, halfW: textWidth / 2 + padX, halfH: (lines * fontSize * 1.18) / 2 + padY, maxTextWidth };
  });
  // Boxes on one row are laid out by their real widths with a gap wide enough for the arrow head, centred where the
  // layout put the row (SD-2.1 review: positions alone made long labels touch and hid the arrows between them).
  const rows = new Map<number, number[]>();
  boxes.forEach((box, index) => { const key = Math.round(box.cy / Math.max(1, fontSize * 0.6)); rows.set(key, [...(rows.get(key) ?? []), index]); });
  for (const members of rows.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => (boxes[a]?.cx ?? 0) - (boxes[b]?.cx ?? 0));
    const totalBoxWidth = ordered.reduce((sum, index) => sum + (boxes[index]?.halfW ?? 0) * 2, 0);
    // Gap must clear the arrow head (width * 0.008 + margin) so the link never sits under a box edge.
    const minGap = Math.max(width * 0.032, fontSize * 1.6);
    const available = area.width * 0.96;
    const gap = totalBoxWidth + minGap * (ordered.length - 1) <= available
      ? Math.max(minGap, (available - totalBoxWidth) / (ordered.length - 1))
      : minGap;
    const totalSpan = totalBoxWidth + gap * (ordered.length - 1);
    const startX = area.left + (area.width - totalSpan) / 2;
    let x = startX;
    for (const index of ordered) { const box = boxes[index]; if (!box) continue; box.cx = x + box.halfW; x += box.halfW * 2 + gap; }
  }
  // A link runs between the edges of the two boxes, not their centres.
  const edge = (from: (typeof boxes)[number], to: (typeof boxes)[number]) => {
    const dx = to.cx - from.cx; const dy = to.cy - from.cy;
    const cut = (box: (typeof boxes)[number]) => Math.min(dx === 0 ? Infinity : box.halfW / Math.abs(dx), dy === 0 ? Infinity : box.halfH / Math.abs(dy));
    const a = cut(from) + 0.02; const b = 1 - cut(to) - 0.02;
    return { x1: from.cx + dx * a, y1: from.cy + dy * a, x2: from.cx + dx * b, y2: from.cy + dy * b };
  };
  const scrim = progress(0, 420);
  const accent = '#34d399';
  const firstRight = layout === 'contrast' ? nodes[Math.ceil(nodes.length / 2)]?.atMs ?? null : null;
  return <AbsoluteFill style={{ pointerEvents: 'none' }}>
    <AbsoluteFill style={{ backdropFilter: `blur(${Math.round(18 * scrim * width / 1920)}px) brightness(${1 - 0.58 * scrim}) saturate(${1 - 0.3 * scrim})`, background: `rgba(4, 14, 18, ${0.28 * scrim})` }} />
    {illustrative ? <div style={{ position: 'absolute', top: height * 0.045, left: width * 0.05, padding: `${width * 0.004}px ${width * 0.009}px`, borderRadius: 6, background: 'rgba(6, 29, 27, 0.78)', color: '#e6fff7', fontFamily: '"Segoe UI", sans-serif', fontWeight: 600, fontSize: width * 0.0125, letterSpacing: '0.02em', textTransform: 'uppercase', opacity: scrim }}>Esquema ilustrativo</div> : null}
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      {firstRight !== null ? (() => { const p = progress(firstRight, 500); const x = area.left + area.width / 2; return <line x1={x} y1={area.top} x2={x} y2={area.top + area.height * p} stroke="rgba(230, 255, 247, 0.35)" strokeWidth={Math.max(2, width * 0.0012)} />; })() : null}
      {links.map((link, index) => {
        const from = boxes[link.from]; const to = boxes[link.to];
        if (!from || !to) return null;
        const { x1, y1, x2, y2 } = edge(from, to);
        const length = Math.hypot(x2 - x1, y2 - y1);
        const p = progress(link.atMs, 520);
        if (p <= 0) return null;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.max(10, width * 0.008);
        const tip = { x: x1 + (x2 - x1) * p, y: y1 + (y2 - y1) * p };
        return <g key={index}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth={Math.max(3, width * 0.0019)} strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - p)} />
          <polygon points={`${tip.x},${tip.y} ${tip.x - head * Math.cos(angle - 0.45)},${tip.y - head * Math.sin(angle - 0.45)} ${tip.x - head * Math.cos(angle + 0.45)},${tip.y - head * Math.sin(angle + 0.45)}`} fill={accent} opacity={p} />
          {link.label ? <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - fontSize * 0.45} textAnchor="middle" fill="#d1fae5" fontFamily='"Segoe UI", sans-serif' fontWeight={600} fontSize={Math.round(fontSize * 0.7)} opacity={progress(link.atMs + 260, 300)} style={{ paintOrder: 'stroke', stroke: 'rgba(4, 14, 18, 0.85)', strokeWidth: 6 }}>{link.label}</text> : null}
        </g>;
      })}
    </svg>
    {nodes.map((node, index) => {
      const box = boxes[index];
      const p = progress(node.atMs, 380);
      if (!box || p <= 0) return null;
      return <div key={index} style={{ position: 'absolute', left: box.cx, top: box.cy, transform: `translate(-50%, -50%) translateY(${(1 - p) * 14}px) scale(${0.9 + 0.1 * p})`, opacity: p, maxWidth: box.halfW * 2, padding: `${padY}px ${padX}px`, borderRadius: 14, background: 'rgba(8, 20, 24, 0.86)', border: `${Math.max(2, width * 0.0014)}px solid ${accent}`, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', color: '#f0fdfa', fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 700, fontSize, lineHeight: 1.18, textAlign: 'center' }}>{node.label}</div>;
    })}
  </AbsoluteFill>;
}

/**
 * The name of the subject at the start of a shot whose subject changed: a small, quiet tag fading in and out —
 * identification, not decoration. It sits in the caption band, just beyond two caption lines: that band is the one the
 * shot selection already cleared of burned-in text, while a fixed corner would land on a game's HUD or a logo.
 */
function SubjectLabel({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'text' || !layer.source.text) return null;
  const fade = Math.round(fps * 0.3);
  const opacity = interpolate(frame, [0, fade, Math.max(fade + 1, layer.durationInFrames - fade), layer.durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const top = layer.source.captionPlacement === 'top';
  // Same edge padding as the captions, plus two caption lines and a small gap.
  const offset = Math.round(height * 0.07 + captionFontPx({ width, height }) * 1.22 * 2 + height * 0.015);
  return <AbsoluteFill style={{ justifyContent: top ? 'flex-start' : 'flex-end', alignItems: 'center', padding: top ? `${offset}px 0 0` : `0 0 ${offset}px`, pointerEvents: 'none', opacity }}>
    <div style={{ color: '#f8fafc', background: 'rgba(10, 12, 14, 0.55)', borderRadius: 4, padding: `${Math.round(height * 0.006)}px ${Math.round(width * 0.008)}px`, fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 600, fontSize: Math.round(height * 0.026), letterSpacing: '0.04em', textTransform: 'uppercase' }}>{layer.source.text}</div>
  </AbsoluteFill>;
}

function TextLayer({ layer }: { layer: AetheraCompositionLayer }) {
  const { width } = useVideoConfig();
  if (layer.source.kind !== 'text') return null;
  if (layer.source.styleId === SUBJECT_LABEL_STYLE) return <SubjectLabel layer={layer} />;
  const label = layer.source.text;
  if (!label) return null;
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: width * 0.08, pointerEvents: 'none' }}><div style={{ maxWidth: '84%', color: '#f8fafc', background: 'rgba(15, 118, 110, 0.82)', borderRadius: 10, padding: `${width * 0.008}px ${width * 0.016}px`, fontFamily: '"Segoe UI", sans-serif', fontWeight: 700, fontSize: width * 0.04, textAlign: 'center' }}>{label}</div></AbsoluteFill>;
}

/**
 * E3: the caption on screen is only the reading cue of this instant (built from the measured words), light text with a
 * soft shadow and no box; between cues nothing is drawn, never the scene's paragraph. The size depends on the frame only,
 * so it does not jump from one cue to the next.
 */
function CaptionLayer({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (layer.source.kind !== 'text') return null;
  const nowMs = frame * 1_000 / fps;
  const cue = layer.cues?.find((item) => nowMs >= item.startMs && nowMs < item.endMs);
  if (!cue) return null;
  // Same size the cue builder fitted the lines for (5.4% of the height in 16:9): two lines always fit the safe width.
  const fontSize = captionFontPx({ width, height });
  const top = layer.source.captionPlacement === 'top';
  return <AbsoluteFill style={{ justifyContent: top ? 'flex-start' : 'flex-end', alignItems: 'center', padding: `${Math.round(height * 0.07)}px ${Math.round(width * 0.05)}px`, pointerEvents: 'none' }}>
    <div style={{ maxWidth: '90%', color: '#ffffff', fontFamily: '"Segoe UI", Inter, sans-serif', fontWeight: 600, fontSize, lineHeight: 1.22, letterSpacing: '0.005em', textAlign: 'center', whiteSpace: 'pre-line',
      // A thin dark outline under a soft shadow keeps light text readable over bright footage, without a box.
      WebkitTextStroke: `${Math.max(1, Math.round(fontSize / 30))}px rgba(0, 0, 0, 0.6)`, paintOrder: 'stroke fill', textShadow: '0 2px 10px rgba(0, 0, 0, 0.9), 0 0 3px rgba(0, 0, 0, 0.95)' }}>{cue.lines.join('\n')}</div>
  </AbsoluteFill>;
}

function TimelineLayer({ layer }: { layer: AetheraCompositionLayer }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const transitionFrames = Math.min(Math.round((layer.exit?.durationMs ?? 0) * fps / 1_000), Math.floor(layer.durationInFrames / 2));
  const exitProgress = transitionFrames > 0 ? interpolate(frame, [Math.max(0, layer.durationInFrames - transitionFrames), layer.durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  const exitId = layer.exit?.id ?? '';
  const transitionOpacity = exitId === 'fade' || exitId === 'dissolve' || exitId === 'match_cut' ? 1 - exitProgress : 1;
  const matchCutScale = exitId === 'match_cut' && transitionFrames > 0 ? 1 + exitProgress * 0.08 : 1;
  const wipeDirection: WipeDirection | null = exitId === 'wipe' || exitId === 'wipe-left' ? 'left' : exitId === 'wipe-right' ? 'right' : exitId === 'wipe-up' ? 'up' : exitId === 'wipe-down' ? 'down' : null;
  const clipPath = wipeDirection && transitionFrames > 0 ? wipeTransitionClipPath(wipeDirection, exitProgress) : undefined;
  const baseStyle = layerStyle(layer, frame, fps);
  return <AbsoluteFill style={{ ...baseStyle, opacity: transitionOpacity, ...(clipPath ? { clipPath } : {}), ...(matchCutScale !== 1 ? { transform: `${baseStyle.transform ?? ''} scale(${matchCutScale})` } : {}) }}>
    {layer.trackKind === 'video' ? <Media layer={layer} /> : null}
    {layer.trackKind === 'graphics' ? (layer.source.kind === 'graphic' && layer.source.component === 'panels' ? <Panels layer={layer} /> : layer.source.kind === 'graphic' && layer.source.component === 'kinetic' ? <Kinetic layer={layer} /> : layer.source.kind === 'graphic' && layer.source.component === 'diagram' ? <Diagram layer={layer} /> : <Graphic layer={layer} />) : null}
    {layer.trackKind === 'video' || layer.trackKind === 'graphics' ? <VfxOverlay layer={layer} /> : null}
    {layer.trackKind === 'text' ? <TextLayer layer={layer} /> : null}
    {layer.trackKind === 'captions' ? <CaptionLayer layer={layer} /> : null}
    {layer.trackKind === 'video' || layer.trackKind === 'graphics' ? <DepictionBadge layer={layer} /> : null}
  </AbsoluteFill>;
}

/** The AP-04 composition is pure data-driven and is used by both Player and the isolated render worker. */
export function AetheraTimelineComposition({ props }: { props: AetheraTimelineCompositionProps }) {
  return <AbsoluteFill style={{ background: `linear-gradient(${props.background.angle}deg, ${props.background.from}, ${props.background.to})`, color: '#f8fafc' }}>
    {props.layers.map((layer) => <Sequence key={layer.id} from={layer.startFrame} durationInFrames={layer.durationInFrames}><TimelineLayer layer={layer} /></Sequence>)}
  </AbsoluteFill>;
}

export default AetheraTimelineComposition;
