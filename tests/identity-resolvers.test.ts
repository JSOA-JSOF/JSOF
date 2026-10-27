import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { subjectFromParam } from "../src/lib/donations/devSubject";
import { DEV_VIEWERS, resolveDevViewer } from "../src/lib/store/dev";

/**
 * Every way a request can claim an identity must refuse in production.
 *
 * This rule exists because the same bug has now been found twice. On 23
 * October the member-only storefront was openable by anyone on the live
 * site with `?viewer=good-standing`. On 27 October the donations
 * screens were found honouring `?as=TREASURER:JSOF`, returning real
 * role assignments with `mfaSatisfied: true`.
 *
 * The second one was shielded rather than guarded: the board layout
 * happened to call a dev-only function first, which throws in
 * production. That is a guard in a different file from the thing it
 * guards, and it would have vanished the moment real sessions were
 * wired into that layout.
 *
 * So this is written as a rule over every resolver rather than as two
 * tests about two parameters. A new one added without a guard fails
 * here. The fix for the first instance did not prevent the second, and
 * this is the thing that would have.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function inProduction() {
  vi.stubEnv("NODE_ENV", "production");
}

describe("identity resolvers refuse in production", () => {
  it("the store viewer switch grants nothing, whatever key is asked for", () => {
    inProduction();
    // Every option it knows about, including the ones that carry access.
    for (const option of DEV_VIEWERS) {
      const resolved = resolveDevViewer(option.key);
      expect(resolved.key, `?viewer=${option.key} should resolve to a visitor`).toBe(
        "visitor",
      );
    }
  });

  it("the donations role switch grants no assignments, for any role", () => {
    inProduction();
    for (const value of [
      "TREASURER:JSOF",
      "PRESIDENT:JSOF",
      "FINANCE_REVIEW_OFFICER:JSOF",
      "WEBMASTER:JSOF",
    ]) {
      const subject = subjectFromParam(value);
      expect(subject.assignments, `?as=${value} should grant nothing`).toEqual([]);
      expect(subject.mfaSatisfied, `?as=${value} should not claim MFA`).toBe(false);
    }
  });

  it("both still work in development, or the demo is dead", () => {
    // The guards must not be so broad that nobody can exercise a role
    // locally. A control that makes the thing unusable gets removed.
    expect(resolveDevViewer("good-standing").key).toBe("good-standing");
    expect(subjectFromParam("TREASURER:JSOF").assignments).toEqual([
      { role: "TREASURER", entity: "JSOF" },
    ]);
  });
});

describe("no rendered route resolves identity through a dev-only function", () => {
  /**
   * `getCurrentPersona()` calls `assertDevOnly()`, which throws on
   * NODE_ENV=production. Fourteen files called it, one of them the
   * board layout, so the entire board layer failed in production
   * before a single page rendered. They now go through
   * `requireBoardViewer()`, which resolves a real session and falls
   * back to a persona only where that is allowed.
   *
   * This is a rule rather than a count, so the next route added does
   * not quietly reintroduce it.
   */
  function walk(dir: string): string[] {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  }

  /**
   * Comments stripped first. The first version of this test failed on
   * the comment in the board layout explaining why the call was
   * removed, which is the wrong thing to fail on: a test that cannot
   * tell code from prose teaches people to delete the prose.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("calls it from nowhere under src/app", () => {
    const offenders = walk(join(import.meta.dirname, "..", "src", "app"))
      .filter((path) => /\.tsx?$/.test(path))
      .filter((path) =>
        /getCurrentPersona\s*\(/.test(withoutComments(readFileSync(path, "utf8"))),
      );

    expect(
      offenders,
      "these resolve identity through a function that throws in production",
    ).toEqual([]);
  });
});
