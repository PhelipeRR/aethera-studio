import { pathToFileURL } from 'node:url';

export interface AppLocation {
  /** Set only in development (electron-vite's ELECTRON_RENDERER_URL). */
  devServerUrl: string | undefined;
  /** Absolute path of the built renderer index.html. */
  indexFile: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True only for the app's own renderer document (any hash route). */
export function isAppUrl(url: string, app: AppLocation): boolean {
  const target = parse(url);
  if (!target) return false;

  if (app.devServerUrl) {
    const dev = parse(app.devServerUrl);
    return dev !== null && target.origin === dev.origin;
  }

  if (target.protocol !== 'file:') return false;
  const index = pathToFileURL(app.indexFile);
  return decodeURIComponent(target.pathname).toLowerCase() === decodeURIComponent(index.pathname).toLowerCase();
}

/** External links open in the system browser only for https URLs on allowlisted hosts. */
export function isAllowedExternalUrl(url: string, allowedHosts: readonly string[]): boolean {
  const target = parse(url);
  if (!target || target.protocol !== 'https:' || target.username || target.password) return false;
  const host = target.hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Browser permissions are denied, except app-owned audio, geolocation after the Neura consent, and copying text. */
/** `mediaTypes` must be stated and audio only: the camera has no use here, and a request that names nothing is refused. */
export function isAllowedPermission(permission: string, pageUrl: string | undefined, app: AppLocation, mediaTypes: readonly string[] = []): boolean {
  if (pageUrl === undefined || !isAppUrl(pageUrl, app)) return false;
  if (permission === 'geolocation') return true;
  if (permission === 'media') return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
  return permission === 'clipboard-sanitized-write';
}

/** System audio is the widest thing a page can ask for: only the HUD may, and only while a meeting that needs it is running. */
export function isAllowedSystemAudio(permission: string, pageUrl: string | undefined, app: AppLocation, armed: boolean, mediaTypes: readonly string[] = []): boolean {
  if (!armed || pageUrl === undefined || !isAppUrl(pageUrl, app)) return false;
  // getDisplayMedia arrives as 'media' naming no type. A camera or microphone request always names one, so it never passes here.
  if (permission !== 'display-capture' && !(permission === 'media' && mediaTypes.length === 0)) return false;
  return new URL(pageUrl).searchParams.get('companion') === 'hud';
}

export const EXTERNAL_HOST_ALLOWLIST = [
  'github.com',
  'modelcontextprotocol.io',
  'docs.anthropic.com',
  'code.claude.com',
  'developers.openai.com',
] as const;
