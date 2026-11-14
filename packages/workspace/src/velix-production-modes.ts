export type AuthorizedProductionClip = { source: string; start: number; end: number; rights: 'verified_allowed' | 'conditional' | 'unverified' | 'blocked' };
export type NewsProductionItem = { title: string; url: string; publisher: string; publishedAt: string | null; claimType: 'confirmed' | 'allegation' | 'unverified' };
export type VelixProductionBrief = { mode: 'commentary' | 'news'; brief: string; clips: AuthorizedProductionClip[]; references: NewsProductionItem[] };

function validClip(clip: AuthorizedProductionClip): boolean { return clip.rights === 'verified_allowed' && Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.start >= 0 && clip.end > clip.start; }

export function buildCommentaryProduction(input: { topic: string; style: string; clips: readonly AuthorizedProductionClip[]; rankingCriteria?: string }): VelixProductionBrief {
  if (!input.topic.trim() || !input.style.trim()) throw new Error('invalid: tema e estilo são obrigatórios.');
  if (input.clips.length === 0 || input.clips.some((clip) => !validClip(clip))) throw new Error('forbidden: a compilação só aceita clipes com direitos verificados e intervalos válidos.');
  const clips = input.clips.map((clip) => ({ ...clip }));
  const criteria = input.rankingCriteria?.trim();
  const ranking = criteria ? `\nRanking por: ${criteria}. A ordem aprovada é a posição final, do último para o primeiro lugar:\n${clips.map((clip, index) => `Posição ${clips.length - index}: ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} s`).join('\n')}\nJustifique cada posição pelo critério, sem inventar dados.` : '';
  return { mode: 'commentary', clips, references: [], brief: `Modo: Compilação Comentada\nTema: ${input.topic.trim()}\nEstilo: ${input.style.trim()}\nEstrutura: introdução original, comentário entre cada trecho na ordem aprovada e encerramento. Use somente os clipes autorizados listados; não atribua fatos sem fonte.${ranking}` };
}

export function buildNewsProduction(input: { topic: string; items: readonly NewsProductionItem[] }): VelixProductionBrief {
  if (!input.topic.trim() || input.items.length === 0) throw new Error('invalid: tema e ao menos uma fonte são obrigatórios.');
  for (const item of input.items) { try { const url = new URL(item.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { throw new Error('invalid: cada notícia precisa de uma URL HTTP(S) verificável.'); } }
  const references = input.items.map((item) => ({ ...item }));
  const labels = references.map((item) => `${item.claimType === 'confirmed' ? 'fato confirmado' : item.claimType === 'allegation' ? 'alegação' : 'não verificado'}: ${item.title} — ${item.publisher}${item.publishedAt ? ` (${item.publishedAt})` : ''} — ${item.url}`).join('\n');
  return { mode: 'news', clips: [], references, brief: `Modo: Noticiário\nTema: ${input.topic.trim()}\nUse somente as referências abaixo, distinguindo fatos confirmados, alegações e informações não verificadas. Exiba fonte, link e data na cena.\n${labels}` };
}
