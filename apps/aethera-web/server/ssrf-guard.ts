import dns from 'node:dns/promises';
import net from 'node:net';

export interface SsrfValidationOptions {
  /** Allow loopback targets (`127.0.0.1`, `localhost`) only in local dev/test environments. */
  allowLoopback?: boolean;
  /** Optional custom DNS resolver for deterministic unit testing. */
  lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface ValidatedRemoteUrl {
  normalizedUrl: string;
  hostname: string;
  resolvedIps: string[];
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function isIpv4InCidr(ip: string, cidrBase: string, prefixLen: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(cidrBase);
  if (ipInt < 0 || baseInt < 0) return true;
  const mask = prefixLen === 0 ? 0 : (~((1 << (32 - prefixLen)) - 1) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

export function isLoopbackIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (clean === '::1') return true;
  if (clean.startsWith('::ffff:')) {
    return isLoopbackIp(clean.slice(7));
  }
  return net.isIPv4(clean) && isIpv4InCidr(clean, '127.0.0.0', 8);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (!clean) return true;

  if (clean.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(clean.slice(7));
  }

  if (net.isIPv4(clean)) {
    return (
      isIpv4InCidr(clean, '0.0.0.0', 8) || // Current network
      isIpv4InCidr(clean, '10.0.0.0', 8) || // RFC 1918 private
      isIpv4InCidr(clean, '100.64.0.0', 10) || // CGNAT / Tailscale shared space
      isIpv4InCidr(clean, '127.0.0.0', 8) || // Loopback
      isIpv4InCidr(clean, '169.254.0.0', 16) || // Link-local / Cloud metadata (AWS/GCP/Azure)
      isIpv4InCidr(clean, '172.16.0.0', 12) || // RFC 1918 private
      isIpv4InCidr(clean, '192.0.0.0', 24) || // IETF protocol assignments
      isIpv4InCidr(clean, '192.0.2.0', 24) || // TEST-NET-1
      isIpv4InCidr(clean, '192.168.0.0', 16) || // RFC 1918 private
      isIpv4InCidr(clean, '198.18.0.0', 15) || // Benchmarking
      isIpv4InCidr(clean, '224.0.0.0', 4) || // Multicast
      isIpv4InCidr(clean, '240.0.0.0', 4) // Reserved / Broadcast
    );
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // ULA fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true; // Multicast
    return false;
  }

  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '169.254.169.254',
]);

/**
 * Strictly validates a Remote Host URL against SSRF, DNS rebinding to private networks,
 * cloud metadata endpoints, embedded credentials, and insecure protocols.
 */
export async function validateSafeRemoteHostUrl(
  rawUrl: string,
  opts: SsrfValidationOptions = {},
): Promise<ValidatedRemoteUrl> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Informe a URL HTTPS do Remote Host.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL do Remote Host inválida.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL do Remote Host não pode conter credenciais embutidas.');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('URL do Remote Host não deve conter query string ou fragmento.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new Error('Destino recusado pela política anti-SSRF (domínio interno/reservado).');
  }

  const allowLoopback =
    opts.allowLoopback ??
    (process.env.NODE_ENV !== 'production' && process.env.AETHERA_ALLOW_LOOPBACK_REMOTE_HOST !== 'false');

  const isExplicitLoopbackHost = hostname === '127.0.0.1' || hostname === 'localhost';

  if (parsed.protocol === 'https:') {
    // OK
  } else if (parsed.protocol === 'http:' && allowLoopback && isExplicitLoopbackHost) {
    // Permitted only for local development / automated testing on loopback
  } else {
    throw new Error('Apenas URLs HTTPS são permitidas para o Remote Host (ex.: https://seu-tunel.ngrok-free.app).');
  }

  // Block non-standard dangerous ports (SMTP, Redis, Postgres, etc.) while allowing 443 and dev/remote ports
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('Porta inválida na URL do Remote Host.');
    }
    const forbiddenPorts = new Set([22, 23, 25, 53, 110, 143, 445, 3306, 5432, 6379, 27017]);
    if (forbiddenPorts.has(portNum)) {
      throw new Error(`Porta ${portNum} bloqueada pela política anti-SSRF.`);
    }
  }

  // Resolve DNS & verify EVERY returned IP against private/reserved/metadata CIDRs
  let resolvedIps: string[] = [];
  if (net.isIP(hostname)) {
    resolvedIps = [hostname];
  } else {
    const lookupFn =
      opts.lookupFn ??
      (async (h: string) => dns.lookup(h, { all: true, verbatim: true }));
    let records: Array<{ address: string; family: number }>;
    try {
      records = await lookupFn(hostname);
    } catch {
      throw new Error(`Não foi possível resolver o DNS do host "${hostname}".`);
    }
    if (!records || records.length === 0) {
      throw new Error(`Nenhum endereço IP encontrado para "${hostname}".`);
    }
    resolvedIps = records.map((r) => r.address);
  }

  for (const ip of resolvedIps) {
    if (allowLoopback && isExplicitLoopbackHost && isLoopbackIp(ip)) {
      continue;
    }
    if (isPrivateOrReservedIp(ip)) {
      throw new Error('Endereço IP privado, loopback ou de metadados bloqueado pela proteção anti-SSRF.');
    }
  }

  // Normalize base URL without trailing slash or subpath
  const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const normalizedUrl = `${parsed.protocol}//${parsed.host}${normalizedPath}`;
  return {
    normalizedUrl,
    hostname,
    resolvedIps,
  };
}
