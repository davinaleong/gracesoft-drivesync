import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { FolderRepository } from "../folders/folderRepository.js";
import { logger } from "../lib/logger.js";
import type { ConcurrencyLimiter } from "../scheduling/concurrencyLimiter.js";
import { assertEmbeddingDimensionMatchesVectorStore } from "../vectorstore/assertProviderCompatibility.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";
import type { FolderSyncer, FolderSyncSummary } from "./syncFolder.js";

// A folder failing occasionally is expected (a transient Drive hiccup); a
// folder failing this many *consecutive* times is a signal worth an
// operator's attention. No alerting integration exists yet — this is the
// log signal such a system would subscribe to (see M15's testing checklist
// wording: "the log signal it would consume exists").
const REPEATED_FAILURE_THRESHOLD = 3;

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
            const outcome = await (async (): Promise<FolderSyncOutcome> => {
              try {
                const summary = await deps.folderSyncer.syncFolder(folder.accountId, folder);
                logger.info(
                  {
                    accountId: folder.accountId,
                    driveFolderId: folder.id,
                    added: summary.added,
                    updated: summary.updated,
                    deleted: summary.deleted,
                    skippedUnchanged: summary.skippedUnchanged,
                    failedFileCount: summary.failedFiles.length,
                  },
                  "folder sync completed",
                );
                return { driveFolderId: folder.id, accountId: folder.accountId, ok: true, summary };
              } catch (err) {
                return {
                  driveFolderId: folder.id,
                  accountId: folder.accountId,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            })();

            const updated = await deps.folderRepository.recordSyncResult(
              folder.id,
              outcome.ok ? { ok: true } : { ok: false, error: outcome.error },
            );

            if (!outcome.ok && updated.consecutiveFailures >= REPEATED_FAILURE_THRESHOLD) {
              logger.error(
                {
                  accountId: folder.accountId,
                  driveFolderId: folder.id,
                  consecutiveFailures: updated.consecutiveFailures,
                  lastError: updated.lastSyncError,
                },
                "repeated sync failures for this folder",
              );
            }

            return outcome;
          }),
        ),
      );

      return { folders: outcomes };
    },
  };
}
