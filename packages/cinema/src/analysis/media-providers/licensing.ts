import type { LicenseDecision, LicenseInfo, ProviderMediaItem, UsageRestriction } from './types.js';

/**
 * License & usage policy.
 *
 * Publicly reachable is never treated as free to reuse. Only licenses whose terms we know and that allow the intended
 * use are approved automatically; unknown or ambiguous terms go to `pending_human_review`; terms that forbid the use
 * (commercial production, automated download) are `blocked`.
 */

export interface LicensePolicy {
  /** The production is monetised/commercial (default true: Aethera publishes to channels). */
  commercialUse: boolean;
  /**
   * User opt-in: allow official promotional material (publisher trailers, screenshots, key art) for editorial
   * commentary/review videos. Off by default — without it such media waits for human review.
   */
  allowEditorialPromotionalUse: boolean;
  /** Whether the media will be downloaded by the automated pipeline (vs. previewed or referenced only). */
  automatedAcquisition: boolean;
}

export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  commercialUse: true,
  allowEditorialPromotionalUse: false,
  automatedAcquisition: true,
};

const OPEN_LICENSES = new Set(['cc0-1.0', 'cc0', 'pddl', 'public-domain', 'unlicense']);
const ATTRIBUTION_LICENSES = new Set(['cc-by-4.0', 'cc-by-3.0', 'cc-by-2.0', 'cc-by-sa-4.0', 'cc-by-sa-3.0', 'odc-by', 'mit', 'apache-2.0', 'odbl']);
const NON_COMMERCIAL_LICENSES = new Set(['cc-by-nc-4.0', 'cc-by-nc-3.0', 'cc-by-nc-sa-4.0', 'cc-by-nc-sa-3.0', 'cc-by-nc-nd-4.0', 'cc-by-nc-2.0', 'cc-by-nc-sa-2.0']);
const NO_DERIVATIVES_LICENSES = new Set(['cc-by-nd-4.0', 'cc-by-nc-nd-4.0', 'cc-by-nd-3.0']);

export function evaluateLicense(license: LicenseInfo, policy: LicensePolicy = DEFAULT_LICENSE_POLICY): LicenseDecision {
  const reasons: string[] = [];
  const obligations = new Set<UsageRestriction>(license.restrictions);
  if (license.attributionRequired === true) obligations.add('attribution_required');
  const id = license.licenseId.toLowerCase();

  if (policy.automatedAcquisition && license.automatedDownload === 'forbidden') {
    reasons.push(`Os termos de ${license.licenseName} proíbem download automatizado.`);
    return { status: 'blocked', reasons, obligations: [...obligations] };
  }
  if (policy.commercialUse && (license.commercialUse === 'forbidden' || NON_COMMERCIAL_LICENSES.has(id) || obligations.has('non_commercial_only'))) {
    reasons.push(`${license.licenseName} não permite uso comercial e a produção é comercial.`);
    return { status: 'blocked', reasons, obligations: [...obligations] };
  }
  if (NO_DERIVATIVES_LICENSES.has(id)) {
    reasons.push(`${license.licenseName} proíbe obras derivadas (corte, montagem, color grade).`);
    return { status: 'blocked', reasons, obligations: [...obligations] };
  }

  if (id === 'publisher_promotional') {
    if (policy.allowEditorialPromotionalUse) {
      obligations.add('editorial_only');
      reasons.push('Material promocional oficial liberado pelo usuário apenas para uso editorial (análise/comentário).');
      return { status: 'allowed_with_restrictions', reasons, obligations: [...obligations] };
    }
    reasons.push('Material promocional com direitos do publisher; uso editorial não foi autorizado nas Configurações → Fontes de mídia.');
    return { status: 'pending_human_review', reasons, obligations: [...obligations] };
  }

  if (license.commercialUse === 'unknown' || id === 'unknown' || obligations.has('unknown_terms')) {
    reasons.push(`Licença desconhecida ou ambígua (${license.licenseName}); requer revisão humana.`);
    return { status: 'pending_human_review', reasons, obligations: [...obligations] };
  }
  if (obligations.has('third_party_rights')) {
    reasons.push('O provedor redistribui conteúdo de terceiros sem conceder licença; requer revisão humana.');
    return { status: 'pending_human_review', reasons, obligations: [...obligations] };
  }

  if (OPEN_LICENSES.has(id)) {
    reasons.push(`${license.licenseName}: domínio público/dedicação aberta.`);
    return { status: obligations.size > 0 ? 'allowed_with_restrictions' : 'allowed', reasons, obligations: [...obligations] };
  }
  if (ATTRIBUTION_LICENSES.has(id) || license.commercialUse === 'allowed') {
    reasons.push(`${license.licenseName} permite o uso pretendido${obligations.size ? ' com obrigações registradas' : ''}.`);
    return { status: obligations.size > 0 ? 'allowed_with_restrictions' : 'allowed', reasons, obligations: [...obligations] };
  }

  reasons.push(`Termos de ${license.licenseName} não reconhecidos pela política; requer revisão humana.`);
  return { status: 'pending_human_review', reasons, obligations: [...obligations] };
}

export function evaluateItemLicense(item: ProviderMediaItem, policy: LicensePolicy = DEFAULT_LICENSE_POLICY): LicenseDecision {
  const decision = evaluateLicense(item.license, policy);
  if (item.acquisition.method === 'none' && policy.automatedAcquisition && decision.status !== 'blocked') {
    return {
      status: 'blocked',
      reasons: [...decision.reasons, item.acquisition.reason ?? 'O provedor não oferece método de aquisição permitido.'],
      obligations: decision.obligations,
    };
  }
  return decision;
}

/** Normalises the many spellings of license ids found in dataset cards. */
export function normalizeLicenseId(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'unknown';
  const id = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (id === 'other' || id === 'unknown' || id === '') return 'unknown';
  return id;
}

export function licenseFromSpdx(raw: string | string[] | undefined | null, extra: Partial<LicenseInfo> = {}): LicenseInfo {
  const id = normalizeLicenseId(raw);
  const known = OPEN_LICENSES.has(id) || ATTRIBUTION_LICENSES.has(id) || NON_COMMERCIAL_LICENSES.has(id) || NO_DERIVATIVES_LICENSES.has(id);
  const nonCommercial = NON_COMMERCIAL_LICENSES.has(id);
  const attribution = ATTRIBUTION_LICENSES.has(id) || nonCommercial || NO_DERIVATIVES_LICENSES.has(id);
  return {
    licenseId: id,
    licenseName: id === 'unknown' ? 'Licença não declarada' : id.toUpperCase(),
    commercialUse: !known ? 'unknown' : nonCommercial ? 'forbidden' : 'allowed',
    automatedDownload: 'unknown',
    attributionRequired: attribution,
    restrictions: known ? (attribution ? ['attribution_required'] : []) : ['unknown_terms'],
    ...extra,
  };
}
