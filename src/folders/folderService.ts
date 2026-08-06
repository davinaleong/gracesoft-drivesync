import type { DriveClient } from "../drive/driveClient.js";
import type { FolderRecord, FolderRepository } from "./folderRepository.js";

export type ConnectFolderResult =
  | { ok: true; folder: FolderRecord }
  | { ok: false; reason: "not-found-or-not-shared" | "not-a-folder" };

export type VerifyFolderResult =
  | { ok: true; folder: FolderRecord }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "not-found-or-not-shared" | "not-a-folder"; folder: FolderRecord };

export interface FolderService {
  connectFolder(accountId: string, folderId: string): Promise<ConnectFolderResult>;
  verifyFolder(accountId: string, id: string): Promise<VerifyFolderResult>;
  listFolders(accountId: string): Promise<FolderRecord[]>;
}

export function createFolderService(deps: {
  driveClient: DriveClient;
  repository: FolderRepository;
}): FolderService {
  return {
    async connectFolder(accountId, folderId) {
      const access = await deps.driveClient.verifyFolderAccess(folderId);
      if (!access.accessible) {
        return { ok: false, reason: access.reason };
      }

      const folder = await deps.repository.upsertConnected(accountId, folderId);
      return { ok: true, folder };
    },

    async verifyFolder(accountId, id) {
      const existing = await deps.repository.findByIdForAccount(accountId, id);
      if (!existing) {
        return { ok: false, reason: "not-found" };
      }

      const access = await deps.driveClient.verifyFolderAccess(existing.folderId);
      const folder = await deps.repository.markVerified(existing.id, access.accessible ? "CONNECTED" : "NOT_ACCESSIBLE");

      if (!access.accessible) {
        return { ok: false, reason: access.reason, folder };
      }
      return { ok: true, folder };
    },

    async listFolders(accountId) {
      return deps.repository.listForAccount(accountId);
    },
  };
}
