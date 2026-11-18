export type AppIdentity = 'aethera' | 'singularity';

export type AetheraSettingsCategoryId =
  | 'general'
  | 'media_sources'
  | 'ai_agents'
  | 'voice_studio'
  | 'production'
  | 'academy'
  | 'publications'
  | 'security';

export type SingularityOnlySectionId =
  | 'companion'
  | 'spotify'
  | 'devices'
  | 'azure_devops'
  | 'neura'
  | 'semantic_search';

export const AETHERA_ALLOWED_SETTINGS_CATEGORIES: readonly AetheraSettingsCategoryId[] = [
  'general',
  'media_sources',
  'ai_agents',
  'voice_studio',
  'production',
  'academy',
  'publications',
  'security',
] as const;

export const SINGULARITY_ONLY_SECTIONS: readonly SingularityOnlySectionId[] = [
  'companion',
  'spotify',
  'devices',
  'azure_devops',
  'neura',
  'semantic_search',
] as const;

export const AETHERA_FORBIDDEN_ROUTES: readonly string[] = [
  '/azure-devops',
  '/personal-agent',
  '/git-intelligence',
  '/mission-control',
  '/workflows',
  '/mcp',
  '/memory',
] as const;

export function resolveAppIdentity(hint?: { appName?: string; hasAetheraBridge?: boolean }): AppIdentity {
  if (hint?.appName?.toLowerCase().includes('aethera') || hint?.hasAetheraBridge) {
    return 'aethera';
  }
  const g = globalThis as {
    aethera?: unknown;
    aetheraBridge?: unknown;
    document?: { title?: string };
  };
  if (g.aethera || g.aetheraBridge || g.document?.title?.toLowerCase().includes('aethera')) {
    return 'aethera';
  }
  return 'singularity';
}

export function isSettingsCategoryAllowed(appId: AppIdentity, categoryId: string): boolean {
  if (appId === 'aethera') {
    if ((SINGULARITY_ONLY_SECTIONS as readonly string[]).includes(categoryId)) {
      return false;
    }
    return (AETHERA_ALLOWED_SETTINGS_CATEGORIES as readonly string[]).includes(categoryId);
  }
  return true;
}

export function isRouteAllowedForApp(appId: AppIdentity, path: string): boolean {
  if (appId === 'aethera') {
    return !AETHERA_FORBIDDEN_ROUTES.some((forbidden) => path === forbidden || path.startsWith(`${forbidden}/`));
  }
  return true;
}

export function maskSecretValue(secret: string | null | undefined): string {
  if (!secret) return 'Não configurado';
  const trimmed = secret.trim();
  if (trimmed.length <= 6) return '••••••';
  return `${trimmed.slice(0, 3)}••••••${trimmed.slice(-3)}`;
}
