import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { FolderRepository } from "../folders/folderRepository.js";
import type { ConcurrencyLimiter } from "../scheduling/concurrencyLimiter.js";
import { assertEmbeddingDimensionMatchesVectorStore } from "../vectorstore/assertProviderCompatibility.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";
import type { FolderSyncer, FolderSyncSummary } from "./syncFolder.js";

export type FolderSyncOutcome =
  | { driveFolderId: string; accountId: string; ok: true; summary: FolderSyncSummary }
  | { driveFolderId: string; accountId: string; ok: false; error: string };

export interface SyncRunSummary {
  folders: FolderSyncOutcome[];
}

export interface SyncRunnerDeps {
  folderRepository: FolderRepository;
  folderSyncer: FolderSyncer;
  concurrencyLimiter: ConcurrencyLimiter;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
}

export interface SyncRunner {
  /**
   * Iterates every CONNECTED folder across every account. Per-folder failure
   * isolation: one folder throwing never stops the others — it's caught and
   * recorded in the outcome list instead. Per-account rate limiting: folders
   * are keyed through `concurrencyLimiter` by `accountId`, so one account
   * with many folders can't monopolize the shared service account's Drive
   * quota, while different accounts' folders sync fully in parallel.
   *
   * Before touching any folder, confirms the configured `EmbeddingProvider`'s
   * dimension still matches the vector store's existing index (M9) — a
   * provider/model swap on a deployment with existing data throws here,
   * failing the whole run clearly instead of writing wrong-dimension vectors
   * partway through.
   */
  runSync(): Promise<SyncRunSummary>;
}

export function createSyncRunner(deps: SyncRunnerDeps): SyncRunner {
  return {
    async runSync() {
      await assertEmbeddingDimensionMatchesVectorStore(deps.embeddingProvider, deps.vectorStore);

      const folders = await deps.folderRepository.listAllConnected();

      const outcomes = await Promise.all(
        folders.map((folder): Promise<FolderSyncOutcome> =>
          deps.concurrencyLimiter.run(folder.accountId, async () => {
            try {
              const summary = await deps.folderSyncer.syncFolder(folder.accountId, folder);
              return { driveFolderId: folder.id, accountId: folder.accountId, ok: true, summary };
            } catch (err) {
              return {
                driveFolderId: folder.id,
                accountId: folder.accountId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        ),
      );

      return { folders: outcomes };
    },
  };
}
