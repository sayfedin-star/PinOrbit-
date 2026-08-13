import { isKnownDefaultKek, isProductionEnv } from '../db/clients';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b))));
const ub64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(kek: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(kek));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plain: string, kek: string) {
  if (isProductionEnv() && isKnownDefaultKek(kek)) {
    throw new Error("Refusing to encrypt with default TOKEN_KEK in production. Set via 'wrangler secret put TOKEN_KEK'.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(kek), enc.encode(plain));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptToken(stored: string, kek: string): Promise<string | null> {
  if (isProductionEnv() && isKnownDefaultKek(kek)) return null;
  const [ver, iv, ct] = stored.split(':');
  if (ver !== 'v1') return null;
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(iv) }, await key(kek), ub64(ct)));
  } catch {
    return null;
  }
}
