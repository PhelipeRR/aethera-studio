import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, inspectPreferences, readPreferences, showCompanionHudOnLaunch, writePreferences } from '../src/main/preferences.js';

const dir = (): string => mkdtempSync(join(tmpdir(), 'nb-prefs-'));

describe('preferences', () => {
  it('returns defaults when the file does not exist', () => {
    expect(readPreferences(join(dir(), 'preferences.json'))).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when the file is corrupted or invalid', () => {
    const file = join(dir(), 'preferences.json');
    writeFileSync(file, '{not json');
    expect(readPreferences(file)).toEqual(DEFAULT_PREFERENCES);
    writeFileSync(file, JSON.stringify({ theme: 'neon' }));
    expect(readPreferences(file)).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips a written value', () => {
    const file = join(dir(), 'nested', 'preferences.json');
    writePreferences(file, { theme: 'light' });
    expect(readPreferences(file)).toMatchObject({ theme: 'light', skillSettings: { allowlistedHosts: [], preferences: [] } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ theme: 'light', skillSettings: { allowlistedHosts: [], preferences: [] } });
  });

  it('persists the Velix production provider independently from the token budget', () => {
    const file = join(dir(), 'preferences.json');
    writePreferences(file, { theme: 'dark', velixAgent: 'codex' });
    expect(readPreferences(file).velixAgent).toBe('codex');
    expect(readPreferences(join(dir(), 'missing.json')).velixAgent).toBe('claude');
  });

  it('shows the Companion HUD on every app launch while preserving its layout settings', () => {
    const hidden = { ...DEFAULT_PREFERENCES, companionHud: { ...DEFAULT_PREFERENCES.companionHud, visible: false, x: 120, y: 240, mode: 'expanded' as const, alwaysOnTop: false } };

    expect(showCompanionHudOnLaunch(hidden)).toEqual({ ...hidden, companionHud: { ...hidden.companionHud, visible: true } });
  });
  it('reports an invalid preferences file and keeps a copy before anything can overwrite it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-prefs-'));
    const file = join(dir, 'preferences.json');
    expect(inspectPreferences(file)).toEqual({ ok: true, file });
    writeFileSync(file, '{ "theme": "neon", broken');
    const status = inspectPreferences(file, () => new Date('2026-11-08T10:00:00.000Z'));
    expect(status).toEqual({ ok: false, file, reason: 'invalid', preservedAs: `${file}.invalid-2026-11-08T10-00-00-000Z`, recovery: 'review-configuration' });
    writePreferences(file, { theme: 'light' });
    expect(readFileSync(`${file}.invalid-2026-11-08T10-00-00-000Z`, 'utf8')).toBe('{ "theme": "neon", broken');
    expect(inspectPreferences(file)).toEqual({ ok: true, file });
  });
});
