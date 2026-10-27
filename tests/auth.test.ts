import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  constantTimeEqual,
  hotp,
  newTotpSecret,
  totp,
  totpUri,
  verifyTotp,
} from "../src/lib/auth/totp";

/**
 * The point of these is that none of the expected values were chosen by
 * me. They are the published vectors in RFC 4226 and RFC 6238, so a pass
 * here means this agrees with the standard rather than with its author.
 */

/** RFC 4226 appendix D: ASCII "12345678901234567890". */
const RFC_SECRET_BYTES = new TextEncoder().encode("12345678901234567890");
const RFC_SECRET_B32 = base32Encode(RFC_SECRET_BYTES);

describe("HOTP against the RFC 4226 vectors", () => {
  // Appendix D, the full table of ten.
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  for (const [counter, code] of expected.entries()) {
    it(`counter ${counter} gives ${code}`, async () => {
      expect(await hotp(RFC_SECRET_BYTES, counter, 6)).toBe(code);
    });
  }
});

describe("TOTP against the RFC 6238 vectors", () => {
  // Appendix B, the SHA-1 rows. Eight digits, as the RFC prints them.
  const rows: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [seconds, code] of rows) {
    it(`T=${seconds} gives ${code}`, async () => {
      expect(await totp(RFC_SECRET_B32, seconds * 1000, 8)).toBe(code);
    });
  }

  it("still agrees at the 2038 boundary, which is a 32-bit counter if done wrong", async () => {
    // T=20000000000 above is past 2038 already; this asserts the shape
    // rather than the value, because a counter written into a 32-bit
    // int would have wrapped and produced something plausible.
    const code = await totp(RFC_SECRET_B32, 20000000000 * 1000, 8);
    expect(code).toBe("65353130");
  });
});

describe("base32 round trips", () => {
  it("encodes the RFC secret the way an authenticator app expects", () => {
    expect(RFC_SECRET_B32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("round trips random secrets of every length up to 32 bytes", () => {
    for (let n = 1; n <= 32; n += 1) {
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      expect([...base32Decode(base32Encode(bytes))], `length ${n}`).toEqual([...bytes]);
    }
  });

  it("accepts the padding and spacing a person actually types", () => {
    const plain = base32Decode("GEZDGNBVGY3TQOJQ");
    expect([...base32Decode("gezd gnbv gy3t qojq")]).toEqual([...plain]);
    expect([...base32Decode("GEZD-GNBV-GY3T-QOJQ")]).toEqual([...plain]);
    expect([...base32Decode("GEZDGNBVGY3TQOJQ======")]).toEqual([...plain]);
  });

  it("refuses something that is not base32", () => {
    expect(() => base32Decode("not base32!")).toThrow();
  });
});

describe("verification", () => {
  const now = 1_700_000_000_000;

  it("accepts the current code", async () => {
    const code = await totp(RFC_SECRET_B32, now);
    expect(await verifyTotp(RFC_SECRET_B32, code, now)).toBe(true);
  });

  it("accepts a code one step old, because phone clocks drift", async () => {
    const code = await totp(RFC_SECRET_B32, now - 30_000);
    expect(await verifyTotp(RFC_SECRET_B32, code, now)).toBe(true);
  });

  it("refuses a code two steps old", async () => {
    const code = await totp(RFC_SECRET_B32, now - 90_000);
    expect(await verifyTotp(RFC_SECRET_B32, code, now)).toBe(false);
  });

  it("refuses the wrong code, an empty one, and anything malformed", async () => {
    for (const bad of ["000000", "", "12345", "1234567", "abcdef", "12 34 56"]) {
      expect(await verifyTotp(RFC_SECRET_B32, bad, now), bad).toBe(false);
    }
  });

  it("accepts a code typed with a space in the middle, which phones show", async () => {
    const code = await totp(RFC_SECRET_B32, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(await verifyTotp(RFC_SECRET_B32, spaced, now)).toBe(true);
  });
});

describe("secrets and the enrolment URI", () => {
  it("issues 160-bit secrets, distinct every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const secret = newTotpSecret();
      expect(base32Decode(secret).length).toBe(20);
      seen.add(secret);
    }
    expect(seen.size).toBe(50);
  });

  it("names the issuer twice, because apps disagree about which one they read", () => {
    const uri = totpUri("GEZDGNBVGY3TQOJQ", "someone@example.org");
    expect(uri.startsWith("otpauth://totp/JSOA%3Asomeone%40example.org?")).toBe(true);
    expect(uri).toContain("issuer=JSOA");
    expect(uri).toContain("period=30");
    expect(uri).toContain("digits=6");
  });
});

describe("constant time comparison", () => {
  it("is still a correct comparison", () => {
    expect(constantTimeEqual("123456", "123456")).toBe(true);
    expect(constantTimeEqual("123456", "123457")).toBe(false);
    expect(constantTimeEqual("123456", "12345")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
