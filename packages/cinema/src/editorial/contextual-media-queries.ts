/**
 * Contextual media queries.
 *
 * Builds scene search queries from the work, character, ability, action and context a scene narrates, instead of
 * generic templates ("<prompt title> Cena 9 scene clip"). Queries come in several languages and are deduplicated by a
 * canonical key, so equivalent wordings ("Fairy Tail Natsu anime clip" / "anime clip Natsu Fairy Tail") run once.
 */

const STOPWORDS = new Set([
  // pt-BR
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'para', 'com', 'sem', 'que', 'se', 'ao', 'aos', 'mais', 'muito', 'como', 'seu', 'sua', 'ele', 'ela', 'isso',
  'esse', 'essa', 'este', 'esta', 'aqui', 'ali', 'la', 'lá', 'sim', 'nao', 'não', 'quem', 'onde', 'quando', 'tem',
  'ser', 'era', 'foi', 'sao', 'são', 'cena', 'cenas',
  // en
  'the', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'with', 'by', 'at', 'from', 'is', 'clip', 'clips', 'scene',
  'scenes', 'video', 'official', 'hd', '4k', 'full',
]);

/** Common anime/game vocabulary written in Portuguese narration, with the term international uploads use. */
const PT_EN_GLOSSARY: Array<[RegExp, string]> = [
  [/expans[aã]o de dom[ií]nio/i, 'domain expansion'],
  [/energia amaldi[cç]oada/i, 'cursed energy'],
  [/t[eé]cnicas? inatas?/i, 'innate technique'],
  [/feiticeiros?/i, 'sorcerer'],
  [/maldi[cç][aã]o|maldi[cç][oõ]es/i, 'curse'],
  [/alquimia|alquimista/i, 'alchemy'],
  [/transmuta[cç][aã]o/i, 'transmutation'],
  [/troca equivalente/i, 'equivalent exchange'],
  [/c[ií]rculo de transmuta[cç][aã]o/i, 'transmutation circle'],
  [/grim[oó]rios?/i, 'grimoire'],
  [/anti[- ]?magia/i, 'anti magic'],
  [/ca[cç]adores? de drag[oõ]es|dragon slayers?/i, 'dragon slayer'],
  [/guildas?/i, 'guild'],
  [/linhas? (?:faciais|no rosto)|marcas? no rosto/i, 'face marks'],
  [/m[uú]sculos?/i, 'muscles'],
  [/nen\b/i, 'nen'],
  [/(?:hunter|ca[cç]ador)/i, 'hunter'],
  [/transforma[cç][aã]o|transforma/i, 'transformation'],
  [/lutas?|batalhas?|combate/i, 'fight'],
  [/torneio|exame/i, 'exam'],
  [/treinamento|treino/i, 'training'],
  [/abertura/i, 'opening'],
  // One Piece vocabulary
  [/haki(?:\s+(?:do\s+)?(?:armamento|observa[cç][aã]o|conquistador|rei))?/i, 'haki'],
  [/yonko|imperador(?:es)?(?:\s+do\s+mar)?/i, 'yonko emperor of the sea'],
  [/marinha|marines?\b/i, 'marines'],
  [/shichibukai|guerreiro[s]?\s+dos?\s+mares?/i, 'shichibukai warlord'],
  [/akuma\s*no\s*mi|fruta\s+do\s+diabo|devil\s+fruit/i, 'devil fruit akuma no mi'],
  [/grand\s*line|grande\s+linha/i, 'grand line'],
  [/novo\s+mundo|new\s+world/i, 'new world'],
  [/marineford/i, 'marineford'],
  [/wano(?:\s+kuni)?/i, 'wano kuni'],
  [/fish[\s-]?man(?:\s+island)?|ilha\s+dos\s+homens[\s-]?peixe/i, 'fish-man island'],
  [/pirata[s]?|kaizoku/i, 'pirates'],
  [/tripula[cç][aã]o|nakama|crew/i, 'crew nakama'],
  [/tesouro|one\s*piece/i, 'treasure one piece'],
  [/golpe|attack|technique/i, 'attack technique'],
  [/espada|sword|katana/i, 'sword katana'],
  [/barba\s*(?:negra|branca)|blackbeard|whitebeard/i, 'blackbeard whitebeard'],
  [/luffy|monkey\s+d\.\s+luffy/i, 'monkey d luffy'],
  [/zoro|roronoa\s+zoro/i, 'roronoa zoro'],
  [/sanji|vinsmoke\s+sanji/i, 'vinsmoke sanji'],
  [/nami/i, 'nami'],
  [/usopp/i, 'usopp'],
  [/chopper|tony\s+tony/i, 'tony tony chopper'],
  [/robin|nico\s+robin/i, 'nico robin'],
  [/franky/i, 'franky'],
  [/brook/i, 'brook'],
  [/jinbe/i, 'jinbe'],
  [/ace|portgas\s+d\.\s+ace/i, 'portgas d ace'],
  [/shanks|akagami\s+no\s+shanks|ruivo/i, 'red hair shanks'],
  [/mihawk|hawk\s*eyes/i, 'mihawk hawk eyes'],
  [/kaido/i, 'kaido'],
  [/big\s*mom|charlotte\s+linlin/i, 'big mom charlotte linlin'],
  [/law|trafalgar\s+law/i, 'trafalgar law'],
  [/doflamingo/i, 'doflamingo'],
  [/crocodile/i, 'crocodile'],
  [/enel/i, 'enel'],
  [/arlong/i, 'arlong'],
  [/smoker/i, 'smoker'],
  [/coby|koby/i, 'koby'],
  [/garp|monkey\s+d\.\s+garp/i, 'monkey d garp'],
  [/sengoku/i, 'sengoku'],
  [/rayleigh|silvers?\s+rayleigh/i, 'silvers rayleigh'],
  [/roger|gol\s+d\.\s+roger/i, 'gol d roger'],
  [/sab[oó]/i, 'sabo'],
  [/dragon|monkey\s+d\.\s+dragon/i, 'monkey d dragon'],
  [/revolucion[aá]rio|revolutionary/i, 'revolutionary army'],
  [/gorosei|cinco\s+anci[aã]os/i, 'five elders gorosei'],
  [/imu|im-sama/i, 'imu'],
  [/void\s+century|s[eé]culo\s+vazio/i, 'void century'],
  [/poneglyph|poneglifo/i, 'poneglyph'],
  [/laugh\s*tale|raftel/i, 'laugh tale raftel'],
  [/will\s+of\s+d|d\s+no\s+ishi/i, 'will of d'],
  [/joy\s+boy/i, 'joy boy'],
  [/gear\s*(?:second|third|fourth|fifth|2nd|3rd|4th|5th)/i, 'gear transformation'],
  [/conqueror'?s?\s+haki|haki\s+do\s+conquistador/i, 'conquerors haki'],
  [/observation\s+haki|haki\s+da\s+observa[cç][aã]o/i, 'observation haki'],
  [/armament\s+haki|haki\s+do\s+armamento/i, 'armament haki'],
  [/supreme\s+king|rei\s+dos\s+piratas/i, 'pirate king'],
];

export function normalizeQueryText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical key for query equivalence: accent/case/punctuation-insensitive, order-insensitive, stopword-free.
 * "Fairy Tail Natsu anime clip" and "anime Natsu — Fairy Tail" share a key.
 */
export function canonicalQueryKey(query: string): string {
  const tokens = normalizeQueryText(query)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(' ');
}

/** Removes queries equivalent to an earlier one (same canonical key) or empty after normalisation. */
export function dedupeEquivalentQueries(queries: readonly string[], alreadyRun?: ReadonlySet<string>): string[] {
  const seen = new Set<string>(alreadyRun ?? []);
  const out: string[] = [];
  for (const raw of queries) {
    const q = raw.replace(/\s+/g, ' ').trim();
    const key = canonicalQueryKey(q);
    if (!q || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/** Spoken-narration duration estimate: ~2.35 words/s in pt-BR, ~2.6 in English. */
export function estimateNarrationSec(text: string, language = 'pt-BR'): number {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const wps = /^en/i.test(language) ? 2.6 : 2.35;
  // Sentence pauses add ~0.25s each
  const pauses = (text.match(/[.!?…]+/g) ?? []).length * 0.25;
  return Number((words / wps + pauses).toFixed(1));
}

const MULTI_WORK_PATTERN =
  /\b(?:top\s*\d+\s+)?(?:\d+\s+)?(animes|mang[aá]s|jogos|games|filmes|s[eé]ries|doramas|webtoons)\b/i;

/** A ranking/list of several works (e.g. "TOP 5 animes com sistemas de magia"), not one work's internals. */
const DISTINCT_WORK_PATTERNS: RegExp[] = [
  /\bsuper\s+mario(?:\s+(?:bros|64|odyssey|galaxy|world))?\b/i,
  /\bsonic(?:\s+the\s+hedgehog)?\b/i,
  /\b(?:grand\s+theft\s+auto|gta)(?:\s+(?:san\s+andreas|v|iv|vice\s+city|vi))?\b/i,
  /\bred\s+dead\s+redemption(?:\s+2)?\b/i,
  /\bcyberpunk(?:\s*2077)?\b/i,
  /\belden\s+ring\b/i,
  /\bdark\s+souls(?:\s*(?:3|iii|2|ii))?\b/i,
  /\bsekiro\b/i,
  /\bbloodborne\b/i,
  /\bthe\s+witcher(?:\s*3)?\b/i,
  /\bzelda\b/i,
  /\bgod\s+of\s+war\b/i,
  /\bhollow\s+knight\b/i,
  /\bminecraft\b/i,
  /\bdragon\s+ball(?:\s+(?:z|super|gt))?\b/i,
  /\bnaruto\b/i,
  /\bone\s+piece\b/i,
  /\battack\s+on\s+titan\b/i,
  /\bjujutsu\s+kaisen\b/i,
  /\bbleach\b/i,
  /\bdemon\s+slayer\b/i,
];

export function isMultiWorkPrompt(prompt: string): boolean {
  if (MULTI_WORK_PATTERN.test(prompt) && /\b(top\s*\d+|\d+\s+(?:animes|jogos|games|filmes|s[eé]ries|mang[aá]s)|ranking|melhores|lista)\b/i.test(prompt)) {
    return true;
  }
  let matchedWorks = 0;
  for (const re of DISTINCT_WORK_PATTERNS) {
    if (re.test(prompt)) {
      matchedWorks += 1;
      if (matchedWorks >= 2) return true;
    }
  }
  return false;
}

const REFERENCE_TRIGGER_PATTERN =
  /\b(?:quem (?:gostou|curtiu|ama|adorou|curte|gosta) de|f[aã]s de|parecid[oa]s? com|similares? a|semelhantes? a|no estilo de|for fans of|if you liked)\s+/giu;
const REFERENCE_NAME_PATTERN = /^([A-Z0-9][\p{L}\p{N}'’!?-]*(?:\s+(?:[A-Z0-9][\p{L}\p{N}'’!?:-]*|of|no|wo|x|the))*)/u;

/** Works the prompt uses as a reference point ("para quem gostou de Black Clover" → "Black Clover"). */
export function detectReferenceWorks(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(REFERENCE_TRIGGER_PATTERN)) {
    const rest = prompt.slice((m.index ?? 0) + m[0].length);
    const raw = REFERENCE_NAME_PATTERN.exec(rest)?.[1] ?? '';
    const name = raw.replace(/[\s:–—-]+$/u, '').replace(/\s+(?:of|no|wo|the|x)$/i, '').trim();
    if (name.length >= 3 && name.split(/\s+/).length <= 6) out.push(name);
  }
  // Fallback for TOP N / ranking prompts: extract proper nouns after ":" separated by commas or " e ".
  // Covers prompts like "TOP 5 jogos: Tomb Raider, Exodus e Fable" where no fan-of trigger exists.
  if (out.length === 0 && /top\s*\d+|ranking|\b\d+\s+(?:jogos|filmes|animes|descobertas|produtos)/i.test(prompt)) {
    const afterColon = prompt.split(':').slice(1).join(':');
    if (afterColon) {
      const segments = afterColon.split(/[,;]|\s+e\s+/i).map((s) => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const match = REFERENCE_NAME_PATTERN.exec(seg);
        const name = match?.[1]?.replace(/[\s:–—-]+$/u, '').replace(/\s+(?:of|no|wo|the|x)$/i, '').trim() ?? '';
        if (name.length >= 3 && name.split(/\s+/).length <= 6) out.push(name);
      }
    }
  }
  return [...new Set(out)];
}

const PROPER_NOUN_PATTERN = /\b([A-ZÀ-Ý][\p{L}'’-]+(?:\s+(?:[A-ZÀ-Ý][\p{L}'’-]+|x|no|de|of)){0,3})/gu;
const NON_NAME_WORDS = new Set(
  [
    'Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto', 'Sexto', 'Sétimo', 'Oitavo', 'Nono', 'Décimo', 'Lugar',
    'Agora', 'Hoje', 'Aqui', 'Mas', 'Por', 'Nos', 'Nas', 'Sim', 'Lá', 'Em', 'No', 'Na', 'Os', 'As', 'O', 'A', 'E', 'É',
    'Um', 'Uma', 'Se', 'Quem', 'Quando', 'Isso', 'Esse', 'Essa', 'Este', 'Esta', 'Então', 'Comparando', 'Ele', 'Ela',
    'Criado', 'Sistema', 'Magia', 'Anime', 'Animes', 'Mangá', 'Manga', 'Você', 'Vamos', 'Até', 'Também', 'Todo',
    'Toda', 'Cada', 'Com', 'Sem', 'Para', 'Pra', 'Que', 'Como', 'Weekly', 'Shonen', 'Jump', 'Magazine', 'The', 'And',
    'Protagonista', 'Por', 'Trás', 'Quanto', 'Nesse', 'Nessa', 'Desse', 'Dessa', 'Dele', 'Dela', 'Seu', 'Sua', 'Só',
    'Tudo', 'Nada', 'Mesmo', 'Ainda', 'Já', 'Depois', 'Antes', 'Enquanto', 'Muito', 'Pouco', 'Bem', 'Mal', 'Assim',
  ].map((w) => w.toLowerCase()),
);

const stripMarks = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '');

const STUDIOS_AND_PUBLISHERS = [
  'mappa', 'madhouse', 'a-1 pictures', 'pictures', 'bones', 'ufotable', 'pierrot', 'toei', 'sunrise', 'wit studio',
  'cloverworks', 'j.c.staff', 'kyoto animation', 'production i.g', 'david production', 'trigger', 'satelight',
  'studio deen', 'tms', 'shueisha', 'kodansha', 'shogakukan', 'square enix', 'crunchyroll', 'netflix',
];

function isStudioOrPublisher(name: string): boolean {
  const n = stripMarks(name).toLowerCase().trim();
  return STUDIOS_AND_PUBLISHERS.some((s) => n === s || n.endsWith(` ${s}`));
}

/**
 * Proper names that matter visually (characters, techniques, places) from the scene narration and the entity facts.
 * Only names also grounded in the research facts — or repeated in the narration — are kept, so a passing mention
 * of another work does not become a search term.
 */
export function extractVisualKeywords(input: {
  narrationText: string;
  entityName?: string;
  facts?: readonly string[];
  excludeNames?: readonly string[];
  max?: number;
}): string[] {
  const max = input.max ?? 4;
  const entityNorm = normalizeQueryText(input.entityName ?? '');
  const excluded = new Set((input.excludeNames ?? []).map((n) => normalizeQueryText(n)).filter(Boolean));
  const factsNorm = normalizeQueryText((input.facts ?? []).join(' '));
  const narrNorm = normalizeQueryText(input.narrationText);
  const collect = (text: string): string[] => {
    const names: string[] = [];
    let lastCreditEnd = -1;
    for (const m of text.matchAll(PROPER_NOUN_PATTERN)) {
      const at = m.index ?? 0;
      const before = text.slice(Math.max(0, at - 32), at);
      // Authors, studios and publishers are not visible on screen: "mangá de X e Y", "Jujutsu Kaisen, de X",
      // "anime pela A-1 Pictures", "do estúdio MAPPA".
      const credit =
        /\b(?:criad[oa]|escrit[oa]|desenhad[oa]|ilustrad[oa]|obra|mang[aá]|autor[a]?|dirigid[oa]|produzid[oa]|animad[oa]|est[uú]dio)\s+(?:por|de|pel[oa])\s*$/i.test(before) ||
        /\b(?:anime|adapta[cç][aã]o|s[eé]rie)\s+(?:pel[oa]|d[oa])\s*$/i.test(before) ||
        /\best[uú]dio\s*$/i.test(before) ||
        /,\s*de\s*$/i.test(before) ||
        (lastCreditEnd >= 0 && /^\s+e\s+$/i.test(text.slice(lastCreditEnd, at))) ||
        isStudioOrPublisher(m[1] ?? '');
      if (credit) {
        lastCreditEnd = at + (m[0]?.length ?? 0);
        continue;
      }
      const words = (m[1] ?? '').split(/\s+/).filter((w) => !NON_NAME_WORDS.has(stripMarks(w).toLowerCase()));
      const name = words.join(' ').replace(/^(?:de|of|no|x)\s+|\s+(?:de|of|no|x)$/gi, '').trim();
      if (name.length < 3) continue;
      // A single capitalised word opening a sentence is grammar, not a name.
      const sentenceInitial = at === 0 || /[.!?…:;"“(\n]\s*$/.test(before);
      if (sentenceInitial && name.split(/\s+/).length === 1 && words.length === (m[1] ?? '').split(/\s+/).length) continue;
      names.push(name);
    }
    return names;
  };
  const scored = new Map<string, { name: string; score: number }>();
  const add = (name: string, weight: number) => {
    const norm = normalizeQueryText(name);
    if (!norm || norm.length < 3) return;
    if (entityNorm && (entityNorm.includes(norm) || norm.includes(entityNorm))) return;
    if ([...excluded].some((ex) => ex.includes(norm) || norm.includes(ex))) return;
    const prev = scored.get(norm);
    scored.set(norm, { name: prev?.name ?? name, score: (prev?.score ?? 0) + weight });
  };
  for (const name of collect(input.narrationText)) {
    const norm = normalizeQueryText(name);
    const grounded = factsNorm.includes(norm) || norm.split(' ').some((t) => t.length >= 4 && factsNorm.includes(t));
    // Narration-only names need repetition to count; names grounded in the research facts count at once.
    add(name, grounded ? 3 : 0.6);
  }
  for (const name of collect((input.facts ?? []).join('. '))) {
    const norm = normalizeQueryText(name);
    add(name, narrNorm.includes(norm) ? 2 : 0.5);
  }
  return [...scored.values()]
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.name);
}

/** International (English) terms for Portuguese ability/action vocabulary found in the text. */
export function translateVisualTerms(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const [re, en] of PT_EN_GLOSSARY) {
    if (re.test(text) && !out.includes(en)) out.push(en);
    if (out.length >= max) break;
  }
  return out;
}

export type ContextualQueryDomain = 'anime' | 'gaming' | 'technology' | 'documentary' | 'general';

export interface ContextualQueryInput {
  /** The work the scene must show (anime/game title). */
  work: string;
  /** Characters, techniques or places the scene narrates. */
  keywords?: readonly string[];
  /** English terms for abilities/actions (from the glossary). */
  actionTerms?: readonly string[];
  domain: ContextualQueryDomain;
  /** Overview/montage scenes (hook, promise, outro) ask for trailers/openings rather than one event. */
  overview?: boolean;
  max?: number;
}

/**
 * Search queries for one scene, most specific first, in English and Portuguese. The work title is always present:
 * a query without the work would return lookalikes that can never prove identity.
 */
export function buildContextualSceneQueries(input: ContextualQueryInput): string[] {
  const work = input.work.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!work) return [];
  const kws = (input.keywords ?? []).filter(Boolean);
  const acts = (input.actionTerms ?? []).filter(Boolean);
  const char = kws[0];
  const second = kws[1];
  const act = acts[0];
  const out: string[] = [];
  if (input.domain === 'anime') {
    if (input.overview) {
      out.push(`${work} anime official trailer`, `${work} opening`, `${work} trailer oficial legendado`, `${work} PV`);
      if (char) out.push(`${work} ${char} anime`);
    } else {
      if (char && act) out.push(`${work} ${char} ${act} anime`);
      if (char) out.push(`${work} ${char} anime scene`);
      if (act) out.push(`${work} ${act} anime`);
      if (second) out.push(`${work} ${second} anime`);
      if (char) out.push(`${work} ${char} cena dublado`);
      // Episode/arc-specific queries for deeper coverage
      if (char && second) out.push(`${work} ${char} vs ${second} anime`);
      if (char) out.push(`${work} ${char} backstory anime`);
      if (char) out.push(`${work} ${char} reveal anime scene`);
      if (act) out.push(`${work} ${act} moment anime`);
      // Location/setting queries
      out.push(`${work} anime iconic scene`);
      out.push(`${work} anime emotional moment`);
      out.push(`${work} anime official trailer`, `${work} anime fight scene`, `${work} cena anime`);
    }
  } else if (input.domain === 'gaming') {
    if (input.overview) {
      out.push(`${work} official trailer`, `${work} gameplay trailer`);
    } else {
      if (char && act) out.push(`${work} ${char} ${act} gameplay`);
      if (char) out.push(`${work} ${char} gameplay`);
      if (act) out.push(`${work} ${act} gameplay`);
      out.push(`${work} gameplay no commentary`, `${work} official trailer`, `${work} gameplay pt-br`);
    }
  } else {
    if (char) out.push(`${work} ${char}`);
    if (act) out.push(`${work} ${act}`);
    out.push(`${work} official footage`, `${work} documentary footage`, `${work} cenas`);
  }
  return dedupeEquivalentQueries(out).slice(0, input.max ?? 6);
}
