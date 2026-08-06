import { loadEnv } from "../config/env.js";
import { createPineconeIndexClient, createPineconeVectorStore } from "./pineconeVectorStore.js";
import type { VectorStore } from "./vectorStore.js";

export type { VectorStore, VectorRecord, ScoredVectorRecord } from "./vectorStore.js";

/**
 * Config-driven selection, not code branching elsewhere in the pipeline: a
 * contributor adding a new provider implements `VectorStore` and adds one
 * case here — no dynamic plugin loading.
 */
export function createVectorStore(): VectorStore {
  const env = loadEnv();

  switch (env.VECTOR_STORE) {
    case "pinecone":
      return createPineconeVectorStore({
        client: createPineconeIndexClient(env.PINECONE_API_KEY, env.PINECONE_INDEX_NAME),
      });
    default:
      throw new Error(`Unknown VECTOR_STORE "${env.VECTOR_STORE}". Supported: pinecone.`);
  }
}
