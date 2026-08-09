import { describe, expect, it, vi } from "vitest";
import { defineVectorStoreContractTests } from "./vectorStore.contract.js";
import type { PineconeIndexClient, PineconeNamespaceClient } from "./pineconeVectorStore.js";
import { createPineconeVectorStore } from "./pineconeVectorStore.js";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// In-memory stand-in for the real Pinecone SDK's Index client — good enough
// to run the provider-agnostic contract suite (real cosine-similarity
// search, real per-namespace isolation) without needing a live index for
// every test run. Not a shipped VectorStore implementation, just a fake at
// the same seam createOpenAiEmbeddingClient's fake occupies in M7's tests.
function makeFakePineconeIndexClient(): PineconeIndexClient {
  const namespaces = new Map<string, Map<string, { values: number[]; metadata?: Record<string, unknown> }>>();

  function getNamespace(namespace: string) {
    let ns = namespaces.get(namespace);
    if (!ns) {
      ns = new Map();
      namespaces.set(namespace, ns);
    }
    return ns;
  }

  return {
    namespace(namespace: string): PineconeNamespaceClient {
      const ns = getNamespace(namespace);
      return {
        async upsert(records) {
          for (const record of records) {
            ns.set(record.id, { values: record.values, metadata: record.metadata });
          }
        },
        async query({ vector, topK, includeMetadata }) {
          const scored = [...ns.entries()].map(([id, record]) => ({
            id,
            score: cosineSimilarity(vector, record.values),
            metadata: includeMetadata ? record.metadata : undefined,
          }));
          scored.sort((a, b) => b.score - a.score);
          return { matches: scored.slice(0, topK) };
        },
        async deleteMany(ids) {
          for (const id of ids) ns.delete(id);
        },
      };
    },
    async describeIndexStats() {
      const [firstNamespace] = namespaces.values();
      const [firstRecord] = firstNamespace?.values() ?? [];
      return { dimension: firstRecord?.values.length };
    },
  };
}

defineVectorStoreContractTests("Pinecone adapter", () =>
  createPineconeVectorStore({ client: makeFakePineconeIndexClient() }),
);

describe("createPineconeVectorStore", () => {
  it("skips the upsert call entirely for an empty record list", async () => {
    const namespaceFn = vi.fn();
    const client: PineconeIndexClient = { namespace: namespaceFn, describeIndexStats: vi.fn() };
    const store = createPineconeVectorStore({ client });

    await store.upsert("ns", []);

    expect(namespaceFn).not.toHaveBeenCalled();
  });

  it("skips the delete call entirely for an empty id list", async () => {
    const namespaceFn = vi.fn();
    const client: PineconeIndexClient = { namespace: namespaceFn, describeIndexStats: vi.fn() };
    const store = createPineconeVectorStore({ client });

    await store.delete("ns", []);

    expect(namespaceFn).not.toHaveBeenCalled();
  });

  it("defaults a missing score to 0 rather than undefined", async () => {
    const client: PineconeIndexClient = {
      namespace: () => ({
        upsert: vi.fn(),
        query: vi.fn(async () => ({ matches: [{ id: "a", metadata: { title: "doc" } }] })),
        deleteMany: vi.fn(),
      }),
      describeIndexStats: vi.fn(),
    };
    const store = createPineconeVectorStore({ client });

    const results = await store.query("ns", [1, 0, 0], 1);

    expect(results).toEqual([{ id: "a", score: 0, metadata: { title: "doc" } }]);
  });

  it("passes namespace, vector, and topK through to the query call", async () => {
    const queryFn = vi.fn(async () => ({ matches: [] }));
    const client: PineconeIndexClient = {
      namespace: vi.fn(() => ({
        upsert: vi.fn(),
        query: queryFn,
        deleteMany: vi.fn(),
      })),
      describeIndexStats: vi.fn(),
    };
    const store = createPineconeVectorStore({ client });

    await store.query("acct_123", [0.1, 0.2, 0.3], 5);

    expect(client.namespace).toHaveBeenCalledWith("acct_123");
    expect(queryFn).toHaveBeenCalledWith({ vector: [0.1, 0.2, 0.3], topK: 5, includeMetadata: true });
  });

  it("returns undefined dimension when the index reports none", async () => {
    const client: PineconeIndexClient = {
      namespace: vi.fn(),
      describeIndexStats: vi.fn(async () => ({})),
    };
    const store = createPineconeVectorStore({ client });

    expect(await store.getDimension()).toBeUndefined();
  });

  it("returns the index's reported dimension", async () => {
    const client: PineconeIndexClient = {
      namespace: vi.fn(),
      describeIndexStats: vi.fn(async () => ({ dimension: 1536 })),
    };
    const store = createPineconeVectorStore({ client });

    expect(await store.getDimension()).toBe(1536);
  });
});
