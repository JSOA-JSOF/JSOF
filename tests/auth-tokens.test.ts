import { describe, expect, it } from "vitest";

import {
  hashToken,
  hoursFromNow,
  looksLikeEmail,
  minutesFromNow,
  newToken,
  normaliseEmail,
} from "../src/lib/auth/tokens";

describe("tokens", () => {
  it("issues 256 bits, url safe, never repeating", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = newToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("stores a hash that cannot be used as the token", async () => {
    const token = newToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it("hashes the same token to the same value, so lookup by hash works", async () => {
    const token = newToken();
    expect(await hashToken(token)).toBe(await hashToken(token));
  });

  it("hashes two tokens differently", async () => {
    expect(await hashToken(newToken())).not.toBe(await hashToken(newToken()));
  });
});

describe("expiry", () => {
  const base = new Date("2026-10-27T12:00:00.000Z");

  it("counts forward in UTC and stays ISO", () => {
    expect(minutesFromNow(15, base)).toBe("2026-10-27T12:15:00.000Z");
    expect(hoursFromNow(12, base)).toBe("2026-10-28T00:00:00.000Z");
  });

  it("produces strings that sort in time order, which is how they are compared", () => {
    const a = minutesFromNow(5, base);
    const b = minutesFromNow(10, base);
    expect(a < b).toBe(true);
  });
});

describe("email", () => {
  it("has one form, so the same person is one row", () => {
    expect(normaliseEmail("  Josh.Burton@TheJSOA.org ")).toBe("josh.burton@thejsoa.org");
  });

  it("accepts addresses people have and rejects obvious nonsense", () => {
    for (const good of ["a@b.co", "first.last+tag@sub.example.org"]) {
      expect(looksLikeEmail(good), good).toBe(true);
    }
    for (const bad of ["", "nope", "a@b", "a b@c.com", "@b.com", `${"x".repeat(321)}@b.com`]) {
      expect(looksLikeEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
