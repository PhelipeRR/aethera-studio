import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installVelixDossie, runVelixCommand, velixKitPath, velixVideoSlug } from './velix.js';
import { loadNarrationSidecar, saveNarrationTimeline } from './velix-narration.js';

export type VelixWord = { w: string; s: number; e: number };
export type VelixVideoState = { folder: string; narration: string; data: string; audio: string | null; synced: boolean; images: string[] };
type Block = Record<string, unknown> & { frase?: string; at?: number };
type Scene = { at?: number; frase?: string; fonte?: string; blocos?: Block[] };

const AUDIO_FILE = /^(voz|voice-[0-9a-f-]+)\.(mp3|wav|m4a)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const WORDS_PER_SECOND = 2.5;
const TAIL_SECONDS = 1.2;
const ANCHOR_WORDS = 6;

const folderOf = (root: string, video: string) => join(realpathSync(root), velixVideoSlug(video));
const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const clean = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (text: string) => text.split(/\s+/).map(clean).filter(Boolean);

export function listVelixVideos(root: string): string[] {
  const base = realpathSync(root);
  return readdirSync(base, { withFileTypes: true }).filter((item) => item.isDirectory() && existsSync(join(base, item.name, 'motion', 'roteiro.json'))).map((item) => item.name).sort();
}

export function loadVelixVideo(root: string, video: string): VelixVideoState {
  const folder = folderOf(root, video);
  const voice = join(folder, 'narracao');
  const audio = existsSync(voice) ? readdirSync(voice).find((file) => AUDIO_FILE.test(file)) ?? null : null;
  const images = ['pesquisa', 'prints'].flatMap((part) => (existsSync(join(folder, part)) ? readdirSync(join(folder, part)).filter((file) => IMAGE_FILE.test(file)).map((file) => `../${part}/${file}`) : []));
  return { folder: velixVideoSlug(video), narration: read(join(voice, 'elevenlabs.txt')), data: read(join(folder, 'motion', 'roteiro.json')), audio, synced: existsSync(join(voice, 'palavras.json')), images };
}

export function saveVelixVideo(root: string, video: string, changes: { narration?: string | undefined; data?: string | undefined }): void {
  const folder = folderOf(root, video);
  if (changes.data !== undefined) {
    try { JSON.parse(changes.data); } catch { throw new Error('invalid: os dados das cenas não são JSON válido.'); }
    mkdirSync(join(folder, 'motion'), { recursive: true });
    writeFileSync(join(folder, 'motion', 'roteiro.json'), changes.data);
  }
  if (changes.narration !== undefined) {
    mkdirSync(join(folder, 'narracao'), { recursive: true });
    writeFileSync(join(folder, 'narracao', 'elevenlabs.txt'), changes.narration);
  }
}

/** Adds approved source intervals to the existing Dossiê timeline without creating a second editor. */
export function appendVelixClipScenes(data: string, clips: readonly { source: string; start: number; end: number; rights: string }[]): string {
  const parsed = JSON.parse(data) as { duracao?: number; cenas?: Scene[] };
  const scenes = parsed.cenas ?? [];
  let at = parsed.duracao ?? scenes.at(-1)?.at ?? 0;
  for (const clip of clips) {
    if (!(clip.start >= 0 && clip.end > clip.start) || clip.rights !== 'verified_allowed') throw new Error('forbidden: cortes precisam de intervalo válido e direitos verificados.');
    const duration = clip.end - clip.start;
    scenes.push({ at, fonte: `Mídia autorizada: ${clip.source}`, blocos: [{ tipo: 'video', src: clip.source, in: clip.start, out: clip.end, duracao: duration, rights: clip.rights }] });
    at += duration;
  }
  parsed.cenas = scenes;
  parsed.duracao = Number(at.toFixed(3));
  return JSON.stringify(parsed, null, 2);
}

/** Times from the text alone, so scenes are in order before there is any voice. */
export function estimateVelixWords(narration: string): VelixWord[] {
  return narration.split(/\s+/).filter(Boolean).map((w, index) => ({ w, s: index / WORDS_PER_SECOND, e: (index + 1) / WORDS_PER_SECOND }));
}

function findAnchor(anchor: string, words: readonly string[], from: number): number {
  const wanted = tokens(anchor).slice(0, ANCHOR_WORDS);
  if (wanted.length === 0) return -1;
  let best = -1;
  let bestScore = 0;
  for (let index = from; index < words.length; index++) {
    const score = wanted.filter((word, offset) => words[index + offset] === word).length / wanted.length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
    if (score === 1) break;
  }
  return bestScore >= 0.5 ? best : -1;
}

/** Puts each scene and block on the spoken word of its "frase"; one not found goes evenly between its neighbours. */
export function syncVelixScenes(data: string, spoken: readonly VelixWord[]): { data: string; missed: number } {
  const parsed = JSON.parse(data) as { cenas?: Scene[]; duracao?: number };
  const words = spoken.map((word) => clean(word.w));
  const end = spoken.at(-1)?.e ?? 0;
  const marks: Array<{ anchor: string | undefined; set: (time: number) => void }> = [];
  (parsed.cenas ?? []).forEach((scene) => {
    const first = scene.frase ?? scene.blocos?.[0]?.frase;
    marks.push({ anchor: first, set: (time) => { scene.at = time; } });
    (scene.blocos ?? []).forEach((block) => marks.push({ anchor: block.frase ?? first, set: (time) => { block.at = time; } }));
  });
  let cursor = 0;
  const times = marks.map(({ anchor }) => {
    const found = anchor ? findAnchor(anchor, words, cursor) : -1;
    if (found < 0) return null;
    cursor = found;
    return spoken[found]?.s ?? null;
  });
  const missed = times.filter((time) => time === null).length;
  times.forEach((time, index) => {
    if (time !== null) return;
    const previous = times.slice(0, index).findLastIndex((item) => item !== null);
    const next = times.findIndex((item, position) => position > index && item !== null);
    const from = previous >= 0 ? (times[previous] ?? 0) : 0;
    const to = next >= 0 ? (times[next] ?? end) : end;
    times[index] = from + (to - from) / ((next >= 0 ? next : marks.length) - previous) * (index - previous);
  });
  marks.forEach((mark, index) => mark.set(Number((times[index] ?? 0).toFixed(2))));
  (parsed.cenas ?? []).forEach((scene, index) => { scene.at = index === 0 ? 0 : Number(Math.max((scene.at ?? 0) - 0.15, 0).toFixed(2)); });
  parsed.duracao = Number((end + TAIL_SECONDS).toFixed(2));
  return { data: JSON.stringify(parsed, null, 2), missed };
}

/** Transcribes the user's voice with the kit and moves every scene to the words actually spoken. */
export async function syncVelixVoice(root: string, video: string, options: { kitPath?: string; python?: string } = {}): Promise<{ missed: number }> {
  const kitPath = options.kitPath ?? velixKitPath();
  const state = loadVelixVideo(root, video);
  if (!state.audio) throw new Error('invalid: salve a voz em narracao/voz.mp3 antes de sincronizar.');
  const folder = folderOf(root, video);
  const words = join(folder, 'narracao', 'palavras.json');
  await runVelixCommand(options.python ?? process.env['NB_PYTHON'] ?? 'python', [join(kitPath, 'scripts', 'transcrever.py'), join(folder, 'narracao', state.audio), words, '--idioma', 'pt'], { cwd: folder });
  const spoken = (JSON.parse(readFileSync(words, 'utf8')) as { words: VelixWord[] }).words;
  if (spoken.length === 0) throw new Error('A transcrição não encontrou fala no áudio.');
  const result = syncVelixScenes(state.data, spoken);
  saveVelixVideo(root, video, { data: result.data });
  const narration = loadNarrationSidecar(root, video);
  if (narration.asset) await saveNarrationTimeline(root, video, { assetId: narration.asset.id, relativePath: narration.asset.relativePath, startMs: 0, endMs: Math.round(((spoken.at(-1)?.e ?? 0) + TAIL_SECONDS) * 1_000), syncStatus: result.missed > 0 ? 'needs-review' : 'synced' });
  return { missed: result.missed };
}

export function prepareVelixStudio(root: string, video: string, kitPath: string = velixKitPath()): void {
  const folder = folderOf(root, video);
  mkdirSync(join(folder, 'motion'), { recursive: true });
  installVelixDossie(kitPath, join(folder, 'motion'));
}
