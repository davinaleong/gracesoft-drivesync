import { buildVectorId } from "../dedup/vectorIds.js";
import type { FileRepository } from "../sync/fileRepository.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";

export interface DocumentResult {
  fileId: string;
  fileName: string;
  text: string;
}

export interface DocumentService {
  /**
   * Reconstructs a file's full text from its stored chunks, in chunk-index
   * order — there's no separate "full text" storage; M13's retrieval chunks
   * are the only copy of the extracted content, so document fetch is just
   * fetching all of them for one file and stitching them back together.
   * Scoped to `accountId`: a fileId that exists but belongs to a different
   * account resolves to `null`, identically to a fileId that doesn't exist
   * at all — no signal leak about whether the file exists elsewhere.
   */
  fetchDocument(accountId: string, fileId: string): Promise<DocumentResult | null>;
}

export function createDocumentService(deps: { fileRepository: FileRepository; vectorStore: VectorStore }): DocumentService {
  return {
    async fetchDocument(accountId, fileId) {
      const file = await deps.fileRepository.findByFileId(accountId, fileId);
      if (!file || file.chunkCount === 0) return null;

      const ids = Array.from({ length: file.chunkCount }, (_, i) => buildVectorId(fileId, i));
      const records = await deps.vectorStore.fetch(accountId, ids);
      const byId = new Map(records.map((r) => [r.id, r]));

      const text = ids
        .map((id) => {
          const value = byId.get(id)?.metadata?.text;
          return typeof value === "string" ? value : "";
        })
        .join("\n\n");

      return { fileId: file.fileId, fileName: file.name, text };
    },
  };
}
