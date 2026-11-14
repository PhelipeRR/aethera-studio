import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');

function sources(dir: string, pattern = /\.(ts|tsx|mts)$/): string[] {
  const absolute = join(ROOT, dir);
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(relative(ROOT, path), pattern);
    return pattern.test(name) ? [relative(ROOT, path).replaceAll('\\', '/')] : [];
  });
}

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const importsOf = (file: string) => [...read(file).matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('architecture boundaries (consolidation Task 2.3)', () => {
  it('keeps every package free of Electron and of the desktop app', () => {
    const packages = readdirSync(join(ROOT, 'packages')).flatMap((name) => sources(`packages/${name}/src`));
    const offenders = packages.flatMap((file) => importsOf(file).filter((spec) => spec === 'electron' || spec.startsWith('electron/') || spec.includes('apps/desktop')).map((spec) => `${file} → ${spec}`));
    expect(offenders).toEqual([]);
  });

  it('keeps provider clients away from the database and Electron: they get data and credentials injected', () => {
    const clients = [
      ...sources('packages/orchestrator/src/integrations'),
      'packages/orchestrator/src/velix-youtube-channel.ts',
      'packages/orchestrator/src/weather-service.ts',
      ...sources('apps/desktop/src/main/oauth'),
      ...sources('apps/desktop/src/main/spotify'),
      'apps/desktop/src/main/azure-devops-credential-store.ts',
      'apps/desktop/src/main/collage-secret-store.ts',
    ];
    const offenders = clients.flatMap((file) => importsOf(file).filter((spec) => spec === 'electron' || spec === '@neuralbridge/database').map((spec) => `${file} → ${spec}`));
    expect(offenders).toEqual([]);
  });

  it('keeps application services free of Electron, the schema and provider clients', () => {
    const services = sources('packages/orchestrator/src/application');
    const offenders = services.flatMap((file) => importsOf(file).filter((spec) => spec === 'electron' || spec === '@neuralbridge/database' || spec.includes('/integrations/')).map((spec) => `${file} → ${spec}`));
    expect(offenders).toEqual([]);
  });
});

describe('fake and real provider tests are labeled apart', () => {
  const specs = sources('tests/e2e', /\.spec\.ts$/);
  // Velix is a frozen extension: its specs keep explicit NB_REAL_* opt-ins inside mixed files.
  const LEGACY_MIXED = new Set(['tests/e2e/velix-discovery.spec.ts', 'tests/e2e/velix-journey.spec.ts']);

  it('gates every *-real spec behind an explicit environment opt-in', () => {
    const optIn = /process\.env\[['"]NB_[A-Z0-9_]+['"]\]\s*!==\s*['"]1['"]/;
    const ungated = specs.filter((file) => /-real(-[\w-]+)?\.spec\.ts$/.test(file) && !(read(file).includes('test.skip(') && optIn.test(read(file))));
    expect(ungated).toEqual([]);
  });

  it('keeps real-provider opt-ins out of the fake specs', () => {
    const mixed = specs.filter((file) => !/-real(-[\w-]+)?\.spec\.ts$/.test(file) && !LEGACY_MIXED.has(file) && /NB_REAL_|NB_E2E_REAL_/.test(read(file)));
    expect(mixed).toEqual([]);
  });
});
