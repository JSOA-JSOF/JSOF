import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The shared half of every module's D1 repository.
 *
 * This file exists so that six ports do not invent six answers to the
 * same four questions: how to reach the binding, how to turn a row into
 * a domain object, what a boolean is in SQLite, and what happens when
 * there is no database at all.
 *
 * It is read-only to modules, like `authz`. If a module needs something
 * here that is not here, that is a finding to report rather than a
 * local copy to make.
 */

/**
 * The binding, or null.
 *
 * Null is a normal state and not an error: `next dev` with no Worker
 * behind it has no binding, and the public tier works fine without one.
 * Each module's accessor uses this to decide between its D1 repository
 * and its in-memory one, which is also what keeps the 855 tests running
 * against seed data at the speed they do.
 */
export function database(): D1Database | null {
  try {
    const { env } = getCloudflareContext();
    return env.DB ?? null;
  } catch {
    // Outside a request context, which is the case during a build.
    return null;
  }
}

export function requireDatabase(): D1Database {
  const db = database();
  if (!db) throw new Error("no D1 binding; this code path requires a database");
  return db;
}

/* Values ------------------------------------------------------------ *
 *
 * SQLite has no boolean and no date. Both conversions are one line and
 * both are wrong in a different way every time somebody writes them
 * again, so they are written once.
 */

/** A boolean on the way in. SQLite stores 0 and 1. */
export function toInt(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * A boolean on the way out.
 *
 * Deliberately strict about what counts as true. A column that should
 * hold 0 or 1 and holds "0" has gone wrong somewhere upstream, and
 * treating the string as truthy would hide it; this returns false and
 * the bug surfaces as behaviour rather than as a silent permission.
 */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Null-safe text out of a row, for a column the domain type says is required. */
export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Null-safe integer out of a row. */
export function int(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/** A nullable column, normalised: SQLite gives null, the domain wants null. */
export function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/* Queries ----------------------------------------------------------- *
 *
 * Thin wrappers, for the two shapes that come up constantly. They exist
 * for readability rather than for abstraction: anything more complex
 * than these should be written as SQL in the module that needs it.
 */

export async function one<T>(
  statement: D1PreparedStatement,
): Promise<T | null> {
  return statement.first<T>();
}

export async function many<T>(statement: D1PreparedStatement): Promise<T[]> {
  const { results } = await statement.all<T>();
  return results ?? [];
}

/**
 * Several writes that must all land or none.
 *
 * D1's `batch` is a transaction. Use it wherever a domain object spans
 * tables: an order and its lines, a minute entry and its recusals, a
 * donation and its allocations. Writing the parent and then the
 * children as separate awaits leaves an order with no lines on the
 * floor when the second call fails, and nothing will ever tell you.
 */
export async function atomic(
  statements: D1PreparedStatement[],
): Promise<void> {
  if (statements.length === 0) return;
  await requireDatabase().batch(statements);
}

/**
 * A sequence number, allocated without a race.
 *
 * Several modules mint a human-facing reference that counts up:
 * `JSOA-2026-0007`, a receipt number, a minute reference. Reading the
 * highest and adding one is a race that two concurrent requests both
 * win, producing the same number twice. This is the usual fix: a row
 * per counter, incremented in a single statement that returns the new
 * value.
 */
export async function nextInSequence(name: string): Promise<number> {
  const row = await requireDatabase()
    .prepare(
      "INSERT INTO counter (name, value) VALUES (?, 1) " +
        "ON CONFLICT(name) DO UPDATE SET value = value + 1 " +
        "RETURNING value",
    )
    .bind(name)
    .first<{ value: number }>();
  if (!row) throw new Error(`could not allocate a number for ${name}`);
  return row.value;
}
