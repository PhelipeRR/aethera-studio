/**
 * URL Security, SSRF Protection, Safe Storage Paths & Image Signature Validation
 */

import { isIP } from 'node:net';
import { isAbsolute, relative, resolve } from 'node:path';

const BLOCKED_HOSTNAMES = new Set([
	'localhost',
	'localhost.localdomain',
	'ip6-localhost',
	'ip6-loopback',
	'metadata.google.internal',
	'metadata',
]);

function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split('.').map((n) => Number.parseInt(n, 10));
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
	const [a, b] = parts as [number, number, number, number];
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	return false;
}

function isPrivateIpv6(ip: string): boolean {
	const norm = ip.toLowerCase().replace(/^\[|\]$/g, '');
	if (norm === '::1' || norm === '::' || norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('fe80')) {
		return true;
	}
	if (norm.startsWith('::ffff:')) {
		return isPrivateIpv4(norm.slice(7));
	}
	return false;
}

/**
 * Validates an external chapter or image URL against SSRF, blocking internal IPs,
 * localhost, non-HTTP(S) schemes, and embedded credentials.
 */
export function validateExternalChapterUrl(
	rawUrl: string,
	options?: { allowHttpForTests?: boolean },
): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new Error(`URL inválida: "${rawUrl}"`);
	}

	const allowedProtocols = options?.allowHttpForTests ? new Set(['https:', 'http:']) : new Set(['https:']);
	if (!allowedProtocols.has(parsed.protocol)) {
		throw new Error(`Protocolo bloqueado por segurança (${parsed.protocol}). Apenas HTTPS é permitido.`);
	}

	if (parsed.username || parsed.password) {
		throw new Error('URLs com credenciais embutidas não são permitidas.');
	}

	const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (!options?.allowHttpForTests) {
		if (
			BLOCKED_HOSTNAMES.has(hostname) ||
			hostname.endsWith('.local') ||
			hostname.endsWith('.internal') ||
			hostname.endsWith('.localhost')
		) {
			throw new Error(`SSRF bloqueado: host interno "${hostname}" não é permitido.`);
		}
		const ipVersion = isIP(hostname);
		if (ipVersion === 4 && isPrivateIpv4(hostname)) {
			throw new Error(`SSRF bloqueado: endereço IPv4 privado/interno "${hostname}".`);
		}
		if (ipVersion === 6 && isPrivateIpv6(hostname)) {
			throw new Error(`SSRF bloqueado: endereço IPv6 privado/interno "${hostname}".`);
		}
	}

	return parsed;
}

/**
 * Validates a redirect destination before following it (prevents SSRF via 301/302).
 */
export function validateRedirectTarget(
	locationHeader: string,
	currentUrl: URL,
	options?: { allowHttpForTests?: boolean },
): URL {
	const resolved = new URL(locationHeader, currentUrl).toString();
	return validateExternalChapterUrl(resolved, options);
}

/**
 * Produces a filesystem-safe slug free of path traversal or Windows reserved characters.
 */
export function sanitizeStorageSlug(input: string, fallback = 'item'): string {
	const clean = input
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/\.{2,}/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return clean || fallback;
}

/**
 * Resolves a path strictly inside `rootDir`, throwing on any traversal attempt.
 */
export function resolveSafeStoragePath(rootDir: string, ...segments: string[]): string {
	const absRoot = resolve(rootDir);
	const candidate = resolve(absRoot, ...segments);
	const rel = relative(absRoot, candidate);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(`Caminho inseguro fora do diretório autorizado: ${segments.join('/')}`);
	}
	return candidate;
}

export interface ImageSignatureResult {
	valid: boolean;
	format?: 'png' | 'jpeg' | 'webp' | 'gif';
	ext?: '.png' | '.jpg' | '.webp' | '.gif';
	reason?: string;
}

/**
 * Validates binary image signature (magic bytes) and minimum payload size so
 * HTML error pages, 0-byte files, or corrupted payloads are never packed into CBZ.
 */
export function validateImageMagicBytes(buf: Buffer, minBytes = 128): ImageSignatureResult {
	if (!Buffer.isBuffer(buf) || buf.length < minBytes) {
		return { valid: false, reason: `Arquivo muito pequeno ou vazio (${buf?.length ?? 0} bytes).` };
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		buf.length >= 8 &&
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
	) {
		return { valid: true, format: 'png', ext: '.png' };
	}

	// JPEG: FF D8 FF
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return { valid: true, format: 'jpeg', ext: '.jpg' };
	}

	// WEBP: RIFF....WEBP
	if (
		buf.length >= 12 &&
		buf.toString('ascii', 0, 4) === 'RIFF' &&
		buf.toString('ascii', 8, 12) === 'WEBP'
	) {
		return { valid: true, format: 'webp', ext: '.webp' };
	}

	// GIF: GIF87a or GIF89a
	if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
		return { valid: true, format: 'gif', ext: '.gif' };
	}

	return { valid: false, reason: 'Assinatura binária inválida (não é PNG, JPEG, WEBP ou GIF).' };
}
