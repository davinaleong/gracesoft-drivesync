import { describe, expect, it } from "vitest";
import type { DriveClient, FolderAccessResult } from "../drive/driveClient.js";
import { createFolderService } from "./folderService.js";
import type { FolderRecord, FolderRepository } from "./folderRepository.js";

function makeInMemoryRepository(): FolderRepository {
  const rows = new Map<string, FolderRecord>();
  let counter = 0;

  return {
    async upsertConnected(accountId, folderId) {
      const existing = [...rows.values()].find((r) => r.accountId === accountId && r.folderId === folderId);
      const now = new Date();
      if (existing) {
        const updated = { ...existing, status: "CONNECTED" as const, lastVerifiedAt: now };
        rows.set(updated.id, updated);
        return updated;
      }
      const record: FolderRecord = {
        id: `folder_${++counter}`,
        accountId,
        folderId,
        status: "CONNECTED",
        connectedAt: now,
        lastVerifiedAt: now,
      };
      rows.set(record.id, record);
      return record;
    },
    async markVerified(id, status) {
      const existing = rows.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, status, lastVerifiedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async findByIdForAccount(accountId, id) {
      const record = rows.get(id);
      return record && record.accountId === accountId ? record : null;
    },
    async listForAccount(accountId) {
      return [...rows.values()].filter((r) => r.accountId === accountId);
    },
  };
}

function makeDriveClient(result: FolderAccessResult): DriveClient {
  return { verifyFolderAccess: async () => result, listFiles: async () => [] };
}

describe("folderService.connectFolder", () => {
  it("persists a DriveFolder record when the folder is accessible", async () => {
    const repository = makeInMemoryRepository();
    const service = createFolderService({ driveClient: makeDriveClient({ accessible: true }), repository });

    const result = await service.connectFolder("acct_1", "folder-abc");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.folder.status).toBe("CONNECTED");
      expect(result.folder.folderId).toBe("folder-abc");
    }
    expect(await repository.listForAccount("acct_1")).toHaveLength(1);
  });

  it("fails with a specific reason (not a generic error) when the folder isn't shared yet", async () => {
    const repository = makeInMemoryRepository();
    const service = createFolderService({
      driveClient: makeDriveClient({ accessible: false, reason: "not-found-or-not-shared" }),
      repository,
    });

    const result = await service.connectFolder("acct_1", "folder-abc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found-or-not-shared");
    expect(await repository.listForAccount("acct_1")).toHaveLength(0);
  });

  it("fails with a specific reason when the ID points to a file, not a folder", async () => {
    const repository = makeInMemoryRepository();
    const service = createFolderService({
      driveClient: makeDriveClient({ accessible: false, reason: "not-a-folder" }),
      repository,
    });

    const result = await service.connectFolder("acct_1", "file-abc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-a-folder");
  });
});

describe("folderService.verifyFolder", () => {
  it("surfaces NOT_ACCESSIBLE when a previously-connected folder's access was revoked", async () => {
    const repository = makeInMemoryRepository();
    let accessible = true;
    const driveClient: DriveClient = {
      verifyFolderAccess: async () =>
        accessible ? { accessible: true } : { accessible: false, reason: "not-found-or-not-shared" },
      listFiles: async () => [],
    };
    const service = createFolderService({ driveClient, repository });

    const connected = await service.connectFolder("acct_1", "folder-abc");
    if (!connected.ok) throw new Error("expected connect to succeed");

    accessible = false;
    const result = await service.verifyFolder("acct_1", connected.folder.id);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason !== "not-found") {
      expect(result.folder.status).toBe("NOT_ACCESSIBLE");
    }
  });

  it("returns not-found for a folder id that doesn't belong to the account", async () => {
    const repository = makeInMemoryRepository();
    const service = createFolderService({ driveClient: makeDriveClient({ accessible: true }), repository });

    const result = await service.verifyFolder("acct_1", "does-not-exist");

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
