import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";

export interface RetrievedChunk {
  text: string;
  score: number;
  fileId: string;
  fileName: string;
  section?: string;
}

export interface RetrievalService {
  /**
   * Embeds `queryText` and searches the caller's own namespace only —
   * `accountId` is always the namespace, so this can never return another
   * account's chunks even under a shared index (see M8's namespace
   * isolation). Returns chunk text plus attribution (v2 change from v1's
   * metadata-only response), not just IDs/scores.
   */
  query(accountId: string, queryText: string, topK: number): Promise<RetrievedChunk[]>;
}

function stringField(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

export function createRetrievalService(deps: {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
}): RetrievalService {
  return {
    async query(accountId, queryText, topK) {
      const [queryVector] = await deps.embeddingProvider.embed([queryText]);
      if (!queryVector) return [];

      const matches = await deps.vectorStore.query(accountId, queryVector, topK);

      return matches.map((match) => ({
        text: stringField(match.metadata, "text") ?? "",
        score: match.score,
        fileId: stringField(match.metadata, "fileId") ?? "",
        fileName: stringField(match.metadata, "name") ?? "",
        section: stringField(match.metadata, "section"),
      }));
    },
  };
}
