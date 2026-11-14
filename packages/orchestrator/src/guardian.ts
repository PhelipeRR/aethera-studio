import { redactSecrets } from '@neuralbridge/agents';
import type { GuardianFinding, GuardianReport } from '@neuralbridge/shared';

// Phase 28: a deterministic security review of what a task changed, before it is accepted. Transparent
// rules over the diff (added lines and files), the commands the agent ran and the paths it touched. The
// evidence never repeats a secret; a cut diff is marked "not analysed" rather than passed as clean.

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const LIMITS = { files: 40, lines: 3000 };

const SENSITIVE_FILE = /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|id_rsa[^/]*|credentials[^/]*|secrets?\.[^/]+)$/i;
const CI_FILE = /^\.github\/workflows\/|(^|\/)(\.gitlab-ci\.yml|azure-pipelines\.ya?ml|Jenkinsfile)$|(^|\/)\.circleci\//;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|packages\.lock\.json)$/;

const DANGEROUS_CODE: [RegExp, string][] = [
  [/\beval\s*\(/, 'eval executa texto como código'],
  [/\bnew Function\s*\(/, 'new Function executa texto como código'],
  [/\bInvoke-Expression\b|\|\s*iex\b/i, 'Invoke-Expression executa texto como comando'],
  [/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, 'desliga a verificação de certificados TLS'],
  [/rejectUnauthorized\s*:\s*false/, 'desliga a verificação de certificados TLS'],
  [/\bverify\s*=\s*False\b/, 'desliga a verificação de certificados TLS'],
  [/chmod\s+(-R\s+)?777\b/, 'dá permissão total a todos os usuários'],
];

const DANGEROUS_COMMAND: [RegExp, string][] = [
  [/\brm\s+-\w*r\w*\s+(\/|~|\*|\.)(\s|$)/, 'apaga recursivamente a raiz, a pasta pessoal ou tudo'],
  [/\bgit\s+push\b.*(--force\b|\s-f\b)/, 'reescreve o histórico remoto (push forçado)'],
  [/\bgit\s+reset\s+--hard\b/, 'descarta alterações locais (reset --hard)'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(sh|bash|iex|pwsh|powershell)\b/i, 'baixa e executa um script da internet'],
  [/\bformat\s+[a-z]:/i, 'formata um disco'],
  [/\b(del|rd|rmdir)\s+\/s\b/i, 'apaga uma pasta inteira'],
  [/\bsudo\b/, 'executa como administrador'],
  [/--no-verify\b/, 'pula as verificações do Git (hooks)'],
];

export interface ReviewInput {
  /** The task's working-tree diff against HEAD, new files included. */
  diff: string;
  /** The diff was cut at its size limit: what is past the cut was not analysed. */
  truncated: boolean;
  /** Commands the agents ran (tool event summaries). */
  commands: string[];
  /** Paths the agents changed outside the project folder. */
  outside: string[];
  /** Files the task changed with no diff to read: they were not checked, so they must not pass as clean. */
  unreviewed?: readonly string[];
}

export function reviewChanges(input: ReviewInput): GuardianReport {
  const findings: GuardianFinding[] = [];
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  let file: string | null = null;
  let line = 0;
  const add = (finding: GuardianFinding) => findings.push(finding);
  const fileFindings = (path: string) => {
    if (SENSITIVE_FILE.test(path)) add({ rule: 'sensitive_file', severity: 'high', file: path, line: null, message: 'Arquivo que costuma guardar credenciais foi alterado.', evidence: path });
    if (CI_FILE.test(path)) add({ rule: 'ci_change', severity: 'medium', file: path, line: null, message: 'O pipeline de CI foi alterado: ele roda com as credenciais do repositório.', evidence: path });
    if (LOCKFILE.test(path)) add({ rule: 'lockfile', severity: 'low', file: path, line: null, message: 'O lockfile mudou: confira se as versões instaladas são as esperadas.', evidence: path });
  };

  for (const raw of input.diff.split('\n')) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(raw);
    if (header) {
      file = header[1] ?? null;
      if (file && !files.has(file)) {
        files.add(file);
        fileFindings(file);
      }
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('-')) {
      removed += 1;
      continue;
    }
    if (!raw.startsWith('+')) {
      if (raw.startsWith(' ')) line += 1;
      continue;
    }
    added += 1;
    const text = raw.slice(1);
    if (file) {
      if (redactSecrets(text) !== text) add({ rule: 'secret', severity: 'high', file, line, message: 'Uma linha adicionada parece conter uma credencial.', evidence: `${file}:${line} (valor omitido)` });
      for (const [pattern, why] of DANGEROUS_CODE) {
        if (pattern.test(text)) add({ rule: 'dangerous_code', severity: 'high', file, line, message: `Código perigoso: ${why}.`, evidence: `${file}:${line}` });
      }
      if (file.endsWith('package.json')) {
        const dependency = /^\s*"(@?[\w.\-/]+)"\s*:\s*"[\^~>=]*\d/.exec(text)?.[1];
        if (dependency) add({ rule: 'new_dependency', severity: 'medium', file, line, message: `Dependência nova ou alterada: ${dependency}. Confira a origem e a versão.`, evidence: `${file}:${line}` });
      }
      if (file.endsWith('.csproj')) {
        const dependency = /<PackageReference\s+Include="([^"]+)"/.exec(text)?.[1];
        if (dependency) add({ rule: 'new_dependency', severity: 'medium', file, line, message: `Dependência nova ou alterada: ${dependency}. Confira a origem e a versão.`, evidence: `${file}:${line}` });
      }
    }
    line += 1;
  }

  for (const command of input.commands) {
    for (const [pattern, why] of DANGEROUS_COMMAND) {
      if (pattern.test(command)) add({ rule: 'dangerous_command', severity: 'high', file: null, line: null, message: `O agente executou um comando perigoso: ${why}.`, evidence: redactSecrets(command).slice(0, 200) });
    }
  }
  for (const path of input.outside) add({ rule: 'outside_project', severity: 'high', file: path, line: null, message: 'O agente alterou um arquivo fora da pasta do projeto.', evidence: path });
  if (files.size > LIMITS.files || added + removed > LIMITS.lines) {
    add({ rule: 'large_change', severity: 'medium', file: null, line: null, message: `Alteração grande (${files.size} arquivos, ${added + removed} linhas): revise com atenção ou divida a tarefa.`, evidence: `${files.size} arquivos` });
  }
  if (input.truncated) add({ rule: 'not_analyzed', severity: 'low', file: null, line: null, message: 'O diff passou do limite: a parte cortada não foi analisada.', evidence: 'diff cortado' });
  if (input.unreviewed?.length) {
    const count = input.unreviewed.length;
    add({ rule: 'not_analyzed', severity: 'medium', file: null, line: null, message: `${count === 1 ? '1 arquivo alterado não foi analisado' : `${count} arquivos alterados não foram analisados`}: não há diff para ler (fora de um repositório Git, ou já commitado). Revise manualmente.`, evidence: input.unreviewed.slice(0, 5).join(', ') });
  }

  const ordered = findings.map((finding, index) => ({ finding, index })).sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index).map((entry) => entry.finding);
  const risk = ordered.some((finding) => finding.severity === 'high') ? 'high' : ordered.some((finding) => finding.severity === 'medium') ? 'medium' : ordered.length ? 'low' : 'none';
  return { risk, findings: ordered, files: files.size, addedLines: added };
}
