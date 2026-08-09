import { describe, expect, it } from "vitest";
import { computeContentHash, hasContentChanged } from "./contentHash.js";

describe("computeContentHash", () => {
  it("produces identical hashes for identical content", () => {
    expect(computeContentHash("hello world")).toBe(computeContentHash("hello world"));
  });

  it("produces different hashes for different content", () => {
    expect(computeContentHash("hello world")).not.toBe(computeContentHash("hello world!"));
  });

  it("is sensitive to whitespace-only differences", () => {
    expect(computeContentHash("hello world")).not.toBe(computeContentHash("hello  world"));
  });

  it("hashes empty content deterministically", () => {
    expect(computeContentHash("")).toBe(computeContentHash(""));
  });
});

describe("hasContentChanged", () => {
  it("reports changed when there is no previous hash", () => {
    expect(hasContentChanged(undefined, computeContentHash("hello"))).toBe(true);
  });

  it("reports unchanged when hashes match", () => {
    const hash = computeContentHash("hello");
    expect(hasContentChanged(hash, hash)).toBe(false);
  });

  it("reports changed when hashes differ", () => {
    expect(hasContentChanged(computeContentHash("hello"), computeContentHash("goodbye"))).toBe(true);
  });
});
