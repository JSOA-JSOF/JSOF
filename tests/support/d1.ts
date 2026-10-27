import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A D1Database over node:sqlite, for testing the D1 repositories.
 *
 * Three of the ports built one of these in a scratch directory to check
 * their own SQL, then threw it away, which meant nothing in `npm test`
 * covered a single line of the six D1 implementations. This is the same
 * idea kept, shared, and made strict.
 *
 * It applies the real files from `migrations/`, read off disk in order,
 * so the fixture cannot drift from the schema: a migration that lands
 * without the repositories being updated fails here rather than in
 * production.
 *
 * ## What it deliberately does NOT do
 *
 * It is SQLite, not D1. It shares an engine with D1 and that is why the
 * SQL, the triggers and the constraints are worth testing here, but it
 * is not the same runtime. It does not prove how the real driver
 * serialises a row, how `batch` behaves under concurrency, or what an
 * error from the Cloudflare API looks like. Those still need a Worker.
 */

type Param = string | number | null;

/**
 * Strict on purpose, where the ports' own shims were lenient.
 *
 * Real D1 throws on `undefined`. Two of the scratch shims quietly
 * turned it into NULL, which means they would have passed a repository
 * that D1 rejects. A test double that is kinder than production hides
 * exactly the bug it was built to find.
 */
function normalise(values: unknown[], sql: string): Param[] {
  return values.map((value, index) => {
    if (value === undefined) {
      throw new TypeError(
        `bind parameter ${index + 1} is undefined, which D1 refuses. ` +
          `Pass null for an absent value. SQL: ${sql.slice(0, 120)}`,
      );
    }
    if (value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" || typeof value === "string") return value;
    throw new TypeError(
      `bind parameter ${index + 1} is a ${typeof value}, which D1 refuses. ` +
        `SQL: ${sql.slice(0, 120)}`,
    );
  });
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, normalise(values, this.sql));
  }

  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T) ?? null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.db.prepare(this.sql).all(...this.params) as T[],
      success: true,
    };
  }

  async run(): Promise<{ success: true }> {
    this.runSync();
    return { success: true };
  }

  /**
   * Used by `batch`, synchronously, so every statement runs inside the
   * open transaction. A RETURNING clause needs `get()`; the membership
   * port's shim found that and the scholarships one did not, which is
   * why its batch could not have carried `nextInSequence`.
   */
  runSync(): unknown {
    const prepared = this.db.prepare(this.sql);
    if (/\breturning\b/i.test(this.sql)) return prepared.get(...this.params);
    return prepared.run(...this.params);
  }
}

export type TestDatabase = {
  binding: D1Database;
  /** For arranging rows and asserting directly, outside the repository. */
  raw: DatabaseSync;
  close(): void;
};

let cachedMigrations: string[] | null = null;

function migrations(): string[] {
  if (cachedMigrations) return cachedMigrations;
  const dir = join(import.meta.dirname, "..", "..", "migrations");
  cachedMigrations = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
  return cachedMigrations;
}

export function openTestDatabase(): TestDatabase {
  const db = new DatabaseSync(":memory:");
  // D1 enforces these; verified against the live database. A fixture
  // that did not would let a dangling reference through.
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations()) db.exec(sql);

  const binding = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const out = statements.map((statement) => statement.runSync());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;

  return { binding, raw: db, close: () => db.close() };
}
