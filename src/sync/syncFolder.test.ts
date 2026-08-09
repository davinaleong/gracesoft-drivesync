import { beforeEach, describe, expect, it } from "vitest";
import type { Tokenizer } from "../chunking/chunkText.js";
import { computeContentHash } from "../dedup/contentHash.js";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { ExtractionResult, TextExtractor } from "../extraction/textExtractor.js";
import type { VectorRecord, VectorStore } from "../vectorstore/vectorStore.js";
import type { FileRecord, FileRepository } from "./fileRepository.js";
import { createFolderSyncer } from "./syncFolder.js";

const ACCOUNT_ID = "acct_1";
const DRIVE_FOLDER = { id: "folder_row_1", folderId: "drive-folder-abc" };

function file(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file-1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "row_1",
    accountId: ACCOUNT_ID,
    driveFolderId: DRIVE_FOLDER.id,
    fileId: "file-1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    contentHash: null,
    chunkCount: 0,
    lastSyncedAt: new Date(),
    ...overrides,
  };
}

// Word-level fake tokenizer — deterministic and easy to reason about chunk
// counts with, same approach as chunkText.test.ts.
function makeWordTokenizer(): Tokenizer {
  const vocab: string[] = [];
  const lookup = new Map<string, number>();
  return {
    encode: (text) =>
      text
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
        }),
    decode: (tokens) => tokens.map((id) => vocab[id]).join(" "),
  };
}

function makeFakeFileRepository(seed: FileRecord[] = []): FileRepository {
  const rows = new Map(seed.map((r) => [`${r.driveFolderId}:${r.fileId}`, r]));
  return {
    async listForFolder(driveFolderId) {
      return [...rows.values()].filter((r) => r.driveFolderId === driveFolderId);
    },
    async upsertSynced(params) {
      const key = `${params.driveFolderId}:${params.fileId}`;
      const record: FileRecord = { ...fileRecord(), ...params, id: rows.get(key)?.id ?? `row_${rows.size + 1}`, lastSyncedAt: new Date() };
      rows.set(key, record);
      return record;
    },
    async deleteByFileIds(driveFolderId, fileIds) {
      for (const fileId of fileIds) rows.delete(`${driveFolderId}:${fileId}`);
    },
    async findByFileId(accountId, fileId) {
      return [...rows.values()].find((r) => r.accountId === accountId && r.fileId === fileId) ?? null;
    },
    async listForAccount(accountId) {
      return [...rows.values()].filter((r) => r.accountId === accountId);
    },
  };
}

function makeFakeVectorStore(): VectorStore & { upserted: Array<{ namespace: string; records: VectorRecord[] }>; deleted: Array<{ namespace: string; ids: string[] }> } {
  const upserted: Array<{ namespace: string; records: VectorRecord[] }> = [];
  const deleted: Array<{ namespace: string; ids: string[] }> = [];
  return {
    upserted,
    deleted,
    async upsert(namespace, records) {
      upserted.push({ namespace, records });
    },
    async query() {
      return [];
    },
    async delete(namespace, ids) {
      deleted.push({ namespace, ids });
    },
    async fetch() {
      return [];
    },
    async getDimension() {
      return undefined;
    },
  };
}

function makeFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    dimensions: 3,
    embed: async (texts) => texts.map(() => [1, 0, 0]),
  };
}

function makeFakeDriveClient(files: DriveFileMeta[]): DriveClient {
  return {
    verifyFolderAccess: async () => ({ accessible: true }),
    listFiles: async () => files,
    exportAsText: async () => "",
    downloadFile: async () => Buffer.from(""),
  };
}

function makeFakeTextExtractor(resultsByFileId: Record<string, ExtractionResult>): TextExtractor {
  return {
    extractText: async (file) => resultsByFileId[file.id] ?? { ok: false, reason: "unsupported-mime-type" },
  };
}

describe("createFolderSyncer", () => {
  const chunkOptions = { maxTokens: 3, overlapTokens: 1 };
  let tokenizer: Tokenizer;

  beforeEach(() => {
    tokenizer = makeWordTokenizer();
  });

  it("embeds and upserts a brand-new file, recording it as added", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two three four five six" } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 1, updated: 0, deleted: 0, skippedUnchanged: 0, failedFiles: [] });
    expect(vectorStore.upserted).toHaveLength(1);
    expect(vectorStore.upserted[0]?.namespace).toBe(ACCOUNT_ID);
    expect(vectorStore.upserted[0]?.records.map((r) => r.id)).toEqual(
      vectorStore.upserted[0]?.records.map((_, i) => `file-1-${i}`),
    );

    const stored = await fileRepository.listForFolder(DRIVE_FOLDER.id);
    expect(stored[0]?.chunkCount).toBe(vectorStore.upserted[0]?.records.length);
  });

  it("skips re-embedding when the content hash is unchanged, but still updates modifiedTime", async () => {
    const unchangedText = "same content every time";
    const contentHash = computeContentHash(unchangedText);

    const driveClient = makeFakeDriveClient([file({ id: "file-1", modifiedTime: "2026-02-01T00:00:00.000Z" })]);
    const fileRepository = makeFakeFileRepository([
      fileRecord({ fileId: "file-1", modifiedTime: "2026-01-01T00:00:00.000Z", contentHash, chunkCount: 1 }),
    ]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: unchangedText } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 0, updated: 0, deleted: 0, skippedUnchanged: 1, failedFiles: [] });
    expect(vectorStore.upserted).toEqual([]);

    const stored = await fileRepository.listForFolder(DRIVE_FOLDER.id);
    expect(stored[0]?.modifiedTime).toBe("2026-02-01T00:00:00.000Z");
  });

  it("re-embeds when content actually changed, records it as updated, and cleans up shrunk chunk counts", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1", modifiedTime: "2026-02-01T00:00:00.000Z" })]);
    const fileRepository = makeFakeFileRepository([
      fileRecord({ fileId: "file-1", modifiedTime: "2026-01-01T00:00:00.000Z", contentHash: "old-hash", chunkCount: 5 }),
    ]);
    const vectorStore = makeFakeVectorStore();
    // 4 words / maxTokens=3, overlap=1 -> chunks at [0-3) and [2-4): 2 chunks, fewer than the previous 5.
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two three four" } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(0);
    const newChunkCount = vectorStore.upserted[0]?.records.length ?? 0;
    expect(newChunkCount).toBeLessThan(5);

    expect(vectorStore.deleted).toHaveLength(1);
    expect(vectorStore.deleted[0]?.namespace).toBe(ACCOUNT_ID);
    expect(vectorStore.deleted[0]?.ids).toEqual(
      Array.from({ length: 5 - newChunkCount }, (_, i) => `file-1-${newChunkCount + i}`),
    );
  });

  it("deletes vectors and the file record for a file removed from Drive", async () => {
    const driveClient = makeFakeDriveClient([]); // file-1 no longer present
    const fileRepository = makeFakeFileRepository([fileRecord({ fileId: "file-1", chunkCount: 3 })]);
    const vectorStore = makeFakeVectorStore();

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor: makeFakeTextExtractor({}),
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 0, updated: 0, deleted: 1, skippedUnchanged: 0, failedFiles: [] });
    expect(vectorStore.deleted).toEqual([{ namespace: ACCOUNT_ID, ids: ["file-1-0", "file-1-1", "file-1-2"] }]);
    expect(await fileRepository.listForFolder(DRIVE_FOLDER.id)).toEqual([]);
  });

  it("records an extraction failure without throwing, and continues syncing other files", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" }), file({ id: "file-2", name: "other" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({
      "file-1": { ok: false, reason: "scanned-pdf-ocr-not-implemented" },
      "file-2": { ok: true, text: "one two three" },
    });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.added).toBe(1);
    expect(summary.failedFiles).toEqual([{ fileId: "file-1", reason: "scanned-pdf-ocr-not-implemented" }]);
  });

  it("records an unexpected error without throwing, and continues syncing other files", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" }), file({ id: "file-2", name: "other" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore: VectorStore = {
      upsert: async () => {
        throw new Error("vector store is down");
      },
      query: async () => [],
      delete: async () => {},
      fetch: async () => [],
      getDimension: async () => undefined,
    };
    const textExtractor = makeFakeTextExtractor({
      "file-1": { ok: true, text: "one two three" },
      "file-2": { ok: true, text: "four five six" },
    });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.added).toBe(0);
    expect(summary.failedFiles).toHaveLength(2);
    expect(summary.failedFiles.every((f) => f.reason === "vector store is down")).toBe(true);
  });
});
