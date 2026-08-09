import { describe, expect, it, vi } from "vitest";
import type { FolderRecord, FolderRepository } from "../folders/folderRepository.js";
import type { FileRecord, FileRepository } from "../sync/fileRepository.js";
import { createObservabilityService } from "./observabilityService.js";

function folderRecord(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    id: "folder_1",
    accountId: "acct_1",
    folderId: "drive-folder-1",
    status: "CONNECTED",
    connectedAt: new Date(),
    lastVerifiedAt: new Date(),
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function fileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "file_row_1",
    accountId: "acct_1",
    driveFolderId: "folder_1",
    fileId: "drive-file-1",
    name: "doc.txt",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    contentHash: "hash",
    chunkCount: 3,
    lastSyncedAt: new Date(),
    ...overrides,
  };
}

function makeRepos(folders: FolderRecord[], files: FileRecord[]) {
  const folderRepository: FolderRepository = {
    upsertConnected: vi.fn(),
    markVerified: vi.fn(),
    findByIdForAccount: vi.fn(),
    listAllConnected: vi.fn(),
    recordSyncResult: vi.fn(),
    listForAccount: vi.fn(async (accountId) => folders.filter((f) => f.accountId === accountId)),
  };
  const fileRepository: FileRepository = {
    listForFolder: vi.fn(),
    upsertSynced: vi.fn(),
    deleteByFileIds: vi.fn(),
    findByFileId: vi.fn(),
    listForAccount: vi.fn(async (accountId) => files.filter((f) => f.accountId === accountId)),
  };
  return { folderRepository, fileRepository };
}

describe("createObservabilityService.getStatus", () => {
  it("reports each of the account's folders with last-sync status and file count", async () => {
    const folders = [
      folderRecord({
        id: "folder_1",
        lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSyncStatus: "SUCCESS",
        consecutiveFailures: 0,
      }),
    ];
    const files = [fileRecord({ driveFolderId: "folder_1" }), fileRecord({ id: "file_row_2", driveFolderId: "folder_1" })];
    const service = createObservabilityService(makeRepos(folders, files));

    const status = await service.getStatus("acct_1");

    expect(status).toEqual([
      {
        driveFolderId: "folder_1",
        folderId: "drive-folder-1",
        status: "CONNECTED",
        lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSyncStatus: "SUCCESS",
        lastSyncError: null,
        consecutiveFailures: 0,
        fileCount: 2,
      },
    ]);
  });

  it("only ever reports folders/files belonging to the requested account", async () => {
    const folders = [folderRecord({ id: "folder_1", accountId: "acct_1" }), folderRecord({ id: "folder_2", accountId: "acct_2" })];
    const files = [fileRecord({ driveFolderId: "folder_1", accountId: "acct_1" })];
    const { folderRepository, fileRepository } = makeRepos(folders, files);
    const service = createObservabilityService({ folderRepository, fileRepository });

    await service.getStatus("acct_1");

    expect(folderRepository.listForAccount).toHaveBeenCalledWith("acct_1");
    expect(fileRepository.listForAccount).toHaveBeenCalledWith("acct_1");
  });

  it("reports zero fileCount for a folder with no synced files yet", async () => {
    const service = createObservabilityService(makeRepos([folderRecord()], []));

    const status = await service.getStatus("acct_1");

    expect(status[0]?.fileCount).toBe(0);
  });
});

describe("createObservabilityService.getAudit", () => {
  it("aggregates total files/chunks and a per-folder breakdown", async () => {
    const folders = [folderRecord({ id: "folder_1" }), folderRecord({ id: "folder_2", folderId: "drive-folder-2" })];
    const files = [
      fileRecord({ driveFolderId: "folder_1", chunkCount: 3 }),
      fileRecord({ id: "f2", driveFolderId: "folder_1", chunkCount: 2 }),
      fileRecord({ id: "f3", driveFolderId: "folder_2", chunkCount: 5 }),
    ];
    const service = createObservabilityService(makeRepos(folders, files));

    const audit = await service.getAudit("acct_1");

    expect(audit.totalFiles).toBe(3);
    expect(audit.totalChunks).toBe(10);
    expect(audit.folders).toEqual([
      { driveFolderId: "folder_1", folderId: "drive-folder-1", fileCount: 2, chunkCount: 5 },
      { driveFolderId: "folder_2", folderId: "drive-folder-2", fileCount: 1, chunkCount: 5 },
    ]);
  });

  it("reports a folder with no files as zero/zero rather than omitting it", async () => {
    const service = createObservabilityService(makeRepos([folderRecord({ id: "folder_1" })], []));

    const audit = await service.getAudit("acct_1");

    expect(audit.folders).toEqual([{ driveFolderId: "folder_1", folderId: "drive-folder-1", fileCount: 0, chunkCount: 0 }]);
    expect(audit.totalFiles).toBe(0);
    expect(audit.totalChunks).toBe(0);
  });
});
