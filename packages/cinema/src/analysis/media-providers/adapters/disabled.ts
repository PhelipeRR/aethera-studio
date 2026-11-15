import type { MediaProviderAdapter, ProviderDescriptor, ProviderHealthResult, ProviderSearchPage } from '../types.js';

/**
 * Providers evaluated on 2026-11-15 and kept disabled. They are registered so the settings screen shows them with the
 * reason, but they never make a network call.
 */
const base = {
  credentialFields: [],
  enabledByDefault: false,
  capabilities: { search: false, categories: false, pagination: false, preview: false, automatedAcquisition: false, metadataOnly: false },
  rateLimit: { requests: 1, perMs: 60_000, maxConcurrent: 1 },
} as const;

export const DISABLED_DESCRIPTORS: ProviderDescriptor[] = [
  {
    ...base,
    id: 'waifu_pics',
    name: 'waifu.pics',
    category: 'anime_reaction',
    kinds: ['image', 'gif'],
    docsUrl: 'https://waifu.pics/docs',
    knownLimits: '—',
    defaultPriority: 200,
    termsSummary: 'Não utilizável.',
    permanentlyDisabledReason:
      'API fora do ar: api.waifu.pics não resolve DNS (NXDOMAIN em 8.8.8.8 e 1.1.1.1) e waifu.pics/docs exibe conteúdo de apostas não relacionado — domínio comprometido. Verificado em 2026-11-15.',
    credentialFields: [],
  },
  {
    ...base,
    id: 'anime_reaction_api',
    name: 'anime-reaction-api (shadorki)',
    category: 'anime_reaction',
    kinds: ['image', 'gif'],
    docsUrl: 'https://github.com/shadorki/anime-reaction-api',
    knownLimits: '—',
    defaultPriority: 210,
    termsSummary: 'Projeto sem licença declarada; imagens de terceiros.',
    permanentlyDisabledReason:
      'Servidor público (anime-reactions.uzairashraf.dev) recusa conexão; repositório sem atualização desde 2023-01 e sem licença. Exigiria hospedar o projeto e ainda assim não há licença das imagens. Verificado em 2026-11-15.',
    credentialFields: [],
  },
  {
    ...base,
    id: 'mixkit',
    name: 'Mixkit',
    category: 'stock',
    kinds: ['video', 'image'],
    docsUrl: 'https://mixkit.co/license/',
    knownLimits: '—',
    defaultPriority: 220,
    termsSummary: 'Licença Mixkit permite uso em vídeos, mas não há API oficial.',
    permanentlyDisabledReason:
      'Mixkit não oferece API pública (mixkit.co/api/ → HTTP 404). Integração exigiria scraping não autorizado, que não é implementado. Use download manual + biblioteca local.',
    credentialFields: [],
  },
];

export class DisabledProviderAdapter implements MediaProviderAdapter {
  constructor(readonly descriptor: ProviderDescriptor) {}
  isConfigured(): boolean {
    return false;
  }
  async search(): Promise<ProviderSearchPage> {
    return { items: [], page: 1, perPage: 0, hasMore: false };
  }
  async healthCheck(): Promise<ProviderHealthResult> {
    return { connectivity: 'unavailable_permanently', detail: this.descriptor.permanentlyDisabledReason ?? 'Desabilitado.', checkedAt: new Date().toISOString() };
  }
}
