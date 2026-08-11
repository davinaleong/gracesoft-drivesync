import { chunkText } from "../chunking/chunkText.js";
import type { ChunkOptions, Tokenizer } from "../chunking/chunkText.js";
import { computeContentHash, hasContentChanged } from "../dedup/contentHash.js";
import { buildVectorId, computeStaleVectorIds } from "../dedup/vectorIds.js";
import type { DriveClient } from "../drive/driveClient.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import { logger } from "../lib/logger.js";
import type { TextExtractor } from "../extraction/textExtractor.js";
import { detectChanges } from "./changeDetection.js";
import type { FileRepository } from "./fileRepository.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";

export interface FolderSyncSummary {
  added: number;
  updated: number;
  deleted: number;
  skippedUnchanged: number;
  failedFiles: Array<{ fileId: string; reason: string }>;
}

export interface FolderSyncDeps {
  driveClient: DriveClient;
  fileRepository: FileRepository;
  textExtractor: TextExtractor;
  tokenizer: Tokenizer;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  chunkOptions: ChunkOptions;
}

export interface FolderSyncer {
  /**
   * Syncs one connected folder: lists its current Drive contents, diffs
   * against what was previously synced (M4), extracts/chunks/embeds/upserts
   * anything new or changed (M5-M8), skips re-embedding unchanged content
   * (M10), cleans up vectors for deleted files and files that now chunk
   * into fewer pieces (M10), and records the new state (M11).
   *
   * The vector store namespace is the account ID — per-account isolation
   * (M8's whole reason for namespace-scoping every operation).
   */
  syncFolder(accountId: string, driveFolder: { id: string; folderId: string }): Promise<FolderSyncSummary>;
}

export function createFolderSyncer(deps: FolderSyncDeps): FolderSyncer {
  return {
    async syncFolder(accountId, driveFolder) {
      const [currentFiles, previousFiles] = await Promise.all([
        deps.driveClient.listFiles(driveFolder.folderId),
        deps.fileRepository.listForFolder(driveFolder.id),
      ]);

      const previousByFileId = new Map(previousFiles.map((f) => [f.fileId, f]));
      const changes = detectChanges(
        previousFiles.map((f) => ({ id: f.fileId, modifiedTime: f.modifiedTime })),
        currentFiles,
      );

      const summary: FolderSyncSummary = { added: 0, updated: 0, deleted: 0, skippedUnchanged: 0, failedFiles: [] };

      for (const file of [...changes.added, ...changes.updated]) {
        const previous = previousByFileId.get(file.id);
        try {
          const extraction = await deps.textExtractor.extractText(file);
          if (!extraction.ok) {
            summary.failedFiles.push({ fileId: file.id, reason: extraction.reason });
            logger.warn(
              { accountId, driveFolderId: driveFolder.id, fileId: file.id, fileName: file.name, reason: extraction.reason },
              "file sync failed",
            );
            continue;
          }

          const contentHash = computeContentHash(extraction.text);

          if (previous && !hasContentChanged(previous.contentHash ?? undefined, contentHash)) {
            summary.skippedUnchanged++;
            await deps.fileRepository.upsertSynced({
              accountId,
              driveFolderId: driveFolder.id,
              fileId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime,
              contentHash,
              chunkCount: previous.chunkCount,
            });
            logger.debug(
              { accountId, driveFolderId: driveFolder.id, fileId: file.id, fileName: file.name },
              "file unchanged, skipped",
            );
            continue;
          }

          const chunks = chunkText(extraction.text, deps.tokenizer, deps.chunkOptions);
          const vectors = chunks.length > 0 ? await deps.embeddingProvider.embed(chunks.map((c) => c.text)) : [];

          if (chunks.length > 0) {
            await deps.vectorStore.upsert(
              accountId,
              chunks.map((chunk, i) => ({
                id: buildVectorId(file.id, chunk.index),
                values: vectors[i]!,
                metadata: {
                  fileId: file.id,
                  name: file.name,
                  text: chunk.text,
                  ...(chunk.section !== undefined ? { section: chunk.section } : {}),
                },
              })),
            );
          }

          if (previous) {
            const staleIds = computeStaleVectorIds(file.id, previous.chunkCount, chunks.length);
            if (staleIds.length > 0) await deps.vectorStore.delete(accountId, staleIds);
          }

          await deps.fileRepository.upsertSynced({
            accountId,
            driveFolderId: driveFolder.id,
            fileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            contentHash,
            chunkCount: chunks.length,
          });

          if (previous) summary.updated++;
          else summary.added++;
          logger.info(
            {
              accountId,
              driveFolderId: driveFolder.id,
              fileId: file.id,
              fileName: file.name,
              chunkCount: chunks.length,
            },
            previous ? "file updated" : "file added",
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          summary.failedFiles.push({ fileId: file.id, reason });
          logger.warn({ accountId, driveFolderId: driveFolder.id, fileId: file.id, fileName: file.name, reason }, "file sync failed");
        }
      }

      for (const deletedFileId of changes.deleted) {
        try {
          const previous = previousByFileId.get(deletedFileId);
          if (previous && previous.chunkCount > 0) {
            const staleIds = computeStaleVectorIds(deletedFileId, previous.chunkCount, 0);
            await deps.vectorStore.delete(accountId, staleIds);
          }
          await deps.fileRepository.deleteByFileIds(driveFolder.id, [deletedFileId]);
          summary.deleted++;
          logger.info({ accountId, driveFolderId: driveFolder.id, fileId: deletedFileId }, "file deleted");
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          summary.failedFiles.push({ fileId: deletedFileId, reason });
          logger.warn({ accountId, driveFolderId: driveFolder.id, fileId: deletedFileId, reason }, "file delete failed");
        }
      }

      return summary;
    },
  };
}
