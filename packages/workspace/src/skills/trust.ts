import type { SkillTrustCheck, SkillTrustSummary } from './contracts.js';

export function createLot1TrustBaseline(skillId: string): SkillTrustSummary {
  const checks: SkillTrustCheck[] = [
    { id: 'content-untrusted', label: 'Conteúdo tratado como dado não confiável', kind: 'automatic', severity: 'info', status: 'pass', detail: 'SKILL.md e arquivos auxiliares não alteram políticas superiores nem são executados.' },
    { id: 'source', label: 'Origem autorizada', kind: 'unverified', severity: 'warning', status: 'unknown', detail: 'A origem deve ser validada pelo fluxo existente antes de qualquer instalação.' },
    { id: 'manifest', label: 'Manifesto SKILL.md', kind: 'unverified', severity: 'warning', status: 'unknown', detail: 'A validação concreta continua em skills.ts neste lote.' },
    { id: 'filesystem', label: 'Proteções de filesystem', kind: 'automatic', severity: 'info', status: 'pass', detail: 'Allowlist, path traversal, limites e symlinks permanecem sob o instalador atual.' },
    { id: 'scripts', label: 'Scripts de instalação', kind: 'heuristic', severity: 'high', status: 'unknown', detail: 'A presença de scripts é inventariada, mas nenhum script é executado.' },
  ];
  return { skillId, checks, requiresExplicitApproval: true, contentIsUntrusted: true };
}
