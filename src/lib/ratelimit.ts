import "server-only";

import { database } from "./db";

/**
 * A fixed-window rate limit, in the database.
 *
 * In the database and not in memory, because a Worker isolate is
 * recycled between requests: an in-process counter is a limit per
 * isolate, which under load is no limit at all and is worse than none
 * because it looks like one.
 *
 * Fixed windows rather than a sliding log. A sliding window needs a
 * row per event and gives a smoother limit; a fixed window needs one
 * row per bucket and allows a burst of up to twice the limit across a
 * boundary. For stopping a script from walking a six digit code, that
 * difference does not matter and the cost does.
 */

export type Limit = {
  /** How many are allowed in a window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * The limits, named so a reader can see the reasoning rather than a
 * number somebody picked.
 */
export const LIMITS = {
  /**
   * Sign-in links, per address. Low, because a person who needs a
   * second link within a minute almost always needs to look in their
   * spam folder instead, and because this endpoint makes us send mail
   * to an address a stranger typed.
   */
  signInLink: { max: 3, windowSeconds: 900 },

  /**
   * TOTP attempts, per session. Six digits with a one-step window is
   * about a million possibilities; ten attempts an hour makes a
   * script useless without troubling somebody who fat-fingers a code
   * twice.
   */
  mfaAttempt: { max: 10, windowSeconds: 3600 },

  /**
   * Photo uploads, per client, per hour. Generous: somebody emptying
   * a camera roll after a tournament is the normal case and must not
   * be stopped. It exists to bound a bucket somebody found the code
   * for, not to ration attendees.
   */
  dropUpload: { max: 200, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

function windowStart(windowSeconds: number, at = Date.now()): string {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(at / ms) * ms).toISOString();
}

export type Verdict = { allowed: boolean; remaining: number };

/**
 * Count one event against a bucket and say whether it is allowed.
 *
 * Fails **open** when there is no database, and that is a deliberate
 * trade rather than an oversight: without a binding this is `next dev`
 * on somebody's laptop, and a limiter that bricks local development
 * gets commented out and never uncommented. In production the binding
 * is always there.
 *
 * The increment and the read are one statement, so two concurrent
 * requests cannot both see the same count and both be allowed.
 */
export async function consume(
  bucket: string,
  limit: Limit,
  at = Date.now(),
): Promise<Verdict> {
  const db = database();
  if (!db) return { allowed: true, remaining: limit.max };

  const row = await db
    .prepare(
      "INSERT INTO rate_counter (bucket, window_at, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(bucket, window_at) DO UPDATE SET count = count + 1 " +
        "RETURNING count",
    )
    .bind(bucket, windowStart(limit.windowSeconds, at))
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return { allowed: count <= limit.max, remaining: Math.max(0, limit.max - count) };
}

/**
 * A stable, non-reversible handle for a client.
 *
 * Never the raw address. An IP is personal data, this table would
 * otherwise be a log of who visited and when, and nothing here needs
 * to know the address — only whether two requests came from the same
 * place. Truncated because a full SHA-256 of an IPv4 address is
 * trivially reversible by enumerating the whole space, and a short
 * prefix collides often enough to blur that without blurring the
 * limit.
 */
export async function clientKey(request: Request): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`jsoa-rate:${ip}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Windows older than a day are not interesting. Swept by the worker. */
export async function sweepOldWindows(olderThanHours = 24): Promise<void> {
  const db = database();
  if (!db) return;
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  await db.prepare("DELETE FROM rate_counter WHERE window_at < ?").bind(cutoff).run();
}
