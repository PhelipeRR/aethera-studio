import { describe, expect, it } from 'vitest';
import { createDiagnosticReport, serializeDiagnosticReport } from '../src/diagnostics';

describe('release diagnostics', () => {
  it('redacts secret keys and secret-shaped values while preserving release metadata', () => {
    const report = createDiagnosticReport({ appVersion: '0.1.58', commit: 'abc123', platform: 'win32', architecture: 'x64', migrationState: { applied: 91, latest: '0091_extensions_state_index', failed: null }, extensions: [{ id: 'velix', version: '1.0.0', state: 'enabled' }] }, { error: 'authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789', apiKey: 'do-not-export', note: 'safe' });
    expect(report).toMatchObject({ metadata: { appVersion: '0.1.58', commit: 'abc123', extensions: [{ id: 'velix' }] } });
    expect(JSON.stringify(report)).not.toContain('do-not-export');
    expect(JSON.stringify(report)).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(serializeDiagnosticReport({ appVersion: '0.1.58', commit: null, platform: 'win32', architecture: 'x64', migrationState: { applied: 0, latest: null, failed: null }, extensions: [] })).toContain('schemaVersion');
  });

  it.each([
    ['authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnopqrstuvwxyz0123456789'],
    ['password=super-secret-value', 'super-secret-value'],
    ['token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['saída do agente: chave sk-proj-abcdefghijklmnop1234 usada', 'sk-proj-abcdefghijklmnop1234'],
    ['remote https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com', 'ghp_abcdefghijklmnopqrstuvwxyz0123'],
  ])('redacts secret corpus value %s', (value, secret) => {
    expect(JSON.stringify(createDiagnosticReport({ appVersion: '0.1.58', commit: 'abc123', platform: 'win32', architecture: 'x64', migrationState: { applied: 0, latest: null, failed: null }, extensions: [] }, { value }))).not.toContain(secret);
  });
});
