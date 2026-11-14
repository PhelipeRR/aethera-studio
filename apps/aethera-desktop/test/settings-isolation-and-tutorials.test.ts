import { describe, expect, it } from 'vitest';
import {
  AETHERA_ALLOWED_SETTINGS_CATEGORIES,
  AETHERA_FORBIDDEN_ROUTES,
  SINGULARITY_ONLY_SECTIONS,
  isRouteAllowedForApp,
  isSettingsCategoryAllowed,
  maskSecretValue,
  resolveAppIdentity,
} from '../../../packages/desktop-shared/src/renderer/src/app/app-settings-isolation.js';
import {
  INTEGRATION_TUTORIALS,
  loadTutorialStepProgress,
  saveTutorialStepProgress,
} from '../../../packages/desktop-shared/src/renderer/src/features/aethera/settings-tutorials.js';

describe('App Settings Isolation & Interactive Tutorials', () => {
  it('isolates Singularity settings and routes from Aethera Studio while keeping all 10 Aethera categories', () => {
    expect(resolveAppIdentity({ appName: 'Aethera Studio' })).toBe('aethera');
    expect(resolveAppIdentity({ appName: 'Singularity' })).toBe('singularity');

    expect(AETHERA_ALLOWED_SETTINGS_CATEGORIES).toHaveLength(10);
    for (const cat of AETHERA_ALLOWED_SETTINGS_CATEGORIES) {
      expect(isSettingsCategoryAllowed('aethera', cat)).toBe(true);
    }

    for (const sec of SINGULARITY_ONLY_SECTIONS) {
      expect(isSettingsCategoryAllowed('aethera', sec)).toBe(false);
      expect(isSettingsCategoryAllowed('singularity', sec)).toBe(true);
    }

    for (const forbiddenRoute of AETHERA_FORBIDDEN_ROUTES) {
      expect(isRouteAllowedForApp('aethera', forbiddenRoute)).toBe(false);
      expect(isRouteAllowedForApp('singularity', forbiddenRoute)).toBe(true);
    }
  });

  it('masks secrets and verifies all interactive tutorials have verified HTTPS official portals and real steps', () => {
    expect(maskSecretValue('super_secret_key_123456')).toBe('sup••••••456');
    expect(maskSecretValue('')).toBe('Não configurado');

    const ids = Object.keys(INTEGRATION_TUTORIALS) as Array<keyof typeof INTEGRATION_TUTORIALS>;
    expect(ids).toEqual(['youtube', 'twitch_igdb', 'rawg', 'ai_agents', 'voice_studio', 'production']);

    for (const id of ids) {
      const spec = INTEGRATION_TUTORIALS[id];
      expect(spec.officialPortalUrl.startsWith('https://')).toBe(true);
      expect(spec.lastReviewedAt).toBe('2026-11-14');
      expect(spec.steps.length).toBeGreaterThanOrEqual(2);
    }

    // Progress persistence is safe when localStorage is unavailable (Node) and never throws
    saveTutorialStepProgress('twitch_igdb', 2);
    expect(loadTutorialStepProgress('twitch_igdb')).toBeGreaterThanOrEqual(0);
  });
});
