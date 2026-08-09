import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "../scheduling/concurrencyLimiter.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { FolderRecord, FolderRepository } from "../folders/folderRepository.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";
import type { FolderSyncer, FolderSyncSummary } from "./syncFolder.js";
import { createSyncRunner } from "./syncAllFolders.js";

function folderRecord(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    id: "row_1",
    accountId: "acct_1",
    folderId: "drive-folder-1",
    status: "CONNECTED",
    connectedAt: new Date(),
    lastVerifiedAt: new Date(),
    ...overrides,
  };
}

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

function makeFolderRepository(folders: FolderRecord[]): FolderRepository {
  return {
    upsertConnected: async () => {
      throw new Error("not used");
    },
    markVerified: async () => {
      throw new Error("not used");
    },
    findByIdForAccount: async () => null,
    listForAccount: async (accountId) => folders.filter((f) => f.accountId === accountId),
    listAllConnected: async () => folders,
  };
}

const emptySummary: FolderSyncSummary = { added: 0, updated: 0, deleted: 0, skippedUnchanged: 0, failedFiles: [] };

describe("createSyncRunner", () => {
  it("syncs every connected folder and reports a summary per folder", async () => {
    const folders = [
      folderRecord({ id: "row_1", accountId: "acct_1" }),
      folderRecord({ id: "row_2", accountId: "acct_2" }),
    ];
    const folderSyncer: FolderSyncer = { syncFolder: async () => emptySummary };

    const runner = createSyncRunner({
      folderRepository: makeFolderRepository(folders),
      folderSyncer,
      concurrencyLimiter: createConcurrencyLimiter(5),
      embeddingProvider: makeEmbeddingProvider(1536),
      vectorStore: makeVectorStore(1536),
    });

    const result = await runner.runSync();

    expect(result.folders).toHaveLength(2);
    expect(result.folders.every((f) => f.ok)).toBe(true);
  });

  it("isolates one folder's failure: other folders still sync successfully", async () => {
    const folders = [
      folderRecord({ id: "row_1", accountId: "acct_1", folderId: "broken" }),
      folderRecord({ id: "row_2", accountId: "acct_1", folderId: "fine" }),
    ];
    const folderSyncer: FolderSyncer = {
      syncFolder: async (_accountId, folder) => {
        if (folder.folderId === "broken") throw new Error("drive api exploded");
        return emptySummary;
      },
    };

    const runner = createSyncRunner({
      folderRepository: makeFolderRepository(folders),
      folderSyncer,
      concurrencyLimiter: createConcurrencyLimiter(5),
      embeddingProvider: makeEmbeddingProvider(1536),
      vectorStore: makeVectorStore(1536),
    });

    const result = await runner.runSync();

    const broken = result.folders.find((f) => f.driveFolderId === "row_1");
    const fine = result.folders.find((f) => f.driveFolderId === "row_2");

    expect(broken).toMatchObject({ ok: false, error: "drive api exploded" });
    expect(fine).toMatchObject({ ok: true });
  });

  it("caps concurrent syncs per account without limiting a different account", async () => {
    const folders = [
      folderRecord({ id: "a1", accountId: "acct_heavy" }),
      folderRecord({ id: "a2", accountId: "acct_heavy" }),
      folderRecord({ id: "a3", accountId: "acct_heavy" }),
      folderRecord({ id: "b1", accountId: "acct_light" }),
    ];

    let activeForHeavy = 0;
    let maxActiveForHeavy = 0;
    let heavyStartedCount = 0;
    let lightStarted = false;

    const folderSyncer: FolderSyncer = {
      syncFolder: async (accountId) => {
        if (accountId === "acct_heavy") {
          activeForHeavy++;
          heavyStartedCount++;
          maxActiveForHeavy = Math.max(maxActiveForHeavy, activeForHeavy);
          await new Promise((r) => setTimeout(r, 20));
          activeForHeavy--;
        } else {
          lightStarted = true;
        }
        return emptySummary;
      },
    };

    const runner = createSyncRunner({
      folderRepository: makeFolderRepository(folders),
      folderSyncer,
      concurrencyLimiter: createConcurrencyLimiter(1),
      embeddingProvider: makeEmbeddingProvider(1536),
      vectorStore: makeVectorStore(1536),
    });

    await runner.runSync();

    expect(maxActiveForHeavy).toBe(1);
    expect(heavyStartedCount).toBe(3);
    expect(lightStarted).toBe(true);
  });

  it("fails the whole run before touching any folder when the embedding dimension doesn't match the vector store", async () => {
    const folders = [folderRecord({ id: "row_1", accountId: "acct_1" })];
    let syncFolderCalled = false;
    const folderSyncer: FolderSyncer = {
      syncFolder: async () => {
        syncFolderCalled = true;
        return emptySummary;
      },
    };

    const runner = createSyncRunner({
      folderRepository: makeFolderRepository(folders),
      folderSyncer,
      concurrencyLimiter: createConcurrencyLimiter(5),
      embeddingProvider: makeEmbeddingProvider(3072),
      vectorStore: makeVectorStore(1536),
    });

    await expect(runner.runSync()).rejects.toThrow(/full resync/);
    expect(syncFolderCalled).toBe(false);
  });
});
