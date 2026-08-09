import { describe, expect, it, vi } from "vitest";
import type { FileRecord, FileRepository } from "../sync/fileRepository.js";
import type { VectorRecord, VectorStore } from "../vectorstore/vectorStore.js";
import { createDocumentService } from "./documentService.js";

function fileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "row_1",
    accountId: "acct_1",
    driveFolderId: "folder_1",
    fileId: "file-1",
    name: "doc.txt",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    contentHash: "hash",
    chunkCount: 3,
    lastSyncedAt: new Date(),
    ...overrides,
  };
}

function makeFileRepository(file: FileRecord | null): FileRepository {
  return {
    listForFolder: vi.fn(),
    upsertSynced: vi.fn(),
    deleteByFileIds: vi.fn(),
    findByFileId: vi.fn(async () => file),
  };
}

function makeVectorStore(records: VectorRecord[]): VectorStore {
  return {
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
    getDimension: vi.fn(),
    fetch: vi.fn(async () => records),
  };
}

describe("createDocumentService", () => {
  it("stitches chunks back together in index order", async () => {
    const fileRepository = makeFileRepository(fileRecord({ chunkCount: 3 }));
    const vectorStore = makeVectorStore([
      { id: "file-1-1", values: [], metadata: { text: "second" } },
      { id: "file-1-0", values: [], metadata: { text: "first" } },
      { id: "file-1-2", values: [], metadata: { text: "third" } },
    ]);
    const service = createDocumentService({ fileRepository, vectorStore });

    const result = await service.fetchDocument("acct_1", "file-1");

    expect(result).toEqual({ fileId: "file-1", fileName: "doc.txt", text: "first\n\nsecond\n\nthird" });
    expect(vectorStore.fetch).toHaveBeenCalledWith("acct_1", ["file-1-0", "file-1-1", "file-1-2"]);
  });

  it("returns null for a file that doesn't exist for this account", async () => {
    const service = createDocumentService({ fileRepository: makeFileRepository(null), vectorStore: makeVectorStore([]) });

    expect(await service.fetchDocument("acct_1", "does-not-exist")).toBeNull();
  });

  it("returns null for a file with zero chunks rather than an empty-text document", async () => {
    const fileRepository = makeFileRepository(fileRecord({ chunkCount: 0 }));
    const service = createDocumentService({ fileRepository, vectorStore: makeVectorStore([]) });

    expect(await service.fetchDocument("acct_1", "file-1")).toBeNull();
  });

  it("fills in an empty string for a chunk that's missing from the vector store", async () => {
    const fileRepository = makeFileRepository(fileRecord({ chunkCount: 2 }));
    const vectorStore = makeVectorStore([{ id: "file-1-0", values: [], metadata: { text: "only chunk" } }]);
    const service = createDocumentService({ fileRepository, vectorStore });

    const result = await service.fetchDocument("acct_1", "file-1");

    expect(result?.text).toBe("only chunk\n\n");
  });
});
