import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { SkillTrustAssessment, SkillTrustCheck, SkillTrustEvidence, SkillTrustFinding, SkillTrustPolicy, SkillInstallPreview, TrustSeverity } from './contracts.js';

export const DEFAULT_TRUST_POLICY: SkillTrustPolicy = { maxFileBytes: 512_000, maxTotalBytes: 5_000_000, maxFiles: 200, maxDepth: 8, allowedHosts: [], blockCritical: true };
export const TRUST_RULE_VERSION = '41.4-static-1';

export interface TrustSource { kind: 'local' | 'remote'; value: string; scope?: 'global' | 'project'; allowlistedHosts?: readonly string[]; caFile?: string; }
export interface TrustAnalyzeInput { skillId: string; root: string; source: TrustSource; destination?: string; policy?: Partial<SkillTrustPolicy>; now?: () => string; }
export interface TrustCenter { assess(input: TrustAnalyzeInput): Promise<SkillTrustAssessment>; preview(input: TrustAnalyzeInput): Promise<SkillInstallPreview>; }

const EXECUTABLE_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.js', '.mjs', '.ps1', '.sh', '.vbs']);
const SUSPICIOUS = [
  { id: 'shell-command', pattern: /(?:powershell|cmd(?:\.exe)?|bash|sh\s+-c|child_process|exec\s*\()/iu, text: 'possível execução de shell' },
  { id: 'dependency-install', pattern: /(?:npm|pnpm|yarn|pip|cargo)\s+(?:install|add)\b/iu, text: 'possível instalação de dependência' },
  { id: 'remote-download', pattern: /(?:curl|wget|Invoke-WebRequest|fetch\s*\()/iu, text: 'possível download remoto' },
  { id: 'credential-access', pattern: /(?:\.env|id_rsa|ssh|api[_ -]?key|token|password|credential)/iu, text: 'referência potencial a credenciais' },
  { id: 'destructive-git', pattern: /git\s+(?:reset\s+--hard|clean\s+-f|push\s+--force|branch\s+-D)/iu, text: 'operação Git potencialmente destrutiva' },
  { id: 'prompt-injection', pattern: /(?:ignore\s+(?:all|previous)|ignore\s+instru[cç][oõ]es|system\s+message|reveal\s+(?:secrets|the\s+prompt))/iu, text: 'possível instrução de prompt injection' },
];

function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function normalizedOrigin(source: TrustSource): { normalized: string; host: string | null; allowlisted: boolean | null } {
  if (source.kind === 'local') return { normalized: resolve(source.value), host: null, allowlisted: null };
  try { const url = new URL(source.value); const hosts = (source.allowlistedHosts ?? []).map((item) => item.toLowerCase()); return { normalized: url.toString(), host: url.hostname.toLowerCase(), allowlisted: url.protocol === 'https:' && hosts.includes(url.hostname.toLowerCase()) }; } catch { return { normalized: source.value, host: null, allowlisted: false }; }
}
function finding(id: string, category: SkillTrustFinding['category'], severity: TrustSeverity, status: SkillTrustFinding['status'], result: string, evidence: SkillTrustEvidence[], rule: string, relatedPath?: string): SkillTrustFinding { return { id, category, severity, status, evidence, ...(relatedPath ? { relatedPath } : {}), rule, result, limitation: 'Análise estática não prova comportamento futuro nem reputação do autor.', recommendedAction: severity === 'critical' || severity === 'high' ? 'Bloquear e revisar manualmente antes de qualquer instalação.' : 'Revisar a evidência antes de autorizar.' }; }

export function createTrustCenter(): TrustCenter {
  return {
    async assess(input) {
      const policy = { ...DEFAULT_TRUST_POLICY, ...input.policy };
      const now = input.now ?? (() => new Date().toISOString());
      const origin = normalizedOrigin(input.source);
      const findings: SkillTrustFinding[] = [];
      const inspectedFiles: SkillTrustAssessment['inspectedFiles'] = [];
      let totalBytes = 0;
      let maxSeenDepth = 0;
      let skillManifest = false;
      const behaviorTexts: Array<{ path: string; text: string }> = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        maxSeenDepth = Math.max(maxSeenDepth, depth);
        if (depth > policy.maxDepth) { findings.push(finding('depth-limit', 'structure', 'critical', 'blocked', 'Profundidade máxima excedida.', [{ kind: 'fact', value: String(depth), path: dir }], 'maxDepth', dir)); return; }
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { findings.push(finding('directory-unreadable', 'limitations', 'high', 'not-verified', 'Diretório não pôde ser lido.', [{ kind: 'unavailable', value: 'permissão ou diretório indisponível', path: dir }], 'read-directory', dir)); return; }
        for (const entry of entries) {
          const path = resolve(dir, entry.name);
          let stat;
          try { stat = await lstat(path); } catch { continue; }
          if (stat.isSymbolicLink()) { findings.push(finding('external-symlink', 'permissions', 'critical', 'blocked', 'Symlink não é seguido.', [{ kind: 'fact', value: 'symlink detectado', path }], 'reject-symlink', path)); continue; }
          if (stat.isDirectory()) { await walk(path, depth + 1); continue; }
          if (!stat.isFile()) continue;
          if (inspectedFiles.length >= policy.maxFiles) { findings.push(finding('file-count-limit', 'structure', 'critical', 'blocked', 'Quantidade máxima de arquivos excedida.', [{ kind: 'fact', value: String(policy.maxFiles), path }], 'maxFiles', path)); return; }
          totalBytes += stat.size;
          const rel = relative(resolve(input.root), path);
          if (stat.size > policy.maxFileBytes) findings.push(finding('file-size-limit', 'structure', 'critical', 'blocked', 'Arquivo excede o limite individual.', [{ kind: 'fact', value: `${stat.size} bytes`, path }], 'maxFileBytes', path));
          if (totalBytes > policy.maxTotalBytes) findings.push(finding('total-size-limit', 'structure', 'critical', 'blocked', 'Tamanho agregado excede o limite.', [{ kind: 'fact', value: `${totalBytes} bytes`, path }], 'maxTotalBytes', path));
          if (rel.split(/[\\/]/u).some((part) => part === '..') || /^[A-Za-z]:|^[/\\]/u.test(entry.name)) findings.push(finding('unsafe-path', 'permissions', 'critical', 'blocked', 'Caminho potencialmente absoluto ou traversal.', [{ kind: 'fact', value: rel, path }], 'safe-relative-path', path));
          const extension = entry.name.includes('.') ? `.${entry.name.split('.').at(-1)?.toLowerCase() ?? ''}` : '';
          if (EXECUTABLE_EXTENSIONS.has(extension)) findings.push(finding('executable-file', 'behavior', 'warning', 'attention', 'Arquivo com extensão potencialmente executável foi encontrado, mas não foi executado.', [{ kind: 'fact', value: extension, path }], 'inert-executable', path));
          let fileHash: string | null = null;
          if (stat.size <= policy.maxFileBytes) { const bytes = await readFile(path); fileHash = hash(bytes); if (entry.name.toLowerCase() === 'skill.md') { skillManifest = true; behaviorTexts.push({ path, text: bytes.toString('utf8') }); } else if (['.md', '.txt', '.json', '.js', '.mjs', '.ps1', '.sh', '.yml', '.yaml'].includes(extension)) behaviorTexts.push({ path, text: bytes.toString('utf8') }); }
          inspectedFiles.push({ path, size: stat.size, hash: fileHash });
        }
      };
      await walk(resolve(input.root), 0);
      if (!skillManifest) findings.push(finding('missing-skill-manifest', 'structure', 'critical', 'blocked', 'SKILL.md não foi encontrado.', [{ kind: 'fact', value: 'ausente', path: input.root }], 'required-manifest', input.root));
      if (origin.allowlisted === false) findings.push(finding('origin-not-allowlisted', 'origin', 'critical', 'blocked', 'Origem remota não é HTTPS allowlisted.', [{ kind: 'fact', value: origin.normalized }], 'https-allowlist'));
      if (origin.allowlisted === null) findings.push(finding('origin-local', 'origin', 'info', 'verified', 'Origem local identificada; reputação externa não foi avaliada.', [{ kind: 'fact', value: origin.normalized }], 'local-origin'));
      for (const item of behaviorTexts) for (const rule of SUSPICIOUS) if (rule.pattern.test(item.text)) findings.push(finding(`behavior-${rule.id}`, 'behavior', 'warning', 'attention', `${rule.text}; a presença textual não prova execução.`, [{ kind: 'heuristic', value: rule.text, path: item.path }], rule.id, item.path));
      if (!behaviorTexts.some((item) => /license|licen[çc]a/iu.test(item.text))) findings.push(finding('license-unavailable', 'limitations', 'warning', 'not-verified', 'Nenhuma licença foi identificada nos arquivos inspecionados.', [{ kind: 'unavailable', value: 'não encontrada' }], 'license-presence'));
      const contentFingerprint = hash(inspectedFiles.map((file) => `${relative(resolve(input.root), file.path)}\0${file.size}\0${file.hash ?? ''}`).sort().join('\n'));
      const blockedBy = findings.filter((item) => item.status === 'blocked').map((item) => item.id).sort();
      const warnings = findings.filter((item) => item.status === 'attention' || item.status === 'not-verified').map((item) => item.id).sort();
      const checks: SkillTrustCheck[] = [
        { id: 'origin', label: 'Origem', kind: 'automatic', severity: origin.allowlisted === false ? 'critical' : 'info', status: origin.allowlisted === false ? 'fail' : 'pass', detail: origin.normalized },
        { id: 'manifest', label: 'SKILL.md', kind: 'automatic', severity: skillManifest ? 'info' : 'critical', status: skillManifest ? 'pass' : 'fail', detail: skillManifest ? 'encontrado' : 'ausente' },
        { id: 'limits', label: 'Limites de arquivos', kind: 'automatic', severity: blockedBy.some((id) => id.includes('limit')) ? 'critical' : 'info', status: blockedBy.some((id) => id.includes('limit')) ? 'fail' : 'pass', detail: `${inspectedFiles.length} arquivos, ${totalBytes} bytes, profundidade ${maxSeenDepth}` },
        { id: 'behavior', label: 'Comportamento estático', kind: 'heuristic', severity: 'warning', status: findings.some((item) => item.category === 'behavior') ? 'warning' : 'unknown', detail: 'heurísticas não provam execução' },
      ];
      return { skillId: input.skillId, evaluatedAt: now(), ruleVersion: TRUST_RULE_VERSION, contentFingerprint, origin: { kind: input.source.kind, value: input.source.value, ...origin }, scope: input.source.scope ?? 'unknown', inspectedFiles, findings, checks, decision: { allowed: blockedBy.length === 0, requiresExplicitApproval: true, blockedBy, warnings }, valid: blockedBy.length === 0 };
    },
    async preview(input) {
      const assessment = await this.assess(input);
      return { skillId: input.skillId, destination: resolve(input.destination ?? 'managed-skills', input.skillId), files: assessment.inspectedFiles.map((file) => ({ path: file.path, size: file.size, overwrite: false })), totalBytes: assessment.inspectedFiles.reduce((sum, file) => sum + file.size, 0), findings: assessment.findings, blockedBy: assessment.decision.blockedBy, warnings: assessment.decision.warnings, checks: assessment.checks, assessmentFingerprint: assessment.contentFingerprint, readOnly: true };
    },
  };
}
