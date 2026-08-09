import type { FolderStatus, SyncStatus } from "@prisma/client";
import type { FolderRepository } from "../folders/folderRepository.js";
import type { FileRepository } from "../sync/fileRepository.js";

export interface FolderStatusEntry {
  driveFolderId: string;
  folderId: string;
  status: FolderStatus;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncError: string | null;
  consecutiveFailures: number;
  /** Files currently tracked in this folder — not "files touched in the last run" (that's ephemeral, only logged, not persisted; see M15 decisions). */
  fileCount: number;
}

export interface AuditFolderSummary {
  driveFolderId: string;
  folderId: string;
  fileCount: number;
  chunkCount: number;
}

export interface AuditSummary {
  totalFiles: number;
  totalChunks: number;
  folders: AuditFolderSummary[];
}

export interface ObservabilityService {
  /** Scoped strictly to the caller's own account — never another account's folders. */
  getStatus(accountId: string): Promise<FolderStatusEntry[]>;
  /** Full index state (total files/chunks), scoped strictly to the caller's own account. */
  getAudit(accountId: string): Promise<AuditSummary>;
}

export function createObservabilityService(deps: {
  folderRepository: FolderRepository;
  fileRepository: FileRepository;
}): ObservabilityService {
  return {
    async getStatus(accountId) {
      const [folders, files] = await Promise.all([
        deps.folderRepository.listForAccount(accountId),
        deps.fileRepository.listForAccount(accountId),
      ]);

      const fileCountByFolder = new Map<string, number>();
      for (const file of files) {
        fileCountByFolder.set(file.driveFolderId, (fileCountByFolder.get(file.driveFolderId) ?? 0) + 1);
      }

      return folders.map((folder) => ({
        driveFolderId: folder.id,
        folderId: folder.folderId,
        status: folder.status,
        lastSyncedAt: folder.lastSyncedAt,
        lastSyncStatus: folder.lastSyncStatus,
        lastSyncError: folder.lastSyncError,
        consecutiveFailures: folder.consecutiveFailures,
        fileCount: fileCountByFolder.get(folder.id) ?? 0,
      }));
    },

    async getAudit(accountId) {
      const [folders, files] = await Promise.all([
        deps.folderRepository.listForAccount(accountId),
        deps.fileRepository.listForAccount(accountId),
      ]);

      const byFolder = new Map<string, { fileCount: number; chunkCount: number }>();
      for (const file of files) {
        const entry = byFolder.get(file.driveFolderId) ?? { fileCount: 0, chunkCount: 0 };
        entry.fileCount += 1;
        entry.chunkCount += file.chunkCount;
        byFolder.set(file.driveFolderId, entry);
      }

      return {
        totalFiles: files.length,
        totalChunks: files.reduce((sum, file) => sum + file.chunkCount, 0),
        folders: folders.map((folder) => {
          const entry = byFolder.get(folder.id) ?? { fileCount: 0, chunkCount: 0 };
          return { driveFolderId: folder.id, folderId: folder.folderId, ...entry };
        }),
      };
    },
  };
}
