import { describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import { assertEmbeddingDimensionMatchesVectorStore } from "./assertProviderCompatibility.js";
import type { VectorStore } from "./vectorStore.js";

function makeEmbeddingProvider(dimensions: number): EmbeddingProvider {
  return { dimensions, embed: async () => [] };
}

function makeVectorStore(dimension: number | undefined): VectorStore {
  return {
    upsert: async () => {},
    query: async () => [],
    delete: async () => {},
    fetch: async () => [],
    getDimension: async () => dimension,
  };
}

describe("assertEmbeddingDimensionMatchesVectorStore", () => {
  it("passes when dimensions match", async () => {
    await expect(
      assertEmbeddingDimensionMatchesVectorStore(makeEmbeddingProvider(1536), makeVectorStore(1536)),
    ).resolves.toBeUndefined();
  });

  it("passes when the vector store has no known dimension yet (brand-new index)", async () => {
    await expect(
      assertEmbeddingDimensionMatchesVectorStore(makeEmbeddingProvider(1536), makeVectorStore(undefined)),
    ).resolves.toBeUndefined();
  });

  it("throws a clear, actionable error when dimensions mismatch", async () => {
    await expect(
      assertEmbeddingDimensionMatchesVectorStore(makeEmbeddingProvider(3072), makeVectorStore(1536)),
    ).rejects.toThrow(/full resync/);
  });

  it("includes both dimensions in the error message", async () => {
    await expect(
      assertEmbeddingDimensionMatchesVectorStore(makeEmbeddingProvider(3072), makeVectorStore(1536)),
    ).rejects.toThrow(/3072.*1536/s);
  });
});
