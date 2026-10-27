import { afterEach, describe, expect, it, vi } from "vitest";

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
