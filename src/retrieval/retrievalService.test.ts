import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { ScoredVectorRecord, VectorStore } from "../vectorstore/vectorStore.js";
import { createRetrievalService } from "./retrievalService.js";

function makeEmbeddingProvider(vector: number[] = [1, 0, 0]): EmbeddingProvider {
  return { dimensions: vector.length, embed: vi.fn(async () => [vector]) };
}

function makeVectorStore(matches: ScoredVectorRecord[]): VectorStore {
  return {
    upsert: vi.fn(),
    delete: vi.fn(),
    fetch: vi.fn(async () => []),
    getDimension: vi.fn(async () => undefined),
    query: vi.fn(async () => matches),
  };
}

describe("createRetrievalService", () => {
  it("embeds the query and returns chunk text plus attribution", async () => {
    const vectorStore = makeVectorStore([
      { id: "file-1-0", score: 0.9, metadata: { text: "chunk body", fileId: "file-1", name: "doc.txt", section: "Intro" } },
    ]);
    const service = createRetrievalService({ embeddingProvider: makeEmbeddingProvider(), vectorStore });

    const results = await service.query("acct_1", "what is this about?", 5);

    expect(results).toEqual([
      { text: "chunk body", score: 0.9, fileId: "file-1", fileName: "doc.txt", section: "Intro" },
    ]);
  });

  it("queries only the caller's own namespace (accountId)", async () => {
    const vectorStore = makeVectorStore([]);
    const service = createRetrievalService({ embeddingProvider: makeEmbeddingProvider([1, 2, 3]), vectorStore });

    await service.query("acct_42", "hello", 3);

    expect(vectorStore.query).toHaveBeenCalledWith("acct_42", [1, 2, 3], 3);
  });

  it("leaves section undefined when the chunk had none", async () => {
    const vectorStore = makeVectorStore([{ id: "file-1-0", score: 0.5, metadata: { text: "body", fileId: "file-1", name: "doc.txt" } }]);
    const service = createRetrievalService({ embeddingProvider: makeEmbeddingProvider(), vectorStore });

    const results = await service.query("acct_1", "query", 5);

    expect(results[0]?.section).toBeUndefined();
  });

  it("defaults missing string metadata to empty strings rather than throwing", async () => {
    const vectorStore = makeVectorStore([{ id: "file-1-0", score: 0.5, metadata: {} }]);
    const service = createRetrievalService({ embeddingProvider: makeEmbeddingProvider(), vectorStore });

    const results = await service.query("acct_1", "query", 5);

    expect(results).toEqual([{ text: "", score: 0.5, fileId: "", fileName: "", section: undefined }]);
  });

  it("returns an empty array when embedding produces no vector", async () => {
    const embeddingProvider: EmbeddingProvider = { dimensions: 3, embed: vi.fn(async () => []) };
    const vectorStore = makeVectorStore([]);
    const service = createRetrievalService({ embeddingProvider, vectorStore });

    const results = await service.query("acct_1", "query", 5);

    expect(results).toEqual([]);
    expect(vectorStore.query).not.toHaveBeenCalled();
  });
});
