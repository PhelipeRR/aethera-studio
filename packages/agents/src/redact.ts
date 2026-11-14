// Secrets that must never reach logs, task events or error messages shown in the UI.
const PATTERNS: [RegExp, string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, 'sk-ant-***'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, 'sk-***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh*_***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'eyJ***'],
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1***'],
  // key=value / "key": "value" for credential-like keys; the key must end right before the separator,
  // so counters such as "input_tokens": 120 or max_tokens=100 are left alone.
  [/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd)["']?\s*[:=]\s*["']?)[^\s"',;}]{4,}/gi, '$1***'],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}
