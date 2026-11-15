import { classifyProviderItem } from '../classification.js';
import { healthFromProbe, nowIso, requestJson } from '../http.js';
import { licenseFromSpdx } from '../licensing.js';
import type { MediaProviderAdapter, ProviderDescriptor, ProviderMediaItem, ProviderSearchPage, ProviderSearchRequest } from '../types.js';

/**
 * Hugging Face Hub dataset discovery (image/video modalities). Discovery only: a dataset card license is not a uniform
 * license for every file it contains, so items are never acquired automatically and always carry `third_party_rights`.
 */
export const HUGGINGFACE_DESCRIPTOR: ProviderDescriptor = {
  id: 'huggingface_datasets',
  name: 'Hugging Face Datasets',
  category: 'dataset',
  kinds: ['dataset'],
  docsUrl: 'https://huggingface.co/docs/hub/api',
  credentialFields: [{ key: 'token', label: 'Access token (opcional)', secret: true, optional: true }],
  knownLimits: 'Limites do Hub por IP/token (não fixos); token aumenta a cota.',
  enabledByDefault: true,
  defaultPriority: 90,
  capabilities: { search: true, categories: true, pagination: true, preview: true, automatedAcquisition: false, metadataOnly: true },
  termsSummary: 'Licença declarada por dataset (cardData.license); conteúdo frequentemente de terceiros. Somente descoberta — nunca usado como banco de stock.',
  rateLimit: { requests: 30, perMs: 60_000, maxConcurrent: 2 },
};

interface HfDataset {
  id: string;
  author?: string;
  gated?: boolean | string;
  private?: boolean;
  disabled?: boolean;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  tags?: string[];
  description?: string;
  cardData?: { license?: string | string[]; pretty_name?: string };
}

export class HuggingFaceDatasetsAdapter implements MediaProviderAdapter {
  readonly descriptor = HUGGINGFACE_DESCRIPTOR;
  constructor(private readonly options: { token?: () => string | null; fetchImpl?: typeof fetch } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async categories(): Promise<string[]> {
    return ['modality:image', 'modality:video'];
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const page = request.page ?? 1;
    const perPage = Math.min(50, request.perPage ?? 10);
    const modality = request.category === 'modality:image' || request.category === 'modality:video' ? request.category : 'modality:video';
    const limit = Math.min(100, page * perPage);
    const token = this.options.token?.()?.trim();
    const url = `https://huggingface.co/api/datasets?${new URLSearchParams({ search: request.query.slice(0, 100), filter: modality, limit: String(limit), full: 'true', sort: 'downloads' })}`;
    const { data } = await requestJson<HfDataset[]>('huggingface_datasets', url, {
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(token ? { headers: { Authorization: `Bearer ${token}` }, redact: [token] } : {}),
    });
    const usable = data.filter((d) => !d.private && !d.disabled && (d.gated === false || d.gated === undefined));
    const items = usable.slice((page - 1) * perPage, page * perPage).map((d): ProviderMediaItem => {
      const tags = d.tags ?? [];
      const licenseRaw = d.cardData?.license ?? tags.find((t) => t.startsWith('license:'))?.slice('license:'.length);
      const base = licenseFromSpdx(licenseRaw, { author: d.author ?? d.id.split('/')[0] ?? d.id, licenseUrl: `https://huggingface.co/datasets/${d.id}` });
      const cls = classifyProviderItem({ provider: 'huggingface_datasets', hint: 'dataset', kind: 'dataset', title: d.id, tags });
      return {
        id: `huggingface_datasets:${d.id}`,
        provider: 'huggingface_datasets',
        providerItemId: d.id,
        kind: 'dataset',
        title: d.cardData?.pretty_name ?? d.id,
        ...(d.description ? { description: d.description.replace(/\s+/g, ' ').trim().slice(0, 400) } : {}),
        pageUrl: `https://huggingface.co/datasets/${d.id}`,
        acquisition: { method: 'none', reason: 'Datasets são apenas descobertos; arquivos exigem revisão de licença/direitos item a item.' },
        classification: cls.classification,
        classificationConfidence: cls.confidence,
        classificationEvidence: [...cls.evidence, ...tags.filter((t) => /^(size_categories|format|modality):/.test(t))],
        aiGenerated: cls.aiGenerated,
        license: { ...base, restrictions: [...new Set([...base.restrictions, 'third_party_rights' as const])] },
        provenance: { provider: 'huggingface_datasets', providerItemId: d.id, retrievedAt: nowIso(), apiEndpoint: '/api/datasets', subject: { datasetId: d.id } },
        tags,
      };
    });
    return { items, page, perPage, hasMore: usable.length > page * perPage || data.length >= limit };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('huggingface_datasets', async () => (await this.search({ query: 'video', perPage: 1, ...(signal ? { signal } : {}) })).items.length);
  }
}
