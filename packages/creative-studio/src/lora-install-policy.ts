import { normalizeLoraStack, type LoraArchitecture } from './lora-catalog.js';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';

export type LoraInstallSource = 'huggingface' | 'civitai' | 'local' | 'unknown';

export interface LoraInstallCandidate {
  model: string;
  source: LoraInstallSource;
  sourceUrl?: string | undefined;
  license?: string | undefined;
  architecture?: LoraArchitecture | undefined;
  sizeBytes?: number | undefined;
  sha256?: string | undefined;
}

export const loraInstallCandidateSchema = z.object({
  model: z.string().min(1).max(500),
  source: z.enum(['huggingface', 'civitai', 'local', 'unknown']),
  sourceUrl: z.string().url().optional(),
  license: z.string().max(200).optional(),
  architecture: z.enum(['sd15', 'sdxl', 'flux', 'unknown']).optional(),
  sizeBytes: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/iu).optional(),
});

export const loraInstallRequestSchema = z.object({
  candidate: loraInstallCandidateSchema,
  confirmed: z.boolean(),
});

export interface LoraInstallAssessment {
  allowed: boolean;
  requiresConfirmation: boolean;
  reasons: string[];
}

export interface LoraInstallOptions {
  targetRoot: string;
  confirmed: boolean;
  checkpointArchitecture?: LoraArchitecture;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}

export interface LoraInstallResult {
  model: string;
  path: string;
  bytes: number;
  sha256: string;
  alreadyPresent: boolean;
}

const MAX_LORA_BYTES = 2 * 1024 * 1024 * 1024;
const TRUSTED_HOSTS: Record<Exclude<LoraInstallSource, 'local' | 'unknown'>, string[]> = {
  huggingface: ['huggingface.co', 'www.huggingface.co'],
  civitai: ['civitai.com', 'www.civitai.com'],
};

const CANONICAL_LICENSES = [
  /^mit$/iu,
  /^apache[- ]2\.0$/iu,
  /^creative?ml open rail[- ]m$/iu,
  /^creative?ml open rail\+\+$/iu,
  /^cc[- ]by(?:[- ]sa)?[- ](?:[1234]\.0)$/iu,
  /^gpl[- ]3\.0$/iu,
];

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
  const license = candidate.license?.trim() ?? '';
  if (!license) reasons.push('A licença do LoRA precisa ser informada antes da instalação.');
  else if (!CANONICAL_LICENSES.some((pattern) => pattern.test(license))) {
    reasons.push('A licença do LoRA precisa usar um identificador canônico verificável antes da instalação.');
  }
  if (!candidate.architecture || candidate.architecture === 'unknown' || checkpointArchitecture === 'unknown' || candidate.architecture !== checkpointArchitecture) {
    reasons.push(`A arquitetura do LoRA precisa ser compatível com o checkpoint (${checkpointArchitecture}).`);
  }
  if (!Number.isFinite(candidate.sizeBytes) || (candidate.sizeBytes ?? 0) <= 0 || (candidate.sizeBytes ?? 0) > MAX_LORA_BYTES) {
    reasons.push(`O tamanho do LoRA precisa ser conhecido e não exceder ${MAX_LORA_BYTES / (1024 * 1024 * 1024)} GiB.`);
  }
  if (!/^[a-f0-9]{64}$/iu.test(candidate.sha256 ?? '')) reasons.push('SHA-256 válido é obrigatório para verificar o arquivo baixado.');

  const external = candidate.source === 'huggingface' || candidate.source === 'civitai';
  const licenseNeedsReview = /unknown|other|proprietary|non[- ]commercial/iu.test(license);
  const requiresConfirmation = external || licenseNeedsReview || reasons.length > 0;
  if (external && !reasons.includes('Download externo requer confirmação explícita antes da instalação.')) {
    reasons.unshift('Download externo requer confirmação explícita antes da instalação.');
  }
  if (licenseNeedsReview) reasons.push('A licença exige revisão específica antes de uso comercial.');
  return { allowed: reasons.every((reason) => reason === 'Download externo requer confirmação explícita antes da instalação.' || reason === 'A licença exige revisão específica antes de uso comercial.') && !licenseNeedsReview, requiresConfirmation, reasons };
}

export async function installLoraCandidate(
  candidate: LoraInstallCandidate,
  options: LoraInstallOptions,
): Promise<LoraInstallResult> {
  const assessment = assessLoraInstallCandidate(candidate, options.checkpointArchitecture ?? 'sdxl');
  if (!assessment.allowed) throw new Error(`LoRA não pode ser instalado: ${assessment.reasons.join(' ')}`);
  if (!options.confirmed && assessment.requiresConfirmation) throw new Error('confirmação explícita é obrigatória antes de instalar um LoRA externo.');
  if (!candidate.sourceUrl) throw new Error('O candidato não possui URL para download.');

  const maxBytes = options.maxBytes ?? MAX_LORA_BYTES;
  if (!candidate.model.toLowerCase().endsWith('.safetensors')) throw new Error('Somente arquivos LoRA safetensors podem ser instalados automaticamente.');
  const targetPath = join(options.targetRoot, candidate.model);
  if (existsSync(targetPath)) {
    const existingHash = createHash('sha256').update(readFileSync(targetPath)).digest('hex');
    if (existingHash !== candidate.sha256?.toLowerCase()) throw new Error(`O arquivo LoRA já existe com SHA-256 diferente: ${candidate.model}.`);
    return { model: candidate.model, path: targetPath, bytes: readFileSync(targetPath).byteLength, sha256: existingHash, alreadyPresent: true };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(candidate.sourceUrl);
  if (!response.ok || !response.body) throw new Error(`Download do LoRA falhou: HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? candidate.sizeBytes ?? 0);
  if (contentLength > maxBytes) throw new Error(`Download do LoRA excede o limite de ${maxBytes} bytes.`);

  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.part-${randomUUID()}`;
  const output = createWriteStream(tempPath, { flags: 'wx' });
  const reader = response.body.getReader();
  const hasher = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const data = Buffer.from(chunk.value);
      bytes += data.byteLength;
      if (bytes > maxBytes) throw new Error(`Download do LoRA excede o limite de ${maxBytes} bytes.`);
      hasher.update(data);
      if (!output.write(data)) await new Promise<void>((resolve) => output.once('drain', resolve));
    }
    await new Promise<void>((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
      output.end();
    });
    const sha256 = hasher.digest('hex');
    if (sha256 !== candidate.sha256?.toLowerCase()) throw new Error(`SHA-256 do LoRA não confere: esperado ${candidate.sha256}, recebido ${sha256}.`);
    if (candidate.sizeBytes !== undefined && bytes !== candidate.sizeBytes) throw new Error(`Tamanho do LoRA não confere: esperado ${candidate.sizeBytes}, recebido ${bytes}.`);
    renameSync(tempPath, targetPath);
    return { model: candidate.model, path: targetPath, bytes, sha256, alreadyPresent: false };
  } catch (error) {
    output.destroy();
    try { rmSync(tempPath, { force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
}
