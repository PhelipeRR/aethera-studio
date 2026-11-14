import type { CommonScene, CommonScript, DossieBlock } from '@neuralbridge/shared';

/** Themes defined by the kit's engine stylesheet; anything else falls back to the app's own black and orange. */
export const KIT_THEMES = ['t-dark-laranja', 't-claude-creme', 't-verde-terminal', 't-azul-profundo', 't-roxo-neon', 't-vermelho-glow', 't-bauhaus', 't-branco-estudio', 't-aurora'] as const;
export interface StyleAdapterOptions { theme?: string; handle?: string; words?: Array<{ w: string; s: number; e: number }>; duration?: number }
const theme = (value: string | undefined, fallback: (typeof KIT_THEMES)[number]) => (KIT_THEMES as readonly string[]).includes(value ?? '') ? value as string : fallback;

/**
 * The kit templates build their markup with innerHTML, and the script is untrusted text: every value is escaped here,
 * keeping only the kit's own *highlight* marker.
 */
export function kitText(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  return text.replace(/\s+/gu, ' ').trim().slice(0, max).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
/**
 * For fields a template sets with textContent: plain, bounded text (escaping there would show the entities). Angle
 * brackets are dropped, so the value is harmless even if a template version builds it as markup.
 */
export function plainText(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  return text.replace(/[<>]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, max);
}
const num = (value: unknown, fallback = 0) => { const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/\./gu, '').replace(',', '.')); return Number.isFinite(parsed) ? parsed : fallback; };
const items = (block: DossieBlock): Array<Record<string, unknown>> => (Array.isArray(block['itens']) ? (block['itens'] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : []);

/** The words a block says on screen, whatever its kind. */
export function blockText(block: DossieBlock): string {
  switch (block.tipo) {
    case 'cards': return items(block).map((item) => item['titulo']).filter(Boolean).join(', ');
    case 'barras': case 'pontos': case 'grafico': return String(block['titulo'] ?? '');
    case 'contador': return [block['rotulo'], block['para']].filter((part) => part !== undefined && part !== '').join(' ');
    case 'balanca': return [block['esquerda'], block['direita']].filter(Boolean).join(' × ');
    case 'foto': return String(block['etiqueta'] ?? '');
    case 'citacao': return [block['texto'], block['autor'] ? `— ${String(block['autor'])}` : ''].filter(Boolean).join(' ');
    default: return String(block['texto'] ?? block['titulo'] ?? '');
  }
}

/** Breaks a sentence into at most `max` short lines, as the kit's kinetic layouts expect. */
export function splitLines(text: string, perLine = 18, max = 3): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last.length + word.length + 1 <= perLine || lines.length >= max)) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

const sceneLength = (scene: CommonScene) => Math.max(0, scene.end - scene.at);
// The source is shown as written; it only gets the "Fonte:" label when it does not carry one already.
const kicker = (scene: CommonScene) => kitText(scene.source ? (/^fonte\s*:/iu.test(scene.source) ? scene.source : `Fonte: ${scene.source}`) : scene.chapter?.title ?? '', 80);

/** One kinetic beat per block (at most 3 per scene). Durations split each scene, so the video ends with the script. */
export function kineticExplainer(script: CommonScript, options: StyleAdapterOptions = {}) {
  const beats: Array<Record<string, unknown>> = [];
  for (const scene of script.scenes) {
    const length = sceneLength(scene);
    if (length <= 0) continue;
    const blocks = scene.blocks.filter((block) => blockText(block).trim()).slice(0, 3);
    const planned = blocks.length ? blocks : [{ tipo: 'texto', texto: scene.chapter?.title || script.series || ' ' } as DossieBlock];
    const dur = Math.round((length / planned.length) * 100) / 100;
    planned.forEach((block, index) => {
      const head = index === 0 ? kicker(scene) : '';
      if (block.tipo === 'contador' || block.tipo === 'pontos') {
        const to = num(block.tipo === 'pontos' ? block['destaque'] : block['para']);
        beats.push({ type: 'counter', dur, label: kitText(block.tipo === 'pontos' ? block['titulo'] : block['rotulo'], 60), from: block.tipo === 'pontos' ? 0 : num(block['de']), to, prefix: kitText(block['prefixo'], 6), suffix: block.tipo === 'pontos' ? ` de ${num(block['total'])}` : kitText(block['sufixo'], 12), caption: head });
      } else if (block.tipo === 'barras' || block.tipo === 'cards') {
        const list = items(block).slice(0, 4).map((item) => kitText(block.tipo === 'barras' ? `${String(item['nome'] ?? '')} ${String(item['valor'] ?? '')}` : item['titulo'], 40));
        beats.push({ type: block.tipo === 'barras' ? 'list' : 'chips', dur, title: kitText(block['titulo'] ?? scene.chapter?.title ?? '', 60), items: list });
      } else {
        beats.push({ type: 'text', dur, kicker: head, lines: splitLines(kitText(blockText(block))) });
      }
    });
  }
  // Rounding is absorbed by the last beat so the whole video lasts exactly the script's duration.
  const total = beats.reduce((sum, beat) => sum + Number(beat['dur']), 0);
  const last = beats[beats.length - 1];
  if (last && script.duration > 0) last['dur'] = Math.max(0.5, Math.round((Number(last['dur']) + script.duration - total) * 100) / 100);
  return { theme: theme(options.theme, 't-dark-laranja'), fps: 30, handle: plainText(options.handle ?? '', 40), progress: true, beats };
}

/** One giant word per scene, held while the scene lasts. */
export function giantText(script: CommonScript, options: StyleAdapterOptions = {}) {
  const fonts = ['cond', 'wide', 'serif'];
  const palavras = script.scenes.filter((scene) => sceneLength(scene) > 0).map((scene, index) => {
    const big = scene.blocks.find((block) => block.tipo === 'grande');
    const source = String(big?.['texto'] ?? scene.chapter?.title ?? blockText(scene.blocks[0] ?? { tipo: 'texto' }));
    // Whole words only: two when they fit the width, otherwise the first one.
    const parts = source.replace(/[*]/gu, '').split(/\s+/u).filter(Boolean);
    const pair = parts.slice(0, 2).join(' ');
    const word = (pair.length <= 12 ? pair : parts[0] ?? '').toLocaleUpperCase('pt-BR');
    return { t: plainText(word || '•', 18), at: index === 0 ? -0.1 : scene.at, dur: sceneLength(scene) + (index === 0 ? 0.1 : 0), fonte: fonts[index % fonts.length] };
  });
  return { dur: script.duration, y: 0.3, theme: theme(options.theme, 't-dark-laranja'), palavras };
}

/** Kinetic type of the words said. Real word timings (from the narration) win; otherwise each scene's words share its time. */
export function kineticType(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = options.words?.length
    ? options.words.map((word) => ({ w: kitText(word.w, 30), s: word.s, e: word.e }))
    : script.scenes.flatMap((scene) => {
      const said = scene.blocks.map(blockText).join(' ').replace(/[*]/gu, '').split(/\s+/u).filter(Boolean).slice(0, 60);
      const step = said.length ? sceneLength(scene) / said.length : 0;
      return said.map((word, index) => ({ w: kitText(word, 30), s: Math.round((scene.at + index * step) * 100) / 100, e: Math.round((scene.at + (index + 0.85) * step) * 100) / 100 }));
    });
  return { dur: script.duration || undefined, fps: 30, alternar: true, maxLinha: 2, logo: plainText(options.handle ?? '', 30), cores: ['#ffe14d', '#ff5a1f', '#4f8cff', '#ffffff'], words };
}

/** App showcase: one screen per photo block (or per scene), each with its headline. Short piece, about 3 s per screen. */
export function appShowcase(script: CommonScript, options: StyleAdapterOptions = {}) {
  const photos = script.scenes.flatMap((scene) => scene.blocks.filter((block) => block.tipo === 'foto').map((block) => ({ img: typeof block['src'] === 'string' ? block['src'] : '', head: kitText(block['etiqueta'] ?? scene.chapter?.title ?? '', 50) })));
  const fromScenes = script.scenes.map((scene) => ({ img: '', head: kitText(scene.chapter?.title ?? blockText(scene.blocks[0] ?? { tipo: 'texto' }), 50) }));
  const scenes = (photos.length ? photos : fromScenes).slice(0, 6).map((scene, index) => ({ ...scene, sub: '', tap: null, tilt: [-12, 12, 0][index % 3] }));
  return { theme: theme(options.theme, 't-vermelho-glow'), fps: 30, handle: kitText(options.handle ?? '', 40), scenes, cta: { text: kitText(script.footer, 40), keyword: '' } };
}

/** Brand stings: name and tagline from the series and footer of the script. */
export function brandSting(script: CommonScript, kind: 'logo-reveal' | 'particulas-3d' | 'showreel-bauhaus', options: StyleAdapterOptions = {}) {
  // Logo reveal and particles set brand and tagline with textContent; the showreel builds words and title as markup.
  const name = options.handle?.replace(/^@/u, '') || script.series || 'NeuralBridge';
  if (kind === 'logo-reveal') return { brand: plainText(name, 30), tagline: plainText(script.footer, 60), theme: theme(options.theme, 't-dark-laranja'), font: 'serif' };
  if (kind === 'particulas-3d') return { brand: plainText(name, 30).toLocaleUpperCase('pt-BR'), tagline: plainText(script.footer, 60), theme: theme(options.theme, 't-aurora') };
  const chapters = script.scenes.map((scene, index) => `${String(index + 1).padStart(2, '0')} — ${(scene.chapter?.title || blockText(scene.blocks[0] ?? { tipo: 'texto' })).toLocaleUpperCase('pt-BR')}`).slice(0, 6).map((value) => plainText(value, 28));
  // Upper-case before escaping, so entities stay as written.
  const upper = kitText(name.toLocaleUpperCase('pt-BR'), 30);
  const words = upper.split(/\s+/u).filter(Boolean).slice(0, 3);
  return { words: words.length ? words : ['MAKE', 'IT', 'MOVE'], title: upper, title2: '', year: `'${String(new Date().getFullYear()).slice(2)}`, brand: upper, chapters };
}


// --- Layers over filmed footage (48.3 part B). They render transparent and are composed over the base video. ---

type Word = { w: string; s: number; e: number };
const round = (value: number) => Math.round(value * 100) / 100;
/** The script's scenes stretched over the footage, so cards land in proportion to the recorded speech. */
function scenesOver(script: CommonScript, duration: number) {
  const factor = script.duration > 0 ? duration / script.duration : 1;
  return script.scenes.map((scene) => ({ scene, at: round(scene.at * factor), end: round(scene.end * factor) }));
}
const footageWords = (options: StyleAdapterOptions): Word[] => (options.words ?? []).filter((word) => word.e > word.s).map((word) => ({ w: kitText(word.w, 30), s: round(word.s), e: round(word.e) }));
const footageDuration = (options: StyleAdapterOptions, words: Word[]) => round(Math.max(options.duration ?? 0, words.at(-1)?.e ?? 0, 1));
/** Words of the script worth highlighting in a caption: the giant words and chapter titles. */
function keywords(script: CommonScript): string[] {
  const words = script.scenes.flatMap((scene) => [String(scene.blocks.find((block) => block.tipo === 'grande')?.['texto'] ?? ''), scene.chapter?.title ?? '']).join(' ').replace(/[*]/gu, '').split(/\s+/u).filter((word) => word.length > 3);
  return [...new Set(words.map((word) => kitText(word.toLocaleLowerCase('pt-BR'), 30)))].slice(0, 10);
}

/** Premium dynamic caption: the spoken words, a few at a time, with the script's keywords underlined. */
export function premiumCaption(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = footageWords(options);
  return { dur: footageDuration(options, words), words, keywords: keywords(script), capY: 1500, ac: '#ff5a1f', maxWords: 3, sombra: true, estilo: 'claro', sfx: false };
}

/** Kids caption: candy-colored words, one line per phrase (a pause or 4 words closes the line). */
export function kidsCaption(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = footageWords(options);
  const lines: Array<{ a: number; b: number }> = []; const marked: Array<Word & { l: number }> = [];
  words.forEach((word, index) => {
    const previous = words[index - 1];
    const open = lines[lines.length - 1];
    if (!open || !previous || word.s - previous.e > 0.6 || marked.filter((item) => item.l === lines.length - 1).length >= 3) lines.push({ a: round(Math.max(0, word.s - 0.1)), b: word.e });
    const current = lines[lines.length - 1];
    if (current) current.b = round(word.e + 0.3);
    marked.push({ ...word, l: lines.length - 1 });
  });
  return { dur: footageDuration(options, words), words: marked, lines, beats: [], capY: 1450, efeitos: [] };
}

/** Talking-head overlay: a headline per chapter, numbers as stickers, and the caption of the spoken words. */
export function talkingHeadOverlay(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = footageWords(options);
  const dur = footageDuration(options, words);
  const placed = scenesOver(script, dur);
  const heads = placed.filter(({ scene }) => scene.chapter?.title || scene.blocks.some((block) => block.tipo === 'grande')).map(({ scene, at, end }) => {
    const big = scene.blocks.find((block) => block.tipo === 'grande');
    return { at, dur: round(Math.min(2.6, Math.max(1, end - at))), kicker: scene.source ? kitText(/^fonte\s*:/iu.test(scene.source) ? scene.source : `Fonte: ${scene.source}`, 60) : '', text: kitText(scene.chapter?.title || big?.['texto'] || '', 40), tarja: big && scene.chapter?.title ? kitText(big['texto'], 30) : '' };
  });
  const stickers = placed.flatMap(({ scene, at }) => scene.blocks.filter((block) => block.tipo === 'contador').map((block) => ({ at: round(at + 0.6), dur: 1.4, text: plainText(`${String(block['prefixo'] ?? '')}${String(block['para'] ?? '')}${String(block['sufixo'] ?? '')} ${String(block['rotulo'] ?? '')}`, 40), x: 160, y: 900, ac: true })));
  return { theme: theme(options.theme, 't-dark-laranja'), dur, style: 'destaque', capY: 1180, maxWords: 3, keywords: keywords(script), progress: true, heads, stickers, words };
}

/** Podcast with motion cuts: full-screen title cards at the script's big moments, over the conversation. */
export function podcastCuts(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = footageWords(options);
  const dur = footageDuration(options, words);
  const colors = ['#FFC924', '#0B0B0C', '#D7261E'];
  const cenas = scenesOver(script, dur).filter(({ scene }) => scene.blocks.some((block) => block.tipo === 'grande' || block.tipo === 'contador')).slice(0, 6).map(({ scene, at, end }, index) => {
    const big = scene.blocks.find((block) => block.tipo === 'grande') ?? scene.blocks.find((block) => block.tipo === 'contador');
    const text = big?.tipo === 'contador' ? `${String(big['para'] ?? '')}${String(big['sufixo'] ?? '')}` : String(big?.['texto'] ?? '');
    const bg = colors[index % colors.length] ?? '#0B0B0C';
    return { a: at, b: round(Math.min(end, at + 2.4)), bg, entrada: 'nenhuma', els: [{ tipo: 'texto', t: kitText(text.toLocaleUpperCase('pt-BR'), 24), y: 700, size: 200, at, anim: 'slam', cor: bg === '#FFC924' ? '#141210' : '#F3EAD8' }] };
  });
  return { dur, credit: plainText(script.series, 40), progress: true, words, keywords: keywords(script), cenas, stickers: [] };
}

/** Giant text over the footage: the scene words, stretched over the recorded speech. */
export function giantTextOver(script: CommonScript, options: StyleAdapterOptions = {}) {
  const words = footageWords(options);
  const dur = footageDuration(options, words);
  const factor = script.duration > 0 ? dur / script.duration : 1;
  const base = giantText(script, options);
  return { ...base, dur, palavras: base.palavras.map((word) => ({ ...word, at: round(word.at * factor), dur: round(word.dur * factor) })) };
}
