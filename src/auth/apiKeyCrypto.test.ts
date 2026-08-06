import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "./apiKeyCrypto.js";

describe("generateApiKey", () => {
  it("produces keys prefixed with dsk_", () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith("dsk_")).toBe(true);
  });

  it("produces a different key on every call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
  });

  it("keyPrefix is a non-secret slice safe for display, not the whole key", () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(rawKey.startsWith(keyPrefix)).toBe(true);
    expect(keyPrefix.length).toBeLessThan(rawKey.length);
  });
});

describe("hashApiKey", () => {
  it("is deterministic for the same key and pepper", () => {
    const { rawKey } = generateApiKey();
    expect(hashApiKey(rawKey, "pepper-a")).toBe(hashApiKey(rawKey, "pepper-a"));
  });

  it("never contains the raw key — the hash doesn't leak the secret", () => {
    const { rawKey } = generateApiKey();
    const hash = hashApiKey(rawKey, "pepper-a");
    expect(hash).not.toContain(rawKey);
    expect(hash).not.toBe(rawKey);
  });

  it("the pepper actually participates in the hash — changing it changes every hash", () => {
    const { rawKey } = generateApiKey();
    const hashWithPepperA = hashApiKey(rawKey, "pepper-a");
    const hashWithPepperB = hashApiKey(rawKey, "pepper-b");
    expect(hashWithPepperA).not.toBe(hashWithPepperB);
  });
});

describe("looksLikeApiKey", () => {
  it("accepts well-formed keys", () => {
    const { rawKey } = generateApiKey();
    expect(looksLikeApiKey(rawKey)).toBe(true);
  });

  it("rejects keys missing the prefix", () => {
    expect(looksLikeApiKey("not-a-real-key")).toBe(false);
  });

  it("rejects the bare prefix with nothing after it", () => {
    expect(looksLikeApiKey("dsk_")).toBe(false);
  });
});
