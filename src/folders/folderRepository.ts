import type { FolderStatus, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface FolderRecord {
  id: string;
  accountId: string;
  folderId: string;
  status: FolderStatus;
  connectedAt: Date;
  lastVerifiedAt: Date;
}

export interface FolderRepository {
  upsertConnected(accountId: string, folderId: string): Promise<FolderRecord>;
  markVerified(id: string, status: FolderStatus): Promise<FolderRecord>;
  findByIdForAccount(accountId: string, id: string): Promise<FolderRecord | null>;
  listForAccount(accountId: string): Promise<FolderRecord[]>;
}

export function createPrismaFolderRepository(client: PrismaClient = prisma): FolderRepository {
  return {
    async upsertConnected(accountId, folderId) {
      const now = new Date();
      return client.driveFolder.upsert({
        where: { accountId_folderId: { accountId, folderId } },
        create: { accountId, folderId, status: "CONNECTED", connectedAt: now, lastVerifiedAt: now },
        update: { status: "CONNECTED", lastVerifiedAt: now },
      });
    },

    async markVerified(id, status) {
      return client.driveFolder.update({
        where: { id },
        data: { status, lastVerifiedAt: new Date() },
      });
    },

    async findByIdForAccount(accountId, id) {
      return client.driveFolder.findFirst({ where: { id, accountId } });
    },

    async listForAccount(accountId) {
      return client.driveFolder.findMany({ where: { accountId }, orderBy: { connectedAt: "asc" } });
    },
  };
}
