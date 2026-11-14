// WCAG 2.2 contrast between two #rrggbb colours. Used by the design-system page and its token test.

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a.trim()), luminance(b.trim())].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal text is 4.5:1; for large text and UI parts it is 3:1. */
export function contrastGrade(ratio: number): 'AAA' | 'AA' | 'AA grande/UI' | 'falha' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA grande/UI';
  return 'falha';
}
