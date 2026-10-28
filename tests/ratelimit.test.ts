import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTestDatabase, type TestDatabase } from "./support/d1";

let current: TestDatabase | null = null;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!current) throw new Error("no test database open");
    return { env: { DB: current.binding } };
  },
}));

beforeEach(() => {
  current?.close();
  current = openTestDatabase();
});

const lib = () => import("../src/lib/ratelimit");

describe("the rate limiter", () => {
  it("allows up to the limit and refuses after it", async () => {
    const { consume } = await lib();
    const limit = { max: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await consume("probe", limit));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[2]?.remaining).toBe(0);
  });

  it("counts buckets separately, so one address cannot lock out another", async () => {
    const { consume } = await lib();
    const limit = { max: 1, windowSeconds: 60 };
    expect((await consume("signin:a@example.org", limit)).allowed).toBe(true);
    expect((await consume("signin:a@example.org", limit)).allowed).toBe(false);
    expect((await consume("signin:b@example.org", limit)).allowed).toBe(true);
  });

  it("starts fresh in the next window", async () => {
    const { consume } = await lib();
    const limit = { max: 2, windowSeconds: 60 };
    const t0 = Date.parse("2026-10-27T12:00:00.000Z");
    await consume("probe", limit, t0);
    await consume("probe", limit, t0);
    expect((await consume("probe", limit, t0)).allowed).toBe(false);
    // Next window.
    expect((await consume("probe", limit, t0 + 61_000)).allowed).toBe(true);
  });

  it("is a single statement, so two concurrent calls cannot both pass the last slot", async () => {
    const { consume } = await lib();
    const limit = { max: 5, windowSeconds: 60 };
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => consume("race", limit)),
    );
    // Exactly five allowed, whatever order they land in. A read-then-
    // write limiter lets more than five through here.
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(5);
  });

  it("never records a raw address", async () => {
    const { clientKey } = await lib();
    const key = await clientKey(
      new Request("https://example.org", {
        headers: { "cf-connecting-ip": "203.0.113.42" },
      }),
    );
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain("203");
  });

  it("gives the same client the same key, and different clients different ones", async () => {
    const { clientKey } = await lib();
    const of = (ip: string) =>
      clientKey(new Request("https://example.org", { headers: { "cf-connecting-ip": ip } }));
    expect(await of("203.0.113.42")).toBe(await of("203.0.113.42"));
    expect(await of("203.0.113.42")).not.toBe(await of("203.0.113.43"));
  });

  it("sweeps windows that are no longer interesting", async () => {
    const { consume, sweepOldWindows } = await lib();
    const limit = { max: 1, windowSeconds: 60 };
    await consume("old", limit, Date.now() - 48 * 3_600_000);
    await consume("new", limit);
    await sweepOldWindows(24);
    const rows = current!.raw.prepare("SELECT bucket FROM rate_counter").all();
    expect(rows.map((r) => (r as { bucket: string }).bucket)).toEqual(["new"]);
  });
});

describe("the limits themselves", () => {
  it("are tight where a secret is guessable and loose where a person is just busy", async () => {
    const { LIMITS } = await lib();
    // A six digit code must not be walkable.
    expect(LIMITS.mfaAttempt.max).toBeLessThanOrEqual(10);
    // Sending mail to a stranger's address must not be cheap.
    expect(LIMITS.signInLink.max).toBeLessThanOrEqual(5);
    // Emptying a camera roll must not be stopped.
    expect(LIMITS.dropUpload.max).toBeGreaterThanOrEqual(100);
  });
});
