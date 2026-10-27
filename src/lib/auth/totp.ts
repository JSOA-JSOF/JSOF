/**
 * Time-based one-time passwords, RFC 6238.
 *
 * Written here rather than pulled in, for two reasons that are not
 * "it is only forty lines". The toolchain is fixed and the module brief
 * forbids adding a dependency; and this is small enough to verify
 * completely. The RFC publishes test vectors, `tests/auth.test.ts` runs
 * every one of them, so this implementation is checked against the
 * standard itself rather than against my reading of it.
 *
 * Rolling your own crypto is usually a bad idea. What makes it
 * defensible here is that none of it is invented: HMAC comes from
 * WebCrypto, the truncation is the one the RFC specifies, and the
 * answers are published. The moment any of that stops being true, this
 * file should become a dependency instead.
 *
 * SHA-1 is correct here and is not a weakness. HOTP is specified on
 * HMAC-SHA-1, every authenticator app implements that, and HMAC does not
 * inherit SHA-1's collision problems.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 as authenticator apps expect it, unpadded. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Padding and spacing are what a person types or an app prints; both
  // are noise, and rejecting them would fail a correct secret.
  const clean = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", imported, message as BufferSource);
  return new Uint8Array(signature);
}

/** RFC 4226. `counter` is a 64-bit big-endian value. */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits = 6,
): Promise<string> {
  const message = new Uint8Array(8);
  // Written from the low end up, so the high word is zero for any
  // counter JavaScript can represent exactly. Valid until the year
  // 5.8 million at a 30 second step.
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }

  const digest = await hmacSha1(secret, message);
  // Dynamic truncation, RFC 4226 section 5.3. The low nibble of the
  // last byte picks where to read the four bytes from.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export const TOTP_STEP_SECONDS = 30;

/** The code for a moment. `atMs` defaults to now. */
export async function totp(
  secretBase32: string,
  atMs: number = Date.now(),
  digits = 6,
  step = TOTP_STEP_SECONDS,
): Promise<string> {
  const counter = Math.floor(atMs / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Check a code, allowing one step either side.
 *
 * The window exists because phone clocks drift and because somebody
 * reads the code at the end of its life and types it at the start of
 * the next. One step is 30 seconds either way, which is the usual
 * choice: wider starts to matter if a code is ever observed.
 *
 * Comparison is constant time. A fast reject on the first wrong digit
 * leaks which digit was wrong, and a six digit space is small enough
 * that it would matter.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
  window = 1,
): Promise<boolean> {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;

  let matched = false;
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = await totp(secretBase32, atMs + drift * TOTP_STEP_SECONDS * 1000);
    // No early exit: every candidate is compared, so the time taken
    // does not say which one matched.
    if (constantTimeEqual(expected, given)) matched = true;
  }
  return matched;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A new secret, 160 bits, which is what RFC 4226 recommends for SHA-1. */
export function newTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * The URI an authenticator app scans.
 *
 * The issuer appears twice on purpose: once as a label prefix and once
 * as a parameter. Older apps read one, newer ones read the other, and
 * an entry labelled only with an email address is unusable on a phone
 * that holds thirty of them.
 */
export function totpUri(secret: string, email: string, issuer = "JSOA"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
