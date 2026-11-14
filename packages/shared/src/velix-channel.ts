import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

export const channelConnectionSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.enum(['disconnected', 'connected', 'expired', 'error']), channelId: text(200).nullable(), title: text(200).nullable(), handle: z.string().trim().max(200).nullable(), scopes: z.array(text(200)).max(20), auditDeclared: z.boolean(), connectedAt: z.string().datetime().nullable(),
});
/** Fonts a piece may use: the OFL files embedded in the pieces, plus the two IBM Plex ids saved by earlier versions. */
export const BRAND_FONTS = ['inter', 'ibm-plex-sans', 'ibm-plex-mono', 'anton', 'archivo-black', 'bebas', 'serif', 'grotesk', 'fredoka', 'mono'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];
export const BRAND_TEMPLATE_IDS = ['premium', 'fintech', 'crescimento', 'cyber', 'energia', 'neon', 'clean', 'quente', 'suave'] as const;
export type BrandTemplateId = (typeof BRAND_TEMPLATE_IDS)[number];
export const brandIdentitySchema = z.strictObject({ schemaVersion: z.literal(1), source: z.enum(['extracted', 'created']), direction: z.string().trim().min(1).max(80), mode: z.enum(['dark', 'light']), tokens: z.record(z.string(), z.string().regex(/^#[0-9a-f]{6}$/i)), fonts: z.strictObject({ title: z.enum(BRAND_FONTS), accent: z.enum(BRAND_FONTS) }), template: z.enum(BRAND_TEMPLATE_IDS).optional(), symbol: z.strictObject({ style: z.enum(['monograma', 'seta', 'ponto']), initials: text(12) }), name: z.string().trim().max(100).optional(), tagline: z.string().trim().max(200), palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(12), pieces: z.array(z.strictObject({ kind: text(50), width: z.number().int().positive(), height: z.number().int().positive(), path: text(500), sha256: z.string().regex(/^[a-f0-9]{64}$/i) })).max(20), approvedAt: z.string().datetime().nullable(), });
export const publishDraftSchema = z.strictObject({ schemaVersion: z.literal(1), id: text(100), videoAssetId: text(200), title: text(100), description: z.string().max(5_000), tags: z.array(text(100)).max(500), thumbnailPath: z.string().trim().max(500).nullable(), privacy: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().datetime().nullable(), categoryId: text(20), madeForKids: z.boolean(), scores: z.strictObject({ title: z.number(), description: z.number(), tags: z.number() }), status: z.enum(['draft', 'awaiting_approval', 'uploading', 'uploaded', 'scheduled', 'failed', 'cancelled']), youtubeVideoId: z.string().trim().max(200).nullable(), });
export const agendaItemSchema = z.strictObject({ schemaVersion: z.literal(1), id: text(100), origin: z.enum(['youtube', 'planned']), title: text(200), at: z.string().datetime(), state: z.enum(['planned', 'scheduled', 'published', 'cancelled']), ideaId: z.string().trim().max(100).nullable(), productionId: z.string().trim().max(100).nullable() });
export const nicheReferenceSchema = z.strictObject({ schemaVersion: z.literal(1), query: text(200), region: text(20), language: text(20), days: z.number().int().min(1).max(365), n: z.number().int().min(1).max(500), stats: z.record(z.string(), z.unknown()) });
export type ChannelConnection = z.infer<typeof channelConnectionSchema>;
export type BrandIdentity = z.infer<typeof brandIdentitySchema>;
export type PublishDraft = z.infer<typeof publishDraftSchema>;
export type AgendaItem = z.infer<typeof agendaItemSchema>;
export type NicheReference = z.infer<typeof nicheReferenceSchema>;
export type PublishInput = Pick<PublishDraft, 'title' | 'description' | 'tags' | 'privacy' | 'publishAt'>;
export function validatePublishInput(input: PublishInput, now = Date.now()): PublishInput {
  if (!/^.{1,100}$/su.test(input.title) || /[<>]/u.test(input.title)) throw new Error('invalid: o título precisa ter de 1 a 100 caracteres e não conter < ou >.');
  if (input.description.length > 5_000) throw new Error('invalid: a descrição excede 5.000 caracteres.');
  if (input.tags.join('').length > 500) throw new Error('invalid: as tags excedem 500 caracteres.');
  if (input.publishAt) {
    if (input.privacy !== 'private') throw new Error('invalid: vídeos agendados precisam ser privados.');
    if (Date.parse(input.publishAt) < now + 15 * 60 * 1000) throw new Error('invalid: o horário precisa estar pelo menos 15 minutos no futuro.');
  }
  return input;
}
const relativeLuminance = (hex: string): number => { const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => Number.parseInt(part, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4); return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0); };
export const brandContrastRatio = (foreground: string, background: string): number => { const a = relativeLuminance(foreground); const b = relativeLuminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
export function validateBrandIdentity(identity: BrandIdentity): BrandIdentity {
  const value = brandIdentitySchema.parse(identity); const ratio = brandContrastRatio(value.tokens.foreground ?? '', value.tokens.background ?? '');
  if (ratio < 4.5) throw new Error(`invalid: contraste da identidade abaixo de AA (${ratio.toFixed(2)}:1).`);
  return value;
}

interface BrandTemplate { label: string; description: string; mode: 'dark' | 'light'; symbol: 'monograma' | 'seta' | 'ponto'; fonts: { title: BrandFont; accent: BrandFont }; tokens: { background: string; background2: string; foreground: string; muted: string; accent: string; accent2: string } }
/** The nine directions of the MotionVelix skill, each with its own palette, type and composition. */
export const BRAND_TEMPLATES: Record<BrandTemplateId, BrandTemplate> = {
  premium: { label: 'Premium', description: 'Escuro e dourado, serif elegante: patrimônio, luxo, autoridade.', mode: 'dark', symbol: 'monograma', fonts: { title: 'serif', accent: 'mono' }, tokens: { background: '#0b0a08', background2: '#211a0c', foreground: '#f5f1e8', muted: '#9a917f', accent: '#d9b25f', accent2: '#f0dca8' } },
  fintech: { label: 'Fintech', description: 'Azul-marinho e azul elétrico, grotesca: tecnologia, IA, dinheiro digital.', mode: 'dark', symbol: 'seta', fonts: { title: 'grotesk', accent: 'mono' }, tokens: { background: '#060b14', background2: '#0c1f3a', foreground: '#f2f6ff', muted: '#8796b0', accent: '#3d8bff', accent2: '#9cc4ff' } },
  crescimento: { label: 'Crescimento', description: 'Verde dinheiro sobre preto esverdeado, sans pesada: investimento, renda, resultado.', mode: 'dark', symbol: 'seta', fonts: { title: 'inter', accent: 'mono' }, tokens: { background: '#04100b', background2: '#08291b', foreground: '#effff6', muted: '#7fa592', accent: '#2ee88a', accent2: '#a9f7cd' } },
  cyber: { label: 'Cyber', description: 'Preto com ciano e violeta: cibersegurança, programação, futuro.', mode: 'dark', symbol: 'ponto', fonts: { title: 'grotesk', accent: 'mono' }, tokens: { background: '#05060c', background2: '#16103a', foreground: '#eef3ff', muted: '#8a8fb0', accent: '#22d3ee', accent2: '#a78bfa' } },
  energia: { label: 'Energia', description: 'Preto e vermelho-laranja, condensada: esporte, motivação, notícia.', mode: 'dark', symbol: 'monograma', fonts: { title: 'anton', accent: 'mono' }, tokens: { background: '#0b0606', background2: '#2a0b08', foreground: '#fff5f0', muted: '#a08a85', accent: '#ff4b2b', accent2: '#ffb09e' } },
  neon: { label: 'Neon', description: 'Roxo profundo e rosa neon: games, entretenimento, humor.', mode: 'dark', symbol: 'ponto', fonts: { title: 'archivo-black', accent: 'mono' }, tokens: { background: '#0d0716', background2: '#2a0f4a', foreground: '#fbf5ff', muted: '#a594b8', accent: '#ff3d9a', accent2: '#c9a2ff' } },
  clean: { label: 'Clean', description: 'Papel claro e verde-escuro, sóbrio: educação, negócios, produtividade.', mode: 'light', symbol: 'monograma', fonts: { title: 'archivo-black', accent: 'mono' }, tokens: { background: '#f2f0ea', background2: '#e2ddd0', foreground: '#15140f', muted: '#6f695a', accent: '#1f6f4a', accent2: '#7fb89a' } },
  quente: { label: 'Quente', description: 'Areia e páprica, serif: culinária, casa, viagem, lifestyle.', mode: 'light', symbol: 'ponto', fonts: { title: 'serif', accent: 'inter' }, tokens: { background: '#f3eadb', background2: '#e6d5ba', foreground: '#1c1410', muted: '#7a6a5c', accent: '#9e3418', accent2: '#d98a5f' } },
  suave: { label: 'Suave', description: 'Rosé claro e vinho, arredondada: beleza, moda, maternidade, infantil.', mode: 'light', symbol: 'ponto', fonts: { title: 'fredoka', accent: 'inter' }, tokens: { background: '#fbf1f1', background2: '#f3dcdf', foreground: '#2a1418', muted: '#8a6a70', accent: '#b3264f', accent2: '#ee9ab2' } },
};

const NICHES: Array<[string[], BrandTemplateId[]]> = [
  [['money', 'wealth', 'financ', 'invest', 'dinheiro', 'patrim', 'renda', 'bolsa', 'cripto', 'crypto', 'bitcoin', 'econom', 'rich', 'riqueza'], ['premium', 'crescimento', 'fintech']],
  [['tech', 'tecnolog', 'artificial intelligence', 'inteligência artificial', ' ai ', ' ia ', 'automat', 'automaç', 'software', 'gadget', 'future', 'futuro', 'startup', 'tools'], ['fintech', 'cyber', 'premium']],
  [['cyber', 'segurança digital', 'hacker', 'program', 'código', 'coding', 'developer'], ['cyber', 'fintech']],
  [['business', 'negócio', 'empreend', 'company', 'companies', 'empresa', 'marketing', 'vendas', 'produtiv'], ['premium', 'clean', 'fintech']],
  [['educa', 'aula', 'curso', 'estud', 'learn', 'tutorial', 'ciência', 'science', 'histór', 'history'], ['clean', 'fintech', 'quente']],
  [['game', 'jogo', 'gamer', 'humor', 'comédia', 'entreten', 'anime'], ['neon', 'energia', 'cyber']],
  [['fitness', 'treino', 'academia', 'esporte', 'sport', 'futebol', 'motiva', 'notícia', 'news'], ['energia', 'crescimento', 'neon']],
  [['receita', 'culinár', 'cozinha', 'food', 'viagem', 'travel', 'decora', 'lifestyle', 'vlog'], ['quente', 'clean', 'suave']],
  [['beleza', 'beauty', 'maquiagem', 'makeup', 'moda', 'fashion', 'maternidade', 'infantil', 'kids', 'criança'], ['suave', 'quente', 'neon']],
];

/** Picks three templates for a niche or channel description: most keyword hits first, versatile ones to complete. */
export function suggestBrandTemplates(text: string, count = 3): BrandTemplateId[] {
  const haystack = ` ${text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  const scored = NICHES.map(([keys, templates], index) => ({ hits: keys.reduce((sum, key) => sum + haystack.split(key).length - 1, 0), index, templates })).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  const chosen: BrandTemplateId[] = [];
  for (const id of [...scored.flatMap((item) => item.templates), 'fintech', 'premium', 'clean'] as BrandTemplateId[]) if (!chosen.includes(id)) chosen.push(id);
  return chosen.slice(0, count);
}

/** Two initials from the capitalised words of a name (or its first words), like the skill. */
export function brandInitials(name: string): string {
  const words = name.match(/\p{Lu}[\p{Ll}\p{N}]*|[\p{Ll}\p{N}]+/gu) ?? [];
  const capitals = words.filter((word) => /^\p{Lu}/u.test(word));
  const source = capitals.length >= 1 ? capitals : words;
  return (source.slice(0, 2).map((word) => word[0] ?? '').join('') || 'V').toLocaleUpperCase();
}

const mixHex = (from: string, to: string, amount: number): string => {
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2].map((index) => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount).toString(16).padStart(2, '0')).join('')}`;
};
/** Moves the accent toward the text color until it reads on the background (3:1, the bar for graphics). */
export function legibleAccent(accent: string, background: string, foreground: string, minimum = 3): string {
  for (let step = 0; step <= 20; step += 1) { const candidate = mixHex(accent, foreground, step / 20); if (brandContrastRatio(candidate, background) >= minimum) return candidate; }
  return foreground;
}

/** Builds an identity from a template, keeping the person's name, tagline and initials. */
export function applyBrandTemplate(templateId: BrandTemplateId, base: { name: string; tagline: string; initials?: string }): BrandIdentity {
  const template = BRAND_TEMPLATES[templateId];
  const accent = legibleAccent(template.tokens.accent, template.tokens.background, template.tokens.foreground);
  const tokens = { ...template.tokens, accent };
  return validateBrandIdentity({ schemaVersion: 1, source: 'created', template: templateId, direction: template.label, mode: template.mode, tokens, fonts: { ...template.fonts }, symbol: { style: template.symbol, initials: (base.initials?.trim() || brandInitials(base.name)).slice(0, 3) }, name: base.name.slice(0, 100), tagline: base.tagline.slice(0, 200), palette: [tokens.background, tokens.background2, tokens.accent, tokens.accent2, tokens.foreground], pieces: [], approvedAt: null });
}

/** Three reviewable directions for a niche; deterministic, and never claims to have extracted a real channel. */
export function generateBrandDirections(niche: string, name?: string): BrandIdentity[] {
  const input = niche.trim(); if (!input) throw new Error('invalid: o nicho da identidade não pode ficar vazio.');
  const channelName = name?.trim() || input;
  return suggestBrandTemplates(input).map((id) => applyBrandTemplate(id, { name: channelName, tagline: input === channelName ? '' : input }));
}
