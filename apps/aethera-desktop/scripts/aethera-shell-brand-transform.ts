/**
 * Build-time brand parity transform for Aethera Studio Desktop.
 *
 * Ensures that `packages/desktop-shared/src/renderer/src/app/AetheraShell.tsx`
 * always renders the exact Aethera Web prism logo (`#6a46d8 -> #9c7df2 -> #d8fb4f`,
 * prism "A" path, and `#111111` ink dot) without mutating or conflicting with the
 * shared monorepo shell file.
 */

const CANONICAL_PATH = 'M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z';

const CANONICAL_PRISM_LOGO_FN = `function AetheraPrismLogo(props: { size?: number; className?: string } = {}) {
  const size = typeof props?.size === 'number' ? props.size : 28;
  const cls = props?.className ? \`shrink-0 \${props.className}\` : 'shrink-0';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cls}>
      <defs>
        <linearGradient id="aethera-web-prism-grad" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6a46d8" />
          <stop offset="55%" stopColor="#9c7df2" />
          <stop offset="100%" stopColor="#d8fb4f" />
        </linearGradient>
      </defs>
      <path d="${CANONICAL_PATH}" fill="url(#aethera-web-prism-grad)" />
      <circle cx="16" cy="22.5" r="2.5" fill="#111111" />
    </svg>
  );
}`;

function findMatchingDelimiterEnd(code: string, openIdx: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i++;
      } else if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function transformAetheraShellBrand(code: string, id: string): string | null {
  const normalizedId = id.replace(/\\/g, '/').split('?')[0] ?? '';
  if (!normalizedId.endsWith('/AetheraShell.tsx')) return null;

  // Idempotent: already matches canonical Web prism path + exact gradient stops + ink dot
  if (
    code.includes(CANONICAL_PATH) &&
    code.includes('#6a46d8') &&
    code.includes('#9c7df2') &&
    code.includes('#d8fb4f') &&
    code.includes('cy="22.5"')
  ) {
    return null;
  }

  // Case 1: function AetheraPrismLogo(...) { ... }
  const fnMatch = /(?:export\s+)?function\s+AetheraPrismLogo\s*\([^)]*\)\s*(?::[^{]+)?\{/.exec(code);
  if (fnMatch && fnMatch.index !== undefined) {
    const isExported = fnMatch[0].startsWith('export');
    const openBraceIdx = fnMatch.index + fnMatch[0].lastIndexOf('{');
    const closeBraceIdx = findMatchingDelimiterEnd(code, openBraceIdx, '{', '}');
    if (closeBraceIdx < 0) return null;
    const replacement = isExported ? `export ${CANONICAL_PRISM_LOGO_FN}` : CANONICAL_PRISM_LOGO_FN;
    return `${code.slice(0, fnMatch.index)}${replacement}${code.slice(closeBraceIdx + 1)}`;
  }

  // Case 2: const AetheraPrismLogo = (...) => { ... } or (...) => ( ... )
  const constMatch = /(?:export\s+)?const\s+AetheraPrismLogo\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*([{(])/.exec(code);
  if (constMatch && constMatch.index !== undefined) {
    const isExported = constMatch[0].startsWith('export');
    const openChar = constMatch[1] ?? '{';
    const closeChar = openChar === '{' ? '}' : ')';
    const openIdx = constMatch.index + constMatch[0].length - 1;
    const closeIdx = findMatchingDelimiterEnd(code, openIdx, openChar, closeChar);
    if (closeIdx < 0) return null;
    const endIdx = code[closeIdx + 1] === ';' ? closeIdx + 1 : closeIdx;
    const replacement = isExported ? `export ${CANONICAL_PRISM_LOGO_FN}` : CANONICAL_PRISM_LOGO_FN;
    return `${code.slice(0, constMatch.index)}${replacement}${code.slice(endIdx + 1)}`;
  }

  return null;
}
