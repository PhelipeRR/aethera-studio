import { normalise } from './text.js';

// Requests that can destroy data or history. Any match puts the task on hold until the user approves
// it (decision A10). Matching is on the request text, before any agent runs.
const RULES: [RegExp, string][] = [
  [
    /\b(apagu?\w*|delet\w*|exclu[ai]\w*|remov[ae]\w*)\s+(a |o |as |os |todos os |todas as |toda a |todo o )?(tabelas?|banco|database|registros|dados|pasta|diretorio|arquivos|branch\w*|logs?|historico|bucket)\b/,
    'Pede para apagar dados, arquivos ou histórico.',
  ],
  // Up to three words between DROP and the object: "drop table x" and "drop the users table".
  [/\bdrop\s+(?:\w+\s+){0,3}?(table|database|schema|column|index)\b/, 'Contém DROP no banco de dados.'],
  [/\btruncate\b/, 'Contém TRUNCATE no banco de dados.'],
  [/\bdelete\s+from\b/, 'Contém DELETE FROM no banco de dados.'],
  [/\brm\s+-[a-z]*r[a-z]*f?\b|\brmdir\s+\/s\b|\bremove-item\b.*-recurse/, 'Contém remoção recursiva de arquivos.'],
  [/\bpush\b.*(--force|\s-f\b)|\bforce[- ]push\b/, 'Pede push forçado no Git.'],
  [/\breset\s+--hard\b|\bclean\s+-[a-z]*f/, 'Pede para descartar alterações no Git.'],
  [/\b(revert\w*|desfaz\w*|desfac\w*|rollback|volt\w*)\b.*\bmigra\w*|\bmigra\w*\s+(para baixo|down)\b/, 'Pede para reverter migrações de banco.'],
  [/\bformat\w*\s+(o |a )?(disco|drive|particao)\b/, 'Pede para formatar um disco.'],
];

/** Reasons a request is destructive; empty when it is not. */
export function assessRisk(prompt: string): string[] {
  const text = normalise(prompt);
  return [...new Set(RULES.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason))];
}
