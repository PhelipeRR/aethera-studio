const CODES = /^(conflict|not_found|invalid|forbidden|unavailable): /;

/** A message fit for the UI from an IPC failure: drops Electron's wrapper and our error code prefix. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^\w*Error: /, '');
  if (/^Invalid payload for /.test(message)) return 'Os dados enviados são inválidos.';
  return message.replace(CODES, '');
}

export function formatWhen(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}
