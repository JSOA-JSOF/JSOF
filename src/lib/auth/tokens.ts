/**
 * Secrets that travel: the magic link token and the session cookie.
 *
 * One rule shapes all of it. What is stored is never what is presented.
 * A sign-in link is sent to a mailbox and a session cookie sits in a
 * browser, but the database holds only a SHA-256 of each, so a dump of
 * `login_token` or `session` is not a set of working credentials. That
 * also means a lookup is by hash, never by a scan and compare.
 *
 * SHA-256 and not a password hash, deliberately. Argon2 and bcrypt are
 * slow on purpose because a password is low entropy and guessable.
 * These are 256 bits from a CSPRNG; there is nothing to guess, and a
 * slow hash would only add latency to every authenticated request.
 */

/** 256 bits, base64url, URL and cookie safe. */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Minutes a sign-in link stays good. Short: it is sitting in a mailbox. */
export const LOGIN_TOKEN_MINUTES = 15;

/**
 * Hours a session lasts.
 *
 * Twelve, so a volunteer who signs in to do board work in the evening
 * is not signed in on a shared machine the next morning. Long enough
 * that nobody is re-authenticating mid-task.
 */
export const SESSION_HOURS = 12;

export const SESSION_COOKIE = "jsoa_session";

export function minutesFromNow(minutes: number, now = new Date()): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function hoursFromNow(hours: number, now = new Date()): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

/** Lowercased and trimmed. Identity is the email, so it has one form. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  // Deliberately loose. The authoritative check is whether a link sent
  // to the address is ever opened; a stricter regex only rejects valid
  // addresses somebody actually has.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}
