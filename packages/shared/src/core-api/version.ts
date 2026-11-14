import { CORE_API_VERSION } from './common.js';

/*
 * CORE-02: versioning and compatibility.
 * - The URL carries the generation (/api/v1). Inside a generation every change is additive: new routes, new optional
 *   request fields, new response fields, new event types, new error codes. Clients ignore unknown response fields and
 *   event types; the server rejects unknown request fields (strict schemas), so a typo never passes silently.
 * - A breaking change (removing or renaming anything, tightening a limit, changing a meaning) needs /api/v2, served
 *   beside v1 for at least two desktop releases, with Deprecation/Sunset headers on v1 meanwhile.
 * - CORE_CONTRACT_VERSION is the semver of the v1 contract itself: minor for additive changes, patch for docs/fixes.
 * - The internal IPC channels are not part of this contract and keep evolving with the desktop.
 */

export const CORE_CONTRACT_VERSION = '1.0.0' as const;
export const SUPPORTED_API_VERSIONS = [CORE_API_VERSION] as const;

export const VERSION_HEADERS = {
  /** Sent by clients: the contract version they were built against (informative, for logs and compatibility checks). */
  client: 'Singularity-Contract',
  /** Sent by the Core on every response. */
  server: 'Singularity-Contract',
  deprecation: 'Deprecation',
  sunset: 'Sunset',
} as const;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * A client built against `client` works with a Core at `server` when both are in the same major version. A newer
 * minor on the client only means some newer optional features are unavailable (feature-detect via /health).
 */
export function contractCompatible(client: string, server: string = CORE_CONTRACT_VERSION): 'compatible' | 'client-newer' | 'incompatible' {
  const a = SEMVER.exec(client);
  const b = SEMVER.exec(server);
  if (!a || !b) return 'incompatible';
  if (a[1] !== b[1]) return 'incompatible';
  return Number(a[2]) > Number(b[2]) ? 'client-newer' : 'compatible';
}
