import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { PRIVATE_KEY } from './secure-store';
import type { DpopProof } from './core-client';

type Jwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string };
type StoredIdentity = { privateKey: string; publicKey: Jwk };

const base64Url = (value: Uint8Array): string => globalThis.btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (value: string): Uint8Array => Uint8Array.from(globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), (character) => character.charCodeAt(0));
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

export async function loadOrCreateDeviceIdentity(): Promise<{ publicKey: Jwk; proof: DpopProof }> {
  const saved = await SecureStore.getItemAsync(PRIVATE_KEY);
  const identity: StoredIdentity = saved ? JSON.parse(saved) as StoredIdentity : createIdentity();
  if (!saved) await SecureStore.setItemAsync(PRIVATE_KEY, JSON.stringify(identity));
  const privateKey = fromBase64Url(identity.privateKey);

  return {
    publicKey: identity.publicKey,
    proof: async ({ method, url, accessToken }) => {
      const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: identity.publicKey };
      const payload = { jti: Crypto.randomUUID(), htm: method, htu: canonicalUrl(url), iat: Math.floor(Date.now() / 1000), ...(accessToken ? { ath: base64Url(sha256(utf8(accessToken))) } : {}) };
      const encodedHeader = base64Url(utf8(JSON.stringify(header)));
      const encodedPayload = base64Url(utf8(JSON.stringify(payload)));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signature = p256.sign(sha256(utf8(signingInput)), privateKey).toCompactRawBytes();
      return `${signingInput}.${base64Url(signature)}`;
    },
  };
}

function createIdentity(): StoredIdentity {
  const privateKey = p256.keygen().secretKey;
  const point = p256.getPublicKey(privateKey, false);
  return { privateKey: base64Url(privateKey), publicKey: { kty: 'EC', crv: 'P-256', x: base64Url(point.slice(1, 33)), y: base64Url(point.slice(33, 65)) } };
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}
