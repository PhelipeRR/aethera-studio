import { describe, expect, it } from 'vitest';
import { buildCsp } from '../src/main/security/csp.js';

const directive = (csp: string, name: string): string =>
  csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

describe('buildCsp', () => {
  it('locks production down to the app itself', () => {
    const csp = buildCsp({ dev: false });
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
  });

  it('only relaxes what the dev server needs', () => {
    const csp = buildCsp({ dev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(csp, 'connect-src')).toContain('ws://localhost:*');
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
  });

  it('lets only inline audio through media-src, which is how the Neura voice arrives', () => {
    const policy = buildCsp({ dev: false });
    expect(policy).toContain("media-src 'self' data:");
    expect(policy).not.toContain('media-src *');
  });
});
