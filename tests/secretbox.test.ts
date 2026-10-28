import { describe, expect, it } from "vitest";

import {
  encryptionConfigured,
  isSealed,
  openSecret,
  sealSecret,
} from "../src/lib/auth/secretbox";

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("the TOTP secret at rest", () => {
  it("round trips", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(await openSecret(await sealSecret(secret, KEY), KEY)).toBe(secret);
  });

  it("looks nothing like the secret, and differs every time", async () => {
    const secret = "GEZDGNBVGY3TQOJQ";
    const a = await sealSecret(secret, KEY);
    const b = await sealSecret(secret, KEY);
    expect(a).not.toContain(secret);
    // A fresh IV per secret, so two members with the same seed do not
    // produce the same row.
    expect(a).not.toBe(b);
    expect(await openSecret(b, KEY)).toBe(secret);
  });

  it("refuses a tampered value rather than decrypting to something else", async () => {
    const sealed = await sealSecret("GEZDGNBVGY3TQOJQ", KEY);
    const [v, iv, data] = sealed.split(".");
    const flipped = data!.slice(0, -4) + (data!.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await expect(openSecret(`${v}.${iv}.${flipped}`, KEY)).rejects.toThrow();
  });

  it("refuses the wrong key", async () => {
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const sealed = await sealSecret("GEZDGNBVGY3TQOJQ", KEY);
    await expect(openSecret(sealed, other)).rejects.toThrow();
  });

  it("refuses a key that is the wrong length, rather than padding it", async () => {
    await expect(sealSecret("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });

  it("reads a secret written before encryption existed", async () => {
    // Nobody is locked out of their own account by a security
    // improvement. isSealed tells the caller to re-seal it.
    const legacy = "GEZDGNBVGY3TQOJQ";
    expect(isSealed(legacy)).toBe(false);
    expect(await openSecret(legacy, KEY)).toBe(legacy);
    expect(isSealed(await sealSecret(legacy, KEY))).toBe(true);
  });

  it("knows whether it is configured", () => {
    expect(encryptionConfigured({})).toBe(false);
    expect(encryptionConfigured({ TOTP_KEY: "" })).toBe(false);
    expect(encryptionConfigured({ TOTP_KEY: KEY })).toBe(true);
  });
});
