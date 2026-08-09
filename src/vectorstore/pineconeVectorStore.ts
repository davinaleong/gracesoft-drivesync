import { Pinecone } from "@pinecone-database/pinecone";
import type { RecordMetadata } from "@pinecone-database/pinecone";
import type { ScoredVectorRecord, VectorRecord, VectorStore } from "./vectorStore.js";

export interface PineconeNamespaceClient {
  upsert(records: VectorRecord[]): Promise<void>;
  query(options: { vector: number[]; topK: number; includeMetadata?: boolean }): Promise<{
    matches: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }>;
  }>;
  deleteMany(ids: string[]): Promise<void>;
  fetch(ids: string[]): Promise<{ records: Record<string, { id: string; values?: number[]; metadata?: Record<string, unknown> }> }>;
}

export interface PineconeIndexClient {
  namespace(namespace: string): PineconeNamespaceClient;
  describeIndexStats(): Promise<{ dimension?: number }>;
}

export function createPineconeIndexClient(apiKey: string, indexName: string): PineconeIndexClient {
  const index = new Pinecone({ apiKey }).index(indexName);
  return {
    namespace(namespace: string): PineconeNamespaceClient {
      const scoped = index.namespace(namespace);
      return {
        // VectorRecord.metadata is intentionally provider-agnostic
        // (Record<string, unknown>) — narrower than Pinecone's own
        // RecordMetadataValue (string | boolean | number | string[]). This
        // is the one place that gap is bridged; a genuinely incompatible
        // value fails at the real Pinecone call, not silently here.
        upsert: (records) => scoped.upsert(records as Array<{ id: string; values: number[]; metadata?: RecordMetadata }>),
        query: (options) => scoped.query(options),
        deleteMany: (ids) => scoped.deleteMany(ids),
        fetch: (ids) => scoped.fetch(ids),
      };
    },
    describeIndexStats: () => index.describeIndexStats(),
  };
}

export function createPineconeVectorStore(deps: { client: PineconeIndexClient }): VectorStore {
  return {
    async upsert(namespace: string, records: VectorRecord[]): Promise<void> {
      if (records.length === 0) return;
      await deps.client.namespace(namespace).upsert(records);
    },

    async query(namespace: string, vector: number[], topK: number): Promise<ScoredVectorRecord[]> {
      const res = await deps.client.namespace(namespace).query({ vector, topK, includeMetadata: true });
      return res.matches.map((match) => ({
        id: match.id,
        score: match.score ?? 0,
        metadata: match.metadata,
      }));
    },

    async delete(namespace: string, ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await deps.client.namespace(namespace).deleteMany(ids);
    },

    async fetch(namespace: string, ids: string[]): Promise<VectorRecord[]> {
      if (ids.length === 0) return [];
      const res = await deps.client.namespace(namespace).fetch(ids);
      return Object.values(res.records).map((record) => ({
        id: record.id,
        values: record.values ?? [],
        metadata: record.metadata,
      }));
    },

    async getDimension(): Promise<number | undefined> {
      const stats = await deps.client.describeIndexStats();
      return stats.dimension;
    },
  };
}
