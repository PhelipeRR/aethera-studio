// Detects credentials in text an agent proposes to remember, so they are never stored without the
// user seeing them first. Known formats first, then an entropy check for random-looking tokens.
// `prefix` groups keep the key name readable when the value is masked ("password=***").

export interface SecretFinding {
  kind: string;
  /** Position of the secret value in the text. */
  start: number;
  end: number;
}

const PATTERNS: [kind: string, pattern: RegExp][] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{10,}/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['github-token', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google-key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['url-credentials', /(?<prefix>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi],
  ['bearer', /(?<prefix>\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi],
  // key=value / "key": "value" for credential-like keys; the key must end right before the separator, so
  // counters such as "input_tokens": 120 or max_tokens=100 are left alone.
  [
    'assignment',
    /(?<prefix>\b(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|secret|token|password|passwd|pwd|senha)["']?\s*[:=]\s*["']?)[^\s"',;}]{4,}/gi,
  ],
];

const CANDIDATE = /[A-Za-z0-9_\-+/=]{24,}/g;

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Random-looking: mixes lower, upper and digits (hashes and ULIDs use two classes) and has high entropy. */
function looksRandom(token: string): boolean {
  if (token.includes('/')) return false; // paths and URLs
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((pattern) => pattern.test(token)).length;
  return classes === 3 && entropy(token) >= 4;
}

export function findSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const overlaps = (start: number, end: number) => findings.some((finding) => start < finding.end && end > finding.start);
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index + (match.groups?.['prefix']?.length ?? 0);
      const end = match.index + match[0].length;
      if (!overlaps(start, end)) findings.push({ kind, start, end });
    }
  }
  for (const match of text.matchAll(CANDIDATE)) {
    const end = match.index + match[0].length;
    if (looksRandom(match[0]) && !overlaps(match.index, end)) findings.push({ kind: 'high-entropy', start: match.index, end });
  }
  return findings.sort((a, b) => a.start - b.start);
}

/** The text with every secret value replaced by ***, for showing a blocked proposal safely. */
export function maskSecrets(text: string): string {
  let result = '';
  let cursor = 0;
  for (const finding of findSecrets(text)) {
    result += `${text.slice(cursor, finding.start)}***`;
    cursor = finding.end;
  }
  return result + text.slice(cursor);
}
