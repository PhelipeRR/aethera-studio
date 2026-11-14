import { describe, expect, it } from 'vitest';
import { resolveScope } from '../src/scope-resolution.js';

const projects = [
  { id: 'api', rootPath: 'C:\\src\\api' },
  { id: 'api-tools', rootPath: 'C:\\src\\api\\tools' },
  { id: 'apix', rootPath: 'C:\\src\\apix' },
];

describe('resolveScope', () => {
  it('uses --project when it names a registered project', () => {
    expect(resolveScope({ projectArg: 'apix', cwd: 'D:\\elsewhere', includeGlobal: true }, projects)).toEqual({
      scope: { kind: 'project', projectId: 'apix', includeGlobal: true },
      matchedBy: 'arg',
    });
  });

  it('fails clearly for an unknown --project', () => {
    expect(() => resolveScope({ projectArg: 'ghost', cwd: 'C:\\src\\api', includeGlobal: true }, projects)).toThrow(/Unknown project "ghost"/);
  });

  it('finds the project containing the working directory, deepest first, ignoring case on Windows', () => {
    expect(resolveScope({ cwd: 'c:\\SRC\\API\\src\\Controllers', includeGlobal: true }, projects, 'win32').scope).toEqual({
      kind: 'project',
      projectId: 'api',
      includeGlobal: true,
    });
    expect(resolveScope({ cwd: 'C:\\src\\api\\tools\\bin', includeGlobal: true }, projects, 'win32').scope).toMatchObject({ projectId: 'api-tools' });
    expect(resolveScope({ cwd: 'C:\\src\\api', includeGlobal: true }, projects, 'win32').scope).toMatchObject({ projectId: 'api' });
  });

  it('does not treat a sibling folder with a common prefix as inside the project', () => {
    expect(resolveScope({ cwd: 'C:\\src\\apixyz', includeGlobal: true }, projects, 'win32')).toEqual({ scope: { kind: 'global' }, matchedBy: 'none' });
  });

  it('falls back to global, and honours --no-global inside a project', () => {
    expect(resolveScope({ cwd: 'D:\\notes', includeGlobal: true }, projects, 'win32')).toEqual({ scope: { kind: 'global' }, matchedBy: 'none' });
    expect(resolveScope({ cwd: 'C:\\src\\api', includeGlobal: false }, projects, 'win32')).toEqual({
      scope: { kind: 'project', projectId: 'api', includeGlobal: false },
      matchedBy: 'cwd',
    });
  });
});
