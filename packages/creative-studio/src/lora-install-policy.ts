import { normalizeLoraStack, type LoraArchitecture } from './lora-catalog.js';

export type LoraInstallSource = 'huggingface' | 'civitai' | 'local' | 'unknown';

export interface LoraInstallCandidate {
  model: string;
  source: LoraInstallSource;
  sourceUrl?: string;
  license?: string;
  architecture?: LoraArchitecture;
  sizeBytes?: number;
  sha256?: string;
}

export interface LoraInstallAssessment {
  allowed: boolean;
  requiresConfirmation: boolean;
  reasons: string[];
}

const MAX_LORA_BYTES = 2 * 1024 * 1024 * 1024;
const TRUSTED_HOSTS: Record<Exclude<LoraInstallSource, 'local' | 'unknown'>, string[]> = {
  huggingface: ['huggingface.co', 'www.huggingface.co'],
  civitai: ['civitai.com', 'www.civitai.com'],
};

function hasTrustedUrl(source: LoraInstallSource, sourceUrl: string | undefined): boolean {
  if (source === 'local') return !sourceUrl;
  if (source === 'unknown' || !sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === 'https:' && TRUSTED_HOSTS[source].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assessLoraInstallCandidate(
  candidate: LoraInstallCandidate,
  checkpointArchitecture: LoraArchitecture = 'sdxl',
): LoraInstallAssessment {
  const reasons: string[] = [];
  try {
    normalizeLoraStack([{ model: candidate.model }]);
  } catch {
    reasons.push('O nome do modelo precisa ser um caminho relativo seguro.');
  }

  if (candidate.source === 'unknown') reasons.push('A fonte do download não é confiável ou não foi reconhecida.');
  if (!hasTrustedUrl(candidate.source, candidate.sourceUrl)) {
    reasons.push(candidate.source === 'huggingface'
      ? 'A URL do Hugging Face precisa usar um host oficial confiável.'
      : candidate.source === 'civitai'
        ? 'A URL do Civitai precisa usar um host oficial confiável.'
        : candidate.source === 'local'
          ? 'Um arquivo local não deve declarar uma URL externa.'
          : 'A fonte do LoRA precisa ser explicitamente Hugging Face, Civitai ou local.');
  }
  if (!candidate.license?.trim()) reasons.push('A licença do LoRA precisa ser informada antes da instalação.');
  if (!candidate.architecture || candidate.architecture === 'unknown' || checkpointArchitecture === 'unknown' || candidate.architecture !== checkpointArchitecture) {
    reasons.push(`A arquitetura do LoRA precisa ser compatível com o checkpoint (${checkpointArchitecture}).`);
  }
  if (!Number.isFinite(candidate.sizeBytes) || (candidate.sizeBytes ?? 0) <= 0 || (candidate.sizeBytes ?? 0) > MAX_LORA_BYTES) {
    reasons.push(`O tamanho do LoRA precisa ser conhecido e não exceder ${MAX_LORA_BYTES / (1024 * 1024 * 1024)} GiB.`);
  }
  if (!/^[a-f0-9]{64}$/iu.test(candidate.sha256 ?? '')) reasons.push('SHA-256 válido é obrigatório para verificar o arquivo baixado.');

  const external = candidate.source === 'huggingface' || candidate.source === 'civitai';
  const licenseNeedsReview = /unknown|other|proprietary|non[- ]commercial/iu.test(candidate.license ?? '');
  const requiresConfirmation = external || licenseNeedsReview || reasons.length > 0;
  if (external && !reasons.includes('Download externo requer confirmação explícita antes da instalação.')) {
    reasons.unshift('Download externo requer confirmação explícita antes da instalação.');
  }
  if (licenseNeedsReview) reasons.push('A licença exige revisão específica antes de uso comercial.');
  return { allowed: reasons.every((reason) => reason === 'Download externo requer confirmação explícita antes da instalação.' || reason === 'A licença exige revisão específica antes de uso comercial.') && !licenseNeedsReview, requiresConfirmation, reasons };
}
