import "server-only";

/**
 * Encryption at rest for the TOTP secret.
 *
 * `migrations/0001` says this column holds a secret "encrypted at rest
 * with a key held as a Worker secret, never the raw base32", and until
 * now the code bound the raw base32. A schema comment the code does
 * not keep is worse than no comment, because the next reader believes
 * it.
 *
 * Why it matters more than it looks. A TOTP secret is not like a
 * password hash: it is the seed, so anybody holding it can generate
 * valid codes forever without the owner's phone and without leaving a
 * failed attempt anywhere. A database dump that contains these is a
 * dump that defeats the second factor entirely, which is the one
 * control standing between a leaked session cookie and a signed-in
 * officer.
 *
 * AES-GCM, through WebCrypto, with a random 96-bit IV per secret
 * stored alongside the ciphertext. GCM is authenticated, so a
 * tampered row fails to decrypt rather than decrypting to something
 * else.
 */

const IV_BYTES = 12;

/**
 * Whether encryption is configured.
 *
 * `TOTP_KEY` is a Worker secret, 32 bytes base64. Without it this
 * module refuses rather than silently storing plaintext, because
 * falling back to the thing the comment forbids is how the comment
 * stopped being true the first time.
 */
export function encryptionConfigured(env: { TOTP_KEY?: string }): boolean {
  return typeof env.TOTP_KEY === "string" && env.TOTP_KEY.length > 0;
}

async function keyFrom(raw: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error("TOTP_KEY must be 32 bytes, base64 encoded");
  }
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/**
 * Encrypt, returning `v1.<iv>.<ciphertext>`, both base64.
 *
 * The version prefix is there so a future key rotation or algorithm
 * change can be told apart from this one at read time, rather than
 * requiring every row to be migrated in one go.
 */
export async function sealSecret(plaintext: string, rawKey: string): Promise<string> {
  const key = await keyFrom(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

/**
 * Decrypt, tolerating a value written before this existed.
 *
 * A row with no version prefix is a raw base32 secret from before
 * encryption landed. It is returned as-is rather than failing, so
 * nobody is locked out of their own account by a security
 * improvement, and `isSealed` lets the caller re-seal it on next use.
 */
export async function openSecret(stored: string, rawKey: string): Promise<string> {
  if (!isSealed(stored)) return stored;
  const [, ivPart, dataPart] = stored.split(".");
  if (!ivPart || !dataPart) throw new Error("malformed sealed secret");
  const key = await keyFrom(rawKey);
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivPart) as BufferSource },
    key,
    fromBase64(dataPart) as BufferSource,
  );
  return new TextDecoder().decode(opened);
}

export function isSealed(stored: string): boolean {
  return stored.startsWith("v1.");
}
