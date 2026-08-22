/**
 * Constant-time comparison between two strings to mitigate timing attack vulnerabilities.
 * Works seamlessly in Cloudflare Workers, Node.js, and browser environments.
 */
export function timingSafeEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }

  return mismatch === 0;
}
