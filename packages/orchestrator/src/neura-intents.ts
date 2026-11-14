import type { SpotifyCommand, SpotifySearchType } from '@neuralbridge/shared';

export const NEURA_APPS = { spotify: 'spotify', teams: 'teams', configuracoes: 'settings', settings: 'settings', 'bloco de notas': 'notepad', notepad: 'notepad', calculadora: 'calculator', calculator: 'calculator' } as const;
export type NeuraApplication = (typeof NEURA_APPS)[keyof typeof NEURA_APPS];

export type ParsedIntent =
  | { target: 'pause_all' }
  /** The app's own switches: a closed list, like everything else here. */
  | { target: 'silent_mode'; enabled: boolean }
  | { target: 'agent'; agent: 'claude' | 'codex' }
  | { target: 'panel'; open: boolean }
  | { target: 'help' }
  | { target: 'time' }
  | { target: 'date' }
  | { target: 'weather' }
  | { target: 'spotify_playlists' }
  | { target: 'spotify_saved_tracks' }
  | { target: 'spotify_followed_artists' }
  | { target: 'spotify_devices' }
  | { target: 'spotify_transfer'; deviceName: string }
  | { target: 'spotify_current' }
  | { target: 'screen' }
  | { target: 'reply_chat'; instruction: string }
  | { target: 'spotify'; command: SpotifyCommand }
  /** "Play X": the search result, not the words, is what reaches the player. */
  | { target: 'spotify_play_search'; query: string; types?: SpotifySearchType[] }
  | { target: 'open_app'; application: NeuraApplication }
  | { target: 'unsupported_app'; name: string }
  | { target: 'conversation'; text: string };

/**
 * The transcriber puts a comma after a greeting, and writes a spoken "Ei" as "Em" and "Neura" as "Neora", "Neure" or, when it
 * takes the language for Russian, "Не ура". `\b` only knows Latin letters, hence the lookahead.
 */
export interface WakeWordOptions { primary?: string; aliases?: readonly string[]; }

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const wakePattern = (options: WakeWordOptions = {}): RegExp => {
  const words = [options.primary ?? 'Void', ...(options.aliases ?? ['Neura'])].map((word) => word.trim()).filter(Boolean).map(escapeRegex);
  const legacyAliases = options.primary === undefined && options.aliases === undefined ? ['ne[uo]r[ae]', 'не ?ура'] : [];
  const variants = [...words, ...legacyAliases];
  return new RegExp(`^(?:(?:ei|em|hei|hello|hey|oi|ok|ol[aá])[\\s,.!]+)?(?:${[...new Set(variants)].join('|')})(?![\\p{L}\\p{N}])[\\s,.:;!?-]*`, 'iu');
};

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const hasWakeWord = (text: string, options?: WakeWordOptions): boolean => wakePattern(options).test(fold(text));

/** Removes the wake word and keeps the original spelling of the rest, which a Spotify search needs. */
function withoutWake(text: string, options?: WakeWordOptions): string {
  const trimmed = text.trim();
  return trimmed.replace(wakePattern(options), '').trim();
}

export const isWakeOnly = (text: string, options?: WakeWordOptions): boolean => hasWakeWord(text, options) && !withoutWake(text, options);

/**
 * A closed list of phrases mapped to typed intents. Anything else is conversation, which only ever produces text:
 * no word of a transcript becomes a command line, a URL or an application name.
 */
export function parseNeuraIntent(input: string, options?: WakeWordOptions): ParsedIntent {
  const text = withoutWake(input, options);
  const phrase = fold(text).replace(/[.!?]+$/u, '');
  if (/^(pausa|pare|para|pausar|parar) tudo$|^(pause|stop) (everything|all|listening)$/u.test(phrase)) return { target: 'pause_all' };
  if (/^(ativa|ativar|ativa o|liga|ligar|liga o|entra no|entrar no) modo silencioso$|^(turn on|enable) silent mode$/u.test(phrase)) return { target: 'silent_mode', enabled: true };
  if (/^(desativa|desativar|desativa o|desliga|desligar|desliga o|sai do|sair do) modo silencioso$|^(turn off|disable) silent mode$/u.test(phrase)) return { target: 'silent_mode', enabled: false };
  const agent = /^(?:usa|use|usar|muda para|troca para|mudar para|trocar para|switch to)(?: o| the)? (claude|codex)$/u.exec(phrase);
  if (agent?.[1]) return { target: 'agent', agent: agent[1] as 'claude' | 'codex' };
  if (/^(abre|abra|abrir|mostra|mostrar) (o )?painel$|^(open|show) (the )?panel$/u.test(phrase)) return { target: 'panel', open: true };
  if (/^(fecha|feche|fechar|esconde|esconder|minimiza|minimizar) (o )?painel$|^(close|hide) (the )?panel$/u.test(phrase)) return { target: 'panel', open: false };
  if (/^(o que voce (pode|sabe) fazer|quais sao (os )?(seus )?comandos|ajuda|help|what can you do)$/u.test(phrase)) return { target: 'help' };
  if (/^(que horas sao|que horas e|qual a hora|me diz as horas|what time is it|whats the time)$/u.test(phrase)) return { target: 'time' };
  if (/^(que dia e hoje|qual a data de hoje|que data e hoje|what day is it|whats the date)$/u.test(phrase)) return { target: 'date' };
  if (/^(como esta o tempo|qual e a previsao|qual a previsao|como esta a previsao|previsao do tempo|how('s| is) the weather|what('s| is) the weather|weather forecast)$/u.test(phrase)) return { target: 'weather' };
  if (/^(quais|qual) (sao|são) (as )?minhas playlists$|^listar (minhas )?playlists$|^what are my playlists$|^list my playlists$/u.test(phrase)) return { target: 'spotify_playlists' };
  if (/^(quais|qual) (sao|são) (as )?(minhas )?(musicas curtidas|músicas curtidas|musicas salvas|músicas salvas)$|^listar (minhas )?(musicas curtidas|músicas curtidas|musicas salvas|músicas salvas)$|^(what are|list) my (liked|saved) songs$/u.test(phrase)) return { target: 'spotify_saved_tracks' };
  if (/^(quais|qual) (sao|são) (os )?(artistas que sigo|artistas seguidos)$|^listar (meus )?artistas seguidos$|^(what are|list) my followed artists$/u.test(phrase)) return { target: 'spotify_followed_artists' };
  if (/^(quais|qual) (sao|são) (os )?(dispositivos|aparelhos) do spotify$|^listar (meus )?(dispositivos|aparelhos) do spotify$|^(what are|list) my spotify devices$/u.test(phrase)) return { target: 'spotify_devices' };
  const transfer = /^(?:mude|troque|transfira|manda|envia)(?: o| a)? spotify (?:para|pra|pro) (?:o|a)? (.+)$|^(?:switch|move|send) spotify (?:to|onto) (?:the )?(.+)$/u.exec(phrase);
  if (transfer) return { target: 'spotify_transfer', deviceName: (transfer[1] ?? transfer[2] ?? '').trim().slice(0, 200) };
  if (/^(qual|o que esta tocando|o que está tocando|qual musica esta tocando|what('s| is) playing|current song)$/u.test(phrase)) return { target: 'spotify_current' };
  if (/^(o que (esta|está) (aparecendo|aparece) na (?:minha )?tela|o que tem na (?:minha )?tela|descreva minha tela|what('s| is) on my screen|describe my screen)$/u.test(phrase)) return { target: 'screen' };
  const reply = /^(?:responda|responder|respond|reply)(?: (?:a|ao|no|na|este|esse|the|to|in) (?:este |esse |this |that |the )?(?:chat|mensagem|message))?(?: (?:dizendo|com|saying|that))?(?: (.+))?$/u.exec(phrase);
  if (reply && (phrase.includes('chat') || phrase.includes('mensagem') || phrase.includes('message') || phrase === 'responda' || phrase === 'respond' || phrase === 'reply')) return { target: 'reply_chat', instruction: reply[1] ?? '' };
  if (/^(pausa|pausar|pare|para|parar)( a)? (musica|spotify)$|^(pausa|pause|da pausa|dar pausa)$|^(pause|stop)(?: (?:the )?(?:music|spotify))?$/u.test(phrase)) return { target: 'spotify', command: { action: 'pause' } };
  if (/^(continua|continuar|retoma|retomar)( a)? (musica|spotify)$|^(da play|dar play|play|inicia|iniciar|começa|comecar)(?: (?:a )?(?:musica|spotify))?$|^(resume|continue)(?: (?:the )?(?:music|spotify))?$/u.test(phrase)) return { target: 'spotify', command: { action: 'play' } };
  if (/^(proxima|pula|pular|avanca)( a)?( musica| faixa)?$|^(muda|troca)( de)?( musica| faixa)$|^(next|skip)( song| track)?$|^(change|switch)( the)?( song| track)$/u.test(phrase)) return { target: 'spotify', command: { action: 'next' } };
  if (/^(musica|faixa) anterior$|^volta( a)? musica$|^previous( song| track)?$|^(go|back) to (the )?(previous|last) (song|track)$/u.test(phrase)) return { target: 'spotify', command: { action: 'previous' } };
  const volume = /^(?:volume|(?:coloca|poe|muda|ajusta|set)(?: o)? volume)(?: (?:em|para|to|a))? (\d{1,3})(?: ?%| por cento| percent)?$/u.exec(phrase);
  if (volume?.[1] && Number(volume[1]) <= 100) return { target: 'spotify', command: { action: 'volume', volume: Number(volume[1]) } };
  const playText = text.replace(/[.!?]+$/u, '').trim();
  const collection = /^(?:toca|tocar|toque|play|coloca|poe|põe)\s+(?:o|a|the)?\s*(album|álbum|artist|artista|playlist)\s+(.+)$/iu.exec(playText);
  if (collection?.[2]) {
    const kind = fold(collection[1] ?? '');
    const type: SpotifySearchType = kind === 'playlist' ? 'playlist' : kind === 'artist' || kind === 'artista' ? 'artist' : 'album';
    return { target: 'spotify_play_search', query: collection[2].trim().slice(0, 200), types: [type] };
  }
  const play = /^(?:toca|tocar|toque|play|coloca|poe|põe)\s+(.+)$/iu.exec(playText);
  if (play?.[1]) return { target: 'spotify_play_search', query: play[1].slice(0, 200) };
  const open = /^(?:abre|abra|abrir|open)(?: o| a| as| the)? (.+)$/u.exec(phrase);
  if (open?.[1]) {
    const application = NEURA_APPS[open[1] as keyof typeof NEURA_APPS];
    return application ? { target: 'open_app', application } : { target: 'unsupported_app', name: open[1].slice(0, 100) };
  }
  return { target: 'conversation', text };
}
