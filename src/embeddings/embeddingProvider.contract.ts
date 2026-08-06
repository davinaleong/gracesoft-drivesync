import { describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "./embeddingProvider.js";

/**
 * Shared test suite any `EmbeddingProvider` implementation must pass —
 * starting with the OpenAI adapter, and required for any contributor-added
 * adapter before merge (see the testing checklist). Only asserts properties
 * that hold for *any* implementation (shape, count, dimensions, surviving
 * more-than-one-batch input); adapter-specific behavior like retry/backoff
 * belongs in that adapter's own test file, since it depends on the
 * underlying client's error shape.
 */
export function defineEmbeddingProviderContractTests(name: string, createProvider: () => EmbeddingProvider): void {
  describe(`${name} (EmbeddingProvider contract)`, () => {
    it("returns an empty array for empty input", async () => {
      const provider = createProvider();
      expect(await provider.embed([])).toEqual([]);
    });

    it("returns one vector per input text, each matching provider.dimensions", async () => {
      const provider = createProvider();
      const vectors = await provider.embed(["alpha", "beta", "gamma"]);

      expect(vectors).toHaveLength(3);
      for (const vector of vectors) {
        expect(vector).toHaveLength(provider.dimensions);
      }
    });

    it("handles input larger than a single internal batch without dropping or duplicating entries", async () => {
      const provider = createProvider();
      const texts = Array.from({ length: 250 }, (_, i) => `text-${i}`);

      const vectors = await provider.embed(texts);

      expect(vectors).toHaveLength(texts.length);
      for (const vector of vectors) {
        expect(vector).toHaveLength(provider.dimensions);
      }
    });
  });
}
