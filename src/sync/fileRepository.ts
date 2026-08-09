import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface FileRecord {
  id: string;
  accountId: string;
  driveFolderId: string;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  contentHash: string | null;
  chunkCount: number;
  lastSyncedAt: Date;
}

export interface UpsertSyncedFileParams {
  accountId: string;
  driveFolderId: string;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  contentHash: string;
  chunkCount: number;
}

export interface FileRepository {
  /** Last-known state for every file previously synced under this folder — feeds M4's detectChanges. */
  listForFolder(driveFolderId: string): Promise<FileRecord[]>;
  upsertSynced(params: UpsertSyncedFileParams): Promise<FileRecord>;
  /** Removes tracking rows for files no longer present (M4's `deleted` list). */
  deleteByFileIds(driveFolderId: string, fileIds: string[]): Promise<void>;
  /** Scoped to the account, regardless of which of its folders the file lives in — what M14's document fetch looks up chunkCount by. */
  findByFileId(accountId: string, fileId: string): Promise<FileRecord | null>;
  /** Every synced file across every one of the account's folders — what M15's /audit aggregates over. */
  listForAccount(accountId: string): Promise<FileRecord[]>;
}

export function createPrismaFileRepository(client: PrismaClient = prisma): FileRepository {
  return {
    async listForFolder(driveFolderId) {
      return client.driveFile.findMany({ where: { driveFolderId } });
    },

    async upsertSynced(params) {
      return client.driveFile.upsert({
        where: { driveFolderId_fileId: { driveFolderId: params.driveFolderId, fileId: params.fileId } },
        create: {
          accountId: params.accountId,
          driveFolderId: params.driveFolderId,
          fileId: params.fileId,
          name: params.name,
          mimeType: params.mimeType,
          modifiedTime: params.modifiedTime,
          contentHash: params.contentHash,
          chunkCount: params.chunkCount,
          lastSyncedAt: new Date(),
        },
        update: {
          name: params.name,
          mimeType: params.mimeType,
          modifiedTime: params.modifiedTime,
          contentHash: params.contentHash,
          chunkCount: params.chunkCount,
          lastSyncedAt: new Date(),
        },
      });
    },

    async deleteByFileIds(driveFolderId, fileIds) {
      if (fileIds.length === 0) return;
      await client.driveFile.deleteMany({ where: { driveFolderId, fileId: { in: fileIds } } });
    },

    async findByFileId(accountId, fileId) {
      return client.driveFile.findFirst({ where: { accountId, fileId } });
    },

    async listForAccount(accountId) {
      return client.driveFile.findMany({ where: { accountId } });
    },
  };
}
