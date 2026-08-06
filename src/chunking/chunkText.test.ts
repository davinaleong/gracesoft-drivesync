import { describe, expect, it } from "vitest";
import { chunkText, createTiktokenTokenizer } from "./chunkText.js";
import type { Tokenizer } from "./chunkText.js";

// Word-level fake tokenizer so chunk-boundary assertions can be reasoned
// about as word counts, independent of tiktoken's exact BPE behavior (that's
// covered separately by the real-tokenizer sanity check below).
function makeWordTokenizer(): Tokenizer {
  const vocab: string[] = [];
  const lookup = new Map<string, number>();
  return {
    encode(text) {
      return text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
          let id = lookup.get(word);
          if (id === undefined) {
            id = vocab.length;
            vocab.push(word);
            lookup.set(word, id);
          }
          return id;
        });
    },
    decode(tokens) {
      return tokens.map((id) => vocab[id]).join(" ");
    },
  };
}

describe("chunkText", () => {
  it("returns a single chunk when the text fits within maxTokens", () => {
    const tokenizer = makeWordTokenizer();
    const chunks = chunkText("one two three", tokenizer, { maxTokens: 10, overlapTokens: 2 });

    expect(chunks).toEqual([{ index: 0, text: "one two three", section: undefined, tokenCount: 3 }]);
  });

  it("returns no chunks for empty text", () => {
    const tokenizer = makeWordTokenizer();
    expect(chunkText("", tokenizer, { maxTokens: 10, overlapTokens: 2 })).toEqual([]);
    expect(chunkText("   \n\n  ", tokenizer, { maxTokens: 10, overlapTokens: 2 })).toEqual([]);
  });

  it("splits long text into multiple chunks with the requested overlap", () => {
    const tokenizer = makeWordTokenizer();
    const words = Array.from({ length: 10 }, (_, i) => `w${i}`);
    const text = words.join(" ");

    const chunks = chunkText(text, tokenizer, { maxTokens: 4, overlapTokens: 1 });

    // chunk boundaries: [0-4), [3-7), [6-10)
    expect(chunks.map((c) => c.text)).toEqual(["w0 w1 w2 w3", "w3 w4 w5 w6", "w6 w7 w8 w9"]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("assigns sequential indices across multiple segments", () => {
    const tokenizer = makeWordTokenizer();
    const text = "Intro\n\nfirst body paragraph\n\nConclusion\n\nsecond body paragraph";

    const chunks = chunkText(text, tokenizer, { maxTokens: 10, overlapTokens: 1 });

    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it("attaches the active heading as section metadata", () => {
    const tokenizer = makeWordTokenizer();
    const text = "Introduction\n\nThis is the intro body text here.\n\nPricing\n\nThis is the pricing body text.";

    const chunks = chunkText(text, tokenizer, { maxTokens: 20, overlapTokens: 2 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.section).toBe("Introduction");
    expect(chunks[0]?.text).toContain("intro body");
    expect(chunks[1]?.section).toBe("Pricing");
    expect(chunks[1]?.text).toContain("pricing body");
  });

  it("strips markdown-style heading markers from section metadata", () => {
    const tokenizer = makeWordTokenizer();
    const text = "## Getting Started\n\nBody text goes here for the section.";

    const chunks = chunkText(text, tokenizer, { maxTokens: 20, overlapTokens: 2 });

    expect(chunks[0]?.section).toBe("Getting Started");
  });

  it("leaves section undefined for body text with no preceding heading", () => {
    const tokenizer = makeWordTokenizer();
    const chunks = chunkText("just a plain paragraph, no heading above it.", tokenizer, {
      maxTokens: 20,
      overlapTokens: 2,
    });

    expect(chunks[0]?.section).toBeUndefined();
  });

  it("does not let overlap bleed across a section boundary", () => {
    const tokenizer = makeWordTokenizer();
    const words = Array.from({ length: 5 }, (_, i) => `a${i}`).join(" ");
    const text = `Heading One\n\n${words}\n\nHeading Two\n\nsome more words after the second heading here`;

    const chunks = chunkText(text, tokenizer, { maxTokens: 3, overlapTokens: 1 });

    const heading2Chunks = chunks.filter((c) => c.section === "Heading Two");
    for (const chunk of heading2Chunks) {
      expect(chunk.text).not.toMatch(/a\d/);
    }
  });

  it("rejects an overlap that is not smaller than maxTokens", () => {
    const tokenizer = makeWordTokenizer();
    expect(() => chunkText("a b c", tokenizer, { maxTokens: 5, overlapTokens: 5 })).toThrow();
    expect(() => chunkText("a b c", tokenizer, { maxTokens: 5, overlapTokens: 6 })).toThrow();
  });

  it("rejects a non-positive maxTokens", () => {
    const tokenizer = makeWordTokenizer();
    expect(() => chunkText("a b c", tokenizer, { maxTokens: 0, overlapTokens: 0 })).toThrow();
  });
});

describe("createTiktokenTokenizer (real tokenizer sanity check)", () => {
  it("round-trips text through encode/decode and reports a plausible token count", () => {
    const tokenizer = createTiktokenTokenizer();
    const tokens = tokenizer.encode("Hello, world! This is a real tiktoken sanity check.");

    expect(tokens.length).toBeGreaterThan(5);
    expect(tokenizer.decode(tokens)).toBe("Hello, world! This is a real tiktoken sanity check.");
  });

  it("produces chunks whose token counts respect maxTokens end to end", () => {
    const tokenizer = createTiktokenTokenizer();
    const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(20);

    const chunks = chunkText(paragraph, tokenizer, { maxTokens: 20, overlapTokens: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(20);
    }
  });
});
