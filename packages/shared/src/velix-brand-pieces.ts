import { BRAND_FONT_FILES, type BrandFontFileId } from './brand-fonts.generated.js';
import { brandContrastRatio, type BrandFont, type BrandIdentity, type BrandTemplateId } from './velix-channel.js';

/** The pieces of a channel identity, in YouTube's sizes. The same SVG feeds the on-screen preview and the saved file. */
export const BRAND_PIECES = [
  { kind: 'banner', label: 'Banner', width: 2560, height: 1440 },
  { kind: 'avatar', label: 'Foto de perfil', width: 800, height: 800 },
  { kind: 'logo', label: 'Logo para fundo escuro', width: 1800, height: 600 },
  { kind: 'logo-inverse', label: 'Logo para fundo claro', width: 1800, height: 600 },
  { kind: 'watermark', label: "Marca d'água", width: 150, height: 150 },
  { kind: 'thumbnail', label: 'Thumbnail base', width: 1280, height: 720 },
] as const;
export type BrandPieceKind = (typeof BRAND_PIECES)[number]['kind'];

/** Area of the 2560×1440 banner that every device shows (YouTube's minimum safe area), centered. */
export const BANNER_SAFE_AREA = { x: 507, y: 508, width: 1546, height: 423 } as const;
/** Band shown on desktop: full width, same height as the safe area. */
export const BANNER_DESKTOP_BAND = { x: 0, y: 508, width: 2560, height: 423 } as const;

/** Each selectable font: the embedded file it uses and its average glyph advance (em), used to fit text without a DOM. */
const FACES: Record<BrandFont, { file: BrandFontFileId; accentFile?: BrandFontFileId; advance: number; upper?: boolean }> = {
  inter: { file: 'inter', accentFile: 'inter-semibold', advance: 0.6 },
  'ibm-plex-sans': { file: 'grotesk', advance: 0.57 },
  'ibm-plex-mono': { file: 'mono', advance: 0.6 },
  anton: { file: 'anton', advance: 0.47, upper: true },
  'archivo-black': { file: 'archivo-black', advance: 0.7 },
  bebas: { file: 'bebas', advance: 0.42, upper: true },
  serif: { file: 'serif', advance: 0.46 },
  grotesk: { file: 'grotesk', advance: 0.58 },
  fredoka: { file: 'fredoka', advance: 0.56 },
  mono: { file: 'mono', advance: 0.6 },
};
type Role = 'title' | 'accent';
const fileOf = (font: BrandFont, role: Role): BrandFontFileId => (role === 'accent' ? FACES[font].accentFile ?? FACES[font].file : FACES[font].file);

/** Escapes text placed inside SVG markup: names and taglines are typed by people and must never become markup. */
export function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

interface Palette { bg: string; bg2: string; fg: string; muted: string; ac: string; ac2: string; onAccent: string; dark: boolean; }
function palette(identity: BrandIdentity): Palette {
  const t = identity.tokens;
  const bg = t['background'] ?? '#000000'; const fg = t['foreground'] ?? '#ffffff'; const ac = t['accent'] ?? fg;
  return { bg, fg, ac, bg2: t['background2'] ?? bg, muted: t['muted'] ?? fg, ac2: t['accent2'] ?? ac, onAccent: brandContrastRatio(fg, ac) >= brandContrastRatio(bg, ac) ? fg : bg, dark: identity.mode === 'dark' };
}

const textWidth = (text: string, font: BrandFont, size: number) => text.length * FACES[font].advance * size;
/** Largest size (up to `max`) at which one line fits `width`. */
const fit = (text: string, font: BrandFont, width: number, max: number) => Math.max(12, Math.min(max, Math.floor(width / Math.max(1, text.length * FACES[font].advance))));

interface TextSpec { x: number; y: number; size: number; font: BrandFont; role: Role; fill: string; text: string; anchor?: 'start' | 'middle' | 'end'; opacity?: number; maxWidth?: number; spacing?: number; stroke?: string; strokeWidth?: number }
function text(spec: TextSpec): string {
  const face = FACES[spec.font]; const file = BRAND_FONT_FILES[fileOf(spec.font, spec.role)];
  const content = face.upper ? spec.text.toLocaleUpperCase('pt-BR') : spec.text;
  // The estimate fits text in advance; textLength is the hard guarantee for a face wider than expected.
  const squeeze = spec.maxWidth && textWidth(content, spec.font, spec.size) > spec.maxWidth ? ` textLength="${Math.round(spec.maxWidth)}" lengthAdjust="spacingAndGlyphs"` : '';
  const paint = spec.stroke ? `fill="none" stroke="${spec.stroke}" stroke-width="${spec.strokeWidth ?? 2}"` : `fill="${spec.fill}"`;
  return `<text x="${Math.round(spec.x)}" y="${Math.round(spec.y)}" ${paint} font-family="'${file.family}'" font-weight="${file.weight}" font-size="${Math.round(spec.size)}" text-anchor="${spec.anchor ?? 'start'}" dominant-baseline="central"${spec.opacity === undefined ? '' : ` opacity="${spec.opacity}"`}${spec.spacing ? ` letter-spacing="${spec.spacing}"` : ''}${squeeze}>${escapeSvgText(content)}</text>`;
}

/** Embeds only the font files the piece uses, so it renders the same in an <img>, a canvas or any SVG viewer. */
function fontFaces(files: Iterable<BrandFontFileId>): string {
  const faces = [...new Set(files)].map((id) => { const file = BRAND_FONT_FILES[id]; return `@font-face{font-family:'${file.family}';font-weight:${file.weight};src:url(data:font/woff2;base64,${file.base64}) format('woff2')}`; });
  return faces.length ? `<style>${faces.join('')}</style>` : '';
}

const templateOf = (identity: BrandIdentity): BrandTemplateId => identity.template ?? (identity.mode === 'dark' ? 'fintech' : 'clean');
const title = (identity: BrandIdentity) => identity.fonts.title;

/** The channel mark on a 1000-unit grid, scaled into place. */
function symbol(identity: BrandIdentity, colors: Palette, x: number, y: number, size: number): string {
  const initials = identity.symbol.initials.trim().slice(0, 3) || 'V';
  const font = title(identity);
  const big = initials.length === 1 || FACES[font].upper ? 560 : 430;
  const letters = (fill: string, cy: number, scale = 1, value = initials) => text({ x: 500, y: cy, size: big * scale, font, role: 'title', fill, text: value, anchor: 'middle', spacing: -0.02 * big * scale, maxWidth: 760 });
  let body: string;
  if (templateOf(identity) === 'premium') {
    // A medallion: hairline rings and serif initials, the way a house mark is struck.
    body = `<circle cx="500" cy="500" r="470" fill="${colors.bg2}"/><circle cx="500" cy="500" r="470" fill="none" stroke="${colors.ac}" stroke-width="16"/><circle cx="500" cy="500" r="418" fill="none" stroke="${colors.ac}" stroke-width="4" opacity=".7"/>${letters(colors.ac, 510, 1.08)}`;
  } else if (identity.symbol.style === 'seta') {
    const line = `fill="none" stroke="${colors.ac}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"`;
    body = `<rect x="40" y="40" width="920" height="920" rx="230" fill="${colors.bg2}" stroke="${colors.ac}" stroke-width="26"/>${letters(colors.fg, 390, 0.74)}<polyline points="210,800 400,680 530,750 790,575" ${line}/><polyline points="680,570 800,570 800,690" ${line}/>`;
  } else if (identity.symbol.style === 'ponto') {
    body = `<circle cx="500" cy="500" r="460" fill="${colors.bg2}"/>${letters(colors.fg, 480, 1.05, initials[0] ?? 'V')}<circle cx="760" cy="740" r="78" fill="${colors.ac}"/>`;
  } else {
    body = `<rect x="40" y="40" width="920" height="920" rx="230" fill="${colors.ac}"/>${letters(colors.onAccent, 500)}`;
  }
  return `<g transform="translate(${x} ${y}) scale(${size / 1000})">${body}</g>`;
}

/** Background, light and texture shared by every opaque piece. */
function base(w: number, h: number, colors: Palette, glowAt: [number, number]): string {
  return `<defs><radialGradient id="glow" cx="${glowAt[0]}" cy="${glowAt[1]}" r="0.6"><stop offset="0" stop-color="${colors.ac}" stop-opacity="${colors.dark ? 0.34 : 0.16}"/><stop offset="1" stop-color="${colors.ac}" stop-opacity="0"/></radialGradient><linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="${colors.bg2}" stop-opacity="0"/><stop offset="1" stop-color="${colors.bg2}" stop-opacity="${colors.dark ? 0.9 : 0.7}"/></linearGradient><filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><filter id="blur"><feGaussianBlur stdDeviation="${Math.round(Math.min(w, h) * 0.05)}"/></filter></defs>`
    + `<rect width="${w}" height="${h}" fill="${colors.bg}"/><rect width="${w}" height="${h}" fill="url(#floor)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>`;
}
const grain = (w: number, h: number, dark: boolean) => `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${dark ? 0.07 : 0.05}"/>`;

/**
 * The composition of each direction, drawn in the piece's own coordinates. On the banner everything here stays outside
 * or behind the safe area, so cropping on a phone only loses decoration.
 */
function motif(template: BrandTemplateId, w: number, h: number, colors: Palette, name: string, font: BrandFont): string {
  const s = Math.min(w, h) / 1440;
  switch (template) {
    case 'premium': {
      const inset = Math.round(48 * s * 1.6); const inner = inset + Math.round(22 * s * 1.6);
      return `<rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" fill="none" stroke="${colors.ac}" stroke-width="${Math.max(2, 4 * s)}" opacity=".55"/><rect x="${inner}" y="${inner}" width="${w - inner * 2}" height="${h - inner * 2}" fill="none" stroke="${colors.ac}" stroke-width="${Math.max(1, 1.5 * s)}" opacity=".35"/>`
        + [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]].map(([x, y]) => `<rect x="${(x ?? 0) - 14 * s}" y="${(y ?? 0) - 14 * s}" width="${28 * s}" height="${28 * s}" fill="${colors.ac}" transform="rotate(45 ${x} ${y})"/>`).join('');
    }
    case 'fintech': {
      const step = Math.max(24, Math.round(56 * s));
      const band = (value: number) => 0.7 + value * 0.27;
      const points = [0.0, 0.92, 0.12, 0.8, 0.22, 0.86, 0.34, 0.64, 0.46, 0.72, 0.58, 0.46, 0.7, 0.54, 0.82, 0.24, 0.92, 0.32, 1.0, 0.0].reduce<string[]>((acc, value, index, list) => (index % 2 ? acc : [...acc, `${Math.round(value * w)},${Math.round(band(list[index + 1] ?? 0) * h)}`]), []);
      return `<defs><pattern id="dots" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${Math.max(1.2, 2.4 * s)}" fill="${colors.fg}" opacity=".16"/></pattern><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.ac}" stop-opacity=".28"/><stop offset="1" stop-color="${colors.ac}" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#dots)"/><polygon points="${points.join(' ')} ${w},${h} 0,${h}" fill="url(#area)"/><polyline points="${points.join(' ')}" fill="none" stroke="${colors.ac}" stroke-width="${Math.max(2, 7 * s)}" stroke-linejoin="round" opacity=".8"/>`;
    }
    case 'crescimento': {
      // Bars rise on the right, past the end of the tagline; the trend line runs under the safe area.
      const bars = 6; const barW = w * 0.03; const gap = barW * 0.5; const startX = w * 0.97 - bars * (barW + gap);
      return Array.from({ length: bars }, (_, index) => { const height = h * (0.12 + index * 0.09); return `<rect x="${Math.round(startX + index * (barW + gap))}" y="${Math.round(h - height)}" width="${Math.round(barW)}" height="${Math.round(height)}" rx="${Math.round(barW * 0.18)}" fill="${colors.ac}" opacity="${(0.2 + index * 0.12).toFixed(2)}"/>`; }).join('')
        + `<path d="M0 ${h * 0.97} C ${w * 0.3} ${h * 0.96}, ${w * 0.5} ${h * 0.9}, ${w * 0.64} ${h * 0.86} S ${w * 0.86} ${h * 0.74}, ${w} ${h * 0.66}" fill="none" stroke="${colors.ac2}" stroke-width="${Math.max(2, 5 * s)}" opacity=".35"/>`;
    }
    case 'cyber': {
      const line = `stroke="${colors.ac}" stroke-width="${Math.max(2, 4 * s)}" fill="none" opacity=".55"`;
      const node = (x: number, y: number, color: string) => `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${Math.max(4, 11 * s)}" fill="${color}"/>`;
      const traces = [
        `M0 ${h * 0.2} H${w * 0.12} L${w * 0.16} ${h * 0.28} H${w * 0.17}`, `M0 ${h * 0.78} H${w * 0.08} L${w * 0.13} ${h * 0.7} H${w * 0.17}`,
        `M${w} ${h * 0.25} H${w * 0.9} L${w * 0.86} ${h * 0.33} H${w * 0.83}`, `M${w} ${h * 0.82} H${w * 0.93} L${w * 0.88} ${h * 0.74} H${w * 0.83}`,
      ];
      const c = Math.round(60 * s * 1.8); const corners = [[w * 0.08, h * 0.12, 1, 1], [w * 0.92, h * 0.12, -1, 1], [w * 0.08, h * 0.88, 1, -1], [w * 0.92, h * 0.88, -1, -1]].map(([x, y, dx, dy]) => `<path d="M${x} ${(y ?? 0) + c * (dy ?? 1)} V${y} H${(x ?? 0) + c * (dx ?? 1)}" stroke="${colors.ac2}" stroke-width="${Math.max(2, 6 * s)}" fill="none"/>`).join('');
      return `<defs><pattern id="scan" width="8" height="${Math.max(4, Math.round(8 * s))}" patternUnits="userSpaceOnUse"><rect width="8" height="1" fill="${colors.fg}" opacity=".06"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#scan)"/>${traces.map((d) => `<path d="${d}" ${line}/>`).join('')}${node(w * 0.17, h * 0.28, colors.ac)}${node(w * 0.17, h * 0.7, colors.ac2)}${node(w * 0.83, h * 0.33, colors.ac2)}${node(w * 0.83, h * 0.74, colors.ac)}${corners}`;
    }
    case 'energia': {
      const ghostSize = h * 0.62;
      return `<g transform="skewX(-14)">${[0.9, 0.96, 1.02].map((x, index) => `<rect x="${Math.round(w * x)}" y="0" width="${Math.round(w * (0.035 - index * 0.008))}" height="${h}" fill="${colors.ac}" opacity="${(0.5 - index * 0.14).toFixed(2)}"/>`).join('')}<rect x="${Math.round(w * 0.1)}" y="0" width="${Math.round(w * 0.012)}" height="${h}" fill="${colors.ac}" opacity=".35"/></g>`
        + text({ x: w / 2, y: h * 0.5, size: ghostSize, font, role: 'title', fill: 'none', stroke: colors.fg, strokeWidth: Math.max(2, 3 * s), text: name, anchor: 'middle', opacity: 0.08, maxWidth: w * 1.4 });
    }
    case 'neon': {
      return `<g filter="url(#blur)"><circle cx="${w * 0.12}" cy="${h * 0.2}" r="${Math.min(w, h) * 0.32}" fill="${colors.ac}" opacity=".35"/><circle cx="${w * 0.9}" cy="${h * 0.85}" r="${Math.min(w, h) * 0.36}" fill="${colors.ac2}" opacity=".3"/></g>`
        + `<circle cx="${w * 0.87}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.17}" fill="none" stroke="${colors.ac}" stroke-width="${Math.max(3, 14 * s)}" opacity=".9"/><circle cx="${w * 0.87}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.17}" fill="none" stroke="${colors.ac}" stroke-width="${Math.max(8, 44 * s)}" opacity=".18"/>`
        + [[0.08, 0.78, 1], [0.95, 0.62, 0.7], [0.18, 0.12, 0.6]].map(([x, y, k]) => { const r = 26 * s * (k ?? 1) * 1.6; const cx = (x ?? 0) * w; const cy = (y ?? 0) * h; return `<path d="M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${colors.fg}" opacity=".8"/>`; }).join('');
    }
    case 'clean': {
      const r = Math.min(w, h) * 0.42;
      return `<circle cx="${w * 0.06}" cy="${h * 0.1}" r="${r}" fill="${colors.ac2}" opacity=".32"/><path d="M${w} ${h - r * 1.1} A ${r * 1.1} ${r * 1.1} 0 0 0 ${w - r * 1.1} ${h} H ${w} Z" fill="${colors.ac}"/><rect x="${w * 0.8}" y="${h * 0.09}" width="${w * 0.14}" height="${Math.max(6, 18 * s)}" fill="${colors.fg}"/>`;
    }
    case 'quente': {
      const arch = (x: number, width: number, height: number, fill: string, opacity: number) => `<path d="M${x} ${h} V${h - height + width / 2} A ${width / 2} ${width / 2} 0 0 1 ${x + width} ${h - height + width / 2} V${h} Z" fill="${fill}" opacity="${opacity}"/>`;
      return `<circle cx="${w * 0.84}" cy="${h * 0.24}" r="${Math.min(w, h) * 0.13}" fill="${colors.ac2}" opacity=".55"/>${arch(w * 0.02, w * 0.11, h * 0.56, colors.bg2, 1)}${arch(w * 0.1, w * 0.08, h * 0.38, colors.ac, 0.85)}${arch(w * 0.86, w * 0.12, h * 0.48, colors.bg2, 1)}`;
    }
    case 'suave':
    default: {
      const blob = (cx: number, cy: number, r: number, fill: string, opacity: number) => `<path d="M${cx - r} ${cy} C ${cx - r} ${cy - r * 0.9}, ${cx - r * 0.2} ${cy - r * 1.1}, ${cx + r * 0.3} ${cy - r * 0.8} S ${cx + r * 1.15} ${cy - r * 0.1}, ${cx + r * 0.8} ${cy + r * 0.55} S ${cx - r * 0.2} ${cy + r * 1.1}, ${cx - r} ${cy} Z" fill="${fill}" opacity="${opacity}"/>`;
      return blob(w * 0.08, h * 0.22, Math.min(w, h) * 0.3, colors.ac2, 0.4) + blob(w * 0.92, h * 0.8, Math.min(w, h) * 0.34, colors.bg2, 1) + blob(w * 0.88, h * 0.16, Math.min(w, h) * 0.1, colors.ac, 0.5);
    }
  }
}

const svg = (width: number, height: number, faces: string, body: string, label = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeSvgText(label)}</title>${faces}${body}</svg>`;
const nameOf = (identity: BrandIdentity) => identity.name?.trim() || identity.tagline.trim() || identity.symbol.initials;
const taglineOf = (identity: BrandIdentity) => { const value = identity.tagline.trim(); return value && value !== nameOf(identity) ? value : ''; };
const shown = (value: string, font: BrandFont) => (FACES[font].upper ? value.toLocaleUpperCase('pt-BR') : value);

/** Size of the channel name on the banner, as rendered: also used by the evaluation. */
export function bannerNameSize(identity: BrandIdentity): number {
  const font = title(identity);
  return fit(shown(nameOf(identity), font), font, BANNER_SAFE_AREA.width - 300 - 72 - 40, FACES[font].upper ? 210 : 170);
}

/** Greedy wrap by estimated width, at most `lines` lines. */
function wrap(value: string, font: BrandFont, size: number, width: number, lines: number): string[] {
  const out: string[] = [];
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last !== undefined && textWidth(`${last} ${word}`, font, size) <= width) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out.length > lines ? [...out.slice(0, lines - 1), out.slice(lines - 1).join(' ')] : out;
}

/** Renders one identity piece as a self-contained SVG: no scripts, no external references, fonts embedded. */
export function renderBrandPiece(identity: BrandIdentity, kind: BrandPieceKind, options: { title?: string } = {}): string {
  const colors = palette(identity);
  const template = templateOf(identity);
  const font = title(identity); const accentFont = identity.fonts.accent;
  const name = nameOf(identity); const tagline = taglineOf(identity);
  const files: BrandFontFileId[] = [fileOf(font, 'title'), fileOf(accentFont, 'accent')];
  const nameSpacing = (size: number) => (FACES[font].upper ? size * 0.01 : font === 'serif' ? -size * 0.008 : -size * 0.03);

  if (kind === 'banner') {
    const area = BANNER_SAFE_AREA; const mark = 300; const gap = 72;
    const nameSize = bannerNameSize(identity);
    const tagSize = tagline ? fit(tagline, accentFont, area.width - mark - gap - 40, 46) : 0;
    const block = Math.max(textWidth(shown(name, font), font, nameSize), tagline ? textWidth(tagline, accentFont, tagSize) : 0);
    const left = area.x + Math.max(20, (area.width - (mark + gap + Math.min(block, area.width - mark - gap - 40))) / 2);
    const centerY = area.y + area.height / 2; const textX = left + mark + gap;
    const nameY = tagline ? centerY - tagSize * 0.75 : centerY; const tagY = centerY + nameSize * 0.5 + 6;
    const body = base(2560, 1440, colors, template === 'premium' ? [0.5, 0.45] : [0.32, 0.5]) + motif(template, 2560, 1440, colors, name, font)
      + symbol(identity, colors, left, centerY - mark / 2, mark)
      + text({ x: textX, y: nameY, size: nameSize, font, role: 'title', fill: colors.fg, text: name, spacing: nameSpacing(nameSize), maxWidth: area.x + area.width - textX - 20 })
      + (tagline ? text({ x: textX + 4, y: tagY, size: tagSize, font: accentFont, role: 'accent', fill: colors.muted, text: tagline, maxWidth: area.x + area.width - textX - 20 }) : '')
      + grain(2560, 1440, colors.dark);
    return svg(2560, 1440, fontFaces(files), body, `Banner de ${name}`);
  }
  if (kind === 'avatar') {
    // A 560px mark keeps its corners inside the 800px circle YouTube crops to.
    return svg(800, 800, fontFaces(files), `${base(800, 800, colors, [0.5, 0.5])}<g opacity=".55">${motif(template === 'energia' ? 'crescimento' : template, 800, 800, colors, '', font)}</g>${symbol(identity, colors, 120, 120, 560)}${grain(800, 800, colors.dark)}`, `Foto de perfil de ${name}`);
  }
  if (kind === 'logo' || kind === 'logo-inverse') {
    // One wordmark for dark surfaces (light ink) and one for light surfaces (dark ink), whatever the identity's mode.
    const mark = 440; const textX = 60 + mark + 60; const size = fit(shown(name, font), font, 1800 - textX - 60, 230);
    const [lightInk, darkInk] = brandContrastRatio(colors.fg, '#000000') >= brandContrastRatio(colors.bg, '#000000') ? [colors.fg, colors.bg] : [colors.bg, colors.fg];
    const ink = kind === 'logo' ? lightInk : darkInk;
    return svg(1800, 600, fontFaces(files), `${symbol(identity, colors, 60, 80, mark)}${text({ x: textX, y: 300, size, font, role: 'title', fill: ink, text: name, spacing: nameSpacing(size), maxWidth: 1800 - textX - 60 })}`, kind === 'logo' ? `Logo de ${name} para fundo escuro` : `Logo de ${name} para fundo claro`);
  }
  if (kind === 'watermark') return svg(150, 150, fontFaces([fileOf(font, 'title')]), `<g opacity=".92">${symbol(identity, colors, 0, 0, 150)}</g>`, `Marca d'água de ${name}`);

  const headline = (options.title ?? 'Título do vídeo aqui').trim() || 'Título do vídeo aqui';
  const width = 700;
  let size = FACES[font].upper ? 128 : 104;
  let lines = wrap(shown(headline, font), font, size, width, 3);
  while (size > 56 && lines.some((line) => textWidth(line, font, size) > width)) { size -= 6; lines = wrap(shown(headline, font), font, size, width, 3); }
  const lineHeight = size * (FACES[font].upper ? 0.98 : 1.04); const top = 330 - ((lines.length - 1) * lineHeight) / 2;
  const fade = `<defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="0.72" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="right"><rect width="1280" height="720" fill="url(#fade)"/></mask></defs>`;
  const body = base(1280, 720, colors, [0.82, 0.5]) + `${fade}<g mask="url(#right)" opacity=".85">${motif(template, 1280, 720, colors, '', font)}</g>`
    + `<rect x="0" y="0" width="22" height="720" fill="${colors.ac}"/>`
    + lines.map((line, index) => text({ x: 70, y: top + index * lineHeight, size, font, role: 'title', fill: colors.fg, text: line, spacing: nameSpacing(size), maxWidth: width })).join('')
    + `<rect x="72" y="${Math.round(top + (lines.length - 1) * lineHeight + size * 0.75)}" width="160" height="12" rx="6" fill="${colors.ac}"/>`
    + symbol(identity, colors, 70, 600, 72) + text({ x: 160, y: 636, size: 30, font: accentFont, role: 'accent', fill: colors.muted, text: name, maxWidth: 560 })
    + grain(1280, 720, colors.dark);
  return svg(1280, 720, fontFaces(files), body, `Thumbnail de ${name}`);
}

export interface BrandCheck { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; }

/**
 * Deterministic review of an identity before it goes to the channel. A `fail` blocks applying; a `warn` is the
 * person's call. Every rule is measurable from the identity itself; none guesses taste.
 */
export function evaluateBrandIdentity(identity: BrandIdentity): BrandCheck[] {
  const colors = palette(identity);
  const readable = brandContrastRatio(colors.fg, colors.bg);
  const mark = templateOf(identity) === 'premium' ? brandContrastRatio(colors.ac, colors.bg2) : identity.symbol.style === 'monograma' ? brandContrastRatio(colors.onAccent, colors.ac) : brandContrastRatio(colors.fg, colors.bg2);
  const accentOnBackground = brandContrastRatio(colors.ac, colors.bg);
  const nameSize = bannerNameSize(identity);
  const tagline = identity.tagline.trim();
  const initials = identity.symbol.initials.trim();
  return [
    { id: 'text-contrast', label: 'Leitura do texto', status: readable >= 7 ? 'ok' : readable >= 4.5 ? 'warn' : 'fail', detail: `Contraste texto/fundo ${readable.toFixed(1)}:1 (mínimo 4,5:1; ideal 7:1).` },
    { id: 'symbol-contrast', label: 'Símbolo legível', status: mark >= 4.5 ? 'ok' : mark >= 3 ? 'warn' : 'fail', detail: `Iniciais do símbolo com contraste ${mark.toFixed(1)}:1 (mínimo 3:1).` },
    { id: 'accent', label: 'Destaque visível', status: accentOnBackground >= 3 ? 'ok' : 'warn', detail: `A cor de destaque contra o fundo tem contraste ${accentOnBackground.toFixed(1)}:1; abaixo de 3:1 os detalhes somem.` },
    { id: 'name-size', label: 'Nome no celular', status: nameSize >= 110 ? 'ok' : nameSize >= 72 ? 'warn' : 'fail', detail: nameSize >= 110 ? 'O nome cabe na área segura em tamanho grande.' : `O nome é longo e fica com ${nameSize}px no banner; no celular fica pequeno. Encurte o nome no banner.` },
    { id: 'tagline', label: 'Frase curta', status: tagline.length === 0 ? 'warn' : tagline.length <= 60 ? 'ok' : 'warn', detail: tagline.length === 0 ? 'Sem frase: o banner mostra só o nome.' : `${tagline.length} caracteres${tagline.length > 60 ? '; acima de 60 a frase perde leitura no celular.' : '.'}` },
    { id: 'initials', label: "Marca d'água e foto de perfil", status: initials.length >= 1 && initials.length <= 2 ? 'ok' : 'warn', detail: initials.length <= 2 ? 'Iniciais curtas leem bem em 150×150.' : 'Três letras ficam apertadas na marca d’água de 150×150.' },
  ];
}

export function brandPieceDataUrl(identity: BrandIdentity, kind: BrandPieceKind, options: { title?: string } = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderBrandPiece(identity, kind, options))}`;
}
