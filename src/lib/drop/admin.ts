/**
 * The board's side of a drop.
 *
 * The upload route is open to anyone holding the code on the sign, which is
 * fine because it only writes. Reading is a different thing: the bucket
 * holds photographs of people at an Association event, and the whole page
 * promises they go to the board and nowhere else. So the read routes are
 * behind a secret that is not in this repository and is not on any sign.
 *
 * `DROP_ADMIN_KEY` is a Worker secret:
 *
 *   openssl rand -base64 32 | npx wrangler secret put DROP_ADMIN_KEY
 *
 * If it is not set, the read routes answer 404 rather than 401. An endpoint
 * that distinguishes "wrong key" from "no such route" tells someone
 * sweeping the domain that there is a door here worth working on.
 */

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Hashing both and comparing the digests takes the same time whatever the
 * inputs are, because the digests are always 32 bytes and always differ
 * from the first byte when the inputs differ. A plain `===` on the strings
 * returns early on the first wrong character, which is enough to recover a
 * key one character at a time given enough attempts.
 */
async function matches(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** True when the request carries the board's key. */
export async function isBoard(request: Request, key: string | undefined) {
  if (!key) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.replace(/^Bearer\s+/i, "");
  if (!given) return false;
  return matches(given, key);
}
