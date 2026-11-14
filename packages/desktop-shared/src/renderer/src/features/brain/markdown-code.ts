export const codeContent = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(codeContent).join('');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
};
