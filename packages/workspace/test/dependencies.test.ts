import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDependencies } from '../src/dependencies.js';

function project(files: Record<string, string>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-deps-')), 'loja');
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

describe('readDependencies', () => {
  it('reads npm and .NET manifests, each dependency with the file it came from, in a stable order', async () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { react: '^19.3.0' }, devDependencies: { vitest: '4.1.0' } }),
      'apps/web/package.json': JSON.stringify({ dependencies: { react: '^19.3.0', zod: '4.0.0' } }),
      'src/Api/Api.csproj': '<Project><ItemGroup><PackageReference Include="Npgsql" Version="9.0.1" /><PackageReference Include="Serilog"><Version>4.0.0</Version></PackageReference></ItemGroup></Project>',
    });
    expect(await readDependencies(root)).toEqual([
      { name: 'Npgsql', version: '9.0.1', kind: 'runtime', source: 'src/Api/Api.csproj' },
      { name: 'react', version: '^19.3.0', kind: 'runtime', source: 'apps/web/package.json' },
      { name: 'react', version: '^19.3.0', kind: 'runtime', source: 'package.json' },
      { name: 'Serilog', version: null, kind: 'runtime', source: 'src/Api/Api.csproj' },
      { name: 'vitest', version: '4.1.0', kind: 'dev', source: 'package.json' },
      { name: 'zod', version: '4.0.0', kind: 'runtime', source: 'apps/web/package.json' },
    ]);
  });

  it('skips dependency folders, broken manifests and anything reached through a link', async () => {
    const root = project({
      'package.json': '{ não é json',
      'node_modules/lib/package.json': JSON.stringify({ dependencies: { evil: '1.0.0' } }),
      'dist/package.json': JSON.stringify({ dependencies: { built: '1.0.0' } }),
    });
    const outside = project({ 'package.json': JSON.stringify({ dependencies: { outside: '1.0.0' } }) });
    try {
      symlinkSync(outside, join(root, 'linked'), 'junction');
    } catch {
      // Without permission to create links the folder simply is not there.
    }
    expect(await readDependencies(root)).toEqual([]);
  });
});
