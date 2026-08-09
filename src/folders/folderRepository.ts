import type { FolderStatus, PrismaClient, SyncStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface FolderRecord {
  id: string;
  accountId: string;
  folderId: string;
  status: FolderStatus;
  connectedAt: Date;
  lastVerifiedAt: Date;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncError: string | null;
  consecutiveFailures: number;
}

export type SyncResult = { ok: true } | { ok: false; error: string };

export interface FolderRepository {
  upsertConnected(accountId: string, folderId: string): Promise<FolderRecord>;
  markVerified(id: string, status: FolderStatus): Promise<FolderRecord>;
  findByIdForAccount(accountId: string, id: string): Promise<FolderRecord | null>;
  listForAccount(accountId: string): Promise<FolderRecord[]>;
  /** Every CONNECTED folder across every account — what M12's sync run iterates. */
  listAllConnected(): Promise<FolderRecord[]>;
  /** Records the outcome of one sync attempt — what M15's /status and repeated-failure log signal are derived from. */
  recordSyncResult(id: string, result: SyncResult): Promise<FolderRecord>;
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

    async listAllConnected() {
      return client.driveFolder.findMany({ where: { status: "CONNECTED" }, orderBy: { accountId: "asc" } });
    },

    async recordSyncResult(id, result) {
      const current = await client.driveFolder.findUniqueOrThrow({ where: { id } });
      return client.driveFolder.update({
        where: { id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: result.ok ? "SUCCESS" : "FAILED",
          lastSyncError: result.ok ? null : result.error,
          consecutiveFailures: result.ok ? 0 : current.consecutiveFailures + 1,
        },
      });
    },
  };
}
