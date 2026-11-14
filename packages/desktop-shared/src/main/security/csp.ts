/**
 * Content Security Policy for the renderer. Injected as a <meta> tag at build time
 * (see electron.vite.config.ts) so it applies to both the dev server and file:// builds.
 */
export function buildCsp({ dev }: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // The React refresh preamble is an inline script, needed only by the dev server.
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    // Radix positions popovers with inline style attributes.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    // data: only: the Neura voice reaches the renderer inline, because a voice file on a local server would need a wider policy.
    'media-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws://localhost:*', 'http://localhost:*'] : ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-src': ["'none'"],
    'form-action': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
